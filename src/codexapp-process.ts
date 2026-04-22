import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import {
  IS_WIN,
  resolveCodexAppLogPath,
  resolveCodexAppNodeBin,
  resolveCodexAppPort,
  resolveCodexAppRoot,
  resolveCodexAppUrl,
  resolveCodexCommandPath,
  resolveCodexHomeDir,
} from "./constants";

export type GatewayState = "stopped" | "starting" | "running" | "stopping";

interface CodexAppOptions {
  port?: number;
  onStateChange?: (state: GatewayState) => void;
}

interface CodexAppConfig {
  apiKey?: string;
  model?: string;
}

const LOG_PATH = resolveCodexAppLogPath();
const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const CRASH_COOLDOWN_MS = 5_000;

function diagLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { process.stderr.write(line); } catch {}
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeHttp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500;
      resolve(ok);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function probePortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function resolveAvailablePort(startPort: number): Promise<number> {
  for (let candidate = startPort; candidate < startPort + 20; candidate += 1) {
    if (await probePortAvailable(candidate)) {
      return candidate;
    }
  }
  return startPort;
}

function isProcessAlive(child: ChildProcess | null, expectedPid: number): boolean {
  return !!child && child.pid === expectedPid && child.exitCode == null;
}

export class CodexAppProcess {
  private proc: ChildProcess | null = null;
  private state: GatewayState = "stopped";
  private port: number;
  private extraEnv: Record<string, string> = {};
  private onStateChange?: (state: GatewayState) => void;
  private startedAt: number | null = null;
  private generation = 0;
  private lastCrashTime = 0;

  constructor(opts: CodexAppOptions) {
    this.port = opts.port ?? resolveCodexAppPort();
    this.onStateChange = opts.onStateChange;
  }

  getState(): GatewayState {
    return this.state;
  }

  getPort(): number {
    return this.port;
  }

  setPort(port: number): void {
    if (port > 0 && port <= 65535) {
      this.port = port;
    }
  }

  getStartedAt(): number | null {
    return this.startedAt;
  }

  setExtraEnv(env: Record<string, string>): void {
    this.extraEnv = { ...this.extraEnv, ...env };
  }

  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") return;

    if (this.state === "stopping") {
      const deadline = Date.now() + 6_000;
      while (this.state === "stopping" && Date.now() < deadline) {
        await sleep(100);
      }
      if (this.state === "stopping") {
        this.proc = null;
        this.setState("stopped");
      }
    }

    const elapsed = Date.now() - this.lastCrashTime;
    if (this.lastCrashTime > 0 && elapsed < CRASH_COOLDOWN_MS) {
      await sleep(CRASH_COOLDOWN_MS - elapsed);
    }

    const root = resolveCodexAppRoot();
    const entry = path.join(root, "dist-cli", "index.js");
    const command = resolveCodexAppNodeBin();
    this.port = await resolveAvailablePort(this.port);
    const healthUrl = resolveCodexAppUrl(this.port);
    const codexHome = resolveCodexHomeDir();
    const codexCommand = resolveCodexCommandPath();

    if (!fs.existsSync(root)) {
      throw new Error(`codexapp root not found: ${root}`);
    }
    if (!fs.existsSync(entry)) {
      throw new Error(`codexapp CLI entry not found: ${entry}`);
    }

    fs.mkdirSync(codexHome, { recursive: true });
    this.setState("starting");
    const gen = ++this.generation;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEXUI_SANDBOX_MODE: "danger-full-access",
      CODEXUI_APPROVAL_POLICY: "never",
      ...this.extraEnv,
    };
    if (path.isAbsolute(command)) {
      env.PATH = `${path.dirname(command)}${path.delimiter}${process.env.PATH ?? ""}`;
    }
    if (codexCommand) {
      env.CODEXUI_CODEX_COMMAND = codexCommand;
    }

    const args = [
      entry,
      "--port", String(this.port),
      "--no-open",
      "--no-tunnel",
      "--no-login",
      "--no-password",
      "--sandbox-mode", "danger-full-access",
      "--approval-policy", "never",
    ];

    diagLog(`codexapp start: command=${command} cwd=${root}`);
    diagLog(`codexapp args: ${args.join(" ")}`);
    if (codexCommand) {
      diagLog(`codexapp bundled codex: ${codexCommand}`);
    }

    this.proc = spawn(command, args, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const childPid = this.proc.pid ?? -1;

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      try { process.stdout.write(`[codexapp] ${text}`); } catch {}
      diagLog(`stdout: ${text.trimEnd()}`);
    });
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      try { process.stderr.write(`[codexapp] ${text}`); } catch {}
      diagLog(`stderr: ${text.trimEnd()}`);
    });
    this.proc.on("error", (error) => {
      diagLog(`spawn error: ${error.message}`);
    });
    this.proc.on("exit", (code, signal) => {
      diagLog(`exit: code=${code} signal=${signal} gen=${gen} currentGen=${this.generation} state=${this.state}`);
      if (gen !== this.generation) return;
      this.proc = null;
      if (this.state !== "stopping") {
        this.lastCrashTime = Date.now();
      }
      if (this.state === "stopping") {
        this.setState("stopped");
      } else {
        this.setState("stopped");
      }
    });

    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!isProcessAlive(this.proc, childPid)) {
        throw new Error("codexapp exited before becoming ready");
      }
      if (await probeHttp(healthUrl)) {
        this.setState("running");
        return;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    await this.stop();
    throw new Error("codexapp readiness check timed out");
  }

  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "stopping") return;
    this.setState("stopping");
    const child = this.proc;
    if (!child) {
      this.setState("stopped");
      return;
    }

    if (IS_WIN && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!this.proc || child.exitCode != null) {
        this.proc = null;
        this.setState("stopped");
        return;
      }
      await sleep(100);
    }

    if (!IS_WIN && this.proc?.pid) {
      try {
        process.kill(this.proc.pid, "SIGKILL");
      } catch {}
    }
    this.proc = null;
    this.setState("stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async applyConfig(config: CodexAppConfig): Promise<void> {
    await this.start();

    const apiKey = config.apiKey?.trim() ?? "";
    if (apiKey) {
      await this.callRpc("loginApiKey", { apiKey });
    }

    const model = config.model?.trim() ?? "";
    if (model) {
      try {
        await this.callRpc("setDefaultModel", { model });
      } catch (error) {
        diagLog(`setDefaultModel failed: ${String(error)}`);
      }
    }
  }

  async loginWithApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    await this.callRpc("loginApiKey", { apiKey: trimmed });
  }

  private setState(next: GatewayState): void {
    this.state = next;
    if (next === "running") {
      this.startedAt = Date.now();
    } else if (next === "stopped") {
      this.startedAt = null;
    }
    this.onStateChange?.(next);
  }

  private async callRpc(method: string, params: Record<string, unknown>): Promise<void> {
    await this.start();
    const payload = JSON.stringify({ method, params });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `${resolveCodexAppUrl(this.port)}/codex-api/rpc`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8").trim();
            if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
              resolve();
              return;
            }
            reject(new Error(raw || `${method} failed with HTTP ${String(res.statusCode ?? 0)}`));
          });
        },
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}
