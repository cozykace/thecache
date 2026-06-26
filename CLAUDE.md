# THE CACHE — working conventions

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

## Mobile-friendly (SOP)

The board is desktop-first today (drag / zoom / pan), but build everything new so it survives a phone. Apply by default:

1. **Touch targets ≥ 44×44px.** Buttons, toggles, pips, slider thumbs, close ×. If the glyph must stay small (a 16px ×), pad the *hit area* to ~44px with padding/`::before`, not the glyph.
2. **No hover-only anything.** Controls revealed on `:hover` (sticker magnet/×, row actions) are invisible on touch — mirror every reveal with `@media (hover: none){ … opacity:1 }`. Never put essential info only in a `title=` tooltip.
3. **Fluid, not fixed.** Size with `%`, `fr`, `clamp()`, container units (`cqmin`) — never hardcoded desktop px widths. Every flex child holding text/inputs gets `min-width:0`; lean on the global `box-sizing:border-box`. A widget must never overflow its own box at any size (the body is `overflow:hidden`). Inputs/sliders: `width:100%` + pad chunky controls by their own radius so the thumb can't poke past the edge when the widget shrinks.
4. **Container queries over media queries.** Widgets adapt to their OWN width (`container-type:size` is on `.widget`), so a narrow widget == a narrow phone. **Shrinking a widget is your mobile test** since I can't see the screen.
5. **`touch-action` on gestures.** Draggables/resizers `touch-action:none`; sliders/scroll regions `pan-y`/`manipulation`. We already use Pointer Events — keep it, don't add mouse-only listeners.
6. **Thumb-friendly inputs.** `type="number"` + `inputmode="decimal"` for money, `type="date"` for dates → correct mobile keyboard. Prefer inline editors over `prompt()` for anything new.
7. **Modals → bottom sheets under ~480px.** Fixed desktop popovers (settings, pickers, period/clock menus) become full-width, bottom-anchored, scrollable sheets; always tap-outside + visible-close dismissible.
8. **Readable minimums.** Body/number text ≥ 12–13px; never let an 8–9px label be the only carrier of essential info.
9. **Respect safe areas.** Anything fixed/full-bleed (dock, stats bar, sheets) pads with `env(safe-area-inset-*)` so notches/home bars don't clip it.
10. **Board needs an edit mode (deferred).** Drag-to-move + pinch-zoom fight one-finger scroll on touch. Until there's an explicit arrange toggle (or long-press-to-drag), treat the board as view-mostly on phones — widgets must be useful without rearranging.
11. **Verify at a real width.** Ask the user to check ~375px (iPhone) and at the widget's container breakpoints. Lightweight still rules — no heavy reflow/JS on scroll.

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
- **⚠️ The roadmap is PUBLIC.** `BACKLOG.md` and `FEATURES.md` render live on the public website: `docs/index.html` is published via GitHub Pages (`cozykace/thecache`, source = `main` `/docs`, URL `https://cozykace.github.io/thecache/`) and embedded in the Squarespace site at **thecache.app**. It fetches the raw `.md` files on every load, so anything written there goes live the moment it's pushed. Write backlog/features in language that's safe for anyone to read — no private notes, no real data, no half-baked internal asides.
- **Public demo** (`docs/demo/`, served at `https://cozykace.github.io/thecache/demo/`, embedded in Squarespace via a Code Block). It runs the **real app** — `app.js`/`styles.css`/`cursor.js` are copied in by `build-demo.sh`, and `docs/demo/demo-data.js` (loaded before `app.js`) seeds a curated board + intercepts every `/api/*` and `data/*.json` fetch with **play numbers only**. No backend, no real data ever. **Run `./build-demo.sh` after any `app.js`/`styles.css`/`cursor.js`/logo change so the demo doesn't drift**, then push (`main` → live). If you add/rename a backend endpoint or change an API response shape, update the matching route + fake payload in `demo-data.js` (route order matters — more specific paths first, e.g. `income-links` before `income`). I can't render JS here, so the user eyeballs the live URL and we iterate.
