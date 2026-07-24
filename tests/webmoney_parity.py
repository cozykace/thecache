#!/usr/bin/env python3
# THE CACHE — JS↔Python money-engine parity.
#
# THE WHOLE BALLGAME (web money import): the browser engine (webmoney.js) must produce the
# SAME snapshot store.py produces for the same input, or web-imported data and desktop data
# disagree in one vault. This harness feeds identical fixtures to BOTH runtimes and asserts
# byte-equal (float-tolerant) results for:
#   1. build_snapshot  — the bank-sync path (total/cash/burn/categories/income/subs)
#   2. rebuild_from_ledger — the ACTUAL CSV-import path (recompute_spending + recompute_income:
#      transfers excluded, balances rebuilt from the ledger window)
# Fixtures are placeholders only — never real bank data (house rule).
import json, os, subprocess, sys, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import store

P = 0
F = 0
def ok(name, cond):
    global P, F
    if cond:
        P += 1
        print("  ok  " + name)
    else:
        F += 1
        print("FAIL  " + name)

def redirect(tmp):
    """Point every store data path at a throwaway dir so the real data/ is never touched
    and the run is deterministic (no ambient overrides)."""
    store.DATA = tmp
    for attr in ("BALANCES", "TRANSACTIONS", "TOGGL", "HISTORY", "CATEGORIES", "INCOME",
                 "MONTHLY", "COVERAGE", "BUGS", "SYNCLOG", "CATMETA", "SUBS",
                 "INCOME_LINKS", "MAPMETA", "DELETED"):
        setattr(store, attr, os.path.join(tmp, attr.lower() + ".json"))
    store.LEDGER = os.path.join(tmp, "ledger.jsonl")
    store.LEDGER_OLD = os.path.join(tmp, "ledger.json")
    store.BACKUPS = os.path.join(tmp, "backups")
    store.CATEGORIES = os.path.join(tmp, "categories.json")
    store.INCOME = os.path.join(tmp, "income.json")
    store.CATMETA = os.path.join(tmp, "catmeta.json")
    store._CATMETA_CACHE = None

def write(tmp, name, obj):
    with open(os.path.join(tmp, name), "w") as f:
        json.dump(obj, f)

def deepclose(a, b, path=""):
    """Structural compare with float tolerance; returns a mismatch string or ''."""
    if isinstance(a, float) or isinstance(b, float):
        try:
            if abs(float(a) - float(b)) <= 1e-6:
                return ""
        except (TypeError, ValueError):
            pass
        return "%s: %r != %r" % (path, a, b)
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return "%s: keys %s != %s" % (path, sorted(a), sorted(b))
        for k in a:
            m = deepclose(a[k], b[k], path + "." + str(k))
            if m:
                return m
        return ""
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return "%s: len %d != %d" % (path, len(a), len(b))
        for i in range(len(a)):
            m = deepclose(a[i], b[i], "%s[%d]" % (path, i))
            if m:
                return m
        return ""
    return "" if a == b else "%s: %r != %r" % (path, a, b)

def run_js(fn, payload):
    """Invoke webmoney.js's fn(payload) in node and return the parsed result."""
    js = (
        "const M=require(%r);"
        "const P=JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(M.%s(P.a, P.b)));"
    ) % (os.path.join(ROOT, "webmoney.js"), fn)
    out = subprocess.check_output(["node", "-e", js, json.dumps(payload)])
    return json.loads(out.decode())

NOW = 1_753_300_000   # a fixed clock so both runtimes window identically
DAY = 86400

