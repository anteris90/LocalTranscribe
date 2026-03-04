import { BrowserWindow } from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

import { RuntimePaths } from "./runtimePaths";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type PendingRequest = {
  method: string;
  startedAt: number;
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

type BridgeState = "stopped" | "starting" | "running";

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 4000;
const START_TRANSCRIPTION_TIMEOUT_MS = 20 * 60 * 1000;
const RESTART_WINDOW_MS = 60000;
const MAX_RESTARTS_IN_WINDOW = 3;

export class BackendBridge {
  private readonly runtime: RuntimePaths;
  private readonly windowsProvider: () => BrowserWindow[];
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private state: BridgeState = "stopped";
  private requestId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatInFlight = false;
  private lastHeartbeatOkAt = 0;
  private restartTimestamps: number[] = [];
  private isRestarting = false;

  constructor(runtime: RuntimePaths, windowsProvider: () => BrowserWindow[]) {
    this.runtime = runtime;
    this.windowsProvider = windowsProvider;
  }

  public start(): void {
    if (this.state === "starting" || this.state === "running") {
      return;
    }

    this.state = "starting";
    this.spawnBackendProcess();
  }

  public stop(): void {
    this.state = "stopped";

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.clearPending(new Error("Backend bridge stopped"));

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.child && !this.child.killed) {
      this.child.kill();
    }

    this.child = null;
  }

  public async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.state !== "running" || !this.child) {
      throw new Error("Backend is not running");
    }

    const id = this.requestId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const serialized = JSON.stringify(payload);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeoutMs = method === "ping"
        ? HEARTBEAT_TIMEOUT_MS
        : method === "start_transcription"
          ? START_TRANSCRIPTION_TIMEOUT_MS
          : 30000;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Backend request timeout for method: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        method,
        startedAt: Date.now(),
        resolve,
        reject,
        timeout,
      });
      this.child?.stdin.write(`${serialized}\n`);
    });
  }

  private spawnBackendProcess(): void {
    const resolvedAppRoot = path.resolve(this.runtime.appRoot);
    const resolvedModelsDir = path.resolve(this.runtime.modelsDir);
    const resolvedFfmpegDir = path.resolve(this.runtime.ffmpegDir);
    const resolvedDataDir = path.resolve(this.runtime.dataDir);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LT_APP_ROOT: resolvedAppRoot,
      LT_MODELS_DIR: resolvedModelsDir,
      LT_FFMPEG_DIR: resolvedFfmpegDir,
      LT_DATA_DIR: resolvedDataDir,
    };

    if (this.runtime.pythonPathEnv) {
      env.PYTHONPATH = this.runtime.pythonPathEnv;
    }

    this.logStructured("backend_spawn_env", {
      LT_APP_ROOT: resolvedAppRoot,
      LT_MODELS_DIR: resolvedModelsDir,
      LT_FFMPEG_DIR: resolvedFfmpegDir,
      LT_DATA_DIR: resolvedDataDir,
      backendExecutable: this.runtime.backendExecutable,
      backendArgs: this.runtime.backendArgs,
    });

    this.child = spawn(this.runtime.backendExecutable, this.runtime.backendArgs, {
      stdio: "pipe",
      env,
      windowsHide: true,
    });

    this.attachProcessListeners();
  }

  private attachProcessListeners(): void {
    const child = this.child;
    if (!child) {
      return;
    }

    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on("line", (line) => this.handleStdoutLine(line));

    child.stderr.on("data", (chunk) => {
      const message = chunk.toString();
      this.emitRendererEvent("backend:error", {
        type: "backend_stderr",
        message,
      });
      this.logStructured("backend_stderr", { message });
    });

    child.once("spawn", () => {
      this.state = "running";
      this.lastHeartbeatOkAt = Date.now();
      this.startHeartbeat();
      this.emitRendererEvent("backend:state", {
        status: "running",
      });
      this.logStructured("backend_spawned", {
        pid: child.pid,
        executable: this.runtime.backendExecutable,
      });
    });

    child.once("error", (error) => {
      this.handleBackendCrash("spawn_error", {
        message: error.message,
      });
    });

    child.once("exit", (code, signal) => {
      this.handleBackendCrash("process_exit", {
        code,
        signal,
      });
    });
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.emitRendererEvent("backend:error", {
        type: "invalid_json_from_backend",
        line,
      });
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const payload = parsed as Partial<JsonRpcResponse & JsonRpcNotification>;

    if (Object.prototype.hasOwnProperty.call(payload, "id")) {
      const id = payload.id as string | number | null;
      if (id === null || id === undefined) {
        return;
      }
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(id);

      if (payload.error) {
        pending.reject(new Error(payload.error.message));
        return;
      }

      pending.resolve((payload.result as Record<string, unknown>) ?? {});
      return;
    }

    if (typeof payload.method === "string") {
      this.emitRendererEvent("backend:notification", {
        method: payload.method,
        params: payload.params ?? {},
      });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      if (this.state !== "running") {
        return;
      }

      const hasNonPingRequestInFlight = Array.from(this.pending.values()).some((pending) => pending.method !== "ping");
      if (hasNonPingRequestInFlight) {
        this.lastHeartbeatOkAt = Date.now();
        return;
      }

      if (this.heartbeatInFlight) {
        const elapsed = Date.now() - this.lastHeartbeatOkAt;
        if (elapsed > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
          this.handleBackendUnresponsive(elapsed);
        }
        return;
      }

      this.heartbeatInFlight = true;
      try {
        await this.request("ping", {});
        this.lastHeartbeatOkAt = Date.now();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown heartbeat failure";
        this.handleBackendUnresponsive(0, message);
      } finally {
        this.heartbeatInFlight = false;
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private handleBackendUnresponsive(elapsedMs: number, detail?: string): void {
    this.emitRendererEvent("backend:error", {
      type: "backend_unresponsive",
      elapsedMs,
      detail: detail ?? null,
    });
    this.logStructured("backend_unresponsive", { elapsedMs, detail: detail ?? null });

    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }

  private handleBackendCrash(reason: string, details: Record<string, unknown>): void {
    if (this.state === "stopped") {
      return;
    }

    this.state = "stopped";

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    this.clearPending(new Error(`Backend crashed: ${reason}`));

    this.emitRendererEvent("backend:error", {
      type: "backend_crash",
      reason,
      details,
    });
    this.logStructured("backend_crash", { reason, details });

    this.tryRestart(reason, details);
  }

  private tryRestart(reason: string, details: Record<string, unknown>): void {
    if (this.isRestarting) {
      return;
    }

    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((ts) => now - ts <= RESTART_WINDOW_MS);

    if (this.restartTimestamps.length >= MAX_RESTARTS_IN_WINDOW) {
      this.emitRendererEvent("backend:error", {
        type: "backend_restart_exhausted",
        reason,
        details,
        maxRestarts: MAX_RESTARTS_IN_WINDOW,
        windowMs: RESTART_WINDOW_MS,
      });
      this.logStructured("backend_restart_exhausted", {
        reason,
        details,
        maxRestarts: MAX_RESTARTS_IN_WINDOW,
      });
      return;
    }

    this.isRestarting = true;
    this.restartTimestamps.push(now);

    setTimeout(() => {
      this.isRestarting = false;
      this.emitRendererEvent("backend:state", {
        status: "restarting",
        attempt: this.restartTimestamps.length,
      });
      this.logStructured("backend_restarting", {
        attempt: this.restartTimestamps.length,
        reason,
      });
      this.start();
    }, 1000);
  }

  private clearPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitRendererEvent(channel: "backend:notification" | "backend:error" | "backend:state", payload: Record<string, unknown>): void {
    for (const win of this.windowsProvider()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  private logStructured(event: string, payload: Record<string, unknown>): void {
    const log = {
      source: "electron-main",
      event,
      ts: new Date().toISOString(),
      ...payload,
    };
    process.stdout.write(`${JSON.stringify(log)}\n`);
  }
}
