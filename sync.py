#!/usr/bin/env python3
"""
Money — balance sync (SimpleFIN). Pulls your account balances and writes
them to data/balances.json, which the dashboard reads. Uses only the Python
standard library — nothing to install.

Your data stays on this machine. The access credential is saved to a local
file (.simplefin) and your balances to data/balances.json — both are
gitignored and never leave your computer.

FIRST TIME (claim a SimpleFIN setup token, then sync):
    python3 sync.py setup PASTE_YOUR_SETUP_TOKEN_HERE

EVERY TIME AFTER (refresh balances):
    python3 sync.py
"""

import sys
import os
import json
import base64
import urllib.request
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(HERE, ".simplefin")            # access URL (credential)
OUT = os.path.join(HERE, "data", "balances.json")    # what the dashboard reads


def claim_setup_token(setup_token):
    """Exchange a one-time setup token for a durable access URL."""
    token = setup_token.strip()
    token += "=" * (-len(token) % 4)  # fix base64 padding if needed
    claim_url = base64.b64decode(token).decode("utf-8").strip()
    req = urllib.request.Request(claim_url, data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        access_url = r.read().decode("utf-8").strip()
    with open(SECRET, "w") as f:
        f.write(access_url)
    print("✓ Claimed. Access credential saved to .simplefin (gitignored).")
    return access_url


def fetch_accounts(access_url):
    """GET /accounts from SimpleFIN using the credentials in the access URL."""
    p = urllib.parse.urlparse(access_url)
    auth = base64.b64encode(f"{p.username}:{p.password}".encode()).decode()
    base = f"{p.scheme}://{p.hostname}{p.path}"
    req = urllib.request.Request(
        base + "/accounts",
        headers={"Authorization": "Basic " + auth},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    args = sys.argv[1:]

    if args and args[0] == "setup":
        if len(args) < 2:
            print("Usage: python3 sync.py setup YOUR_SETUP_TOKEN")
            sys.exit(1)
        access_url = claim_setup_token(args[1])
    else:
        if not os.path.exists(SECRET):
            print("No connection yet. First run:")
            print("    python3 sync.py setup YOUR_SETUP_TOKEN")
            sys.exit(1)
        access_url = open(SECRET).read().strip()

    data = fetch_accounts(access_url)

    accounts = []
    total = 0.0
    for a in data.get("accounts", []):
        bal = float(a.get("balance", 0) or 0)
        total += bal
        accounts.append({
            "id": a.get("id"),
            "name": a.get("name", "Account"),
            "org": (a.get("org") or {}).get("name", ""),
            "balance": round(bal, 2),
            "currency": a.get("currency", "USD"),
        })

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": round(total, 2),
        "accounts": accounts,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)

    print(f"✓ Synced {len(accounts)} account(s). Total: ${total:,.2f}")
    print("  Reload the dashboard to see it.")


if __name__ == "__main__":
    main()