# ── 1. build_snapshot parity (bank-sync path) ────────────────────────────────
def test_build_snapshot():
    # a spread of merchants across categories + income + a transfer + an out-of-window txn
    accounts = [{
        "id": "acc1", "name": "Everyday Checking", "org": {"name": "Placeholder Bank"},
        "balance": 1284.55, "currency": "USD",
        "transactions": [
            {"id": "t1", "posted": NOW - 2 * DAY, "amount": -12.47, "description": "STARBUCKS STORE 123"},
            {"id": "t2", "posted": NOW - 3 * DAY, "amount": -85.30, "description": "TRADER JOE'S #455"},
            {"id": "t3", "posted": NOW - 5 * DAY, "amount": -15.99, "description": "SPOTIFY USA"},
            {"id": "t4", "posted": NOW - 10 * DAY, "amount": -42.00, "description": "SHELL OIL 9987"},
            {"id": "t5", "posted": NOW - 20 * DAY, "amount": -9.99, "description": "NETFLIX.COM"},
            {"id": "t6", "posted": NOW - 4 * DAY, "amount": 2100.00, "description": "PAYROLL ADP DIRECT DEP"},
            {"id": "t7", "posted": NOW - 6 * DAY, "amount": 60.00, "description": "ZELLE FROM JANE DOE Bacf1oy"},
            {"id": "t8", "posted": NOW - 8 * DAY, "amount": -200.00, "description": "ONLINE TRANSFER TO SAVINGS"},
            {"id": "t9", "posted": NOW - 40 * DAY, "amount": -33.00, "description": "OLD CHARGE OUT OF WINDOW"},
        ],
    }, {
        "id": "acc2", "name": "Rewards Card", "org": {"name": "Placeholder Bank"},
        "balance": -250.10, "currency": "USD",
        "transactions": [
            {"id": "t10", "posted": NOW - 1 * DAY, "amount": -54.20, "description": "AMAZON MARKETPLACE"},
            {"id": "t11", "posted": NOW - 7 * DAY, "amount": -18.75, "description": "CHIPOTLE 2201"},
            {"id": "t12", "posted": NOW - 9 * DAY, "amount": -3.50, "description": "MONTHLY SERVICE FEE"},
        ],
    }]
    py_snap, _ = store.build_snapshot(accounts, window_days=30, now=NOW)
    js_snap = run_js("buildSnapshot", {"a": accounts, "b": {"windowDays": 30, "now": NOW}})["snapshot"]
    for d in (py_snap, js_snap):
        d.pop("updated", None)
    ok("build_snapshot: no overrides — snapshots equal", deepclose(py_snap, js_snap) == "" or print(deepclose(py_snap, js_snap)))

def test_build_snapshot_overrides(tmp):
    # a category override, an income tag, and a catmeta fold-in (remap) all applied
    overrides = {"jane doe": "income"}   # income tag: JANE DOE deposits count as income
    cats = {"corner bodega": "groceries"}   # teach a merchant
    catmeta = {"labels": {}, "remap": {"music_art": "entertainment"}, "custom": []}
    write(tmp, "categories.json", cats)
    write(tmp, "income.json", overrides)
    write(tmp, "catmeta.json", catmeta)
    store._CATMETA_CACHE = None
    accounts = [{
        "id": "a", "name": "Checking", "org": {"name": "PB"}, "balance": 500.0, "currency": "USD",
        "transactions": [
            {"id": "s1", "posted": NOW - 1 * DAY, "amount": -22.10, "description": "CORNER BODEGA NYC"},
            {"id": "s2", "posted": NOW - 2 * DAY, "amount": -40.00, "description": "SAM ASH MUSIC LA"},   # music_art → entertainment
            {"id": "s3", "posted": NOW - 3 * DAY, "amount": 75.00, "description": "ZELLE FROM JANE DOE Bxyz"},
        ],
    }]
    py_snap, _ = store.build_snapshot(accounts, window_days=30, now=NOW)
    js_snap = run_js("buildSnapshot", {"a": accounts, "b": {
        "windowDays": 30, "now": NOW, "overrides": cats, "incomeOverrides": overrides, "remap": catmeta["remap"]}})["snapshot"]
    for d in (py_snap, js_snap):
        d.pop("updated", None)
    m = deepclose(py_snap, js_snap)
    ok("build_snapshot: overrides+remap+income tag — snapshots equal" + (" · " + m if m else ""), m == "")

