"""
Money — shared data layer (stdlib only). Used by both sync.py (pull from
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
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
BALANCES = os.path.join(DATA, "balances.json")
TRANSACTIONS = os.path.join(DATA, "transactions.json")
HISTORY = os.path.join(DATA, "history.json")
CATEGORIES = os.path.join(DATA, "categories.json")
SYNCLOG = os.path.join(DATA, "synclog.json")
LEDGER = os.path.join(DATA, "ledger.json")  # permanent, ever-growing transaction store
BACKUPS = os.path.join(HERE, "backups")     # local snapshots (gitignored, stays on your Mac)

_BACKUP_FILES = ("balances.json", "transactions.json", "ledger.json",
                 "history.json", "synclog.json", "categories.json")

# Built-in keyword rules (first match wins). User overrides in categories.json
# are checked first, so anything you teach it takes priority.
CATEGORY_RULES = [
    ("housing", ["rent", "apartment", "property mgmt", "mortgage", "landlord", "leasing"]),
    ("subscriptions", ["spotify", "netflix", "hulu", "adobe", "apple.com", "patreon",
                        "disney", "youtube", "dropbox", "notion", "openai", "anthropic", "claude"]),
    ("bills", ["electric", "water util", "internet", "comcast", "xfinity", "at&t",
               "verizon", "t-mobile", "pg&e", "insurance", "utility"]),
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
                  "online payment", "autopay", "ach ", "bill pay"]),
]


# ── file helpers ───────────────────────────────────────────
def _read(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
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


def _clean(desc):
    """Reduce a raw description to its merchant words (drop ids/noise)."""
    d = re.sub(r"[^a-z& ]", " ", (desc or "").lower())
    for w in ("pos", "debit", "credit", "card", "purchase", "payment", "ach",
              "recurring", "online", "www", "com", "usa", "the"):
        d = re.sub(r"\b" + w + r"\b", " ", d)
    return re.sub(r"\s+", " ", d).strip()


def categorize(desc, overrides=None):
    d = (desc or "").lower()
    if overrides:
        for sub, cat in overrides.items():
            words = [w for w in sub.split() if len(w) >= 3]
            if words and all(w in d for w in words):
                return cat
    for cat, keys in CATEGORY_RULES:
        if any(k in d for k in keys):
            return cat
    return "other"


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


def build_snapshot(accounts, window_days=30, now=None, fetch_days=None):
    now = now or int(time.time())
    fetch_days = fetch_days or window_days
    overrides = load_overrides()
    fetch_cutoff = now - fetch_days * 86400      # keep txns this far back
    summary_cutoff = now - window_days * 86400   # but only summarize this window
    mid = now - (window_days // 2) * 86400
    total = cash = outflow = recent = older = 0.0
    income_total = 0.0
    cats = {}
    inc = {}
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
            elif amt > 0 and categorize(desc, overrides) != "transfer":
                income_total += amt
                ikey = _clean(desc) or "income"
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
        ({"source": k.title(), "key": k, "amount": round(v, 2)} for k, v in inc.items()),
        key=lambda s: -s["amount"],
    )

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


def merge_ledger(txns):
    """Accumulate transactions permanently, deduped by id — nothing is ever
    lost once synced. This is the growing source of truth for history."""
    led = _read(LEDGER, {})
    if not isinstance(led, dict):
        led = {}
    for t in txns:
        key = t.get("id") or (str(t.get("posted")) + "|" + str(t.get("amount")) +
                              "|" + (t.get("description") or "")[:40])
        led[str(key)] = t
    _write(LEDGER, led)
    return len(led)


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
    _write(BALANCES, bal)
    return sp
