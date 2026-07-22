#!/usr/bin/env bash
# Refresh the public demo (docs/demo/) with the current real app files.
# Run before pushing any change that should show up in the embedded demo.
# The demo runs the REAL app.js/styles.css with a fake-data layer (demo-data.js)
# instead of the Python backend — see docs/demo/demo-data.js.
#
# index.html is GENERATED from the source ./index.html on every build (see below) —
# never hand-edit docs/demo/index.html, it gets overwritten. This is what keeps the
# demo shell from drifting: the demo IS the real shell, with a few demo-only bits
# spliced in (fake-data loader, "live demo" banner, brand-theme default, embed chrome).
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
cp "$HERE/theme-preload.js" "$DEST/theme-preload.js"

# vendored libraries (pinned locally, not @latest CDNs — security eval T4)
rm -rf "$DEST/assets/vendor"
mkdir -p "$DEST/assets/vendor"
cp -R "$HERE/assets/vendor/." "$DEST/assets/vendor/"

# skins (art/sound pipeline) — copy the default skin so the Base can load real art
rm -rf "$DEST/skins"
cp -R "$HERE/skins" "$DEST/skins"

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

# ── index.html: derive the demo shell from the REAL ./index.html ──────────────
# The demo used to keep a hand-frozen copy of index.html, which silently rotted
# every time the real shell changed (empty board, stale buttons). Now we generate
# it from source on every build and splice in ONLY the demo-specific bits:
#   1. <title> → "… — Live demo"
#   2. brand-theme ("cache") default in the pre-paint theme script + matching
#      dark mobile chrome color, since the demo commits to the dark brand look
#   3. demo-data.js (the fake-data layer) loaded right before app.js — same
#      defer-before-app.js pattern build-app.sh uses for webcache.js
#   4. the "LIVE DEMO · PLAY NUMBERS" banner + demo-only chrome CSS (hide the
#      git-backed "Update app", hide scrollbars, and on narrow screens strip the
#      floating app chrome so the embed reads as a clean board of widgets)
# Every LOCAL asset is stamped with a content-hash ?v= so a new deploy busts the
# browser cache (mirrors build-app.sh) — otherwise a plain refresh keeps serving
# the OLD cached app.js/styles.css.
VER="$(cat "$HERE/app.js" "$HERE/styles.css" "$HERE/cursor.js" "$HERE/theme-preload.js" "$DEST/demo-data.js" | shasum | cut -c1-10)"

# The demo-only chunks live in temp files so awk can splice them in verbatim
# (heredocs keep the CSS readable; quoted <<'EOF' means no shell expansion, and
# temp files sidestep macOS bash 3.2's heredoc-in-$() quirk).
STYLE_FILE="$(mktemp)"
BADGE_FILE="$(mktemp)"
trap 'rm -f "$STYLE_FILE" "$BADGE_FILE"' EXIT

cat > "$STYLE_FILE" <<'EOF'
    <style>
      /* demo-only chrome */
      #demoBadge {
        position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 9999;
        background: var(--accent); color: #16140c; pointer-events: none;
        font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; font-weight: 700;
        letter-spacing: 0.12em; text-transform: uppercase; padding: 6px 13px; border-radius: 999px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      }
      /* "Update app" pulls from git — meaningless in the static demo */
      #updateApp { display: none; }
      /* Hide scrollbars in the embed (still scrollable — just no visible bar) */
      html, body, .board, .board-canvas { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      html::-webkit-scrollbar, body::-webkit-scrollbar,
      .board::-webkit-scrollbar, .board-canvas::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      /* Embed showcase mode on narrow screens: hide the app's floating chrome
         (menu/theme/bg toggles, zoom, status + stats + dock bars) so the embed
         reads as a clean, scrollable board of widgets instead of a cramped app.
         Desktop keeps the full interactive UI. */
      @media (max-width: 640px) {
        #sidebarToggle, #themeToggle, #bgToggle, #pagesToggle, .zoom-control,
        .status-bar, .stats-bar, .dock-bar { display: none !important; }
        .board-canvas {
          padding-top: calc(46px + env(safe-area-inset-top)) !important;
          padding-bottom: 24px !important;
        }
        #demoBadge { top: 8px; font-size: 10px; padding: 5px 10px; }
      }
    </style>
EOF

cat > "$BADGE_FILE" <<'EOF'
    <div id="demoBadge">Live demo · play numbers</div>
EOF

awk -v ver="$VER" -v stylef="$STYLE_FILE" -v badgef="$BADGE_FILE" '
  function slurp(f,   line, out) { out = ""; while ((getline line < f) > 0) out = out line "\n"; close(f); return out }
  BEGIN { STYLE = slurp(stylef); BADGE = slurp(badgef) }
  {
    # demo title
    gsub(/<title>THE CACHE<\/title>/, "<title>THE CACHE — Live demo</title>")
    # default to the brand "cache" theme via an <html> attribute the external
    # theme-preload.js reads (the old inline getItem() rewrite is gone — the script
    # is external now so the page can keep a strict, inline-free CSP)
    gsub(/<html lang="en">/, "<html lang=\"en\" data-default-theme=\"cache\">")
    gsub(/name="theme-color" content="#ffffff"/, "name=\"theme-color\" content=\"#16140c\"")
    gsub(/content="default"/, "content=\"black-translucent\"")
    # cache-bust local assets (mirror build-app.sh)
    gsub(/href="styles\.css"/, "href=\"styles.css?v=" ver "\"")
    gsub(/src="theme-preload\.js"/, "src=\"theme-preload.js?v=" ver "\"")
    gsub(/src="cursor\.js"/,   "src=\"cursor.js?v=" ver "\"")
    # load the fake-data layer right before app.js, both cache-busted
    gsub(/<script defer src="app\.js"><\/script>/, "<script defer src=\"demo-data.js?v=" ver "\"></script>\n    <script defer src=\"app.js?v=" ver "\"></script>")
  }
  /<\/head>/ { printf "%s", STYLE }
  { print }
  /<body>/   { printf "%s", BADGE }
' "$HERE/index.html" > "$DEST/index.html"

echo "   cache-bust version: $VER"
echo "demo refreshed → $DEST"
