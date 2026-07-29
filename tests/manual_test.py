# Manual accounts (Money Truth arc, Brick 4) — the debt a sync can't see.
#
# A typed-balance account must: join the snapshot's accounts/total/cash (badged manual),
# move Total IMMEDIATELY on edit via recompute_manual (not at the next bank pull), and
# converge across devices through the SAME merge-map machinery as categories — newest-
# per-key by account id, with removal as a {removed:1} VALUE (an absent key can't
# propagate a deletion; a newer removed-value wins the merge everywhere). Fixtures are
# placeholders only — never real bank data.
import os, tempfile, time
import store

def fresh_store():
    D = tempfile.mkdtemp()
    store.DATA = D
    for attr in ["CATEGORIES", "INCOME", "SUBS", "INCOME_LINKS", "MAPMETA", "BALANCES",
                 "TRANSACTIONS", "LEDGER", "LEDGER_OLD", "MONTHLY", "COVERAGE", "CATMETA",
                 "HISTORY", "MANUAL", "DELETED"]:
        if hasattr(store, attr):
            setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
    store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                        "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS,
                        "manual_accounts.json": store.MANUAL}
    store.BACKUPS = os.path.join(D, "backups")
    store._CATMETA_CACHE = None
    return D

p = f = 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

# ── device A: create + snapshot inclusion ──
fresh_store()
store.save_manual_account("mAAA", {"name": "Old Card", "balance": -450.25, "apr": 24.9})
snap, _ = store.build_snapshot([{ "id": "a1", "name": "Everyday Checking", "balance": 1000.0,
                                  "currency": "USD", "transactions": [] }], window_days=30)
manual = [a for a in snap["accounts"] if a.get("manual")]
ok("snapshot carries the manual account, badged", len(manual) == 1 and manual[0]["org"] == "manual")
ok("as-of date stamped", bool(manual[0]["as_of"]))
ok("APR kept", manual[0]["apr"] == 24.9)
ok("Total includes the typed debt (1000 - 450.25)", snap["total"] == 549.75)
ok("cash stays cash-only (debt never inflates it)", snap["cash"] == 1000.0)

# ── an edit moves Total NOW (recompute_manual, no bank pull) ──
store._write(store.BALANCES, {"updated": "u1", "rev": 3, "accounts": snap["accounts"],
                              "total": snap["total"], "cash": snap["cash"]})
store.save_manual_account("mAAA", {"name": "Old Card", "balance": -400.25})
res = store.recompute_manual()
bal = store._read(store.BALANCES, {})
ok("recompute_manual moves Total immediately (1000 - 400.25)", bal["total"] == 599.75)
ok("rev bumped so widgets re-pull", bal["rev"] > 3)
ok("synced account untouched", any(a["name"] == "Everyday Checking" and a["balance"] == 1000.0 for a in bal["accounts"]))

# capture device A's map + meta for the cross-device legs
a_map = open(store.MANUAL).read()
a_meta = store.load_mapmeta().get("manual_accounts.json", {})

# ── device B: adopts A's account, adds its own, removal round-trips ──
fresh_store()
store.save_manual_account("mBBB", {"name": "Store Card", "balance": -120.0})
res = store.merge_maps({"manual_accounts.json": a_map}, {"manual_accounts.json": a_meta})
merged = store.live_manual_accounts()
ok("cross-device merge: BOTH accounts survive (newest-per-key)", set(merged.keys()) == {"mAAA", "mBBB"})
ok("adopted balance is A's newest (-400.25)", merged["mAAA"]["balance"] == -400.25)

# B removes A's account → the removal VALUE must win on A
time.sleep(0.02)   # strictly-newer stamp
store.save_manual_account("mAAA", {"remove": 1})
b_map = open(store.MANUAL).read()
b_meta = store.load_mapmeta().get("manual_accounts.json", {})
fresh_store()
store._write(store.MANUAL, __import__("json").loads(a_map))   # device A still holds the live account
store.merge_maps({"manual_accounts.json": b_map}, {"manual_accounts.json": b_meta})
ok("a removal PROPAGATES (removed-value outranks the stale live copy)",
   "mAAA" not in store.live_manual_accounts())
ok("…but B's own account arrived alive", "mBBB" in store.live_manual_accounts())

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
