import os, json, tempfile, time
import store

def use(d):
    for attr in ["CATEGORIES","INCOME","SUBS","INCOME_LINKS","MAPMETA","CATMETA","DELETED",
                 "CHECKIN_LOG","BALANCES","TRANSACTIONS","LEDGER","LEDGER_OLD","MONTHLY","COVERAGE","HISTORY"]:
        if hasattr(store, attr):
            setattr(store, attr, os.path.join(d, os.path.basename(getattr(store, attr))))
    store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                        "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS,
                        "deleted.json": store.DELETED}
    store.BACKUPS = os.path.join(d, "backups")
    store._CATMETA_CACHE = None

A, B = tempfile.mkdtemp(), tempfile.mkdtemp()
vault = {"files": {}, "filesMeta": {}}
NAMES = ["categories.json","income.json","subs.json","income_links.json","deleted.json","catmeta.json"]
def push(d):
    use(d); store.merge_maps(vault["files"], vault["filesMeta"])
    for n, p in list(store.MERGE_MAPS.items()) + [("catmeta.json", store.CATMETA)]:
        vault["files"][n] = json.dumps(store._read(p, {}))
    vault["filesMeta"] = store.load_mapmeta()
def pull(d):
    use(d); store.merge_maps(vault["files"], vault["filesMeta"])

p=f=0
def ok(n,c):
    global p,f; p+=c; f+=(not c); print(("  ok  " if c else "FAIL  ")+n)

now = int(time.time()); day=86400
T = [{"id":"t1","posted":now-2*day,"amount":-10.0,"description":"Dup Merchant","account":"Acct X"},
     {"id":"t2","posted":now-1*day,"amount":-20.0,"description":"Real Merchant","account":"Acct X"}]
for d in (A,B):
    use(d)
    store._write(store.BALANCES, {"updated":"u","total":0,"accounts":[],"spending":{"window_days":30}})
    store._write(store.TRANSACTIONS, {"updated":"u","window_days":30,"transactions":T})
    store.merge_ledger(list(T))

# A deletes the duplicate
use(A); res = store.delete_txn("t1")
ok("delete: removed from A's ledger", res["found"] is True and "t1" not in store.load_ledger())
ok("delete: tombstone recorded with the txn kept for undo",
   store.load_deleted().get("t1", {}).get("deleted") == 1 and store.load_deleted()["t1"]["txn"]["id"] == "t1")

# a BANK SYNC on A that re-sends the same txn must NOT resurrect it
use(A); store.merge_ledger(list(T))
ok("sync: a re-sent deleted txn is NOT resurrected", "t1" not in store.load_ledger())
ok("sync: the real txn is untouched", "t2" in store.load_ledger())

# the delete PROPAGATES to device B (which still has t1)
push(A); pull(B)
use(B)
ok("cross-device: B adopted the tombstone", store.is_deleted("t1") is True)
ok("cross-device: the delete APPLIES on B (row dropped from its ledger)", "t1" not in store.load_ledger())
ok("cross-device: B's other txns survive", "t2" in store.load_ledger())
use(B); store.merge_ledger(list(T))   # B's next bank sync re-sends it
ok("cross-device: B's sync can't re-add it either", "t1" not in store.load_ledger())

# a RESTORE from an older vault (which still contains t1) must NOT resurrect it on A
use(A)
old_bundle = {"ledger.jsonl": "\n".join(json.dumps(t) for t in T)}
store.import_data(old_bundle, {}, None)
ok("restore: an older vault can't resurrect the deleted txn", "t1" not in store.load_ledger())
ok("restore: the real txn survives", "t2" in store.load_ledger())

# UNDO puts it back
use(A); u = store.undelete_txn("t1")
ok("undo: reported restored", u["ok"] is True and u["restored"] is True)
ok("undo: txn is back in the ledger", "t1" in store.load_ledger())
ok("undo: tombstone flipped off", store.is_deleted("t1") is False)
ok("undo: it no longer shows in the undo list", not any(x["id"]=="t1" for x in store.deleted_list()))

# and the UNDO propagates too (it must outrank B's older tombstone)
push(A); pull(B); use(B)
ok("cross-device: the undo beats B's older tombstone", store.is_deleted("t1") is False)
ok("cross-device: the undo puts the txn back in B's ledger too", "t1" in store.load_ledger())

# the undo list shows what you deleted, with enough to recognise it
use(A); store.delete_txn("t2")
lst = store.deleted_list()
ok("undo list: shows the deleted txn with its description", any(x["id"]=="t2" and x["description"]=="Real Merchant" for x in lst))

print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
