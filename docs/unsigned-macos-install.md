# Open Unsigned macOS Build

If LocalTranscribe is distributed without Apple signing/notarization, macOS Gatekeeper may block launch with messages like:

- "LocalTranscribe is damaged and can't be opened"
- "Apple could not verify LocalTranscribe is free of malware"

Use one of the methods below.

## Method 1: Finder (recommended first)

1. Move `LocalTranscribe.app` to `Applications` (or `~/Applications`).
2. In Finder, right-click `LocalTranscribe.app`.
3. Select **Open**.
4. In the confirmation dialog, select **Open** again.

After first successful launch, macOS usually allows normal double-click open.

## Method 2: System Settings

If Finder open still fails:

1. Open **System Settings -> Privacy & Security**.
2. In the Security section, find the blocked app message.
3. Select **Open Anyway**.
4. Confirm the final **Open** prompt.

## Method 3: Terminal fallback (quarantine removal)

If macOS still shows "damaged" for a manually copied app:

```bash
# Example app path in user Applications
APP="$HOME/Applications/LocalTranscribe.app"

# Some bundled binaries may be read-only after copy; make owner writable first
chmod u+w "$APP/Contents/Resources/ffmpeg/ffmpeg" "$APP/Contents/Resources/ffmpeg/ffprobe" 2>/dev/null || true

# Remove quarantine recursively
xattr -dr com.apple.quarantine "$APP"

# Launch
open "$APP"
```

If you installed under `/Applications` and permissions deny the command, either:

- run with `sudo`, or
- copy/install to `~/Applications` and run the commands there.

## Verify backend starts

After launch, backend process should appear:

```bash
pgrep -fl "LocalTranscribe.app/Contents/MacOS/LocalTranscribe|localtranscribe-electron/runtime/backend/backend"
```
