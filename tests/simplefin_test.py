# THE CACHE — SimpleFIN consumer conformance (sync.py + store.py parse path).
#
# Covers the bank-pull's read of a /accounts response against the SimpleFIN
# protocol (simplefin.org/protocol.html, v2.0.0-draft): error surfacing, the
# v1↔v2 org/errlist shape shift, decimal-string amount parsing, and the guard
# that a failed pull can never silently zero out good local data.
#
# Plain python + stdlib. Fixtures are PLACEHOLDERS only — never real bank data.
import store
import sync

p = f = 0
def ok(name, cond):
    global p, f
    p += 1
    if not cond:
        f += 1
        print("FAIL  " + name)
    else:
        print("  ok  " + name)

# ── extract_errors: v2 `errlist` (structured) + deprecated v1 `errors` (strings) ──
ok("errlist: structured error → msg surfaced",
   store.extract_errors({"errlist": [{"code": "con.auth", "msg": "Authentication required"}]})
   == ["Authentication required"])
ok("errlist: code-only error falls back to the code",
   store.extract_errors({"errlist": [{"code": "act.failed"}]}) == ["act.failed"])
ok("errors: deprecated v1 string array passes through",
   store.extract_errors({"errors": ["Bank is down for maintenance"]})
   == ["Bank is down for maintenance"])
both = store.extract_errors({"errlist": [{"msg": "One"}], "errors": ["Two"]})
ok("both errlist + errors are surfaced together", both == ["One", "Two"])
ok("errors are de-duped in order",
   store.extract_errors({"errlist": [{"msg": "Dup"}], "errors": ["Dup"]}) == ["Dup"])
ok("empty / missing / non-dict → no errors",
   store.extract_errors({"errlist": [], "accounts": []}) == []
   and store.extract_errors({}) == [] and store.extract_errors(None) == [])

# sanitization: third-party text must be de-fanged before it can reach the UI
dirty = store.extract_errors({"errlist": [{"msg": "line one\nline two\t\x00end"}]})
ok("sanitize: control chars / newlines collapse to spaces",
   dirty == ["line one line two end"])
longmsg = store.extract_errors({"errlist": [{"msg": "x" * 500}]})[0]
ok("sanitize: over-long message is capped at 200 chars", len(longmsg) == 200)

# ── _account_org_name: institution label across protocol versions ──
ok("org v1: nested org.name",
   store._account_org_name({"org": {"name": "First Bank"}}, {}) == "First Bank")
ok("org v2: resolved from Connection by conn_id (org_name)",
   store._account_org_name({"conn_id": "C1"},
                           {"C1": {"conn_id": "C1", "org_name": "First Bank"}}) == "First Bank")
ok("org v2: Connection with only `name` still resolves",
   store._account_org_name({"conn_id": "C1"}, {"C1": {"name": "First Bank - Jeff"}})
   == "First Bank - Jeff")
ok("org v2: falls back to the account's own conn_name",
   store._account_org_name({"conn_id": "C9", "conn_name": "First Bank - Jeff"}, {})
   == "First Bank - Jeff")
ok("org: nothing to show → empty string, never a crash",
   store._account_org_name({}, {}) == "")

# ── build_snapshot: decimal-string parse + v2 connections org resolution ──
# The exact shapes the spec shows: balance/amount are numeric STRINGS, posted is
# an epoch int. Placeholder amounts only.
import time as _t
now = int(_t.time())
posted = now - 5 * 86400   # inside the 30-day window
v2_accounts = [{
    "id": "acct-1", "name": "Savings", "conn_id": "C1",
    "currency": "USD", "balance": "100.23", "available-balance": "75.23",
    "balance-date": now,
    "transactions": [
        {"id": "tx-1", "posted": posted, "amount": "-33293.43", "description": "Placeholder Debit"},
        {"id": "tx-2", "posted": posted, "amount": "1000.00", "description": "Placeholder Payroll"},
    ],
}]
v2_conns = [{"conn_id": "C1", "org_name": "First Bank", "name": "First Bank - Jeff"}]
snap, txns = store.build_snapshot(v2_accounts, 30, now, 90, connections=v2_conns)
ok("build_snapshot: decimal-string balance parsed (total = 100.23)", snap["total"] == 100.23)
ok("build_snapshot: decimal-string debit parsed (spending total = 33293.43)",
   snap["spending"]["total"] == 33293.43)
ok("build_snapshot: both transactions captured", len(txns) == 2)
ok("build_snapshot: v2 org label resolved via connections",
   snap["accounts"][0]["org"] == "First Bank")
ok("build_snapshot: currency read straight through", snap["accounts"][0]["currency"] == "USD")

# v1-shape account (nested org) still parses the same way
v1_accounts = [{"id": "a", "name": "Checking", "org": {"name": "Old Bank", "domain": "oldbank.com"},
                "currency": "USD", "balance": "50.00", "transactions": []}]
snap1, _ = store.build_snapshot(v1_accounts, 30, now, 90)
ok("build_snapshot: v1 nested org still shows the bank name", snap1["accounts"][0]["org"] == "Old Bank")

# ── run_sync: a failed pull must NEVER overwrite good local data ──
# Stub the network + every writer so we assert control flow, touch no disk.
_calls = {"save_balances": 0}
sync.fetch_accounts = lambda url, start=None: _calls["_resp"]
store.save_balances = lambda s: _calls.__setitem__("save_balances", _calls["save_balances"] + 1)
store.save_transactions = lambda *a, **k: None
store.merge_ledger = lambda *a, **k: 0
store.recompute_monthly = lambda *a, **k: None
store.recompute_coverage = lambda *a, **k: None
store.append_history = lambda *a, **k: None
store.append_synclog = lambda *a, **k: None
store.backup = lambda *a, **k: None

# Case A: HTTP 200 but errlist non-empty AND zero accounts → RAISE, no write.
_calls["_resp"] = {"errlist": [{"code": "con.auth", "msg": "Login expired"}], "accounts": []}
_calls["save_balances"] = 0
raised = False
try:
    sync.run_sync(access_url="https://u:[email protected]/sf")
except RuntimeError as e:
    raised = "Login expired" in str(e)
ok("run_sync: errors + no accounts RAISES (surfaces the bank message)", raised)
ok("run_sync: errors + no accounts does NOT overwrite balances (no zero-wipe)",
   _calls["save_balances"] == 0)

# Case B: clean pull → 4-tuple, no errors, balances written.
_calls["_resp"] = {"errlist": [], "connections": v2_conns, "accounts": v2_accounts}
_calls["save_balances"] = 0
res = sync.run_sync(access_url="https://u:[email protected]/sf")
ok("run_sync: clean pull returns a 4-tuple", isinstance(res, tuple) and len(res) == 4)
ok("run_sync: clean pull reports no errors", res[3] == [])
ok("run_sync: clean pull writes balances once", _calls["save_balances"] == 1)

# Case C: partial pull (errors + real accounts) → no raise, errors surfaced.
_calls["_resp"] = {"errlist": [{"msg": "One account failed"}], "connections": v2_conns, "accounts": v2_accounts}
_calls["save_balances"] = 0
res = sync.run_sync(access_url="https://u:[email protected]/sf")
ok("run_sync: partial pull does not raise", isinstance(res, tuple) and len(res) == 4)
ok("run_sync: partial pull surfaces the warning", res[3] == ["One account failed"])
ok("run_sync: partial pull still writes the good accounts", _calls["save_balances"] == 1)

print(f"\n{p} passed, {f} failed")
raise SystemExit(1 if f else 0)
