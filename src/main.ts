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
        width: 1600,
        height: 900,
        webPreferences: {
            backgroundThrottling: false,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    win.webContents.setFrameRate(60);

    win.loadFile(path.join(__dirname, "../index.html"));
    win.webContents.openDevTools();

    win.webContents.on("did-finish-load", () => {
        console.log(`win pid: ${win.webContents.getOSProcessId()}`);
    });

    // Create offscreen windows for texture sources
    for (let i = 0; i < 16; ++i) {
        const osr = new BrowserWindow({
            width: 1280,
            height: 720,
            show: false,
            webPreferences: {
                backgroundThrottling: false,
                offscreen: {
                    useSharedTexture: true,
                },
            },
        });

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
            const imported = sharedTexture.importSharedTexture(texture.textureInfo);

            const id = randomUUID();
            capturedTextures.set(id, { count: 0, imported, texture });

            const transfer = imported.startTransferSharedTexture()
            win.webContents.send("shared-texture", id, i, transfer);
            capturedTextures.get(id)!.count++;
        });

        osr.loadURL(
            "https://app.singular.live/output/6W76ei5ZNekKkYhe8nw5o8/Output?aspect=16:9"
        );
    }
};

app.whenReady().then(() => {
    createWindow();
});

app.on("render-process-gone", (event: Electron.Event, webContents: Electron.WebContents, details: Electron.RenderProcessGoneDetails) => {
    console.log("Render process gone:", event, webContents, details);
});