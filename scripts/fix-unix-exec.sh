#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

chmod +x scripts/*.sh 2>/dev/null || true
chmod +x test_scripts/*.sh 2>/dev/null || true

echo "Updated executable bit for shell scripts in scripts/ and test_scripts/."
