/// <reference types="@types/offscreencanvas" />

import { webUtils } from "electron";
import { ipcRenderer, contextBridge } from "electron/renderer";

contextBridge.exposeInMainWorld("textures", {
    // @ts-ignore
    getVideoFrame: (e) => {
        console.log(e);
        // @ts-ignore
        const ret = webUtils.getVideoFrameForSharedTexture(e);
        console.log(ret);
        return ret;
    },
    // @ts-ignore
    onSharedTexture: (cb) => ipcRenderer.on("shared-texture", cb),
    getBlob: () => {
        return new Blob([new Uint8Array(4)], { type: "image/png" });
    }
});

