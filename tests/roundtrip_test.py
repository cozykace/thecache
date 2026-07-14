import os, json, tempfile, time
import store

def use(dirpath):
    store.CATEGORIES = os.path.join(dirpath, "categories.json")
    store.INCOME = os.path.join(dirpath, "income.json")
    store.SUBS = os.path.join(dirpath, "subs.json")
    store.INCOME_LINKS = os.path.join(dirpath, "income_links.json")
    store.MAPMETA = os.path.join(dirpath, "_mapmeta.json")
    store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                        "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS}

A, B = tempfile.mkdtemp(), tempfile.mkdtemp()
vault = {"files": {}, "filesMeta": {}}   # what the cloud holds

def push(dirpath):
    """what cloudPush does: merge vault's maps into this device, then export → vault."""
    use(dirpath)
    res = store.merge_maps(vault["files"], vault["filesMeta"])   # adopt-before-seal
    # export just the map files + metas (stand-in for export_data's files/filesMeta)
    for name, path in store.MERGE_MAPS.items():
        vault["files"][name] = json.dumps(store._read(path, {}))
    vault["filesMeta"] = store.load_mapmeta()

def pull(dirpath):
    """what cloudAutoPull does: merge vault's maps into this device."""
    use(dirpath)
    store.merge_maps(vault["files"], vault["filesMeta"])

p, f = 0, 0
def ok(n, c):
    global p, f; p += c; f += (not c); print(("  ok  " if c else "FAIL  ") + n)

# A categorizes X, pushes
use(A); store.save_override("merchantx", "food"); push(A)
# B categorizes Y (hasn't seen X), pushes  → must NOT clobber X
use(B); store.save_override("merchanty", "gas"); push(B)
cats_vault = json.loads(vault["files"]["categories.json"])
ok("round-trip: vault has both X and Y after B's stale push", cats_vault.get("merchantx") == "food" and cats_vault.get("merchanty") == "gas")

# A pulls → should gain Y; B pulls → should gain X
pull(A); a_cats = store._read(os.path.join(A, "categories.json"), {})
pull(B); b_cats = store._read(os.path.join(B, "categories.json"), {})
ok("round-trip: A converged (has X+Y)", a_cats.get("merchantx") == "food" and a_cats.get("merchanty") == "gas")
ok("round-trip: B converged (has X+Y)", b_cats.get("merchantx") == "food" and b_cats.get("merchanty") == "gas")

# conflict: A and B both re-categorize X; B does it LATER → B should win account-wide
use(A); store.save_override("merchantx", "dining"); push(A)
time.sleep(0.01)
use(B); store.save_override("merchantx", "restaurants"); push(B)   # newer
pull(A)
ok("round-trip: newer edit (B) wins the conflict everywhere",
   store._read(os.path.join(A, "categories.json"), {}).get("merchantx") == "restaurants")

# stability: a pull with no new remote edits reports no change (no push loop)
use(A); res = store.merge_maps(vault["files"], vault["filesMeta"])
ok("round-trip: converged pull is a no-op (no loop)", res["changed"] is False)

print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
