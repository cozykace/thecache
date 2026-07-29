# Account roles — what each account IS (liquid / short / long / untouchable).
# A merge map keyed by ACCOUNT ID (exact case — ids aren't merchant substrings), synced
# newest-per-key like categories/manual accounts. Clearing a role removes the key (back to
# the name guess). Fixtures are placeholders only — never real bank data.
import os, tempfile, time
import store

def fresh():
    D = tempfile.mkdtemp()
    store.DATA = D
    for attr in ["CATEGORIES", "INCOME", "SUBS", "INCOME_LINKS", "MAPMETA", "CATMETA",
                 "MANUAL", "ROLES", "DELETED", "BALANCES"]:
        if hasattr(store, attr):
            setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
    store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                        "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS,
                        "account_roles.json": store.ROLES}
    store._CATMETA_CACHE = None

p = f = 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

fresh()
store.save_account_role("Acct-MiXeD-01", "untouchable")
store.save_account_role("acct2", "long")
roles = store.load_account_roles()
ok("roles saved under EXACT ids (case preserved)", roles.get("Acct-MiXeD-01") == "untouchable")
ok("second role lands", roles.get("acct2") == "long")
ok("an invalid role is refused", store.save_account_role("acct3", "yolo").get("acct3") is None)
store.save_account_role("acct2", "auto")
ok("'auto' clears back to the name guess (key removed)", "acct2" not in store.load_account_roles())
ok("the per-key mtime was stamped (merge-ready)",
   "Acct-MiXeD-01" in (store.load_mapmeta().get("account_roles.json") or {}))

# cross-device: B's newer edit to the SAME account wins; A's other account survives
a_map = open(store.ROLES).read()
a_meta = store.load_mapmeta().get("account_roles.json", {})
fresh()
time.sleep(0.02)
store.save_account_role("Acct-MiXeD-01", "short")   # device B reclassifies, later
b_map = open(store.ROLES).read()
b_meta = store.load_mapmeta().get("account_roles.json", {})
fresh()
import json as _j
store._write(store.ROLES, _j.loads(a_map))
mm = store.load_mapmeta(); mm["account_roles.json"] = dict(a_meta); store._write(store.MAPMETA, mm)
store._MAPMETA_CACHE = None if hasattr(store, "_MAPMETA_CACHE") else None
store.merge_maps({"account_roles.json": b_map}, {"account_roles.json": b_meta})
ok("newest-per-key: B's later reclassification wins on A",
   store.load_account_roles().get("Acct-MiXeD-01") == "short")

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
