import { app, ipcMain, shell, BrowserWindow } from "electron";
import { CodexAppProcess } from "./codexapp-process";
import { registerLauncherIpc } from "./launcher-ipc";
import { resolveCodexAppPort, resolveCodexAppUrl, resolveLauncherPath } from "./constants";
import { readOneclawConfig } from "./oneclaw-config";
import { TrayManager } from "./tray";
import { WindowManager } from "./window";
import * as log from "./logger";

if (!process.env.ONECLAW_MULTI_INSTANCE && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  log.error(`uncaughtException: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  log.error(`unhandledRejection: ${String(reason)}`);
});

const windowManager = new WindowManager();
const tray = new TrayManager();
const gateway = new CodexAppProcess({
  port: resolveCodexAppPort(),
  onStateChange: (state) => {
    tray.updateMenu();
    if (state !== "running") {
      return;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("gateway:ready");
      }
    }
  },
});

let isQuitting = false;

function readStoredConfig(): { apiKey: string; model: string } {
  const config = readOneclawConfig();
  return {
    apiKey: config?.codex?.apiKey?.trim() ?? "",
    model: config?.codex?.model?.trim() ?? "",
  };
}

async function ensureGatewayRunning(source: string): Promise<boolean> {
  try {
    await gateway.start();
    const { apiKey, model } = readStoredConfig();
    await gateway.applyConfig({ apiKey, model });
    log.info(`service ready: source=${source} port=${gateway.getPort()}`);
    return true;
  } catch (error) {
    log.error(`service start failed: source=${source} error=${String(error)}`);
    return false;
  }
}

async function openLauncherWindow(): Promise<void> {
  await windowManager.show({ filePath: resolveLauncherPath() });
}

async function openBrowserUi(source: string): Promise<void> {
  const ok = await ensureGatewayRunning(source);
  if (!ok) {
    return;
  }
  await shell.openExternal(resolveCodexAppUrl(gateway.getPort()));
}

function registerCoreIpc(): void {
  ipcMain.handle("gateway:start", async () => {
    const ok = await ensureGatewayRunning("gateway:start");
    return { success: ok, state: gateway.getState(), port: gateway.getPort() };
  });

  ipcMain.handle("gateway:stop", async () => {
    await gateway.stop();
    return { success: true, state: gateway.getState(), port: gateway.getPort() };
  });

  ipcMain.handle("gateway:restart", async () => {
    const ok = await (async () => {
      try {
        await gateway.restart();
        const { apiKey, model } = readStoredConfig();
        await gateway.applyConfig({ apiKey, model });
        return true;
      } catch (error) {
        log.error(`service restart failed: ${String(error)}`);
        return false;
      }
    })();
    return { success: ok, state: gateway.getState(), port: gateway.getPort() };
  });

  ipcMain.handle("gateway:state", async () => gateway.getState());
  ipcMain.handle("gateway:port", async () => gateway.getPort());

  ipcMain.handle("app:open-settings", async () => {
    await openLauncherWindow();
    return { success: true };
  });

  ipcMain.handle("app:open-webui", async () => {
    const ok = await ensureGatewayRunning("app:open-webui");
    if (ok) {
      await shell.openExternal(resolveCodexAppUrl(gateway.getPort()));
    }
    return { success: ok, port: gateway.getPort() };
  });
}

async function quitGracefully(): Promise<void> {
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  tray.destroy();
  windowManager.prepareForAppQuit();
  try {
    await gateway.stop();
  } catch (error) {
    log.error(`service stop failed on quit: ${String(error)}`);
  }
  app.quit();
}

app.on("second-instance", () => {
  void openLauncherWindow();
});

app.on("activate", () => {
  void openLauncherWindow();
});

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault();
  void quitGracefully();
});

app.whenReady().then(async () => {
  registerCoreIpc();
  registerLauncherIpc({
    getGatewayState: () => gateway.getState(),
    getGatewayPort: () => gateway.getPort(),
    ensureGatewayRunning,
  });

  tray.create({
    gateway,
    onOpenLauncher: () => {
      void openLauncherWindow();
    },
    onOpenBrowser: () => {
      void openBrowserUi("tray:open-browser");
    },
    onStartGateway: () => {
      void ensureGatewayRunning("tray:start");
    },
    onStopGateway: () => {
      void gateway.stop();
    },
    onRestartGateway: () => {
      void (async () => {
        try {
          await gateway.restart();
          const { apiKey, model } = readStoredConfig();
          await gateway.applyConfig({ apiKey, model });
        } catch (error) {
          log.error(`tray restart failed: ${String(error)}`);
        }
      })();
    },
    onQuit: () => {
      void quitGracefully();
    },
  });

  await openLauncherWindow();

  if (readStoredConfig().apiKey) {
    void ensureGatewayRunning("app:ready");
  }
}).catch((error) => {
  log.error(`app bootstrap failed: ${String(error)}`);
  app.quit();
});
