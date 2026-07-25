#!/usr/bin/env python3
"""
THE CACHE — balance sync (SimpleFIN). Pulls accounts + recent transactions and
hands them to store.py, which categorizes and writes the local data files.
Standard library only — nothing to install.

FIRST TIME:   python3 sync.py setup        (it will prompt for your token)
EVERY TIME:   python3 sync.py
"""

import sys
import os
import time
import json
import base64
import urllib.request
import urllib.parse
import urllib.error

import store

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(HERE, ".simplefin")  # access URL (credential), gitignored
WINDOW_DAYS = 30   # the summary window (spending pace, breakdown)
FETCH_DAYS = 90    # pull this much history each sync (banks vary); ledger keeps it all

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
    # Access URL form: https://<user>:<password>@<host>/<path> — pull the Basic-auth
    # credentials out of the userinfo and send them as an Authorization header (never
    # in the URL, so they can't land in a log). Keep a self-hosted server's port.
    p = urllib.parse.urlparse(access_url)
    auth = base64.b64encode(f"{p.username}:{p.password}".encode()).decode()
    host = p.hostname + (f":{p.port}" if p.port else "")
    url = f"{p.scheme}://{host}{p.path}/accounts"
    if start_date:
        url += "?start-date=" + str(int(start_date))
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth, "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Spec: handle a 403 (access revoked / bad credentials) and a 402 from
        # /accounts, and show the user a clear message — never a raw traceback.
        if e.code == 403:
            raise RuntimeError("Your bank connection was declined (403) — access may have been "
                               "revoked, or the saved credential is no longer valid. Reconnect to fix it.")
        if e.code == 402:
            raise RuntimeError("Your SimpleFIN bridge says payment is required (402) before it will "
                               "share data. Check your SimpleFIN account, then sync again.")
        raise RuntimeError(f"Bank sync failed (HTTP {e.code}).")


def run_sync(access_url=None):
    """Pull from the bank and write the local data files. Callable from server.py so
    the dashboard can trigger a live sync. Returns (snapshot, n_txns, ledger_total,
    errors) — `errors` is the sanitized list of any per-account/connection issues the
    bank reported alongside good data (empty on a clean pull); a pull that returned
    ONLY errors raises instead, so we never overwrite good local data with zeros."""
    if access_url is None:
        if not os.path.exists(SECRET):
            raise RuntimeError("not connected — run: python3 sync.py setup")
        access_url = open(SECRET).read().strip()
    now = int(time.time())
    data = fetch_accounts(access_url, now - (FETCH_DAYS + 2) * 86400)
    accounts = data.get("accounts") or []
    errors = store.extract_errors(data)   # v2 errlist + deprecated v1 errors, sanitized
    # NO accounts → refuse to write, with OR without errors. A 200 can carry errors and no
    # accounts (a bank login expired), but it can also be empty and error-free — either way,
    # writing it would zero out balances.json and blank the transaction window behind a silent
    # "0 transactions". Refuse to overwrite good local data; surface the bank's message if any.
    if not accounts:
        raise RuntimeError(("Bank sync couldn't get your data: " + "; ".join(errors)) if errors
                           else "Bank sync returned no accounts — nothing was changed. Try again in a moment.")
    snapshot, txns = store.build_snapshot(accounts, WINDOW_DAYS, now, FETCH_DAYS,
                                          connections=data.get("connections"))
    store.save_balances(snapshot)
    # transactions.json = recent working window; ledger = everything, forever
    window_cutoff = now - WINDOW_DAYS * 86400
    store.save_transactions([t for t in txns if t["posted"] >= window_cutoff], WINDOW_DAYS)
    total_ledger = store.merge_ledger(txns)
    store.recompute_monthly()  # roll the whole ledger up by month
    store.recompute_coverage()  # what data we have, from where, how far back
    store.append_history(snapshot)
    store.append_synclog(len(snapshot["accounts"]), len(txns))
    try:
        store.backup()  # local daily restore point
    except Exception:
        pass
    return snapshot, len(txns), total_ledger, errors


def main():
    args = sys.argv[1:]
    access_url = None
    if args and args[0] == "setup":
        token = args[1] if len(args) > 1 else input(
            "\nPaste your SimpleFIN setup token, then press Enter:\n> ")
        access_url = claim_setup_token(token)
    elif not os.path.exists(SECRET):
        print("No connection yet. First run:  python3 sync.py setup")
        sys.exit(1)
    snapshot, n, ledger, errors = run_sync(access_url)
    # note: we don't print balances/totals to the terminal
    print(f"✓ Synced {len(snapshot['accounts'])} account(s), {n} transactions ({ledger} kept in ledger).")
    for e in errors:   # partial pull — bank reported an issue on some accounts
        print("  ⚠ " + e)
    print("  Reload the dashboard to see it.")


if __name__ == "__main__":
    main()
