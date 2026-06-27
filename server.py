#!/usr/bin/env python3
"""
THE CACHE — local backend (stdlib only, no installs). Serves the dashboard and
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
            # founder lock: only the machine holding the local .founder secret is King.
            # Name-typing can never unlock it; the public demo (no backend) is always false.
            return self._json(200, {"ok": True, "founder": os.path.exists(os.path.join(HERE, ".founder"))})
        if path == "/api/king-stats":
            # founder-only deep stats — refuse unless this machine holds the .founder secret
            if not os.path.exists(os.path.join(HERE, ".founder")):
                return self._json(403, {"ok": False})
            return self._json(200, dict({"ok": True}, **store.king_stats()))
        if path == "/api/downloads":
            # GitHub Release download count → King dashboard; also logged to PostHog
            # (founder machine only) whenever the total changes.
            founder = os.path.exists(os.path.join(HERE, ".founder"))
            return self._json(200, store.downloads_snapshot(report=founder))
        if path == "/api/connect-status":
            return self._json(200, {"connected": os.path.exists(os.path.join(HERE, ".simplefin"))})
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
            start_d = (qs.get("start") or [None])[0]
            end_d = (qs.get("end") or [None])[0]
            return self._json(200, store.period_summary(kind, ym, start_d=start_d, end_d=end_d))
        if path == "/api/categories":
            return self._json(200, {"categories": store.category_summary()})
        if path == "/api/recurring":
            return self._json(200, {"recurring": store.detect_recurring()})
        if path == "/api/transfers":
            return self._json(200, {"transfers": store.recurring_transfers()})
        if path == "/api/match-count":
            qs = parse_qs(urlparse(self.path).query)
            return self._json(200, store.match_count(
                (qs.get("q") or [""])[0], (qs.get("window") or ["month"])[0]))
        if path == "/api/subs":
            return self._json(200, {"subs": store.load_subs()})
        if path == "/api/income-links":
            return self._json(200, {"links": store.load_income_links()})
        if path == "/api/averages":
            return self._json(200, store.averages())
        if path == "/api/statistics":
            return self._json(200, store.statistics())
        if path == "/api/export-data":
            return self._json(200, store.export_data())  # client encrypts the bundle (E2E backup)
        if path == "/api/devtree":
            return self._json(200, store.dev_tree())
        if path == "/api/webdav-config":
            return self._json(200, store.webdav_config_get())
        if path == "/api/work":
            return self._json(200, store.work_summary())
        if path == "/api/income-monthly":
            qs = parse_qs(urlparse(self.path).query)
            months = int((qs.get("months") or ["12"])[0])
            return self._json(200, store.monthly_income_by_source(months_back=months))
        if path == "/api/work-monthly":
            return self._json(200, store.monthly_hours_history())
        if path == "/api/integrity":
            return self._json(200, store.verify_ledger())
        if path == "/api/posthog-stats":
            # Founder-only: read aggregate analytics back from PostHog using a Personal
            # API key kept in gitignored .posthog (line 1 = key, optional line 2 = project id).
            # The secret stays on this machine and is never sent to the client.
            secret = os.path.join(HERE, ".posthog")
            if not os.path.exists(secret):
                return self._json(200, {"ok": False, "error": "no key"})
            import urllib.request
            lines = [x.strip() for x in open(secret).read().strip().splitlines() if x.strip()]
            key = lines[0]
            proj = lines[1] if len(lines) > 1 else "487113"
            host = "https://us.posthog.com"

            def hogql(q):
                body = json.dumps({"query": {"kind": "HogQLQuery", "query": q}}).encode()
                req = urllib.request.Request(host + "/api/projects/" + proj + "/query/", data=body, method="POST",
                                             headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=25) as r:
                    return json.loads(r.read())
            try:
                ev = hogql("SELECT event, count() AS c FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY c DESC LIMIT 12")
                tot = hogql("SELECT count() AS t, count(DISTINCT distinct_id) AS u FROM events WHERE timestamp > now() - INTERVAL 7 DAY")
                events = [{"event": row[0], "count": row[1]} for row in ev.get("results", [])]
                t = (tot.get("results") or [[0, 0]])[0]
                return self._json(200, {"ok": True, "events": events, "total": t[0], "users": t[1]})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)[:140]})
        if path == "/api/update-check":
            # read-only preview of a pending update: what changes, size, version —
            # so the user sees everything before deciding (the pull is a separate POST).
            import subprocess

            def _git(*a):
                return subprocess.run(["git", "-C", HERE] + list(a), capture_output=True, text=True, timeout=60)
            try:
                cur = _git("rev-parse", "HEAD").stdout.strip()
                _git("fetch", "origin", "main")
                latest = _git("rev-parse", "origin/main").stdout.strip()
                if not cur or not latest:
                    return self._json(200, {"ok": False, "error": "not a git checkout"})
                n = int(_git("rev-list", "--count", "HEAD..origin/main").stdout.strip() or "0")
                if n == 0:
                    return self._json(200, {"ok": True, "available": False, "current": cur[:7]})
                subjects = [s for s in _git("log", "HEAD..origin/main", "--pretty=%s").stdout.splitlines() if s.strip()]
                stat = _git("diff", "--shortstat", "HEAD..origin/main").stdout.strip()
                files = [f for f in _git("diff", "--name-only", "HEAD..origin/main").stdout.split() if f]
                size = len(_git("diff", "HEAD..origin/main").stdout.encode("utf-8"))
                return self._json(200, {"ok": True, "available": True, "behind": n,
                                        "current": cur[:7], "latest": latest[:7], "latest_full": latest,
                                        "changes": subjects, "stat": stat, "files": len(files), "size_bytes": size})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
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
        if self.path == "/api/update":
            # pull the latest pushed code from GitHub, then restart to load it.
            # --ff-only so a friend's checkout updates cleanly or fails safely (no merge mess).
            import subprocess
            import sys
            import time
            import threading

            def _git(*a):
                return subprocess.run(["git", "-C", HERE] + list(a),
                                      capture_output=True, text=True, timeout=90)
            try:
                before = _git("rev-parse", "HEAD").stdout.strip()
                pull = _git("pull", "--ff-only", "origin", "main")
                after = _git("rev-parse", "HEAD").stdout.strip()
                ok = pull.returncode == 0
                changed = bool(before) and bool(after) and before != after
                msg = (pull.stdout + pull.stderr).strip()
                self._json(200, {"ok": ok, "changed": changed,
                                 "before": before[:7], "after": after[:7],
                                 "message": msg[-400:]})
                if ok and changed:
                    def _restart():
                        time.sleep(0.5)
                        os.execv(sys.executable, [sys.executable, os.path.join(HERE, "server.py")])
                    threading.Thread(target=_restart, daemon=True).start()
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if self.path == "/api/connect":
            # Claim a SimpleFIN setup token → access URL → save to .simplefin → first sync.
            # Done inline (not via sync.py's CLI claim, which sys.exit()s and would kill the server).
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            import base64
            import urllib.request
            if data.get("demo"):
                claim_url = "https://beta-bridge.simplefin.org/simplefin/claim/demo"
            else:
                token = "".join((data.get("token") or "").split())
                if not token:
                    return self._json(200, {"ok": False, "error": "Paste your SimpleFIN setup token first."})
                token += "=" * (-len(token) % 4)
                try:
                    claim_url = base64.b64decode(token).decode("utf-8").strip()
                except Exception:
                    return self._json(200, {"ok": False, "error": "That doesn't look like a setup token — copy the whole thing from SimpleFIN."})
                if not claim_url.startswith("http"):
                    return self._json(200, {"ok": False, "error": "That token didn't decode to a valid link — recopy the full token."})
            try:
                req = urllib.request.Request(claim_url, data=b"", method="POST",
                                             headers={"User-Agent": "thecache/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    access_url = r.read().decode("utf-8").strip()
                secret = os.path.join(HERE, ".simplefin")
                with open(secret, "w") as f:
                    f.write(access_url)
                try:
                    os.chmod(secret, 0o600)
                except OSError:
                    pass
                import sync
                snap, ntx, _ledger = sync.run_sync()
                return self._json(200, {"ok": True, "accounts": len(snap.get("accounts", [])), "transactions": ntx})
            except Exception as e:
                return self._json(500, {"ok": False, "error": "Couldn't connect: " + str(e)})
        if self.path == "/api/import-data":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, store.import_data(data.get("files") or {}))
        if self.path == "/api/webdav-config":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, store.webdav_config_save(data.get("url"), data.get("user"), data.get("pass")))
        if self.path == "/api/webdav-push":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, store.webdav_push(data.get("filename"), data.get("data")))
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
        if self.path == "/api/subs":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, {"ok": True, "subs": store.save_subs(data.get("subs", {}))})
        if self.path == "/api/income-links":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "bad request"})
            return self._json(200, {"ok": True, "links": store.save_income_links(data.get("links", {}))})
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
    # Default: localhost only (this machine). Opt in to LAN access with
    #   GOAT_HOST=0.0.0.0 python3 server.py
    # ⚠ 0.0.0.0 exposes the app (no login) to everyone on your network — only do
    # it on a trusted home wifi for a quick test. For "anywhere" access, leave this
    # on 127.0.0.1 and put it on your private Tailscale tailnet instead (tailscale serve).
    HOST = os.environ.get("GOAT_HOST", "127.0.0.1")
    where = "your network" if HOST == "0.0.0.0" else "localhost"
    print(f"THE CACHE running on {HOST}:{PORT}  ({where})  (Ctrl-C to stop)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
