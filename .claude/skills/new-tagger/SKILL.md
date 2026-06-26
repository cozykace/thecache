---
name: new-tagger
description: Add a user-editable "tagger" to the dashboard — a way for the user to override/classify some dimension of their data (like categories, income, subscriptions) that persists locally and flows through the whole system. Use when adding any new override/classification the user controls. THE CACHE project only.
---

# Add a tagger

A "tagger" lets the user override an automatic guess and have it stick. We've built this 3× — spending **categories**, **income** (income/ignore), and per-sub **core/flex**. Same five moves every time. Honor `CLAUDE.md` (privacy, lightweight, theme-aware, verify with counts).

## The pattern (copy categories or income)

**1. Override store (`store.py`)**
- Add a file constant: `THING = os.path.join(DATA, "thing.json")` and add it to `_BACKUP_FILES`.
- `load_thing_overrides()` → dict; `save_thing_override(key, value)` → write (value `None`/"auto" clears the tag).

**2. Decision helper (`store.py`)**
- `thing_decision(desc, overrides=None)` → `(key, result, is_tagged)`. **Tag wins**, else fall back to the auto heuristic. Document the precedence in a comment right above it (see `income_decision`).
- A grouping key function if needed (see `_income_key` — strips reference codes so the same source collapses to one key).

**3. Recompute (`store.py`)**
- `recompute_thing()` reads stored transactions + overrides, rebuilds the relevant block, and rewrites `balances.json` (no bank call). Call it from the edit endpoint and from `rebuild_from_ledger`/`run_sync` if it affects history.

**4. Endpoint (`server.py`)**
- `GET /api/things` → list rows (each with current value + `tagged` flag) via a `thing_sources(txns)` helper.
- `POST /api/thing` → `{key, value}` → `save_thing_override` + `recompute_thing` → return the recomputed block.

**5. Modal + surfacing (`app.js`)**
- `openThingTagger(onDone)` mirroring `openIncomeTagger`/`openCategorizer`: fetch `/api/things`, render rows with a toggle/select, POST on change, refresh on close.
- A button to open it (widget `⚙` button or a Menu item). Optionally surface the count of untagged items in the status indicator (`computeActions`) so new data nudges the user.

## Verify
- `./check.sh` (or `node --check app.js`; `python3 -c "import store"`).
- A logic check that prints **counts/placeholders only** — never real names or amounts.
- Tell the user to **restart the server** (Python changed) — `start.command`.
