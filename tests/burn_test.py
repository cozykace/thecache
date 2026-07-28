# Honest burn — transfers are NEVER spending, on EVERY path (Money Truth arc, Brick 1).
#
# The bug this pins down (found by the Life Pilot on live data): build_snapshot — the one
# function that writes balances.json — never excluded transfers, so burn_per_day /
# spending.total / the trend ran ~hot by every dollar the user moved between their own
# pockets; and recompute_spending (the categorize-edit path) rewrote the category list but
# left the TOTALS at the last sync's numbers, so manually tagging a txn "transfer" removed
# it from the list while the burn stayed inflated. Both an auto-detected transfer and a
# USER-categorized one must vanish from spending totals, burn, and trend everywhere —
# snapshot, period_summary, Months — with one consistent rule, surfaced as the
# spending.transfers footnote. Fixtures are placeholders only — never real bank data.
import os, tempfile, time
import store

D = tempfile.mkdtemp()
store.DATA = D
for attr in ["CATEGORIES", "INCOME", "SUBS", "INCOME_LINKS", "MAPMETA", "CHECKIN_LOG", "BALANCES",
             "TRANSACTIONS", "LEDGER", "LEDGER_OLD", "MONTHLY", "COVERAGE", "CATMETA", "HISTORY"]:
    if hasattr(store, attr):
        setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                    "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS}
store.BACKUPS = os.path.join(D, "backups")

p = f = 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

now = int(time.time()); day = 86400
# the user's hand-categorized transfer: nothing in the description auto-matches a rule
store._write(store.CATEGORIES, {"acme card svc": "transfer"})

txns = [
    {"id": "t1", "posted": now - 2 * day, "amount": -10.0, "description": "Merchant A", "account": "Acct X"},
    {"id": "t2", "posted": now - 3 * day, "amount": -25.0, "description": "Online Transfer to Savings", "account": "Acct X"},  # AUTO-detected
    {"id": "t3", "posted": now - 4 * day, "amount": -35.0, "description": "Acme Card Svc 9812", "account": "Acct X"},          # USER-categorized
    {"id": "t4", "posted": now - 1 * day, "amount": 500.0, "description": "Payroll Co", "account": "Acct X"},
    {"id": "t5", "posted": now - 20 * day, "amount": -8.0, "description": "Merchant B Coffee", "account": "Acct X"},           # older half — trend fuel
]
accounts = [{"id": "a1", "name": "Acct X", "balance": 100.0, "currency": "USD", "transactions": txns}]

# ── build_snapshot: the leaky path, now sealed ──
snap, _txns = store.build_snapshot(accounts, window_days=30, now=now)
sp = snap["spending"]
ok("snapshot: spending.total excludes BOTH transfer kinds (10+8, not 78)", sp["total"] == 18.0)
ok("snapshot: burn_per_day excludes transfers", snap["burn_per_day"] == round(18.0 / 30, 2))
ok("snapshot: per_day mirrors burn", sp["per_day"] == snap["burn_per_day"])
ok("snapshot: no 'transfer' category in the split", all(c["key"] != "transfer" for c in sp["categories"]))
ok("snapshot: excluded transfers surfaced as the footnote (25+35)", sp.get("transfers") == 60.0)
ok("snapshot: income untouched by the exclusion", snap["income"]["total"] == 500.0)
# trend halves: recent(≤15d)=10+... t1,t2,t3 recent; only t1 (10) counts; older: t5 (8)
ok("snapshot: trend computed on transfer-free halves", sp["trend_pct"] == round((10.0 / 15 - 8.0 / 15) / (8.0 / 15) * 100))

# ── period_summary + Months agree (the ledger paths) ──
store.merge_ledger(txns)
ps = store.period_summary(kind="30d", now=now)
ok("period_summary 30d: total matches the snapshot rule", ps["spending"]["total"] == 18.0)
ok("period_summary 30d: transfers footnote matches", ps["spending"]["transfers"] == 60.0)
months = store.monthly_history(limit=3)
tot_spend = round(sum(m["spending"] for m in months), 2)
ok("Months: no month carries transfer spend (sum == 18)", tot_spend == 18.0)

# ── recompute_spending: the categorize-edit path recomputes TOTALS, not just the list ──
store._write(store.TRANSACTIONS, {"updated": "u1", "window_days": 30, "transactions": txns})
# a stale snapshot from before the user's transfer tag — totals inflated by 35
store._write(store.BALANCES, {"updated": "u1", "total": 100, "accounts": [], "burn_per_day": 9.99,
                              "spending": {"window_days": 30, "total": 53.0, "per_day": 1.77,
                                           "per_month": 53.0, "categories": []}})
sp2 = store.recompute_spending()
bal2 = store._read(store.BALANCES, {})
ok("recompute: total drops the tagged transfer (53 → 18)", sp2["total"] == 18.0)
ok("recompute: burn_per_day follows", bal2["burn_per_day"] == round(18.0 / 30, 2))
ok("recompute: per_month follows", sp2["per_month"] == round(18.0 / 30 * 30, 2))
ok("recompute: transfers footnote written", sp2.get("transfers") == 60.0)
ok("recompute: no transfer category resurrected", all(c["key"] != "transfer" for c in sp2["categories"]))

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
