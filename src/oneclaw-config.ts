import * as fs from "fs";
import * as path from "path";
import { resolveUserStateDir } from "./constants";

export interface OneclawConfig {
  setupCompletedAt?: string;
  codex?: {
    apiKey?: string;
    model?: string;
    provider?: string;
  };
}

function resolveLegacyOneclawConfigPath(): string {
  return path.join(resolveUserStateDir(), "oneclaw.config.json");
}

export function resolveOneclawConfigPath(): string {
  return path.join(resolveUserStateDir(), "onecodex.config.json");
}

export function readOneclawConfig(): OneclawConfig | null {
  for (const configPath of [resolveOneclawConfigPath(), resolveLegacyOneclawConfigPath()]) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as OneclawConfig : null;
    } catch {}
  }
  return null;
}

export function writeOneclawConfig(config: OneclawConfig): void {
  fs.mkdirSync(resolveUserStateDir(), { recursive: true });
  fs.writeFileSync(resolveOneclawConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function markSetupComplete(): void {
  const config = readOneclawConfig() ?? {};
  config.setupCompletedAt = new Date().toISOString();
  writeOneclawConfig(config);
}
