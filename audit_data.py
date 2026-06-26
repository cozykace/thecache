#!/usr/bin/env python3
"""
THE CACHE — data audit. Answers "do I have all my data, for every account?"

Run:  python3 audit_data.py

Shows, per account: how many transactions, the date range, and whether that
data is live-synced, imported from CSV, or both — and flags any CSV sitting in
data/statements/ that still has rows you haven't imported. Accounts whose
history is only ~3 months deep (the live-sync limit) get a ⚠ so you know an
older CSV export would fill them in.

Read-only. Nothing leaves your Mac.
"""
import os
import glob
from datetime import datetime

import store
import import_statements as imp


def d(ts):
    return datetime.fromtimestamp(ts).strftime("%b %d %Y") if ts else "—"


def main():
    cov = store.data_coverage()
    accts = cov.get("accounts", [])
    print("LEDGER — %d transactions across %d accounts" % (cov.get("total", 0), len(accts)))
    print("Live sync reaches: %s → %s\n" % (d(cov.get("live_first")), d(cov.get("live_last"))))

    now = datetime.now().timestamp()
    print("Per account (count · range · source):")
    for a in sorted(accts, key=lambda x: -x["count"]):
        deep_days = (now - (a["first"] or now)) / 86400
        flag = ""
        if a["source"] == "live" and deep_days < 120:
            flag = "   ⚠ only ~%d days deep — an older CSV export would extend it" % deep_days
        print("  • %-26s %4d txns   %s → %s   [%s]%s" % (
            (a["account"] or "?")[:26], a["count"], d(a["first"]), d(a["last"]), a["source"], flag))

    print("\nPending CSVs in data/statements/:")
    led = store.load_ledger()
    ex_ids = set(led.keys())
    ex_content = {imp._content_key(t) for t in led.values()}
    files = sorted(glob.glob(os.path.join(store.DATA, "statements", "*.csv")))
    if not files:
        print("  (none here yet — drop bank CSV exports in data/statements/, then run import_statements.py)")
        return
    for p in files:
        txns, err = imp.parse_file(p)
        b = os.path.basename(p)
        if err:
            print("  ✗ %-44s %s" % (b[:44], err))
            continue
        new = sum(1 for t in txns if not (t["id"] in ex_ids or imp._content_key(t) in ex_content))
        mark = "✓ all imported" if new == 0 else "→ %d NEW — run: python3 import_statements.py" % new
        print("  • %-44s %s" % (b[:44], mark))


if __name__ == "__main__":
    main()
