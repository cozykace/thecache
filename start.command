#!/bin/bash
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "  THE CACHE needs Python 3, which isn't installed on this Mac yet."
  echo "  Easiest fix — run this in Terminal, then double-click start.command again:"
  echo ""
  echo "      xcode-select --install"
  echo ""
  echo "  (or download Python from https://www.python.org/downloads/)"
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi
echo "Starting THE CACHE on http://localhost:5173   (close this window to stop)"
( sleep 1; open "http://localhost:5173" >/dev/null 2>&1 ) &
exec python3 server.py
