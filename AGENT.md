# AGENT.md

## Project Name

LocalTranscribe

## Goal

Build a cross-platform desktop application (Windows + macOS Apple Silicon) for local audio/video transcription using Whisper models.

The application must:

* Run fully offline
* Store all dependencies locally inside the project
* Store Whisper models locally inside the project
* Support GPU acceleration (CUDA on Windows, MPS on macOS)
* Provide a modern GUI
* Allow selecting audio/video files (mp4, webm, wav, mp3, mkv, etc.)
* Display transcription in a scrollable text area
* Allow exporting transcription as:

  * .txt
  * .srt
  * .json

---

## Architecture

### Frontend

* Framework: React + Vite
* Desktop wrapper: Electron
* Language: TypeScript
* UI: TailwindCSS + modern minimal design
* Must include:

  * File picker
  * Model selector dropdown (small, medium, large-v3)
  * Device selector (Auto / CPU / GPU)
  * Start transcription button
  * Progress indicator
  * Scrollable textarea
  * Export button

### Backend

* Language: Python 3.11+
* Transcription engine: faster-whisper
* Must run as a local Python process spawned by Electron main process
* Must not require global Python installation
* Use local virtual environment stored inside:

```
/backend/.venv
```

---

## Dependency Rules

All Python dependencies must be installed locally:

```
backend/
    requirements.txt
    .venv/
```

Development install method (from project root):

1. Create local venv only in `backend/.venv`

  * Windows: `python -m venv backend/.venv`
  * macOS: `python3 -m venv backend/.venv`

2. Install dependencies using the venv interpreter only

  * Windows: `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt`
  * macOS: `./backend/.venv/bin/python -m pip install -r backend/requirements.txt`

No global installs are required or allowed (no global `pip install`, no system-level Python package dependency).

---

## Python Dependencies

requirements.txt must include:

faster-whisper
torch
torchaudio
ffmpeg-python

Platform-specific notes:

Windows:

* Development uses local venv and local pip only
* Install CUDA-enabled torch wheel into `backend/.venv` when CUDA acceleration is desired
* If CUDA wheel is unavailable or incompatible, keep CPU-compatible torch in `backend/.venv` and fallback to CPU at runtime

macOS (Apple Silicon):

* Development uses local venv and local pip only
* Use torch build with MPS support inside `backend/.venv`
* If MPS support is unavailable at runtime, fallback to CPU
* Device detection logic must auto-detect (probe-based):

  * "cuda" if torch.cuda.is_available()
  * "mps" if torch.backends.mps.is_available()
  * else "cpu"

Note: GPU-capable builds are platform-specific, but all installs remain local to `backend/.venv`.

---

## Model Handling

All Whisper models must be stored locally:

/models/

Do not rely on global cache directories.

When loading model:

WhisperModel(
model_name,
download_root=models_dir,
device=device,
compute_type="float16" if GPU else "int8"
)

`models_dir` must be provided from Electron runtime path injection (absolute path), not hardcoded relative paths.

Models are expected to be local under `/models` for offline operation.

---

## Backend API Design

Process communication:

* Electron main process starts backend subprocess
* Communication protocol is JSON-RPC over stdio (stdin/stdout)
* Renderer communicates through Electron IPC bridge; renderer does not directly spawn Python

The Python backend must expose a simple CLI interface:

python transcribe.py --file input.mp4 --model medium --device auto --output json

transcribe.py responsibilities:

* Detect device automatically
* Run transcription
* Return:

  * Raw text
  * Segment timestamps
* Save optional output file

Must print progress to stdout for GUI to capture.

---

## GUI Behavior

When user selects file:

* Enable Start button

When transcription starts:

* Disable inputs
* Show progress
* Stream partial results into textarea

When done:

* Enable Export button

Export formats:

* TXT: plain transcript
* SRT: with timestamps
* JSON: full segment data

---

## macOS Notes (Apple Silicon)

* Must support MPS acceleration
* Must not assume CUDA exists
* Must detect torch.backends.mps.is_available()

---

## Windows Notes

* Detect CUDA
* If CUDA not available, fallback to CPU
* Show device status in UI

---

## Performance Rules

Default model:

* medium

Allow selection:

* small
* medium
* large-v3

Compute type:

* GPU: float16
* CPU: int8

---

## Packaging

Use Electron Builder packaging flow.

Final output:

* Windows: .exe installer
* macOS: .app bundle (Apple Silicon target)

All Python runtime must be bundled inside application.

Backend executable and bundled ffmpeg binaries must be packaged as app resources and signed with the app for macOS distribution.

No external runtime dependencies required after installation.

---

## Code Quality Rules

* Type-safe frontend (TypeScript strict mode)
* Clear separation of UI and backend
* No hardcoded absolute paths
* Cross-platform path handling
* Error handling for:

  * Missing FFmpeg
  * GPU unavailable
  * Corrupted media file

---

## UX Requirements

Minimalist dark theme.
Modern layout.
Large readable transcription area.
Keyboard shortcut:

* Ctrl+O → Open file
* Ctrl+S → Export

---

## Future Extensibility

Structure code so future features can include:

* Batch transcription
* Subtitle burn-in
* Translation
* Speaker diarization

---

End of specification.
