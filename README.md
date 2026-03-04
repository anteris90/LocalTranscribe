# LocalTranscribe

Local desktop transcription app (Electron + Python backend) with model/ffmpeg on-demand downloads.

## Local setup

### Windows

`./scripts/bootstrap.ps1`

### macOS/Linux

`./scripts/bootstrap.sh` 

## Build commands

- Frontend build: `npm run build:frontend`
- Electron build: `npm run build:electron`
- Windows package: `npm --workspace electron run dist`

For detailed release/testing steps, see `BUILD_Info.md`.

## Default distribution mode (thin installer)

Windows installer is now **thin by default**:

- Installer contains app shell only.
- Backend runtime is downloaded on first run.
- Models and ffmpeg are downloaded on demand from the app flow.

Backend download URL pattern used by default:

- `https://github.com/LocalTranscribe/LocalTranscribe/releases/download/v<app-version>/backend-win-x64.exe`

Override source URL (testing or custom hosting):

- `LOCALTRANSCRIBE_BACKEND_URL=<url>`

## How to publish backend artifact for release

1. Build backend bootstrap artifact:

`npm run build:backend:onefile`

2. Upload artifact to matching GitHub Release tag:

`npm run release:upload-backend`

This uploads `backend/dist/windows/backend.exe` as `backend-win-x64.exe`.

## Fast local test (without full rebuild)

Run thin-installer bootstrap test using local HTTP served backend artifact:

`npm run test:thin-local`

What this does:

- Uses existing `dist/packages/win-unpacked/LocalTranscribe.exe`
- Serves local `backend.exe` as `backend-win-x64.exe`
- Sets `LOCALTRANSCRIBE_BACKEND_URL` to local server
- Optionally clears runtime cache before launch

## Notes

- If first-run bootstrap fails, app shows explicit bootstrap error in UI.
- If update check reports "Method not found", backend/runtime and UI versions are mismatched; install latest package.
- If packaging fails due locked files, close running LocalTranscribe/electron processes and retry.
