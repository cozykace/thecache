#!/usr/bin/env python3
"""Pull the shared beta feedback inbox so it can be triaged in one pass.

Every in-app report (bug / request / note) lands in the `feedback` collection on
PocketBase. Reading them one at a time in the admin UI doesn't scale — this prints
the whole inbox as a triage list (or JSON) in a single command, so a check-in can
walk it end to end and file each one into BACKLOG.

Setup (once):
    Create a file called `.pbadmin` next to this script — it is GITIGNORED and never
    committed, same as `.simplefin` / `.posthog`:

        {"url": "https://thecache.pockethost.io", "email": "you@example.com", "password": "…"}

    chmod 600 .pbadmin

Usage:
    python3 feedback.py              # triage list, newest first
    python3 feedback.py --json       # machine-readable
    python3 feedback.py --open       # only ones not marked handled
    python3 feedback.py --limit 50

Notes:
  · Read-only. It never edits or deletes a record.
  · Reports can contain personal details (a reply-to email someone typed). Treat the
    output like the inbox it is: don't paste it into anything public, and never into
    BACKLOG/FEATURES, which render on the live site.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CRED = os.path.join(HERE, ".pbadmin")
UA = "thecache-feedback/1.0"


def _post(url, payload, token=None):
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(url, token):
    req = urllib.request.Request(url, headers={"Authorization": token, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def load_creds():
    if not os.path.exists(CRED):
        sys.exit(
            "No .pbadmin file.\n\n"
            "Create one next to this script (it's gitignored):\n"
            '  {"url": "https://thecache.pockethost.io", "email": "…", "password": "…"}\n'
            "then:  chmod 600 .pbadmin"
        )
    with open(CRED) as f:
        c = json.load(f)
    if not c.get("url") or not c.get("email") or not c.get("password"):
        sys.exit(".pbadmin needs url, email and password.")
    c["url"] = c["url"].rstrip("/")
    return c


def auth(c):
    """PocketBase renamed the admin auth route: _superusers (v0.23+) vs admins (older)."""
    payload = {"identity": c["email"], "password": c["password"]}
    for path in ("/api/collections/_superusers/auth-with-password", "/api/admins/auth-with-password"):
        try:
            d = _post(c["url"] + path, payload)
            if d.get("token"):
                return d["token"]
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                continue          # wrong route for this version, or bad credentials — try the other
            raise
    sys.exit("Couldn't sign in to PocketBase. Check the email/password in .pbadmin.")


def fetch(c, token, limit):
    out, page = [], 1
    while len(out) < limit:
        q = urllib.parse.urlencode({"perPage": min(200, limit - len(out)), "page": page, "sort": "-created"})
        try:
            d = _get(c["url"] + "/api/collections/feedback/records?" + q, token)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                sys.exit("No `feedback` collection on this instance yet — nothing to triage.")
            raise
        items = d.get("items") or []
        out.extend(items)
        if page >= (d.get("totalPages") or 1) or not items:
            break
        page += 1
    return out[:limit]


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    open_only = "--open" in args
    limit = 200
    if "--limit" in args:
        try:
            limit = int(args[args.index("--limit") + 1])
        except (IndexError, ValueError):
            sys.exit("--limit needs a number")

    c = load_creds()
    rows = fetch(c, auth(c), limit)

    # `status` only exists once the collection has it; treat anything not clearly
    # handled as still open so nothing quietly disappears from triage.
    def is_open(r):
        return str(r.get("status") or "open").lower() not in ("fixed", "done", "closed", "wontfix")

    if open_only:
        rows = [r for r in rows if is_open(r)]

    if as_json:
        print(json.dumps(rows, indent=2))
        return

    if not rows:
        print("Inbox empty — nothing waiting.")
        return

    print(f"{len(rows)} report(s), newest first\n" + "─" * 60)
    for r in rows:
        who = r.get("from_name") or "anonymous"
        reply = r.get("reply_to") or ""
        kind = r.get("kind") or "note"
        status = r.get("status") or "open"
        msg = " ".join((r.get("message") or "").split())
        print(f"\n[{status}] {kind} · {r.get('created','')[:16]} · {who}" + (f" · {reply}" if reply else ""))
        print(f"  id: {r.get('id')}")
        print(f"  {msg}")
        if r.get("context"):
            print(f"  ctx: {' '.join(str(r['context']).split())[:160]}")
    print("\n" + "─" * 60)
    print("Triage rule: every one becomes a BACKLOG item or an explicit 'not doing, because'.")


if __name__ == "__main__":
    main()
