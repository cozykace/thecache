#!/usr/bin/env python3
"""
Money — balance sync (SimpleFIN). Pulls accounts + recent transactions and
hands them to store.py, which categorizes and writes the local data files.
Standard library only — nothing to install.

FIRST TIME:   python3 sync.py setup        (it will prompt for your token)
EVERY TIME:   python3 sync.py
"""

import sys
import os
import time
import base64
import urllib.request
import urllib.parse

import store

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(HERE, ".simplefin")  # access URL (credential), gitignored
WINDOW_DAYS = 30

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) money-sync/1.0")


def claim_setup_token(setup_token):
    token = "".join(setup_token.split())
    token += "=" * (-len(token) % 4)
    try:
        claim_url = base64.b64decode(token).decode("utf-8").strip()
    except Exception:
        print("✗ That doesn't look like a valid setup token.")
        print("  Copy the WHOLE token (and nothing else) from SimpleFIN's")
        print("  'New app connection', then run this again.")
        sys.exit(1)
    if not claim_url.startswith("http"):
        print("✗ That token didn't decode to a valid URL — copy the full token and retry.")
        sys.exit(1)
    req = urllib.request.Request(claim_url, data=b"", method="POST", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        access_url = r.read().decode("utf-8").strip()
    with open(SECRET, "w") as f:
        f.write(access_url)
    os.chmod(SECRET, 0o600)
    print("✓ Claimed. Access credential saved to .simplefin (gitignored, chmod 600).")
    return access_url


def fetch_accounts(access_url, start_date=None):
    p = urllib.parse.urlparse(access_url)
    auth = base64.b64encode(f"{p.username}:{p.password}".encode()).decode()
    base = f"{p.scheme}://{p.hostname}{p.path}"
    url = base + "/accounts"
    if start_date:
        url += "?start-date=" + str(int(start_date))
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        import json
        return json.loads(r.read().decode("utf-8"))


def main():
    args = sys.argv[1:]
    if args and args[0] == "setup":
        token = args[1] if len(args) > 1 else input(
            "\nPaste your SimpleFIN setup token, then press Enter:\n> ")
        access_url = claim_setup_token(token)
    else:
        if not os.path.exists(SECRET):
            print("No connection yet. First run:  python3 sync.py setup")
            sys.exit(1)
        access_url = open(SECRET).read().strip()

    now = int(time.time())
    data = fetch_accounts(access_url, now - (WINDOW_DAYS + 5) * 86400)
    snapshot, txns = store.build_snapshot(data.get("accounts", []), WINDOW_DAYS, now)
    store.save_balances(snapshot)
    store.save_transactions(txns, WINDOW_DAYS)
    store.append_history(snapshot)

    # note: we don't print balances/totals to the terminal
    print(f"✓ Synced {len(snapshot['accounts'])} account(s), {len(txns)} transactions.")
    print("  Reload the dashboard to see it.")


if __name__ == "__main__":
    main()
