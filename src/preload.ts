/// <reference types="@types/offscreencanvas" />

// @ts-ignore
import { sharedTexture, nativeImage } from "electron";
import { ipcRenderer, contextBridge } from "electron/renderer";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

contextBridge.exposeInMainWorld("textures", {
    // @ts-ignore
    onSharedTexture: (cb: (id: string, idx: number, data: any) => Promise<void>) => ipcRenderer.on("shared-texture", async (e, id, idx, transfer) => {
        logWithTime("preload received send shared texture:", id);

        const imported = sharedTexture.finishTransferSharedTexture(transfer);
        logWithTime("preload finished imported", id);

        await cb(id, idx, imported);

        imported.release(() => {
            ipcRenderer.send("shared-texture-done", id);
        });
        logWithTime("preload released imported", id);
    })
});

