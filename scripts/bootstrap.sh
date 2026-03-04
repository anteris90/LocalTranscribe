#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "backend/.venv" ]; then
  python3 -m venv backend/.venv
fi

./backend/.venv/bin/python -m pip install --upgrade pip
./backend/.venv/bin/python -m pip install -r backend/requirements.txt

npm install
npm --workspace frontend install
npm --workspace electron install

echo "LocalTranscribe Stage 1 bootstrap complete."
