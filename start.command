#!/bin/bash
# Double-click this file in Finder to start Money.
# Keep the window that opens — closing it stops the app. Costs nothing; runs only on your Mac.
cd "$(dirname "$0")"
echo "Starting Money…  open http://localhost:5173 in your browser."
echo "(Keep this window open. Close it to stop. This does NOT use Claude or cost anything.)"
echo
python3 server.py
