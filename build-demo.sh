#!/usr/bin/env bash
# Refresh the public demo (docs/demo/) with the current real app files.
# Run before pushing any change that should show up in the embedded demo.
# The demo runs the REAL app.js/styles.css with a fake-data layer (demo-data.js)
# instead of the Python backend — see docs/demo/demo-data.js.
#
# Only the files the app actually references are copied (keep the demo lean —
# no stray videos/PDFs on GitHub Pages). If styles.css/app.js start referencing
# a new asset, add it here.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/docs/demo"
mkdir -p "$DEST/av assets"

# code
cp "$HERE/app.js"     "$DEST/app.js"
cp "$HERE/styles.css" "$DEST/styles.css"
cp "$HERE/cursor.js"  "$DEST/cursor.js"

# referenced images only (logo mask + goat head/sprite masks)
cp "$HERE/goat-head.png"   "$DEST/goat-head.png"
cp "$HERE/goat-sprite.png" "$DEST/goat-sprite.png"
cp "$HERE/av assets/THECACHE_LOGO_WHITE.png" "$DEST/av assets/THECACHE_LOGO_WHITE.png"
cp "$HERE/av assets/THECACHE_LOGO_BLACK.png" "$DEST/av assets/THECACHE_LOGO_BLACK.png"
cp "$HERE/av assets/goat-pixel.png" "$DEST/av assets/goat-pixel.png"
cp "$HERE/av assets/shing.wav" "$DEST/av assets/shing.wav"
cp "$HERE/av assets/warp.wav" "$DEST/av assets/warp.wav"

# drop anything stale that isn't part of the lean set
find "$DEST/av assets" -type f ! -name "THECACHE_LOGO_WHITE.png" ! -name "THECACHE_LOGO_BLACK.png" ! -name "goat-pixel.png" ! -name "shing.wav" ! -name "warp.wav" -delete

echo "demo refreshed → $DEST"