# ── 2. rebuild_from_ledger parity (the actual CSV-import path) ────────────────
def test_rebuild(tmp):
    txns = [
        {"id": "csv:1", "posted": NOW - 1 * DAY, "amount": -12.47, "description": "STARBUCKS 1", "account": "Checking"},
        {"id": "csv:2", "posted": NOW - 2 * DAY, "amount": -85.30, "description": "TRADER JOES", "account": "Checking"},
        {"id": "csv:3", "posted": NOW - 3 * DAY, "amount": -15.99, "description": "SPOTIFY", "account": "Checking"},
        {"id": "csv:4", "posted": NOW - 4 * DAY, "amount": -200.00, "description": "TRANSFER TO SAVINGS", "account": "Checking"},   # excluded from spending
        {"id": "csv:5", "posted": NOW - 5 * DAY, "amount": 1500.00, "description": "GUSTO PAYROLL", "account": "Checking"},
        {"id": "csv:6", "posted": NOW - 6 * DAY, "amount": -9.99, "description": "NETFLIX", "account": "Checking"},
        {"id": "csv:7", "posted": NOW - 45 * DAY, "amount": -50.00, "description": "OLD OUT OF WINDOW", "account": "Checking"},
    ]
    ledger_text = "\n".join(json.dumps(t) for t in txns) + "\n"
    with open(store.LEDGER, "w") as f:
        f.write(ledger_text)
    store.rebuild_from_ledger(window_days=30, now=NOW)
    py_bal = store._read(store.BALANCES, {})
    py_txns = store._read(store.TRANSACTIONS, {})
    files = {"ledger.jsonl": ledger_text}
    js_out = run_js("rebuildFromLedger", {"a": files, "b": {"windowDays": 30, "now": NOW}})
    js_bal = json.loads(js_out["balances.json"])
    js_txns = json.loads(js_out["transactions.json"])
    # spending block (transfers excluded), income block, subscriptions block
    ms = deepclose(py_bal.get("spending", {}).get("categories"), js_bal.get("spending", {}).get("categories"))
    ok("rebuild: spending categories equal (transfers excluded)" + (" · " + ms if ms else ""), ms == "")
    mi = deepclose(py_bal.get("income"), js_bal.get("income"))
    ok("rebuild: income block equal" + (" · " + mi if mi else ""), mi == "")
    msu = deepclose(py_bal.get("subscriptions"), js_bal.get("subscriptions"))
    ok("rebuild: subscriptions block equal" + (" · " + msu if msu else ""), msu == "")
    # transactions window: same set + order (both sort by -posted)
    py_ids = [t["id"] for t in py_txns.get("transactions", [])]
    js_ids = [t["id"] for t in js_txns.get("transactions", [])]
    ok("rebuild: 30d window has same txns in same order (out-of-window dropped)", py_ids == js_ids and "csv:7" not in js_ids)
    ok("rebuild: rev bumped twice (spending + income), matching store.py", js_bal.get("rev") == py_bal.get("rev"))

# ── 3. period_summary parity (the live dashboard feed /api/summary) ──────────
def test_period_summary(tmp):
    txns = [
        {"id": "1", "posted": NOW - 1 * DAY, "amount": -30.00, "description": "SAFEWAY 22", "account": "C"},
        {"id": "2", "posted": NOW - 2 * DAY, "amount": -100.00, "description": "TRANSFER TO SAVINGS", "account": "C"},
        {"id": "3", "posted": NOW - 3 * DAY, "amount": -12.99, "description": "SPOTIFY", "account": "C"},
        {"id": "4", "posted": NOW - 4 * DAY, "amount": 1500.00, "description": "GUSTO PAYROLL", "account": "C"},
        {"id": "5", "posted": NOW - 5 * DAY, "amount": -8.50, "description": "STARBUCKS", "account": "C"},
        {"id": "6", "posted": NOW - 200 * DAY, "amount": -500.00, "description": "WAY OLD", "account": "C"},
    ]
    with open(store.LEDGER, "w") as f:
        f.write("\n".join(json.dumps(t) for t in txns) + "\n")
    # a point-in-time balances.json (total/cash/accounts) that period_summary copies through
    balances = {"total": 1284.55, "cash": 1534.65, "rev": 7, "updated": "2026-07-01T00:00:00Z",
                "accounts": [{"id": "C", "name": "Checking", "org": "PB", "balance": 1284.55, "currency": "USD"}]}
    write(tmp, "balances.json", balances)
    for kind in ("mtd", "30d", "90d", "all"):
        py = store.period_summary(kind=kind, now=NOW)
        js = _run_js3("periodSummary", txns, {"kind": kind, "now": NOW},
                      {"balances": balances, "catmetaLabels": {}})
        m = deepclose(py, js)
        ok("period_summary %s: equal to store.period_summary" % kind + (" · " + m if m else ""), m == "")

