# Build Info

## Default Packaging Model

LocalTranscribe now uses a **thin installer by default** on Windows:

- Installer ships app shell only.
- Backend runtime is downloaded on first run.
- ffmpeg and models are downloaded on demand from app flow.

This is the canonical build/release flow for the current project state.

## Prerequisites

- Windows PowerShell
- Python 3.11+
- Node.js + npm
- GitHub CLI (`gh`) for release asset upload

## Local Bootstrap

- Windows:

`./scripts/bootstrap.ps1`

- macOS/Linux:

`./scripts/bootstrap.sh`

## Build Commands

- Build frontend:

`npm run build:frontend`

- Build electron main/preload:

`npm run build:electron`

- Build Windows installer (NSIS):

`npm --workspace electron run dist`

Installer output:

- `dist/packages/LocalTranscribe-<version>-win-x64.exe`

## Backend Bootstrap Artifact (for thin installer)

The thin installer expects a downloadable backend artifact named:

- `backend-win-x64.exe`

Build it locally:

`npm run build:backend:onefile`

Resulting artifact:

- `backend/dist/windows/backend.exe`

## Release Upload Workflow

Upload backend artifact to the matching GitHub release tag:

`npm run release:upload-backend`

This uploads:

- local file: `backend/dist/windows/backend.exe`
- release asset name: `backend-win-x64.exe`

Default repo/tag behavior comes from script defaults and project version.

## Runtime Bootstrap URL

By default, packaged app resolves backend from:

`https://github.com/LocalTranscribe/LocalTranscribe/releases/download/v<app-version>/backend-win-x64.exe`

Override for custom hosting/testing:

- env var: `LOCALTRANSCRIBE_BACKEND_URL`

## Fast Local Thin-Installer Test (No Full Rebuild)

Run app against locally served backend artifact:

`npm run test:thin-local`

Simple wrapper scripts (no manual command typing):

- PowerShell: `./test_scripts/local_test.ps1`
- Double-click/CLI (Windows): `./test_scripts/local_test.cmd`
- macOS/Linux shell: `./test_scripts/local_test.sh`

If shell scripts are not executable after clone on macOS/Linux:

`npm run fix:unix-exec`

What it does:

- Uses existing `dist/packages/win-unpacked/LocalTranscribe.exe`
- Serves local backend artifact over `http://127.0.0.1:<port>/backend-win-x64.exe`
- Sets `LOCALTRANSCRIBE_BACKEND_URL` for that run
- Optionally resets runtime cache for clean bootstrap test

## Troubleshooting

- If app shows backend bootstrap failure, verify release asset exists and URL is reachable.
- If update check says `Method not found`, UI/runtime versions are mismatched; reinstall latest package.
- If packaging fails with locked files, close running LocalTranscribe/electron processes and retry.
