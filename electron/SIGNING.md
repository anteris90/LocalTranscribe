# macOS Signing Guidance (Apple Silicon)

This project uses Electron Builder with Hardened Runtime enabled.

## What must be signed

- Main Electron app bundle
- Embedded backend executable in `Contents/Resources/backend/backend`
- Bundled ffmpeg binaries in `Contents/Resources/ffmpeg/`

All nested executables must be signed with the same Team ID before notarization.

## Required build inputs (provided by release environment)

- Apple Developer ID Application certificate
- Apple notarization credentials (App Store Connect API key or Apple ID app-specific password)

Do not store signing secrets in source control.

## Recommended release flow

1. Build arm64 backend executable.
2. Ensure ffmpeg binary for macOS arm64 is present in `bin/macos-arm64`.
3. Build renderer and electron main bundles.
4. Run `npm --workspace electron run dist` from repository root.
5. Sign nested binaries and app bundle via Electron Builder config.
6. Submit for notarization and staple notarization ticket.

## Verification

- Validate code signatures recursively.
- Confirm backend subprocess launches after signing/notarization.
- Confirm app can access `process.resourcesPath/models`, `process.resourcesPath/backend`, and `process.resourcesPath/ffmpeg`.
