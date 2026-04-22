import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export const IS_WIN = process.platform === "win32";

export const DEFAULT_CODEXAPP_PORT = 5900;

export const WINDOW_WIDTH = 960;
export const WINDOW_HEIGHT = 760;
export const WINDOW_MIN_WIDTH = 860;
export const WINDOW_MIN_HEIGHT = 680;

export function resolveUserStateDir(): string {
  const override = process.env.ONECODEX_STATE_DIR?.trim() || process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  const home = IS_WIN ? process.env.USERPROFILE : process.env.HOME;
  return path.join(home ?? "", ".onecodex");
}

export function resolveResourcesPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "resources");
  }
  const target = process.env.ONECLAW_TARGET ?? `${process.platform}-${process.arch}`;
  return path.join(app.getAppPath(), "resources", "targets", target);
}

export function resolveLauncherPath(): string {
  return path.join(app.getAppPath(), "launcher", "index.html");
}

export function resolveCodexAppPort(): number {
  const raw = process.env.ONECLAW_CODEXAPP_PORT?.trim() ?? process.env.CODEXAPP_PORT?.trim();
  if (!raw) {
    return DEFAULT_CODEXAPP_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CODEXAPP_PORT;
}

export function resolveCodexAppUrl(port = resolveCodexAppPort()): string {
  return `http://127.0.0.1:${port}`;
}

export function resolveCodexAppRoot(): string {
  const override = process.env.ONECLAW_CODEXAPP_ROOT?.trim();
  if (override) {
    return override;
  }
  if (app.isPackaged) {
    return path.join(resolveResourcesPath(), "codexapp");
  }
  return path.resolve(app.getAppPath(), "..", "codexui");
}

export function resolveCodexHomeDir(): string {
  return path.join(resolveUserStateDir(), "codex");
}

export function resolveCodexCommandPath(): string | null {
  const binPath = path.join(resolveCodexAppRoot(), "node_modules", ".bin", IS_WIN ? "codex.cmd" : "codex");
  return fs.existsSync(binPath) ? binPath : null;
}

export function resolveCodexAppNodeBin(): string {
  const exe = IS_WIN ? "node.exe" : "node";
  const bundled = path.join(resolveResourcesPath(), "runtime", exe);
  return fs.existsSync(bundled) ? bundled : exe;
}

export function resolveAppLogPath(): string {
  return path.join(resolveUserStateDir(), "app.log");
}

export function resolveCodexAppLogPath(): string {
  return path.join(resolveUserStateDir(), "codexapp.log");
}
