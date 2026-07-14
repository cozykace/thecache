# THE CACHE — working conventions

A calm, private **life OS** built for people with executive function challenges (ADHD, autism, TBI). Money is the first mature area, not the product. Plain HTML/CSS/JS served by a Python stdlib backend. No build step, no framework.

**Read `Working Docs/1_PRINCIPLES.md` (the WHY) and `Working Docs/2_STRUCTURE.md` (the WHAT) first — then this doc for code conventions. Then check `Working Docs/Brain Bucket/` — anything in there is what Cozy is actively holding in his head right now; read every file in it and treat the contents as live context for the session.**

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
- top: `updated`, `rev`, `total`, `cash`, `burn_per_day`, `spend_window_days`
- **`updated` vs `rev` — keep these distinct.** `updated` is the BANK-SYNC timestamp (feeds "synced X ago"). `rev` is a counter bumped by EVERY derived-data change — `_next_rev()` in `recompute_spending`/`recompute_income`/`save_balances`, so a categorize, income tag, delete-txn, CSV import, or a tag merged from another device all move it. `period_summary` surfaces both. The client's `dataStamp(d)` = `updated|rev` is what widgets key their side-feed re-pulls on (Money Map, income-forecast history, money-flow transfers) AND what arms the cloud auto-push. **Never bump `updated` on a recompute** — a local tag edit would masquerade as a fresh bank sync.
- `spending`: `{ window_days, total, per_month, per_day, trend_pct, categories:[{key, amount}] }`
- `income`: `{ window_days, total, per_month, sources:[{source, key, amount, tagged}], untagged }`
- `subscriptions`: `{ window_days, total, per_month, items:[{name, key, amount, count, descriptions[], accounts[]}] }`
- `accounts`: `[{id, name, org, balance, currency}]`

