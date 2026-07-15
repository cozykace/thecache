# The check-in log is the ONE source of truth for events — and its on-disk whitelist in
# store._checkin_union is a HARD cross-device contract. The deck-fully-realized events
# (task/subtask completions, habit occurrences, field values) carry root/kind/field; a field
# NOT on the whitelist is silently dropped the moment it hits the server OR a merged restore
# (passes single-device, dies cross-device). These assertions prove those fields survive a
# LIVE write (checkin_append) AND the restore merge path (both route through _checkin_union),
# and that the dedup-by-(at,itemId) contract still holds.
import os, tempfile
import store

D = tempfile.mkdtemp()
store.DATA = D
store.CHECKIN_LOG = os.path.join(D, "checkin-log.jsonl")

p = f = 0
def ok(n, c):
    global p, f; p += c; f += (not c); print(("  ok  " if c else "FAIL  ") + n)

# ── 1. a kind/root/field-bearing entry survives a LIVE write ──
store.checkin_append([{
    "ts": "2026-07-14", "at": 1000, "itemId": "s1a", "root": "task",
    "kind": "done", "value": {"done": 1, "qty": 30}, "field": None,
}])
log = store.checkin_log()
e = next((x for x in log if x.get("itemId") == "s1a"), None)
ok("live write: entry persisted", e is not None)
ok("live write: `kind` survives the whitelist", e and e.get("kind") == "done")
ok("live write: `root` survives (trail can't be severed)", e and e.get("root") == "task")
ok("live write: `field` key survives (even null)", e and "field" in e)
ok("live write: rich `value` object is NOT slimmed", e and e.get("value") == {"done": 1, "qty": 30})

# ── 2. dedup by (at, itemId) still holds — a retry can't double-log ──
before = len(store.checkin_log())
store.checkin_append([{"ts": "2026-07-14", "at": 1000, "itemId": "s1a", "root": "task", "kind": "done"}])
ok("dedup: same (at,itemId) does not double-log", len(store.checkin_log()) == before)

# a genuinely new event for the same item (bumped `at`) IS added
store.checkin_append([{"ts": "2026-07-14", "at": 1001, "itemId": "s1a", "root": "task", "kind": "undone"}])
ok("dedup: a bumped-at toggle IS a new entry", len(store.checkin_log()) == before + 1)

# ── 3. the RESTORE merge path preserves the same fields (import_data routes through
#       _checkin_union, so a merged restore can't strip a new field either) ──
restored, total = store._checkin_union([{
    "ts": "2026-07-13", "at": 2000, "itemId": "h1", "root": "h1",
    "kind": "habit", "value": {"done": 1, "qty": 45}, "field": "fld",
}])
ok("restore merge: a new entry is added", restored == 1)
log = store.checkin_log()
h = next((x for x in log if x.get("itemId") == "h1"), None)
ok("restore merge: `kind` survives", h and h.get("kind") == "habit")
ok("restore merge: `root` survives", h and h.get("root") == "h1")
ok("restore merge: `field` survives", h and h.get("field") == "fld")
ok("restore merge: rich `value` survives", h and h.get("value") == {"done": 1, "qty": 45})

print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
