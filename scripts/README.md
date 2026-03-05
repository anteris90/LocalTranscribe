# Scripts

- `bootstrap.ps1`: Windows local setup for Node workspaces and backend `.venv`.
- `bootstrap.sh`: macOS/Linux local setup for Node workspaces and backend `.venv`.
- `build-backend-onefile.ps1`: Builds `backend/dist/windows/backend.exe` for thin-installer bootstrap.
- `build-backend-onefile-macos.sh`: Builds `backend/dist/macos-arm64/backend` for macOS DMG packaging.
- `prepare-macos-runtime.sh`: Copies local `ffmpeg` (and optional `ffprobe`) into `bin/macos-arm64` for macOS packaging.
- `upload-backend-release.ps1`: Uploads `backend-win-x64.exe` artifact to the matching GitHub Release tag.
- `test-thin-installer-local.ps1`: Local test for thin installer without full rebuild by serving backend artifact over local HTTP.
- `test-thin-installer-local.sh`: macOS/Linux local test wrapper for thin installer bootstrap (uses `LOCALTRANSCRIBE_BACKEND_URL`).
- `fix-unix-exec.sh`: Sets executable permissions on `scripts/*.sh` and `test_scripts/*.sh` after clone.

These scripts install dependencies only into local project directories.

## Thin-installer workflow (Windows)

1. Build backend onefile artifact:

`./scripts/build-backend-onefile.ps1`

2. Upload artifact to GitHub Release (defaults to repo `LocalTranscribe/LocalTranscribe` and tag from `package.json` version):

`./scripts/upload-backend-release.ps1 -BuildIfMissing`

3. Local bootstrap test without full app rebuild:

`./scripts/test-thin-installer-local.ps1 -ResetRuntime`

macOS/Linux equivalent:

`./scripts/test-thin-installer-local.sh`

## macOS DMG workflow

Build a complete macOS DMG with bundled backend + ffmpeg:

`npm run release:mac`

If shell scripts are not executable:

`npm run fix:unix-exec`