**Other data files** (`data/`, all gitignored): `transactions.json` (30d window `{updated, window_days, transactions:[{id, posted, amount, description, account}]}`), `ledger.json` (permanent `{key: txn}`), `monthly.json` (`{updated, months:[{ym, label, income, spending, net, count, live, imported, categories}]}`), `coverage.json` (`{updated, accounts:[{account, count, first, last, live, imported, source}], live_first, live_last, total}`), `categories.json` (`{substring: category}`), `income.json` (`{source_key: "income"|"ignore"}`), `bugs.json` (`[{id, text, status, created, solved?}]`), `history.json`, `synclog.json`, `_mapmeta.json` (per-key edit times `{filename: {key: mtime_ms}}` for the four merge maps — categories/income/subs/income_links; leading `_` keeps it out of the export files bundle, it rides the vault as `filesMeta` and drives `merge_maps`' newest-per-key cross-device merge).

**API** (`server.py`, 127.0.0.1) — GET: `ping` `connect-status` `summary` `categories` `recurring` `transfers` `deposits` `merchants` `other-merchants` `averages` `work` `income-monthly` `work-monthly` `integrity` `issues` `subs` `income-links` `match-count` `bugs` `update-check`. POST: `categorize` `income` `category` `sync` `import` `import-data` `merge-maps` (cross-device newest-per-key merge of the four user-edit maps — categories/income/subs/income_links — via the vault's `filesMeta` sidecar; recomputes if it changed anything) `bug` `bug-status` `subs` `income-links` `delete-txn` `connect` `update` `restart`.

**localStorage registry** (all `money.*`) — keep CURRENT when you add a key:
- *board/layout*: `layout.v2` `zoom` `gutter` `views` `pinned` `sidebar` `sidebarWidth` `icons.collapsed` `dockHidden` `dockOrder` `dockMobile` (per-device "show the dock on this phone" opt-in — excluded from the vault snapshot like cloudKey/deviceId) `statsScroll` (remembered stats-strip swipe position)
- *identity/character*: `profile` `cacheName` `founder` `charLog` `charSince` `customStats` `statsHidden` `statsOrder`
- *look*: `theme` `themeStars` `bg` `font` `menuTier` `privacy`
- *money config*: `reserve` `need` `core` `guaranteedIncome` `rate` `rent` `rentAccount` `period` `mustpayOrder` `planNextOpen` `balExpanded` `balNet`
- *subs/categories*: `subcore` `subnames` `subpaused` `subcadence` `subsMigrated` `cats` `catMgr` `catModal` `flowCards`
- *income forecast*: `forecastSources` `forecastGoal` `forecastMode`
- *misc/ui*: `favorites` `autoPinFavorites` `soundtrack` `clock24` `clockSecs` `dateFmt` `tz` `note` `timer` `skipUpdate` `settings` `connect` `badges` `deckCoach` (one-time deck coaching card seen) `actionTaps` (normalized tap positions on the action button — heat-map raw material, capped 1000)
- *cloud*: `cloud` (account/session state) `cloudKey` (the device's vault data key — never rides in the encrypted bundle; excluded by snapshotLocal/restoreLocal) `cloudPaused` (local-only toggle) `deviceId` (the EXP-ledger slot id — also never rides the bundle) `__lmeta` (per-key merge bookkeeping `{key:{m,h}}` — local-only, excluded from the vault; NEVER rename the double-underscore prefix without updating both runtimes)

**Vault merge classes** (per-key sync — `snapshotLocal`/`mergeRemoteLocal`/`stampGeneric`/`buildLocalMeta` in app.js, mirrored in webcache.js `pullVault`; the two runtimes MUST use the same djb2 + same key lists or phone/desktop fork). Every `money.*` key is exactly one of:
- **INTERNAL** — never rides the vault. Two lists (both excluded): `CLOUD_INTERNAL_KEYS` = `cloud` `cloudKey` `cloudPaused` `deviceId` `__lmeta` (cloud/identity); `DEVICE_LOCAL_KEYS` = `dockMobile` `zoom` `gutter` `sidebar` `sidebarWidth` `statsScroll` `icons.collapsed` `balExpanded` `settings` `connect` `wiki` (device-ergonomic geometry — pinned per device so the phone never snaps to desktop-pixel layout). webcache uses one combined `W_INTERNAL` with the same members.
- **SPECIAL** (`SPECIAL_MERGE_KEYS`, own merge, never plain LWW): `log`/`logPending` (union) · `deck`+`deckRev` (newest rev wins) · `charLog` (union) · `profile` (EXP-ledger aggregate) · `badges` (union ids) · `customStats` (union tapped marks per id) · `charSince` (min = earliest founding date).
- **GENERIC** (everything else — layout, look, config, note, forecast, cats, subnames, `timer`…): per-key newest-wins by an mtime in `__lmeta`. A newly-seen key claims `m:0` (shipping code never wins a merge); a real edit (content hash changed) claims `Date.now()`. The vault blob carries a sibling `localMeta:{genericKey:mtime}` next to the flat `local`; **old vaults lack it → read as all-mtime-0 (migrate-on-read), so the change is backward-compatible**. When you add a `money.*` key, decide its class: an accumulator (never-lose) → SPECIAL with a merger; pure per-device presentation → `DEVICE_LOCAL_KEYS`; otherwise it's GENERIC automatically. (`timer` is deliberately GENERIC not device-local: it mixes synced presets with runtime state — splitting them is a future brick.)

**Systems map** (added since the original CLAUDE.md — where the new stuff lives in `app.js`):
- *Character* — `cacheLevel()`/`renderCharacter()` (sidebar card), `logChar()`/`openCharLog()` (journey arcs `JOURNEY` + skills + activity ledger), `getCacheName()` (founder → "King Cozy Cache").
- *Cache health* — `cacheHealth()`/`renderHealth()`/`openHealth()`; at 100% `_healthFull` → `body.blessed` (gold cursor + `expSpark(...,true)` + `playShing()` from `av assets/shing.wav`); gives +10% EXP in `addExp()`.
- *Trust badge* — `renderTrust()` ← `/api/integrity` ← `store.verify_ledger()` (fsync + integrity checks).
- *Settings tiers* — `menuTier()`/`applyTier()`: `data-tier="N"` hides below tier; `data-menutier` on `<html>` restyles Minimalist(1)/Standard(2)/Legendary(3). (Renamed 2026-07-12; code + CSS + WIKI rename ships as one clean pass — see the rename item in BACKLOG.)
- *Fonts* — `applyFont()`/`FONTS` → `--font-ui` (loads Google font on demand).
- *Founder* — `isFounder()` (name = Cozy K Ace, or `money.founder`), `openKingCozy()` (retro console), `FOUNDER_COMPLIMENTS` vs public `PUBLIC_JOKES`.
- *Favorites* — `favs()`/`toggleFav()`/`autoPinOn()` (star → pin to top of library/dock).

**Where context lives** (so a reset is safe): `Working Docs/Brain Bucket/` = Cozy's actively-held working memory — he hand-drops ANY file he wants every session to hold in its head; read all of it at session start, gitignored, never commit it. When Cozy says **"clean out the brain bucket"**, walk each file with him one at a time — keep (still active) / file it where it belongs / toss — and since the device bridge can't delete, "toss" means move it into `Working Docs/Brain Bucket/_toss/` for him to empty. A monthly scheduled reminder (15th) nudges the cleanout so the bucket stays working memory, never a junk drawer. The five internal planning docs live in `Working Docs/` at the repo root, numerically prefixed by information hierarchy. `Working Docs/1_PRINCIPLES.md` = the WHY (evidence-based design rules for cognitive accessibility). `Working Docs/2_STRUCTURE.md` = the WHAT (12 life areas + 6 shared systems + area contract + main snapshot shape). `Working Docs/3_ROADMAP.md` = the WHEN (written 2026-07-12: the vision chain, the EF-energy north-star metric, Now/Next/Later lanes, decisions log — the check-in reads its NOW lane first). `Working Docs/4_CLOUD-PLAN.md` = cloud architecture specifics that support STRUCTURE. `Working Docs/5_BRAND.md` = private design references. `Working Docs/6_PROJECT-MANAGER.md` = operational standup protocol. At the repo root: `BACKLOG.md` = every ask (shipped `[x]`, in-progress `[~]`, open `[ ]`) + the public roadmap. `FEATURES.md` = shipped product list (currently frames Cache as a money app; scheduled for life-OS rewrite). Agent **memory** holds the earlier north-star: `money-vision` (cache-as-character, Community Cache + wealth-redistribution, King Cozy = primary user), `money-cockpit-project`, `data-safety`, `user-profile` — the life-OS reframe subsumes this.

## Workflow

- **Cache check-in (project manager).** When Cozy says **"cache check-in"**, "standup", "where are we", or "get me back on task" — and when the scheduled `cache-standup` task runs — follow **`Working Docs/6_PROJECT-MANAGER.md`**: a fast status snapshot, the 1-3 next moves, dropped threads, a north-star gut-check, and always **one big baby-step action** to close. It's the antidote to a 150-item backlog. Edit `PROJECT-MANAGER.md` to change how it behaves.
- **I can't see localhost** (sandbox can't reach the user's loopback). The user is the eyes — hand back and ask them to look; for risky visuals, preview with the visualize tool first. Don't ship intricate generative SVG blind.
- **The backend doesn't hot-reload.** After editing `*.py`, the user must restart `python3 server.py`. Static files (`*.js/.css/.html`) just need a browser reload.
- **Verify before handing back:** `node --check app.js`; `python3 -c "import store"` (and run a quick logic check that prints counts/placeholders, never real data).
- Run: `python3 server.py` → open `http://localhost:5173`.
- **Keep `BACKLOG.md` current.** Append any request or idea the user mentions (even in passing) as a `- [ ]` item; check items off `- [x]` with the date when shipped; proactively surface relevant open items. The user relies on this so nothing they ask for gets dropped — don't stop-and-ask one at a time and forget the rest.
- **Keep `FEATURES.md` current.** When a user-facing feature ships, add it in product language (benefit-framed) — it's the launch/marketing list for when Money opens to other people. Both files are surfaced in-app via the Roadmap pill (Roadmap + Features tabs).
- **Commit SUBJECTS are the in-app changelog.** The "Update app" preview (`/api/update-check`) shows each pending commit's subject line to the user before they pull. So write the **first line** of every commit benefit-framed and plain-English ("Forecast: real-effort overlay vs projection", not "fix fn refactor") — it's what a friend reads to decide whether the update is worth it. Keep the noisy details in the body.
- **⚠️ The roadmap is PUBLIC.** `BACKLOG.md` and `FEATURES.md` render live on the public website: `docs/roadmap/index.html`, published via GitHub Pages (`cozykace/thecache`, source = `main` `/docs`, custom domain **https://thecache.app** — DNS at Squarespace points straight at Pages, HTTPS enforced). It fetches the raw `.md` files on every load, so anything written there goes live the moment it's pushed. Write backlog/features in language that's safe for anyone to read — no private notes, no real data, no half-baked internal asides.
- **The site map (2026-07-13):** `https://thecache.app/` = the hosted web app (login gate; built by `build-app.sh` into `docs/` root — run it after any `app.js`/`styles.css`/`cursor.js`/`webcache.js`/`index.html` change) · `/roadmap/` = the public roadmap · `/demo/` = the public demo · `/status/` = the public status page (`docs/status/` — live browser-side health checks + `incidents.json` history; log every user-facing incident there as `{date,title,status:investigating|monitoring|fixed,updates[]}`; the report box POSTs `kind:"outage"` to the feedback collection with a mailto fallback) · `/app/` = a redirect stub to `/` (old links + home-screen icons). Old `cozykace.github.io/thecache/*` URLs redirect to the domain.
- **Public demo** (`docs/demo/`, served at `https://thecache.app/demo/`). It runs the **real app** — `app.js`/`styles.css`/`cursor.js` are copied in by `build-demo.sh`, and `docs/demo/demo-data.js` (loaded before `app.js`) seeds a curated board + intercepts every `/api/*` and `data/*.json` fetch with **play numbers only**. No backend, no real data ever. **Run `./build-demo.sh` after any `app.js`/`styles.css`/`cursor.js`/logo change so the demo doesn't drift**, then push (`main` → live). If you add/rename a backend endpoint or change an API response shape, update the matching route + fake payload in `demo-data.js` (route order matters — more specific paths first, e.g. `income-links` before `income`). I can't render JS here, so the user eyeballs the live URL and we iterate.
