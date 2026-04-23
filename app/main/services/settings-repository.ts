import * as fs from "fs";
import * as path from "path";
import { SettingsDraft, StationSettings } from "../domain/contracts";

const DEFAULT_SETTINGS: StationSettings = {
  apiKey: "",
  model: "",
  preferredPort: 5900,
  autoOpenBrowser: true,
};

function sanitizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizePort(value: unknown, fallback: number): number {
  const candidate = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (Number.isInteger(candidate) && candidate > 0 && candidate <= 65535) {
    return candidate;
  }
  return fallback;
}

function sanitizeFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSettings(input: Partial<StationSettings>): StationSettings {
  return {
    apiKey: sanitizeText(input.apiKey),
    model: sanitizeText(input.model),
    preferredPort: sanitizePort(input.preferredPort, DEFAULT_SETTINGS.preferredPort),
    autoOpenBrowser: sanitizeFlag(input.autoOpenBrowser, DEFAULT_SETTINGS.autoOpenBrowser),
  };
}

export class SettingsRepository {
  constructor(private readonly filePath: string) {}

  read(): StationSettings {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StationSettings>;
      return normalizeSettings(parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save(draft: SettingsDraft): StationSettings {
    const current = this.read();
    const next = {
      apiKey: sanitizeText(draft.apiKey ?? current.apiKey),
      model: sanitizeText(draft.model ?? current.model),
      preferredPort: sanitizePort(draft.preferredPort ?? current.preferredPort, current.preferredPort),
      autoOpenBrowser: sanitizeFlag(draft.autoOpenBrowser ?? current.autoOpenBrowser, current.autoOpenBrowser),
    };

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }
}
