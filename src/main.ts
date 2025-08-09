// @ts-ignore
import { app, BrowserWindow, crashReporter, sharedTexture, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// Use require to import the native module because it doesn't have TypeScript type definitions
// const { SpoutOutput } = require("../electron-spout.node");

console.log(sharedTexture)
console.log('main pid: ', process.pid);

// app.setPath('crashDumps', 'D:/ElectronTest/crashes');
// crashReporter.start({
//     uploadToServer: false
// });

const createWindow = (): void => {
    const win = new BrowserWindow({
        webPreferences: {
            backgroundThrottling: false,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    win.setSize(1920, 1080);

    win.loadFile(path.join(__dirname, "../index.html"));
    // win.loadURL("https://www.youtube.com/watch?v=3L0Ph8KV0Tk")

    win.webContents.on("did-finish-load", () => {
        console.log(`win pid: ${win.webContents.getOSProcessId()}`);
    });

    // Create offscreen windows for texture sources
    for (let i = 0; i < 1; ++i) {
        const osr = new BrowserWindow({
            show: false,
            webPreferences: {
                sandbox: false,
                backgroundThrottling: false,
                offscreen: {
                    useSharedTexture: true,
                },
            },
        });

        osr.setSize(1920, 1080);

        // Set frame rate to 60fps for source textures
        osr.webContents.setFrameRate(60);

        osr.webContents.on("did-finish-load", () => {
            console.log(`osr pid: ${osr.webContents.getOSProcessId()}`);
        });

        const capturedTextures = new Map<string, any>();

        ipcMain.on("shared-texture-done", (event, id) => {
            const data = capturedTextures.get(id);
            if (data) {
                data.count--;

                if (data.count == 0) {
                    logWithTime("main released shared texture:", id);
                    const { imported, texture } = data;

                    imported.release(() => {
                        logWithTime("main released source texture:", id);
                        texture.release();
                    });

                    capturedTextures.delete(id);
                }
            }
        });

        osr.webContents.on("paint", (event: Electron.WebContentsPaintEventParams, dirty: Electron.Rectangle, image: Electron.NativeImage) => {
            const texture = event.texture!;
            console.log(texture.textureInfo)   

            const imported = sharedTexture.importSharedTexture(texture.textureInfo);

            const id = randomUUID();
            capturedTextures.set(id, { count: 0, imported, texture });

            const transfer = imported.startTransferSharedTexture()
            win.webContents.send("shared-texture", id, i, transfer);

            capturedTextures.get(id)!.count++;
        });

        // osr.loadURL(
        //     "https://app.singular.live/output/6W76ei5ZNekKkYhe8nw5o8/Output?aspect=16:9"
        // );

        osr.loadURL(
            "file:///D:/ElectronTest/video.html"
        );

        // osr.loadURL(
        //     "https://gregbenzphotography.com/hdr-gain-map-gallery/"
        // );

        // osr.loadURL(
        //     "https://www.hdrify.com/"
        // );

        // win.webContents.openDevTools();
    }
};

app.whenReady().then(() => {
    createWindow();
});

app.on("render-process-gone", (event: Electron.Event, webContents: Electron.WebContents, details: Electron.RenderProcessGoneDetails) => {
    console.log("Render process gone:", event, webContents, details);
});