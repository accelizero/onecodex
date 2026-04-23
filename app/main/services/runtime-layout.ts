import { app } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SETTINGS_FILE = "settings-v1.json";
const STATE_FOLDER = ".onecodex-station";

export class RuntimeLayout {
  resolveStateRoot(): string {
    const override = process.env.ONECODEX_STATE_HOME?.trim();
    if (override) {
      return override;
    }
    return path.join(os.homedir(), STATE_FOLDER);
  }

  resolveSettingsFile(): string {
    return path.join(this.resolveStateRoot(), SETTINGS_FILE);
  }

  resolveLogsRoot(): string {
    return path.join(this.resolveStateRoot(), "logs");
  }

  resolveDesktopLog(): string {
    return path.join(this.resolveLogsRoot(), "desktop.log");
  }

  resolveServiceLog(): string {
    return path.join(this.resolveLogsRoot(), "service.log");
  }

  resolveCodexHome(): string {
    return path.join(this.resolveStateRoot(), "codex-home");
  }

  ensureStateDirectories(): void {
    fs.mkdirSync(this.resolveLogsRoot(), { recursive: true });
    fs.mkdirSync(this.resolveCodexHome(), { recursive: true });
  }

  resolveUiDocument(): string {
    return path.join(app.getAppPath(), "ui-shell", "index.html");
  }

  resolveTrayIcon(): string {
    const iconName = process.platform === "darwin" ? "tray-iconTemplate@2x.png" : "tray-icon@2x.png";
    return path.join(app.getAppPath(), "assets", iconName);
  }

  resolveBundleTarget(): string {
    return process.env.ONECODEX_BUNDLE_TARGET?.trim() || `${process.platform}-${process.arch}`;
  }

  resolveBundleRoot(): string {
    const override = process.env.ONECODEX_RUNTIME_ROOT?.trim();
    if (override) {
      return override;
    }
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "engine");
    }
    return path.join(app.getAppPath(), "resources", "runtime-bundles", this.resolveBundleTarget());
  }

  resolveNodeBinary(): string {
    const binaryName = process.platform === "win32" ? "node.exe" : "node";
    const bundled = path.join(this.resolveBundleRoot(), "node", binaryName);
    return fs.existsSync(bundled) ? bundled : binaryName;
  }

  resolveServiceRoot(): string {
    return path.join(this.resolveBundleRoot(), "service");
  }

  resolveServiceEntry(): string {
    return path.join(this.resolveServiceRoot(), "dist-cli", "index.js");
  }

  resolveBundledCodex(): string | null {
    const executable = process.platform === "win32" ? "codex.cmd" : "codex";
    const candidate = path.join(this.resolveServiceRoot(), "node_modules", ".bin", executable);
    return fs.existsSync(candidate) ? candidate : null;
  }

  resolveAddress(port: number): string {
    return `http://127.0.0.1:${port}`;
  }
}
