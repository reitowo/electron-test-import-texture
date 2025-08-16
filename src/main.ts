// @ts-ignore
import { app, BrowserWindow, crashReporter, sharedTexture, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// Use require to import the native module because it doesn't have TypeScript type definitions
// const { SpoutOutput } = require("../electron-spout.node");

console.log(sharedTexture)
console.log('main pid: ', process.pid);

// Expose V8 GC across processes so `(globalThis as any).gc?.()` works
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// app.setPath('crashDumps', 'D:/ElectronTest/crashes');
// crashReporter.start({
//     uploadToServer: false
// });

const createWindow = (): void => {
    const win = new BrowserWindow({
        show: true,
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
    for (let i = 0; i < 16; ++i) {
        const osr = new BrowserWindow({
            show: false,
            webPreferences: {
                backgroundThrottling: false,
                offscreen: {
                    useSharedTexture: true,
                },
            },
        });

        osr.setSize(1280, 720);
        osr.webContents.setFrameRate(240);
        osr.webContents.on("did-finish-load", () => {
            console.log(`osr pid: ${osr.webContents.getOSProcessId()}`);
        });


        let paintCount = 0;
        let releaseCount = 0;
        osr.webContents.on("paint", async (event: Electron.WebContentsPaintEventParams, dirty: Electron.Rectangle, image: Electron.NativeImage) => {
            paintCount++;
            const texture = event.texture!;

            const start = process.hrtime.bigint();
            const imported = sharedTexture.importSharedTexture({
                textureInfo: texture.textureInfo,
                allReferenceReleased() {
                    texture.release()
                    releaseCount++;
                }
            });

            const end = process.hrtime.bigint();
            const importMs = Number(end - start) / 1000000;
            logWithTime("importSharedTexture took", importMs.toFixed(3), "ms", paintCount, releaseCount);

            try {
                await sharedTexture.sendToRenderer(win.webContents, imported, i)
                imported.release();
            } catch (e) {
                console.log('timeout')
            }
        });

        osr.loadURL(
            "https://app.singular.live/output/6W76ei5ZNekKkYhe8nw5o8/Output?aspect=16:9"
        );

        // osr.loadURL(
        //     "file:///D:/ElectronTest/video.html"
        // );

        // osr.loadURL(
        //     "https://gregbenzphotography.com/hdr-gain-map-gallery/"
        // );

        // osr.loadURL(
        //     "https://www.hdrify.com/"
        // );

        // win.webContents.openDevTools({ mode: "detach" });
        // osr.webContents.openDevTools({ mode: "detach" });
    }
};

app.whenReady().then(() => {
    createWindow();
});

app.on("render-process-gone", (event: Electron.Event, webContents: Electron.WebContents, details: Electron.RenderProcessGoneDetails) => {
    console.log("Render process gone:", event, webContents, details);
});