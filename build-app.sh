#!/usr/bin/env bash
# Build the hosted WEB app (docs/ = the ROOT of thecache.app) — the same real
# app.js/styles.css, but with webcache.js (the no-backend web runtime) loaded before
# app.js. It runs entirely
# in the browser: login + decrypt the vault, then serve every data/*.json and
# /api/* call from the decrypted bundle. The desktop app is the sync engine.
#
# Run after any app.js/styles.css/cursor.js/webcache.js/index.html change so the
# web app doesn't drift, then push (main → GitHub Pages → https://thecache.app/).
# The roadmap lives at docs/roadmap/, the demo at docs/demo/ — untouched by this build.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/docs"
mkdir -p "$DEST/av assets"

# code
cp "$HERE/app.js"      "$DEST/app.js"
cp "$HERE/styles.css"  "$DEST/styles.css"
cp "$HERE/cursor.js"   "$DEST/cursor.js"
cp "$HERE/webcache.js" "$DEST/webcache.js"
cp "$HERE/theme-preload.js" "$DEST/theme-preload.js"

# vendored libraries (pinned locally instead of @latest CDNs — security eval T4).
# The URL change from unpkg/jsdelivr to assets/vendor/ busts old caches on its own;
# on a future version bump, rename or cache-bust these.
rm -rf "$DEST/assets/vendor"
mkdir -p "$DEST/assets/vendor"
cp -R "$HERE/assets/vendor/." "$DEST/assets/vendor/"

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

# index.html = the real shell, with webcache.js injected before app.js, and every LOCAL
# asset stamped with a content-hash ?v= so a new deploy always busts the browser cache.
# Without this, styles.css/app.js are cached by their (unchanging) URL, so a plain refresh
# keeps serving the OLD build — the "I pulled to refresh AND hit update, still nothing"
# trap. The hash only changes when the code changes, so unchanged assets stay cached.
VER="$(cat "$HERE/app.js" "$HERE/styles.css" "$HERE/cursor.js" "$HERE/webcache.js" "$HERE/theme-preload.js" | shasum | cut -c1-10)"
sed \
  -e 's#href="styles\.css"#href="styles.css?v='"$VER"'"#' \
  -e 's#src="theme-preload\.js"#src="theme-preload.js?v='"$VER"'"#' \
  -e 's#src="cursor\.js"#src="cursor.js?v='"$VER"'"#' \
  -e 's#<script defer src="app\.js"></script>#<script defer src="webcache.js?v='"$VER"'"></script>\n    <script defer src="app.js?v='"$VER"'"></script>#' \
  "$HERE/index.html" > "$DEST/index.html"
echo "   cache-bust version: $VER"

# roadmap source — the public roadmap page reads these from its OWN origin.
# It used to fetch them from raw.githubusercontent.com, which breaks the instant the
# repo goes private. Shipping them with the site makes /roadmap/ independent of repo
# visibility. Both files are already written to be safe for anyone to read.
cp "$HERE/BACKLOG.md"  "$DEST/roadmap/BACKLOG.md"
cp "$HERE/FEATURES.md" "$DEST/roadmap/FEATURES.md"

echo "web app built → $DEST"
