import { app, BrowserWindow, crashReporter } from "electron";
import path from "node:path";
import process from "node:process";

// Use require to import the native module because it doesn't have TypeScript type definitions
// const { SpoutOutput } = require("../electron-spout.node");

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
            sandbox: false,
            contextIsolation: false,
            nodeIntegration: true,
        },
    });

    win.loadFile(path.join(__dirname, "../index.html"));
    win.webContents.openDevTools();

    win.webContents.on("did-finish-load", () => {
        console.log(`win pid: ${win.webContents.getOSProcessId()}`);
    });

    const osr = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            sandbox: false,
            offscreen: {
                useSharedTexture: true,
            } as any,
        },
    });

    // const spout = new SpoutOutput("electron");

    osr.webContents.setFrameRate(2);

    osr.webContents.on("did-finish-load", () => {
        console.log(`osr pid: ${osr.webContents.getOSProcessId()}`);
    });

    osr.webContents.on("paint", (event: Electron.WebContentsPaintEventParams, dirty: Electron.Rectangle, image: Electron.NativeImage) => {
        const texture = event.texture!;
        // spout.updateTexture(texture.textureInfo);
        
        (texture.textureInfo as any).handleOwnerProcess = process.pid;
        win.webContents.send("shared-texture", texture.textureInfo);

        setTimeout(() => {
            texture.release();
        }, 5000);
    });

    osr.loadURL(
        "https://app.singular.live/output/6W76ei5ZNekKkYhe8nw5o8/Output?aspect=16:9"
    );
};

app.whenReady().then(() => {
    createWindow();
});

app.on("render-process-gone", (event: Electron.Event, webContents: Electron.WebContents, details: Electron.RenderProcessGoneDetails) => {
    console.log("Render process gone:", event, webContents, details);
});