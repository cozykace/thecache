"""
THE CACHE — shared data layer (stdlib only). Used by both sync.py (pull from
the bank) and server.py (serve + edit). Owns categorization, the spending
summary, and all the local data files under data/.

Files (all gitignored, local, chmod 600):
  data/balances.json     current snapshot the dashboard reads
  data/transactions.json recent transactions (for re-categorizing / drill-in)
  data/history.json       one snapshot per day (for trends over time)
  data/categories.json    YOUR permanent category overrides {substring: category}
"""

import math
import os
import re
import json
import time
import shutil
import threading
import functools
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
BALANCES = os.path.join(DATA, "balances.json")
TRANSACTIONS = os.path.join(DATA, "transactions.json")
TOGGL = os.path.join(DATA, "toggl.json")
HISTORY = os.path.join(DATA, "history.json")
CATEGORIES = os.path.join(DATA, "categories.json")
INCOME = os.path.join(DATA, "income.json")  # YOUR income tags {source_key: "income"|"ignore"}
MONTHLY = os.path.join(DATA, "monthly.json")  # per-month history rolled up from the ledger
COVERAGE = os.path.join(DATA, "coverage.json")  # what data we have, from where, how far back
BUGS = os.path.join(DATA, "bugs.json")  # your reported bugs, logged locally
SYNCLOG = os.path.join(DATA, "synclog.json")
LEDGER = os.path.join(DATA, "ledger.jsonl")     # permanent ledger — one transaction per line (append-only)
LEDGER_OLD = os.path.join(DATA, "ledger.json")  # the old single-object format (auto-migrated once)
CATMETA = os.path.join(DATA, "catmeta.json")    # category registry: renamed labels + delete/remap rules
SUBS = os.path.join(DATA, "subs.json")          # YOUR decisions about recurring money: {key: {mustpay, cadence, paused, name}}
INCOME_LINKS = os.path.join(DATA, "income_links.json")  # income source key -> Toggl project name
MAPMETA = os.path.join(DATA, "_mapmeta.json")   # per-key edit times for the merge maps → cross-device newest-wins (leading _ keeps it out of the export files bundle; it rides the vault as filesMeta instead)
DELETED = os.path.join(DATA, "deleted.json")    # YOUR delete decisions: {txn_key: {deleted:1|0, at, txn:{…}}} — tombstones, so a delete STICKS across devices/restores (and can be undone)
# the user-authored flat maps that merge key-wise across devices (everything else in
# data/ is computed by the sync engine and travels whole-file)
MANUAL = os.path.join(DATA, "manual_accounts.json")   # accounts a sync can't see — typed balances (Money Truth Brick 4)
ROLES = os.path.join(DATA, "account_roles.json")      # what each account IS — liquid/short/long/untouchable (user-set, per account id)
MERGE_MAPS = {"categories.json": CATEGORIES, "income.json": INCOME, "subs.json": SUBS,
              "income_links.json": INCOME_LINKS, "deleted.json": DELETED,
              "manual_accounts.json": MANUAL, "account_roles.json": ROLES}
# MERGE-CLASS DECISION (written down per CLAUDE.md): manual_accounts.json is a MERGE MAP —
# user-authored cross-device state, newest-per-key by account id via the vault's filesMeta
# sidecar, exactly like categories/income. Removal is a VALUE ({"removed": 1}), never a
# deleted key: merge_maps can't propagate an absence, but a newer removed-value wins the
# per-key merge on every device. app.js MAP_FILE_NAMES carries the same name (the authored
# witness + push-time merge), or the two runtimes livelock.

# the built-in category keys (mirror of the frontend CAT_META) — so the manager
# can list them even when they currently hold zero transactions
BUILTIN_CATS = ("housing", "bills", "utilities", "groceries", "dining", "transport",
                "shopping", "subscriptions", "health", "entertainment", "music_art",
                "fees", "transfer", "other")
BACKUPS = os.path.join(HERE, "backups")     # local snapshots (gitignored, stays on your Mac)

_BACKUP_FILES = ("balances.json", "transactions.json", "ledger.jsonl", "ledger.json",
                 "history.json", "synclog.json", "categories.json", "income.json",
                 "catmeta.json", "subs.json", "income_links.json",
                 "monthly.json", "coverage.json", "bugs.json", "manual_accounts.json",
                 "account_roles.json")

# Built-in keyword rules (first match wins). User overrides in categories.json
# are checked first, so anything you teach it takes priority.
CATEGORY_RULES = [
    ("housing", ["rent", "apartment", "property mgmt", "mortgage", "landlord", "leasing"]),
    ("subscriptions", ["spotify", "netflix", "hulu", "adobe", "apple.com", "patreon",
                        "disney", "youtube", "dropbox", "notion", "openai", "anthropic", "claude"]),
    ("utilities", ["electric", "water util", "pg&e", "utility", "sewer", "sewage",
                   "trash", "waste mgmt", "gas company", "power company", "con ed",
                   "duke energy", "internet", "comcast", "xfinity", "spectrum"]),
    ("bills", ["at&t", "verizon", "t-mobile", "insurance", "phone bill", "wireless", "mint mobile"]),
    ("transport", ["uber", "lyft", "shell", "chevron", "exxon", "gas ", "fuel", "parking",
                   "transit", "bart", "metro", "toll", "arco", "76 "]),
    ("groceries", ["trader joe", "whole foods", "safeway", "grocery", "market", "aldi",
                   "kroger", "costco", "sprouts", "ralphs", "wegmans", "publix"]),
    ("dining", ["restaurant", "cafe", "coffee", "starbucks", "chipotle", "doordash",
                "uber eats", "grubhub", "mcdonald", "pizza", "taco", "sushi", "tavern",
                "brewing", "dunkin", "peet", "diner", "kitchen", "grill"]),
    ("music_art", ["guitar", "sam ash", "blick", "vinyl", "sweetwater", "reverb", "music", "art supply"]),
    ("health", ["pharmacy", "cvs", "walgreens", "gym", "fitness", "doctor", "medical", "dental", "clinic"]),
    ("entertainment", ["cinema", "theater", "movie", "ticketmaster", "steam ", "playstation",
                       "xbox", "nintendo", "concert", "bar "]),
    ("shopping", ["amazon", "target", "walmart", "etsy", "ebay", "best buy", "store", "shop"]),
    ("fees", ["fee", "atm", "interest charge", "overdraft", "service charge"]),
    ("transfer", ["transfer", "zelle", "venmo", "cash app", "paypal", "withdrawal",
                  "online payment", "autopay", "ach ", "bill pay",
                  "pymt", "e-payment", "epayment", "payment thank you", "card payment",
                  "credit card payment", "web pmt", "pmt thank"]),
]


