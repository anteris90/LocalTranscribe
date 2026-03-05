# macOS Signing Guidance (Apple Silicon)

This project uses Electron Builder with Hardened Runtime enabled.

## One-time Apple account setup

1. Join Apple Developer Program.
2. In Apple Developer portal, create/download a **Developer ID Application** certificate.
3. Export certificate + private key as `.p12` from Keychain Access.
4. In App Store Connect (Users and Access -> Keys), create an API key and download `.p8`.

Recommended local checks:

- `security find-identity -v -p codesigning`
- `xcrun notarytool --version`

## What must be signed

- Main Electron app bundle
- Embedded backend executable in `Contents/Resources/backend/backend`
- Bundled ffmpeg binaries in `Contents/Resources/ffmpeg/`

All nested executables must be signed with the same Team ID before notarization.

## Required build inputs (provided by release environment)

- Apple Developer ID Application certificate
- Apple notarization credentials (App Store Connect API key or Apple ID app-specific password)

Do not store signing secrets in source control.

## GitHub Actions secrets required (for signed/notarized mac builds)

Set these repository secrets:

- `MAC_CERT_P12_BASE64`: base64 of exported Developer ID `.p12`
- `MAC_CERT_PASSWORD`: password used when exporting `.p12`
- `MAC_KEYCHAIN_PASSWORD`: temporary keychain password for CI import
- `APPLE_API_KEY_ID`: App Store Connect API key ID
- `APPLE_API_ISSUER_ID`: App Store Connect issuer ID
- `APPLE_API_KEY_P8_BASE64`: base64 of downloaded `.p8` key file

How to encode files to base64 locally (macOS):

- `base64 -i developer_id.p12 | pbcopy`
- `base64 -i AuthKey_<KEY_ID>.p8 | pbcopy`

Paste the clipboard values into corresponding GitHub secrets.

## Workflow behavior

- If all secrets are present, release workflow builds mac app with signing + notarization.
- If any secret is missing, workflow falls back to unsigned mac build.
- Windows release flow is unchanged.

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

Useful verification commands:

- `codesign --verify --deep --strict --verbose=2 /path/to/LocalTranscribe.app`
- `spctl -a -vv /path/to/LocalTranscribe.app`
- `xcrun stapler validate /path/to/LocalTranscribe.app`
