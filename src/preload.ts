/// <reference types="@types/offscreencanvas" />

// @ts-ignore
import { sharedTexture, nativeImage } from "electron";
import { ipcRenderer, contextBridge } from "electron/renderer";
import { crashReporter } from "electron";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

contextBridge.exposeInMainWorld("textures", {
    // @ts-ignore
    onSharedTexture: (cb: (id: string, idx: number, imported: any) => Promise<void>) =>
        sharedTexture.receiveFromMain(async (imported, id) => {
            cb(id, 0, imported);
        }),
}); 

setInterval(() => {
    (globalThis as any).gc?.();
}, 500)