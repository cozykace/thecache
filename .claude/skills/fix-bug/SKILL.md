---
name: fix-bug
description: Diagnose and fix a bug in THE CACHE. Use when the user reports something broken, glitchy, flickering, mis-rendering, off-by-something, or not updating — reproduce, find the ROOT cause, fix it, verify, and log it. THE CACHE project only.
---

# Fix a bug in THE CACHE

Find the root cause, not a symptom patch. Honor `CLAUDE.md` (privacy, lightweight, theme-aware, user-is-the-eyes). You can't see localhost — reason from the code and hand back something the user can verify.

## 1. Pin down the symptom
Get specifics: which widget/element, what exactly happens, when (on toggle? on load? after sync? at a zoom level?), how often (always / sometimes). "Sometimes" usually means a timing/async or layout-shift issue.

## 2. Locate the code
Find the owning piece: a `RENDERERS.<type>` function in `app.js`, a modal opener (`openCategorizer`/`openIncomeTagger`/`openSubDetail`/`openRoadmap`), the status/sources panels, the drag/zoom math, a `store.py` function, or the relevant CSS. Grep by the visible text/class.

## 3. Diagnose — check the usual culprits first
This app has recurring failure modes. Scan for these before anything else:
- **Re-render flicker / layout jump** — innerHTML blanked to a placeholder ("loading…") then refilled; a centered element (`.cat-modal` uses `translate(-50%,-50%)`) collapses and a semi-transparent backdrop reveals content behind. Fix: cache content, don't blank on re-render, give a `min-height`.
- **Stale data after an edit** — Python changes need the user to restart `python3 server.py`; static `.js/.css/.html` only need a reload. A widget showing old data after a tag/category change usually means it didn't re-fetch `balances.json` (wire the modal's `onDone` to the widget's `load`).
- **Icon renders blank** — a `<i data-lucide="...">` was injected without calling `drawIcons()` after, or the icon name doesn't exist in Lucide (verify the name).
- **Drag/resize off at zoom** — coordinate math must divide screen deltas by `boardZoom`; screen→canvas conversions go through `toCanvas()`.
- **Invisible in a theme** — a hardcoded color instead of `var(--ink)`/`var(--paper)`/`rgba(var(--ink-rgb),a)`; black-on-dark or white-on-light. Mental test: would it read if the background were near-black?
- **CSS class collision** — shared classes (`.cf-*`, `.bd-*`, `.cat-*`, `.inc-*`) reused across widgets; a new rule leaked. Scope it.
- **Wrong numbers** — check the income decision precedence and category rules in `store.py`; never trust a single heuristic, and remember the tagger/override is the source of truth.

## 4. Fix at the root
Change the cause, match surrounding style, keep it lightweight (no new deps). Touch the minimum needed.

## 5. Verify
- `node --check app.js` after JS edits; `python3 -c "import store"` after Python edits.
- For logic, run a quick check that prints **counts / placeholders only** — never real names or dollar amounts (data-safety).
- Say clearly whether the user needs to **restart the server** (Python changed) or just **reload** (static only), and name the 1–2 things they should eyeball to confirm.

## 6. Log it
Add a one-line `- [x] Fix: <what> (<date>)` to `BACKLOG.md` under Shipped. Don't add fixes to `FEATURES.md` (that's for capabilities, not repairs).
