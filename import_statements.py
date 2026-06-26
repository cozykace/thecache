#!/usr/bin/env python3
"""
THE CACHE — import bank statements (CSV) into your local ledger.

WHY: SimpleFIN auto-syncs your connected banks already. Use this only for
accounts it can't reach (e.g. Petal) or for older history beyond ~90 days.

TWO WAYS TO IMPORT:
  • In the dashboard: drag a .csv onto the board, or Menu → Import statement.
  • In the terminal: drop .csv files in data/statements/ and run this script.

It auto-detects the date / amount / description columns, dedups against what
you already have (so re-running is safe), merges into the permanent ledger,
and rebuilds the dashboard. The account name comes from the file name
(petal.csv -> "Petal") unless the CSV has an Account column.

All of this stays on your Mac. data/ is gitignored — statements never leave.
"""

import os
import io
import re
import csv
import glob
import hashlib
from collections import Counter
from datetime import datetime

import store

STMTS = os.path.join(store.DATA, "statements")

DATE_KEYS = ("date", "posting date", "posted date", "transaction date", "trans date")
AMT_KEYS = ("amount", "amt")
DEBIT_KEYS = ("debit", "withdrawal", "withdrawals", "money out", "outflow")
CREDIT_KEYS = ("credit", "deposit", "deposits", "money in", "inflow")
DESC_KEYS = ("description", "payee", "name", "memo", "details", "merchant", "transaction")
ACCT_KEYS = ("account", "account name")
ACCT_NUM_KEYS = ("card no", "card number", "account number", "account no", "acct no", "acct number", "card")

DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%m-%d-%Y", "%Y/%m/%d",
                "%d/%m/%Y", "%b %d, %Y", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S")


def _find(headers, keys):
    low = {h.lower().strip(): h for h in headers if h}
    for k in keys:
        if k in low:
            return low[k]
    for h in headers:
        if h and any(k in h.lower() for k in keys):
            return h
    return None


def _parse_date(s):
    s = (s or "").strip()
    for f in DATE_FORMATS:
        try:
            return int(datetime.strptime(s, f).timestamp())
        except ValueError:
            pass
    return None


def _num(x):
    x = (x or "").strip().replace("$", "").replace(",", "")
    neg = x.startswith("(") and x.endswith(")")
    x = x.strip("()")
    if not x:
        return None
    try:
        v = float(x)
    except ValueError:
        return None
    return -v if neg else v


def _parse_amount(row, amt_col, debit_col, credit_col):
    if amt_col:
        return _num(row.get(amt_col))
    d = _num(row.get(debit_col)) if debit_col else None
    c = _num(row.get(credit_col)) if credit_col else None
    if d:
        return -abs(d)
    if c:
        return abs(c)
    return None


def _content_key(t):
    """Fuzzy identity for dedup against already-synced data: same day, same
    amount, same first chunk of description."""
    day = (t.get("posted") or 0) // 86400
    desc = re.sub(r"[^a-z0-9]", "", (t.get("description") or "").lower())[:18]
    return "%s|%s|%s" % (day, round(t.get("amount", 0), 2), desc)


def _gen_id(t):
    raw = "%s|%s|%s|%s" % (t["account"], t["posted"], t["amount"], t["description"])
    return "csv:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _acct_from_name(filename):
    name = os.path.splitext(os.path.basename(filename))[0]
    return re.sub(r"[_\-0-9]+", " ", name).strip().title() or "Imported"


def _last4(s):
    d = re.sub(r"\D", "", s or "")
    return d[-4:] if len(d) >= 4 else None


def _live_account_map():
    """Map last-4 digits -> an existing ledger account name, so an imported
    file merges with the account it belongs to instead of forming a new one."""
    led = store.load_ledger()
    out = {}
    if isinstance(led, dict):
        for t in led.values():
            n = t.get("account")
            if not n:
                continue
            d = re.sub(r"\D", "", n)
            if len(d) >= 4:
                out.setdefault(d[-4:], n)
    return out


