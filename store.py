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

import os
import re
import json
import time
import shutil
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

# the built-in category keys (mirror of the frontend CAT_META) — so the manager
# can list them even when they currently hold zero transactions
BUILTIN_CATS = ("housing", "bills", "utilities", "groceries", "dining", "transport",
                "shopping", "subscriptions", "health", "entertainment", "music_art",
                "fees", "transfer", "other")
BACKUPS = os.path.join(HERE, "backups")     # local snapshots (gitignored, stays on your Mac)

_BACKUP_FILES = ("balances.json", "transactions.json", "ledger.jsonl", "ledger.json",
                 "history.json", "synclog.json", "categories.json", "income.json",
                 "catmeta.json", "subs.json", "income_links.json",
                 "monthly.json", "coverage.json", "bugs.json")

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


# ── categories ─────────────────────────────────────────────
def load_overrides():
    ov = _read(CATEGORIES, {})
    return ov if isinstance(ov, dict) else {}


def save_override(substring, category):
    ov = load_overrides()
    key = (substring or "").strip().lower()
    if key:
        ov[key] = category
        _write(CATEGORIES, ov)
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


def save_catmeta(m):
    global _CATMETA_CACHE
    _write(CATMETA, m)
    _CATMETA_CACHE = m
    return m


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


def categorize(desc, overrides=None, remap=None):
    d = (desc or "").lower()
    cat = "other"
    matched = False
    if overrides:
        for sub, c in overrides.items():
            words = [w for w in sub.split() if len(w) >= 3]
            if words and all(w in d for w in words):
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


def save_subs(data):
    if isinstance(data, dict):
        _write(SUBS, data)
    return load_subs()


# income source key -> Toggl project name (so hours worked line up with money in)
def load_income_links():
    d = _read(INCOME_LINKS, {})
    return d if isinstance(d, dict) else {}


def save_income_links(data):
    if isinstance(data, dict):
        _write(INCOME_LINKS, data)
    return load_income_links()


def save_income_override(key, status):
    """status: 'income' | 'ignore' to pin it, or 'auto'/None to clear the tag."""
    ov = load_income_overrides()
    k = (key or "").strip().lower()
    if k:
        if status in ("income", "ignore"):
            ov[k] = status
        else:
            ov.pop(k, None)  # back to automatic
        _write(INCOME, ov)
    return ov


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


def build_snapshot(accounts, window_days=30, now=None, fetch_days=None):
    now = now or int(time.time())
    fetch_days = fetch_days or window_days
    overrides = load_overrides()
    income_overrides = load_income_overrides()
    fetch_cutoff = now - fetch_days * 86400      # keep txns this far back
    summary_cutoff = now - window_days * 86400   # but only summarize this window
    mid = now - (window_days // 2) * 86400
    total = cash = outflow = recent = older = 0.0
    income_total = 0.0
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
            if posted < fetch_cutoff:
                continue
            desc = t.get("description") or t.get("payee") or ""
            txns.append({"id": t.get("id"), "posted": posted, "amount": round(amt, 2),
                         "description": desc, "account": a.get("name", "Account")})
            if posted < summary_cutoff:
                continue  # kept in the ledger, but outside the summary window
            if amt < 0:
                spend = -amt
                outflow += spend
                c = categorize(desc, overrides)
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
            "org": (a.get("org") or {}).get("name", ""),
            "balance": round(bal, 2), "currency": a.get("currency", "USD"),
        })

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


def save_balances(snapshot):
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
    os.replace(tmp, LEDGER)
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
        led, lines, bad = _parse_jsonl(LEDGER)
        if led or (lines == 0 and bad == 0):
            return led  # got the good lines (or the file is legitimately empty)
    except Exception:
        pass
    restored = _restore_ledger_from_backup()
    if restored is not None:
        return restored
    raise RuntimeError(
        "ledger.jsonl is unreadable and no good backup was found — refusing to "
        "write so your transaction history is not lost. Restore from backups/ first.")


def merge_ledger(txns):
    """Accumulate transactions permanently, deduped by key. APPEND-ONLY: new or
    changed transactions are appended as lines (O(1), never rewrites history);
    the file is compacted only when superseding updates make it grow stale. A
    shrink guard means a bad read can never replace history with less."""
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
        with open(LEDGER, "a") as f:  # pure append — history is never rewritten
            for ln in new_lines:
                f.write(ln + "\n")
            f.flush()
            os.fsync(f.fileno())  # the append is durably on disk before we report success
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


def recompute_spending():
    """Recompute category totals from stored transactions + overrides, and
    rewrite balances.json. Used after a category edit (no bank call needed)."""
    txns = load_transactions()
    overrides = load_overrides()
    bal = _read(BALANCES, {})
    sp = bal.get("spending", {})
    sp["categories"] = categories_from_txns(txns, overrides)
    bal["spending"] = sp
    subs_items = subscription_items(txns, overrides)
    subs_total = round(sum(s["amount"] for s in subs_items), 2)
    wd = sp.get("window_days") or 30
    bal["subscriptions"] = {"window_days": wd, "total": subs_total,
                            "per_month": round(subs_total / wd * 30, 2), "items": subs_items}
    _write(BALANCES, bal)
    recompute_monthly()
    return sp


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


def monthly_history(limit=24):
    """Bucket the full permanent ledger by calendar month — income, spending
    (transfers excluded), net, and category split. Powers the Months view so
    you can see every backlogged month, not just the last 30 days."""
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
                              "live": 0, "imported": 0}
        m["count"] += 1
        m["imported" if str(t.get("id", "")).startswith("csv:") else "live"] += 1
        amt = t.get("amount", 0) or 0
        desc = t.get("description", "")
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


def delete_txn(txn_id):
    """Remove a transaction from the ledger by id (for confirmed duplicates).
    Rewrites the .jsonl without that line, then refreshes the dashboard."""
    led = load_ledger()
    if txn_id in led:
        del led[txn_id]
        _rewrite_ledger(led)
        recompute_spending()
    return len(led)


# ── Bug log (report → solve → kept in your local archive) ──
def load_bugs():
    b = _read(BUGS, [])
    return b if isinstance(b, list) else []


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


def recompute_monthly():
    rows = monthly_history()
    _write(MONTHLY, {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "months": rows})
    return rows


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
_PH_KEY = "phc_ttvrXfZjNFpSohYHsptHVV86QZXsQDiZJVpnmgMFogAr"


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
