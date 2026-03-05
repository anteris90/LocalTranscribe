import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export type RuntimePaths = {
  appRoot: string;
  modelsDir: string;
  ffmpegDir: string;
  dataDir: string;
  backendExecutable: string;
  backendArgs: string[];
  backendDownloadUrl?: string;
  pythonPathEnv?: string;
};

function existsFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function existsDir(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function resolveDevPythonExecutable(projectRoot: string): string {
  const windowsPython = path.resolve(projectRoot, "backend", ".venv", "Scripts", "python.exe");
  const posixPython = path.resolve(projectRoot, "backend", ".venv", "bin", "python");

  if (process.platform === "win32") {
    return windowsPython;
  }
  return posixPython;
}

export function resolveRuntimePaths(): RuntimePaths {
  const appPath = path.resolve(app.getAppPath());
  const resourcesPath = path.resolve(process.resourcesPath);

  if (app.isPackaged) {
    const appRoot = resourcesPath;
    const runtimeRoot = path.resolve(app.getPath("userData"), "runtime");
    const modelsDir = path.resolve(runtimeRoot, "models");
    const ffmpegDir =
      process.platform === "win32"
        ? path.resolve(runtimeRoot, "ffmpeg")
        : path.resolve(resourcesPath, "ffmpeg");
    const dataDir = path.resolve(runtimeRoot, "data");
    const backendDir =
      process.platform === "win32"
        ? path.resolve(runtimeRoot, "backend")
        : path.resolve(resourcesPath, "backend");
    const backendExecutable =
      process.platform === "win32"
        ? path.resolve(backendDir, "backend.exe")
        : path.resolve(backendDir, "backend");

    const defaultBackendUrl =
      process.platform === "win32"
        ? `https://github.com/LocalTranscribe/LocalTranscribe/releases/download/v${app.getVersion()}/backend-win-x64.exe`
        : undefined;

    const backendDownloadUrl = process.env.LOCALTRANSCRIBE_BACKEND_URL ?? defaultBackendUrl;

    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });
    if (process.platform === "win32") {
      fs.mkdirSync(ffmpegDir, { recursive: true });
      fs.mkdirSync(backendDir, { recursive: true });
    }
    fs.mkdirSync(dataDir, { recursive: true });

    return {
      appRoot,
      modelsDir,
      ffmpegDir,
      dataDir,
      backendExecutable,
      backendArgs: [],
      backendDownloadUrl,
    };
  }

  const projectRoot = path.resolve(appPath, "..");
  const appRoot = projectRoot;
  const modelsDir = path.resolve(projectRoot, "models");
  const ffmpegDir =
    process.platform === "win32"
      ? path.resolve(projectRoot, "bin", "windows-x64")
      : path.resolve(projectRoot, "bin", "macos-arm64");
  const dataDir = path.resolve(projectRoot, "dist");

  const pythonExecutable = resolveDevPythonExecutable(projectRoot);
  const backendMainScript = path.resolve(projectRoot, "backend", "app", "main.py");

  if (!existsFile(pythonExecutable)) {
    throw new Error(
      JSON.stringify({
        code: "python_missing",
        message: "Local backend venv python executable not found",
        pythonExecutable,
      })
    );
  }

  if (!existsFile(backendMainScript)) {
    throw new Error(
      JSON.stringify({
        code: "backend_script_missing",
        message: "Backend main script not found",
        backendMainScript,
      })
    );
  }

  for (const [label, dirPath] of [
    ["modelsDir", modelsDir],
    ["ffmpegDir", ffmpegDir],
  ] as const) {
    if (!existsDir(dirPath)) {
      throw new Error(
        JSON.stringify({
          code: "runtime_dir_missing",
          message: `Required runtime directory not found: ${label}`,
          path: dirPath,
        })
      );
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });

  return {
    appRoot,
    modelsDir,
    ffmpegDir,
    dataDir,
    backendExecutable: pythonExecutable,
    backendArgs: [backendMainScript],
    pythonPathEnv: path.resolve(projectRoot, "backend"),
  };
}
