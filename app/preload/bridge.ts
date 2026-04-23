import { contextBridge, ipcRenderer } from "electron";
import { desktopChannels } from "../main/platform/ipc-contract";

contextBridge.exposeInMainWorld("stationBridge", {
  readSettings: () => ipcRenderer.invoke(desktopChannels.loadSettings),
  saveSettings: (payload: Record<string, unknown>) => ipcRenderer.invoke(desktopChannels.saveSettings, payload),
  readSnapshot: () => ipcRenderer.invoke(desktopChannels.readSnapshot),
  startService: () => ipcRenderer.invoke(desktopChannels.startService),
  stopService: () => ipcRenderer.invoke(desktopChannels.stopService),
  restartService: () => ipcRenderer.invoke(desktopChannels.restartService),
  openBrowser: () => ipcRenderer.invoke(desktopChannels.openBrowser),
  onSnapshot: (listener: (snapshot: unknown) => void) => {
    const wrapped = (_event: unknown, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on(desktopChannels.snapshotBroadcast, wrapped);
    return () => ipcRenderer.removeListener(desktopChannels.snapshotBroadcast, wrapped);
  },
});
