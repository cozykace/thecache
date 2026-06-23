# Money — working conventions

A local, private finance cockpit. Plain HTML/CSS/JS served by a Python stdlib backend. No build step, no framework. Read this before touching the code.

## Hard rules (do not break)

1. **Privacy first.** Real bank data — counterparty names, dollar amounts, account numbers — never goes into committed code, comments, docstrings, test fixtures, or the chat transcript. Use placeholders (`Jane Doe`), counts, initials, or booleans. Everything under `data/` is gitignored and stays on this machine; never commit it.
2. **Lightweight above all.** No build step, no framework, no bundler. Plain `.html`/`.css`/`.js` + Python stdlib. If a change wants a dependency, find another way first. (We deliberately abandoned React/Vite — it overloaded the machine.)
3. **Beauty is non-negotiable.** Apple-clean but a little alien / early-internet. Never trade visual quality for utility.
4. **Brick by brick.** Build on the real working base, one small piece at a time. No big speculative rewrites.

## Architecture

- `index.html` — page shell (sidebar, board, status bar). Loads Lucide, Motion One, `app.js`, `cursor.js` from CDN, all guarded so the app still works if a CDN fails.
- `app.js` — the engine. `RENDERERS` (how each widget type draws), `LIBRARY` (singleton widgets you toggle), drag/resize, magnet snap, theme, modals.
- `styles.css` — all styling. Themed via CSS vars; `[data-theme]` palettes.
- `store.py` — shared data layer: categorize/income logic, `build_snapshot`, atomic writes (`os.replace`), permanent ledger, daily history/backups.
- `sync.py` — SimpleFIN bank pull. `server.py` — serves the dashboard + small JSON write APIs (bound to 127.0.0.1).
- `data/` — local JSON (balances, transactions, categories, income, ledger, history). Gitignored.

## Conventions

- **Icons: use Lucide** (`<i data-lucide="name"></i>` then call `drawIcons()`). Don't hand-draw SVG icons. Verify a name exists before using it.
- **Theme-aware colors only.** Use CSS vars — `var(--ink)`, `var(--paper)`, `rgba(var(--ink-rgb), a)`, `var(--accent)`, `var(--edge-soft)`. Never hardcode black/white (breaks dark mode).
- **Data flow.** Widgets `fetch("data/balances.json")`. Editing data (categories, income) POSTs to a `server.py` endpoint that calls a `recompute_*` and rewrites `balances.json`; the widget re-fetches.
- **Persistence.** UI state → `localStorage` (keys namespaced `money.*`). Layout → `saveLayout()`. Backend writes are atomic.
- **Shared helpers in app.js:** `fmtUSD`, `fmtUSDk`, `windowRange`, `escapeHtml`, `incomeBubbles`, `drawIcons`, `springIn`. Reuse them.

## Data contract

**`data/balances.json`** (the snapshot every widget reads):
- top: `updated`, `total`, `cash`, `burn_per_day`, `spend_window_days`
- `spending`: `{ window_days, total, per_month, per_day, trend_pct, categories:[{key, amount}] }`
- `income`: `{ window_days, total, per_month, sources:[{source, key, amount, tagged}], untagged }`
- `subscriptions`: `{ window_days, total, per_month, items:[{name, key, amount, count, descriptions[], accounts[]}] }`
- `accounts`: `[{id, name, org, balance, currency}]`

**Other data files** (`data/`, all gitignored): `transactions.json` (30d window `{updated, window_days, transactions:[{id, posted, amount, description, account}]}`), `ledger.json` (permanent `{key: txn}`), `monthly.json` (`{updated, months:[{ym, label, income, spending, net, count, live, imported, categories}]}`), `coverage.json` (`{updated, accounts:[{account, count, first, last, live, imported, source}], live_first, live_last, total}`), `categories.json` (`{substring: category}`), `income.json` (`{source_key: "income"|"ignore"}`), `bugs.json` (`[{id, text, status, created, solved?}]`), `history.json`, `synclog.json`.

**API** (`server.py`, 127.0.0.1): GET `/api/ping` `/api/merchants` `/api/other-merchants` `/api/deposits` `/api/bugs`; POST `/api/categorize` `/api/income` `/api/sync` `/api/import` `/api/bug` `/api/bug-status`.

**localStorage registry** (all `money.*`): `layout.v2` (board), `theme`, `bg`, `sidebar`, `sidebarWidth`, `note`, `reserve`, `need`, `core` (category core/flex), `subcore` (per-sub core/flex), `subnames` (sub aliases), `cats` (custom categories), `zoom`, `balExpanded`, `soundtrack`, `clock` (12/24h).

## Workflow

- **I can't see localhost** (sandbox can't reach the user's loopback). The user is the eyes — hand back and ask them to look; for risky visuals, preview with the visualize tool first. Don't ship intricate generative SVG blind.
- **The backend doesn't hot-reload.** After editing `*.py`, the user must restart `python3 server.py`. Static files (`*.js/.css/.html`) just need a browser reload.
- **Verify before handing back:** `node --check app.js`; `python3 -c "import store"` (and run a quick logic check that prints counts/placeholders, never real data).
- Run: `python3 server.py` → open `http://localhost:5173`.
- **Keep `BACKLOG.md` current.** Append any request or idea the user mentions (even in passing) as a `- [ ]` item; check items off `- [x]` with the date when shipped; proactively surface relevant open items. The user relies on this so nothing they ask for gets dropped — don't stop-and-ask one at a time and forget the rest.
- **Keep `FEATURES.md` current.** When a user-facing feature ships, add it in product language (benefit-framed) — it's the launch/marketing list for when Money opens to other people. Both files are surfaced in-app via the Roadmap pill (Roadmap + Features tabs).
