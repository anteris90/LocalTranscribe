import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions } from "electron";
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

  const devIconPath = path.resolve(runtimeAppRoot, "build", "icon.png");
  const icon = !app.isPackaged && fs.existsSync(devIconPath) ? devIconPath : undefined;

  const isDev = !app.isPackaged;

  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      devTools: isDev,
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

  if (isDev && process.env.LOCALTRANSCRIBE_DEVTOOLS !== "0") {
    window.webContents.once("did-finish-load", () => {
      try {
        window.webContents.openDevTools({ mode: "detach" });
      } catch {
        // ignore
      }
    });
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

  if (process.platform === "darwin") {
    const bundledBackend = path.resolve(process.resourcesPath, "backend", "backend");
    if (!fs.existsSync(bundledBackend)) {
      throw new Error(`Bundled backend missing at ${bundledBackend}. Ensure packaging includes Resources/backend/backend.`);
    }

    fs.mkdirSync(path.dirname(runtime.backendExecutable), { recursive: true });
    fs.copyFileSync(bundledBackend, runtime.backendExecutable);
    try {
      fs.chmodSync(runtime.backendExecutable, 0o755);
    } catch {
      // best effort, spawn will surface errors if execution still fails
    }

    emitBootstrapState({
      status: "bootstrapping",
      stage: "completed",
      message: "Backend runtime prepared",
      percent: 100,
    });
    return;
  }

  const backendUrl = runtime.backendDownloadUrl;
  if (!backendUrl) {
    throw new Error(`Backend runtime missing at ${runtime.backendExecutable}. Ensure the packaged app includes Resources/backend/backend.`);
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

  // Build a simple application menu with an Edit menu containing a Color Picker
  try {
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin"
        ? ([
            {
              label: app.name,
              submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
            },
          ] as MenuItemConstructorOptions[])
        : []),
      ...(!app.isPackaged
        ? ([
            {
              label: "View",
              submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }],
            },
          ] as MenuItemConstructorOptions[])
        : []),
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { type: "separator" },
          {
            label: "Button color...",
            click: () => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                // Execute a small script in the renderer to show a native color input
                // This avoids IPC/listener issues and works cross-platform.
                try {
                  mainWindow.webContents.executeJavaScript(`(function(){
                    try {
                      if (document.getElementById('lt-color-overlay')) return;
                      const previous = (getComputedStyle(document.documentElement).getPropertyValue('--button-bg') || '').trim() || '#0b2a5a';
                      const overlay = document.createElement('div');
                      overlay.id = 'lt-color-overlay';
                      overlay.style.position = 'fixed';
                      overlay.style.left = '0';
                      overlay.style.top = '0';
                      overlay.style.width = '100%';
                      overlay.style.height = '100%';
                      overlay.style.display = 'flex';
                      overlay.style.alignItems = 'center';
                      overlay.style.justifyContent = 'center';
                      overlay.style.background = 'rgba(0,0,0,0.35)';
                      overlay.style.zIndex = '999999';

                      const box = document.createElement('div');
                      box.style.background = getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#072039';
                      box.style.padding = '18px';
                      box.style.borderRadius = '10px';
                      box.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
                      box.style.display = 'flex';
                      box.style.flexDirection = 'column';
                      box.style.gap = '12px';
                      box.style.alignItems = 'center';

                      const label = document.createElement('div');
                      label.textContent = 'Pick button color';
                      label.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#dbeafe';
                      label.style.fontSize = '14px';

                      const input = document.createElement('input');
                      input.type = 'color';
                      input.value = previous;
                      input.style.width = '64px';
                      input.style.height = '40px';
                      input.style.border = 'none';
                      input.style.cursor = 'pointer';

                      const preview = document.createElement('div');
                      preview.style.width = '120px';
                      preview.style.height = '32px';
                      preview.style.borderRadius = '6px';
                      preview.style.background = previous;
                      preview.style.border = '1px solid rgba(255,255,255,0.06)';

                      const row = document.createElement('div');
                      row.style.display = 'flex';
                      row.style.gap = '12px';

                      const applyBtn = document.createElement('button');
                      applyBtn.textContent = 'Apply';
                      applyBtn.style.padding = '8px 12px';
                      applyBtn.style.cursor = 'pointer';

                      const cancelBtn = document.createElement('button');
                      cancelBtn.textContent = 'Cancel';
                      cancelBtn.style.padding = '8px 12px';
                      cancelBtn.style.cursor = 'pointer';

                      input.addEventListener('input', function(){
                        const val = input.value;
                        preview.style.background = val;
                        try { document.documentElement.style.setProperty('--button-bg', val); } catch {}
                      });

                      applyBtn.addEventListener('click', function(){
                        try { const val = input.value; document.documentElement.style.setProperty('--button-bg', val); window.localStorage.setItem('lt:button-bg', val); } catch {};
                        try { overlay.remove(); } catch {}
                      });

                      cancelBtn.addEventListener('click', function(){
                        try { document.documentElement.style.setProperty('--button-bg', previous); } catch {}
                        try { overlay.remove(); } catch {}
                      });

                      box.appendChild(label);
                      const inner = document.createElement('div'); inner.style.display='flex'; inner.style.gap='12px'; inner.style.alignItems='center'; inner.appendChild(input); inner.appendChild(preview);
                      box.appendChild(inner);
                      row.appendChild(applyBtn); row.appendChild(cancelBtn);
                      box.appendChild(row);
                      overlay.appendChild(box);
                      document.body.appendChild(overlay);
                    } catch (e) { }
                  })()`);
                } catch {
                  // ignore
                }
              }
            },
          },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch {
    // best effort - do not crash if menu creation fails
  }

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
