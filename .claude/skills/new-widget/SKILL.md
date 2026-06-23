---
name: new-widget
description: Scaffold a new widget/component on the Money dashboard. Use when adding any new board widget — gives the brick-by-brick recipe (renderer, library entry, optional backend data, styles, verify). Money project only.
---

# Add a new Money widget

Follow these steps in order. Reuse existing patterns — don't invent new ones. Honor the rules in `money/CLAUDE.md` (privacy, lightweight, beauty, theme-aware colors, Lucide icons, user-is-the-eyes).

## 1. Decide the data source
- Already in `data/balances.json`? Just read it.
- Needs new derived data? Extend `store.py` `build_snapshot()` to emit it under a new key, and add a `recompute_<thing>()` if it'll be user-editable. Keep dollar math server-side.

## 2. Add the renderer (`app.js`, `RENDERERS`)
Each widget type is a function `(el, entry)` that fills `el` and wires data. Mirror an existing one (`income`, `breakdown`, `gap` are good templates).

```js
myWidget(el) {
  el.classList.add("is-breakdown"); // or is-forecast; reuse a layout class
  el.innerHTML =
    '<div class="bd-head">' +
      '<div class="bd-top"><span class="fc-label">my widget</span></div>' +
      '<div class="big bd-avg">…</div>' +
      '<div class="fc-sub bd-sub"></div>' +
    '</div>' +
    '<div class="bd-list"></div>';
  const avg = el.querySelector(".bd-avg");
  function load() {
    fetch("data/balances.json?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then((d) => { /* render from d; use fmtUSD / windowRange / incomeBubbles */ })
      .catch(() => { avg.textContent = "—"; });
  }
  load();
}
```
- Use shared helpers: `fmtUSD`, `fmtUSDk`, `windowRange`, `escapeHtml`, `incomeBubbles`, `springIn`.
- Icons: `<i data-lucide="name"></i>` then `drawIcons()`. Verify the name exists.

## 3. Register it in the library (`app.js`, `LIBRARY`)
Add a catalog entry so it appears in the sidebar Widget Library:
```js
{ type: "myWidget", title: "My Widget", w: 300, h: 240 },
```
`makeWidget` supplies the chrome (magnet/frame/close), drag, resize, and snap automatically.

## 4. If user-editable, add a backend endpoint (`server.py`)
Mirror `/api/categorize` or `/api/income`: parse JSON body, call `store.save_*` + `store.recompute_*`, return the recomputed block. Add a modal in `app.js` mirroring `openIncomeTagger` / `openCategorizer`, and a `bd-fix` button that refreshes the widget `onDone`.

## 5. Style it (`styles.css`)
Reuse existing classes (`.bd-head/.bd-list/.bd-row`, `.is-breakdown`, `.is-forecast`). Theme-aware colors only — `var(--ink)`, `var(--paper)`, `rgba(var(--ink-rgb), a)`, `var(--accent)`. Use `cqmin` units so content scales with widget size.

## 6. Verify, then hand back
- `node --check app.js`
- `python3 -c "import store"` if backend changed; run a logic check that prints **counts/placeholders only** — never real names or amounts.
- If `*.py` changed, tell the user to restart `python3 server.py`. Otherwise just reload the browser.
- You can't see localhost — hand back and ask the user to eyeball it; for risky visuals, preview with the visualize tool first.