# ── file helpers ───────────────────────────────────────────
def _read(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def _fsync_dir(d):
    # flush the directory entry so a rename survives power loss, not just the file bytes
    try:
        fd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _write(path, obj):
    # atomic + crash-durable: write temp, fsync the bytes, rename, fsync the dir — a
    # power loss or panic mid-write can never leave a half file or lose the data.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    _fsync_dir(os.path.dirname(path))
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


# ── write serialization ──────────────────────────────────────────────
# server.py is a ThreadingHTTPServer, so two requests can run at once. A store
# mutator that does read-modify-write on a shared file (categories, income,
# subs, the check-in log, balances, the ledger) would otherwise let one thread's
# edit silently clobber another's. One re-entrant lock serializes every mutator;
# re-entrant so a mutator that calls another (delete_txn → rebuild → recompute)
# doesn't deadlock on the same thread.
_WRITE_LOCK = threading.RLock()


def _locked(fn):
    @functools.wraps(fn)
    def wrap(*a, **k):
        with _WRITE_LOCK:
            return fn(*a, **k)
    return wrap


def _append_lines(path, lines):
    """Append newline-terminated lines, self-healing a torn tail. If a prior
    append crashed mid-line (no trailing newline), a naive append would fuse
    the partial onto the next good record and corrupt it; instead we terminate
    the torn line first so it stands alone as one skippable bad line (the .jsonl
    parsers skip bad lines individually) and the new records stay intact."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a+", encoding="utf-8") as f:
        f.seek(0, os.SEEK_END)
        if f.tell():
            f.seek(f.tell() - 1)
            if f.read(1) != "\n":
                f.write("\n")   # cap the torn line so it can't merge with our data
        for ln in lines:
            f.write(ln + "\n")
        f.flush()
        os.fsync(f.fileno())
    _fsync_dir(os.path.dirname(path))


# ── daily check-in — shared across devices ───────────────────────────
# Browser storage is only a fast cache; THESE files are the truth, so phone and desktop
# converge on one log + one deck, and answers ride backups + the encrypted vault.
# (Working Docs/3_ROADMAP.md · the north-star EF-energy data must never fork per-device.)
CHECKIN_LOG = os.path.join(DATA, "checkin-log.jsonl")    # one answer per line, append-only
CHECKIN_DECK = os.path.join(DATA, "checkin-deck.json")   # {"rev": ms-timestamp, "items": [...]}


def checkin_log():
    """Every check-in answer ever logged; corrupt lines are skipped, never fatal."""
    out = []
    try:
        with open(CHECKIN_LOG, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    if isinstance(e, dict):
                        out.append(e)
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return out


def _checkin_union(entries):
    """Union check-in entries into the log, deduped by (at, itemId) — the shared core
    of checkin_append and import_data's merged restore. Caller holds _WRITE_LOCK.
    Returns (added_count, total_after)."""
    have = set()
    for e in checkin_log():
        have.add((e.get("at"), e.get("itemId")))
    new_lines = []
    for e in entries:
        if not isinstance(e, dict) or "at" not in e or "itemId" not in e:
            continue
        k = (e.get("at"), e.get("itemId"))
        if k in have:
            continue
        have.add(k)
        # ⚠️ This whitelist is a HARD CROSS-DEVICE CONTRACT. Any field NOT listed here is
        # silently dropped the moment an entry hits the server OR a merged restore — passes
        # single-device, dies cross-device. `root`/`kind`/`field` carry the deck-fully-
        # realized events (task/subtask completions, habit occurrences, field values): `kind`
        # names the event, `root` is the denormalized top-level id so an item's activity
        # trail survives an interior subtask being deleted/GC'd, `field` ties a value to its
        # field definition. `value` stays rich (a qty, a reading, an object) — do not slim it.
        slim = {x: e.get(x) for x in ("ts", "at", "itemId", "prompt", "input", "value", "dest", "root", "kind", "field") if x in e}
        new_lines.append(json.dumps(slim))
    if new_lines:
        _append_lines(CHECKIN_LOG, new_lines)   # torn-tail-safe append
        _chmod600(CHECKIN_LOG)
    return len(new_lines), len(have)


@_locked
def checkin_append(entries):
    """Append check-in answers (append-only, crash-durable, same rigor as the money
    ledger). Dedupes by (at, itemId) against what's already on disk, so offline retries
    and double-sends can never double-log an answer. Locked so two concurrent pushes
    can't both read-then-append the same answer and double-log it."""
    if not isinstance(entries, list):
        return {"ok": False, "error": "bad entries"}
    added, total = _checkin_union(entries[:200])
    return {"ok": True, "added": added, "total": total}


def checkin_deck_get():
    return _read(CHECKIN_DECK, {"rev": 0, "items": []})


DECK_LIVE_CAP = 60
DECK_TOMB_CAP = 60


def _deck_canon(it):
    """Canonical CONTENT form — stamps excluded, keys sorted. MUST match app.js
    deckCanon / webcache wDeckCanon byte-for-byte: it is compared as a STRING (never
    hashed) precisely so three runtimes can't disagree about integer wraparound."""
    skip = ("updated", "ord", "ordAt")

    def walk(v):
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(v[k]) for k in sorted(v) if k not in skip}
        return v
    try:
        return json.dumps(walk(it or {}), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except Exception:
        return ""


def _deck_cap(items):
    live = [i for i in items if not i.get("deleted")][:DECK_LIVE_CAP]
    tomb = sorted([i for i in items if i.get("deleted")],
                  key=lambda i: -(i.get("updated") or 0))[:DECK_TOMB_CAP]
    return live + tomb


def merge_decks(a, b):
    """Per-item merge — the same rules as app.js mergeDecks. Newer `updated` wins; on an
    EXACT tie a tombstone wins (a card you killed reappearing is the trust break);
    still tied → canonical-content compare. Position carries its own `ordAt` clock, so a
    reorder can never revert someone's text edit."""
    out = {}
    for arr in (a, b):
        for raw in (arr if isinstance(arr, list) else []):
            if not isinstance(raw, dict) or not raw.get("id"):
                continue
            it = dict(raw)
            cur = out.get(it["id"])
            if cur is None:
                out[it["id"]] = it
                continue
            cu, iu = cur.get("updated") or 0, it.get("updated") or 0
            if iu > cu:
                win, lose = it, cur
            elif iu < cu:
                win, lose = cur, it
            else:
                cd, idl = bool(cur.get("deleted")), bool(it.get("deleted"))
                if idl != cd:
                    win, lose = (it, cur) if idl else (cur, it)
                elif _deck_canon(it) > _deck_canon(cur):
                    win, lose = it, cur
                else:
                    win, lose = cur, it
            merged = dict(win)
            if (lose.get("ordAt") or 0) > (win.get("ordAt") or 0):
                merged["ord"] = lose.get("ord")
                merged["ordAt"] = lose.get("ordAt")
            out[it["id"]] = merged
    items = sorted(out.values(), key=lambda i: ((i.get("ord") or 0), str(i.get("id"))))
    return _deck_cap(items)


@_locked
def checkin_deck_set(data):
    """Per-item merge (v2): each item carries its own `updated`, so an older device can
    no longer replace the WHOLE deck — it can only lose the items it is actually stale on.

    OLD CLIENTS (payload carries `rev`, items have no `updated`) still speak whole-document
    last-writer-wins. Their array is the only self-consistent thing they can tell us, so
    honour the old rev rule for that write rather than per-item merging a payload whose
    stamps don't exist."""
    items = data.get("items")
    if not isinstance(items, list):
        return {"ok": False, "error": "bad deck"}
    cur = checkin_deck_get()
    cur_items = cur.get("items") if isinstance(cur.get("items"), list) else []
    legacy = data.get("v") != 2 and not any(isinstance(i, dict) and i.get("updated") is not None for i in items)
    if legacy:
        rev = data.get("rev") or 0
        if not isinstance(rev, (int, float)):
            return {"ok": False, "error": "bad deck"}
        if cur.get("rev", 0) and rev <= cur.get("rev", 0):
            return {"ok": True, "kept": True, "rev": cur.get("rev", 0)}
        _write(CHECKIN_DECK, {"rev": rev, "items": items[:DECK_LIVE_CAP]})
        return {"ok": True, "rev": rev}
    merged = merge_decks(cur_items, items)
    _write(CHECKIN_DECK, {"v": 2, "items": merged})
    return {"ok": True, "v": 2, "count": len(merged)}


# ── Brain Bucket — actively-held working memory (v1: notes + links) ────────────
# A small deliberate holding space, NOT a ledger — a plain list with atomic writes.
# Lives in data/ so it syncs across devices and rides backups + the encrypted vault.
BUCKET = os.path.join(DATA, "bucket.json")


def bucket_get():
    b = _read(BUCKET, [])
    return b if isinstance(b, list) else []


@_locked
def bucket_add(item):
    if not isinstance(item, dict):
        return {"ok": False, "error": "bad item"}
    kind = item.get("kind") if item.get("kind") in ("note", "link") else "note"
    text = str(item.get("text") or "")[:500]
    url = str(item.get("url") or "")[:1000]
    if not text and not url:
        return {"ok": False, "error": "empty"}
    items = bucket_get()
    if len(items) >= 200:
        return {"ok": False, "error": "bucket full — time for a cleanout"}
    items.append({"id": "b%d" % int(time.time() * 1000), "at": int(time.time() * 1000), "kind": kind, "text": text, "url": url})
    _write(BUCKET, items)
    return {"ok": True, "items": items}


@_locked
def bucket_remove(bid):
    items = [i for i in bucket_get() if i.get("id") != bid]
    _write(BUCKET, items)
    return {"ok": True, "items": items}


# ── categories ─────────────────────────────────────────────
def load_overrides():
    ov = _read(CATEGORIES, {})
    return ov if isinstance(ov, dict) else {}


ACCOUNT_ROLES = ("liquid", "short", "long", "untouchable")   # spendable · short-term savings · long-term · never-touch


def load_account_roles():
    """{account_id: role} — the user's own classification of each account. A MERGE MAP
    (newest-per-key via filesMeta, like manual_accounts): user-authored cross-device state.
    Clearing a role writes nothing (the key is removed) — the app falls back to name-guessing."""
    m = _read(ROLES, {})
    return m if isinstance(m, dict) else {}


@_locked
def save_account_role(acct_id, role):
    m = load_account_roles()
    key = (acct_id or "").strip()
    if not key:
        return m
    before = dict(m)
    if role in ACCOUNT_ROLES:
        m[key] = role
    else:
        m.pop(key, None)   # "auto" → back to the name-based guess
    _write(ROLES, m)
    _stamp_map("account_roles.json", before, m)
    if before != m:
        # a role edit changes what every device derives (spendable, the balance split) —
        # bump rev so their stamp-keyed widgets re-pull instead of going quietly stale
        bal = _read(BALANCES, {})
        bal["rev"] = _next_rev(bal)
        _write(BALANCES, bal)
    return m


def load_manual_accounts():
    """{id: {name, balance, apr, as_of, removed}} — accounts the aggregator can't see."""
    m = _read(MANUAL, {})
    return m if isinstance(m, dict) else {}


def live_manual_accounts():
    """The manual accounts that still exist (removed is a value-tombstone, see MERGE_MAPS)."""
    return {k: v for k, v in load_manual_accounts().items()
            if isinstance(v, dict) and not v.get("removed")}


@_locked
def save_manual_account(acct_id, fields):
    """Create/update/remove one manual account. fields: {name, balance, apr, remove}.
    Stamps the per-key mtime so two devices editing different accounts both survive."""
    m = load_manual_accounts()
    key = (acct_id or "").strip()
    if not key:
        return m
    before = dict(m)
    if fields.get("remove"):
        cur = m.get(key) if isinstance(m.get(key), dict) else {}
        m[key] = {"name": cur.get("name", ""), "removed": 1}   # a VALUE, so removal propagates
    else:
        cur = m.get(key) if isinstance(m.get(key), dict) else {}
        apr = fields.get("apr")
        try:
            apr = round(float(apr), 2) if apr not in (None, "") else None
        except (TypeError, ValueError):
            apr = None
        m[key] = {
            "name": str(fields.get("name") or cur.get("name") or "Manual account")[:60],
            "balance": round(float(fields.get("balance", cur.get("balance", 0)) or 0), 2),
            "apr": apr,
            "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),   # every touch refreshes the staleness clock
        }
    _write(MANUAL, m)
    _stamp_map("manual_accounts.json", before, m)
    return m


def _manual_out_accounts():
    """Manual accounts in the snapshot's accounts[] shape, clearly badged."""
    out = []
    for k, v in sorted(live_manual_accounts().items()):
        bal = round(float(v.get("balance", 0) or 0), 2)
        out.append({"id": "manual:" + k, "name": v.get("name") or "Manual account",
                    "org": "manual", "balance": bal, "currency": "USD",
                    "manual": True, "as_of": v.get("as_of") or "", "apr": v.get("apr")})
    return out


@_locked
def recompute_manual():
    """A manual-account edit between syncs must move Total/cash NOW, not at the next bank
    pull: rewrite balances.json's accounts (synced ones kept verbatim, manual re-appended
    fresh) and re-derive total/cash from that honest list."""
    bal = _read(BALANCES, {})
    synced = [a for a in (bal.get("accounts") or []) if not (isinstance(a, dict) and a.get("manual"))]
    accounts = synced + _manual_out_accounts()
    total = round(sum(float(a.get("balance", 0) or 0) for a in accounts), 2)
    cash = round(sum(float(a.get("balance", 0) or 0) for a in accounts if float(a.get("balance", 0) or 0) > 0), 2)
    bal["accounts"] = accounts
    bal["total"] = total
    bal["cash"] = cash
    bal["rev"] = _next_rev(bal)
    _write(BALANCES, bal)
    return {"accounts": accounts, "total": total, "cash": cash}


@_locked
def save_override(substring, category):
    ov = load_overrides()
    key = (substring or "").strip().lower()
    if key:
        before = dict(ov)
        ov[key] = category
        _write(CATEGORIES, ov)
        _stamp_map("categories.json", before, ov)
    return ov


# ── category registry (renamed labels + delete/remap) ──────
_CATMETA_CACHE = None


def load_catmeta():
    global _CATMETA_CACHE
    if _CATMETA_CACHE is None:
        m = _read(CATMETA, {})
        if not isinstance(m, dict):
            m = {}
        m.setdefault("labels", {})   # key -> renamed display label
        m.setdefault("remap", {})    # deleted key -> the category it folds into
        m.setdefault("custom", [])   # user-created category keys
        _CATMETA_CACHE = m
    return _CATMETA_CACHE


@_locked
def save_catmeta(m):
    """Persist the category registry + stamp WHICH entries changed, so the same
    newest-per-key merge that syncs your tag maps also syncs your renames, your
    fold-ins, and your custom categories across devices. `custom` is kept SORTED:
    it's a union-merged list, and two devices holding the same set in a different
    order would look permanently 'ahead' of each other and re-push forever."""
    global _CATMETA_CACHE
    if not isinstance(m, dict):
        return load_catmeta()
    # read `before` from DISK, never load_catmeta(): the callers (rename_category et al)
    # mutate the cached dict IN PLACE and hand it straight back here, so the cache is
    # already the NEW value and diffing against it would stamp nothing.
    before = _read(CATMETA, {})
    if not isinstance(before, dict):
        before = {}
    m.setdefault("labels", {})
    m.setdefault("remap", {})
    m.setdefault("custom", [])
    if isinstance(m.get("custom"), list):
        m["custom"] = sorted({str(c) for c in m["custom"]})
    _write(CATMETA, m)
    _CATMETA_CACHE = m
    _stamp_catmeta(before, m)
    return m


def _catmeta_pairs(m):
    """Flatten the registry's per-key entries into one stampable namespace."""
    out = {}
    for sub in ("labels", "remap"):
        d = (m or {}).get(sub) or {}
        if isinstance(d, dict):
            for k, v in d.items():
                out[sub + ":" + str(k)] = v
    return out


def _stamp_catmeta(before, after):
    """Record now() for every registry entry whose value changed (caller holds the lock)."""
    meta = load_mapmeta()
    fm = meta.get("catmeta.json")
    if not isinstance(fm, dict):
        fm = {}
    b, a = _catmeta_pairs(before), _catmeta_pairs(after)
    now, changed = _now_ms(), False
    for k in set(b) | set(a):
        if k not in a:
            if k in fm:
                del fm[k]
                changed = True
        elif b.get(k) != a.get(k):
            fm[k] = now
            changed = True
    if changed:
        meta["catmeta.json"] = fm
        _write(MAPMETA, meta)


def _resolve_remap(cat, remap):
    seen = 0
    while cat in remap and seen < 12:   # follow chains, guard against loops
        cat = remap[cat]
        seen += 1
    return cat


def cat_label(key):
    m = load_catmeta()
    if key in m["labels"]:
        return m["labels"][key]
    return (key or "other").replace("_", " ").title()


def category_summary():
    """Every category + how many ledger transactions land in it (post-remap),
    plus its merchants (for one-off recategorizing). Deleted/remapped categories
    are not listed."""
    txns = _ledger_txns()
    overrides = load_overrides()
    m = load_catmeta()
    remap = m["remap"]
    counts, merch = {}, {}
    for t in txns:
        if (t.get("amount") or 0) < 0:
            c = categorize(t.get("description", ""), overrides, remap)
            counts[c] = counts.get(c, 0) + 1
            merch.setdefault(c, set()).add(_clean(t.get("description", "")) or "unknown")
    keys = (set(BUILTIN_CATS) | set(m["custom"]) | set(counts)) - set(remap)
    rows = [{"key": k, "label": cat_label(k), "count": counts.get(k, 0),
             "builtin": k in BUILTIN_CATS, "merchants": sorted(merch.get(k, []))}
            for k in keys]
    rows.sort(key=lambda r: (-r["count"], r["label"].lower()))
    return rows


def rename_category(key, label):
    label = (label or "").strip()
    if key and label:
        m = load_catmeta()
        m["labels"][key] = label
        save_catmeta(m)
    return load_catmeta()


def create_category(label):
    label = (label or "").strip()
    key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    if not key:
        return None
    m = load_catmeta()
    if key not in BUILTIN_CATS and key not in m["custom"]:
        m["custom"].append(key)
    m["labels"][key] = label
    save_catmeta(m)
    return key


def delete_category(key, to_key):
    """Fold a category into another: every transaction that would land in `key`
    (now and future) lands in `to_key` instead — the batch-reassign option."""
    if not key or not to_key or key == to_key:
        return load_catmeta()
    m = load_catmeta()
    m["remap"][key] = to_key
    if key in m["custom"]:
        m["custom"].remove(key)
    save_catmeta(m)
    recompute_spending()  # refresh balances.json + monthly.json with the remap applied
    return m


def _clean(desc):
    """Reduce a raw description to its merchant words (drop ids/noise)."""
    d = re.sub(r"[^a-z& ]", " ", (desc or "").lower())
    for w in ("pos", "debit", "credit", "card", "purchase", "payment", "ach",
              "recurring", "online", "www", "com", "usa", "the",
              "visa", "mastercard", "amex", "discover", "mc"):  # drop card-network noise so dupes merge
        d = re.sub(r"\b" + w + r"\b", " ", d)
    return re.sub(r"\s+", " ", d).strip()


# ── Pretty display names ───────────────────────────────────
# Turn a raw bank description into a readable merchant name FOR DISPLAY ONLY.
# The matching key (_clean / _income_key) is never touched, so tags/links keep
# working; this just makes "Web Authorized Pmt Ventura Llc" read as "Ventura".
_PRETTY_PREFIX = re.compile(
    r"^(?:"
    r"purchase\s+authorized\s+on\s+\d+|"
    r"recurring\s+payment\s+authorized\s+on\s+\d+|"
    r"(?:payment|pmt)\s+authorized\s+on\s+\d+|"
    r"web\s+authorized\s+(?:pmt|payment)?|"
    r"external\s+(?:withdrawal|deposit)|"
    r"pos\s+(?:debit|purchase)|debit\s+card\s+purchase|"
    r"checkcard\s*\d*|check\s*card|"
    r"ach\s+(?:debit|credit)|"
    r"(?:bill|online|electronic)\s+payment"
    r")\b", re.I)
_PRETTY_DROP = {
    "sp", "wp", "tst", "sq", "pp", "fs", "dbt", "crd", "ckcd", "pos", "dda",
    "visa", "mastercard", "amex", "discover", "mc", "debit", "credit", "card",
    "purchase", "payment", "pmt", "pymt", "authorized", "auth", "recurring",
    "web", "ach", "ppd", "ccd", "indn", "des", "xxxxx",
    "llc", "inc", "corp", "ltd", "subscription", "subscr",
}
_US_STATES = {
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il",
    "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt",
    "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri",
    "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
}
_ACRONYMS = {"ai": "AI", "fka": "FKA", "usa": "USA", "us": "US", "uk": "UK", "sf": "SF", "nyc": "NYC"}


def prettify_merchant(raw, fallback=""):
    s = _PRETTY_PREFIX.sub(" ", (raw or "").strip())
    toks = [w for w in re.split(r"[^A-Za-z&]+", s) if w and w.lower() not in _PRETTY_DROP]
    dedup = []
    for w in toks:  # collapse consecutive repeats: "google google" -> "google"
        if not dedup or dedup[-1].lower() != w.lower():
            dedup.append(w)
    while dedup and dedup[-1].lower() in _US_STATES:  # drop a trailing state code
        dedup.pop()
    while len(dedup) > 1 and len(dedup[-1]) == 1:  # drop stray trailing single letters ("google o", "mcdonald s f")
        dedup.pop()
    if not dedup:
        return fallback or (raw or "").strip().title()
    return " ".join(_ACRONYMS.get(w.lower(), w.capitalize()) for w in dedup)


# positive amounts matching these are NOT real income (fee reversals, interest,
# refunds, card-payment reversals) — they were inflating the income number
NOT_INCOME = ("fee", "waiv", "interest", "refund", "reversal", "adjustment",
              "rebate", "redemption", "mobile pymt", "mobile payment", "returned")


def is_income(desc):
    d = (desc or "").lower()
    return not any(k in d for k in NOT_INCOME)


# positive amounts matching these ARE income even if they'd otherwise read as a
# transfer (gig deposits, payroll). Friend Zelle paybacks are deliberately NOT here.
INCOME_HINTS = ("instacart", "shipt", "dasher", "doordash", "payroll",
                "direct dep", "gusto", "deel", "adp ")


def _norm_match(s):
    """The rot-proof matching form of a description or override key: drop reference-code
    tokens (digits / gibberish the bank rotates per-txn or per-format), then _clean the
    rest down to merchant words. Two formats of the SAME counterparty normalize alike."""
    toks = [t for t in (s or "").lower().split() if not _is_refcode(t)]
    return _clean(" ".join(toks))


_NORMKEY_MEMO = {}   # override-key string → tuple of normalized words (categorize runs per-txn in hot loops)


def categorize(desc, overrides=None, remap=None):
    d = (desc or "").lower()
    cat = "other"
    matched = False
    if overrides:
        # pass 1 — RAW substring match. Legacy keys keep working forever, byte-for-byte
        # (the migration rule: never rewrite, never break what already matches).
        for sub, c in overrides.items():
            words = [w for w in sub.split() if len(w) >= 3]
            if words and all(w in d for w in words):
                cat, matched = c, True
                break
        if not matched:
            # pass 2 — NORMALIZED fallback (Money Truth Brick 2). When the bank reformats a
            # description mid-year (masked Zelle, reshuffled fields), a raw key that embedded a
            # reference code stops matching and the txn silently falls to the auto rules — the
            # founder's rent vanished from a whole month this way. Compare refcode-stripped,
            # cleaned KEY words against the refcode-stripped, cleaned DESCRIPTION instead: the
            # merchant words survive any format the bank invents. Read-time only — the stored
            # key is never rewritten, so old vaults/maps merge unchanged.
            dn = _norm_match(d)
            if dn:
                for sub, c in overrides.items():
                    key = _NORMKEY_MEMO.get(sub)
                    if key is None:
                        key = _NORMKEY_MEMO[sub] = tuple(w for w in _norm_match(sub).split() if len(w) >= 3)
                    if key and all(w in dn for w in key):
                        cat, matched = c, True
                        break
    if not matched:
        for c, keys in CATEGORY_RULES:
            if any(k in d for k in keys):
                cat = c
                break
    # apply delete/remap rules so a "deleted" category folds into its target
    if remap is None:
        remap = load_catmeta()["remap"]
    return _resolve_remap(cat, remap)


# ── income tagging ─────────────────────────────────────────
def _is_refcode(token):
    """Zelle/ACH trailing reference, e.g. 'Bacf1oyikgnu' / 'Bacfqxfdydbb' —
    has a digit, or is long and vowel-starved gibberish (not a name)."""
    if any(c.isdigit() for c in token):
        return True
    letters = re.sub(r"[^a-z]", "", token)
    if len(letters) >= 9 and sum(c in "aeiou" for c in letters) / len(letters) <= 0.25:
        return True
    return False


def _income_key(desc):
    """Group a deposit by its real source. Reference codes are dropped, then
    deposit boilerplate, so 'Zelle Instant Pmt From Jane Doe Bacf1oyikgnu'
    and '… Jane Doe Bacfqxfdydbb' both collapse to 'jane doe'."""
    kept = []
    for w in re.split(r"\s+", (desc or "").lower()):
        if not w or _is_refcode(w):
            continue
        w = re.sub(r"[^a-z&]", "", w)
        if w:
            kept.append(w)
    drop = ("zelle", "instant", "pmt", "pymt", "payment", "from", "deposit",
            "electronic", "mobile", "banking", "transfer", "ach", "online",
            "recurring", "direct", "the", "des", "id", "ext", "web", "ppd", "co")
    toks = [w for w in kept if w not in drop and len(w) >= 2]
    return " ".join(toks).strip() or "income"


def load_income_overrides():
    ov = _read(INCOME, {})
    return ov if isinstance(ov, dict) else {}


# ── Recurring-money decisions ledger (data/subs.json) ──
# Your calls about each recurring merchant: must-pay, cadence, paused, rename.
# Durable + backed up, alongside the category/income tags. The browser owns the
# in-session copy and writes the whole map back here on every change.
def load_subs():
    d = _read(SUBS, {})
    return d if isinstance(d, dict) else {}


@_locked
def save_subs(data):
    if isinstance(data, dict):
        before = load_subs()
        _write(SUBS, data)
        _stamp_map("subs.json", before, data)
    return load_subs()


# income source key -> Toggl project name (so hours worked line up with money in)
def load_income_links():
    d = _read(INCOME_LINKS, {})
    return d if isinstance(d, dict) else {}


@_locked
def save_income_links(data):
    if isinstance(data, dict):
        before = load_income_links()
        _write(INCOME_LINKS, data)
        _stamp_map("income_links.json", before, data)
    return load_income_links()


@_locked
def save_income_override(key, status):
    """status: 'income' | 'ignore' to pin it, or 'auto'/None to clear the tag."""
    ov = load_income_overrides()
    k = (key or "").strip().lower()
    if k:
        before = dict(ov)
        if status in ("income", "ignore"):
            ov[k] = status
        else:
            ov.pop(k, None)  # back to automatic
        _write(INCOME, ov)
        _stamp_map("income.json", before, ov)
    return ov


# ── merge-map edit times (cross-device newest-wins) ──────────────────
# The four user-authored maps (categories, income, subs, income_links) are edited on
# more than one device. To let a desktop pull adopt another device's edits WITHOUT a
# stale copy clobbering a fresh one, each changed key is stamped with an edit time,
# and merge_maps() keeps the newest value per key. Mirrors the client's per-key
# localStorage merge, one layer down. No tombstones (deletions are rare in these
# maps), so a cleared key can resurrect from a device that still holds it — the same
# honest limitation as the local merge.
def _now_ms():
    return int(time.time() * 1000)


def load_mapmeta():
    m = _read(MAPMETA, {})
    return m if isinstance(m, dict) else {}


def _stamp_map(filename, old_map, new_map):
    """Record now() for every key whose value changed between old_map and new_map;
    forget keys that were removed. Called under the store lock by each map save."""
    old_map = old_map if isinstance(old_map, dict) else {}
    new_map = new_map if isinstance(new_map, dict) else {}
    meta = load_mapmeta()
    fm = meta.get(filename)
    if not isinstance(fm, dict):
        fm = {}
    now, changed = _now_ms(), False
    for k in set(old_map) | set(new_map):
        if k not in new_map:
            if k in fm:
                del fm[k]
                changed = True
        elif old_map.get(k) != new_map.get(k):
            fm[k] = now
            changed = True
    if changed:
        meta[filename] = fm
        _write(MAPMETA, meta)


def _map_val_wins(a, b):
    """Deterministic total order to break an EXACT mtime tie so both desktop backends
    pick the same winner and the maps converge (they run this identical rule). Compares
    the canonical JSON form, so it works for string values (categories/income/links)
    and object values (subs) alike. Adopt the remote value iff it is the greater."""
    ka = a if isinstance(a, str) else json.dumps(a, sort_keys=True)
    kb = b if isinstance(b, str) else json.dumps(b, sort_keys=True)
    return ka > kb


@_locked
def merge_maps(remote_files, remote_meta):
    """Merge another device's copy of the four user-edit maps into the local ones,
    newest-per-key. remote_files: {filename: json-string}; remote_meta: {filename:
    {key: mtime}}. A key the local map lacks is always adopted (additive union across
    devices); a key both hold takes whichever side stamped it more recently. Returns
    the merged maps + metas (so the caller can seal the converged truth back to the
    vault) and whether anything changed locally."""
    remote_files = remote_files if isinstance(remote_files, dict) else {}
    remote_meta = remote_meta if isinstance(remote_meta, dict) else {}
    meta = load_mapmeta()
    out_files, out_meta, changed = {}, {}, False
    deleted_changed = False
    for name, path in MERGE_MAPS.items():
        local = _read(path, {})
        if not isinstance(local, dict):
            local = {}
        lm = meta.get(name) if isinstance(meta.get(name), dict) else {}
        try:
            rem = json.loads(remote_files.get(name) or "{}")
        except Exception:
            rem = {}
        if not isinstance(rem, dict):
            rem = {}
        rm = remote_meta.get(name) if isinstance(remote_meta.get(name), dict) else {}
        merged, merged_meta, this_changed = dict(local), dict(lm), False
        for k, rval in rem.items():
            local_m = lm.get(k, 0) if k in local else -1   # never had it → adopt even an unstamped remote value
            remote_m = rm.get(k, 0)
            # strict-newer wins; on an EXACT mtime tie with differing values (the
            # universal m:0 legacy state right after this feature shipped) both
            # desktops must pick the SAME winner or they ping-pong forever — break the
            # tie by a deterministic total order on the value (so the client's authored
            # witness, which sees the merged maps as canonical content, can rest).
            if remote_m > local_m or (remote_m == local_m and k in local and merged.get(k) != rval and _map_val_wins(rval, merged.get(k))):
                if merged.get(k) != rval:
                    merged[k] = rval
                    this_changed = True
                merged_meta[k] = remote_m
        if this_changed:
            _write(path, merged)
            meta[name] = merged_meta
            changed = True
            if name == "deleted.json":
                deleted_changed = True
        out_files[name] = json.dumps(merged)
        out_meta[name] = merged_meta
    # the category registry (renames / fold-ins / custom categories) is user-authored
    # too — merge it the same way so a rename on one machine reaches the others
    global _CATMETA_CACHE
    local_cm = load_catmeta()
    lcm = meta.get("catmeta.json") if isinstance(meta.get("catmeta.json"), dict) else {}
    try:
        rcm_raw = json.loads(remote_files.get("catmeta.json") or "{}")
    except Exception:
        rcm_raw = {}
    if not isinstance(rcm_raw, dict):
        rcm_raw = {}
    rcm_meta = remote_meta.get("catmeta.json") if isinstance(remote_meta.get("catmeta.json"), dict) else {}
    raw_custom = list(local_cm.get("custom") or [])
    norm_custom = sorted({str(c) for c in raw_custom})   # always land on identical bytes across devices
    merged_cm = {"labels": dict(local_cm.get("labels") or {}),
                 "remap": dict(local_cm.get("remap") or {}),
                 "custom": norm_custom}
    merged_cm_meta, cm_changed = dict(lcm), (norm_custom != raw_custom)
    for sub in ("labels", "remap"):
        rd = rcm_raw.get(sub) or {}
        if not isinstance(rd, dict):
            continue
        for k, rval in rd.items():
            stamp_k = sub + ":" + str(k)
            has = k in (local_cm.get(sub) or {})
            local_m = lcm.get(stamp_k, 0) if has else -1
            remote_m = rcm_meta.get(stamp_k, 0)
            if remote_m > local_m or (remote_m == local_m and has and merged_cm[sub].get(k) != rval and _map_val_wins(rval, merged_cm[sub].get(k))):
                if merged_cm[sub].get(k) != rval:
                    merged_cm[sub][k] = rval
                    cm_changed = True
                merged_cm_meta[stamp_k] = remote_m
    rc = rcm_raw.get("custom")
    if isinstance(rc, list):   # custom categories UNION — sorted so both devices land on identical bytes
        union = sorted({str(c) for c in merged_cm["custom"]} | {str(c) for c in rc})
        if union != merged_cm["custom"]:
            merged_cm["custom"] = union
            cm_changed = True
    if cm_changed:
        _write(CATMETA, merged_cm)
        _CATMETA_CACHE = merged_cm
        meta["catmeta.json"] = merged_cm_meta
        changed = True
    out_files["catmeta.json"] = json.dumps(merged_cm)
    out_meta["catmeta.json"] = merged_cm_meta
    if changed:
        _write(MAPMETA, meta)
    # A delete decision adopted from another device has to actually TAKE EFFECT here —
    # otherwise the tombstone would only stop RE-adds and the row we already hold would
    # sit in our ledger forever, so the delete would only ever apply on the machine that
    # made it. Same for an un-delete: put the transaction back.
    if deleted_changed:
        try:
            tomb = load_deleted()
            led = load_ledger()
            drop = [k for k in led if is_deleted(k, tomb)]
            put_back = [e["txn"] for k, e in tomb.items()
                        if isinstance(e, dict) and not e.get("deleted") and isinstance(e.get("txn"), dict)
                        and e["txn"] and k not in led]
            if drop:
                for k in drop:
                    del led[k]
                _rewrite_ledger(led)
            if put_back:
                merge_ledger(put_back)   # tombstones are off for these, so they land
            if drop or put_back:
                rebuild_from_ledger()
        except Exception:
            pass
    return {"ok": True, "changed": changed, "files": out_files, "filesMeta": out_meta}


# INCOME DECISION PRECEDENCE (highest wins) — the one place this is defined:
#   1. YOUR TAG (income.json): "income" or "ignore" — always wins.
#   2. GIG/PAYROLL HINT (INCOME_HINTS): instacart, shipt, payroll, … → income.
#   3. AUTO: counts as income only if NOT a transfer (CATEGORY_RULES) AND
#      passes is_income() (not a fee/interest/refund/reversal via NOT_INCOME).
def income_decision(desc, income_overrides=None, overrides=None):
    """Return (key, is_income, is_tagged) for a positive (incoming) amount.
    Your tag wins; otherwise fall back to the auto heuristic (see precedence above)."""
    if income_overrides is None:
        income_overrides = load_income_overrides()
    key = _income_key(desc)
    ov = income_overrides.get(key)
    if ov is not None:
        return key, ov == "income", True
    d = (desc or "").lower()
    if any(h in d for h in INCOME_HINTS):
        return key, True, False
    auto = categorize(desc, overrides) != "transfer" and is_income(desc)
    return key, auto, False


def deposit_sources(txns, limit=40):
    """Every incoming amount grouped by source, with its current income status
    (your tag, else the auto guess). Drives the income tagger UI."""
    income_overrides = load_income_overrides()
    overrides = load_overrides()
    agg = {}
    for t in txns:
        amt = t.get("amount", 0)
        if amt > 0:
            key, is_inc, tagged = income_decision(t.get("description", ""), income_overrides, overrides)
            if key not in agg:
                agg[key] = {"source": prettify_merchant(key, key.title()), "key": key, "amount": 0.0,
                            "status": "income" if is_inc else "ignore", "tagged": tagged}
            agg[key]["amount"] += amt
    rows = list(agg.values())
    for r in rows:
        r["amount"] = round(r["amount"], 2)
    rows.sort(key=lambda m: -m["amount"])
    return rows[:limit]


# ── transactions / snapshot ────────────────────────────────
def load_transactions():
    return _read(TRANSACTIONS, {}).get("transactions", [])


@_locked
def save_transactions(txns, window_days=30):
    _write(TRANSACTIONS, {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window_days": window_days,
        "transactions": txns,
    })


def categories_from_txns(txns, overrides):
    cats = {}
    for t in txns:
        amt = t.get("amount", 0)
        if amt < 0:
            c = categorize(t.get("description", ""), overrides)
            if c == "transfer":
                continue  # not spending — keep consistent with period_summary / Months
            cats[c] = cats.get(c, 0.0) + (-amt)
    return sorted(
        ({"key": k, "amount": round(v, 2)} for k, v in cats.items()),
        key=lambda c: -c["amount"],
    )


def other_merchants(txns, overrides, limit=14):
    """Top spends that landed in 'other' — grouped by cleaned merchant name.
    Returns display name + the key (substring rule) to teach a category."""
    agg = {}
    for t in txns:
        amt = t.get("amount", 0)
        if amt < 0 and categorize(t.get("description", ""), overrides) == "other":
            key = _clean(t.get("description", "")) or "unknown"
            agg[key] = agg.get(key, 0.0) + (-amt)
    rows = [{"merchant": k.title(), "key": k, "amount": round(v, 2)} for k, v in agg.items()]
    rows.sort(key=lambda m: -m["amount"])
    return rows[:limit]


def top_merchants(txns, overrides, limit=24):
    """All spending grouped by cleaned merchant, biggest first, with each
    one's CURRENT category — so you can review and reassign any of them."""
    agg = {}
    for t in txns:
        amt = t.get("amount", 0)
        if amt < 0:
            key = _clean(t.get("description", "")) or "unknown"
            it = agg.get(key)
            if it is None:
                it = agg[key] = {"merchant": key.title(), "key": key, "amount": 0.0,
                                 "category": categorize(t.get("description", ""), overrides),
                                 "count": 0, "first": None, "last": None}
            it["amount"] += -amt
            it["count"] += 1
            p = t.get("posted")
            if p:
                if it["first"] is None or p < it["first"]:
                    it["first"] = p
                if it["last"] is None or p > it["last"]:
                    it["last"] = p
    rows = list(agg.values())
    for r in rows:
        r["amount"] = round(r["amount"], 2)
    rows.sort(key=lambda m: -m["amount"])
    return rows[:limit]


def subscription_items(txns, overrides=None):
    """Recurring-subscription spend grouped by merchant (the 'subscriptions'
    category), biggest first. A window total ≈ the monthly cost for a charge
    that hits once a month."""
    if overrides is None:
        overrides = load_overrides()
    agg = {}
    for t in txns:
        amt = t.get("amount", 0)
        if amt < 0 and categorize(t.get("description", ""), overrides) == "subscriptions":
            key = _clean(t.get("description", "")) or "subscription"
            it = agg.get(key)
            if it is None:
                it = agg[key] = {"name": key.title(), "key": key, "amount": 0.0,
                                 "count": 0, "descriptions": [], "accounts": []}
            it["amount"] += -amt
            it["count"] += 1
            desc = (t.get("description") or "").strip()
            if desc and desc not in it["descriptions"] and len(it["descriptions"]) < 6:
                it["descriptions"].append(desc)
            acct = (t.get("account") or "").strip()
            if acct and acct not in it["accounts"]:
                it["accounts"].append(acct)
    rows = list(agg.values())
    for r in rows:
        r["amount"] = round(r["amount"], 2)
    rows.sort(key=lambda r: -r["amount"])
    return rows


# ── SimpleFIN response helpers (protocol conformance) ──────────────────
# The bank pull (sync.py) hands us the parsed /accounts JSON. Two shapes exist:
#   v1 — each account carried a nested `org` object; top-level `errors` was a list
#        of plain strings.
#   v2 (2026-03-19) — org moved to a flatter Connection (matched by the account's
#        `conn_id`), and errors moved to a structured `errlist` of {code,msg,…}.
# We read BOTH so a v1- or v2-default server both work, and we surface errors
# instead of silently treating a failed/partial pull as "no data".
def _sanitize_msg(s):
    """Third-party error text → one safe display line (control chars out, capped)."""
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", str(s))
    return re.sub(r"\s+", " ", s).strip()[:200]


def extract_errors(data):
    """Human-readable, sanitized errors from a /accounts response — v2 `errlist`
    (structured) and the deprecated v1 `errors` (strings), de-duped in order.
    The spec REQUIRES these be displayed to the user (sanitized first), so a
    partial or failed pull is never silently swallowed."""
    out = []
    if isinstance(data, dict):
        for e in (data.get("errlist") or []):
            if isinstance(e, dict):
                m = _sanitize_msg(e.get("msg") or e.get("code") or "")
            else:
                m = _sanitize_msg(e)
            if m:
                out.append(m)
        for e in (data.get("errors") or []):   # v1 (DEPRECATED) — array of strings
            m = _sanitize_msg(e)
            if m:
                out.append(m)
    seen, uniq = set(), []
    for m in out:
        if m not in seen:
            seen.add(m)
            uniq.append(m)
    return uniq


def _account_org_name(a, conn_by_id):
    """Institution name to show for an account, across protocol versions:
    v1 nested `org.name` → v2 Connection (`org_name`/`name`, matched by `conn_id`)
    → the account's own `conn_name` label, else ''."""
    org = a.get("org")
    if isinstance(org, dict) and org.get("name"):
        return org["name"]
    c = conn_by_id.get(a.get("conn_id"))
    if isinstance(c, dict) and (c.get("org_name") or c.get("name")):
        return c.get("org_name") or c.get("name")
    return a.get("conn_name") or ""


def build_snapshot(accounts, window_days=30, now=None, fetch_days=None, connections=None):
    now = now or int(time.time())
    fetch_days = fetch_days or window_days
    conn_by_id = {c.get("conn_id"): c for c in (connections or []) if isinstance(c, dict)}
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    fetch_cutoff = now - fetch_days * 86400      # keep txns this far back
    summary_cutoff = now - window_days * 86400   # but only summarize this window
    mid = now - (window_days // 2) * 86400
    total = cash = outflow = recent = older = 0.0
    income_total = 0.0
    xfer_total = 0.0   # excluded transfers — surfaced as a footnote figure, never spending
    cats = {}
    inc = {}
    untagged_inc = set()  # positive sources you haven't tagged income/ignore yet
    out_accounts = []
    txns = []

    for a in accounts:
        bal = float(a.get("balance", 0) or 0)
        total += bal
        if bal > 0:
            cash += bal
        for t in (a.get("transactions") or []):
            try:
                posted = int(t.get("posted", 0))
                amt = float(t.get("amount", 0) or 0)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(amt):
                continue   # float("NaN")/float("Infinity") raise NOTHING — a malformed bridge
                           # amount would poison the append-only ledger, emit invalid JSON
                           # (bare NaN) from every API, and fork web/desktop (webmoney's
                           # parseFloat filter drops what we'd keep). Same rule as the CSV
                           # importer's _num: non-finite is corruption, never data.
            if posted < fetch_cutoff:
                continue
            desc = t.get("description") or t.get("payee") or ""
            txns.append({"id": t.get("id"), "posted": posted, "amount": round(amt, 2),
                         "description": desc, "account": a.get("name", "Account")})
            if posted < summary_cutoff:
                continue  # kept in the ledger, but outside the summary window
            if amt < 0:
                spend = -amt
                c = categorize(desc, overrides)
                if c == "transfer":
                    # moving your own money / paying a card is NOT spending — the swipe already
                    # counted. Every other path (period_summary, Months, averages, statistics)
                    # excluded transfers since 2026-06-22; the snapshot was the ONE leaky path,
                    # so burn/day, spending.total, the trend and Safe-to-spend all ran ~hot.
                    xfer_total += spend
                    continue
                outflow += spend
                cats[c] = cats.get(c, 0.0) + spend
                if posted >= mid:
                    recent += spend
                else:
                    older += spend
            elif amt > 0:
                ikey, is_inc, tagged = income_decision(desc, income_overrides, overrides)
                if not tagged:
                    untagged_inc.add(ikey)
                if is_inc:
                    income_total += amt
                    inc[ikey] = inc.get(ikey, 0.0) + amt
        out_accounts.append({
            "id": a.get("id"), "name": a.get("name", "Account"),
            "org": _account_org_name(a, conn_by_id),
            "balance": round(bal, 2), "currency": a.get("currency", "USD"),
        })

    # accounts a sync can't see (Money Truth Brick 4): typed balances join the honest
    # totals — a real card the aggregator doesn't cover must not make Total quietly lie
    for ma in _manual_out_accounts():
        total += ma["balance"]
        if ma["balance"] > 0:
            cash += ma["balance"]
        out_accounts.append(ma)

    half = window_days / 2.0
    rd, od = recent / half, older / half
    trend = round((rd - od) / od * 100) if od > 0 else None
    cats_list = sorted(
        ({"key": k, "amount": round(v, 2)} for k, v in cats.items()),
        key=lambda c: -c["amount"],
    )
    income_sources = sorted(
        ({"source": prettify_merchant(k, k.title()), "key": k, "amount": round(v, 2), "tagged": k in income_overrides}
         for k, v in inc.items()),
        key=lambda s: -s["amount"],
    )
    window_txns = [t for t in txns if t["posted"] >= summary_cutoff]
    subs_items = subscription_items(window_txns, overrides)
    subs_total = round(sum(s["amount"] for s in subs_items), 2)

    snapshot = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": round(total, 2),
        "cash": round(cash, 2),
        "burn_per_day": round(outflow / window_days, 2),
        "spend_window_days": window_days,
        "spending": {
            "window_days": window_days,
            "total": round(outflow, 2),
            "per_month": round(outflow / window_days * 30, 2),
            "per_day": round(outflow / window_days, 2),
            "trend_pct": trend,
            "categories": cats_list,
            "transfers": round(xfer_total, 2),  # excluded from spending — footnote figure, same as period_summary
        },
        "income": {
            "window_days": window_days,
            "total": round(income_total, 2),
            "per_month": round(income_total / window_days * 30, 2),
            "sources": income_sources,
            "untagged": len(untagged_inc),
        },
        "subscriptions": {
            "window_days": window_days,
            "total": subs_total,
            "per_month": round(subs_total / window_days * 30, 2),
            "items": subs_items,
        },
        "accounts": out_accounts,
    }
    return snapshot, txns


def _next_rev(bal):
    """The snapshot's revision counter — bumped by EVERY change to derived data
    (a category edit, an income tag, a delete, an import, a bank sync). Widgets key
    their re-pulls on it. Deliberately separate from `updated`, which is the bank-sync
    timestamp feeding "synced X ago" and the cloud auto-push trigger — reusing that
    would make a local tag edit look like a fresh bank sync."""
    try:
        return int((bal or {}).get("rev") or 0) + 1
    except Exception:
        return 1


@_locked
def save_balances(snapshot):
    snapshot["rev"] = _next_rev(_read(BALANCES, {}))   # a bank sync is a change too
    _write(BALANCES, snapshot)


def append_history(snapshot, cap=400):
    hist = _read(HISTORY, [])
    if not isinstance(hist, list):
        hist = []
    entry = {
        "date": snapshot["updated"],
        "total": snapshot["total"],
        "cash": snapshot["cash"],
        "spend_30d": snapshot["spending"]["total"],
    }
    # one entry per day — replace today's if it exists
    if hist and hist[-1]["date"][:10] == entry["date"][:10]:
        hist[-1] = entry
    else:
        hist.append(entry)
    _write(HISTORY, hist[-cap:])


def _ledger_key(t):
    """Stable per-transaction key. Bank id when present, else a content key."""
    return str(t.get("id") or (str(t.get("posted")) + "|" + str(t.get("amount")) +
                               "|" + (t.get("description") or "")[:40]))


def _chmod600(path):
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _parse_jsonl_str(content):
    """Parse .jsonl CONTENT (a string, e.g. a restored bundle entry) into {key: txn},
    same tolerance as _parse_jsonl: a bad line is skipped, never fatal."""
    led = {}
    for line in (content or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            t = json.loads(line)
        except Exception:
            continue
        if isinstance(t, dict):
            led[_ledger_key(t)] = t
    return led


def _parse_jsonl(path):
    """Read a .jsonl ledger into {key: txn}, last line wins for a repeated key.
    Returns (ledger_dict, lines_read, bad_lines). A single bad line is SKIPPED,
    not fatal — that line-level isolation is the whole point of this format."""
    led, lines, bad = {}, 0, 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            lines += 1
            try:
                t = json.loads(line)
            except Exception:
                bad += 1
                continue
            led[_ledger_key(t)] = t
    return led, lines, bad


def _migrate_json_to_jsonl():
    """One-time: convert the old single-object ledger.json → ledger.jsonl, and
    keep the original as a .pre-jsonl.bak safety copy."""
    try:
        with open(LEDGER_OLD) as f:
            old = json.load(f)
    except Exception:
        return False
    if not isinstance(old, dict) or not old:
        return False
    tmp = LEDGER + ".tmp"
    with open(tmp, "w") as f:
        for t in old.values():
            f.write(json.dumps(t) + "\n")
        f.flush()
        os.fsync(f.fileno())   # durable before the rename, like _rewrite_ledger
    os.replace(tmp, LEDGER)
    _fsync_dir(os.path.dirname(LEDGER))
    _chmod600(LEDGER)
    try:
        os.replace(LEDGER_OLD, LEDGER_OLD + ".pre-jsonl.bak")
    except OSError:
        pass
    return True


def _rewrite_ledger(led):
    """Atomically rewrite the whole .jsonl (used for compaction)."""
    tmp = LEDGER + ".tmp"
    with open(tmp, "w") as f:
        for t in led.values():
            f.write(json.dumps(t) + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, LEDGER)
    _fsync_dir(os.path.dirname(LEDGER))
    _chmod600(LEDGER)


def _restore_ledger_from_backup():
    """Newest dated backup with a readable ledger (.jsonl preferred, .json
    fallback) → {key: txn}, else None."""
    if not os.path.isdir(BACKUPS):
        return None
    for day in sorted(os.listdir(BACKUPS), reverse=True):
        d = os.path.join(BACKUPS, day)
        jl = os.path.join(d, "ledger.jsonl")
        if os.path.exists(jl):
            try:
                led, _, _ = _parse_jsonl(jl)
                if led:
                    return led
            except Exception:
                pass
        try:
            with open(os.path.join(d, "ledger.json")) as f:
                led = json.load(f)
            if isinstance(led, dict) and led:
                return led
        except Exception:
            continue
    return None


# (path, mtime_ns, size)-keyed memo: api_snapshot alone walks ~12 analytics views that each
# re-read the append-only ledger — one parse per file VERSION instead (2026-07-29 cache
# review). Self-invalidating: any append/compact moves mtime/size. Callers may mutate the
# returned dict (merge_ledger does), so hand out a SHALLOW COPY, never the cached object.
_LEDGER_MEMO = {"sig": None, "led": None}


def load_ledger():
    """Read the permanent ledger SAFELY into {key: txn}. A ledger that exists
    but won't parse must NEVER fall through to empty — that path would let the
    next write replace your whole history with just the latest pull. Bad lines
    are skipped individually; only a total failure triggers a backup restore,
    and if there's no good backup we raise rather than risk a wipe."""
    if not os.path.exists(LEDGER) and os.path.exists(LEDGER_OLD):
        _migrate_json_to_jsonl()
    if not os.path.exists(LEDGER):
        return {}  # genuinely first run / nothing stored yet
    try:
        st = os.stat(LEDGER)
        sig = (LEDGER, st.st_mtime_ns, st.st_size)
    except OSError:
        sig = None
    if sig is not None and _LEDGER_MEMO["sig"] == sig:
        return dict(_LEDGER_MEMO["led"])
    try:
        led, lines, bad = _parse_jsonl(LEDGER)
        if led or (lines == 0 and bad == 0):
            if sig is not None and not bad:
                _LEDGER_MEMO["sig"] = sig
                _LEDGER_MEMO["led"] = dict(led)
            return led  # got the good lines (or the file is legitimately empty)
    except Exception:
        pass
    restored = _restore_ledger_from_backup()
    if restored is not None:
        return restored
    raise RuntimeError(
        "ledger.jsonl is unreadable and no good backup was found — refusing to "
        "write so your transaction history is not lost. Restore from backups/ first.")


@_locked
def merge_ledger(txns):
    """Accumulate transactions permanently, deduped by key. APPEND-ONLY: new or
    changed transactions are appended as lines (O(1), never rewrites history);
    the file is compacted only when superseding updates make it grow stale. A
    shrink guard means a bad read can never replace history with less.

    THE one choke point for anything entering the ledger (bank sync, CSV import,
    a merged restore), so it is where TOMBSTONES are enforced: a transaction you
    deleted can never be resurrected here — not by a device that still holds it,
    not by a restore from a vault sealed before the delete. (undelete_txn clears
    the tombstone first, so its own re-add sails through.)"""
    tomb = load_deleted()
    txns = [t for t in txns if not is_deleted(_ledger_key(t), tomb)]
    led = load_ledger()
    before = len(led)
    new_lines, changed = [], False
    for t in txns:
        k = _ledger_key(t)
        if led.get(k) == t:
            continue  # already stored, identical
        if k in led:
            changed = True  # supersedes an existing line
        led[k] = t
        new_lines.append(json.dumps(t))
    if len(led) < before:  # a merge only ever adds — a shrink means something is wrong
        raise RuntimeError("ledger merge would shrink %d→%d — aborting to protect data"
                           % (before, len(led)))
    if not new_lines:
        return len(led)
    if changed:
        _rewrite_ledger(led)  # compact away the superseded lines
    else:
        _append_lines(LEDGER, new_lines)  # pure append, torn-tail-safe + durable
        _chmod600(LEDGER)
    return len(led)


def verify_ledger():
    """Non-destructive integrity check — proves the ledger is readable, internally
    consistent, free of corrupt lines, and recoverable from a backup. Powers the
    in-app 'data verified' trust badge and check.sh. Reads only; never writes."""
    res = {"ok": True, "count": 0, "backups": 0, "last_backup": None, "checks": []}

    def add(name, ok, detail=""):
        res["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            res["ok"] = False
    try:
        led = load_ledger()
    except Exception as e:
        add("ledger readable", False, str(e)[:120])
        return res
    txns = list(led.values()) if isinstance(led, dict) else []
    res["count"] = len(txns)
    add("ledger readable", isinstance(led, dict), "%d transactions" % len(txns))
    ids = [t.get("id") for t in txns if t.get("id")]
    add("unique transaction ids", len(ids) == len(set(ids)), "%d ids · %d unique" % (len(ids), len(set(ids))))
    malformed = sum(1 for t in txns if not (t.get("id") and t.get("posted") is not None and "amount" in t))
    add("well-formed rows", malformed == 0, "%d malformed" % malformed)
    corrupt = lines = 0
    if os.path.exists(LEDGER):
        with open(LEDGER) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                lines += 1
                try:
                    json.loads(line)
                except Exception:
                    corrupt += 1
    add("no corrupt lines on disk", corrupt == 0, "%d corrupt of %d" % (corrupt, lines))
    days = sorted(d for d in os.listdir(BACKUPS) if os.path.isdir(os.path.join(BACKUPS, d))) if os.path.isdir(BACKUPS) else []
    res["backups"] = len(days)
    res["last_backup"] = days[-1] if days else None
    # a brand-new cache has nothing to back up yet — that's a clean bill, not a warning
    # (day one should never open with "check your data")
    if res.get("count", 0) == 0 and not days:
        add("recoverable backup exists", True, "nothing to back up yet")
    else:
        add("recoverable backup exists", _restore_ledger_from_backup() is not None, "%d backup days" % len(days))
    return res


def append_synclog(accounts, transactions, cap=50):
    log = _read(SYNCLOG, [])
    if not isinstance(log, list):
        log = []
    log.append({
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "accounts": accounts,
        "transactions": transactions,
    })
    _write(SYNCLOG, log[-cap:])


def backup(keep=45, force=False):
    """Copy the data files into backups/<date>/ — a local restore point.
    One per day unless force=True. Keeps the most recent `keep` days."""
    label = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if force:
        label = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    dest = os.path.join(BACKUPS, label)
    if os.path.exists(dest) and not force:
        return None  # already backed up today
    os.makedirs(dest, exist_ok=True)
    for name in _BACKUP_FILES:
        src = os.path.join(DATA, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, name))
    days = sorted(d for d in os.listdir(BACKUPS) if os.path.isdir(os.path.join(BACKUPS, d)))
    for old in days[:-keep]:
        shutil.rmtree(os.path.join(BACKUPS, old), ignore_errors=True)
    return dest


@_locked
def recompute_spending():
    """Recompute category totals from stored transactions + overrides, and
    rewrite balances.json. Used after a category edit (no bank call needed)."""
    txns = load_transactions()
    overrides = load_overrides()
    bal = _read(BALANCES, {})
    sp = bal.get("spending", {})
    sp["categories"] = categories_from_txns(txns, overrides)
    # Recompute the TOTALS too, not just the category split. This used to leave total/per_day/
    # burn_per_day at the last sync's numbers — so categorizing a txn as "transfer" removed it
    # from the list while the burn stayed inflated until the next bank pull (the honest-burn bug's
    # second path). Same rule as build_snapshot: transfers are never spending.
    wd = sp.get("window_days") or bal.get("spend_window_days") or 30
    now_ts = int(time.time())
    mid_ts = now_ts - (wd // 2) * 86400
    outflow = xfer_total = recent = older = 0.0
    for t in txns:
        try:
            amt = float(t.get("amount", 0) or 0)
            posted = int(t.get("posted", 0) or 0)
        except (TypeError, ValueError):
            continue
        if amt >= 0:
            continue
        spend = -amt
        if categorize(t.get("description", ""), overrides) == "transfer":
            xfer_total += spend
            continue
        outflow += spend
        if posted >= mid_ts:
            recent += spend
        else:
            older += spend
    half = wd / 2.0
    rd, od = recent / half, older / half
    sp["total"] = round(outflow, 2)
    sp["per_month"] = round(outflow / wd * 30, 2)
    sp["per_day"] = round(outflow / wd, 2)
    sp["trend_pct"] = round((rd - od) / od * 100) if od > 0 else None
    sp["transfers"] = round(xfer_total, 2)
    bal["burn_per_day"] = round(outflow / wd, 2)
    bal["spending"] = sp
    subs_items = subscription_items(txns, overrides)
    subs_total = round(sum(s["amount"] for s in subs_items), 2)
    wd = sp.get("window_days") or 30
    bal["subscriptions"] = {"window_days": wd, "total": subs_total,
                            "per_month": round(subs_total / wd * 30, 2), "items": subs_items}
    bal["rev"] = _next_rev(bal)   # derived data moved → widgets re-pull
    _write(BALANCES, bal)
    recompute_monthly()
    return sp


@_locked
def recompute_income():
    """Recompute the income block from stored transactions + your tags, and
    rewrite balances.json. Used after an income tag edit (no bank call)."""
    txns = load_transactions()
    income_overrides = load_income_overrides()
    overrides = load_overrides()
    bal = _read(BALANCES, {})
    window_days = (bal.get("income") or {}).get("window_days") or bal.get("spend_window_days") or 30
    total = 0.0
    inc = {}
    untagged_inc = set()
    for t in txns:
        amt = t.get("amount", 0)
        if amt > 0:
            key, is_inc, tagged = income_decision(t.get("description", ""), income_overrides, overrides)
            if not tagged:
                untagged_inc.add(key)
            if is_inc:
                total += amt
                inc[key] = inc.get(key, 0.0) + amt
    sources = sorted(
        ({"source": prettify_merchant(k, k.title()), "key": k, "amount": round(v, 2), "tagged": k in income_overrides}
         for k, v in inc.items()),
        key=lambda s: -s["amount"],
    )
    income = {"window_days": window_days, "total": round(total, 2),
              "per_month": round(total / window_days * 30, 2), "sources": sources,
              "untagged": len(untagged_inc)}
    bal["income"] = income
    bal["rev"] = _next_rev(bal)   # derived data moved → widgets re-pull
    _write(BALANCES, bal)
    recompute_monthly()
    return income


# ── Period summary (global date-range selector) ──────────────
def _ledger_txns():
    led = load_ledger()
    return list(led.values()) if isinstance(led, dict) else []


def resolve_period(kind="mtd", ym=None, now=None, start_d=None, end_d=None):
    """Turn a period spec into (start, end, label) — unix seconds, using LOCAL
    calendar boundaries so it lines up with the Months view.
      mtd            this calendar month, up to now (the default)
      month + ym     a specific calendar month ("2026-05")
      30d / 90d      trailing N days
      all            the full ledger span
      custom         an explicit start_d..end_d ("YYYY-MM-DD", inclusive)
    end is exclusive."""
    now = now or int(time.time())
    if kind == "custom" and start_d and end_d:
        try:
            y1, m1, d1 = (int(x) for x in start_d.split("-"))
            y2, m2, d2 = (int(x) for x in end_d.split("-"))
            start = int(datetime(y1, m1, d1).timestamp())
            end = int(datetime(y2, m2, d2).timestamp()) + 86400  # include the end day
            if end <= start:
                start, end = end - 86400, start + 86400
            label = "%s %d – %s %d" % (datetime(y1, m1, d1).strftime("%b"), d1,
                                       datetime(y2, m2, d2).strftime("%b"), d2)
            return start, end, label
        except (ValueError, TypeError):
            pass  # fall through to the default month
    if kind == "30d":
        return now - 30 * 86400, now, "Last 30 days"
    if kind == "90d":
        return now - 90 * 86400, now, "Last 90 days"
    if kind == "all":
        ts = [p for p in ((t.get("posted") or 0) for t in _ledger_txns()) if p]
        return (min(ts) if ts else now - 365 * 86400), now, "All time"
    # month / mtd → a calendar month (current one when ym is missing)
    n = datetime.fromtimestamp(now)
    if not ym:
        ym = n.strftime("%Y-%m")
    y, mo = int(ym[:4]), int(ym[5:7])
    start = int(datetime(y, mo, 1).timestamp())
    ny, nm = (y + 1, 1) if mo == 12 else (y, mo + 1)
    end = min(int(datetime(ny, nm, 1).timestamp()), now)
    return start, end, datetime(y, mo, 1).strftime("%b %Y")


def period_summary(kind="mtd", ym=None, now=None, start_d=None, end_d=None):
    """Income / spending / subscriptions for an arbitrary period, computed
    from the full permanent ledger. Returns the SAME shape as the matching
    blocks in balances.json, so the span widgets can read it directly. The
    point-in-time fields (total / cash / accounts) are copied through from the
    live snapshot since they don't depend on the window."""
    start, end, label = resolve_period(kind, ym, now, start_d, end_d)
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    win = [t for t in _ledger_txns() if start <= (t.get("posted") or 0) < end]
    days = max(1, round((end - start) / 86400.0))
    outflow = income_total = xfer_total = 0.0
    cats, inc = {}, {}
    untagged_inc = set()
    for t in win:
        try:
            amt = float(t.get("amount", 0) or 0)
        except (TypeError, ValueError):
            continue
        desc = t.get("description") or t.get("payee") or ""
        if amt < 0:
            spend = -amt
            c = categorize(desc, overrides)
            if c == "transfer":
                xfer_total += spend  # moving your own money / paying a card — NOT spending
                continue
            outflow += spend
            cats[c] = cats.get(c, 0.0) + spend
        elif amt > 0:
            ikey, is_inc, tagged = income_decision(desc, income_overrides, overrides)
            if not tagged:
                untagged_inc.add(ikey)
            if is_inc:
                income_total += amt
                inc[ikey] = inc.get(ikey, 0.0) + amt
    cats_list = sorted(({"key": k, "amount": round(v, 2)} for k, v in cats.items()),
                       key=lambda c: -c["amount"])
    income_sources = sorted(
        ({"source": prettify_merchant(k, k.title()), "key": k, "amount": round(v, 2), "tagged": k in income_overrides}
         for k, v in inc.items()),
        key=lambda s: -s["amount"])
    subs_items = subscription_items(win, overrides)
    subs_total = round(sum(s["amount"] for s in subs_items), 2)
    bal = _read(BALANCES, {})
    norm = 30.0 / days  # extrapolate the window to a monthly run-rate
    return {
        "period": {"kind": kind, "ym": ym, "start": start, "end": end,
                   "days": days, "label": label, "count": len(win)},
        "catmeta": {"labels": load_catmeta()["labels"]},  # renamed category labels → ripple to all widgets
        "updated": bal.get("updated"),
        "rev": bal.get("rev", 0),   # bumps on ANY derived-data change (tag, delete, import, sync) — widgets key re-pulls on it

        "total": bal.get("total"), "cash": bal.get("cash"),
        "accounts": bal.get("accounts", []),
        "burn_per_day": round(outflow / days, 2),
        "spend_window_days": days,
        "spending": {
            "window_days": days, "total": round(outflow, 2),
            "per_month": round(outflow * norm, 2), "per_day": round(outflow / days, 2),
            "trend_pct": None, "categories": cats_list,
            "transfers": round(xfer_total, 2),  # excluded from spending; shown as a footnote
        },
        "income": {
            "window_days": days, "total": round(income_total, 2),
            "per_month": round(income_total * norm, 2),
            "sources": income_sources, "untagged": len(untagged_inc),
        },
        "subscriptions": {
            "window_days": days, "total": subs_total,
            "per_month": round(subs_total * norm, 2), "items": subs_items,
        },
    }


def is_interest_txn(desc, amt):
    """A charge that is INTEREST (the cost of carrying debt) — outgoing only, so a
    savings account's 'interest paid to you' (a positive amount) never counts.
    Deterministic keyword detection; the Debt widget reads what this finds."""
    if not (amt < 0):
        return False
    d = (desc or "").lower()
    return "interest" in d


def is_card_payment_txn(desc, amt):
    """An outgoing CARD PAYMENT (money moving to a card issuer from the checking side) —
    the phrases banks actually print, mirroring the transfer rule's card-payment keys.
    Used for the payments-vs-interest pace; deliberately conservative (a missed payment
    understates the pace and shows a LATER payoff date — honest in the safe direction)."""
    if not (amt < 0):
        return False
    d = (desc or "").lower()
    return any(k in d for k in ("card payment", "credit card payment", "crd autopay",
                                "card autopay", "payment thank you", "epayment", "e-payment",
                                "credit crd", "cardmember"))


def monthly_history(limit=24):
    """Bucket the full permanent ledger by calendar month — income, spending
    (transfers excluded), net, and category split. Powers the Months view so
    you can see every backlogged month, not just the last 30 days. Also carries
    per-month `interest` (what debt cost) + `ccpay` (card payments made) for the
    Debt widget — both ride monthly.json so every surface reads one truth."""
    led = load_ledger()
    txns = list(led.values()) if isinstance(led, dict) else []
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    months = {}
    for t in txns:
        posted = t.get("posted")
        if not posted:
            continue
        ym = datetime.fromtimestamp(posted).strftime("%Y-%m")
        m = months.get(ym)
        if m is None:
            m = months[ym] = {"income": 0.0, "spending": 0.0, "cats": {}, "count": 0,
                              "live": 0, "imported": 0, "interest": 0.0, "ccpay": 0.0}
        m["count"] += 1
        m["imported" if str(t.get("id", "")).startswith("csv:") else "live"] += 1
        amt = t.get("amount", 0) or 0
        desc = t.get("description", "")
        if is_interest_txn(desc, amt):
            m["interest"] += -amt
        if is_card_payment_txn(desc, amt):
            m["ccpay"] += -amt
        if amt < 0:
            c = categorize(desc, overrides)
            if c != "transfer":
                m["spending"] += -amt
                m["cats"][c] = m["cats"].get(c, 0.0) + (-amt)
        elif amt > 0:
            _, is_inc, _ = income_decision(desc, income_overrides, overrides)
            if is_inc:
                m["income"] += amt
    rows = []
    for ym, m in months.items():
        cats = sorted(({"key": k, "amount": round(v, 2)} for k, v in m["cats"].items()),
                      key=lambda c: -c["amount"])
        rows.append({
            "ym": ym,
            "label": datetime.strptime(ym, "%Y-%m").strftime("%b %Y"),
            "income": round(m["income"], 2),
            "spending": round(m["spending"], 2),
            "net": round(m["income"] - m["spending"], 2),
            "count": m["count"],
            "live": m["live"],
            "imported": m["imported"],
            "categories": cats,
            "interest": round(m["interest"], 2),   # what carrying debt cost this month (Debt widget)
            "ccpay": round(m["ccpay"], 2),         # card payments made this month (pace for the payoff ETA)
        })
    rows.sort(key=lambda r: r["ym"], reverse=True)
    return rows[:limit]


def monthly_income_by_source(months_back=12, top=6):
    """Per-month income from the full ledger, broken down by source — drives the
    stacked income-forecast chart's HISTORY half. Returns months (oldest→newest)
    and a band per source with an amount for each month, ranked by lifetime total;
    sources past `top` fold into 'Other income'."""
    led = load_ledger()
    txns = list(led.values()) if isinstance(led, dict) else []
    income_overrides = load_income_overrides()
    overrides = load_overrides()
    buckets, names, totals = {}, {}, {}
    for t in txns:
        amt = t.get("amount", 0) or 0
        posted = t.get("posted")
        if amt <= 0 or not posted:
            continue
        key, is_inc, _ = income_decision(t.get("description", ""), income_overrides, overrides)
        if not is_inc:
            continue
        ym = datetime.fromtimestamp(posted).strftime("%Y-%m")
        buckets.setdefault(ym, {})
        buckets[ym][key] = buckets[ym].get(key, 0.0) + amt
        names[key] = prettify_merchant(key, key.title())
        totals[key] = totals.get(key, 0.0) + amt
    yms = sorted(buckets.keys())
    if months_back:
        yms = yms[-months_back:]
    months = [{"ym": ym, "label": datetime.strptime(ym, "%Y-%m").strftime("%b")} for ym in yms]
    ranked = sorted(totals, key=lambda k: -totals[k])
    sources = []
    for key in ranked[:top]:
        sources.append({
            "key": key, "name": names[key],
            "monthly": [round(buckets.get(ym, {}).get(key, 0.0), 2) for ym in yms],
            "total": round(totals[key], 2),
        })
    other = [0.0] * len(yms)
    for key in ranked[top:]:
        for i, ym in enumerate(yms):
            other[i] += buckets.get(ym, {}).get(key, 0.0)
    if any(other):
        sources.append({"key": "__other__", "name": "Other income",
                        "monthly": [round(v, 2) for v in other], "total": round(sum(other), 2)})
    return {"months": months, "sources": sources}


def data_coverage():
    """What data we have and where it came from. Per account: its date span,
    transaction count, and source (live = SimpleFIN sync, imported = CSV).
    Plus the overall live-sync window so you know how far back it reaches."""
    led = load_ledger()
    txns = list(led.values()) if isinstance(led, dict) else []
    accts = {}
    live_first = live_last = None
    for t in txns:
        imported = str(t.get("id", "")).startswith("csv:")
        name = t.get("account") or "?"
        a = accts.get(name)
        if a is None:
            a = accts[name] = {"account": name, "count": 0, "first": None, "last": None,
                               "live": 0, "imported": 0}
        a["count"] += 1
        a["imported" if imported else "live"] += 1
        p = t.get("posted")
        if p:
            if a["first"] is None or p < a["first"]:
                a["first"] = p
            if a["last"] is None or p > a["last"]:
                a["last"] = p
            if not imported:
                if live_first is None or p < live_first:
                    live_first = p
                if live_last is None or p > live_last:
                    live_last = p
    rows = []
    for a in accts.values():
        a["source"] = "live" if a["imported"] == 0 else ("imported" if a["live"] == 0 else "mixed")
        rows.append(a)
    rows.sort(key=lambda r: -r["count"])
    return {"accounts": rows, "live_first": live_first, "live_last": live_last, "total": len(txns)}


@_locked
def recompute_coverage():
    cov = data_coverage()
    cov["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _write(COVERAGE, cov)
    return cov


# ── Lifetime monthly averages ──────────────────────────────
def averages(skip_partial=True):
    """Lifetime monthly averages from the full ledger — your real baseline.
    Buckets every transaction by calendar month, then averages across the
    months you have data for. Optionally drops the current (partial) month so
    it doesn't drag the averages down."""
    txns = _ledger_txns()
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    remap = load_catmeta()["remap"]
    cur_ym = datetime.fromtimestamp(time.time()).strftime("%Y-%m")
    months = {}
    for t in txns:
        p = t.get("posted") or 0
        if not p:
            continue
        ym = datetime.fromtimestamp(p).strftime("%Y-%m")
        m = months.setdefault(ym, {"income": 0.0, "spend": 0.0, "subs": 0.0, "instacart": 0.0})
        amt = t.get("amount", 0) or 0
        desc = t.get("description", "") or ""
        if amt > 0:
            _key, is_inc, _tagged = income_decision(desc, income_overrides, overrides)
            if is_inc:
                m["income"] += amt
                if "instacart" in desc.lower():
                    m["instacart"] += amt
        else:
            c = categorize(desc, overrides, remap)
            if c != "transfer":
                m["spend"] += -amt
                if c == "subscriptions":
                    m["subs"] += -amt
    if skip_partial and len(months) > 1:
        months.pop(cur_ym, None)
    n = len(months) or 1
    avg = lambda f: round(sum(x[f] for x in months.values()) / n, 2)
    inc, spend = avg("income"), avg("spend")
    return {
        "months": len(months),
        "income": inc, "spend": spend, "net": round(inc - spend, 2),
        "deficit": round(spend - inc, 2),   # avg monthly shortfall (positive = you run short)
        "subscriptions": avg("subs"), "instacart": avg("instacart"),
        "per_day": round(spend / 30.0, 2),
    }


def statistics():
    """A spread of interesting, real data facts from the whole ledger for the
    Statistics widget — lifetime + per-month + per-category, computed once."""
    txns = _ledger_txns()
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    remap = load_catmeta()["remap"]
    cur_ym = datetime.fromtimestamp(time.time()).strftime("%Y-%m")
    months, cats = {}, {}
    total_in = total_out = 0.0
    biggest = {"amt": 0.0, "desc": ""}
    for t in txns:
        p = t.get("posted") or 0
        if not p:
            continue
        ym = datetime.fromtimestamp(p).strftime("%Y-%m")
        amt = t.get("amount", 0) or 0
        desc = t.get("description", "") or ""
        m = months.setdefault(ym, {"income": 0.0, "spend": 0.0, "subs": 0.0})
        if amt > 0:
            _k, is_inc, _tg = income_decision(desc, income_overrides, overrides)
            if is_inc:
                m["income"] += amt; total_in += amt
        else:
            c = categorize(desc, overrides, remap)
            if c != "transfer":
                s = -amt
                m["spend"] += s; total_out += s
                cats[c] = cats.get(c, 0.0) + s
                if c == "subscriptions":
                    m["subs"] += s
                if s > biggest["amt"]:
                    biggest = {"amt": s, "desc": _clean(desc)}
    full = {k: v for k, v in months.items() if k != cur_ym} or months
    n = len(full) or 1
    avg = lambda f: sum(x[f] for x in full.values()) / n
    inc, spend, subs = avg("income"), avg("spend"), avg("subs")
    net = inc - spend
    nets = {k: v["income"] - v["spend"] for k, v in full.items()}
    best = max(nets.items(), key=lambda kv: kv[1]) if nets else None
    worst = min(nets.items(), key=lambda kv: kv[1]) if nets else None
    top_cat = max(cats.items(), key=lambda kv: kv[1]) if cats else None
    rate = (net / inc * 100.0) if inc > 0 else 0.0
    money = lambda v: "$" + format(int(round(v)), ",")
    signed = lambda v: ("+" if v >= 0 else "−") + money(abs(v))
    def mlabel(ym):
        try:
            return datetime.strptime(ym, "%Y-%m").strftime("%b %Y")
        except Exception:
            return ym
    stats = [
        {"label": "Months tracked", "value": str(len(months))},
        {"label": "Avg income", "value": money(inc) + "/mo", "tone": "ok"},
        {"label": "Avg spending", "value": money(spend) + "/mo", "tone": "bad"},
        {"label": "Avg net", "value": signed(net) + "/mo", "tone": "ok" if net >= 0 else "bad"},
        {"label": "Savings rate", "value": str(int(round(rate))) + "%", "tone": "ok" if rate >= 0 else "bad"},
        {"label": "Spend / day", "value": money(spend / 30.0)},
        {"label": "Subscriptions", "value": money(subs) + "/mo"},
        {"label": "Best month", "value": (mlabel(best[0]) + " · " + signed(best[1])) if best else "—", "tone": "ok"},
        {"label": "Leanest month", "value": (mlabel(worst[0]) + " · " + signed(worst[1])) if worst else "—", "tone": "bad"},
        {"label": "Top category", "value": (top_cat[0].title() + " · " + money(top_cat[1])) if top_cat else "—"},
        {"label": "Biggest expense", "value": (money(biggest["amt"]) + (" · " + biggest["desc"] if biggest["desc"] else "")) if biggest["amt"] > 0 else "—"},
        {"label": "Transactions", "value": format(len(txns), ",")},
        {"label": "Lifetime in", "value": money(total_in), "tone": "ok"},
        {"label": "Lifetime out", "value": money(total_out), "tone": "bad"},
    ]
    return {"ok": True, "months": len(months), "stats": stats}


# ── Work: Toggl hours paired with REAL bank earnings ──────
def work_summary():
    """Combine Toggl hours (from toggl.json) with actual income received from
    the ledger over the same windows (today / this week / this month), so you
    can see real $ earned vs hours worked — and a true effective $/hr.
    NOTE: 'earned' = income that LANDED in your bank during the window; pay lags
    work, so it's most meaningful at the month level."""
    tg = _read(TOGGL, {})
    if not isinstance(tg, dict):
        tg = {}
    income_overrides = load_income_overrides()
    overrides = load_overrides()
    now = datetime.now()
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week0 = today0 - timedelta(days=today0.weekday())   # Monday
    month0 = today0.replace(day=1)
    t0, w0, m0 = today0.timestamp(), week0.timestamp(), month0.timestamp()

    today_e = week_e = month_e = 0.0
    for t in _ledger_txns():
        amt = t.get("amount", 0) or 0
        if amt <= 0:
            continue
        _key, is_inc, _tagged = income_decision(t.get("description", ""), income_overrides, overrides)
        if not is_inc:
            continue
        p = t.get("posted") or 0
        if p >= t0:
            today_e += amt
        if p >= w0:
            week_e += amt
        if p >= m0:
            month_e += amt
    return {
        "updated": tg.get("updated"),
        "today": {"hours": tg.get("today_hours", 0), "earned": round(today_e, 2)},
        "week": {"hours": tg.get("week_hours", 0), "earned": round(week_e, 2)},
        "month": {"hours": tg.get("month_hours", 0), "earned": round(month_e, 2)},
        "running": tg.get("running"),
        "projects_month": tg.get("projects_month", []),
    }


def monthly_hours_history():
    """Per-month Toggl hours ({'YYYY-MM': hours}) — drives the forecast's
    real-effort overlay (hours × your gig rate vs the projection)."""
    tg = _read(TOGGL, {})
    mh = tg.get("monthly_hours", {}) if isinstance(tg, dict) else {}
    return {"monthly_hours": mh if isinstance(mh, dict) else {}}


# ── Recurrence detection (your real subscriptions, tagged or not) ──
def income_rhythms(txns=None, now=None):
    """EVERY income source with a visible rhythm, read forward — median gap between its
    deposits (≥2 seen, gaps of 3–45 days, so same-day split deposits and one-offs never
    fake a rhythm), nearest upcoming first. Each entry carries `last` (the newest real
    deposit) and `gap_days` (the rhythm's step) on top of the next-deposit fields, so a
    client can project the whole beat forward — the calendar's week view paints every
    payday in the week, not just the nearest one.
    Returns [{key, source, last, gap_days, next, ymd, days, amount}] (possibly empty)."""
    if txns is None:
        txns = _ledger_txns()
    now = now or int(time.time())
    day = 86400
    income_overrides = load_income_overrides()
    overrides = load_overrides()
    by = {}
    for t in txns:
        try:
            amt = float(t.get("amount", 0) or 0)
        except (TypeError, ValueError):
            continue
        posted = t.get("posted") or 0
        if amt <= 0 or not posted or not math.isfinite(amt):
            continue   # NaN <= 0 is False — an old poisoned ledger row must not ride into the median
        key, is_inc, _tag = income_decision(t.get("description", ""), income_overrides, overrides)
        if not is_inc:
            continue
        by.setdefault(key, []).append((posted, amt))
    out = []
    for key, rows in by.items():
        rows.sort()
        posts = [r[0] for r in rows]
        gaps = sorted(g for g in (posts[i + 1] - posts[i] for i in range(len(posts) - 1)) if g >= 3 * day)
        if not gaps:
            continue
        med = gaps[len(gaps) // 2]
        if med > 45 * day:
            continue
        if now - posts[-1] > max(2 * med, 21 * day):
            continue   # silent for over two cycles — the rhythm is dead, promise nothing
        nxt = posts[-1] + med
        while nxt < now:
            nxt += med
        amt_med = sorted(r[1] for r in rows)[len(rows) // 2]
        # key order matters: next_deposit pops last/gap_days and its dict must stay
        # byte-identical to the shape shipped before this refactor.
        out.append({"key": key, "source": prettify_merchant(key, key.title()),
                    "last": posts[-1], "gap_days": max(1, int(round(med / day))),
                    "next": nxt, "ymd": datetime.fromtimestamp(nxt).strftime("%Y-%m-%d"),
                    "days": round((nxt - now) / day), "amount": round(amt_med, 2)})
    out.sort(key=lambda r: (r["next"], r["key"]))   # key breaks a tie so both runtimes order the same
    return out


def next_deposit_of(rhythms):
    """The head of an already-computed income_rhythms() list, in the next_deposit shape —
    so a caller that wants BOTH (the /api/runway route) never walks the ledger twice."""
    if not rhythms:
        return None
    best = dict(rhythms[0])
    best.pop("last", None)
    best.pop("gap_days", None)
    return best


def next_deposit(txns=None, now=None):
    """The next EXPECTED income deposit (the paycheck-runway anchor) — the head of
    income_rhythms(). Returns {key, source, next, ymd, days, amount} or None."""
    return next_deposit_of(income_rhythms(txns, now))


def runway_payload(txns=None, now=None):
    """/api/runway's body, computed once: the anchor + every visible income rhythm."""
    rhythms = income_rhythms(txns, now)
    return {"next_deposit": next_deposit_of(rhythms), "rhythms": rhythms}


def annual_predictions(txns=None, now=None, limit=12):
    """Yearly charges forecast FORWARD (Money Truth Brick 5a) — card annual fees, yearly
    renewals — so the anniversary stops ambushing Safe-to-spend. Deterministic rules:
      · a merchant whose charge gaps are ALL ~a year (330–430d) → "yearly" (proven pattern)
      · a single charge 270–430 days old (≥ $15)               → "maybe" (might renew)
      · any gap under 200 days → the monthly radar's job, never predicted here
    The permanent ledger already holds the history; this just reads it forward."""
    if txns is None:
        txns = _ledger_txns()
    now = now or int(time.time())
    day = 86400
    by = {}
    for t in txns:
        amt = t.get("amount", 0) or 0
        posted = t.get("posted") or 0
        if amt >= 0 or not posted:
            continue
        key = _clean(t.get("description", "")) or "unknown"
        by.setdefault(key, []).append((posted, -amt))
    out = []
    for key, rows in by.items():
        rows.sort()
        posts = [r[0] for r in rows]
        gaps = [posts[i + 1] - posts[i] for i in range(len(posts) - 1)]
        if any(g < 200 * day for g in gaps):
            continue
        last_p, last_amt = rows[-1]
        age = now - last_p
        yearly = [g for g in gaps if 330 * day <= g <= 430 * day]
        if gaps and len(yearly) == len(gaps):
            conf = "yearly"
        elif not gaps and 270 * day <= age <= 430 * day and last_amt >= 15:
            conf = "maybe"
        else:
            continue
        step = sorted(yearly)[len(yearly) // 2] if yearly else 365 * day
        nxt = last_p + step
        while nxt < now:
            nxt += step   # roll forward to the NEXT anniversary
        days = round((nxt - now) / day)
        if days > 400:
            continue
        out.append({"name": prettify_merchant(key, key.title()), "key": key,
                    "amount": round(last_amt, 2), "last": last_p, "next": nxt,
                    "days": days, "confidence": conf,
                    "when": datetime.fromtimestamp(nxt).strftime("%b ") + str(datetime.fromtimestamp(nxt).day)})
    out.sort(key=lambda r: (r["days"], r["key"]))
    return out[:limit]


def detect_recurring(txns=None, min_months=3):
    """Merchants charging on a roughly monthly cadence across ALL accounts —
    your real recurring bills/subscriptions whether or not you've tagged them.
    Returns candidates with typical amount, how many months seen, cadence, and
    whether it's already categorized as a subscription."""
    if txns is None:
        txns = _ledger_txns()
    overrides = load_overrides()
    remap = load_catmeta()["remap"]
    by = {}
    for t in txns:
        amt = t.get("amount", 0) or 0
        if amt >= 0:
            continue
        key = _clean(t.get("description", "")) or "unknown"
        it = by.setdefault(key, {"key": key, "name": key.title(), "amounts": [],
                                 "posts": [], "months": set(), "accounts": set(), "descs": []})
        it["amounts"].append(-amt)
        p = t.get("posted") or 0
        it["posts"].append(p)
        if p:
            it["months"].add(datetime.fromtimestamp(p).strftime("%Y-%m"))
        a = t.get("account")
        if a:
            it["accounts"].add(a)
        dsc = (t.get("description") or "").strip()
        if dsc and dsc not in it["descs"] and len(it["descs"]) < 5:
            it["descs"].append(dsc)
    out = []
    now_ts = int(time.time())
    for it in by.values():
        cat = categorize(it["descs"][0] if it["descs"] else it["key"], overrides, remap)
        is_sub = cat == "subscriptions"
        nm = len(it["months"])
        amts = sorted(it["amounts"])
        med = amts[len(amts) // 2]
        if not is_sub:
            # untagged: only surface it if it really looks recurring (cadence + clustered amount)
            if nm < min_months:
                continue
            close = [a for a in amts if abs(a - med) <= max(1.5, 0.30 * med)]
            if len(close) < min_months:
                continue
        # anything YOU tagged a subscription is always included, even with few charges
        posts = sorted(it["posts"])
        gaps = [(posts[i + 1] - posts[i]) / 86400.0 for i in range(len(posts) - 1)]
        avg_gap = round(sum(gaps) / len(gaps)) if gaps else 0
        last = max(it["posts"]) if it["posts"] else 0
        first = min([p for p in it["posts"] if p], default=0)
        # most-recent charge amount (amounts & posts are appended index-aligned)
        recent = it["amounts"][it["posts"].index(last)] if it["posts"] else med
        # flag meaningful changes so they can surface in the Review inbox / Money Map
        flag = None
        if avg_gap and last and (now_ts - last) > 1.8 * avg_gap * 86400 and nm >= 2:
            flag = "dropped"        # was regular, then stopped (well past its usual gap)
        elif abs(recent - med) > max(1.0, 0.10 * med):
            flag = "changed"        # latest charge differs >10% from the usual amount
        elif first and (now_ts - first) < 70 * 86400:
            flag = "new"            # first seen within the last ~10 weeks
        out.append({"key": it["key"],
                    "name": prettify_merchant(it["descs"][0] if it["descs"] else it["key"], it["key"].title()),
                    "amount": round(med, 2),
                    "months": nm, "count": len(it["amounts"]), "avg_gap_days": avg_gap,
                    "last": last, "first": first, "recent": round(recent, 2), "flag": flag,
                    "accounts": sorted(it["accounts"]), "descriptions": it["descs"],
                    "category": cat, "tagged": is_sub})
    out.sort(key=lambda r: (-r["tagged"], -r["months"], -r["amount"]))
    return out


def recurring_transfers(txns=None, min_months=2):
    """Recurring account-to-account moves (category 'transfer') — your real
    transfer habits, per account + direction, with the bank's exact amount.
    Drives the flow widget's bubbles. Pairing across accounts isn't attempted;
    each flow is reported on its own account with a direction (out/in)."""
    if txns is None:
        txns = _ledger_txns()
    overrides = load_overrides()
    remap = load_catmeta()["remap"]
    by = {}
    for t in txns:
        if categorize(t.get("description", ""), overrides, remap) != "transfer":
            continue
        amt = t.get("amount", 0) or 0
        if amt == 0:
            continue
        acct = t.get("account") or "?"
        direction = "out" if amt < 0 else "in"
        key = (acct, direction, round(abs(amt)))  # cluster by account + size
        it = by.setdefault(key, {"account": acct, "dir": direction,
                                 "amount": abs(amt), "months": set(), "count": 0})
        it["count"] += 1
        p = t.get("posted") or 0
        if p:
            it["months"].add(datetime.fromtimestamp(p).strftime("%Y-%m"))
    out = []
    for it in by.values():
        nm = len(it["months"])
        if nm >= min_months:
            out.append({"account": it["account"], "dir": it["dir"],
                        "amount": round(it["amount"], 2), "months": nm, "count": it["count"]})
    out.sort(key=lambda r: -r["amount"])
    return out


# ── Custom stat trackers: count purchases matching a term ──
def match_count(q, window="month"):
    """Count (and total) spending transactions whose description contains q,
    over a window. Drives user-defined 'bank purchase' stat trackers."""
    q = (q or "").strip().lower()
    if not q:
        return {"count": 0, "total": 0.0}
    now = int(time.time())
    if window == "month":
        n = datetime.fromtimestamp(now)
        start = int(datetime(n.year, n.month, 1).timestamp())
    elif window == "30d":
        start = now - 30 * 86400
    elif window == "90d":
        start = now - 90 * 86400
    else:  # all-time
        start = 0
    cnt = 0
    tot = 0.0
    for t in _ledger_txns():
        if (t.get("posted") or 0) < start:
            continue
        amt = t.get("amount", 0) or 0
        if amt >= 0:
            continue  # purchases (money out) only
        if q in (t.get("description") or "").lower():
            cnt += 1
            tot += -amt
    return {"count": cnt, "total": round(tot, 2)}


# ── Review inbox: everything that needs a human decision ──
def find_issues():
    txns = _ledger_txns()
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    remap = load_catmeta()["remap"]
    issues = []

    # untagged income
    untagged = {}
    for t in txns:
        if (t.get("amount") or 0) > 0:
            key, _is, tagged = income_decision(t.get("description", ""), income_overrides, overrides)
            if not tagged:
                untagged[key] = untagged.get(key, 0) + 1
    for k, n in sorted(untagged.items(), key=lambda x: -x[1]):
        issues.append({"type": "income", "key": k, "label": k.title(),
                       "detail": "%d deposit(s) — income or not?" % n})

    # uncategorized spending ('other'), biggest first
    other_m = {}
    for t in txns:
        if (t.get("amount") or 0) < 0 and categorize(t.get("description", ""), overrides, remap) == "other":
            mk = _clean(t.get("description", "")) or "unknown"
            other_m[mk] = other_m.get(mk, 0.0) + (-(t.get("amount") or 0))
    for k, amt in sorted(other_m.items(), key=lambda x: -x[1])[:12]:
        issues.append({"type": "category", "key": k, "label": k.title(),
                       "detail": "uncategorized · $%.0f" % amt})

    # recurring charges: surface untracked ones to add, and a tracked one that seems to have stopped
    subs = load_subs()
    for r in detect_recurring(txns):
        if not r["tagged"]:
            issues.append({"type": "subscription", "key": r["key"], "label": r["name"],
                           "detail": "recurring ~monthly (%d mo · $%.0f) — add as subscription?"
                                     % (r["months"], r["amount"])})
        elif r.get("flag") == "dropped" and not subs.get(r["key"], {}).get("paused"):
            issues.append({"type": "sub_dropped", "key": r["key"], "label": r["name"],
                           "detail": "no charge in a while — dropped? (was every ~%dd)" % (r.get("avg_gap_days") or 30)})

    # possible duplicates: same day + amount + merchant, more than one
    groups = {}
    for t in txns:
        p = t.get("posted") or 0
        ck = (p // 86400, round(t.get("amount", 0), 2), _clean(t.get("description", "")))
        groups.setdefault(ck, []).append(t)
    for ck, ts in groups.items():
        if len(ts) > 1 and ck[1] != 0:
            issues.append({"type": "duplicate", "key": str(ts[0].get("id")),
                           "label": (ts[0].get("description") or "?")[:36],
                           "detail": "%d identical charges same day — real or dupe?" % len(ts),
                           "ids": [t.get("id") for t in ts]})
    return issues


@_locked
def load_deleted():
    """{txn_key: {deleted: 1|0, at: ms, txn: {...}}} — your delete decisions. A record
    with deleted:1 is a TOMBSTONE: no sync, merge, or restore may re-add that
    transaction, so a delete sticks everywhere instead of being resurrected by another
    device that still holds it. The full txn is kept so a delete can be UNDONE.
    deleted:0 is an explicit un-delete (it must outrank an older tombstone on merge,
    which is why the flag lives in the value rather than the key just being absent)."""
    d = _read(DELETED, {})
    return d if isinstance(d, dict) else {}


def is_deleted(key, tomb=None):
    e = (tomb if tomb is not None else load_deleted()).get(key)
    return bool(isinstance(e, dict) and e.get("deleted"))


@_locked
def delete_txn(txn_id):
    """Remove a transaction from the ledger by id (for confirmed duplicates) and leave
    a TOMBSTONE so the delete survives a sync from a device that still has it, and a
    restore from a vault sealed before the delete. Rewrites the .jsonl without that
    line, then rebuilds the 30-day window from the ledger so the deletion actually
    disappears from spending / categories / drill-ins (recompute_spending alone reads
    the stale transactions.json, which still held the deleted row)."""
    led = load_ledger()
    found = txn_id in led
    tomb = load_deleted()
    before = dict(tomb)
    tomb[txn_id] = {"deleted": 1, "at": _now_ms(), "txn": led.get(txn_id) or (tomb.get(txn_id) or {}).get("txn") or {}}
    _write(DELETED, tomb)
    _stamp_map("deleted.json", before, tomb)
    if found:
        del led[txn_id]
        _rewrite_ledger(led)
        rebuild_from_ledger()
    return {"ok": True, "found": found, "count": len(led)}


@_locked
def undelete_txn(txn_id):
    """Undo a delete: flip the tombstone off (deleted:0, freshly stamped so it beats the
    older tombstone on every other device) and put the transaction back in the ledger."""
    tomb = load_deleted()
    e = tomb.get(txn_id)
    if not isinstance(e, dict):
        return {"ok": False, "error": "nothing to undo"}
    before = dict(tomb)
    txn = e.get("txn") or {}
    tomb[txn_id] = {"deleted": 0, "at": _now_ms(), "txn": txn}
    _write(DELETED, tomb)
    _stamp_map("deleted.json", before, tomb)
    if txn:
        merge_ledger([txn])   # tombstone is off now, so it lands
        rebuild_from_ledger()
    return {"ok": True, "restored": bool(txn)}


def deleted_list():
    """The tombstoned transactions, newest first — what the undo UI shows."""
    out = []
    for k, e in load_deleted().items():
        if not (isinstance(e, dict) and e.get("deleted")):
            continue
        t = e.get("txn") or {}
        out.append({"id": k, "at": e.get("at") or 0, "posted": t.get("posted"),
                    "amount": t.get("amount"), "description": t.get("description"),
                    "account": t.get("account")})
    out.sort(key=lambda x: -(x.get("at") or 0))
    return out


# ── Bug log (report → solve → kept in your local archive) ──
def load_bugs():
    b = _read(BUGS, [])
    return b if isinstance(b, list) else []


@_locked
def add_bug(text):
    text = (text or "").strip()
    if not text:
        return load_bugs()
    bugs = load_bugs()
    nid = max([b.get("id", 0) for b in bugs], default=0) + 1
    bugs.append({
        "id": nid, "text": text[:1000], "status": "open",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    _write(BUGS, bugs)
    return bugs


@_locked
def set_bug_status(bug_id, status):
    try:
        bug_id = int(bug_id)
    except (TypeError, ValueError):
        return load_bugs()
    bugs = load_bugs()
    if status == "delete":
        bugs = [b for b in bugs if b.get("id") != bug_id]
    else:
        for b in bugs:
            if b.get("id") == bug_id:
                b["status"] = "solved" if status == "solved" else "open"
                if status == "solved":
                    b["solved"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                else:
                    b.pop("solved", None)
                break
    _write(BUGS, bugs)
    return bugs


@_locked
def recompute_monthly():
    rows = monthly_history()
    _write(MONTHLY, {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "months": rows})
    return rows


@_locked
def rebuild_from_ledger(window_days=30, now=None):
    """Rebuild the summary window (transactions.json) from the full permanent
    ledger, then recompute spending + income. Used after importing statements
    — no bank call. Account balances are left as the last sync set them."""
    now = now or int(time.time())
    led = load_ledger()
    txns = list(led.values()) if isinstance(led, dict) else []
    cutoff = now - window_days * 86400
    window = [t for t in txns if (t.get("posted") or 0) >= cutoff]
    window.sort(key=lambda t: -(t.get("posted") or 0))
    save_transactions(window, window_days)
    recompute_spending()
    recompute_income()
    recompute_coverage()
    return len(window), len(txns)


DOWNLOADS = os.path.join(DATA, "downloads.json")
# Public PostHog project (ingest) key — same one the front-end uses; safe to ship.
_PH_KEY = "phc_ks2GEXApcUXG7tyj9GbBYBTWJDEUKAbz2Gcb3mJCujRp"


def _posthog_capture(event, props):
    """Fire-and-forget a server-side PostHog event (never raises)."""
    import urllib.request
    try:
        body = json.dumps({"api_key": _PH_KEY, "event": event,
                           "distinct_id": "thecache-releases", "properties": props or {}}).encode()
        req = urllib.request.Request("https://us.i.posthog.com/capture/", data=body,
                                     headers={"Content-Type": "application/json", "User-Agent": "thecache"})
        urllib.request.urlopen(req, timeout=6).read()
    except Exception:
        pass


def downloads_snapshot(report=False):
    """Total GitHub Release asset downloads for the repo. Caches the last good count
    locally; when `report` (founder machine) and the total changed, logs it to PostHog
    as `cache_download_total` so downloads are charted over time."""
    import urllib.request
    prev = _read(DOWNLOADS, {}) or {}
    total = None
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/cozykace/thecache/releases?per_page=100",
            headers={"User-Agent": "thecache", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=8) as r:
            rels = json.load(r)
        total = sum(a.get("download_count", 0) for rel in rels for a in rel.get("assets", []))
    except Exception:
        total = None
    if total is None:  # network/API hiccup — serve the last known number
        return {"ok": True, "downloads": prev.get("count", 0), "stale": True}
    if total != prev.get("count"):
        _write(DOWNLOADS, {"count": total, "updated": int(time.time())})
        if report:
            _posthog_capture("cache_download_total", {"count": total})
    return {"ok": True, "downloads": total}


def king_stats():
    """Founder-only deep stats for the King Cozy secret window: the size of the
    build (commits / files / lines) + how much life-data is tracked (ledger /
    accounts / coverage span). Local, read-only, counts-only — never leaves this
    machine (gated behind the .founder secret in server.py)."""
    import subprocess
    def _git(*a):
        try:
            return subprocess.run(["git", *a], cwd=HERE, capture_output=True,
                                  text=True, timeout=5).stdout.strip()
        except Exception:
            return ""
    commits = _git("rev-list", "--count", "HEAD")
    files = [f for f in _git("ls-files").splitlines() if f]
    loc = 0
    for f in ("app.js", "cursor.js", "styles.css", "server.py", "store.py",
              "sync.py", "index.html"):
        p = os.path.join(HERE, f)
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8", errors="ignore") as fh:
                    loc += sum(1 for _ in fh)
            except Exception:
                pass
    led = load_ledger()
    bal = _read(BALANCES, {}) or {}
    cov = _read(os.path.join(DATA, "coverage.json"), {}) or {}
    cov_days = 0
    a, b = cov.get("live_first"), cov.get("live_last")
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b >= a:
        cov_days = int((b - a) // 86400)  # live_first/live_last are epoch seconds
    return {
        "commits": int(commits) if commits.isdigit() else 0,
        "files": len(files),
        "loc": loc,
        "ledger": len(led),
        "accounts": len(bal.get("accounts", [])),
        "coverage_days": cov_days,
        "data_points": cov.get("total", 0),
    }


def api_snapshot():
    """Precompute the read-only GET responses so a browser client with NO backend
    (the hosted web app on a phone) can serve the whole dashboard from the decrypted
    bundle — true zero-knowledge: the desktop computes, the phone only reads.
    Best-effort: any single failure just omits that endpoint."""
    out = {}
    def grab(key, fn):
        try:
            out[key] = fn()
        except Exception:
            pass
    try:
        txns = load_transactions()
    except Exception:
        txns = []
    try:
        ov = load_overrides()
    except Exception:
        ov = {}
    # ONE ledger pass for every view that accepts it (the memo in load_ledger covers the
    # rest) — this bundle used to re-read + re-parse the append-only ledger ~12 times per
    # call, on every push and every changed poll (2026-07-29 cache review)
    try:
        led_txns = _ledger_txns()
    except Exception:
        led_txns = None
    grab("summary", lambda: period_summary())
    grab("categories", lambda: {"categories": category_summary()})
    grab("recurring", lambda: {"recurring": detect_recurring(led_txns)})
    grab("annuals", lambda: {"annuals": annual_predictions(led_txns)})   # phones read the sealed bundle — without this they'd show zero annual warnings
    grab("runway", lambda: runway_payload(led_txns))                     # anchor + every income rhythm (the calendar's income layer), in the bundle's ONE ledger pass
    grab("transfers", lambda: {"transfers": recurring_transfers(led_txns)})
    grab("deposits", lambda: {"deposits": deposit_sources(txns)})
    grab("merchants", lambda: {"merchants": top_merchants(txns, ov)})
    grab("other-merchants", lambda: {"merchants": other_merchants(txns, ov)})
    grab("averages", lambda: averages())
    grab("statistics", lambda: statistics())
    grab("work", lambda: work_summary())
    grab("income-monthly", lambda: monthly_income_by_source())
    grab("work-monthly", lambda: monthly_hours_history())
    grab("integrity", lambda: verify_ledger())
    grab("issues", lambda: {"issues": find_issues()})
    grab("subs", lambda: {"subs": load_subs()})
    grab("income-links", lambda: {"links": load_income_links()})
    grab("bugs", lambda: {"bugs": load_bugs()})
    grab("bucket", lambda: {"ok": True, "items": bucket_get()})   # held thoughts show on the phone, not a fake-empty bucket
    grab("deleted", lambda: {"ok": True, "deleted": deleted_list()})   # the undo list reads on the phone too
    grab("devtree", lambda: dev_tree())
    return out


@_locked
def export_data():
    """Bundle the user's data files (.json/.jsonl) into one object so the client can
    encrypt + download it (E2E backup) OR sync it to the cloud for the web app to read.
    Read-only — touches nothing. Locked (re-entrant) so a concurrent import_data can
    never hand a push a HALF-restored file set. `api` carries the dashboard views."""
    files = {}
    try:
        for name in sorted(os.listdir(DATA)):
            p = os.path.join(DATA, name)
            if not os.path.isfile(p):
                continue
            if not (name.endswith(".json") or name.endswith(".jsonl")):
                continue
            if name.endswith(".bak") or name.startswith("_") or name.startswith("."):
                continue
            try:
                with open(p, encoding="utf-8", errors="ignore") as f:
                    files[name] = f.read()
            except Exception:
                pass
    except Exception:
        pass
    return {"ok": True, "files": files, "filesMeta": load_mapmeta(), "api": api_snapshot(), "exported": int(time.time()), "count": len(files)}


@_locked
def import_data(files, files_meta=None, local=None):
    """Restore data files from a decrypted backup bundle. SNAPSHOTS the current data/
    first (a bad restore is recoverable), then applies each file — a MERGING restore
    for anything append-only or user-edited, a replace for engine snapshots:
      · checkin-log.jsonl → UNION by (at, itemId) — a restore can never destroy
        check-ins answered since the vault's last push
      · ledger.jsonl (+ legacy ledger.json) → UNION, add-only (local row wins on a
        key conflict: on restore the incoming copy is the OLDER one) — a restore
        from an older vault can never shrink the permanent ledger
      · the four MERGE_MAPS (categories/income/subs/income_links) → merge_maps
        newest-per-key using the bundle's files_meta (absent → additive union),
        which also keeps _mapmeta.json truthful
      · everything else (balances, transactions, monthly, …) → atomic replace,
        then a rebuild reconciles those snapshots with the merged ledger
    Path-guarded: plain .json/.jsonl names only, no traversal. `local` (the client's
    localStorage layer) is only written into the snapshot dir so the backup covers it."""
    global _CATMETA_CACHE
    if not isinstance(files, dict) or not files:
        return {"ok": False, "error": "no files in backup"}
    snap = os.path.join(DATA, "_restore_backup_" + time.strftime("%Y%m%d-%H%M%S"))
    try:
        os.makedirs(snap, exist_ok=True)
        for name in os.listdir(DATA):
            p = os.path.join(DATA, name)
            if os.path.isfile(p):
                try:
                    shutil.copy2(p, os.path.join(snap, name))
                except Exception:
                    pass
        if isinstance(local, dict):   # the merged layer is recoverable too, not just files
            try:
                with open(os.path.join(snap, "_localStorage.json"), "w", encoding="utf-8") as f:
                    json.dump(local, f)
            except Exception:
                pass
    except Exception:
        return {"ok": False, "error": "couldn't snapshot current data — aborting restore"}
    written, merged_checkins, merged_ledger, needs_rebuild = [], 0, 0, False
    map_files = {}
    for name, content in files.items():
        if not isinstance(name, str) or not isinstance(content, str):
            continue
        if "/" in name or "\\" in name or name.startswith(".") or name.startswith("_"):
            continue
        if not (name.endswith(".json") or name.endswith(".jsonl")):
            continue
        if name == "checkin-log.jsonl":
            try:
                parsed = []
                for line in content.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(e, dict):
                        parsed.append(e)
                added, _total = _checkin_union(parsed)
                merged_checkins += added
                written.append(name)
            except Exception:
                pass
            continue
        if name in ("ledger.jsonl", "ledger.json"):
            try:
                if name == "ledger.jsonl":
                    incoming = _parse_jsonl_str(content)
                else:   # legacy dict bundle — union its rows, never write the file itself
                    d = json.loads(content)
                    incoming = d if isinstance(d, dict) else {}
                led = load_ledger()
                add = [t for k, t in incoming.items() if k not in led and isinstance(t, dict)]
                if add:
                    merge_ledger(add)   # pure append (only missing keys) — shrink guard trivially holds
                    merged_ledger += len(add)
                    needs_rebuild = True
                written.append(name)
            except Exception:
                pass
            continue
        if name in MERGE_MAPS or name == "catmeta.json":
            map_files[name] = content   # merged after the loop, newest-per-key (never replaced)
            continue
        try:
            tmp = os.path.join(DATA, name + ".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, os.path.join(DATA, name))
            _chmod600(os.path.join(DATA, name))
            written.append(name)
        except Exception:
            pass
    maps_changed = False
    if map_files:
        try:
            mm = merge_maps(map_files, files_meta if isinstance(files_meta, dict) else {})
            maps_changed = bool(mm.get("changed"))
            written.extend(map_files.keys())
        except Exception:
            pass
    _fsync_dir(DATA)
    # reconcile the replaced engine snapshots with the merged ledger/maps
    try:
        if needs_rebuild:
            wd = 30
            try:
                wd = int(_read(TRANSACTIONS, {}).get("window_days") or 30)
            except Exception:
                pass
            rebuild_from_ledger(window_days=wd)
        elif maps_changed:
            recompute_spending()
            recompute_income()
    except Exception:
        pass
    _CATMETA_CACHE = None   # drop the pre-restore category registry so the next
    # edit reloads the restored one instead of writing the old map back over it
    return {"ok": True, "written": len(written), "files": written, "snapshot": os.path.basename(snap),
            "merged": {"checkins": merged_checkins, "ledger": merged_ledger}}


def dev_tree():
    """Build-status map for the Dev Tree widget: BACKLOG progress + a scan of source
    files for unfinished markers, so half-built scaffolding is visible and the worst
    files float to the top. Code only — never touches data."""
    import re
    root = HERE
    rm = {"shipped": 0, "in_progress": 0, "planned": 0, "in_progress_items": [], "planned_items": []}
    bp = os.path.join(root, "BACKLOG.md")
    if os.path.exists(bp):
        try:
            for line in open(bp, encoding="utf-8", errors="ignore"):
                m = re.match(r"^- \[([x~ ])\]\s*(.*)", line)
                if not m:
                    continue
                state, rest = m.group(1), m.group(2)
                tm = re.search(r"\*\*(.+?)\*\*", rest)
                title = (tm.group(1) if tm else rest[:60]).strip()
                if state == "x":
                    rm["shipped"] += 1
                elif state == "~":
                    rm["in_progress"] += 1
                    if len(rm["in_progress_items"]) < 40:
                        rm["in_progress_items"].append(title)
                else:
                    rm["planned"] += 1
                    if len(rm["planned_items"]) < 60:
                        rm["planned_items"].append(title)
        except Exception:
            pass
    ann = re.compile(r"(?:#|//|/\*|<!--)\s*(TODO|FIXME|HACK|XXX|BUG|NEXT)\b", re.I)
    scaf = re.compile(r"coming soon|not built|under construction", re.I)
    bad_kinds = {"FIXME", "HACK", "XXX", "BUG"}
    scan = ["app.js", "cursor.js", "store.py", "server.py", "sync.py", "import_statements.py",
            "toggl_sync.py", "backup.py", "index.html", "styles.css", "build-demo.sh"]
    files = []
    tot_todo = tot_bad = 0
    for name in scan:
        p = os.path.join(root, name)
        if not os.path.isfile(p):
            continue
        markers, ntodo, nbad = [], 0, 0
        try:
            for i, line in enumerate(open(p, encoding="utf-8", errors="ignore"), 1):
                if "re.compile" in line:  # skip this detector's own pattern definitions
                    continue
                a = ann.search(line)
                s = scaf.search(line)
                if not a and not s:
                    continue
                kind = a.group(1).upper() if a else "COMING SOON"
                sev = "bad" if kind in bad_kinds else "todo"
                if sev == "bad":
                    nbad += 1
                else:
                    ntodo += 1
                if len(markers) < 12:
                    markers.append({"sev": sev, "kind": kind, "line": i, "text": line.strip()[:120]})
        except Exception:
            pass
        if ntodo or nbad:
            files.append({"file": name, "todo": ntodo, "bad": nbad, "markers": markers})
            tot_todo += ntodo
            tot_bad += nbad
    files.sort(key=lambda f: (-f["bad"], -f["todo"], f["file"]))
    return {"ok": True, "roadmap": rm, "files": files,
            "totals": {"todo": tot_todo, "bad": tot_bad, "files_flagged": len(files)}}


WEBDAV = os.path.join(HERE, ".webdav")  # gitignored: {url, user, pass} for backup target


def webdav_config_get():
    c = _read(WEBDAV, {}) or {}
    return {"ok": True, "configured": bool(c.get("url")), "url": c.get("url", ""), "user": c.get("user", "")}


def webdav_config_save(url, user, pw):
    url = (url or "").strip()
    if not url:
        try:
            os.remove(WEBDAV)
        except Exception:
            pass
        return {"ok": True, "configured": False}
    _write(WEBDAV, {"url": url, "user": (user or "").strip(), "pass": pw or ""})
    return {"ok": True, "configured": True}


def webdav_push(filename, data):
    """PUT an already-encrypted blob to the configured WebDAV server. The server only
    forwards ciphertext — it never encrypts (E2E happens in the browser)."""
    import urllib.request
    import urllib.error
    import base64
    c = _read(WEBDAV, {}) or {}
    if not c.get("url"):
        return {"ok": False, "error": "WebDAV isn't set up yet"}
    if not isinstance(filename, str) or not filename or "/" in filename or "\\" in filename:
        return {"ok": False, "error": "bad filename"}
    if not isinstance(data, str) or not data:
        return {"ok": False, "error": "nothing to back up"}
    target = c["url"].rstrip("/") + "/" + filename
    req = urllib.request.Request(target, data=data.encode("utf-8"), method="PUT",
                                 headers={"Content-Type": "application/octet-stream", "User-Agent": "thecache"})
    if c.get("user"):
        tok = base64.b64encode((c["user"] + ":" + (c.get("pass") or "")).encode()).decode()
        req.add_header("Authorization", "Basic " + tok)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return {"ok": True, "status": r.status, "file": filename}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": "WebDAV returned " + str(e.code) + " " + str(e.reason)}
    except Exception as e:
        return {"ok": False, "error": "couldn't reach WebDAV: " + str(e)[:140]}
