import { ipcMain } from "electron";
import { resolveCodexAppUrl } from "./constants";
import { markSetupComplete, readOneclawConfig, writeOneclawConfig } from "./oneclaw-config";

interface LauncherIpcOptions {
  getGatewayState: () => string;
  getGatewayPort: () => number;
  ensureGatewayRunning: (source: string) => Promise<boolean>;
}

export function registerLauncherIpc(opts: LauncherIpcOptions): void {
  ipcMain.handle("launcher:get-config", async () => {
    const config = readOneclawConfig() ?? {};
    const apiKey = config.codex?.apiKey?.trim() ?? "";
    const model = config.codex?.model?.trim() ?? "";
    return {
      success: true,
      data: {
        apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "",
        hasApiKey: apiKey.length > 0,
        model,
        browserUrl: resolveCodexAppUrl(opts.getGatewayPort()),
        serviceState: opts.getGatewayState(),
      },
    };
  });

  ipcMain.handle("launcher:save-config", async (_event, params: Record<string, unknown>) => {
    const apiKey = typeof params?.apiKey === "string" ? params.apiKey.trim() : "";
    const model = typeof params?.model === "string" ? params.model.trim() : "";
    if (!apiKey) {
      return { success: false, message: "API key 不能为空" };
    }

    const config = readOneclawConfig() ?? {};
    config.codex = {
      apiKey,
      model,
      provider: "codex",
    };
    writeOneclawConfig(config);
    markSetupComplete();

    const running = await opts.ensureGatewayRunning("launcher:save-config");
    return {
      success: running,
      message: running ? "" : "服务启动失败",
      data: {
        browserUrl: resolveCodexAppUrl(opts.getGatewayPort()),
        serviceState: opts.getGatewayState(),
      },
    };
  });
}
