const { app, BrowserWindow, crashReporter } = require("electron");
const { SpoutOutput } = require("./electron-spout.node");
const os = require("os");
const process = require("process");

console.log('main pid: ', process.pid);

app.setPath('crashDumps', 'D:/ElectronTest/crashes')
crashReporter.start({
  uploadToServer: false
})

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  win.loadFile("index.html");
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
      },
    },
  });

  const spout = new SpoutOutput("electron");

  osr.webContents.setFrameRate(2);

  osr.webContents.on("did-finish-load", () => {
    console.log(`osr pid: ${osr.webContents.getOSProcessId()}`);
  });

  osr.webContents.on("paint", (event, dirty, image) => {
    // spout.updateTexture(event.texture.textureInfo);
    win.webContents.send("shared-texture", event.texture.textureInfo);

    setTimeout(() => {
      event.texture.release();
    }, 5000);
  });

  osr.loadURL(
    "https://app.singular.live/output/6W76ei5ZNekKkYhe8nw5o8/Output?aspect=16:9"
  );
};

app.whenReady().then(() => {
  createWindow();
});

app.on("render-process-gone", (event, webContents, details) => {
  console.log("Render process gone:", event, webContents, details);
});
