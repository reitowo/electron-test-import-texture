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

// app.setPath('crashDumps', 'D:/ElectronTest/crashes');
// crashReporter.start({
//     uploadToServer: false
// });

const createWindow = (): void => {
    const win = new BrowserWindow({
        show: false,
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
                backgroundThrottling: false,
                offscreen: {
                    useSharedTexture: true,
                },
            },
        });

        osr.setSize(1920, 1080);
        osr.webContents.setFrameRate(120);
        osr.webContents.on("did-finish-load", () => {
            console.log(`osr pid: ${osr.webContents.getOSProcessId()}`);
        });

        const capturedTextures = new Map<string, any>();

        let mode = 3
        if (mode === 1) {
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
        } else if (mode === 2) {
            ipcMain.on("shared-texture-sync-token", (event, id, syncToken) => {
                const data = capturedTextures.get(id);
                if (data) {
                    logWithTime("main released shared texture:", id, syncToken);
                    const { imported, texture }: { imported: Electron.SharedTextureImported, texture: Electron.OffscreenSharedTexture } = data;

                    imported.setReleaseSyncToken(syncToken)
                    imported.release(() => {
                        logWithTime("main released source texture:", id);
                        texture.release();
                    });

                    capturedTextures.delete(id);
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
            });
        } else if (mode === 3) {
            let paintCount = 0;
            let releaseCount = 0;
            osr.webContents.on("paint", async (event: Electron.WebContentsPaintEventParams, dirty: Electron.Rectangle, image: Electron.NativeImage) => {
                paintCount++;
                const texture = event.texture!;
                const id = randomUUID();
                const start = process.hrtime.bigint();
                const imported = sharedTexture.importSharedTexture({
                    copy: () => {
                        texture.release();
                        releaseCount++;
                    },
                    ...texture.textureInfo
                });
                const end = process.hrtime.bigint();
                const importMs = Number(end - start) / 1000000;
                logWithTime("importSharedTexture took", importMs.toFixed(3), "ms", paintCount, releaseCount);

                try {
                    await sharedTexture.sendToRenderer(win.webContents, imported, id)
                    imported.release();
                } catch (e) {
                    console.log('timeout')
                }
            });
        }

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