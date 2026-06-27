#!/bin/bash
cd "$(dirname "$0")"
open "http://localhost:5173" 2>/dev/null || true
exec python3 server.py
