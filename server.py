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
from urllib.parse import urlparse, parse_qs
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
        if path == "/api/ping":
            return self._json(200, {"ok": True})
        if path == "/api/other-merchants":
            return self._json(200, {"merchants": store.other_merchants(
                store.load_transactions(), store.load_overrides())})
        if path == "/api/merchants":
            return self._json(200, {"merchants": store.top_merchants(
                store.load_transactions(), store.load_overrides())})
        if path == "/api/deposits":
            return self._json(200, {"deposits": store.deposit_sources(
                store.load_transactions())})
        if path == "/api/summary":
            qs = parse_qs(urlparse(self.path).query)
            kind = (qs.get("kind") or ["mtd"])[0]
            ym = (qs.get("ym") or [None])[0]
            return self._json(200, store.period_summary(kind, ym))
        if path == "/api/categories":
            return self._json(200, {"categories": store.category_summary()})
        if path == "/api/recurring":
            return self._json(200, {"recurring": store.detect_recurring()})
        if path == "/api/averages":
            return self._json(200, store.averages())
        if path == "/api/issues":
            return self._json(200, {"issues": store.find_issues()})
        if path == "/api/bugs":
            return self._json(200, {"bugs": store.load_bugs()})
        if self._blocked():
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/restart":
            # respond, then replace this process with a fresh one (loads new code).
            # the listening socket is close-on-exec, so the port frees up for the new server.
            self._json(200, {"ok": True})
            import sys
            import time
            import threading

            def _go():
                time.sleep(0.4)
                os.execv(sys.executable, [sys.executable, os.path.join(HERE, "server.py")])
            threading.Thread(target=_go, daemon=True).start()
            return
        if self.path == "/api/categorize":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            store.save_override(data.get("merchant", ""), data.get("category", "other"))
            return self._json(200, {"ok": True, "spending": store.recompute_spending()})
        if self.path == "/api/income":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            store.save_income_override(data.get("source", ""), data.get("status", "auto"))
            return self._json(200, {"ok": True, "income": store.recompute_income()})
        if self.path == "/api/category":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            act = data.get("action")
            if act == "rename":
                store.rename_category(data.get("key", ""), data.get("label", ""))
            elif act == "create":
                store.create_category(data.get("label", ""))
            elif act == "delete":
                store.delete_category(data.get("key", ""), data.get("to", "other"))
            elif act == "reassign":  # one-off: point a single merchant at a category
                store.save_override(data.get("merchant", ""), data.get("to", "other"))
                store.recompute_spending()
            else:
                return self._json(400, {"error": "bad action"})
            return self._json(200, {"ok": True, "categories": store.category_summary()})
        if self.path == "/api/delete-txn":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            store.delete_txn(data.get("id", ""))
            return self._json(200, {"ok": True})
        if self.path == "/api/bug":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, {"ok": True, "bugs": store.add_bug(data.get("text", ""))})
        if self.path == "/api/bug-status":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, {"ok": True, "bugs": store.set_bug_status(
                data.get("id"), data.get("status", "open"))})
        if self.path == "/api/import":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            content = data.get("content", "")
            if not content.strip():
                return self._json(200, {"ok": False, "error": "empty file"})
            try:
                import import_statements as importer
                txns, err = importer.parse_text(content, data.get("filename", "import.csv"))
                if err:
                    return self._json(200, {"ok": False, "error": err})
                summary = importer.import_records(txns)
                summary["ok"] = True
                return self._json(200, summary)
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
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