def _run_js3(fn, a, b, c):
    js = (
        "const M=require(%r);"
        "const P=JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(M.%s(P.a, P.b, P.c)));"
    ) % (os.path.join(ROOT, "webmoney.js"), fn)
    out = subprocess.check_output(["node", "-e", js, json.dumps({"a": a, "b": b, "c": c})])
    return json.loads(out.decode())

# ── 4. CSV parser parity (JS parseCsv vs import_statements.parse_text) ────────
def test_csv_parse(tmp):
    import import_statements as imp
    csv = (
        "Date,Description,Amount,Card Number\n"
        "01/15/2026,\"BODEGA, CORNER LLC\",-12.50,****4821\n"
        "2026-01-16,PAYROLL DEPOSIT,\"$2,000.00\",****4821\n"
        "01-17-2026,BIG ONE,\"($1,234.56)\",****4821\n"
    )
    py_txns, py_err = imp.parse_text(csv, "statement.csv")
    js = (
        "const M=require(%r);"
        "const r=M.parseCsv(process.argv[1], 'statement.csv', {});"
        "console.log(JSON.stringify(r));"
    ) % os.path.join(ROOT, "webmoney.js")
    r = json.loads(subprocess.check_output(["node", "-e", js, csv]).decode())
    js_txns = r["txns"]
    ok("csv-parse: same row count", len(py_txns) == len(js_txns) == 3)
    # ids differ by design (JS djb2 vs Python sha1); compare the MEANINGFUL fields
    fields = lambda t: {k: t[k] for k in ("posted", "amount", "description", "account")}
    match = all(fields(a) == fields(b) for a, b in zip(py_txns, js_txns))
    ok("csv-parse: posted/amount/description/account match import_statements.py", match)
    ok("csv-parse: parenthesized amount → negative in both", py_txns[2]["amount"] == js_txns[2]["amount"] == -1234.56)

# ── 5. CSV parse edge cases parity (sci-notation, %y pivot, non-finite, mixed-case filename) ──
def test_csv_parse_edge(tmp):
    import import_statements as imp

    def js_parse(text, filename):
        js = ("const M=require(%r);"
              "console.log(JSON.stringify(M.parseCsv(process.argv[1], process.argv[2], {})));"
              ) % os.path.join(ROOT, "webmoney.js")
        return json.loads(subprocess.check_output(["node", "-e", js, text, filename]).decode())

    csv = ("Date,Description,Amount\n"
           "01/15/99,OLD YEAR,-10\n"      # %y pivot → 1999 on both sides
           "01/16/2026,SCI,1e3\n"          # scientific notation → 1000 on both
           "01/17/2026,TRAILDOT,5.\n"      # trailing dot → 5 on both
           "01/18/2026,INFROW,inf\n")      # non-finite → dropped by BOTH
    py_txns, _ = imp.parse_text(csv, "s.csv")
    js_txns = js_parse(csv, "s.csv")["txns"]
    ok("csv-edge: 'inf' row dropped by both → same count (3)", len(py_txns) == len(js_txns) == 3)
    fields = lambda t: {k: t[k] for k in ("posted", "amount", "description")}
    ok("csv-edge: %y pivot + sci-notation + trailing-dot match import_statements.py",
       [fields(t) for t in py_txns] == [fields(t) for t in js_txns])
    # mixed-case filename, no account column → account label must match Python str.title()
    csv2 = "Date,Description,Amount\n01/15/2026,COFFEE,-5\n"
    py2, _ = imp.parse_text(csv2, "myCard.csv")
    js2 = js_parse(csv2, "myCard.csv")["txns"]
    ok("csv-edge: mixed-case filename → account label equal (%r)" % py2[0]["account"],
       py2[0]["account"] == js2[0]["account"] == "Mycard")


