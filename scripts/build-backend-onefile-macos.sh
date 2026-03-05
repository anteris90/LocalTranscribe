#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only."
  exit 1
fi

PYTHON_CMD=""
if command -v python3.12 >/dev/null 2>&1; then
  PYTHON_CMD="python3.12"
elif command -v python3.11 >/dev/null 2>&1; then
  PYTHON_CMD="python3.11"
else
  echo "Python 3.12 or 3.11 is required for mac backend onefile build."
  echo "Install with: brew install python@3.12"
  exit 1
fi

BUILD_VENV="backend/.venv-macbuild"

if [[ ! -x "$BUILD_VENV/bin/python" ]]; then
  "$PYTHON_CMD" -m venv "$BUILD_VENV"
fi

PYTHON_BIN="$BUILD_VENV/bin/python"

PYTHON_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$PYTHON_VERSION" != "3.12" && "$PYTHON_VERSION" != "3.11" ]]; then
  echo "Unsupported Python version in $BUILD_VENV: $PYTHON_VERSION"
  echo "Remove $BUILD_VENV and rerun after installing Python 3.12 or 3.11"
  exit 1
fi

"$PYTHON_BIN" -m pip install --upgrade pip
"$PYTHON_BIN" -m pip install -r backend/requirements.txt pyinstaller

"$PYTHON_BIN" -m PyInstaller \
  --onefile \
  --name backend \
  --distpath backend/dist/macos-arm64 \
  --workpath backend/build/macos-arm64 \
  --specpath backend/build/macos-arm64 \
  --paths backend \
  backend/app/main.py

BACKEND_BIN="backend/dist/macos-arm64/backend"
if [[ ! -f "$BACKEND_BIN" ]]; then
  echo "Build failed: $BACKEND_BIN not found"
  exit 1
fi

chmod +x "$BACKEND_BIN"
echo "Built macOS backend runtime: $BACKEND_BIN"
