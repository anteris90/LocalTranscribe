#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only."
  exit 1
fi

FFMPEG_SRC="$(command -v ffmpeg || true)"
if [[ -z "$FFMPEG_SRC" ]]; then
  echo "ffmpeg is not installed on PATH."
  echo "Install it with: brew install ffmpeg"
  exit 1
fi

TARGET_DIR="bin/macos-arm64"
mkdir -p "$TARGET_DIR"

rm -f "$TARGET_DIR/ffmpeg"
cp "$FFMPEG_SRC" "$TARGET_DIR/ffmpeg"
chmod +x "$TARGET_DIR/ffmpeg"

FFPROBE_SRC="$(command -v ffprobe || true)"
if [[ -n "$FFPROBE_SRC" ]]; then
  rm -f "$TARGET_DIR/ffprobe"
  cp "$FFPROBE_SRC" "$TARGET_DIR/ffprobe"
  chmod +x "$TARGET_DIR/ffprobe"
fi

echo "Prepared macOS ffmpeg runtime in $TARGET_DIR"
