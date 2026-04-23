export type ServicePhase = "idle" | "booting" | "online" | "stopping";

export interface StationSettings {
  apiKey: string;
  model: string;
  preferredPort: number;
  autoOpenBrowser: boolean;
}

export interface ServiceSnapshot {
  phase: ServicePhase;
  port: number;
  address: string;
  lastError: string | null;
  startedAt: number | null;
}

export interface SettingsDraft {
  apiKey?: unknown;
  model?: unknown;
  preferredPort?: unknown;
  autoOpenBrowser?: unknown;
}