# ── 6. prototype-key ("constructor") parity — a JS Object.prototype trap Python doesn't have ──
def test_prototype_keys(tmp):
    write(tmp, "categories.json", {"constructor": "subscriptions"})   # a merchant taught to a category, keyed "constructor"
    store._CATMETA_CACHE = None
    txns = [
        {"id": "i1", "posted": NOW - 1 * DAY, "amount": 100.0, "description": "CONSTRUCTOR", "account": "C"},
        {"id": "s1", "posted": NOW - 2 * DAY, "amount": -9.99, "description": "CONSTRUCTOR", "account": "C"},
    ]
    with open(store.LEDGER, "w") as fh:
        fh.write("\n".join(json.dumps(t) for t in txns) + "\n")
    balances = {"total": 0.0, "cash": 0.0, "rev": 1, "updated": "x", "accounts": []}
    write(tmp, "balances.json", balances)
    py = store.period_summary(kind="30d", now=NOW)
    js = _run_js3("periodSummary", txns, {"kind": "30d", "now": NOW},
                  {"balances": balances, "overrides": {"constructor": "subscriptions"}, "catmetaLabels": {}})
    m = deepclose(py, js)
    ok("prototype 'constructor' key: period_summary equal JS<->Python" + (" · " + m if m else ""), m == "")


# ── 7. banker's-round day count parity (the 14.5-day boundary Math.round would miss) ──
def test_banker_days(tmp):
    earliest = NOW - (14 * DAY + DAY // 2)   # exactly 14.5 days before now
    txns = [
        {"id": "a", "posted": earliest, "amount": -10.0, "description": "OLD", "account": "C"},
        {"id": "b", "posted": NOW - 1 * DAY, "amount": -20.0, "description": "NEW", "account": "C"},
    ]
    with open(store.LEDGER, "w") as fh:
        fh.write("\n".join(json.dumps(t) for t in txns) + "\n")
    balances = {"total": 0.0, "cash": 0.0, "rev": 1, "updated": "x", "accounts": []}
    write(tmp, "balances.json", balances)
    py = store.period_summary(kind="all", now=NOW)
    js = _run_js3("periodSummary", txns, {"kind": "all", "now": NOW}, {"balances": balances, "catmetaLabels": {}})
    ok("banker's days: 14.5-day 'all' span → same day count both sides (=%s)" % py["spending"]["window_days"],
       py["spending"]["window_days"] == js["spending"]["window_days"] == 14)
    m = deepclose(py, js)
    ok("banker's days: full period_summary equal" + (" · " + m if m else ""), m == "")


def main():
    tmp = tempfile.mkdtemp(prefix="cache_parity_")
    try:
        redirect(tmp)
        test_build_snapshot()
        # each override test gets a clean subdir so files don't leak between cases
        t2 = os.path.join(tmp, "ov"); os.makedirs(t2, exist_ok=True); redirect(t2)
        test_build_snapshot_overrides(t2)
        t3 = os.path.join(tmp, "rb"); os.makedirs(t3, exist_ok=True); redirect(t3)
        test_rebuild(t3)
        t5 = os.path.join(tmp, "ps"); os.makedirs(t5, exist_ok=True); redirect(t5)
        test_period_summary(t5)
        t4 = os.path.join(tmp, "csv"); os.makedirs(t4, exist_ok=True); redirect(t4)
        test_csv_parse(t4)
        t6 = os.path.join(tmp, "csvedge"); os.makedirs(t6, exist_ok=True); redirect(t6)
        test_csv_parse_edge(t6)
        t7 = os.path.join(tmp, "proto"); os.makedirs(t7, exist_ok=True); redirect(t7)
        test_prototype_keys(t7)
        t8 = os.path.join(tmp, "days"); os.makedirs(t8, exist_ok=True); redirect(t8)
        test_banker_days(t8)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n%d passed, %d failed" % (P, F))
    sys.exit(1 if F else 0)

if __name__ == "__main__":
    main()
