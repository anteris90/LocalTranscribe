# Release Publishing Playbook (Agent Reference)

This document is a **repeatable checklist** for publishing a LocalTranscribe release.

It is written for agents (and humans) so that when someone says “make a release”, the process is predictable:

- Build installers for supported platforms
- Upload installers + required runtime artifacts to the GitHub Release
- Prefer a CI matrix build for cross-platform outputs

## Quick Summary

- **Version source of truth:** root [package.json](package.json) `version` (also mirrored in [electron/package.json](electron/package.json) and [frontend/package.json](frontend/package.json)).
- **Release tag format:** `vX.Y.Z` (example: `v0.1.1`).
- **Windows thin-installer requires a backend asset:** `backend-win-x64.exe` attached to the release.
- **Electron installer outputs:** `dist/packages/` (see [BUILD_Info.md](BUILD_Info.md)).

## Preconditions

- You have push access to `origin`.
- You are on a clean working tree.
- You are authenticated with GitHub CLI:
  - `gh auth status`

## Step 1 — Pick Version and Update Versions

1. Decide the next version number (example: `0.1.2`).
2. Update versions:
   - [package.json](package.json)
   - [electron/package.json](electron/package.json)
   - [frontend/package.json](frontend/package.json)
   - [package-lock.json](package-lock.json) (workspace versions)

Notes:
- The backend also has a version in [backend/pyproject.toml](backend/pyproject.toml), but the **packaged app and release tag** currently follow the root `package.json` version.

## Step 2 — Build Artifacts

### 2A) Windows (thin installer)

Prereqs: run `./scripts/bootstrap.ps1` at least once.

1. Build frontend + electron:
   - `npm run build:frontend`
   - `npm run build:electron`

2. Build Windows installer (NSIS):
   - `npm --workspace electron run dist`

Expected output (example):
- `dist/packages/LocalTranscribe-<version>-win-x64.exe`

3. Build backend onefile runtime (required for thin-installer bootstrap):
   - `npm run build:backend:onefile`

Expected output:
- local file: `backend/dist/windows/backend.exe`

Release asset name required by the app:
- `backend-win-x64.exe`

(Upload step is in Step 4.)

### 2B) macOS (current config: DMG arm64)

Electron-builder config is in [electron/electron-builder.json](electron/electron-builder.json).

It expects these inputs **on the macOS runner**:
- Backend binary at `backend/dist/macos-arm64/backend`
- ffmpeg bundle at `bin/macos-arm64/`

Then run:
- `npm run build:frontend`
- `npm --workspace electron run dist`

Expected output (example):
- `dist/packages/LocalTranscribe-<version>-mac-arm64.dmg`

Important:
- Building macOS artifacts generally requires macOS (or a CI macOS runner).

### 2C) Linux

No Linux target is defined in [electron/electron-builder.json](electron/electron-builder.json) today.

If/when Linux packaging is added (AppImage/deb/rpm), include those resulting artifacts in the Release upload step.

## Step 3 — Commit, Merge to main

1. Ensure changes are committed on a branch.
2. Merge into `main`.
3. Push `main` to origin.

Agents should prefer:
- `git checkout main`
- `git pull origin main`
- merge the release branch
- `git push origin main`

## Step 4 — Tag and Create GitHub Release

From `main`:

1. Create an annotated tag and push it:

- `git tag -a vX.Y.Z -m "vX.Y.Z"`
- `git push origin vX.Y.Z`

2. Create the GitHub release:

- `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file docs/release-notes-template.md`

Release notes template:
- [docs/release-notes-template.md](docs/release-notes-template.md)

## Step 5 — Upload Release Assets (Installers + Runtime Artifacts)

### 5A) Upload Windows backend runtime (thin installer)

This repo ships a helper that uploads:
- local: `backend/dist/windows/backend.exe`
- release asset name: `backend-win-x64.exe`

Command:
- `npm run release:upload-backend`

(Under the hood it runs [scripts/upload-backend-release.ps1](scripts/upload-backend-release.ps1).)

### 5B) Upload installers

Upload the Electron-builder outputs from `dist/packages/`:

- Windows installer: `LocalTranscribe-<version>-win-x64.exe`
- macOS DMG: `LocalTranscribe-<version>-mac-arm64.dmg`

Example:
- `gh release upload vX.Y.Z "dist/packages/LocalTranscribe-<version>-win-x64.exe" --clobber`
- `gh release upload vX.Y.Z "dist/packages/LocalTranscribe-<version>-mac-arm64.dmg" --clobber`

## Recommended: CI Matrix Builds for “All Platforms”

On Windows, you cannot reliably build macOS DMGs. To publish **all platforms**, use a GitHub Actions workflow with a matrix:

- `windows-latest` → build Windows installer + backend runtime asset
- `macos-latest` → build macOS DMG (+ backend binary if needed)
- `ubuntu-latest` → (future) build Linux artifacts

High-level workflow idea:

1. Trigger on tag `v*.*.*`.
2. Build artifacts per OS.
3. Upload artifacts to the GitHub Release.

If you want this automated, add a workflow under `.github/workflows/release.yml`.

## Agent Rule: Build Only for Current Platform

When the request is "build and upload", agents must **only build artifacts that are feasible on the current machine OS**:

- On **Windows**: build/upload Windows artifacts only (e.g. `LocalTranscribe-<version>-win-x64.exe`, `backend-win-x64.exe`).
- On **macOS**: build/upload macOS artifacts only (e.g. `LocalTranscribe-<version>-mac-arm64.dmg`).

Do **not** loop attempting cross-platform builds locally (Windows cannot produce a signed/valid DMG reliably; macOS cannot produce a Windows NSIS installer reliably).

If the user wants "all platforms":
- Use the CI workflow (preferred), or
- Ask the user to run the other platform build on the appropriate OS and upload that asset to the same GitHub Release.

This repo includes a workflow at:
- [.github/workflows/release.yml](.github/workflows/release.yml)

Behavior:
- Triggers on tags like `vX.Y.Z`
- Ensures the GitHub Release exists
- Builds Windows NSIS installer + `backend-win-x64.exe` and uploads them
- Builds macOS arm64 DMG and uploads it

## Troubleshooting

### Hungarian / non-ASCII transcript crashes on Windows

If you see `UnicodeEncodeError` with characters like `\u0151` (ő), that is a **stdout encoding** problem.

Fix is to write ASCII-safe JSON over JSON-RPC (escape non-ASCII). See:
- [backend/app/api/jsonrpc.py](backend/app/api/jsonrpc.py)

### “Backend runtime missing” on first run

The packaged app downloads the backend runtime on Windows using the release asset:
- `backend-win-x64.exe`

If missing, first-run bootstrap fails. Confirm:
- The GitHub Release tag exists
- The asset is attached and downloadable

See [BUILD_Info.md](BUILD_Info.md) for details.
