import os, json, tempfile, time
import store

# isolate: point every map path + mapmeta at a throwaway temp dir (no real data touched)
d = tempfile.mkdtemp()
store.CATEGORIES = os.path.join(d, "categories.json")
store.INCOME = os.path.join(d, "income.json")
store.SUBS = os.path.join(d, "subs.json")
store.INCOME_LINKS = os.path.join(d, "income_links.json")
store.MAPMETA = os.path.join(d, "_mapmeta.json")
store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                    "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS}

p, f = 0, 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

# ── stamping records changed keys, forgets removed ones ──
store._write(store.CATEGORIES, {})
store.save_override("aaa", "food")
store.save_override("bbb", "rent")
meta = store.load_mapmeta().get("categories.json", {})
ok("stamp: both keys stamped", "aaa" in meta and "bbb" in meta)
t_aaa = meta["aaa"]
time.sleep(0.01)
store.save_override("aaa", "groceries")   # re-categorize → newer stamp
ok("stamp: edit bumps mtime", store.load_mapmeta()["categories.json"]["aaa"] > t_aaa)

# ── merge: additive union (remote has a key local lacks) ──
# local categories currently {aaa:groceries, bbb:rent}; remote adds ccc
rem_files = {"categories.json": json.dumps({"ccc": "gas"})}
rem_meta = {"categories.json": {"ccc": store._now_ms()}}
res = store.merge_maps(rem_files, rem_meta)
loc = store._read(store.CATEGORIES, {})
ok("merge: adopted remote-only key", loc.get("ccc") == "gas")
ok("merge: kept local keys", loc.get("aaa") == "groceries" and loc.get("bbb") == "rent")
ok("merge: reported changed", res["changed"] is True)

# ── merge: conflict → newer stamp wins ──
# remote re-categorizes aaa with a NEWER stamp than local
newer = store.load_mapmeta()["categories.json"]["aaa"] + 5000
res = store.merge_maps({"categories.json": json.dumps({"aaa": "dining"})},
                       {"categories.json": {"aaa": newer}})
ok("merge: newer remote wins conflict", store._read(store.CATEGORIES, {})["aaa"] == "dining")
# remote with an OLDER stamp must NOT win
older = store.load_mapmeta()["categories.json"]["aaa"] - 999999
store.merge_maps({"categories.json": json.dumps({"aaa": "STALE"})},
                 {"categories.json": {"aaa": older}})
ok("merge: older remote loses conflict", store._read(store.CATEGORIES, {})["aaa"] == "dining")

# ── merge: old-format remote (no meta) → adopt only keys local lacks, never clobber ──
store._write(store.INCOME, {"src1": "income"})
store._write(store.MAPMETA, {})  # wipe metas → simulate a pre-merge vault
res = store.merge_maps({"income.json": json.dumps({"src1": "ignore", "src2": "income"})}, {})  # no filesMeta
inc = store._read(store.INCOME, {})
ok("merge(old-fmt): adopted the new key", inc.get("src2") == "income")
ok("merge(old-fmt): did NOT clobber existing key", inc.get("src1") == "income")

# ── merge returns all four maps for the caller to reseal ──
ok("merge: returns the four maps + the category registry", set(res["files"].keys()) == set(store.MERGE_MAPS.keys()) | {"catmeta.json"})

# ── export carries filesMeta ──
# (export_data reads the real data dir; just confirm the key exists + is a dict)
ex = store.export_data()
ok("export: filesMeta present", isinstance(ex.get("filesMeta"), dict))
ok("export: _mapmeta not leaked into files bundle", "_mapmeta.json" not in ex.get("files", {}))

print(f"\n{p} passed, {f} failed")
raise SystemExit(1 if f else 0)
