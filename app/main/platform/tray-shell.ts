import { Menu, Tray, nativeImage } from "electron";
import { ServiceSnapshot } from "../domain/contracts";

interface TrayActions {
  openPanel: () => void;
  openBrowser: () => void;
  startService: () => void;
  stopService: () => void;
  restartService: () => void;
  quit: () => void;
}

function statusLabel(snapshot: ServiceSnapshot): string {
  switch (snapshot.phase) {
    case "booting":
      return "Service: Booting";
    case "online":
      return "Service: Online";
    case "stopping":
      return "Service: Stopping";
    default:
      return "Service: Idle";
  }
}

export class TrayShell {
  private tray: Tray | null = null;

  constructor(
    private readonly iconPath: string,
    private readonly actions: TrayActions,
  ) {}

  mount(snapshot: ServiceSnapshot): void {
    const icon = nativeImage.createFromPath(this.iconPath);
    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("onecodex");
    this.tray.on("click", () => {
      this.actions.openPanel();
    });
    this.render(snapshot);
  }

  render(snapshot: ServiceSnapshot): void {
    if (!this.tray) {
      return;
    }

    const busy = snapshot.phase === "booting" || snapshot.phase === "stopping";
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Control Panel", click: this.actions.openPanel },
      { label: "Open Browser", click: this.actions.openBrowser },
      { type: "separator" },
      { label: statusLabel(snapshot), enabled: false },
      { label: `Port: ${snapshot.port}`, enabled: false },
      { label: "Start Service", enabled: snapshot.phase === "idle", click: this.actions.startService },
      { label: "Stop Service", enabled: snapshot.phase === "online", click: this.actions.stopService },
      { label: "Restart Service", enabled: !busy, click: this.actions.restartService },
      { type: "separator" },
      { label: "Quit", click: this.actions.quit },
    ]));
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
