import { app, ipcMain, shell } from "electron";
import { desktopChannels } from "./platform/ipc-contract";
import { TrayShell } from "./platform/tray-shell";
import { WindowShell } from "./platform/window-shell";
import { SettingsRepository } from "./services/settings-repository";
import { RuntimeLayout } from "./services/runtime-layout";
import { ServiceSupervisor } from "./services/service-supervisor";
import { Journal } from "./support/journal";

if (!process.env.ONECODEX_MULTI_INSTANCE && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const layout = new RuntimeLayout();
layout.ensureStateDirectories();

const desktopJournal = new Journal(layout.resolveDesktopLog(), "desktop");
const serviceJournal = new Journal(layout.resolveServiceLog(), "service");
const settingsRepository = new SettingsRepository(layout.resolveSettingsFile());
const service = new ServiceSupervisor(layout, serviceJournal, settingsRepository.read().preferredPort);
const windowShell = new WindowShell(layout.resolveUiDocument());
let trayShell: TrayShell | null = null;
let quitting = false;

function publishState(): void {
  const snapshot = service.snapshot();
  trayShell?.render(snapshot);
  windowShell.publish(snapshot);
}

async function openBrowser(): Promise<void> {
  const snapshot = await service.start(settingsRepository.read());
  publishState();
  await shell.openExternal(snapshot.address);
}

function bindIpc(): void {
  ipcMain.handle(desktopChannels.loadSettings, async () => settingsRepository.read());
  ipcMain.handle(desktopChannels.saveSettings, async (_event, draft: Record<string, unknown>) => {
    const saved = settingsRepository.save(draft);
    await service.synchronize(saved);
    publishState();
    return saved;
  });
  ipcMain.handle(desktopChannels.readSnapshot, async () => service.snapshot());
  ipcMain.handle(desktopChannels.startService, async () => {
    const snapshot = await service.start(settingsRepository.read());
    publishState();
    return snapshot;
  });
  ipcMain.handle(desktopChannels.stopService, async () => {
    const snapshot = await service.stop();
    publishState();
    return snapshot;
  });
  ipcMain.handle(desktopChannels.restartService, async () => {
    const snapshot = await service.restart(settingsRepository.read());
    publishState();
    return snapshot;
  });
  ipcMain.handle(desktopChannels.openBrowser, async () => {
    await openBrowser();
    return service.snapshot();
  });
}

async function quitApplication(): Promise<void> {
  if (quitting) {
    return;
  }
  quitting = true;
  trayShell?.dispose();
  windowShell.prepareForQuit();
  try {
    await service.stop();
  } catch (error) {
    desktopJournal.error(`shutdown error ${String(error)}`);
  }
  app.quit();
}

process.on("uncaughtException", (error) => {
  desktopJournal.error(`uncaughtException ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  desktopJournal.error(`unhandledRejection ${String(reason)}`);
});

service.subscribe(() => {
  publishState();
});

app.on("second-instance", () => {
  void windowShell.reveal();
});

app.on("activate", () => {
  void windowShell.reveal();
});

app.on("before-quit", (event) => {
  if (quitting) {
    return;
  }
  event.preventDefault();
  void quitApplication();
});

app.whenReady().then(async () => {
  bindIpc();

  trayShell = new TrayShell(layout.resolveTrayIcon(), {
    openPanel: () => {
      void windowShell.reveal();
    },
    openBrowser: () => {
      void openBrowser();
    },
    startService: () => {
      void service.start(settingsRepository.read());
    },
    stopService: () => {
      void service.stop();
    },
    restartService: () => {
      void service.restart(settingsRepository.read());
    },
    quit: () => {
      void quitApplication();
    },
  });

  trayShell.mount(service.snapshot());
  await windowShell.reveal();
  publishState();

  const saved = settingsRepository.read();
  if (saved.apiKey) {
    try {
      await service.start(saved);
      if (saved.autoOpenBrowser) {
        await shell.openExternal(service.snapshot().address);
      }
    } catch (error) {
      desktopJournal.error(`autoboot failed ${String(error)}`);
    }
  }
}).catch((error) => {
  desktopJournal.error(`bootstrap failed ${String(error)}`);
  app.quit();
});
