import { Menu, Tray, app, nativeImage } from "electron";
import * as path from "path";
import type { GatewayState } from "./codexapp-process";

interface TrayGateway {
  getState(): GatewayState;
}

interface TrayOptions {
  gateway: TrayGateway;
  onOpenLauncher: () => void;
  onOpenBrowser: () => void;
  onStartGateway: () => void;
  onStopGateway: () => void;
  onRestartGateway: () => void;
  onQuit: () => void;
}

function resolveStateLabel(state: GatewayState): string {
  switch (state) {
    case "running":
      return "Service: Running";
    case "starting":
      return "Service: Starting";
    case "stopping":
      return "Service: Stopping";
    default:
      return "Service: Stopped";
  }
}

export class TrayManager {
  private tray: Tray | null = null;
  private options: TrayOptions | null = null;

  create(options: TrayOptions): void {
    this.options = options;
    const iconName = process.platform === "darwin" ? "tray-iconTemplate@2x.png" : "tray-icon@2x.png";
    const iconPath = path.join(app.getAppPath(), "assets", iconName);
    const icon = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("onecodex");
    this.tray.on("click", () => {
      options.onOpenLauncher();
    });
    this.updateMenu();
  }

  updateMenu(): void {
    if (!this.tray || !this.options) {
      return;
    }

    const state = this.options.gateway.getState();
    const busy = state === "starting" || state === "stopping";

    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Config", click: this.options.onOpenLauncher },
      { label: "Open Browser", click: this.options.onOpenBrowser },
      { type: "separator" },
      { label: resolveStateLabel(state), enabled: false },
      { label: "Start Service", enabled: state === "stopped", click: this.options.onStartGateway },
      { label: "Stop Service", enabled: state === "running", click: this.options.onStopGateway },
      { label: "Restart Service", enabled: !busy, click: this.options.onRestartGateway },
      { type: "separator" },
      { label: "Quit", click: this.options.onQuit },
    ]));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
    this.options = null;
  }
}
