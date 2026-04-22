import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("oneclaw", {
  startGateway: () => ipcRenderer.invoke("gateway:start"),
  stopGateway: () => ipcRenderer.invoke("gateway:stop"),
  restartGateway: () => ipcRenderer.invoke("gateway:restart"),
  getGatewayState: () => ipcRenderer.invoke("gateway:state"),
  getGatewayPort: () => ipcRenderer.invoke("gateway:port"),
  launcherGetConfig: () => ipcRenderer.invoke("launcher:get-config"),
  launcherSaveConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("launcher:save-config", params),
  openSettings: () => ipcRenderer.invoke("app:open-settings"),
  openWebUI: () => ipcRenderer.invoke("app:open-webui"),
  onGatewayReady: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("gateway:ready", listener);
    return () => ipcRenderer.removeListener("gateway:ready", listener);
  },
});
