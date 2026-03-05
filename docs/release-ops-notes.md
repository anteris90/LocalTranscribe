# Release Ops Notes (2026-03-05)

This note captures what worked and what failed during recent LocalTranscribe releases, so the next release is repeatable.

## Current known-good release version flow

- Version bump in all three files:
  - `package.json`
  - `frontend/package.json`
  - `electron/package.json`
- Local mac build command:
  - `npm run release:mac`
- Local mac artifact output:
  - `dist/packages/LocalTranscribe-<version>-mac-arm64.dmg`

## macOS local build requirements

1. `ffmpeg` must be installed on macOS host (`brew install ffmpeg`).
2. Runtime staging script copies ffmpeg into `bin/macos-arm64`:
   - `scripts/prepare-macos-runtime.sh`
3. Backend onefile should be built with Python 3.12/3.11 in dedicated venv:
   - `scripts/build-backend-onefile-macos.sh`
   - Uses `backend/.venv-macbuild` (not `backend/.venv`) to avoid Python 3.14 build issues.
4. Electron dist checks required mac inputs before packaging:
   - `electron/scripts/verify-release-inputs.mjs`

## Why mac CI failed previously (and fixes)

### 1) Missing Rollup native optional dependency

Error:
- `Cannot find module @rollup/rollup-darwin-arm64`

Fix applied in workflow:
- Install Rollup native package explicitly on mac runner.
- Re-ensure it again just before frontend build (after other npm operations).

### 2) Missing DMG optional dependency

Error:
- `Cannot find module 'dmg-license'`

Fix applied in workflow:
- Install `dmg-license` explicitly on mac runner.

### 3) Missing mac runtime bundle folder

Error:
- Missing `bin/macos-arm64`

Fix applied in workflow:
- Add step to stage `ffmpeg` (and `ffprobe`) into `bin/macos-arm64` before packaging.

## Manual all-platform release without waiting on CI completion

If CI is not desired/blocked but release object exists:

1. Ensure release tag exists (example `v0.1.7`).
2. Upload local mac artifact manually:
   - `gh release upload v<version> "dist/packages/LocalTranscribe-<version>-mac-arm64.dmg" --clobber`
3. Ensure Windows artifacts are present (either from CI or manual upload if available):
   - `LocalTranscribe-<version>-win-x64.exe`
   - `backend.exe` (label: `backend-win-x64.exe`)
4. Add release notes text:
   - `gh release edit v<version> --notes "..."`

## Important behavior reminder

- Windows and mac jobs in GitHub Actions are asynchronous remote jobs.
- "Waiting for Windows" means waiting for GitHub-hosted job completion and asset upload, not waiting for user action.

## Practical quick checklist (next release)

1. Bump versions in 3 package files.
2. Run `npm run release:mac` locally and verify DMG exists.
3. Commit + push main.
4. Create and push tag `vX.Y.Z`.
5. Check release assets.
6. If mac asset missing, upload DMG manually with `gh release upload`.
7. Update release notes.
