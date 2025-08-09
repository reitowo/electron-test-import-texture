/// <reference types="@types/offscreencanvas" />

// @ts-ignore
import { sharedTexture, nativeImage } from "electron";
import { ipcRenderer, contextBridge } from "electron/renderer";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// contextBridge.exposeInMainWorld("textures", {
//     // @ts-ignore
//     onSharedTexture: (cb: (id: string, idx: number, imported: any) => Promise<void>) => ipcRenderer.on("shared-texture", async (e, id, idx, transfer) => {
//         logWithTime("preload received shared texture:", id, "idx:", idx);

//         const imported = sharedTexture.finishTransferSharedTexture(transfer);
//         logWithTime("preload finished imported", id, "idx:", idx);

//         cb(id, idx, imported);
//     }),

//     // Add method to notify main process texture has been released
//     notifyTextureReleased: (id: string) => {
//         ipcRenderer.send("shared-texture-done", id);
//         logWithTime("preload notified main process texture released:", id);
//     }
// });

contextBridge.exposeInMainWorld("textures", {
    // @ts-ignore
    onSharedTexture: (cb: (id: string, idx: number, imported: any) => Promise<void>) => ipcRenderer.on("shared-texture", async (e, id, idx, transfer) => {
        logWithTime("preload received shared texture:", id, "idx:", idx);

        const imported = sharedTexture.finishTransferSharedTexture(transfer);
        logWithTime("preload finished imported", id, "idx:", idx);

        const syncToken = imported.getFrameCreationSyncToken()
        console.log('syncToken: ', JSON.stringify(syncToken))
        ipcRenderer.send("shared-texture-sync-token", id, syncToken);

        cb(id, idx, imported);
    }),

    // Add method to notify main process texture has been released
    notifyTextureReleased: (id: string) => {
        logWithTime("preload notified main process texture released:", id);
    }
});