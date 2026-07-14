import os, json, tempfile, time
import store

def use(d):
    for attr in ["CATEGORIES","INCOME","SUBS","INCOME_LINKS","MAPMETA","CATMETA"]:
        setattr(store, attr, os.path.join(d, os.path.basename(getattr(store, attr))))
    store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                        "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS}
    store._CATMETA_CACHE = None   # each "device" has its own registry cache

A, B = tempfile.mkdtemp(), tempfile.mkdtemp()
vault = {"files": {}, "filesMeta": {}}
NAMES = ["categories.json","income.json","subs.json","income_links.json","catmeta.json"]

def push(d):
    use(d); store.merge_maps(vault["files"], vault["filesMeta"])
    for n, p in list(store.MERGE_MAPS.items()) + [("catmeta.json", store.CATMETA)]:
        vault["files"][n] = json.dumps(store._read(p, {}))
    vault["filesMeta"] = store.load_mapmeta()
def pull(d):
    use(d); return store.merge_maps(vault["files"], vault["filesMeta"])

p=f=0
def ok(n,c):
    global p,f; p+=c; f+=(not c); print(("  ok  " if c else "FAIL  ")+n)

# A renames a category and creates a custom one; B creates a DIFFERENT custom one
use(A); store.rename_category("groceries", "Food & Home"); store.create_category("Coffee Fund")
use(B); store.create_category("Gear")

push(A)          # A publishes
pull(B); push(B) # B merges A's, publishes union
pull(A)

use(A); ca = store.load_catmeta()
use(B); cb = store.load_catmeta()
ok("rename reached the other desktop", cb["labels"].get("groceries") == "Food & Home")
ok("A kept its own rename", ca["labels"].get("groceries") == "Food & Home")
ok("both hold BOTH custom categories (union)", set(ca["custom"]) == set(cb["custom"]) and len(ca["custom"]) >= 2)
ok("custom list is SORTED identically on both (no order livelock)", ca["custom"] == cb["custom"] == sorted(ca["custom"]))

# converged → a further pull changes nothing on either side (no ping-pong)
ok("converged pull is a no-op on A", pull(A)["changed"] is False)
ok("converged pull is a no-op on B", pull(B)["changed"] is False)

# conflict: both rename the SAME category; B does it LATER → B wins everywhere
use(A); store.rename_category("gas", "Fuel"); push(A)
time.sleep(0.01)
use(B); store.rename_category("gas", "Petrol"); push(B)
pull(A); use(A)
ok("newer rename wins the conflict on both", store.load_catmeta()["labels"].get("gas") == "Petrol")

# the registry rides the same stamp map as the tag maps
meta = store.load_mapmeta()
ok("catmeta entries are stamped in _mapmeta", any(k.startswith("labels:") for k in meta.get("catmeta.json", {})))

print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
