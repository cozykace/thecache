import os, json, tempfile, time
import store

D = tempfile.mkdtemp()
store.DATA = D
for attr in ["CATEGORIES","INCOME","SUBS","INCOME_LINKS","MAPMETA","CHECKIN_LOG","BALANCES",
             "TRANSACTIONS","LEDGER","LEDGER_OLD","MONTHLY","COVERAGE","CATMETA","HISTORY"]:
    if hasattr(store, attr):
        setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                    "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS}
store.BACKUPS = os.path.join(D, "backups")

p=f=0
def ok(n,c):
    global p,f; p+=c; f+=(not c); print(("  ok  " if c else "FAIL  ")+n)
def rev():
    return int(store._read(store.BALANCES, {}).get("rev") or 0)

now = int(time.time()); day = 86400
txns = [
    {"id":"t1","posted":now-2*day,"amount":-10.0,"description":"Merchant A","account":"Acct X"},
    {"id":"t2","posted":now-1*day,"amount":500.0,"description":"Payroll Co","account":"Acct X"},
]
store._write(store.TRANSACTIONS, {"updated":"u1","window_days":30,"transactions":txns})
store._write(store.BALANCES, {"updated":"u1","total":100,"accounts":[],"spending":{"window_days":30}})

r0 = rev()
store.recompute_spending()
r1 = rev(); ok("rev bumps on recompute_spending (a categorize)", r1 > r0)
store.recompute_income()
r2 = rev(); ok("rev bumps on recompute_income (an income tag)", r2 > r1)

# a bank sync writes a fresh snapshot — must carry the rev forward, not reset it
store.save_balances({"updated":"u2","total":200,"accounts":[]})
r3 = rev(); ok("rev bumps on save_balances (bank sync) and never resets", r3 > r2)

# `updated` is NOT touched by a recompute — it must stay the bank-sync stamp
store._write(store.BALANCES, dict(store._read(store.BALANCES, {}), updated="u2"))
store._write(store.TRANSACTIONS, {"updated":"u2","window_days":30,"transactions":txns})
before_upd = store._read(store.BALANCES, {}).get("updated")
store.recompute_spending()
after = store._read(store.BALANCES, {})
ok("recompute does NOT touch `updated` (still the sync stamp)", after.get("updated") == before_upd)
ok("...but rev did move", int(after.get("rev") or 0) > r3)

# period_summary surfaces rev so the client can key on it
summ = store.period_summary("mtd")
ok("period_summary exposes rev", "rev" in summ and summ["rev"] == int(after.get("rev") or 0))
ok("period_summary still exposes updated", summ.get("updated") == before_upd)

# the client stamp: changes when rev moves, stable when nothing moves
def stamp(s): return (s.get("updated") or "") + "|" + str(s.get("rev") or 0)
s_a = stamp(summ)
s_b = stamp(store.period_summary("mtd"))
ok("stamp stable when nothing changed (no spurious re-pulls)", s_a == s_b)
store.save_override("merchant a", "food"); store.recompute_spending()
s_c = stamp(store.period_summary("mtd"))
ok("stamp CHANGES after a categorize (widgets now re-pull)", s_c != s_a)

print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
