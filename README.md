# LocalTranscribe

LocalTranscribe is a cross-platform desktop application for fully offline audio and video transcription. It pairs an Electron + React frontend with a Python backend to run Whisper-style models locally (CPU/GPU) and export transcripts in common formats.

**Key features**
- Fully offline transcription using locally stored models
- On-demand downloads for backend runtime, models, and `ffmpeg` (thin-installer mode)
- Device selector: CPU / GPU (CUDA on Windows, MPS on macOS) when available
- Supports common media formats: `mp4`, `webm`, `wav`, `mp3`, `mkv`
- Export formats: `.txt`, `.srt`, `.json`

**Repository layout (high level)**
- `backend/` — Python backend, virtualenv and service code
- `electron/`, `preload/`, `frontend/` — Electron app, preload bridge and frontend UI
- `models/` — Local model folders (e.g. `models/small`)
- `scripts/` — Bootstrapping and helper scripts

## Quickstart

Prerequisites
- Python 3.11+ (for local backend development)
- Node 18+ and npm (for frontend/electron builds)

1) Bootstrap the backend runtime and tooling

Windows (PowerShell):
```powershell
./scripts/bootstrap.ps1
```

macOS / Linux (bash):
```bash
./scripts/bootstrap.sh
```

2) Development run
- Ensure the backend virtualenv exists at `backend/.venv` (created by bootstrap).
- Start the Electron app via the workspace npm scripts or run the Electron entry point from `electron/`.

## Build & Release
- Frontend build: `npm run build:frontend`
- Electron build: `npm run build:electron`
- Build backend onefile artifact: `npm run build:backend:onefile`
- Package Windows installer (thin): see `package.json` scripts and `BUILD_Info.md`.

## Fast local testing
Run the thin-installer local test (serves a local backend artifact to the app):

```bash
npm run test:thin-local
```

## Troubleshooting — common preflight errors

- **Preflight failed: local model directory is missing for 'small'**
	- Ensure model files are placed under `models/small`. See `models/small/README.md` for expected layout and conversion notes.

- **Preflight failed: ffmpeg binary is missing**
	- Install `ffmpeg` or place a static `ffmpeg` binary on `PATH`. The app uses `ffmpeg` for audio extraction from video files.

- **Backend crashed: process_exit / Backend is not running**
	- Verify `backend/.venv` exists and dependencies installed. Try running the backend entry manually from `backend/` to inspect errors.

If you see errors similar to those recorded in app logs (missing model dir, missing ffmpeg, or backend crashes), confirm:

- `models/<size>` exists and contains the expected model files.
- `ffmpeg` is available on `PATH` or placed in the project `bin` folder used by the app.
- The backend virtualenv was created by `./scripts/bootstrap.*` and Python is accessible.

## Related docs
- Architecture and developer notes: [AGENT.md](AGENT.md)
- Backend details: [backend/README.md](backend/README.md)
- Model packaging: [models/small/README.md](models/small/README.md)
- Unsigned macOS install workaround: [docs/unsigned-macos-install.md](docs/unsigned-macos-install.md)

## Contributing
- Follow contribution notes in `AGENT.md` and add tests where appropriate. Backend tests are configured via `backend/pyproject.toml`.

## License
MIT

