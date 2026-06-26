#!/usr/bin/env bash
# Refresh the public demo (docs/demo/) with the current real app files.
# Run before pushing any change that should show up in the embedded demo.
# The demo runs the REAL app.js/styles.css with a fake-data layer (demo-data.js)
# instead of the Python backend — see docs/demo/demo-data.js.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/docs/demo"
mkdir -p "$DEST"
cp "$HERE/app.js"     "$DEST/app.js"
cp "$HERE/styles.css" "$DEST/styles.css"
cp "$HERE/cursor.js"  "$DEST/cursor.js"
rm -rf "$DEST/av assets"
cp -R "$HERE/av assets" "$DEST/av assets"
echo "demo refreshed → $DEST (app.js, styles.css, cursor.js, av assets)"