def _parse_reader(reader, acct_guess, filename=""):
    """Return (txns, error) from a csv.DictReader."""
    headers = reader.fieldnames or []
    date_col = _find(headers, DATE_KEYS)
    amt_col = _find(headers, AMT_KEYS)
    debit_col = _find(headers, DEBIT_KEYS)
    credit_col = _find(headers, CREDIT_KEYS)
    desc_col = _find(headers, DESC_KEYS)
    acct_col = _find(headers, ACCT_KEYS)
    acctnum_col = _find(headers, ACCT_NUM_KEYS)
    if not date_col or not (amt_col or debit_col or credit_col):
        seen = ", ".join(h for h in headers if h) or "(no header row)"
        return [], "couldn't find date/amount columns — saw: %s" % seen
    # figure out which real account this file belongs to (so it merges with live)
    live = _live_account_map()
    fname_acct = None
    for grp in re.findall(r"\d{4}", filename or ""):
        if grp in live:
            fname_acct = live[grp]
            break
    txns = []
    for row in reader:
        posted = _parse_date(row.get(date_col))
        amt = _parse_amount(row, amt_col, debit_col, credit_col)
        if posted is None or amt is None:
            continue
        desc = (row.get(desc_col) or "").strip() if desc_col else ""
        acct = (row.get(acct_col) or "").strip() if acct_col else ""
        if not acct and acctnum_col:
            l4 = _last4(row.get(acctnum_col) or "")
            if l4 and l4 in live:
                acct = live[l4]
        if not acct:
            acct = fname_acct or acct_guess
        t = {"id": None, "posted": posted, "amount": round(amt, 2),
             "description": desc, "account": acct}
        t["id"] = _gen_id(t)
        txns.append(t)
    return txns, None


def parse_file(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return _parse_reader(csv.DictReader(f), _acct_from_name(path), os.path.basename(path))


def parse_text(text, filename="import.csv"):
    reader = csv.DictReader(io.StringIO(text))
    return _parse_reader(reader, _acct_from_name(filename), filename)


def import_records(txns):
    """Dedup against the ledger, merge the new ones, rebuild the dashboard.
    Returns a summary dict (counts only — safe to log)."""
    led = store.load_ledger()  # safe loader — never silently empty
    # Dedup by a MULTISET of content-keys, not a set: if the ledger already has
    # one "$4.50 BLUE BOTTLE on Jun 3" we skip ONE matching import row, but a
    # genuine second identical purchase the same day still comes through.
    have = Counter(_content_key(t) for t in led.values())
    used = Counter()
    new_txns, dup = [], 0
    for t in txns:
        ck = _content_key(t)
        used[ck] += 1
        if used[ck] <= have[ck]:
            dup += 1  # this occurrence is already represented in the ledger
            continue
        t = dict(t)
        if used[ck] > 1:  # unique id per occurrence so repeats can't overwrite each other
            t["id"] = t["id"] + "-" + str(used[ck])
        new_txns.append(t)
    if not new_txns:
        return {"new": 0, "dup": dup, "window": None, "ledger": len(led)}
    store.merge_ledger(new_txns)
    window, total = store.rebuild_from_ledger()
    store.backup(force=True)
    return {"new": len(new_txns), "dup": dup, "window": window, "ledger": total}


def main():
    os.makedirs(STMTS, exist_ok=True)
    files = sorted(glob.glob(os.path.join(STMTS, "*.csv")))
    if not files:
        print("No CSV files found.")
        print("  → Drop your bank's CSV exports into: %s" % STMTS)
        print("  → Then run this again: python3 import_statements.py")
        return
    all_txns = []
    for path in files:
        txns, err = parse_file(path)
        base = os.path.basename(path)
        if err:
            print("  ✗ %s — %s" % (base, err))
            continue
        print("  ✓ %s — %d rows" % (base, len(txns)))
        all_txns.extend(txns)
    if not all_txns:
        print("Nothing to import.")
        return
    s = import_records(all_txns)
    if s["new"] == 0:
        print("Nothing new — all %d rows already in your ledger." % s["dup"])
        return
    print("Imported %d new (%d already had). Ledger now %d; summary window %d."
          % (s["new"], s["dup"], s["ledger"], s["window"]))
    print("Reload the dashboard to see them.")


if __name__ == "__main__":
    main()
