import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import * as os from "node:os";
import { URL } from "node:url";

import { BackendBridge } from "./backendBridge";
import { resolveRuntimePaths, type RuntimePaths } from "./runtimePaths";

let mainWindow: BrowserWindow | null = null;
let backendBridge: BackendBridge | null = null;

// Synchronous early marker to detect if the Electron main module loads at all.
try {
  const tmpDir = os.tmpdir();
  const marker = path.resolve(tmpDir, `localtranscribe_module_loaded_${process.pid}.txt`);
  fs.writeFileSync(marker, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid }), { encoding: "utf8" });
} catch {
  // best-effort, do not throw
}

function getOpenWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows();
}

function createMainWindow(runtimeAppRoot: string): BrowserWindow {
  const preloadPath = path.resolve(__dirname, "..", "preload", "index.js");

  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  const devRendererUrl = process.env.LOCALTRANSCRIBE_RENDERER_URL;
  if (devRendererUrl) {
    void window.loadURL(devRendererUrl);
  } else {
    const rendererHtml = app.isPackaged
      ? path.resolve(process.resourcesPath, "frontend", "dist", "index.html")
      : path.resolve(runtimeAppRoot, "frontend", "dist", "index.html");
    void window.loadFile(rendererHtml);
  }

  return window;
}

function registerIpcHandlers(): void {
  ipcMain.handle("backend:request", async (_event, payload: { method: string; params?: Record<string, unknown> }) => {
    if (!payload || typeof payload.method !== "string" || payload.method.length === 0) {
      throw new Error("Invalid backend request payload");
    }

    // If the renderer calls very early, the bridge may not be constructed yet.
    // Wait a short period for bootstrap to finish to avoid a spurious error.
    const waitForBridge = async (timeoutMs = 120000) => {
      const start = Date.now();
      while (!backendBridge) {
        if (Date.now() - start > timeoutMs) {
          return false;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return true;
    };

    const available = await waitForBridge(120000);
    if (!available || !backendBridge) {
      if (payload.method === "get_job_status") {
        return { job: null };
      }
      throw new Error("Backend bridge unavailable");
    }

    return await backendBridge.request(payload.method, payload.params ?? {});
  });

  ipcMain.handle(
    "export:saveFile",
    async (
      event,
      payload: { suggestedName: string; extension: "txt" | "srt" | "json"; content: string }
    ): Promise<{ canceled: boolean; savedPath?: string }> => {
      if (!payload || typeof payload.suggestedName !== "string" || payload.suggestedName.trim().length === 0) {
        throw new Error("Invalid save payload: suggestedName");
      }
      if (!payload || typeof payload.content !== "string") {
        throw new Error("Invalid save payload: content");
      }
      if (!payload || !["txt", "srt", "json"].includes(payload.extension)) {
        throw new Error("Invalid save payload: extension");
      }

      const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
      const safeSuggestedName = path.basename(payload.suggestedName);
      const saveDialogOptions = {
        title: "Export Transcript",
        defaultPath: safeSuggestedName,
        filters: [
          {
            name: payload.extension.toUpperCase(),
            extensions: [payload.extension],
          },
        ],
      };
      const result = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions);

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const savePath = path.resolve(result.filePath);
      if (!path.isAbsolute(savePath)) {
        throw new Error("Export path must be absolute");
      }

      fs.writeFileSync(savePath, payload.content, { encoding: "utf8" });
      return { canceled: false, savedPath: savePath };
    }
  );
}

function emitBootstrapState(payload: Record<string, unknown>): void {
  for (const win of getOpenWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("backend:state", payload);
    }
  }
}

