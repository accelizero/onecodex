import { BrowserWindow, shell } from "electron";
import * as path from "path";
import { ServiceSnapshot } from "../domain/contracts";
import { desktopChannels } from "./ipc-contract";

export class WindowShell {
  private window: BrowserWindow | null = null;
  private closingForQuit = false;

  constructor(private readonly documentPath: string) {}

  async reveal(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.createWindow();
      await this.window.loadFile(this.documentPath);
    }

    this.window.show();
    this.window.focus();
  }

  publish(snapshot: ServiceSnapshot): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(desktopChannels.snapshotBroadcast, snapshot);
  }

  prepareForQuit(): void {
    this.closingForQuit = true;
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners("close");
    }
  }

  private createWindow(): BrowserWindow {
    const preloadPath = path.resolve(__dirname, "../../preload/bridge.js");
    const window = new BrowserWindow({
      width: 1160,
      height: 820,
      minWidth: 940,
      minHeight: 700,
      show: false,
      autoHideMenuBar: true,
      title: "onecodex station",
      backgroundColor: "#f6eee3",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    window.once("ready-to-show", () => {
      window.show();
    });
    window.on("close", (event) => {
      if (this.closingForQuit) {
        return;
      }
      event.preventDefault();
      window.hide();
    });
    window.on("closed", () => {
      this.window = null;
      this.closingForQuit = false;
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });

    return window;
  }
}
