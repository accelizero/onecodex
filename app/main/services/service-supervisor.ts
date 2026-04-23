import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as path from "path";
import { ServiceSnapshot, StationSettings } from "../domain/contracts";
import { Journal } from "../support/journal";
import { RuntimeLayout } from "./runtime-layout";
import { CodexRpcClient } from "./rpc-client";

const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;
const STOP_TIMEOUT_MS = 5_000;
const PORT_ATTEMPTS = 20;

type SnapshotListener = (snapshot: ServiceSnapshot) => void;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function selectPort(basePort: number): Promise<number> {
  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const candidate = basePort + offset;
    if (await canBind(candidate)) {
      return candidate;
    }
  }
  return basePort;
}

function probe(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(address, (response) => {
      const accepted = (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500;
      response.resume();
      resolve(accepted);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function processAlive(child: ChildProcess | null, pid: number): boolean {
  return !!child && child.pid === pid && child.exitCode == null;
}

export class ServiceSupervisor {
  private child: ChildProcess | null = null;
  private phase: ServiceSnapshot["phase"] = "idle";
  private port: number;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private listeners = new Set<SnapshotListener>();
  private generation = 0;
  private readonly rpc: CodexRpcClient;

  constructor(
    private readonly layout: RuntimeLayout,
    private readonly journal: Journal,
    preferredPort: number,
  ) {
    this.port = preferredPort;
    this.rpc = new CodexRpcClient(() => this.layout.resolveAddress(this.port));
  }

  snapshot(): ServiceSnapshot {
    return {
      phase: this.phase,
      port: this.port,
      address: this.layout.resolveAddress(this.port),
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(settings: StationSettings): Promise<ServiceSnapshot> {
    if (this.phase === "online" || this.phase === "booting") {
      return this.snapshot();
    }

    if (this.phase === "stopping") {
      const deadline = Date.now() + STOP_TIMEOUT_MS;
      while (this.phase === "stopping" && Date.now() < deadline) {
        await wait(100);
      }
    }

    this.layout.ensureStateDirectories();
    this.assertBundle();
    this.port = await selectPort(settings.preferredPort || this.port);
    this.lastError = null;
    this.phase = "booting";
    this.emit();

    const activeGeneration = ++this.generation;
    const child = this.launchProcess();
    this.child = child;
    const pid = child.pid ?? -1;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.journal.info(`stdout ${chunk.toString().trimEnd()}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.journal.error(`stderr ${chunk.toString().trimEnd()}`);
    });
    child.on("error", (error) => {
      this.journal.error(`spawn failed ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (activeGeneration !== this.generation) {
        return;
      }
      this.child = null;
      if (this.phase !== "stopping") {
        this.lastError = `service exited code=${String(code)} signal=${String(signal)}`;
      }
      this.phase = "idle";
      this.startedAt = null;
      this.emit();
    });

    try {
      await this.waitUntilReady(pid);
      await this.rpc.synchronize(settings);
      this.phase = "online";
      this.startedAt = Date.now();
      this.emit();
      return this.snapshot();
    } catch (error) {
      this.lastError = String(error);
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<ServiceSnapshot> {
    if (this.phase === "idle") {
      return this.snapshot();
    }

    this.phase = "stopping";
    this.emit();
    const child = this.child;
    if (!child) {
      this.phase = "idle";
      this.startedAt = null;
      this.emit();
      return this.snapshot();
    }

    await this.terminate(child);
    this.child = null;
    this.phase = "idle";
    this.startedAt = null;
    this.emit();
    return this.snapshot();
  }

  async restart(settings: StationSettings): Promise<ServiceSnapshot> {
    await this.stop();
    return this.start(settings);
  }

  async synchronize(settings: StationSettings): Promise<ServiceSnapshot> {
    if (this.phase !== "online") {
      return this.snapshot();
    }
    await this.rpc.synchronize(settings);
    return this.snapshot();
  }

  private emit(): void {
    const current = this.snapshot();
    for (const listener of this.listeners) {
      listener(current);
    }
  }

  private assertBundle(): void {
    if (!fs.existsSync(this.layout.resolveServiceRoot())) {
      throw new Error(`service bundle not found at ${this.layout.resolveServiceRoot()}`);
    }
    if (!fs.existsSync(this.layout.resolveServiceEntry())) {
      throw new Error(`service entry not found at ${this.layout.resolveServiceEntry()}`);
    }
  }

  private launchProcess(): ChildProcess {
    const command = this.layout.resolveNodeBinary();
    const entry = this.layout.resolveServiceEntry();
    const embeddedCodex = this.layout.resolveBundledCodex();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_HOME: this.layout.resolveCodexHome(),
      CODEXUI_SANDBOX_MODE: "danger-full-access",
      CODEXUI_APPROVAL_POLICY: "never",
    };

    if (path.isAbsolute(command)) {
      env.PATH = `${path.dirname(command)}${path.delimiter}${process.env.PATH ?? ""}`;
    }
    if (embeddedCodex) {
      env.CODEXUI_CODEX_COMMAND = embeddedCodex;
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

    this.journal.info(`launch ${command} ${args.join(" ")}`);
    return spawn(command, args, {
      cwd: this.layout.resolveServiceRoot(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  }

  private async waitUntilReady(pid: number): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!processAlive(this.child, pid)) {
        throw new Error("service terminated before ready");
      }
      if (await probe(this.layout.resolveAddress(this.port))) {
        return;
      }
      await wait(POLL_INTERVAL_MS);
    }
    throw new Error("service readiness timed out");
  }

  private async terminate(child: ChildProcess): Promise<void> {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }

    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.child || child.exitCode != null) {
        return;
      }
      await wait(100);
    }

    if (process.platform !== "win32" && this.child?.pid) {
      try {
        process.kill(this.child.pid, "SIGKILL");
      } catch {}
    }
  }
}
