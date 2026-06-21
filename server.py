#!/usr/bin/env python3
"""
Money — local backend (stdlib only, no installs). Serves the dashboard and
provides small write endpoints so you can edit categories in the app.

Run it:   python3 server.py
Then open http://localhost:5173

Bound to 127.0.0.1 (this machine only). Sensitive files (.simplefin, .py,
dotfiles) are never served.
"""

import os
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import store

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 5173

# never serve these over HTTP, even on localhost
BLOCKED = (".simplefin", ".py", ".pyc")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def log_message(self, *args):
        pass  # quiet

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _blocked(self):
        name = os.path.basename(self.path.split("?")[0])
        return name.startswith(".") or self.path.split("?")[0].endswith(BLOCKED)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/other-merchants":
            return self._json(200, {"merchants": store.other_merchants(
                store.load_transactions(), store.load_overrides())})
        if path == "/api/merchants":
            return self._json(200, {"merchants": store.top_merchants(
                store.load_transactions(), store.load_overrides())})
        if self._blocked():
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/categorize":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            store.save_override(data.get("merchant", ""), data.get("category", "other"))
            return self._json(200, {"ok": True, "spending": store.recompute_spending()})
        if self.path == "/api/sync":
            try:
                import sync
                snap, n, ledger = sync.run_sync()
                return self._json(200, {"ok": True, "updated": snap["updated"], "transactions": n, "ledger": ledger})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        return self._json(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"Money running at http://localhost:{PORT}  (Ctrl-C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
