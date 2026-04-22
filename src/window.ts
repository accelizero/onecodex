import { BrowserWindow } from "electron";
import * as path from "path";
import { WINDOW_HEIGHT, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, WINDOW_WIDTH } from "./constants";
import { shouldHideWindowOnClose } from "./window-close-policy";
import * as log from "./logger";

interface ShowOptions {
  url?: string;
  filePath?: string;
}

export class WindowManager {
  private win: BrowserWindow | null = null;
  private allowAppQuit = false;

  async show(options: ShowOptions): Promise<void> {
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        show: false,
        autoHideMenuBar: true,
        title: "onecodex",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.join(__dirname, "preload.js"),
        },
      });

      this.win.on("close", (event) => {
        if (!shouldHideWindowOnClose({ allowAppQuit: this.allowAppQuit })) {
          return;
        }
        event.preventDefault();
        this.win?.hide();
      });

      this.win.on("closed", () => {
        this.win = null;
        this.allowAppQuit = false;
      });
    }

    if (options.filePath) {
      await this.win.loadFile(options.filePath);
    } else if (options.url) {
      await this.win.loadURL(options.url);
    } else {
      throw new Error("missing window target");
    }

    this.win.show();
    this.win.focus();
  }

  prepareForAppQuit(): void {
    this.allowAppQuit = true;
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners("close");
    }
  }

  destroy(): void {
    if (!this.win || this.win.isDestroyed()) {
      return;
    }
    try {
      this.win.destroy();
    } catch (error) {
      log.error(`window destroy failed: ${String(error)}`);
    } finally {
      this.win = null;
    }
  }
}
