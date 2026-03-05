import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(electronRoot, "..");

function ensureFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Missing required directory: ${dirPath}`);
  }
}

if (process.platform === "darwin") {
  const backendBinary = path.resolve(projectRoot, "backend", "dist", "macos-arm64", "backend");
  const ffmpegDir = path.resolve(projectRoot, "bin", "macos-arm64");
  const ffmpegBinary = path.resolve(ffmpegDir, "ffmpeg");

  ensureFile(backendBinary);
  ensureDir(ffmpegDir);
  ensureFile(ffmpegBinary);

  console.log(`[verify-release-inputs] macOS inputs OK`);
  console.log(`[verify-release-inputs] backend: ${backendBinary}`);
  console.log(`[verify-release-inputs] ffmpeg: ${ffmpegBinary}`);
} else {
  console.log("[verify-release-inputs] No platform-specific checks required for this host platform");
}