function downloadFile(url: string, destinationPath: string, onProgress: (percent: number, downloaded: number, total: number | null) => void, redirectCount = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : parsed.protocol === "https:" ? https : null;

    if (!client) {
      reject(new Error(`Unsupported backend download protocol: ${parsed.protocol}`));
      return;
    }

    const request = client.get(parsed, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && typeof location === "string") {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error("Too many redirects while downloading backend"));
          return;
        }
        const nextUrl = new URL(location, parsed).toString();
        void downloadFile(nextUrl, destinationPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with status ${statusCode}`));
        return;
      }

      const totalHeader = response.headers["content-length"];
      const totalBytes = typeof totalHeader === "string" ? Number.parseInt(totalHeader, 10) : NaN;
      const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;

      const tempPath = `${destinationPath}.download`;
      const stream = fs.createWriteStream(tempPath, { flags: "w" });
      let downloaded = 0;
      let lastPercent = -1;

      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total !== null) {
          const percent = Math.min(100, Math.max(1, Math.floor((downloaded / total) * 100)));
          if (percent !== lastPercent) {
            lastPercent = percent;
            onProgress(percent, downloaded, total);
          }
        } else if (downloaded % (8 * 1024 * 1024) < chunk.length) {
          onProgress(0, downloaded, null);
        }
      });

      response.pipe(stream);

      stream.on("finish", () => {
        stream.close();
        fs.renameSync(tempPath, destinationPath);
        onProgress(100, downloaded, total);
        resolve();
      });

      stream.on("error", (error) => {
        stream.close();
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          // ignore cleanup errors
        }
        reject(error);
      });
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}

async function ensurePackagedBackend(runtime: RuntimePaths): Promise<void> {
  if (!app.isPackaged) {
    return;
  }

  if (fs.existsSync(runtime.backendExecutable)) {
    return;
  }

  const backendUrl = runtime.backendDownloadUrl;
  if (!backendUrl) {
    throw new Error("Backend runtime missing. Configure LOCALTRANSCRIBE_BACKEND_URL to a downloadable backend executable URL.");
  }

  fs.mkdirSync(path.dirname(runtime.backendExecutable), { recursive: true });

  emitBootstrapState({
    status: "bootstrapping",
    stage: "preparing",
    message: "Preparing backend runtime download...",
    percent: 1,
  });

  try {
    await downloadFile(
      backendUrl,
      runtime.backendExecutable,
      (percent, downloaded, total) => {
        const message = total
          ? `Downloading backend runtime (${percent}%)`
          : `Downloading backend runtime (${Math.floor(downloaded / (1024 * 1024))} MB)`;
        emitBootstrapState({
          status: "bootstrapping",
          stage: "downloading",
          message,
          percent,
        });

        if (process.platform !== "win32") {
          try {
            fs.chmodSync(runtime.backendExecutable, 0o755);
          } catch {
            // handled by startup failure if backend cannot execute
          }
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown download error";
    throw new Error(`Failed to download backend runtime from ${backendUrl}: ${message}`);
  }

  emitBootstrapState({
    status: "bootstrapping",
    stage: "completed",
    message: "Backend runtime download completed",
    percent: 100,
  });
}

async function bootstrapMain(): Promise<void> {
  await app.whenReady();

  // Write a small startup marker so we can detect whether bootstrap began.
  try {
    const outDir = app.getPath("userData");
    const outPath = path.resolve(outDir, "bootstrap_started.json");
    const startupInfo = {
      ts: new Date().toISOString(),
      pid: process.pid,
      argv: process.argv,
      env: {
        LOCALTRANSCRIBE_BACKEND_URL: process.env.LOCALTRANSCRIBE_BACKEND_URL ?? null,
      },
    };
    fs.writeFileSync(outPath, JSON.stringify(startupInfo, null, 2), { encoding: "utf8" });
  } catch {
    // best effort
  }

  const runtime = resolveRuntimePaths();

  registerIpcHandlers();

  mainWindow = createMainWindow(runtime.appRoot);

  try {
    await ensurePackagedBackend(runtime);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown bootstrap error";
    emitBootstrapState({
      status: "bootstrapping_failed",
      message,
    });
    return;
  }

  backendBridge = new BackendBridge(runtime, getOpenWindows);
  backendBridge.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(runtime.appRoot);
    }
  });
}

void bootstrapMain().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown bootstrap error";
  const details = {
    source: "electron-main",
    event: "bootstrap_failure",
    ts: new Date().toISOString(),
    message,
    stack: error instanceof Error ? error.stack : null,
  };

  process.stderr.write(`${JSON.stringify(details)}\n`);

  try {
    const outDir = app.getPath("userData");
    const outPath = path.resolve(outDir, "bootstrap_failure.json");
    fs.writeFileSync(outPath, JSON.stringify(details, null, 2), { encoding: "utf8" });
  } catch {
    // best effort, do not crash on logging failure
  }

  app.exit(1);
});

app.on("window-all-closed", () => {
  backendBridge?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
