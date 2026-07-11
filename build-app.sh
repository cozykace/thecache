#!/usr/bin/env bash
# Build the hosted WEB app (docs/app/) — the same real app.js/styles.css, but with
# webcache.js (the no-backend web runtime) loaded before app.js. It runs entirely
# in the browser: login + decrypt the E2E vault, then serve every data/*.json and
# /api/* call from the decrypted bundle. The desktop app is the sync engine.
#
# Run after any app.js/styles.css/cursor.js/webcache.js/index.html change so the
# web app doesn't drift, then push (main → GitHub Pages → /thecache/app/).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/docs/app"
mkdir -p "$DEST/av assets"

# code
cp "$HERE/app.js"      "$DEST/app.js"
cp "$HERE/styles.css"  "$DEST/styles.css"
cp "$HERE/cursor.js"   "$DEST/cursor.js"
cp "$HERE/webcache.js" "$DEST/webcache.js"

# skins (art/sound pipeline) — copy the whole default skin so the Base can load real art
rm -rf "$DEST/skins"
cp -R "$HERE/skins" "$DEST/skins"

# referenced images / audio (same lean set as the demo)
cp "$HERE/goat-head.png"   "$DEST/goat-head.png"
cp "$HERE/goat-sprite.png" "$DEST/goat-sprite.png"
cp "$HERE/av assets/THECACHE_LOGO_WHITE.png" "$DEST/av assets/THECACHE_LOGO_WHITE.png"
cp "$HERE/av assets/THECACHE_LOGO_BLACK.png" "$DEST/av assets/THECACHE_LOGO_BLACK.png"
cp "$HERE/av assets/goat-pixel.png" "$DEST/av assets/goat-pixel.png"
cp "$HERE/av assets/shing.wav" "$DEST/av assets/shing.wav"
cp "$HERE/av assets/warp.wav" "$DEST/av assets/warp.wav"
find "$DEST/av assets" -type f ! -name "THECACHE_LOGO_WHITE.png" ! -name "THECACHE_LOGO_BLACK.png" ! -name "goat-pixel.png" ! -name "shing.wav" ! -name "warp.wav" -delete

# index.html = the real shell, with webcache.js injected before app.js
sed 's#<script defer src="app.js"></script>#<script defer src="webcache.js"></script>\n    <script defer src="app.js"></script>#' \
  "$HERE/index.html" > "$DEST/index.html"

echo "web app built → $DEST"
