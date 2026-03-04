#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_EXE="${APP_EXE:-dist/packages/mac-arm64/LocalTranscribe.app/Contents/MacOS/LocalTranscribe}"
BACKEND_ARTIFACT="${BACKEND_ARTIFACT:-backend/dist/macos-arm64/backend}"
PORT="${PORT:-8765}"
BUILD_BACKEND_IF_MISSING="${BUILD_BACKEND_IF_MISSING:-1}"
RESET_RUNTIME="${RESET_RUNTIME:-1}"

if [[ ! -x "$APP_EXE" ]]; then
  echo "App executable not found/executable at: $APP_EXE"
  echo "Set APP_EXE env var to your unpacked app binary path before running."
  exit 1
fi

if [[ ! -f "$BACKEND_ARTIFACT" ]]; then
  if [[ "$BUILD_BACKEND_IF_MISSING" == "1" ]]; then
    echo "Backend artifact missing at $BACKEND_ARTIFACT"
    echo "Build it first for your platform, then rerun with BACKEND_ARTIFACT set if needed."
  fi
  exit 1
fi

RUNTIME_ROOT=""
if [[ "$(uname -s)" == "Darwin" ]]; then
  RUNTIME_ROOT="$HOME/Library/Application Support/localtranscribe-electron/runtime"
else
  RUNTIME_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/localtranscribe-electron/runtime"
fi

if [[ "$RESET_RUNTIME" == "1" && -d "$RUNTIME_ROOT" ]]; then
  rm -rf "$RUNTIME_ROOT"
  echo "Reset runtime cache: $RUNTIME_ROOT"
fi

TEMP_DIR="${TMPDIR:-/tmp}/localtranscribe-bootstrap-test"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

SERVED_BACKEND="$TEMP_DIR/backend-unix"
cp "$BACKEND_ARTIFACT" "$SERVED_BACKEND"
chmod +x "$SERVED_BACKEND"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" || true
  fi
}
trap cleanup EXIT

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$TEMP_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 1

export LOCALTRANSCRIBE_BACKEND_URL="http://127.0.0.1:${PORT}/backend-unix"
echo "Using LOCALTRANSCRIBE_BACKEND_URL=$LOCALTRANSCRIBE_BACKEND_URL"

"$APP_EXE"
