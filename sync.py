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
import time
import base64
import urllib.request
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(HERE, ".simplefin")            # access URL (credential)
OUT = os.path.join(HERE, "data", "balances.json")    # what the dashboard reads

# Some servers reject the default "Python-urllib" agent with a 403, so we
# identify as a normal client.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) money-sync/1.0")


def claim_setup_token(setup_token):
    """Exchange a one-time setup token for a durable access URL."""
    token = "".join(setup_token.split())  # drop any spaces / newlines from pasting
    token += "=" * (-len(token) % 4)      # fix base64 padding if needed
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
    req = urllib.request.Request(
        claim_url, data=b"", method="POST", headers={"User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        access_url = r.read().decode("utf-8").strip()
    with open(SECRET, "w") as f:
        f.write(access_url)
    os.chmod(SECRET, 0o600)  # owner read/write only
    print("✓ Claimed. Access credential saved to .simplefin (gitignored, chmod 600).")
    return access_url


def fetch_accounts(access_url, start_date=None):
    """GET /accounts from SimpleFIN. Pass start_date (unix secs) to include
    transactions since then."""
    p = urllib.parse.urlparse(access_url)
    auth = base64.b64encode(f"{p.username}:{p.password}".encode()).decode()
    base = f"{p.scheme}://{p.hostname}{p.path}"
    url = base + "/accounts"
    if start_date:
        url += "?start-date=" + str(int(start_date))
    req = urllib.request.Request(
        url, headers={"Authorization": "Basic " + auth, "User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    args = sys.argv[1:]

    if args and args[0] == "setup":
        # Prefer an interactive prompt — avoids shell quoting/paste mishaps.
        token = args[1] if len(args) > 1 else input(
            "\nPaste your SimpleFIN setup token, then press Enter:\n> "
        )
        access_url = claim_setup_token(token)
    else:
        if not os.path.exists(SECRET):
            print("No connection yet. First run:")
            print("    python3 sync.py setup YOUR_SETUP_TOKEN")
            sys.exit(1)
        access_url = open(SECRET).read().strip()

    # pull ~35 days of transactions so we can gauge spending pace
    window_days = 30
    now = int(time.time())
    data = fetch_accounts(access_url, now - (window_days + 5) * 86400)

    accounts = []
    total = 0.0
    cash = 0.0          # money you actually have (positive balances only)
    outflow = 0.0       # spending over the window
    cutoff = now - window_days * 86400

    for a in data.get("accounts", []):
        bal = float(a.get("balance", 0) or 0)
        total += bal
        if bal > 0:
            cash += bal
        for t in (a.get("transactions") or []):
            try:
                posted = int(t.get("posted", 0))
                amt = float(t.get("amount", 0) or 0)
            except (TypeError, ValueError):
                continue
            if posted >= cutoff and amt < 0:
                outflow += -amt
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
        "cash": round(cash, 2),
        "burn_per_day": round(outflow / window_days, 2),
        "spend_window_days": window_days,
        "accounts": accounts,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    os.chmod(OUT, 0o600)  # owner read/write only

    # note: we deliberately don't print balances/totals to the terminal
    print(f"✓ Synced {len(accounts)} account(s) + spending pace.")
    print("  Reload the dashboard to see it.")


if __name__ == "__main__":
    main()
