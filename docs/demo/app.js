// ============================================================
//  THE CACHE — widget board + sidebar engine. Plain JS, no build.
//
//  • RENDERERS = how each widget TYPE draws itself
//  • LIBRARY   = single-instance widgets you toggle on/off
//  • ICONS     = icon library (Lucide). DRAG an icon onto the
//               board → drop on a widget to set its icon, or on
//               empty space to leave a free-floating sticker.
//  • layout    = everything on the board + where/size (saved)
// ============================================================

const LAYOUT_KEY = "money.layout.v2";
const SIDEBAR_KEY = "money.sidebar";
const NOTE_KEY = "money.note";
const RESERVE_KEY = "money.reserve";
const MIN_W = 90, MIN_H = 70;
// magnet snap: round a widget's position + size to this grid when its snap is on
const SNAP = 24;
const snapTo = (v) => Math.round(v / SNAP) * SNAP;
// positions land on the grid; snapped SIZES are inset by a fixed gutter so that
// grid-adjacent widgets get a little breathing room instead of touching.
// (The user-facing LESS/MORE spacing slider was removed 2026-07-24 — spacing is
// controlled in the grid for now. 10 is what gutterVal() returned when unset, so
// anyone who never dragged the slider sees no change. money.gutter is dead.)
const gutterVal = () => 10;
const snapSize = (v, min) => Math.max(min || MIN_W, Math.round(v / SNAP) * SNAP - gutterVal());

const fmtUSD = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// soft, pleasing palette assigned per-account
const ACCT_COLORS = ["#c9542e", "#2e7dc9", "#3f8f4e", "#6a4bc4", "#d6920f", "#1fa6a6", "#bf6ba5", "#8a8f2e"];
// Escapes & < > " AND ' — the single quote matters because some attributes are single-quoted
// (e.g. data-ids='…'); without it, a value containing ' could break out of the attribute
// (security eval 2026-07-21, latent-XSS footgun). Keep in lockstep with webcache.js `esc`.
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Spring entrance via Motion One — degrades to nothing if the lib isn't loaded.
function springIn(node) {
  if (!node || !window.Motion || typeof window.Motion.animate !== "function") return;
  try {
    window.Motion.animate(node, { opacity: [0, 1], scale: [0.8, 1] },
      { type: "spring", stiffness: 460, damping: 24 });
  } catch (e) {}
}

// ── Income sources: one identity per source, everywhere ──
// Color is hashed from the source's normalized key, so the SAME
// income source draws the SAME color in every widget it appears in.
const INCOME_PALETTE = ["#3f8f4e", "#2e7dc9", "#6a4bc4", "#d6920f", "#1fa6a6", "#bf6ba5", "#c9542e", "#8a8f2e"];
function incomeColor(key) {
  const s = String(key || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return INCOME_PALETTE[h % INCOME_PALETTE.length];
}
// compact money for tight bubbles: $1.2k · $940
const fmtUSDk = (n) => {
  n = Math.round(n || 0);
  if (n >= 10000) return "$" + Math.round(n / 1000) + "k";
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return "$" + n;
};
// "May 22 – Jun 21": the calendar window of N days ending at the snapshot's updated time
function windowRange(updatedISO, windowDays) {
  const end = updatedISO ? new Date(updatedISO) : new Date();
  if (isNaN(end.getTime())) return "";
  const start = new Date(end);
  start.setDate(start.getDate() - ((Number(windowDays) || 30) - 1));
  const f = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return f(start) + " – " + f(end);
}

// strip bank noise so labels read like a person ("Electronic Deposit Acme Co" → "Acme Co")
function incomeLabel(name) {
  let s = String(name || "").trim();
  s = s.replace(/^(electronic|direct|mobile|ach|online|recurring)?\s*deposit\s*/i, "");
  s = s.replace(/^(zelle|venmo|cash app|paypal)\s*(payment|from|transfer)?\s*:?\s*/i, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || String(name || "income");
}
// Map an income source name → a Lucide icon name (the set already loaded for
// the Icon Library). Add a line here whenever a new kind of income shows up.
function incomeIcon(name) {
  const s = String(name || "").toLowerCase();
  if (/music|guitar|band|gig|royalt|spotify|bandcamp|distrokid|tunecore|ascap|bmi/.test(s))
    return "guitar";
  if (/instacart|doordash|ubereats|uber|lyft|grubhub|shipt|batch|delivery/.test(s))
    return "shopping-cart";
  if (/payroll|paycheck|salary|adp|gusto|wages|employer/.test(s))
    return "briefcase";
  if (/zelle|venmo|cash app|paypal|transfer/.test(s))
    return "hand-coins";
  return "banknote";
}

// Reusable income cluster: a thin mono-line circle holding a Lucide icon,
// with the label + amount beneath. Call drawIcons() after injecting the HTML.
// opts: { compact, min, max, limit }
function incomeBubbles(sources, opts) {
  opts = opts || {};
  const list = (sources || []).filter((s) => (s.amount || 0) > 0).slice(0, opts.limit || 8);
  if (!list.length) return "";
  return '<div class="inc-bubbles' + (opts.compact ? " compact" : "") + '">' +
    list.map((s, i) => {
      const confirmed = !!s.tagged;
      return '<div class="inc-b" title="' + escapeHtml(s.source) + " · " + fmtUSD(s.amount) +
        '" data-key="' + escapeHtml(s.key || "") + '">' +
        '<span class="inc-badge" style="animation-delay:' + (i * 55) + 'ms">' +
          '<i data-lucide="' + incomeIcon(s.source) + '"></i>' +
          '<span class="inc-val">' + fmtUSDk(s.amount) + "</span>" +
          '<span class="inc-status ' + (confirmed ? "is-confirmed" : "is-auto") + '" title="' +
            (confirmed ? "confirmed income" : "auto-detected — click to confirm") + '">' +
            (confirmed ? '<i data-lucide="check"></i>' : "") + "</span>" +
        "</span>" +
        '<span class="inc-lab">' + escapeHtml(incomeLabel(s.source)) + "</span>" +
      "</div>";
    }).join("") +
  "</div>";
}
// Clamp each source caption to its own badge's width so it never sprawls
// wider than the pill. offsetWidth ignores the entrance scale() animation.
function fitIncomeLabels(scope) {
  (scope || document).querySelectorAll(".inc-b").forEach((b) => {
    const badge = b.querySelector(".inc-badge");
    const lab = b.querySelector(".inc-lab");
    if (badge && lab) lab.style.maxWidth = badge.offsetWidth + "px";
  });
}

// spending category labels + colors
const CAT_META = {
  housing: { label: "Housing", color: "#c9542e" },
  groceries: { label: "Groceries", color: "#3f8f4e" },
  dining: { label: "Dining", color: "#d6920f" },
  transport: { label: "Transport", color: "#2e7dc9" },
  shopping: { label: "Shopping", color: "#bf6ba5" },
  subscriptions: { label: "Subscriptions", color: "#6a4bc4" },
  utilities: { label: "Utilities", color: "#1f9ad6" },
  bills: { label: "Bills", color: "#1fa6a6" },
  health: { label: "Health", color: "#4ec9a5" },
  entertainment: { label: "Fun", color: "#e0734a" },
  music_art: { label: "Music & Art", color: "#bf2e86" },
  fees: { label: "Fees", color: "#9a5b3a" },
  transfer: { label: "Transfers", color: "#8a8f73" },
  other: { label: "Other", color: "#8c8470" },
};

// ── Custom categories (add your own from the UI; they stick) ──
// Definitions live here; assignments (merchant → category) persist server-side
// via /api/categorize, so a custom category flows through the whole system.
const CATS_KEY = "money.cats";
const CAT_PALETTE = ["#7a9e3a", "#3aa0a0", "#c0518f", "#5a6acc", "#cf7a2a",
                     "#9a55c4", "#3f8f4e", "#c9542e", "#2e7dc9", "#d6920f"];
function customCats() {
  try { return JSON.parse(localStorage.getItem(CATS_KEY) || "{}"); } catch (e) { return {}; }
}
let CAT_LABELS = {};  // server-renamed labels, refreshed from the Store so renames ripple everywhere
function catMeta(key) {
  const base = CAT_META[key] || customCats()[key] ||
    { label: key ? key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Other", color: "#8c8470" };
  if (CAT_LABELS[key]) return { label: CAT_LABELS[key], color: base.color };
  return base;
}
function allCatKeys() {
  return Object.keys(CAT_META).concat(Object.keys(customCats()).filter((k) => !CAT_META[k]));
}
function catSlug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function addCustomCat(label) {
  const key = catSlug(label);
  if (!key || CAT_META[key]) return key || null;
  const cats = customCats();
  if (!cats[key]) {
    cats[key] = { label: String(label).trim(), color: CAT_PALETTE[Object.keys(cats).length % CAT_PALETTE.length] };
    localStorage.setItem(CATS_KEY, JSON.stringify(cats));
  }
  return key;
}

// ── Core (non-negotiable) vs flexible (cuttable) spending ──
const CORE_KEY = "money.core";
const CORE_DEFAULT = {
  housing: 1, bills: 1, utilities: 1, groceries: 1, health: 1, transport: 1, fees: 1,
  dining: 0, shopping: 0, entertainment: 0, music_art: 0, subscriptions: 0, other: 0,
};
function coreMap() {
  let ov = {};
  try { ov = JSON.parse(localStorage.getItem(CORE_KEY) || "{}"); } catch (e) {}
  return Object.assign({}, CORE_DEFAULT, ov);
}
function isCore(key) { return key !== "transfer" && coreMap()[key] === 1; }
function setCore(key, val) {
  let ov = {};
  try { ov = JSON.parse(localStorage.getItem(CORE_KEY) || "{}"); } catch (e) {}
  ov[key] = val ? 1 : 0;
  localStorage.setItem(CORE_KEY, JSON.stringify(ov));
}
function coreMonthly(d) {
  const sp = d && d.spending;
  if (!sp || !sp.categories) return 0;
  const w = sp.window_days || 30;
  return sp.categories.filter((c) => isCore(c.key)).reduce((s, c) => s + c.amount / w * 30, 0);
}
// the gap's "need" = your manual override, else your core spend, else total spend
// subscriptions you marked core feed into need, unless the whole subs category is already core
function coreSubsMonthly(d) {
  if (isCore("subscriptions")) return 0;
  const subs = d && d.subscriptions;
  if (!subs || !subs.items) return 0;
  const w = subs.window_days || 30;
  return subs.items.filter((s) => isSubCore(s.key)).reduce((sum, s) => sum + s.amount / w * 30, 0);
}
function monthlyNeed(d) {
  const s = localStorage.getItem("money.need");
  if (s !== null) return parseFloat(s) || 0;
  const cm = coreMonthly(d) + coreSubsMonthly(d);
  const tot = d && d.spending ? d.spending.per_month : 0;
  return Math.round(cm > 0 ? cm : tot);
}

// ── The "decisions ledger" for recurring money ─────────────────────────────
// Your calls about each recurring merchant — must-pay? cadence? paused? renamed?
// — persisted to data/subs.json so they survive a browser wipe and ride along in
// your backups, exactly like the category/income tags. NOT the transaction ledger;
// this is just your labels. The browser holds the in-session copy; every change
// writes the whole map back to the server.
let SUBS = {};  // { merchantKey: { mustpay, cadence, paused, name } }
let _subsSaveTimer = null;
let _subsLoaded = false;  // the server's map has actually been seen — POSTing before then could wipe it
let _subsDirty = false;   // an edit is awaiting persistence (retries on next edit / backend recovery)
function subEntry(key) { return SUBS[key] || {}; }
function saveSubs() {
  _subsDirty = true;
  clearTimeout(_subsSaveTimer);
  _subsSaveTimer = setTimeout(pushSubs, 350);
}
// The guarded persist: saveSubs POSTs the WHOLE map, so it must never fire from a
// copy that missed the server's data (backend was starting when the page loaded) —
// that would wipe every stored decision with a ✓ on screen. Pull-and-merge first.
function pushSubs() {
  clearTimeout(_subsSaveTimer); _subsSaveTimer = null;
  const post = () => fetch("/api/subs", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subs: SUBS }) })
    .then((r) => { if (!r.ok) throw new Error("save failed"); return r.json(); })
    .then((d) => {
      if (d && d.ok === false) { flash(d.error || "read-only here — edit on the desktop app"); return; }   // hosted web mirror answers 200 {ok:false}
      if (!_subsSaveTimer) _subsDirty = false;   // a timer at resolve time = a NEWER edit queued mid-flight — keep it dirty so recovery retries it
      autoPushSoon();
    })
    .catch(() => { flash("couldn't save — backend down? click the server light"); });
  if (_subsLoaded) return post();
  // never saw the server's map — pull it and merge (local edits win per-key) so we can't clobber
  return fetch("/api/subs?t=" + Date.now())
    .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
    .then((d) => { SUBS = Object.assign({}, (d && d.subs) || {}, SUBS); _subsLoaded = true; })
    .then(post)
    .catch(() => { flash("couldn't save — backend down? click the server light"); });
}
// a toggle followed by an immediate tab close must still land — flush the debounce.
// fetch+keepalive (not sendBeacon: the web/demo runtimes intercept fetch only).
window.addEventListener("pagehide", () => {
  if (!_subsSaveTimer || !_subsLoaded) return;   // nothing pending, or map never loaded (a blind flush would clobber)
  clearTimeout(_subsSaveTimer); _subsSaveTimer = null;
  try {
    fetch("/api/subs", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subs: SUBS }) }).catch(() => {});
  } catch (e) {}
});
function setSubField(key, field, value) {
  const e = SUBS[key] || (SUBS[key] = {});
  const isDefault = value === false || value == null || value === "" || (field === "cadence" && value === "monthly");
  if (isDefault) delete e[field]; else e[field] = value;
  if (!Object.keys(e).length) delete SUBS[key];  // keep the file tidy — no empty entries
  saveSubs();
}
function loadSubs() {
  return fetch("/api/subs?t=" + Date.now())
    .then((r) => { if (!r.ok) throw new Error("subs load failed"); return r.json(); })  // a 500 is a FAILURE, not an empty map
    .then((d) => {
      SUBS = Object.assign({}, (d && d.subs) || {}, SUBS);   // edits made before the load finished win
      _subsLoaded = true;
      if (!Object.keys(SUBS).length && localStorage.getItem("money.subsMigrated") !== "1") migrateLocalSubs();
      localStorage.setItem("money.subsMigrated", "1");
      if (_subsDirty) pushSubs();   // an edit queued while the backend was down — persist it now
    })
    .catch(() => {});   // keep resolving: boot chains Store.refresh() off this
}
// one-time lift of the old browser-only flags into the durable file
function migrateLocalSubs() {
  const parse = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } };
  const core = parse("money.subcore"), cad = parse("money.subcadence"),
        paused = parse("money.subpaused"), names = parse("money.subnames");
  const keys = new Set([].concat(Object.keys(core), Object.keys(cad), Object.keys(paused), Object.keys(names)));
  if (!keys.size) return;
  keys.forEach((k) => {
    const e = {};
    if (core[k] === 1) e.mustpay = true;
    if (cad[k] && cad[k] !== "monthly") e.cadence = cad[k];
    if (paused[k] === 1) e.paused = true;
    if (names[k]) e.name = names[k];
    if (Object.keys(e).length) SUBS[k] = e;
  });
  saveSubs();
}
// must-pay — which recurring charges are non-negotiable (funds the Budget first)
function isSubCore(key) { return !!subEntry(key).mustpay; }
function setSubCore(key, val) { setSubField(key, "mustpay", !!val); }
// manual "paused" flag — you marking a charge inactive so the data stays honest
function isSubPaused(key) { return !!subEntry(key).paused; }
function setSubPaused(key, val) { setSubField(key, "paused", !!val); }
// per-charge CADENCE — not everything is monthly. We store the period and
// normalize every "monthly" use to the monthly-equivalent (sinking-fund: a
// $139/yr bill counts as ~$11.58/mo so the annual hit never surprises you).
const CADENCES = [
  { id: "weekly", label: "weekly", perYear: 52, abbr: "wk" },
  { id: "biweekly", label: "every 2 weeks", perYear: 26, abbr: "2wk" },
  { id: "monthly", label: "monthly", perYear: 12, abbr: "mo" },
  { id: "quarterly", label: "quarterly", perYear: 4, abbr: "qtr" },
  { id: "yearly", label: "yearly", perYear: 1, abbr: "yr" },
];
function subCadence(key) { return subEntry(key).cadence || "monthly"; }
function setSubCadence(key, val) { setSubField(key, "cadence", val); }
function cadenceInfo(id) { return CADENCES.find((c) => c.id === id) || CADENCES[2]; }
function cadenceAbbr(key) { return cadenceInfo(subCadence(key)).abbr; }
// the per-charge amount r.amount converted to a monthly-equivalent for budgets/totals
function monthlyAmount(r) { return (r.amount || 0) * cadenceInfo(subCadence(r.key)).perYear / 12; }
// active = charged within ~40 days, but non-monthly cadences get a longer window
function subState(r) {
  if (isSubPaused(r.key)) return "paused";
  if (!r.last) return "lapsed";
  const days = (Date.now() / 1000 - r.last) / 86400;
  const cad = subCadence(r.key);
  const window = cad === "yearly" ? 400 : cad === "quarterly" ? 130 : 40;  // a yearly bill isn't "lapsed" at 41 days
  return days > window ? "lapsed" : "active";
}
// pin-to-top — a local display preference, namespaced (proj / sub) so they don't collide
const PIN_KEY = "money.pinned";
function pinnedMap() { try { return JSON.parse(localStorage.getItem(PIN_KEY) || "{}"); } catch (e) { return {}; } }
function isPinned(ns, key) { return !!((pinnedMap()[ns] || {})[key]); }
function togglePin(ns, key) {
  const m = pinnedMap();
  const s = m[ns] || (m[ns] = {});
  if (s[key]) delete s[key]; else s[key] = 1;
  localStorage.setItem(PIN_KEY, JSON.stringify(m));
}
// sort: pinned first (keeping the incoming order within each group)
function pinSort(arr, ns, keyOf) {
  return arr.slice().sort((a, b) => (isPinned(ns, keyOf(b)) ? 1 : 0) - (isPinned(ns, keyOf(a)) ? 1 : 0));
}
// per-subscription display alias — a label only; never changes what data it's tied to
function subName(item) {
  if (!item) return "";
  return subEntry(item.key).name || item.name || "";
}
function setSubName(key, alias) { setSubField(key, "name", (alias || "").trim()); }

// Typical gig busy windows (general demand patterns, not your market).
const GIG_WINDOWS = [
  { days: [0], sh: 11, eh: 16, label: "Sunday rush" },
  { days: [6], sh: 10, eh: 15, label: "Saturday rush" },
  { days: [5], sh: 16, eh: 20, label: "Friday dinner" },
  { days: [1, 2, 3, 4], sh: 16, eh: 19, label: "dinner rush" },
];
function nextBusyWindow() {
  const now = new Date();
  let best = null;
  for (let i = 0; i < 8; i++) {
    const day = new Date(now); day.setDate(now.getDate() + i);
    GIG_WINDOWS.forEach((w) => {
      if (!w.days.includes(day.getDay())) return;
      const start = new Date(day); start.setHours(w.sh, 0, 0, 0);
      const end = new Date(day); end.setHours(w.eh, 0, 0, 0);
      if (end <= now) return;
      const active = now >= start && now < end;
      const key = active ? now.getTime() : start.getTime();
      if (!best || key < best.key) best = { key, start, end, label: w.label, active };
    });
  }
  return best;
}
function hhmm(d) { let h = d.getHours(); const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12; return h + ap; }
function fmtBusy(b) {
  if (!b) return "—";
  if (b.active) return "go now → " + b.label + " til " + hhmm(b.end);
  return b.start.toLocaleDateString("en-US", { weekday: "short" }) + " " +
    hhmm(b.start) + "–" + hhmm(b.end) + " · " + b.label;
}
const DRAG_IGNORE = ".widget-close,.widget-color,.widget-magnet,.widget-help,.sticker-close,.sticker-magnet,.widget-resize,.sticker-resize";
// Per-widget color (start of per-widget style). Picking one overrides --accent on
// just that widget (so its numbers/highlights recolor); "Default" clears it.
const WIDGET_COLORS = [
  { name: "Default", v: "" },
  { name: "Coral", v: "#e0653f" }, { name: "Amber", v: "#d99a2b" },
  { name: "Green", v: "#3f8f4e" }, { name: "Teal", v: "#2a9d8f" },
  { name: "Blue", v: "#4a78c4" }, { name: "Violet", v: "#7d6cf0" },
  { name: "Pink", v: "#d4537e" },
];
function closeWidgetColor() {
  ["wcolorPop", "wcolorBack"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
}
function openWidgetColor(btn, entry, node) {
  closeWidgetColor();
  const back = document.createElement("div"); back.className = "wcolor-back"; back.id = "wcolorBack";
  back.addEventListener("pointerdown", closeWidgetColor);
  const pop = document.createElement("div"); pop.className = "wcolor-pop"; pop.id = "wcolorPop";
  const cur = entry.color || "";
  pop.innerHTML = WIDGET_COLORS.map((c) =>
    '<button class="wc-sw' + (cur === c.v ? " on" : "") + '" data-c="' + c.v + '" title="' + c.name + '"' +
    (c.v ? ' style="background:' + c.v + '"' : "") + ">" + (c.v ? "" : "✕") + "</button>").join("");
  document.body.appendChild(back); document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + "px";
  pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + "px";
  pop.querySelectorAll(".wc-sw").forEach((sw) => sw.addEventListener("click", () => {
    const v = sw.dataset.c;
    if (v) { entry.color = v; node.style.setProperty("--accent", v); }
    else { delete entry.color; node.style.removeProperty("--accent"); }
    saveLayout(); closeWidgetColor();
  }));
}
// On a phone the board becomes a vertical stack — drag/resize/pan are disabled so
// one finger scrolls instead of grabbing widgets. Matches the CSS breakpoint.
const isMobile = () => window.matchMedia("(max-width: 640px)").matches;

// ── How each widget type renders ───────────────────────────
// classify an account by its name so we can split cash into checking / savings
function acctType(name) {
  const n = (name || "").toLowerCase();
  if (/saving/.test(n)) return "savings";
  if (/check|chk|chking|debit/.test(n)) return "checking";
  if (/credit|card|visa|master|amex|venture|quicksilver|rei|loan/.test(n)) return "credit";
  return "other";
}

const RENDERERS = {
  balance(el) {
    el.classList.add("is-balance");
    el.innerHTML =
      '<button class="bal-skull" aria-label="Show accounts"><i data-lucide="skull"></i></button>' +
      '<div class="bal-head">' +
        '<div class="bal-total-label">total cash</div>' +
        '<div class="big">…</div>' +
      '</div>' +
      '<div class="bal-split">' +
        '<div class="bal-line"><span class="bal-line-label">checking</span><span class="bal-line-amt bal-checking">…</span></div>' +
        '<div class="bal-line"><span class="bal-line-label">savings</span><span class="bal-line-amt bal-savings">…</span></div>' +
        '<div class="bal-line bal-cards-line"><span class="bal-line-label">card debt</span><span class="bal-line-amt bal-cards">…</span></div>' +
      '</div>' +
      '<button class="bal-net-toggle" type="button">include card debt</button>' +
      '<div class="sub">syncing…</div>' +
      '<div class="bal-accounts"><div class="bal-accounts-inner"></div></div>';
    drawIcons();
    const head = el.querySelector(".bal-head");
    const big = el.querySelector(".big");
    const sub = el.querySelector(".sub");
    const labelEl = el.querySelector(".bal-total-label");
    const chkEl = el.querySelector(".bal-checking");
    const savEl = el.querySelector(".bal-savings");
    const cardsEl = el.querySelector(".bal-cards");
    const netBtn = el.querySelector(".bal-net-toggle");
    const list = el.querySelector(".bal-accounts-inner");
    const BAL_EXP_KEY = "money.balExpanded";
    const NET_KEY = "money.balNet";  // off by default → headline is cash only
    if (localStorage.getItem(BAL_EXP_KEY) === "1") el.classList.add("expanded");
    const toggle = () => {
      localStorage.setItem(BAL_EXP_KEY, el.classList.toggle("expanded") ? "1" : "0");
    };
    head.addEventListener("click", toggle);
    el.querySelector(".bal-skull").addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    netBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(NET_KEY, localStorage.getItem(NET_KEY) === "1" ? "0" : "1");
      Store.emit();  // re-render from cached data with the new toggle state
    });

    // point-in-time: the live snapshot total, split into checking / savings cash
    Store.subscribe(el, (d) => {
      const accts = d.accounts || [];
      const showNet = localStorage.getItem(NET_KEY) === "1";
      let chk = 0, sav = 0, cash = 0, credit = 0;
      accts.forEach((a) => {
        const b = a.balance || 0;
        const t = acctType(a.name);
        if (t === "checking") chk += b;
        else if (t === "savings") sav += b;
        if (t === "credit") credit += b;          // negative = debt owed
        else if (b > 0) cash += b;                // liquid cash only
      });
      el.classList.toggle("show-net", showNet);
      labelEl.textContent = showNet ? "net (cash − cards)" : "total cash";
      big.textContent = fmtUSD(showNet ? cash + credit : cash);
      chkEl.textContent = fmtUSD(chk);
      savEl.textContent = fmtUSD(sav);
      cardsEl.textContent = fmtUSD(credit);
      netBtn.textContent = showNet ? "✓ card debt included" : "include card debt";
      netBtn.classList.toggle("on", showNet);
      const when = d.updated ? new Date(d.updated) : null;
      sub.textContent = when
        ? "as of " + when.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
          " " + when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "no bank connected yet — that can wait";
      list.innerHTML = accts
        .map((a, i) =>
          '<div class="acct" style="--i:' + i + '">' +
            '<span class="acct-dot" style="background:' + ACCT_COLORS[i % ACCT_COLORS.length] + '"></span>' +
            '<span class="acct-name">' + escapeHtml(a.name || "Account") + '</span>' +
            '<span class="acct-bal">' + fmtUSD(a.balance || 0) + '</span>' +
          '</div>'
        )
        .join("");
    });
  },
  accountflow(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head"><div class="bd-top"><span class="fc-label">money flow</span>' +
        '<button class="af-cards-toggle" type="button">hide cards</button></div></div>' +
      '<div class="af-wrap"><svg class="af-links" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"></svg>' +
        '<div class="af-flow"></div></div>';
    const wrap = el.querySelector(".af-wrap");
    const flow = el.querySelector(".af-flow");
    const svg = el.querySelector(".af-links");
    const cardsBtn = el.querySelector(".af-cards-toggle");
    let transfers = [], lastTypes = null, transfersSeen = null;
    let showCards = localStorage.getItem("money.flowCards") !== "0";  // default: show cards
    const paintCardsBtn = () => { cardsBtn.textContent = showCards ? "hide cards" : "show cards"; cardsBtn.classList.toggle("on", !showCards); };
    cardsBtn.addEventListener("click", () => {
      showCards = !showCards; localStorage.setItem("money.flowCards", showCards ? "1" : "0");
      paintCardsBtn(); if (Store.data) render(Store.data);
    });
    paintCardsBtn();

    const nodeHtml = (a, kind) =>
      '<div class="af-node af-' + kind + '" data-acct="' + escapeHtml(a.name) + '">' +
        '<span class="af-node-type">' + kind + "</span>" +
        '<span class="af-node-name">' + escapeHtml(shortAcct(a.name)) + "</span>" +
        '<span class="af-node-bal">' + fmtUSD(a.balance || 0) + "</span></div>";
    const tier = (arr, kind) => arr.length ? '<div class="af-tier">' + arr.map((a) => nodeHtml(a, kind)).join("") + "</div>" : "";

    function render(d) {
      const accts = (d && d.accounts) || [];
      const byType = { checking: [], savings: [], credit: [], other: [] };
      accts.forEach((a) => { (byType[acctType(a.name)] || byType.other).push(a); });
      lastTypes = byType;
      let html = '<div class="af-tier"><div class="af-port af-in">money in</div></div>';
      html += tier(byType.checking, "checking");
      html += tier(byType.savings, "savings");
      html += tier(byType.other, "other");
      if (showCards) html += tier(byType.credit, "credit");
      html += '<div class="af-tier"><div class="af-port af-out">money out</div></div>';
      flow.innerHTML = html;
      requestAnimationFrame(() => redraw(d));
    }
    function redraw(d) {
      if (!wrap.isConnected) return;
      const wr = wrap.getBoundingClientRect();
      if (!wr.width) return;
      const z = boardZoom || 1;  // the board is zoom-scaled; work in unscaled px so the SVG overlay lines up
      const W = wr.width / z, H = wr.height / z;
      const m = (node) => { const r = node.getBoundingClientRect(); return { el: node, cx: (r.left - wr.left + r.width / 2) / z, top: (r.top - wr.top) / z, bottom: (r.bottom - wr.top) / z }; };
      const q = (sel) => [...wrap.querySelectorAll(sel)].map(m);
      const inEl = wrap.querySelector(".af-in") && m(wrap.querySelector(".af-in"));
      const outEl = wrap.querySelector(".af-out") && m(wrap.querySelector(".af-out"));
      const chk = q(".af-checking"), sav = q(".af-savings"), oth = q(".af-other"), crd = showCards ? q(".af-credit") : [];
      const sources = chk.length ? chk : sav.concat(oth);
      const incomeLbl = d && d.income && d.income.per_month ? "+" + fmtUSD(d.income.per_month) : null;
      const spendLbl = d && d.spending && d.spending.per_month ? "−" + fmtUSD(d.spending.per_month) : null;
      const transferBubble = (s, t) => {
        const sa = s.el.dataset.acct, ta = t.el.dataset.acct;
        const f = transfers.find((x) => (x.account === sa && x.dir === "out") || (x.account === ta && x.dir === "in"));
        return f ? "⇄ " + fmtUSD(f.amount) : null;
      };
      const paths = [], bubbles = [];
      const addEdge = (s, t, bubble) => {
        if (!s || !t) return;
        const my = (s.bottom + t.top) / 2;
        paths.push("M " + s.cx + " " + s.bottom + " C " + s.cx + " " + my + ", " + t.cx + " " + my + ", " + t.cx + " " + t.top);
        if (bubble) bubbles.push({ x: (s.cx + t.cx) / 2, y: my, text: bubble });
      };
      (chk.length ? chk : sources).forEach((c, i) => addEdge(inEl, c, i === 0 ? incomeLbl : null));
      sources.forEach((s) => {
        sav.forEach((sv) => addEdge(s, sv, transferBubble(s, sv)));
        oth.forEach((o) => addEdge(s, o, null));
        crd.forEach((cr) => addEdge(s, cr, transferBubble(s, cr)));
      });
      sources.forEach((s, i) => addEdge(s, outEl, i === 0 ? spendLbl : null));
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.style.width = W + "px"; svg.style.height = H + "px";
      svg.innerHTML = paths.map((p) => '<path d="' + p + '" class="af-link" />').join("");
      wrap.querySelectorAll(".af-bubble").forEach((b) => b.remove());
      bubbles.forEach((b) => {
        const n = document.createElement("div");
        n.className = "af-bubble"; n.textContent = b.text;
        n.style.left = b.x + "px"; n.style.top = b.y + "px";
        wrap.appendChild(n);
      });
    }
    // transfers re-pull whenever server data moves (CSV import, delete-txn, categorize,
    // bank sync) — keyed on the snapshot stamp so local ripples stay fetch-free; a
    // failed fetch resets the marker so the next ripple retries instead of leaving the
    // bubbles absent forever
    function fetchTransfers() {
      fetch("/api/transfers?t=" + Date.now()).then((r) => r.json())
        .then((t) => { transfers = t.transfers || []; if (Store.data) render(Store.data); })
        .catch(() => { transfersSeen = null; });
    }
    Store.subscribe(el, (d) => {
      const s = dataStamp(d);
      if (d && s !== transfersSeen) { transfersSeen = s; fetchTransfers(); }
      render(d);
    });
    if (window.ResizeObserver) new ResizeObserver(() => { if (Store.data) requestAnimationFrame(() => redraw(Store.data)); }).observe(el);
  },
  incomeforecast(el) {
    el.classList.add("is-breakdown", "is-forecast");
    el.innerHTML =
      '<div class="bd-head"><div class="bd-top"><span class="fc-label">income forecast</span>' +
        '<span class="if-modeseg"><button class="if-modeopt" type="button" data-mode="streams">streams</button>' +
          '<button class="if-modeopt" type="button" data-mode="cushion">cushion</button></span>' +
        '<button class="if-goal" type="button" title="set a savings goal to aim for">🎯 <span class="if-goal-amt">…</span></button>' +
        '<button class="if-add" type="button" title="add an income source (a client, a gig…)">+ source</button></div>' +
        '<div class="big bd-avg if-big">…</div>' +
        '<div class="fc-sub if-sub"></div>' +
      "</div>" +
      '<div class="if-chart"><svg class="if-svg" viewBox="0 0 320 150" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg></div>' +
      '<div class="if-legend"></div>' +
      '<div class="if-sources"></div>';
    const big = el.querySelector(".if-big");
    const sub = el.querySelector(".if-sub");
    const svg = el.querySelector(".if-svg");
    const srcWrap = el.querySelector(".if-sources");
    const legendWrap = el.querySelector(".if-legend");
    const SRC_KEY = "money.forecastSources";
    let sources = null;

    // ── streams view state ──
    const COLORS = ["#14b8a6", "#f59e0b", "#8b5cf6", "#3f8f4e", "#c0467a", "#4a6da7", "#e0734a"];
    const MODE_KEY = "money.forecastMode";
    let mode = localStorage.getItem(MODE_KEY) || "streams";
    let histData = null;        // { months:[{ym,label}], sources:[{key,name,monthly[]}] }
    const hidden = {};          // source id -> true when toggled off in the legend
    const srcColor = (s, i) => COLORS[i % COLORS.length];
    const STOP = new Set(["the", "a", "an", "my", "and", "income", "monthly", "work", "of", "pay"]);
    const autoToken = (name) => (String(name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))[0] || "");
    const srcMatch = (s) => String(s.match != null ? s.match : autoToken(s.name)).toLowerCase().trim();
    function fetchHist() {
      fetch("/api/income-monthly?months=12&t=" + Date.now())
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.months) { histData = d; if (Store.data) paint(Store.data); } })
        .catch(() => {});
    }
    let workMonthly = null;   // { "YYYY-MM": hours }
    let dataSeen = null;      // snapshot stamp behind the cached history — re-fetch when server data moves
    function fetchWork() {
      fetch("/api/work-monthly?t=" + Date.now())
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.monthly_hours) { workMonthly = d.monthly_hours; if (Store.data) paint(Store.data); } })
        .catch(() => {});
    }
    // next N month labels after a "YYYY-MM"
    function nextLabels(lastYm, n) {
      const out = [];
      let [y, m] = (lastYm || new Date().toISOString().slice(0, 7)).split("-").map(Number);
      for (let i = 0; i < n; i++) { m++; if (m > 12) { m = 1; y++; } out.push(new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" })); }
      return out;
    }

    function paintStreams(d) {
      const S = planSummary(d, 0);
      if (!S || !sources) return;
      const need = needOf(S);
      const months = (histData && histData.months) || [];
      const hsrc = (histData && histData.sources) || [];
      const Hn = months.length, Fn = 6, C = Hn + Fn;
      big.textContent = fmtUSD(sources.reduce((a, s) => a + contribution(s), 0)) + "/mo";
      // build each visible source's series across all columns (history + flat projection)
      const matched = new Set();
      const bands = sources.map((s, i) => {
        const term = srcMatch(s), hist = new Array(Hn).fill(0);
        if (term) hsrc.forEach((hk) => {
          if (hk.key.indexOf(term) !== -1 || String(hk.name || "").toLowerCase().indexOf(term) !== -1) {
            matched.add(hk.key); hk.monthly.forEach((v, m) => { hist[m] += v; });
          }
        });
        return { id: s.id, name: s.name, color: srcColor(s, i), proj: contribution(s), hist, hidden: !!hidden[s.id] };
      });
      // unmatched historical income → a history-only "Other income" band
      const other = new Array(Hn).fill(0); let hasOther = false;
      hsrc.forEach((hk) => { if (!matched.has(hk.key)) { hasOther = true; hk.monthly.forEach((v, m) => { other[m] += v; }); } });
      if (hasOther && other.some((v) => v > 0)) bands.push({ id: "__other__", name: "Other income", color: "#8a8678", proj: 0, hist: other, hidden: !!hidden["__other__"] });
      // real-effort overlay (Toggl hours × gig rate, past → projected) for the hourly source
      const gigSrc = sources.find((x) => x.mode === "hourly");
      const hasEffort = !!(gigSrc && workMonthly && Object.keys(workMonthly).length && Hn);
      const legendItems = bands.slice();
      if (hasEffort) legendItems.push({ id: "__effort__", name: "real effort", color: "#0ea5e9", hidden: !!hidden["__effort__"] });
      renderLegend(legendItems);
      const valAt = (b, c) => (c < Hn ? b.hist[c] : b.proj);
      const live = bands.filter((b) => !b.hidden);
      // y-scale from the tallest stacked column (+ headroom), keep the needed line on-screen
      let peak = need;
      for (let c = 0; c < C; c++) { let t = 0; live.forEach((b) => { t += valAt(b, c); }); if (t > peak) peak = t; }
      const W = 320, H = 150, padL = 30, padR = 8, padT = 10, padB = 16;
      const x0 = padL, x1 = W - padR, yB = H - padB, yT = padT, ymax = peak * 1.1 || 1;
      const xAt = (c) => x0 + (C <= 1 ? 0 : c / (C - 1) * (x1 - x0));
      const yAt = (v) => yB - (v / ymax) * (yB - yT);
      let s = '<defs><pattern id="ifproj" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" class="if-hatch" stroke-width="1"/></pattern></defs>';
      // y gridlines (0 + peak-ish)
      [0, ymax / 2, ymax].forEach((g) => { const y = yAt(g); s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" class="if-grid" />'; s += '<text x="' + (x0 - 3) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" class="if-ylabel">' + (g >= 1000 ? Math.round(g / 1000) + "k" : Math.round(g)) + "</text>"; });
      // stacked areas (bottom→top), each spanning all columns
      const lower = new Array(C).fill(0);
      live.forEach((b) => {
        const top = lower.map((lo, c) => lo + valAt(b, c)), pts = [];
        for (let c = 0; c < C; c++) pts.push(xAt(c).toFixed(1) + "," + yAt(top[c]).toFixed(1));
        for (let c = C - 1; c >= 0; c--) pts.push(xAt(c).toFixed(1) + "," + yAt(lower[c]).toFixed(1));
        s += '<polygon points="' + pts.join(" ") + '" fill="' + b.color + '" fill-opacity="0.82" />';
        for (let c = 0; c < C; c++) lower[c] = top[c];
      });
      // hatch the projection region (right of "now")
      const nowX = xAt(Math.max(0, Hn - 1));
      s += '<rect x="' + nowX.toFixed(1) + '" y="' + yT + '" width="' + (x1 - nowX).toFixed(1) + '" height="' + (yB - yT).toFixed(1) + '" fill="url(#ifproj)" />';
      // needed line + now divider
      const ny = yAt(need);
      s += '<line x1="' + x0 + '" y1="' + ny.toFixed(1) + '" x2="' + x1 + '" y2="' + ny.toFixed(1) + '" class="if-need" />';
      s += '<text x="' + x1 + '" y="' + (ny - 3).toFixed(1) + '" text-anchor="end" class="if-need-lbl">need ' + fmtUSD(need) + "</text>";
      s += '<line x1="' + nowX.toFixed(1) + '" y1="' + yT + '" x2="' + nowX.toFixed(1) + '" y2="' + yB + '" class="if-now" />';
      s += '<text x="' + (nowX + 2).toFixed(1) + '" y="' + (yT + 8) + '" class="if-now-lbl">now</text>';
      // x labels: history months + projected months
      const flabels = nextLabels(months.length ? months[months.length - 1].ym : null, Fn);
      const labels = months.map((m) => m.label).concat(flabels);
      labels.forEach((lb, c) => { if (C > 9 && c % 2 && c !== C - 1) return; s += '<text x="' + xAt(c).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" class="if-mlabel">' + lb + "</text>"; });
      // real-effort line: solid over history (real hours × rate), dashed into the projection
      if (hasEffort && !hidden["__effort__"]) {
        const eff = (c) => (c < Hn ? (workMonthly[months[c].ym] || 0) * (gigSrc.rate || 0) : contribution(gigSrc));
        let past = "", fut = "";
        for (let c = 0; c < Hn; c++) past += (c ? "L" : "M") + xAt(c).toFixed(1) + " " + yAt(eff(c)).toFixed(1) + " ";
        for (let c = Math.max(0, Hn - 1); c < C; c++) fut += (c === Math.max(0, Hn - 1) ? "M" : "L") + xAt(c).toFixed(1) + " " + yAt(eff(c)).toFixed(1) + " ";
        s += '<path d="' + fut + '" class="if-effort if-effort-proj" />';
        s += '<path d="' + past + '" class="if-effort" />';
        for (let c = 0; c < Hn; c++) s += '<circle cx="' + xAt(c).toFixed(1) + '" cy="' + yAt(eff(c)).toFixed(1) + '" r="2.1" class="if-effort-dot" />';
      }
      svg.innerHTML = s;
      const surplus = sources.reduce((a, x) => a + contribution(x), 0) - need, up = surplus >= 0;
      sub.innerHTML = (up ? '<b style="color:#3f8f4e">+' + fmtUSD(surplus) + "/mo</b> over needs" : '<b style="color:#c9542e">' + fmtUSD(-surplus) + "/mo</b> short") +
        (Hn ? " · " + Hn + "&nbsp;mo history" : " · building history");
    }

    function renderLegend(bands) {
      if (mode !== "streams") { legendWrap.innerHTML = ""; return; }
      legendWrap.innerHTML = bands.map((b) =>
        '<button class="if-leg" data-id="' + escapeHtml(b.id) + '" style="--c:' + b.color + '"' + (b.hidden ? ' data-off="1"' : "") + '>' +
          '<span class="if-leg-dot"></span>' + escapeHtml(b.name) + "</button>").join("");
      legendWrap.querySelectorAll(".if-leg").forEach((btn) => btn.addEventListener("click", () => {
        const id = btn.dataset.id; hidden[id] = !hidden[id]; if (Store.data) paintStreams(Store.data);
      }));
    }

    // dispatch to the active view; toggle which header controls show
    function paint(d) {
      el.classList.toggle("if-mode-streams", mode === "streams");
      el.querySelectorAll(".if-modeopt").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
      if (mode === "streams") { if (!histData) fetchHist(); if (!workMonthly) fetchWork(); paintStreams(d); }
      else { legendWrap.innerHTML = ""; paintChart(d); }
    }

    const persist = () => { try { localStorage.setItem(SRC_KEY, JSON.stringify(sources)); } catch (e) {} };
    // a source contributes $/mo: hourly = hrs/wk × rate × (52/12); monthly = the value itself
    const contribution = (s) => s.mode === "hourly" ? (s.value || 0) * (52 / 12) * (s.rate || 0) : (s.value || 0);
    const fillPct = (sl) => ((sl.value - sl.min) / ((sl.max - sl.min) || 1) * 100).toFixed(1) + "%";
    const needOf = (S) => S.bills.reduce((a, t) => a + t.amt, 0) + ((S.estimates.find((t) => t.key === "__food__") || { amt: 0 }).amt);
    const GOAL_KEY = "money.forecastGoal";
    const getGoal = (need) => { const g = parseFloat(localStorage.getItem(GOAL_KEY)); return g > 0 ? g : Math.max(500, Math.round((need || 1000) / 50) * 50); };

    // header + graph ONLY — never rebuilds the slider DOM, so a drag is never interrupted
    function paintChart(d) {
      const S = planSummary(d, 0);
      if (!S || !sources) return;
      const need = needOf(S), cash = S.cash || 0;
      const income = sources.reduce((a, s) => a + contribution(s), 0);
      const surplus = income - need, up = surplus >= 0, col = up ? "#3f8f4e" : "#c9542e";
      const N = 6;
      const goal = getGoal(need);
      const goalAmt = el.querySelector(".if-goal-amt"); if (goalAmt) goalAmt.textContent = fmtUSD(goal);
      big.textContent = fmtUSD(income) + "/mo";
      // months to reach the goal at this pace
      let goalMsg;
      if (cash >= goal) goalMsg = '🎯 <b style="color:#3f8f4e">goal met</b>';
      else if (surplus > 0) { const m = (goal - cash) / surplus; goalMsg = "🎯 hit it in <b>" + (m <= 0.9 ? "<1" : Math.ceil(m)) + "&nbsp;mo</b>"; }
      else goalMsg = '🎯 <b style="color:#c9542e">slide up to reach it</b>';
      sub.innerHTML = (up ? '<b style="color:#3f8f4e">+' + fmtUSD(surplus) + "/mo</b> over needs"
        : '<b style="color:#c9542e">' + fmtUSD(-surplus) + "/mo</b> short") + " · " + goalMsg;
      const pts = [];
      for (let m = 0; m <= N; m++) pts.push(cash + surplus * m);
      const W = 320, H = 150, padL = 8, padR = 8, padB = 20, top = 12, bot = H - padB - 2;
      // scale anchored to cash (low) and the GOAL (near the top) — both stable, so sliding
      // only tilts the line while the goal stays at a fixed, visible height to climb toward.
      const ymin = Math.min(0, cash);
      const ymax = Math.max(goal * 1.12, cash + Math.max(need, 600) * 0.6, cash + 1);
      const scale = (bot - top) / ((ymax - ymin) || 1);
      const X = (m) => padL + (m / N) * (W - padL - padR);
      const Y = (v) => bot - (v - ymin) * scale;
      const line = pts.map((v, m) => (m ? "L" : "M") + X(m).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
      // fill only the wedge between the line and today's cash (the gain/loss) — can't bleed onto the sliders
      const baseLineY = Y(cash).toFixed(1);
      const area = "M " + X(0).toFixed(1) + " " + baseLineY + " " +
        pts.map((v, m) => "L " + X(m).toFixed(1) + " " + Y(v).toFixed(1)).join(" ") +
        " L " + X(N).toFixed(1) + " " + baseLineY + " Z";
      let s = "";
      // faint vertical line for each month (drawn first → sits behind everything)
      for (let g = 0; g <= N; g++) s += '<line x1="' + X(g).toFixed(1) + '" y1="' + top + '" x2="' + X(g).toFixed(1) + '" y2="' + (H - padB) + '" class="if-grid" />';
      const goalY = Y(goal);
      s += '<line x1="' + padL + '" y1="' + goalY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + goalY.toFixed(1) + '" class="if-goal-line" />';
      s += '<text x="' + (W - padR) + '" y="' + (goalY - 4).toFixed(1) + '" text-anchor="end" class="if-goal-label">goal ' + fmtUSD(goal) + "</text>";
      s += '<line x1="' + padL + '" y1="' + Y(cash).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + Y(cash).toFixed(1) + '" class="if-base" />';
      s += '<path d="' + area + '" style="fill:' + col + ';opacity:0.12" />';
      s += '<path d="' + line + '" class="if-line" style="stroke:' + col + '" />';
      s += '<circle cx="' + X(N).toFixed(1) + '" cy="' + Y(pts[N]).toFixed(1) + '" r="3.5" style="fill:' + col + '" />';
      if (surplus > 0 && cash < goal) {
        const m = (goal - cash) / surplus;
        if (m > 0 && m <= N) {
          const near = Math.round(m);
          const snapped = Math.abs(m - near) <= 0.15 ? near : m;  // tiny magnet onto the month lines
          s += '<circle cx="' + X(snapped).toFixed(1) + '" cy="' + goalY.toFixed(1) + '" r="4.5" class="if-goal-hit" />';
        }
      }
      const nowD = new Date();
      for (let m = 0; m <= N; m++) {
        const anchor = m === 0 ? "start" : m === N ? "end" : "middle";
        const lbl = new Date(nowD.getFullYear(), nowD.getMonth() + m, 1).toLocaleDateString("en-US", { month: "short" });
        s += '<text x="' + X(m).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + anchor + '" class="if-mlabel">' + lbl + "</text>";
      }
      svg.innerHTML = s;
    }

    // build the slider rows ONCE (on load / add / remove / rename) — not during a drag
    function renderSources() {
      srcWrap.innerHTML = sources.map((s) => {
        const hint = s.mode === "hourly"
          ? '<span class="if-src-hours">' + (s.value || 0) + '</span> hrs/wk @ <button class="if-src-rate" data-id="' + escapeHtml(s.id) + '" title="set your effective $/hr (after gas)">' + fmtUSD(s.rate || 0) + "/hr</button>"
          : "drag to set $/mo";
        return '<div class="if-src" data-id="' + escapeHtml(s.id) + '">' +
          '<div class="if-src-top"><span class="if-src-name" title="click to rename">' + escapeHtml(s.name) + "</span>" +
            '<span class="if-src-val">' + fmtUSD(contribution(s)) + "/mo</span>" +
            '<button class="if-src-x" title="remove this source">×</button></div>' +
          '<input type="range" class="if-slider if-src-slider" min="0" max="' + s.max + '" step="' + (s.mode === "hourly" ? 1 : 25) + '" value="' + (s.value || 0) + '" data-id="' + escapeHtml(s.id) + '" />' +
          '<div class="if-src-hint">' + hint +
            ' · <button class="if-src-link" data-id="' + escapeHtml(s.id) + '" title="which deposits feed this band\'s history">🔗 ' + (srcMatch(s) ? escapeHtml(srcMatch(s)) : "link history") + "</button></div>" +
        "</div>";
      }).join("");
      srcWrap.querySelectorAll(".if-src-slider").forEach((sl) => {
        sl.style.setProperty("--fill", fillPct(sl));
        const row = sl.closest(".if-src");
        const s = sources.find((x) => x.id === sl.dataset.id);
        let lastVal = parseFloat(sl.value) || 0, expPx = 0;  // bank EXP for effort — ~1 per 50px the thumb travels
        sl.addEventListener("input", () => {
          s.value = parseFloat(sl.value) || 0;
          const span = (parseFloat(sl.max) - parseFloat(sl.min)) || 1;
          expPx += Math.abs((s.value - lastVal) / span) * (sl.clientWidth || 200);
          lastVal = s.value;
          if (expPx >= 50) { const g = Math.floor(expPx / 50); expPx -= g * 50; addExp(g); }
          sl.style.setProperty("--fill", fillPct(sl));
          row.querySelector(".if-src-val").textContent = fmtUSD(contribution(s)) + "/mo";
          if (s.mode === "hourly") row.querySelector(".if-src-hours").textContent = s.value;
          persist();
          if (Store.data) paint(Store.data);  // tilt the graph, leave the sliders alone
        });
      });
      srcWrap.querySelectorAll(".if-src-x").forEach((b) => b.addEventListener("click", () => {
        const id = b.closest(".if-src").dataset.id;
        sources = sources.filter((x) => x.id !== id); persist();
        renderSources(); if (Store.data) paint(Store.data);
      }));
      srcWrap.querySelectorAll(".if-src-name").forEach((n) => n.addEventListener("click", () => {
        const s = sources.find((x) => x.id === n.closest(".if-src").dataset.id);
        const nm = prompt("Rename source:", s.name);
        if (nm && nm.trim()) { s.name = nm.trim(); persist(); renderSources(); }
      }));
      srcWrap.querySelectorAll(".if-src-rate").forEach((b) => b.addEventListener("click", () => {
        const s = sources.find((x) => x.id === b.dataset.id);
        const v = prompt("Effective $/hr for " + s.name + " (after gas — keep it conservative for slow nights):", s.rate || 20);
        if (v === null) return;
        const n = parseFloat((v || "").replace(/[^0-9.]/g, ""));
        if (n > 0) { s.rate = Math.round(n); persist(); renderSources(); if (Store.data) paint(Store.data); }
      }));
      srcWrap.querySelectorAll(".if-src-link").forEach((b) => b.addEventListener("click", () => {
        const s = sources.find((x) => x.id === b.dataset.id);
        const avail = ((histData && histData.sources) || []).map((h) => h.name).filter(Boolean);
        const tip = avail.length ? "\n\nYour detected income sources:\n• " + avail.join("\n• ") : "";
        const v = prompt("History for “" + s.name + "” — type a word from the deposit name(s) that feed this band (blank = none)." + tip, srcMatch(s));
        if (v === null) return;
        s.match = v.trim().toLowerCase(); persist(); renderSources(); if (Store.data) paint(Store.data);
      }));
    }

    function ensureSources(d) {
      if (sources) return;
      try { sources = JSON.parse(localStorage.getItem(SRC_KEY)); } catch (e) {}
      if (!Array.isArray(sources)) {  // first run only — an empty list (you cleared them) is respected
        const S = planSummary(d, 0);
        const base = Math.round(guaranteedIncome(d) || 0);
        const rate = parseFloat(localStorage.getItem("money.rate")) || 20;  // conservative default for slow nights
        const gap = S ? Math.max(0, needOf(S) - base) : 0;
        const hrs = Math.max(0, Math.min(40, Math.round(gap / (rate * 52 / 12))));
        sources = [
          { id: "retainer", name: "Monthly retainer", mode: "monthly", value: base || 2000, max: Math.max(5000, (base || 2000) * 2) },
          { id: "gig", name: "Gig work", mode: "hourly", rate: rate, value: hrs, max: 40 },
        ];
        persist();
      }
      renderSources();
    }
    el.querySelector(".if-add").addEventListener("click", () => {
      const nm = prompt("New income source — a client, gig, or anything (you'll slide its $/mo):");
      if (!nm || !nm.trim()) return;
      sources.push({ id: "src-" + Date.now(), name: nm.trim(), mode: "monthly", value: 0, max: 5000 });
      persist(); renderSources(); if (Store.data) paint(Store.data);
    });
    el.querySelector(".if-goal").addEventListener("click", () => {
      const cur = parseFloat(localStorage.getItem(GOAL_KEY)) || "";
      const v = prompt("Savings goal — the cushion ($) you want to build toward:", cur);
      if (v === null) return;
      const n = parseFloat((v || "").replace(/[^0-9.]/g, ""));
      if (n > 0) localStorage.setItem(GOAL_KEY, String(Math.round(n))); else localStorage.removeItem(GOAL_KEY);
      if (Store.data) paint(Store.data);
    });
    el.querySelectorAll(".if-modeopt").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.mode;
      localStorage.setItem(MODE_KEY, mode);
      if (Store.data) paint(Store.data);
    }));
    Store.subscribe(el, (d) => {
      if (!d || !d.spending) { big.textContent = "…"; return; }
      const s = dataStamp(d);
      if (s !== dataSeen) {
        const had = dataSeen !== null;
        dataSeen = s;
        if (had) { fetchHist(); fetchWork(); }  // server data moved (income re-tag, sync, import, delete) → refresh the history bands; the old chart stays up until fresh data lands
      }
      ensureSources(d); paint(d);
    });
  },
  clock(el) {
    el.classList.add("is-clock");
    el.innerHTML =
      '<div class="big"></div>' +
      '<div class="sub"></div>' +
      '<div class="clock-toggle">' +
        '<button data-h="12">12H</button>' +
        '<button data-h="24">24H</button>' +
      '</div>';
    const big = el.querySelector(".big");
    const sub = el.querySelector(".sub");
    const toggleEl = el.querySelector(".clock-toggle");
    const is24 = () => localStorage.getItem("money.clock24") !== "0"; // default 24h
    const paint = () =>
      toggleEl.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("active", (b.dataset.h === "24") === is24()));
    const tick = () => {
      const now = new Date();
      big.textContent = now.toLocaleTimeString("en-US", { hour12: !is24() });
      sub.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    };
    toggleEl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      localStorage.setItem("money.clock24", b.dataset.h === "24" ? "1" : "0");
      paint();
      tick();
    });
    paint();
    tick();
    setInterval(tick, 1000);
  },
  // Work/rest cycle timer — the EF-energy spine's visible clock. Work a block,
  // rest a block, longer rest every few cycles. The widget is a WINDOW onto the
  // module-scope timer engine (see below primeChime): the engine keeps ticking
  // across page switches and widget close, so a running block always chimes.
  // No shame: pause/skip/end are always one tap and never punished.
  timer(el) {
    el.classList.add("is-timer");
    const PHASE = { work: "work", rest: "rest", long: "long rest" };

    el.innerHTML =
      '<div class="tm-main">' +
        '<div class="tm-top"><span class="tm-phase"></span><span class="tm-pips"></span></div>' +
        '<div class="big tm-time">--:--</div>' +
        '<div class="tm-track"><span class="tm-fill"></span></div>' +
        '<div class="tm-controls"></div>' +
        '<div class="tm-foot">' +
          '<button class="tm-quiet tm-edit" type="button">presets</button>' +
          '<button class="tm-quiet tm-sound" type="button"></button>' +
        '</div>' +
      '</div>' +
      '<div class="tm-form" hidden></div>';
    const main = el.querySelector(".tm-main");
    const form = el.querySelector(".tm-form");
    const phaseEl = el.querySelector(".tm-phase");
    const pipsEl = el.querySelector(".tm-pips");
    const timeEl = el.querySelector(".tm-time");
    const fillEl = el.querySelector(".tm-fill");
    const ctrEl = el.querySelector(".tm-controls");
    const soundEl = el.querySelector(".tm-sound");

    const paintControls = () => {
      if (timerSt.endsAt) ctrEl.innerHTML =
        '<button class="tm-btn" data-a="pause" type="button">pause</button>' +
        '<button class="tm-btn tm-ghost" data-a="skip" type="button">skip</button>' +
        '<button class="tm-btn tm-ghost" data-a="end" type="button">end</button>';
      else if (timerSt.pausedLeft != null) ctrEl.innerHTML =
        '<button class="tm-btn" data-a="resume" type="button">resume</button>' +
        '<button class="tm-btn tm-ghost" data-a="skip" type="button">skip</button>' +
        '<button class="tm-btn tm-ghost" data-a="end" type="button">end</button>';
      else ctrEl.innerHTML = '<button class="tm-btn" data-a="start" type="button">start</button>';
      soundEl.textContent = timerSt.sound !== false ? "sound: on" : "sound: off";
    };

    const paintLive = () => {
      el.dataset.phase = timerSt.phase;
      const total = timerDur();
      const left = timerSt.endsAt != null ? Math.max(0, timerSt.endsAt - Date.now())
                 : timerSt.pausedLeft != null ? timerSt.pausedLeft : total;
      const s = Math.ceil(left / 1000);
      timeEl.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      fillEl.style.width = Math.max(0, Math.min(100, Math.round(100 * (1 - left / total)))) + "%";
      phaseEl.textContent = PHASE[timerSt.phase] + (timerSt.pausedLeft != null ? " · paused" : "");
      const L = timerEvery();
      const done = timerSt.phase === "work" ? (timerSt.cycle - 1) % L : ((timerSt.cycle - 1) % L) + 1;
      let pips = "";
      for (let i = 0; i < L; i++)
        pips += '<span class="tm-pip' + (i < done ? " done" : (i === done && timerSt.phase === "work") ? " now" : "") + '"></span>';
      pipsEl.innerHTML = pips;
    };

    // the engine announces every phase turn / foreign-tab change on cache:timer;
    // self-unhook once this widget leaves the DOM (house idiom, see energy)
    const repaint = () => {
      if (!el.isConnected) { document.removeEventListener("cache:timer", repaint); return; }
      paintControls(); paintLive();
    };
    document.addEventListener("cache:timer", repaint);

    ctrEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const a = b.dataset.a;
      if (a === "start" || a === "resume") {
        primeChime(); // user gesture — unlock audio so the chime can fire later
        timerSt.endsAt = Date.now() + (a === "resume" ? timerSt.pausedLeft : timerDur());
        timerSt.pausedLeft = null;
      } else if (a === "pause") {
        timerSt.pausedLeft = Math.max(1000, timerSt.endsAt - Date.now());
        timerSt.endsAt = null;
      } else if (a === "skip") {
        timerAdvance(false); // no chime, no EXP — and no shame either
        timerSt.pausedLeft = null;
        timerSt.endsAt = Date.now() + timerDur();
      } else if (a === "end") {
        timerSt.phase = "work"; timerSt.cycle = 1; timerSt.endsAt = null; timerSt.pausedLeft = null;
      }
      timerSave(); timerEmit();
    });

    soundEl.addEventListener("click", () => {
      timerSt.sound = timerSt.sound === false;
      timerSave(); timerEmit();
    });

    el.querySelector(".tm-edit").addEventListener("click", () => {
      const field = (label, k, val, max) =>
        '<label class="tm-row"><span>' + label + '</span>' +
        '<input type="number" inputmode="numeric" min="1" max="' + max + '" step="1" data-k="' + k + '" value="' + val + '"></label>';
      form.innerHTML =
        field("work (min)", "work", timerPreset("work", 25), 180) +
        field("rest (min)", "rest", timerPreset("rest", 5), 180) +
        field("long rest (min)", "longRest", timerPreset("longRest", 15), 180) +
        field("long rest every (blocks)", "longEvery", timerEvery(), 12) +
        '<div class="tm-formnote">yours to change — takes effect when the next block starts</div>' +
        '<button class="tm-btn" data-a="saveform" type="button">save</button>';
      main.hidden = true; form.hidden = false;
      form.querySelector('[data-a="saveform"]').addEventListener("click", () => {
        form.querySelectorAll("input").forEach((i) => {
          const n = parseFloat(i.value);
          const max = parseInt(i.max) || 180;
          // clamp to the nearest allowed value — never silently revert to defaults
          if (n >= 1) timerSt[i.dataset.k] = Math.min(max, Math.round(n));
        });
        timerSave(); form.hidden = true; main.hidden = false;
        timerEmit();
      });
    });

    paintControls();
    paintLive();
    const pv = setInterval(() => { // paint-only; the module engine owns the transitions
      if (!el.isConnected) { clearInterval(pv); return; }
      paintLive();
    }, 1000);
  },
  date(el) {
    // re-render when the day changes — an always-on board crosses midnight and the
    // date must not disagree with the clock widget about what day it is
    let day = null;
    const render = () => {
      const now = new Date();
      if (now.getDate() === day) return;   // no-op except at midnight / tab wake
      day = now.getDate();
      el.innerHTML =
        '<div><div class="big">' + now.getDate() +
        '</div><div class="sub">' + now.toLocaleDateString("en-US", { month: "long" }) +
        '</div></div>';
    };
    render();
    const iv = setInterval(() => { if (!el.isConnected) { clearInterval(iv); return; } render(); }, 30000);
  },
  note(el) {
    el.classList.add("is-note");
    const note = document.createElement("div");
    note.className = "note-edit";
    note.contentEditable = "true";
    note.textContent = localStorage.getItem(NOTE_KEY) || "";
    note.addEventListener("input", () => localStorage.setItem(NOTE_KEY, note.textContent));
    el.appendChild(note);
  },
  forms(el) {
    // Your own data-intake forms: build a template, route each field into your 12 areas, fill
    // it. Templates + submissions live in money.forms / money.formData (per-item merge). Reads
    // localStorage directly — no backend — and repaints on cache:forms.
    el.classList.add("is-forms");
    const render = () => {
      el.innerHTML =
        '<div class="bd-head"><i data-lucide="clipboard-list"></i><span>Forms</span></div>' +
        formsRowsHTML() +
        '<div class="frm-foot"><button class="frm-btn" data-act="new">＋ New form</button><button class="frm-btn ghost" data-act="doc">⬆ From a document</button></div>';
      drawIcons();
      wireFormsList(el);
    };
    render();
    const onChange = () => { if (el.isConnected) render(); else document.removeEventListener("cache:forms", onChange); };
    document.addEventListener("cache:forms", onChange);
  },
  energy(el) {
    // Health's first widget: the EF-energy pattern — the first visible picture of your own
    // variability (NOW lane, Working Docs/3_ROADMAP.md). Reads check-in answers routed to
    // the 🩺 Health store; re-renders live when a check-in finishes (cache:logged event).
    el.classList.add("is-energy");
    const WORDS = { drained: 1, low: 2, ok: 3, good: 4, high: 4, charged: 5 };  // word answers (old decks / custom buttons) → numbers
    const FACE = ["", "🪫", "😮‍💨", "🔋", "✨", "⚡"];
    function dayVals() {
      const by = {};
      (typeof loadLog === "function" ? loadLog() : []).forEach((e) => {
        if (!e || !e.dest || e.dest.kind !== "health") return;
        if ((e.dest.target || "") !== "energy" && e.itemId !== "energy") return;
        let v = typeof e.value === "number" ? e.value : (WORDS[String(e.value).toLowerCase()] || parseFloat(e.value));
        if (!v || isNaN(v)) return;
        v = Math.max(1, Math.min(5, v));
        (by[e.ts] = by[e.ts] || []).push(v);
      });
      return by;
    }
    function render() {
      if (!el.isConnected) { document.removeEventListener("cache:logged", render); return; }
      const by = dayVals(), days = [], tk = todayKey();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        const vs = by[k]; days.push({ avg: vs ? vs.reduce((a, b) => a + b, 0) / vs.length : null, today: k === tk });
      }
      const logged = days.filter((d) => d.avg != null), t = days[days.length - 1];
      const head = t.avg != null
        ? '<div class="big">' + FACE[Math.round(t.avg)] + " " + Math.round(t.avg * 10) / 10 + '<span class="en-of">/5</span></div><div class="sub">today’s energy</div>'
        : '<div class="big en-dim">not logged yet</div><div class="sub">today’s energy</div>';
      const bars = '<div class="en-chart" role="img" aria-label="energy, one bar per day, last 14 days">' + days.map((d) =>
        '<div class="en-col' + (d.today ? " en-today" : "") + '">' +
          (d.avg != null ? '<div class="en-bar" style="height:' + Math.round((d.avg / 5) * 100) + '%"></div>' : '<div class="en-none"></div>') +
        "</div>").join("") + "</div>";
      const avg = logged.length ? Math.round(logged.reduce((a, d) => a + d.avg, 0) / logged.length * 10) / 10 : null;
      const foot = logged.length
        ? '<div class="sub en-foot">last 14 days · ' + logged.length + (logged.length === 1 ? " day" : " days") + " logged" + (avg ? " · avg " + avg : "") + "</div>"
        : '<div class="sub en-foot">answer the ⚡ question in a Daily check-in and your pattern appears here — a missing bar is information, never a failure</div>';
      const cta = t.avg == null ? '<button class="en-log" type="button">⚡ log now</button>' : "";
      el.innerHTML = head + bars + foot + cta;
      const b = el.querySelector(".en-log"); if (b) b.addEventListener("click", () => { if (typeof openDaily === "function") openDaily(); });
    }
    render();
    document.addEventListener("cache:logged", render);
  },
  bucket(el) {
    // Brain Bucket v1 — your actively-held working memory (NOW lane, Working Docs/3_ROADMAP.md).
    // Notes + links you deliberately hold so your brain doesn't have to; server-backed from
    // birth (data/bucket.json) so it syncs across devices and rides backups + the vault.
    // Toss is one tap, zero shame. Monthly cleanout prompt + file-into-area: later bricks.
    el.classList.add("is-bucket");
    function render(items) {
      const held = items || [];
      el.innerHTML =
        '<div class="bk-add"><input class="bk-in" placeholder="hold a thought, or paste a link…" maxlength="500" aria-label="add to brain bucket">' +
        '<button class="bk-go" aria-label="add to bucket">＋</button></div>' +
        (held.length
          ? '<div class="bk-list">' + held.map((it) => '<div class="bk-item">' +
              (it.kind === "link" && it.url ? '<a class="bk-txt" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">🔗 ' + escapeHtml(it.text || it.url) + "</a>" : '<span class="bk-txt">' + escapeHtml(it.text || "") + "</span>") +
              '<button class="bk-x" data-id="' + escapeHtml(it.id || "") + '" aria-label="toss from bucket">✕</button></div>').join("") + "</div>"
          : '<div class="sub bk-empty">whatever’s live in your head — drop it here so your brain doesn’t have to hold it. toss things whenever; a gentle monthly cleanout is coming.</div>') +
        '<div class="sub bk-count">' + held.length + (held.length === 1 ? " thing held" : " things held") + "</div>";
      const inp = el.querySelector(".bk-in");
      const add = () => {
        const v = (inp.value || "").trim(); if (!v) return;
        const isUrl = /^https?:\/\/\S+$/i.test(v);
        fetch("/api/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isUrl ? { kind: "link", url: v, text: "" } : { kind: "note", text: v }) })
          .then((r) => { if (!r.ok) throw new Error("no"); return r.json(); })
          .then((d) => {
            if (d && d.ok === false) { try { flash(d.error || "couldn’t save"); } catch (e) {} return; }   // web mirror: 200 {ok:false} — don't wipe the list
            render((d && d.items) || []);
          })
          .catch(() => { try { flash("couldn’t reach your cache — the bucket lives on the server"); } catch (e) {} });
      };
      el.querySelector(".bk-go").addEventListener("click", add);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      el.querySelectorAll(".bk-x").forEach((b) => b.addEventListener("click", () => {
        fetch("/api/bucket-remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.id }) })
          .then((r) => { if (!r.ok) throw new Error("no"); return r.json(); })
          .then((d) => {
            if (d && d.ok === false) { try { flash(d.error || "couldn’t save"); } catch (e) {} return; }
            render((d && d.items) || []);
          })
          .catch(() => { try { flash("couldn’t reach your cache — the bucket lives on the server"); } catch (e) {} });   // a toss that failed must say so, same as add
      }));
    }
    // a failed initial load must NOT paint the authentic empty state — for this
    // user population "0 things held" reads as "my held thoughts are gone"
    function renderDown() {
      if (!el.isConnected) return;
      el.innerHTML =
        '<div class="sub bk-empty">couldn’t reach your cache — your held thoughts are safe on the server and will be back the moment it is.</div>' +
        '<button class="bk-retry" type="button">try again</button>';
      el.querySelector(".bk-retry").addEventListener("click", load);
    }
    function load() {
      fetch("/api/bucket").then((r) => { if (!r.ok) throw new Error("no"); return r.json(); }).then((d) => render((d && d.items) || [])).catch(renderDown);
    }
    function onLive() {
      if (!el.isConnected) { document.removeEventListener("cache:online", onLive); return; }
      if (el.querySelector(".bk-retry")) load();   // only reload while showing the down state — never clobber typing
    }
    document.addEventListener("cache:online", onLive);
    render([]);
    load();
  },
  tasks(el) {
    // Tasks + Habits — the deck, fully realized (money.things). Tasks are one-off things you do
    // and remember, with INFINITE SUBTASKS (uniform recursion — each its own id-keyed item
    // linked by `parent`, merging independently across devices). UPGRADE a task to a HABIT
    // (⋯ → Make a habit) and it becomes something you track: because habits RECUR, "done today"
    // is LOG-DERIVED per day (never a flag that would have to reset). Tracked four ways
    // (HABIT_TRACKS): yes/no · a number (minutes, reps…) · a 1–5 rating · a few words — all
    // day-keyed log entries, latest-per-day wins. A habit can also carry its OWN optional
    // `sched` (the routine engine, routineDueOn): absent = daily; a not-due day shows a calm
    // "not today" and stays tappable (a bonus, never an error). Tasks NEVER recur — due date
    // only. Add subtasks, check things off, delete a whole subtree with one undo, tap a title
    // for the activity trail. Pure client-side through the per-item merge engine.
    el.classList.add("is-tasks");
    // date-nav CONTRACT (coordinate with the deck session): mounted INSIDE the deck (.deck-space)
    // this renders for the deck's SELECTED day; on the board it's always today. Completion reads
    // AND writes key off this one day, so "done" travels with the DAY, not the habit.
    const viewDay = () => ((el.closest && el.closest(".deck-space") && typeof deckViewDay === "function") ? deckViewDay() : todayKey());
    let undo = null, selfSaving = false, panel = null;   // panel = {id, kind:"addsub"|"menu"|"amount"} — one inline row open at a time
    // Fold state PERSISTS across deck opens (bare key, like deckCiCollapsed → auto-excluded
    // from the vault since only money.* syncs). Routines default COLLAPSED (neat accordions
    // pinned at top); tasks with subtasks default expanded. An explicit toggle stores 0|1.
    const FOLD_KEY = "deckFold";
    let fold = {}; try { fold = JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) { fold = {}; }
    const isOpen = (t) => (fold[t.id] === 0 || fold[t.id] === 1) ? fold[t.id] === 1 : (t.type !== "routine");
    const setOpen = (id, open) => { fold[id] = open ? 1 : 0; try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) {} };
    const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : (s || ""));
    const save = (items) => { selfSaving = true; try { saveThings(items); } finally { selfSaving = false; } };
    const esc = (s) => escapeHtml(s || "");
    const sortSibs = (a) => a.sort((x, y) => (!!x.done - !!y.done) || (+x.ord || 0) - (+y.ord || 0) || (x.id < y.id ? -1 : 1));   // one-off done sinks; habits keep their spot (their object `done` stays 0)
    const isHabit = (t) => t.type === "habit";
    const doneState = (t, log, today) => ((isHabit(t) || t.routine) ? thingDoneOn(log, t.id, today) : !!t.done);   // habits AND routine members recur → DERIVED from the log per day; plain tasks use the object flag
    const togglePanel = (id, kind) => { panel = (panel && panel.id === id && panel.kind === kind) ? null : { id: id, kind: kind }; };
    function model() {
      const vis = thingsVisible(loadThings()), byParent = {}, byRoutine = {};   // liveness-filtered: tombstoned/dangling subtrees hidden
      vis.forEach((t) => {
        if (t.routine && t.type !== "routine") { (byRoutine[t.routine] = byRoutine[t.routine] || []).push(t); return; }   // routine MEMBERS group under their routine
        const p = t.parent || "_root"; (byParent[p] = byParent[p] || []).push(t);
      });
      const roots = sortSibs((byParent._root || []).filter((t) => (t.type === "task" || t.type === "habit" || t.type === "routine") && !t.parent && !t.routine));
      return { byParent, byRoutine, roots };
    }
    function render() {
      try { fold = JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) {}   // re-read each render so "Go to routine" (an external open) is honored
      const { byParent, byRoutine, roots } = model(), rows = [], log = loadLog(), today = viewDay();   // viewDay() = the deck's selected day when mounted there, else today
      const walk = (t, depth) => {   // uniform recursion — a subtask's children render exactly like a task's
        if (t.type === "routine") {   // a ROUTINE groups members (routine:<id>), shown when expanded; each member's "done today" is log-derived
          const members = sortSibs((byRoutine[t.id] || []).slice());
          const due = (typeof routineDueOn === "function") ? routineDueOn(t.sched, today) : true;
          const doneCt = members.filter((m) => thingDoneOn(log, m.id, today)).length;
          rows.push(routineRowHtml(t, depth, members.length, doneCt, due));
          if (panel && panel.id === t.id) rows.push(panelHtml(t, depth + 1));
          if (isOpen(t)) members.forEach((m) => walk(m, depth + 1));   // walk (not bare rowHtml) so a member's ⋯ panel + any subtasks render too
          return;
        }
        const kids = sortSibs((byParent[t.id] || []).slice());
        rows.push(rowHtml(t, depth, kids.length, log, today));
        if (panel && panel.id === t.id) rows.push(panelHtml(t, depth + 1));
        if (kids.length && isOpen(t)) kids.forEach((k) => walk(k, depth + 1));
      };
      roots.filter((t) => t.type === "routine").forEach((r) => walk(r, 0));   // routines pinned to the top as accordions
      roots.filter((t) => t.type !== "routine").forEach((r) => walk(r, 0));   // then loose tasks + habits
      // the count only breathes down your neck about things actually DUE today — a habit
      // scheduled for other days is neither "to do" nor "done", it's just resting (non-punitive)
      const flat = roots.filter((t) => t.type !== "routine")
        .filter((t) => !isHabit(t) || t.routine || routineDueOn(t.sched || null, today));
      const open = flat.filter((t) => !doneState(t, log, today)).length, doneN = flat.length - open;
      el.innerHTML =
        '<div class="tk-add"><input class="tk-in" placeholder="add a task…" maxlength="200" aria-label="add a task">' +
        '<button class="tk-go" aria-label="add task">＋</button></div>' +
        (rows.length ? '<div class="tk-list">' + rows.join("") + "</div>"
          : '<div class="sub tk-empty">the things you need to do and remember. add one above, break it into subtasks, make it a habit, or group a few into a routine.</div>') +
        (undo ? '<div class="tk-undo"><span class="tk-undo-t">' + esc(undo.label) + " deleted</span><button class=\"tk-undo-go\">undo</button></div>" : "") +
        '<div class="tk-foot"><button class="tk-newroutine" id="tkNewRoutine">🔁 New routine</button><span class="sub tk-count">' + (flat.length ? open + " to do" + (doneN ? " · " + doneN + " done" : "") : "") + "</span></div>";
      wire();
    }
    function rowHtml(t, depth, nKids, log, today) {
      const habit = isHabit(t), track = habit ? (t.track || "check") : null, done = doneState(t, log, today), col = !isOpen(t);
      const unit = t.unit ? " " + esc(t.unit) : "";
      // a habit's own optional sched decides "due today" (absent sched = daily, the old behavior);
      // NOT due is calm and non-punitive — dimmed + "not today", but still tappable (doing a
      // habit on an off day is a bonus, never an error). Routine members follow their routine.
      const due = (!habit || t.routine) ? true : routineDueOn(t.sched || null, today);
      const dayVal = (habit && track !== "check") ? thingAmountOn(log, t.id, today) : null;   // the day's latest logged value (qty / rating / text)
      let control;   // how it's tracked → what the row's control is (all four log-derived per day)
      if (track === "amount") control = '<button class="tk-amt' + (done ? " on" : "") + '" data-act="amount" data-id="' + esc(t.id) + '" aria-label="log an amount">' + (dayVal && dayVal.qty != null ? esc(String(dayVal.qty)) + unit : "log") + "</button>";
      else if (track === "scale") control = '<button class="tk-amt' + (done ? " on" : "") + '" data-act="scale" data-id="' + esc(t.id) + '" aria-label="rate 1 to 5">' + (dayVal && dayVal.rating != null ? esc(String(dayVal.rating)) + "/5" : "rate") + "</button>";
      else if (track === "note") control = '<button class="tk-amt tk-notechip' + (done ? " on" : "") + '" data-act="note" data-id="' + esc(t.id) + '" aria-label="log a few words">' + (dayVal && dayVal.text ? esc(clip(dayVal.text, 10)) : "write") + "</button>";
      else control = '<button class="tk-check' + (done ? " on" : "") + '" data-act="toggle" data-id="' + esc(t.id) + '" aria-label="' + (done ? "mark not done" : "mark done") + '"></button>';
      return '<div class="tk-item' + (done ? " done" : "") + (habit ? " tk-habit" : "") + (due ? "" : " tk-notdue") + '" style="margin-left:' + (depth * 15) + 'px">' +
        (nKids
          ? '<button class="tk-caret' + (col ? " col" : "") + '" data-act="caret" data-id="' + esc(t.id) + '" aria-label="' + (col ? "expand" : "collapse") + '">▾</button>'
          : '<span class="tk-caret-sp"></span>') +
        control +
        '<span class="tk-title" data-act="detail" data-id="' + esc(t.id) + '" role="button" tabindex="0" title="open — edit, due date, area…">' + (habit ? '<span class="tk-hbadge" aria-hidden="true" title="a habit — it recurs">↻</span>' : "") + esc(t.title) + "</span>" +
        (due ? "" : '<span class="tk-rprog">not today</span>') +
        '<button class="tk-addsub" data-act="addsub" data-id="' + esc(t.id) + '" aria-label="add a subtask" title="add a subtask">＋</button>' +
        '<button class="tk-menu" data-act="menu" data-id="' + esc(t.id) + '" aria-label="options" title="habit &amp; options">⋯</button>' +
        '<button class="tk-x" data-act="del" data-id="' + esc(t.id) + '" aria-label="delete">✕</button>' +
        "</div>";
    }
    function routineRowHtml(r, depth, nMembers, doneCt, due) {
      const col = !isOpen(r), allDone = nMembers > 0 && doneCt === nMembers;
      return '<div class="tk-item tk-routine' + (allDone ? " done" : "") + (due ? "" : " tk-notdue") + '" style="margin-left:' + (depth * 15) + 'px">' +
        '<button class="tk-caret' + (col ? " col" : "") + '" data-act="caret" data-id="' + esc(r.id) + '" aria-label="' + (col ? "expand" : "collapse") + '">▾</button>' +
        '<span class="tk-remoji" aria-hidden="true">' + esc(r.emoji || "🔁") + "</span>" +
        '<span class="tk-title" data-act="rdetail" data-id="' + esc(r.id) + '" role="button" tabindex="0" title="edit routine — name, schedule, steps">' + esc(r.name || "Routine") + "</span>" +
        '<span class="tk-rprog' + (allDone ? " done" : "") + '">' + (due ? doneCt + "/" + nMembers : "not today") + "</span>" +
        '<button class="tk-addsub" data-act="addmember" data-id="' + esc(r.id) + '" aria-label="add a step" title="add a step">＋</button>' +
        '<button class="tk-x" data-act="del" data-id="' + esc(r.id) + '" aria-label="delete routine">✕</button>' +
        "</div>";
    }
    function panelHtml(t, depth) {
      const ml = ' style="margin-left:' + (depth * 15) + 'px"';
      if (panel.kind === "addsub") return '<div class="tk-subadd"' + ml + '><input class="tk-subin" placeholder="add a subtask…" maxlength="200" aria-label="add a subtask"><button class="tk-subgo" aria-label="add subtask">＋</button></div>';
      if (panel.kind === "addmember") return '<div class="tk-subadd"' + ml + '><input class="tk-subin" placeholder="add a step to this routine…" maxlength="200" aria-label="add a step"><button class="tk-subgo" aria-label="add step">＋</button></div>';
      if (panel.kind === "amount") { const u = t.unit ? " " + esc(t.unit) : ""; return '<div class="tk-subadd"' + ml + '><input class="tk-amtin" type="number" inputmode="decimal" placeholder="how many' + u + '…" aria-label="log amount"><button class="tk-subgo tk-amtgo" aria-label="log">✓</button></div>'; }
      if (panel.kind === "scale") {   // 1–5 rating — tap to log; tap today's rating again to clear it
        const cur = thingAmountOn(loadLog(), t.id, viewDay()), curN = cur && cur.rating != null ? +cur.rating : null;
        return '<div class="tk-subadd tk-scale"' + ml + ">" + [1, 2, 3, 4, 5].map((n) =>
          '<button class="tk-scale-n' + (curN === n ? " on" : "") + '" data-scale="' + n + '" data-id="' + esc(t.id) + '" aria-label="rate ' + n + ' of 5"' + (curN === n ? ' title="tap again to clear"' : "") + ">" + n + "</button>").join("") + "</div>";
      }
      if (panel.kind === "note") {   // a few words — the day's text, editable in place (latest entry wins)
        const cur = thingAmountOn(loadLog(), t.id, viewDay());
        return '<div class="tk-subadd"' + ml + '><input class="tk-notein" maxlength="200" placeholder="a few words…" value="' + esc((cur && cur.text) || "") + '" aria-label="log a few words"><button class="tk-subgo tk-notego" aria-label="log">✓</button></div>';
      }
      if (panel.kind === "move") {   // TAP-TO-MOVE: pick a routine (or make it loose) — reliable on touch, no drag fighting scroll
        const routines = thingsVisible(loadThings()).filter((x) => x.type === "routine");
        const cur = t.routine || null;
        const btns = routines.map((r) => '<button class="tk-mbtn tk-movebtn' + (r.id === cur ? " on" : "") + '" data-act="moveto" data-id="' + esc(t.id) + '" data-rid="' + esc(r.id) + '">' + esc(r.emoji || "🔁") + " " + esc(r.name || "Routine") + (r.id === cur ? " ✓" : "") + "</button>");
        btns.push('<button class="tk-mbtn tk-movebtn' + (!cur ? " on" : "") + '" data-act="moveto" data-id="' + esc(t.id) + '" data-rid="">↩ Loose (no routine)' + (!cur ? " ✓" : "") + "</button>");
        return '<div class="tk-menu-row tk-moverow"' + ml + ">" + (routines.length ? "" : '<span class="sub tk-movehint">No routines yet — use “🔁 New routine” below first.</span>') + btns.join("") + "</div>";
      }
      // the ⋯ menu — the habit upgrade/downgrade + a small "how it's tracked" picker (the full
      // set: yes/no · number · rating · text) + move-to-routine. All routed through the ONE
      // thingSetType/thingSetTrack code path the detail sheet uses, so the two can't drift.
      const habit = isHabit(t), btns = [];
      if (!habit) btns.push('<button class="tk-mbtn" data-act="tohabit" data-id="' + esc(t.id) + '">↻ Make a habit</button>');
      else {
        const cur = t.track || "check";
        HABIT_TRACKS.forEach((tr) => btns.push('<button class="tk-mbtn' + (tr[0] === cur ? " on" : "") + '" data-act="track" data-id="' + esc(t.id) + '" data-mode="' + tr[0] + '">' + tr[1] + (tr[0] === cur ? " ✓" : "") + "</button>"));
        btns.push('<button class="tk-mbtn" data-act="totask" data-id="' + esc(t.id) + '">↩ Back to a task</button>');
      }
      if (t.routine || thingsVisible(loadThings()).some((x) => x.type === "routine")) btns.push('<button class="tk-mbtn" data-act="movemenu" data-id="' + esc(t.id) + '">🔁 Move to routine…</button>');
      return '<div class="tk-menu-row"' + ml + ">" + btns.join("") + "</div>";
    }
    function addUnder(parentId, title, type) {
      const now = Date.now();
      const sibs = thingsVisible(loadThings()).filter((x) => (x.parent || null) === parentId);
      const ord = sibs.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;
      // every object gets a stable globally-unique id + real stamps at birth (deck contract)
      save([{ id: thingId(), type: type, title: title, done: 0, doneAt: null, updated: now, ord: ord, ordAt: now, deleted: 0, parent: parentId, routine: null }]);
    }
    function addMember(routineId, title) {   // a routine STEP — a thing carrying routine:<id>; completion is log-derived (resets daily)
      const now = Date.now();
      const sibs = thingsVisible(loadThings()).filter((x) => x.routine === routineId);
      const ord = sibs.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;
      save([{ id: thingId(), type: "task", title: title, done: 0, doneAt: null, updated: now, ord: ord, ordAt: now, deleted: 0, parent: null, routine: routineId }]);
    }
    function newRoutine() {
      const now = Date.now(), id = thingId();
      const sibs = thingsVisible(loadThings()).filter((x) => x.type === "routine");
      const ord = sibs.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;
      save([{ id: id, type: "routine", name: "New routine", emoji: "🔁", sched: { freq: "daily", every: 1 }, active: 1, updated: now, ord: ord, ordAt: now, deleted: 0, parent: null, routine: null }]);
      undo = null; render(); try { openRoutineDetail(id); } catch (e) {}
    }
    function moveToRoutine(id, rid) {   // set/clear the `routine` link — a per-item edit that merges cleanly
      const all = loadThings(), t = all.find((x) => x && x.id === id); if (!t) { panel = null; render(); return; }
      const target = rid || null;
      if ((t.routine || null) === target) { panel = null; render(); return; }   // already there — no-op
      const now = Date.now();
      // INTO a routine → become a top-level member (clear parent so it isn't left nested under a task);
      // OUT of a routine → routine:null, keep the parent it had (usually null → a loose root task).
      const parent = target ? null : (t.parent || null);
      const sibs = thingsVisible(all).filter((x) => x.id !== id && (target ? x.routine === target : ((x.parent || null) === parent && !x.routine)));
      const ord = sibs.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;   // drop it at the end of the destination group
      save([Object.assign({}, t, { routine: target, parent: parent, ord: ord, ordAt: now, updated: now })]);
      if (target) setOpen(target, true);   // open the destination routine so the moved item is visible right away
      panel = null; undo = null; render();
      try { flash(target ? "Moved to routine" : "Removed from routine"); } catch (e) {}
    }
    function wire() {
      const inp = el.querySelector(".tk-in");
      const addTop = () => {
        const v = (inp.value || "").trim(); if (!v) return;
        addUnder(null, v, "task"); undo = null; panel = null; render();
        const ni = el.querySelector(".tk-in"); if (ni) ni.focus();   // keep focus for rapid entry
      };
      el.querySelector(".tk-go").addEventListener("click", addTop);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addTop(); });
      el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
        const id = b.dataset.id, act = b.dataset.act;
        if (act === "toggle") toggle(id);
        else if (act === "del") { const dt = loadThings().find((x) => x && x.id === id); confirmDelete(dt ? (dt.title || dt.name || "this") : "this", () => del(id)); }
        else if (act === "detail") openTaskDetail(id);
        else if (act === "rdetail") { try { openRoutineDetail(id); } catch (e) {} }
        else if (act === "caret") { const ct = loadThings().find((x) => x && x.id === id); setOpen(id, !(ct ? isOpen(ct) : false)); render(); }
        else if (act === "addsub") { togglePanel(id, "addsub"); setOpen(id, true); render(); const si = el.querySelector(".tk-subin"); if (si) si.focus(); }
        else if (act === "addmember") { togglePanel(id, "addmember"); setOpen(id, true); render(); const si = el.querySelector(".tk-subin"); if (si) si.focus(); }
        else if (act === "menu") { togglePanel(id, "menu"); render(); }
        else if (act === "movemenu") { togglePanel(id, "move"); render(); }
        else if (act === "moveto") { moveToRoutine(id, b.dataset.rid || ""); }
        else if (act === "amount") { togglePanel(id, "amount"); render(); const ai = el.querySelector(".tk-amtin"); if (ai) ai.focus(); }
        else if (act === "scale") { togglePanel(id, "scale"); render(); }
        else if (act === "note") { togglePanel(id, "note"); render(); const ni = el.querySelector(".tk-notein"); if (ni) ni.focus(); }
        else if (act === "tohabit") { panel = null; thingSetType(id, "habit"); }   // re-renders via the cache:things listener
        else if (act === "totask") { panel = null; thingSetType(id, "task"); }
        else if (act === "track") { panel = null; thingSetTrack(id, b.dataset.mode); }
      }));
      el.querySelectorAll('.tk-title[data-act="detail"]').forEach((s) => s.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTaskDetail(s.dataset.id); } }));
      const subin = el.querySelector(".tk-subin");
      if (subin) {
        const commitSub = () => {
          const v = (subin.value || "").trim(), pid = panel && panel.id, kind = panel && panel.kind;
          if (v && pid) { if (kind === "addmember") addMember(pid, v); else addUnder(pid, v, "subtask"); } else { panel = null; }   // keep the panel open (same parent) for rapid entry
          undo = null; render();
          const si = el.querySelector(".tk-subin"); if (si) si.focus();
        };
        subin.addEventListener("keydown", (e) => { if (e.key === "Enter") commitSub(); else if (e.key === "Escape") { panel = null; render(); } });
        const sg = el.querySelector(".tk-subgo"); if (sg) sg.addEventListener("click", commitSub);
      }
      const nr = el.querySelector("#tkNewRoutine"); if (nr) nr.addEventListener("click", newRoutine);
      const amtin = el.querySelector(".tk-amtin");
      if (amtin) {
        const commitAmt = () => { const v = (amtin.value || "").trim(), pid = panel && panel.id; if (v !== "" && pid) logAmount(pid, parseFloat(v)); else { panel = null; render(); } };
        amtin.addEventListener("keydown", (e) => { if (e.key === "Enter") commitAmt(); else if (e.key === "Escape") { panel = null; render(); } });
        const ag = el.querySelector(".tk-amtgo"); if (ag) ag.addEventListener("click", commitAmt);
      }
      el.querySelectorAll(".tk-scale-n").forEach((b) => b.addEventListener("click", () => logScale(b.dataset.id, +b.dataset.scale)));
      const notein = el.querySelector(".tk-notein");
      if (notein) {
        const commitNote = () => { const pid = panel && panel.id; if (pid) logNote(pid, notein.value); else { panel = null; render(); } };
        notein.addEventListener("keydown", (e) => { if (e.key === "Enter") commitNote(); else if (e.key === "Escape") { panel = null; render(); } });
        const ng = el.querySelector(".tk-notego"); if (ng) ng.addEventListener("click", commitNote);
      }
      const u = el.querySelector(".tk-undo-go"); if (u) u.addEventListener("click", doUndo);
    }
    function toggle(id) {
      const all = loadThings(), t = all.find((x) => x && x.id === id); if (!t) return;
      if (isHabit(t) || t.routine) {
        // habits AND routine members RECUR → "done" is LOG-DERIVED per day (§3), never an object
        // flag. Toggle the VIEWED day only, so completion travels with the DAY (date-nav).
        const done = thingDoneOn(loadLog(), id, viewDay());
        try { logThingEvent(id, done ? "undone" : "done", { items: all, ts: viewDay() }); } catch (e) {}
        if (!done) { try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Habit done · +2 EXP"); } catch (e) {} }
      } else {
        // a one-off task/subtask's done state is a flag ON the object; the log event feeds the
        // trail — root defaults to the TOP-level task, so a subtask's completion still shows there.
        const now = Date.now(), next = t.done ? 0 : 1;
        save([Object.assign({}, t, { done: next, doneAt: next ? now : null, updated: now })]);
        try { logThingEvent(id, next ? "done" : "undone", { items: all, ts: viewDay() }); } catch (e) {}
        if (next) { try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Task done · +2 EXP"); } catch (e) {} }
      }
      undo = null; render();
    }
    function logAmount(id, qty) {   // an amount habit's day value = the LATEST entry for the VIEWED day (never summed, §4)
      if (!(qty >= 0)) { panel = null; render(); return; }
      try { logThingEvent(id, "habit", { items: loadThings(), value: { done: 1, qty: qty }, ts: viewDay() }); } catch (e) {}
      try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Habit logged · +2 EXP"); } catch (e) {}
      panel = null; render();
    }
    function logScale(id, n) {   // a rating habit: 1–5, latest per day wins; tapping today's rating again clears it
      if (!(n >= 1 && n <= 5)) { panel = null; render(); return; }
      const cur = thingAmountOn(loadLog(), id, viewDay());
      if (cur && +cur.rating === n) { try { logThingEvent(id, "undone", { items: loadThings(), ts: viewDay() }); } catch (e) {} }
      else {
        try { logThingEvent(id, "habit", { items: loadThings(), value: { done: 1, rating: n }, ts: viewDay() }); } catch (e) {}
        try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Habit logged · +2 EXP"); } catch (e) {}
      }
      panel = null; render();
    }
    function logNote(id, text) {   // a text habit: a few words for the day (latest wins); clearing the text un-logs the day
      const v = (text || "").trim().slice(0, 200);
      if (!v) {
        if (thingDoneOn(loadLog(), id, viewDay())) { try { logThingEvent(id, "undone", { items: loadThings(), ts: viewDay() }); } catch (e) {} }
        panel = null; render(); return;
      }
      try { logThingEvent(id, "habit", { items: loadThings(), value: { done: 1, text: v }, ts: viewDay() }); } catch (e) {}
      try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Habit logged · +2 EXP"); } catch (e) {}
      panel = null; render();
    }
    function del(id) {
      const all = loadThings(), t = all.find((x) => x && x.id === id);
      const liveBefore = {}; all.forEach((x) => { if (x && !x.deleted) liveBefore[x.id] = 1; });
      const now = Date.now();
      // cascade: tombstone the item AND every descendant (§5) so nothing can resurrect/orphan
      const killed = thingsCascadeDelete(all, id, now).filter((x) => x && x.deleted && liveBefore[x.id]);
      save(killed);
      const extra = killed.length - 1;
      undo = { ids: killed.map((x) => x.id), at: now, label: (t && t.title ? "“" + clip(t.title, 20) + "”" : "item") + (extra > 0 ? " + " + extra + " subtask" + (extra > 1 ? "s" : "") : "") };
      panel = null; render();
    }
    function doUndo() {
      if (!undo) return;
      const all = loadThings();
      const now = Math.max(Date.now(), undo.at + 1);   // strictly newer than the delete stamp, or an exact tie lets the tombstone win
      save(all.filter((x) => x && undo.ids.indexOf(x.id) !== -1).map((x) => Object.assign({}, x, { deleted: 0, updated: now })));
      undo = null; render();
    }
    // The Asana-style ACTIVITY TRAIL (§4) — every completion/uncheck for a task AND its whole
    // subtree, newest first. Reconstructed from the LOG alone (each event carries a denormalized
    // `root`), so a deleted interior subtask can't sever it; titles resolve from the Things
    // (tombstones keep their title), so a deleted subtask's events still read clearly.
    function openTrail(id) {
      const all = loadThings(), log = loadLog(), byId = {};
      all.forEach((t) => { if (t && t.id) byId[t.id] = t; });
      const rootId = typeof thingRoot === "function" ? thingRoot(all, id) : id, root = byId[rootId];
      const trail = (typeof thingTrail === "function" ? thingTrail(log, rootId) : []).slice().reverse();   // newest first
      const now = Date.now();
      const label = (e) => {
        const it = byId[e.itemId], name = it ? "“" + esc(it.title) + "”" : "an item", self = e.itemId === rootId;
        if (e.kind === "done") return "<b>✓</b> completed " + (self ? "this task" : name);
        if (e.kind === "undone") return "<b>↩</b> un-checked " + (self ? "this task" : name);
        if (e.kind === "habit") { const v = e.value || {}; return "<b>◆</b> logged " + name + (v.qty != null ? " · " + esc(String(v.qty)) : v.rating != null ? " · " + esc(String(v.rating)) + "/5" : v.text ? " · “" + esc(String(v.text).slice(0, 24)) + "”" : ""); }
        return esc(e.kind) + " " + name;
      };
      const body = trail.length
        ? trail.map((e) => '<div class="tkt-row"><span class="tkt-what">' + label(e) + '</span><span class="tkt-when">' + esc(ageStr(now - (+e.at || 0))) + "</span></div>").join("")
        : '<div class="tkt-empty">No activity yet — check this off (or one of its subtasks) and it shows up here.</div>';
      closeCategorizer();
      const back = document.createElement("div"); back.className = "cat-backdrop"; back.id = "catBackdrop";
      back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
      const modal = document.createElement("div"); modal.className = "cat-modal tkt-modal";
      modal.innerHTML =
        '<div class="cat-head"><span>🕘 ' + (root ? esc(root.title) : "Activity") + '</span><button class="cat-close" aria-label="Close">✕</button></div>' +
        '<div class="tkt-body">' + body + "</div>";
      document.body.appendChild(back); document.body.appendChild(modal);
      modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
    }
    function onThings() {
      if (!el.isConnected) { document.removeEventListener("cache:things", onThings); return; }
      if (selfSaving) return;   // our own save already re-rendered
      const a = document.activeElement;
      if (a && (a.classList.contains("tk-in") || a.classList.contains("tk-subin") || a.classList.contains("tk-amtin") || a.classList.contains("tk-notein"))) return;   // a peer's sync landed — repaint, but never clobber mid-type
      render();
    }
    document.addEventListener("cache:things", onThings);
    function onDeckDay() { if (!el.isConnected) { document.removeEventListener("cache:deckday", onDeckDay); return; } if (el.closest(".deck-space")) render(); }   // date-nav: repaint for the newly-selected day (deck only)
    document.addEventListener("cache:deckday", onDeckDay);
    render();
  },
  safe(el) {
    // Safe-to-spend + a clean forecast: balance projected forward at your
    // average daily spend, with the date you hit your safety floor.
    el.classList.add("is-forecast");
    el.innerHTML =
      '<div class="fc-head">' +
        '<div class="fc-label">safe to spend</div>' +
        '<div class="big">…</div>' +
        '<div class="fc-sub"></div>' +
      '</div>' +
      '<div class="fc-chart"><svg viewBox="0 0 300 110" preserveAspectRatio="xMidYMid meet">' +
        '<defs><linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#c9542e" stop-opacity="0.16"/>' +
          '<stop offset="100%" stop-color="#c9542e" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path class="fc-area" fill="url(#fcGrad)" d="" />' +
        '<line class="fc-floor" x1="6" x2="294" stroke="rgba(28,26,18,0.22)" stroke-width="1" stroke-dasharray="3 4" />' +
        '<path class="fc-line" fill="none" stroke="#1c1a12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="" />' +
        '<circle class="fc-dot" r="3.5" fill="#c9542e" style="display:none" />' +
      '</svg></div>' +
      '<div class="fc-meta"><span class="fc-runway"></span><button class="safe-reserve"></button></div>';

    const big = el.querySelector(".big");
    const sub = el.querySelector(".fc-sub");
    const area = el.querySelector(".fc-area");
    const line = el.querySelector(".fc-line");
    const floor = el.querySelector(".fc-floor");
    const dot = el.querySelector(".fc-dot");
    const runwayEl = el.querySelector(".fc-runway");
    const resBtn = el.querySelector(".safe-reserve");
    let data = null;
    const r1 = (n) => Math.round(n * 10) / 10;
    const reserve = () => parseFloat(localStorage.getItem(RESERVE_KEY) || "0") || 0;

    function draw() {
      const W = 300, H = 110, padL = 6, padR = 6, padT = 10, padB = 12;
      const cash = data.cash != null ? data.cash : (data.total || 0);
      const res = reserve();
      const burn = data.burn_per_day || 0;
      const safe = cash - res;

      big.textContent = fmtUSD(safe);
      big.style.color = safe <= 0 ? "#c9542e" : "var(--ink)";
      sub.textContent = burn > 0 ? fmtUSD(burn) + " / day avg spend" : "avg spend: not enough history yet";

      const top = Math.max(cash, res + 1);
      const span = Math.max(1, top - res);
      const yOf = (bal) => padT + (H - padT - padB) * (1 - (bal - res) / span);
      const floorY = yOf(res);
      floor.setAttribute("y1", r1(floorY));
      floor.setAttribute("y2", r1(floorY));
      resBtn.textContent = "keep safe: " + fmtUSD(res);

      if (burn <= 0 || safe <= 0) {
        const y = yOf(Math.max(cash, res));
        line.setAttribute("d", "M" + padL + " " + r1(y) + " L" + (W - padR) + " " + r1(y));
        area.setAttribute("d", "");
        dot.style.display = "none";
        runwayEl.textContent = safe <= 0 ? "you're over your safe line" : "need more spending history";
        return;
      }

      const runway = safe / burn; // days until you reach your safety floor
      const horizon = Math.min(180, Math.max(14, Math.ceil(runway * 1.4)));
      const xOf = (d) => padL + (W - padL - padR) * (d / horizon);
      const sx = xOf(0), sy = yOf(cash);
      const cx = xOf(runway), cy = floorY;

      line.setAttribute("d", "M" + r1(sx) + " " + r1(sy) + " L" + r1(cx) + " " + r1(cy));
      area.setAttribute("d",
        "M" + r1(sx) + " " + r1(sy) + " L" + r1(cx) + " " + r1(cy) + " L" + r1(sx) + " " + r1(floorY) + " Z");
      dot.style.display = "";
      dot.setAttribute("cx", r1(cx));
      dot.setAttribute("cy", r1(cy));

      const dry = new Date(Date.now() + runway * 86400000);
      runwayEl.textContent = Math.floor(runway) + " days left · til " +
        dry.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    resBtn.addEventListener("click", () => {
      const v = prompt("Keep how much untouchable (savings, rent)?", localStorage.getItem(RESERVE_KEY) || "0");
      if (v !== null) {
        localStorage.setItem(RESERVE_KEY, String(parseFloat(v.replace(/[^0-9.]/g, "")) || 0));
        if (data) draw();
      }
    });

    Store.subscribe(el, (d) => { data = d; draw(); });
  },
  breakdown(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">where it’s going</span><span class="bd-trend"></span></div>' +
        '<div class="big bd-avg">…</div>' +
        '<div class="fc-sub bd-sub"></div>' +
      '</div>' +
      '<div class="bd-list"></div>' +
      '<button class="bd-fix" type="button">⚙ fix categories</button>';
    const avg = el.querySelector(".bd-avg");
    const trendEl = el.querySelector(".bd-trend");
    const sub = el.querySelector(".bd-sub");
    const list = el.querySelector(".bd-list");

    Store.subscribe(el, (d) => {
      const sp = d.spending;
      if (!sp || !sp.categories || !sp.categories.length) {
        avg.textContent = "—"; sub.textContent = "not enough spending history"; list.innerHTML = ""; return;
      }
      avg.textContent = fmtUSD(sp.per_month) + " /mo";
      sub.textContent = ((d.period && d.period.label) || "last " + sp.window_days + " days") +
        " · " + fmtUSD(sp.per_day) + "/day" +
        (sp.transfers ? " · excl " + fmtUSD(sp.transfers) + " transfers" : "");
      if (sp.trend_pct !== null && sp.trend_pct !== undefined) {
        const up = sp.trend_pct > 0;
        trendEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(sp.trend_pct) + "% vs prior";
        trendEl.style.color = up ? "#c9542e" : "#3f8f4e";
      } else { trendEl.textContent = ""; }
      const rows = sp.categories.slice(0, 7);
      const max = rows[0].amount || 1;
      list.innerHTML = rows.map((c) => {
        const m = catMeta(c.key);
        return '<div class="bd-row">' +
          '<span class="bd-cat">' + m.label + '</span>' +
          '<span class="bd-track"><span class="bd-fill" style="background:' + m.color + ';width:0"></span></span>' +
          '<span class="bd-amt">' + fmtUSD(c.amount) + '</span>' +
        '</div>';
      }).join("");
      const fills = list.querySelectorAll(".bd-fill");
      requestAnimationFrame(() =>
        fills.forEach((f, i) => { f.style.width = Math.max(4, (rows[i].amount / max) * 100) + "%"; }));
    });

    el.querySelector(".bd-fix").addEventListener("click", () => openCategorizer(() => Store.refresh()));
  },
  income(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">what makes money</span></div>' +
        '<div class="big bd-avg">…</div>' +
        '<div class="fc-sub bd-sub"></div>' +
      '</div>' +
      '<div class="bd-list"></div>' +
      '<button class="bd-fix" type="button">⚙ define income</button>';
    const avg = el.querySelector(".bd-avg");
    const sub = el.querySelector(".bd-sub");
    const list = el.querySelector(".bd-list");
    Store.subscribe(el, (d) => {
      const inc = d.income;
      if (!inc || !inc.sources || !inc.sources.length) {
        avg.textContent = "—"; sub.textContent = "nothing tagged as income yet";
        list.innerHTML = ""; return;
      }
      avg.textContent = fmtUSD(inc.per_month) + " /mo";
      sub.textContent = ((d.period && d.period.label) || "last " + inc.window_days + " days") +
        " · tag to refine";
      list.innerHTML = incomeBubbles(inc.sources, { limit: 8 });
      drawIcons();
      fitIncomeLabels(list);
      list.querySelectorAll(".inc-b").forEach((b) => {
        b.style.cursor = "pointer";
        b.addEventListener("click", () => openIncomeTagger(() => Store.refresh()));
        // inline edit: click the ✓/dot pip to confirm-income or mark-not-income, no modal
        const pip = b.querySelector(".inc-status");
        if (pip) pip.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = pip.classList.contains("is-confirmed") ? "ignore" : "income";
          fetch("/api/income", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: b.dataset.key, status: next }),
          })
            .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
            .then(() => { flash(next === "income" ? "✓ confirmed as income" : "removed — not income"); Store.refresh(); })
            .catch(() => flash("backend stopped or out of date — restart start.command"));
        });
      });
    });
    el.querySelector(".bd-fix").addEventListener("click", () => openIncomeTagger(() => Store.refresh()));
  },
  plan(el) {
    el.classList.add("is-breakdown");
    const now0 = new Date();
    const moName = (off) => new Date(now0.getFullYear(), now0.getMonth() + off, 1)
      .toLocaleDateString("en-US", { month: "long" });
    el.innerHTML =
      '<div class="bd-head"><div class="bd-top"><span class="fc-label">budget</span>' +
        '<span class="bg-modes"><button class="bg-mode on" data-m="plan">plan</button>' +
          '<button class="bg-mode" data-m="build">build</button></span></div></div>' +
      '<div class="bg-view bg-plan">' +
        '<div class="pl-hero">' +
          '<div class="pl-hero-head"><span class="pl-pane-mo">' + moName(0) + '</span>' +
            '<span class="pl-pane-tag">this month</span></div>' +
          '<div class="big pl-big">…</div>' +
          '<div class="fc-sub pl-sub"></div>' +
          '<div class="pl-pool"></div>' +
          '<div class="bd-list pl-list"></div>' +
        '</div>' +
        '<button class="pl-next" type="button">' +
          '<span class="pl-next-dot"></span><span class="pl-next-mo">' + moName(1) + '</span>' +
          '<span class="pl-next-sum">…</span><span class="pl-next-caret">▾</span>' +
        '</button>' +
        '<div class="pl-next-body bd-list" hidden></div>' +
        '<div class="wn-say pl-say"></div>' +
      '</div>' +
      '<div class="bg-view bg-build" hidden></div>';
    const say = el.querySelector(".pl-say");
    const planView = el.querySelector(".bg-plan");
    const buildView = el.querySelector(".bg-build");
    const heroEl = el.querySelector(".pl-hero");
    const nextBtn = el.querySelector(".pl-next");
    const nextBody = el.querySelector(".pl-next-body");
    let mode = "plan";
    let nextOpen = localStorage.getItem("money.planNextOpen") === "1";

    function rowHtml(t, i, cut, drag) {
      const st = t.paid || t.pct >= 0.999 ? "met" : t.pct > 0 ? "part" : "unmet";
      const ic = st === "met" ? "✓" : st === "part" ? "⚠" : "✕";
      const est = t.kind === "est";
      const canDrag = drag && !est;
      let note;
      if (t.kind === "rent") note = t.paid ? "✓ paid " + t.dueStr : "due " + t.dueStr + " · " + Math.max(0, t.daysUntil) + "d";
      else if (t.kind === "bill") note = t.paid ? "✓ paid " + t.dueStr
        : (t.cadence && t.cadence !== "monthly" ? "set aside · " + fmtUSD(t.perCharge) + "/" + cadenceInfo(t.cadence).abbr : "~ monthly");
      else note = "estimate · from your spending";
      return '<div class="pl-tier ' + st + (t.paid ? " paid" : "") + (est ? " est" : "") + '"' +
          (canDrag ? ' draggable="true"' : "") + ' data-key="' + escapeHtml(t.key) + '" data-kind="' + t.kind + '">' +
        '<div class="pl-row">' +
          (canDrag ? '<span class="pl-grip" title="drag to reprioritize">⠿</span>' : '<span class="pl-grip ghost">·</span>') +
          '<span class="pl-ic">' + ic + '</span><span class="pl-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="pl-amt">' + fmtUSD(t.amt) + '</span></div>' +
        '<div class="pl-track"><span class="pl-fill" style="width:' + Math.min(100, Math.round(t.pct * 100)) + '%"></span></div>' +
        '<div class="pl-note">' + note + '</div>' +
        (i === cut ? '<div class="pl-cut">↑ money runs out here</div>' : '') +
      '</div>';
    }
    function listHtml(S, drag) {
      let html = "";
      if (!S.hasMustpays) html += '<div class="pl-empty">No must-pay bills picked yet.<br><button class="pl-pick-inline">Choose your bills →</button></div>';
      S.bills.forEach((t) => { html += rowHtml(t, S.tiers.indexOf(t), S.cut, drag); });
      if (S.estimates.length) {
        html += '<div class="pl-subhead">everyday spending · estimated</div>';
        S.estimates.forEach((t) => { html += rowHtml(t, S.tiers.indexOf(t), S.cut, drag); });
      }
      return html;
    }
    // THIS MONTH — the hero: big number + the full, editable waterfall
    function renderHero(d) {
      const big = heroEl.querySelector(".pl-big");
      const sub = heroEl.querySelector(".pl-sub");
      const poolEl = heroEl.querySelector(".pl-pool");
      const S = planSummary(d, 0);
      if (!S) { big.textContent = "…"; return null; }
      const { cash, income, rentBal, rentLabel, pool, totalShort, covered, leftover } = S;
      if (covered) {
        big.textContent = "✓ Covered"; big.style.color = "#3f8f4e";
        sub.innerHTML = "everything funded · " + fmtUSD(leftover) + " to spare";
      } else {
        big.textContent = fmtUSD(totalShort) + " to earn"; big.style.color = "#c9542e";
        sub.innerHTML = "≈ <b>" + S.hrs + " hrs</b> of gig work";
      }
      poolEl.innerHTML = rentBal !== null
        ? "Rent ← <b>" + escapeHtml(rentLabel) + " " + fmtUSD(rentBal) + "</b> · rest ← <b>" + fmtUSD(pool) + "</b>"
        : "Reliable: <b>" + fmtUSD(cash + income) + "</b> (" + fmtUSD(cash) + " cash + " + fmtUSD(income) + "/mo)";
      heroEl.querySelector(".pl-list").innerHTML = listHtml(S, true);
      return S;
    }
    // NEXT MONTH — a compact peek; expand for the full list
    function renderNext(d) {
      const S = planSummary(d, 1);
      const dot = nextBtn.querySelector(".pl-next-dot");
      const sum = nextBtn.querySelector(".pl-next-sum");
      if (!S) { sum.textContent = "…"; return null; }
      if (S.covered) { sum.innerHTML = "✓ covered"; dot.style.background = "#3f8f4e"; }
      else { sum.innerHTML = "<b>" + fmtUSD(S.totalShort) + "</b> to earn · " + S.hrs + " hrs"; dot.style.background = "#c9542e"; }
      nextBtn.classList.toggle("open", nextOpen);
      nextBody.hidden = !nextOpen;
      nextBody.innerHTML = nextOpen ? listHtml(S, false) : "";
      return S;
    }
    function render(d) {
      if (!d || !d.spending) { heroEl.querySelector(".pl-big").textContent = "…"; say.textContent = ""; return; }
      const a = renderHero(d);
      const next = renderNext(d);
      const igMissing = !(parseFloat(localStorage.getItem("money.guaranteedIncome")) > 0);
      if (!a) { say.textContent = ""; return; }
      say.textContent = !a.hasMustpays
        ? "Hit ‘build’ up top to set your income and star your must-pay bills — they’re pulled from your bank with exact amounts, so the plan stays accurate. Everyday spending below is estimated from your history."
        : a.covered
        ? "This month is fully funded — any gig work you do is pure cushion." +
          (next && !next.covered ? " Next month needs about " + next.hrs + " hours to stay ahead." : "")
        : "This month you're " + fmtUSD(a.totalShort) + " short — about " + a.hrs +
          " hours of gig work, anything beyond that you keep." +
          (next && next.totalShort > a.totalShort ? " Next month climbs to " + fmtUSD(next.totalShort) + "." : "") +
          (igMissing ? " ⚠ Set your Guaranteed income in Settings or this uses your (variable) recent income." : "");
    }
    nextBtn.addEventListener("click", () => {
      nextOpen = !nextOpen;
      localStorage.setItem("money.planNextOpen", nextOpen ? "1" : "0");
      if (Store.data) renderNext(Store.data);
    });
    // ── BUILD mode: every budget input lives here (income, rent, rate, bills) ──
    function renderBuild(d) {
      // A field commit (change → Store.emit) — or any other widget's emit — lands
      // back here synchronously; rebuilding innerHTML mid-edit wipes in-progress
      // typing and drops focus. Skip while the user is IN the form; the build view
      // shows only inputs (no computed numbers), so a skipped repaint is never stale.
      if (buildView.contains(document.activeElement)) return;
      const v = (k) => { const x = localStorage.getItem(k); return x === null ? "" : x; };
      const rent = getRent();
      const accts = (d && d.accounts) || [];
      const curAcct = localStorage.getItem("money.rentAccount") || "";
      // must-pays are DEFINED in the Money Map; build mode just shows them read-only
      const mustpays = (Store.recurring || []).filter((r) => isSubCore(r.key) && !isSubPaused(r.key))
        .sort((a, b) => b.amount - a.amount);
      const mpList = mustpays.length
        ? mustpays.map((r) => '<div class="bg-mp"><span class="bg-mp-name">' + escapeHtml(r.name) + "</span>" +
            '<span class="bg-mp-amt">' + fmtUSD(r.amount) + "</span></div>").join("")
        : '<div class="bg-hint">None yet — open the Money Map and star the bills you have to pay.</div>';
      buildView.innerHTML =
        '<div class="bg-build-scroll">' +
          '<div class="bg-sec">Reliable income</div>' +
          '<label class="bg-field"><span>Guaranteed /mo</span><input class="bg-guar" type="number" value="' + v("money.guaranteedIncome") + '" placeholder="your dependable base"></label>' +
          '<div class="bg-hint">music, retainers, base pay — what you can count on. <b>Not</b> gig / variable side work.</div>' +
          '<div class="bg-sec">Rent</div>' +
          '<label class="bg-field"><span>Amount</span><input class="bg-rentamt" type="number" value="' + (rent.amount || "") + '" placeholder="e.g. 1388"></label>' +
          '<label class="bg-field"><span>Due day</span><input class="bg-rentday" type="number" min="1" max="31" value="' + (rent.day || "") + '" placeholder="1"></label>' +
          '<label class="bg-field"><span>Paid from</span><select class="bg-rentacct">' +
            '<option value="">total cash (all accounts)</option>' +
            accts.map((a) => '<option value="' + escapeHtml(a.name) + '"' + (a.name === curAcct ? " selected" : "") + ">" + escapeHtml(a.name) + "</option>").join("") +
          '</select></label>' +
          '<div class="bg-sec">Side-gig rate</div>' +
          '<label class="bg-field"><span>$ / hr after gas</span><input class="bg-rate" type="number" value="' + v("money.rate") + '" placeholder="25"></label>' +
          '<div class="bg-hint">turns your shortfall into gig hours.</div>' +
          '<div class="bg-sec">Must-pay bills <span class="bg-sec-note">defined in your Money Map</span></div>' +
          '<div class="bg-mustpays">' + mpList + "</div>" +
          '<button class="bg-open-map" type="button">⊞ Open Money Map to choose bills →</button>' +
        "</div>";
      const num = (sel, key) => buildView.querySelector(sel).addEventListener("change", (e) => {
        const val = (e.target.value || "").trim();
        if (val === "") localStorage.removeItem(key);
        else localStorage.setItem(key, String(parseFloat(val.replace(/[^0-9.]/g, "")) || 0));
        Store.emit();
      });
      num(".bg-guar", "money.guaranteedIncome");
      num(".bg-rate", "money.rate");
      const saveRent = () => {
        const amount = parseFloat((buildView.querySelector(".bg-rentamt").value || "").replace(/[^0-9.]/g, "")) || 0;
        const day = Math.max(1, Math.min(31, parseInt(buildView.querySelector(".bg-rentday").value, 10) || 1));
        localStorage.setItem("money.rent", JSON.stringify({ amount, day }));
        Store.emit();
      };
      buildView.querySelector(".bg-rentamt").addEventListener("change", saveRent);
      buildView.querySelector(".bg-rentday").addEventListener("change", saveRent);
      buildView.querySelector(".bg-rentacct").addEventListener("change", (e) => {
        localStorage.setItem("money.rentAccount", e.target.value); Store.emit();
      });
      buildView.querySelector(".bg-open-map").addEventListener("click", () => {
        addSingleton("subscriptions");  // the Money Map — bring it up (or add it)
        if (nodes.subscriptions) springIn(nodes.subscriptions);
      });
    }
    function paint(d) {
      if (mode === "build") renderBuild(d); else render(d);
    }
    el.querySelectorAll(".bg-mode").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.m;
      el.querySelectorAll(".bg-mode").forEach((x) => x.classList.toggle("on", x.dataset.m === mode));
      planView.hidden = mode !== "plan";
      buildView.hidden = mode !== "build";
      if (Store.data) paint(Store.data);
    }));
    // the plan's empty-state button jumps straight to build mode
    el.addEventListener("click", (e) => {
      if (e.target.closest(".pl-pick-inline")) el.querySelector('.bg-mode[data-m="build"]').click();
    });
    // drag a bill in EITHER pane to reprioritize — order is shared, both re-pour. Estimates don't rank.
    let dragEl = null, dragList = null;
    el.addEventListener("dragstart", (e) => {
      const item = e.target.closest(".pl-tier");
      if (!item || item.classList.contains("est")) return;
      dragEl = item; dragList = item.closest(".pl-list");
      item.classList.add("pl-dragging");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragover", (e) => {
      if (!dragEl || !dragList || !dragList.contains(e.target)) return;
      e.preventDefault();
      const after = [...dragList.querySelectorAll('.pl-tier[draggable="true"]:not(.pl-dragging)')]
        .find((row) => { const r = row.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (after) dragList.insertBefore(dragEl, after); else dragList.appendChild(dragEl);
    });
    el.addEventListener("dragend", () => {
      if (!dragEl) return;
      dragEl.classList.remove("pl-dragging");
      const lst = dragList; dragEl = null; dragList = null;
      if (lst) setMustPayOrder([...lst.querySelectorAll('.pl-tier[data-kind="rent"], .pl-tier[data-kind="bill"]')].map((r) => r.dataset.key));
      Store.emit();  // re-pour the plan with the new priority order
    });
    Store.subscribe(el, (d) => paint(d));
  },
  whatsnext(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">what’s next</span></div>' +
        '<div class="big bd-avg wn-big">…</div>' +
        '<div class="fc-sub wn-sub"></div>' +
      '</div>' +
      '<div class="wn-deadline"></div>' +
      '<div class="bd-list wn-list"></div>' +
      '<div class="wn-say"></div>';
    const big = el.querySelector(".wn-big");
    const sub = el.querySelector(".wn-sub");
    const dl = el.querySelector(".wn-deadline");
    const list = el.querySelector(".wn-list");
    const say = el.querySelector(".wn-say");
    const row = (lbl, val, color) => '<div class="avg-row"><span class="avg-label">' + lbl + "</span>" +
      '<span class="avg-val"' + (color ? ' style="color:' + color + '"' : "") + ">" + val + "</span></div>";
    function render(d) {
      if (!d || !d.spending) { big.textContent = "…"; return; }
      const rent = getRent();
      const amount = parseFloat(rent.amount) || 0;
      const day = parseInt(rent.day, 10) || 0;
      if (!amount || !day) {
        big.textContent = "Set rent"; big.style.color = "var(--ink)";
        sub.textContent = "add it in Settings →"; dl.innerHTML = ""; list.innerHTML = "";
        say.textContent = "Tell me your rent amount and the day it's due (Settings → Rent), and I'll track whether you'll have it in time and what to earn before then.";
        return;
      }
      // next rent due date
      const now = new Date();
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let due = new Date(now.getFullYear(), now.getMonth(), day);
      if (due < today0) due = new Date(now.getFullYear(), now.getMonth() + 1, day);
      const daysUntil = Math.max(0, Math.round((due - today0) / 86400000));
      const dueStr = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const rate = parseFloat(localStorage.getItem("money.rate")) || 25;

      // if you keep rent in a specific account, just check that the money is sitting there
      const acctName = localStorage.getItem("money.rentAccount") || "";
      if (acctName) {
        const acct = (d.accounts || []).find((a) => a.name === acctName);
        const bal = acct ? (acct.balance || 0) : 0;
        const label = (typeof shortAcct === "function" ? shortAcct(acctName) : acctName);
        const shortA = Math.max(0, amount - bal);
        const hrsA = shortA > 0 ? Math.max(1, Math.round(shortA / rate)) : 0;
        if (shortA > 0) {
          big.textContent = "Need " + fmtUSD(shortA); big.style.color = "var(--ink)";
          sub.innerHTML = "more for rent · by " + dueStr;
        } else {
          big.textContent = "✓ Ready"; big.style.color = "#3f8f4e";
          sub.innerHTML = "rent's set aside in " + escapeHtml(label);
        }
        dl.innerHTML = "Rent <b>" + fmtUSD(amount) + "</b> due <b>" + dueStr + "</b> · " + daysUntil + " days";
        list.innerHTML =
          row(escapeHtml(label) + " has", fmtUSD(bal), bal >= amount ? "#3f8f4e" : "#c9542e") +
          row("Rent needed", fmtUSD(amount)) +
          row(shortA > 0 ? "Short" : "Cushion", fmtUSD(Math.abs(bal - amount)), shortA > 0 ? "#c9542e" : "#3f8f4e");
        say.textContent = shortA > 0
          ? "Your " + label + " has " + fmtUSD(bal) + " — that's " + fmtUSD(shortA) + " short of rent (" + fmtUSD(amount) +
            ") due " + dueStr + ". Move it in or earn it (~" + hrsA + " hrs) before the " + ordinal(day) + "."
          : "Your " + label + " has " + fmtUSD(bal) + " — rent (" + fmtUSD(amount) + ") is fully covered and ready. 🎉";
        return;
      }

      const need = monthlyNeed(d);
      const income = (d.income && d.income.per_month) || 0;
      const cash = d.cash || 0;
      const frac = daysUntil / 30.44;
      const otherCore = Math.max(0, need - amount);     // non-rent core, per month
      const spendBefore = otherCore * frac;             // other core you'll spend before rent
      const incomeBefore = income * frac;               // income you'd usually receive before rent
      const availForRent = cash + incomeBefore - spendBefore;
      const short = Math.max(0, amount - availForRent);
      const hours = short > 0 ? Math.max(1, Math.round(short / rate)) : 0;

      if (short > 0) {
        big.textContent = "Earn " + fmtUSD(short);
        big.style.color = "var(--ink)";
        sub.innerHTML = "for rent · ≈ <b>" + hours + " hrs</b> by " + dueStr;
      } else {
        big.textContent = "✓ On track";
        big.style.color = "#3f8f4e";
        sub.innerHTML = "you'll have rent by " + dueStr;
      }
      dl.innerHTML = "Rent <b>" + fmtUSD(amount) + "</b> due <b>" + dueStr + "</b> · " + daysUntil + " days";
      list.innerHTML =
        row("On hand now", fmtUSD(cash)) +
        row("Income expected by then", "+" + fmtUSD(incomeBefore), "#3f8f4e") +
        row("Other core before then", "−" + fmtUSD(spendBefore), "#c9542e") +
        row("Left for rent", fmtUSD(Math.round(availForRent)), availForRent >= amount ? "#3f8f4e" : "#c9542e");
      say.textContent = short > 0
        ? "You're on track to be about " + fmtUSD(short) + " short for rent by the " + ordinal(day) +
          ". That's roughly " + hours + " hours of work — get it in before " + dueStr + "."
        : "You're on track to have rent (" + fmtUSD(amount) + ") covered by " + dueStr + ". 🎉";
    }
    Store.subscribe(el, (d) => render(d));
  },
  gap(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">the gap</span></div>' +
        '<div class="big bd-avg">…</div>' +
        '<div class="fc-sub gap-sub"></div>' +
      '</div>' +
      '<div class="inc-strip"></div>' +
      '<div class="bd-list"></div>' +
      '<button class="bd-fix gap-need" type="button"></button>';
    const num = el.querySelector(".bd-avg");
    const sub = el.querySelector(".gap-sub");
    const strip = el.querySelector(".inc-strip");
    const bars = el.querySelector(".bd-list");
    const needBtn = el.querySelector(".gap-need");
    const NEED_KEY = "money.need";
    let data = null;

    function needOf(spend) {
      const s = localStorage.getItem(NEED_KEY);
      return s !== null ? (parseFloat(s) || 0) : Math.round(spend);
    }
    function row(label, val, color, max) {
      return '<div class="bd-row"><span class="bd-cat">' + label +
        '</span><span class="bd-track"><span class="bd-fill" style="background:' + color +
        ';width:0" data-w="' + Math.max(4, (val / max) * 100) + '"></span></span>' +
        '<span class="bd-amt">' + fmtUSD(val) + '</span></div>';
    }
    function render() {
      const income = guaranteedIncome(data);  // reliable base, not variable gig work
      const need = monthlyNeed(data);
      const g = need - income;
      num.textContent = fmtUSD(Math.abs(g));
      num.style.color = g > 0 ? "#c9542e" : "#3f8f4e";
      sub.textContent = g > 0 ? "to make per month to break even" : "you're ahead each month 🎉";
      const max = Math.max(income, need, 1);
      strip.innerHTML = incomeBubbles((data.income && data.income.sources) || [],
        { compact: true, min: 24, max: 34, limit: 6 });
      drawIcons();
      fitIncomeLabels(strip);
      bars.innerHTML = row("Make", income, "#3f8f4e", max) + row("Need", need, "#c9542e", max);
      const fills = bars.querySelectorAll(".bd-fill");
      requestAnimationFrame(() => fills.forEach((f) => { f.style.width = f.dataset.w + "%"; }));
      needBtn.textContent = "need: " + fmtUSD(need) + " /mo ✎";
    }
    needBtn.addEventListener("click", () => {
      const cur = localStorage.getItem(NEED_KEY) || String(monthlyNeed(data));
      const v = prompt("Override your monthly need? (blank uses your Core spend)", cur);
      if (v !== null) {
        localStorage.setItem(NEED_KEY, String(parseFloat(v.replace(/[^0-9.]/g, "")) || 0));
        Store.emit();  // need affects The Gap + Work planner → ripple
      }
    });
    Store.subscribe(el, (d) => { data = d; render(); });
  },
  work(el) {
    el.classList.add("is-forecast");
    el.innerHTML =
      '<div class="fc-head">' +
        '<div class="fc-label">work to close the gap</div>' +
        '<div class="big">…</div>' +
        '<div class="fc-sub work-sub"></div>' +
      '</div>' +
      '<div class="work-detail"></div>' +
      '<div class="work-when"></div>' +
      '<div class="fc-meta">' +
        '<a class="toggl-link" href="https://track.toggl.com/timer" target="_blank" rel="noopener" title="open Toggl">' +
          '<span class="toggl-mark"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#e9408f"/>' +
          '<path d="M12 7v5l3 2" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>toggl</a>' +
        '<button class="safe-reserve work-rate" type="button">rate ✎</button>' +
      '</div>';
    const big = el.querySelector(".big");
    const sub = el.querySelector(".work-sub");
    const detail = el.querySelector(".work-detail");
    const whenEl = el.querySelector(".work-when");
    const rateBtn = el.querySelector(".work-rate");
    const RATE_KEY = "money.rate", NEED_KEY = "money.need";
    let data = null;
    const rateOf = () => parseFloat(localStorage.getItem(RATE_KEY)) || 25;
    const needOf = (spend) => {
      const s = localStorage.getItem(NEED_KEY);
      return s !== null ? (parseFloat(s) || 0) : Math.round(spend);
    };
    function render() {
      const income = guaranteedIncome(data);  // reliable base, not variable gig work
      const gap = monthlyNeed(data) - income;
      const rate = rateOf();
      rateBtn.textContent = "rate: " + fmtUSD(rate) + "/hr ✎";
      whenEl.innerHTML = '<span class="work-when-label">next busy window</span><b>' + fmtBusy(nextBusyWindow()) + "</b>";
      if (gap <= 0) {
        big.textContent = "0h";
        big.style.color = "#3f8f4e";
        sub.textContent = "you're covered — no extra work needed 🎉";
        detail.innerHTML = "";
        return;
      }
      const hoursMo = gap / rate;
      const hoursWk = hoursMo / 4.33;
      big.textContent = Math.round(hoursWk) + "h / wk";
      big.style.color = "var(--ink)";
      sub.textContent = "≈ " + Math.round(hoursMo) + " hours this month";
      const shifts = Math.max(1, Math.round(hoursWk / 4));
      detail.innerHTML = "to make <b>" + fmtUSD(gap) + "</b> on gig work<br>" +
        "≈ " + shifts + " shift" + (shifts > 1 ? "s" : "") + " of ~" + Math.round(hoursWk / shifts) + "h a week";
    }
    rateBtn.addEventListener("click", () => {
      const v = prompt("Your gig $/hour (after gas/expenses)?", String(rateOf()));
      if (v !== null) {
        localStorage.setItem(RATE_KEY, String(parseFloat(v.replace(/[^0-9.]/g, "")) || 0));
        Store.emit();
      }
    });
    Store.subscribe(el, (d) => { data = d; render(); });
  },
  coreflex(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">core vs flex</span></div>' +
        '<div class="big bd-avg">…</div>' +
        '<div class="fc-sub cf-sub"></div>' +
      '</div>' +
      '<div class="bd-list cf-list"></div>';
    const big = el.querySelector(".bd-avg");
    const sub = el.querySelector(".cf-sub");
    const list = el.querySelector(".cf-list");
    let data = null;
    function render() {
      const sp = data && data.spending;
      if (!sp || !sp.categories || !sp.categories.length) {
        big.textContent = "—"; sub.textContent = "not enough spending history"; list.innerHTML = ""; return;
      }
      const w = sp.window_days || 30;
      const cats = sp.categories.filter((c) => c.key !== "transfer");
      let core = 0, flex = 0;
      cats.forEach((c) => { const m = c.amount / w * 30; if (isCore(c.key)) core += m; else flex += m; });
      big.textContent = fmtUSD(core) + " /mo";
      big.style.color = "var(--ink)";
      sub.innerHTML = "non-negotiable core · <b style=\"color:#c9542e\">" + fmtUSD(flex) + "</b> flex you could cut";
      list.innerHTML = cats.map((c) => {
        const meta = catMeta(c.key);
        const on = isCore(c.key);
        return '<div class="cf-row">' +
          '<span class="cf-cat">' + meta.label + '</span>' +
          '<span class="cf-amt">' + fmtUSD(c.amount / w * 30) + '</span>' +
          '<button class="cf-toggle ' + (on ? "is-core" : "is-flex") + '" data-key="' + c.key + '">' +
          (on ? "core" : "flex") + "</button></div>";
      }).join("");
      list.querySelectorAll(".cf-toggle").forEach((b) => {
        b.addEventListener("click", () => {
          setCore(b.dataset.key, !isCore(b.dataset.key));
          Store.emit();  // core/flex affects this widget + The Gap + Work → ripple
        });
      });
    }
    Store.subscribe(el, (d) => { data = d; render(); });
  },
  // Statistics widget — a spread of interesting real data facts from the whole
  // ledger. (Internal type id stays "averages" so existing saved layouts keep working.)
  averages(el) {
    el.classList.add("is-stats");
    el.innerHTML = '<div class="stats-grid"></div>';
    const grid = el.querySelector(".stats-grid");
    let rendered = false;   // once real numbers are up, a transient fetch failure must not erase them
    function load() {
      fetch("/api/statistics?t=" + Date.now()).then((r) => r.json()).then((d) => {
        rendered = true;
        if (!d || !d.stats || !d.stats.length) { grid.innerHTML = '<div class="stats-empty">no history yet · connect or import to see your stats</div>'; return; }
        grid.innerHTML = d.stats.map((s) =>
          '<div class="stat-tile"><div class="stat-tile-val' + (s.tone ? " t-" + s.tone : "") + '">' + escapeHtml(s.value) + "</div>" +
          '<div class="stat-tile-lbl">' + escapeHtml(s.label) + "</div></div>").join("");
      }).catch(() => { if (rendered) return; grid.innerHTML = '<div class="stats-empty">backend off — restart the server</div>'; });
    }
    Store.subscribe(el, () => load());
    load();
  },
  // Dev Tree — codebase build-status at a glance: roadmap progress + a scan of the
  // source for unfinished markers (TODO/FIXME/…), worst files first, so scaffolding
  // that never got finished is visible and you know what to circle back to.
  devtree(el) {
    el.classList.add("is-tree");
    el.innerHTML = '<div class="tree-head"><span class="fc-label">dev tree</span><span class="tree-sum">…</span></div><div class="tree-body"></div>';
    const sum = el.querySelector(".tree-sum"), body = el.querySelector(".tree-body");
    const esc = escapeHtml;
    const leaf = (cls, txt) => '<div class="tree-leaf ' + cls + '">' + esc(txt) + "</div>";
    function load() {
      fetch("/api/devtree?t=" + Date.now()).then((r) => r.json()).then((d) => {
        if (!d || !d.ok) { body.innerHTML = '<div class="tree-empty">no data</div>'; return; }
        const t = d.totals, rm = d.roadmap;
        sum.innerHTML = '<b class="tree-cnt-bad">' + t.bad + "</b> to fix · <b class=\"tree-cnt-todo\">" + t.todo + "</b> to-do";
        let h = "";
        // Roadmap branch
        h += '<details class="tree-grp" open><summary>🗺 Roadmap · ✓' + rm.shipped + " · ~" + rm.in_progress + " · ○" + rm.planned + "</summary>";
        if (rm.in_progress_items.length) { h += '<div class="tree-subhead">In progress (scaffolded)</div>'; h += rm.in_progress_items.map((x) => leaf("warn", "~ " + x)).join(""); }
        if (rm.planned_items.length) { h += '<div class="tree-subhead">Planned (not started)</div>'; h += rm.planned_items.map((x) => leaf("dim", "○ " + x)).join(""); }
        h += "</details>";
        // Code branch
        h += '<details class="tree-grp"' + (t.bad ? " open" : "") + '><summary>⚙ Code markers · ' + t.files_flagged + " files</summary>";
        if (!d.files.length) h += '<div class="tree-empty">no unfinished markers — clean ✨</div>';
        d.files.forEach((f) => {
          h += '<details class="tree-file"' + (f.bad ? " open" : "") + '><summary>' + esc(f.file) +
            (f.bad ? ' <span class="tree-cnt-bad">🔴' + f.bad + "</span>" : "") +
            (f.todo ? ' <span class="tree-cnt-todo">🟡' + f.todo + "</span>" : "") + "</summary>" +
            f.markers.map((m) => '<div class="tree-mk sev-' + m.sev + '"><span class="mk-line">:' + m.line + '</span> <span class="mk-kind">' + esc(m.kind) + "</span> " + esc(m.text) + "</div>").join("") +
            "</details>";
        });
        h += "</details>";
        body.innerHTML = h;
      }).catch(() => { body.innerHTML = '<div class="tree-empty">backend off — restart the server</div>'; });
    }
    load();
  },
  worklog(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">time worked</span>' +
          '<a class="toggl-link" href="https://track.toggl.com/timer" target="_blank" rel="noopener" title="open Toggl">' +
            '<span class="toggl-mark"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#e9408f"/>' +
            '<path d="M12 7v5l3 2" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a>' +
        '</div>' +
        '<div class="wk-spots">' +
          '<div class="wk-spot"><div class="wk-spot-num wk-hours">…</div><div class="wk-spot-lbl">worked</div></div>' +
          '<div class="wk-spot"><div class="wk-spot-num wk-earned">…</div><div class="wk-spot-lbl">earned</div></div>' +
        '</div>' +
        '<div class="fc-sub wk-sub"></div>' +
      '</div>' +
      '<div class="wk-running"></div>' +
      '<div class="bd-list wk-list"></div>';
    const hoursEl = el.querySelector(".wk-hours");
    const earnedEl = el.querySelector(".wk-earned");
    const sub = el.querySelector(".wk-sub");
    const list = el.querySelector(".wk-list");
    const runEl = el.querySelector(".wk-running");
    const r1 = (h) => (h || 0).toFixed(1) + "h";
    // shrink both spotlight numbers to the largest size that fits BOTH cards — so
    // the earned amount can never get cut off and the two stay the same size
    function fitSpots() {
      const spots = [hoursEl, earnedEl];
      if (!spots[0].clientWidth) return;
      let size = 32;
      spots.forEach((e) => (e.style.fontSize = size + "px"));
      let guard = 0;
      while (size > 13 && spots.some((e) => e.scrollWidth > e.clientWidth) && guard++ < 30) {
        size -= 1.5;
        spots.forEach((e) => (e.style.fontSize = size + "px"));
      }
    }
    let rendered = false;   // once a real server answer painted, a transient failure must not erase it
    function load() {
      fetch("/api/work?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).then((d) => {
        rendered = true;   // a 200-with-no-month is a real "no Toggl data yet" answer — counts
        if (!d || !d.month) { hoursEl.textContent = "—"; earnedEl.textContent = "—"; sub.textContent = "no Toggl data yet"; list.innerHTML = ""; runEl.innerHTML = ""; return; }
        const eff = (w) => (w.hours > 0 ? fmtUSD(w.earned / w.hours) + "/hr" : "—");
        hoursEl.textContent = r1(d.month.hours);
        earnedEl.textContent = fmtUSD(d.month.earned);
        requestAnimationFrame(fitSpots);
        sub.innerHTML = "this month · " + eff(d.month) + " effective";
        runEl.innerHTML = d.running
          ? '<div class="wk-run">⏱ running now · ' + r1(d.running.elapsed_hours) +
            (d.running.description ? " · " + escapeHtml(d.running.description) : "") + "</div>"
          : "";
        let html = "";  // month lives in the headline above; jump straight to projects
        const projs = pinSort(d.projects_month || [], "proj", (p) => p.name).slice(0, 8);
        if (projs.length) html += '<div class="wk-projh">this month by project</div>' +
          projs.map((p) => {
            const pin = isPinned("proj", p.name);
            return '<div class="avg-row wk-proj' + (pin ? " pinned" : "") + '">' +
              '<button class="pin-btn' + (pin ? " on" : "") + '" data-pin="' + escapeHtml(p.name) + '" title="pin to top">★</button>' +
              '<span class="avg-label">' + escapeHtml(p.name) + "</span>" +
              '<span class="avg-val">' + r1(p.hours) + "</span></div>";
          }).join("");
        list.innerHTML = html;
        list.querySelectorAll(".pin-btn").forEach((b) => b.addEventListener("click", () => { togglePin("proj", b.dataset.pin); load(); }));
        drawIcons();
      }).catch(() => { if (rendered) return; hoursEl.textContent = "—"; earnedEl.textContent = "—"; sub.textContent = "backend off — restart the server"; list.innerHTML = ""; runEl.innerHTML = ""; });
    }
    Store.subscribe(el, () => load());
    load();
  },
  subscriptions(el) {
    el.classList.add("is-breakdown");
    // MONEY MAP — the ONE place you define what every recurring thing is:
    // money IN (income vs ignore) and money OUT (must-pay bill, subscription).
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">money map</span><button class="sub-add" type="button" title="add a recurring bill by name">+ add</button></div>' +
        '<div class="fc-sub mm-sub">…</div>' +
      '</div>' +
      '<div class="mm-scroll">' +
        '<div class="mm-sec">money in <span class="mm-sec-note">which deposits count as income</span></div>' +
        '<div class="mm-in"></div>' +
        '<div class="mm-sec">money out · recurring <span class="mm-sec-note">mark your must-pays</span></div>' +
        '<div class="cf-list"></div>' +
      '</div>' +
      '<button class="bd-fix" type="button">⚙ fix categories</button>';
    const sub = el.querySelector(".mm-sub");
    const inEl = el.querySelector(".mm-in");
    const list = el.querySelector(".cf-list");
    let detected = [], deposits = [], projects = [], incomeLinks = {};
    let offline = false, seenStamp;   // the snapshot stamp (updated|rev) the four feeds were last pulled for
    function loadData() {
      const t = Date.now();
      // all four hit the same backend — fail together so a down backend reads as
      // OFFLINE, never as an authentic "$0 must-pay · no deposits" empty state
      Promise.all([
        fetch("/api/recurring?t=" + t).then((r) => r.json()),
        fetch("/api/deposits?t=" + t).then((r) => r.json()),
        fetch("/api/work?t=" + t).then((r) => r.json()),
        fetch("/api/income-links?t=" + t).then((r) => r.json()),
      ]).then(([rec, dep, work, lk]) => {
        offline = false;
        detected = rec.recurring || []; deposits = dep.deposits || [];
        projects = (work && work.projects_month) || []; incomeLinks = (lk && lk.links) || {};
        render();
      }).catch(() => { offline = true; render(); });   // keep any last good data on screen
    }
    function setIncomeLink(key, project) {
      const prev = incomeLinks[key];                       // for revert on failure
      if (project) incomeLinks[key] = project; else delete incomeLinks[key];
      render();                                            // optimistic
      // re-GET → merge ONLY this change → POST: the widget's local copy can be empty
      // (failed initial load) or stale (another device) — POSTing it wholesale would
      // silently erase every other link. Build the map from fresh server truth.
      fetch("/api/income-links?t=" + Date.now())
        .then((r) => { if (!r.ok) throw new Error("down"); return r.json(); })
        .then((lk) => {
          const links = (lk && lk.links) || {};
          if (project) links[key] = project; else delete links[key];
          return fetch("/api/income-links", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ links: links }) })
            .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
            .then((d) => {
              if (!d || d.ok === false) throw new Error((d && d.error) || "readonly");   // web mirror answers 200 {ok:false, error:"…"} — carry its message
              incomeLinks = links;   // adopt the merged map we actually saved
              render();
            });
        })
        .catch((e) => {
          if (prev !== undefined) incomeLinks[key] = prev; else delete incomeLinks[key];
          render();
          const m = e && e.message;
          flash(m && m !== "readonly" && m !== "down" && m !== "stale" ? m : "couldn't save — backend down?");
        });
    }
    function trackKey(key) {
      fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: key, category: "subscriptions" }) })
        .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
        .then(() => { flash("✓ now tracking as a subscription"); loadData(); Store.refresh(); })   // loadData: summary `updated` only moves on a bank sync, so our own edit must re-pull directly
        .catch(() => flash("couldn't save — backend down?"));
    }
    function untrackKey(key) {
      fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: key, category: "other" }) })
        .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
        .then(() => { flash("removed from subscriptions"); loadData(); Store.refresh(); })
        .catch(() => flash("couldn't save — backend down?"));
    }
    function setIncome(key, status) {
      fetch("/api/income", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: key, status: status }) })
        .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
        .then(() => { flash(status === "income" ? "✓ counts as income" : "ignored (not income)"); loadData(); Store.refresh(); })
        .catch(() => flash("couldn't save — backend down?"));
    }
    function render() {
      // backend unreachable and nothing cached → say so honestly; a fake
      // "no deposits seen yet" reads as "my carefully-tagged bills vanished"
      if (offline && !detected.length && !deposits.length) {
        sub.textContent = "backend offline";
        inEl.innerHTML = '<div class="mm-empty">can’t reach the backend — this fills in when it’s back</div>';
        list.innerHTML = "";
        return;
      }
      // ── money in ──
      const projHours = {}; projects.forEach((p) => { projHours[p.name] = p.hours; });
      const projNames = projects.map((p) => p.name);
      inEl.innerHTML = deposits.length
        ? deposits.map((r) => {
            const on = r.status === "income";
            const linked = incomeLinks[r.key] || "";
            const linkSel = on
              ? '<span class="mm-link-wrap"><select class="mm-link" data-key="' + escapeHtml(r.key) + '" title="link this income to the work that earns it">' +
                  '<option value="">— link work</option>' +
                  projNames.map((n) => '<option value="' + escapeHtml(n) + '"' + (n === linked ? " selected" : "") + ">" + escapeHtml(n) + "</option>").join("") +
                "</select></span>" +
                (linked && projHours[linked] != null ? '<span class="mm-hrs" title="hours on ' + escapeHtml(linked) + ' this month">' + (Math.round(projHours[linked] * 10) / 10) + "h</span>" : "")
              : "";
            return '<div class="cf-row mm-row">' +
              '<span class="mm-dir ' + (on ? "in" : "off") + '">' + (on ? "+" : "·") + "</span>" +
              '<span class="cf-cat" title="' + escapeHtml(r.source) + '">' + escapeHtml(r.source) + "</span>" +
              '<span class="cf-amt">' + fmtUSD(r.amount) + "</span>" +
              linkSel +
              '<button class="cf-toggle ' + (on ? "is-income" : "is-ignore") + '" data-key="' + escapeHtml(r.key) +
                '" data-on="' + (on ? 1 : 0) + '">' + (on ? "income" : "ignore") + "</button>" +
            "</div>";
          }).join("")
        : '<div class="mm-empty">no deposits seen yet</div>';
      inEl.querySelectorAll(".cf-toggle").forEach((b) => b.addEventListener("click", () =>
        setIncome(b.dataset.key, b.dataset.on === "1" ? "ignore" : "income")));
      inEl.querySelectorAll(".mm-link").forEach((s) => s.addEventListener("change", () => setIncomeLink(s.dataset.key, s.value)));

      // ── money out · recurring — ALL detected bills in one list, must-pays first.
      // You can mark ANY recurring charge must-pay; you don't have to call it a "subscription" first.
      const active = detected.filter((r) => !isSubPaused(r.key));
      const mustpay = active.filter((r) => isSubCore(r.key)).reduce((s, r) => s + monthlyAmount(r), 0);
      const incCount = deposits.filter((r) => r.status === "income").length;
      sub.innerHTML = "<b>" + fmtUSD(mustpay) + "</b>/mo must-pay · <b>" + incCount + "</b> income source" + (incCount === 1 ? "" : "s");
      const ordered = detected.slice().sort((a, b) =>
        (isSubCore(b.key) ? 1 : 0) - (isSubCore(a.key) ? 1 : 0) || b.amount - a.amount);
      list.innerHTML = pinSort(ordered, "sub", (r) => r.key).map((r) => {
        const on = isSubCore(r.key);
        const st = subState(r);
        const nm = subName(r);
        const pin = isPinned("sub", r.key);
        const ago = r.last ? Math.round(Date.now() / 1000 / 86400 - r.last / 86400) : null;
        const tip = st === "paused" ? "paused — click to reactivate"
          : st === "lapsed" ? "no charge in " + ago + "d — click to pause" : "active · last charge " + ago + "d ago";
        return '<div class="cf-row sub-row ' + st + (pin ? " pinned" : "") + '">' +
          '<button class="pin-btn' + (pin ? " on" : "") + '" data-pin="' + escapeHtml(r.key) + '" title="pin to top">★</button>' +
          '<button class="sub-pip ' + st + '" data-key="' + escapeHtml(r.key) + '" title="' + tip + '"></button>' +
          '<button class="cf-cat sub-name" data-key="' + escapeHtml(r.key) +
            '" title="' + escapeHtml(nm) + ' — rename">' + escapeHtml(nm) + "</button>" +
          (r.flag === "dropped" && st !== "paused"
            ? '<span class="mm-flag mm-flag-dropped" title="no charge in a while — dropped?">stopped</span>'
            : r.flag === "changed" ? '<span class="mm-flag mm-flag-changed" title="latest charge $' + fmtUSD(r.recent) + ' differs from the usual $' + fmtUSD(r.amount) + '">changed</span>'
            : r.flag === "new" ? '<span class="mm-flag mm-flag-new" title="first seen recently">new</span>' : "") +
          '<span class="cf-amt"' + (subCadence(r.key) !== "monthly" ? ' title="≈ ' + fmtUSD(monthlyAmount(r)) + '/mo"' : "") + ">" + fmtUSD(r.amount) + "</span>" +
          '<span class="cf-cad-wrap"><select class="cf-cad" data-key="' + escapeHtml(r.key) + '" title="how often this charges">' +
            CADENCES.map((c) => '<option value="' + c.id + '"' + (c.id === subCadence(r.key) ? " selected" : "") + ">" + c.abbr + "</option>").join("") +
          "</select></span>" +
          '<button class="cf-toggle ' + (on ? "is-core" : "is-flex") + '" data-key="' + escapeHtml(r.key) +
            '" title="' + (on ? "a must-pay bill — funds your budget first" : "optional — click to mark must-pay") + '">' +
          (on ? "must-pay" : "optional") + "</button>" +
          (r.tagged ? '<button class="sub-x" data-key="' + escapeHtml(r.key) + '" title="remove from tracked subscriptions">×</button>' : '<span class="sub-x sub-x-empty"></span>') +
        "</div>";
      }).join("");
      list.querySelectorAll(".pin-btn").forEach((b) => b.addEventListener("click", () => {
        togglePin("sub", b.dataset.pin); Store.emit();
      }));
      list.querySelectorAll(".sub-pip").forEach((b) => b.addEventListener("click", () => {
        setSubPaused(b.dataset.key, !isSubPaused(b.dataset.key)); Store.emit();
      }));
      list.querySelectorAll(".cf-toggle").forEach((b) => b.addEventListener("click", () => {
        setSubCore(b.dataset.key, !isSubCore(b.dataset.key));
        Store.emit();  // must-pays feed the Budget + Gap → ripple
      }));
      list.querySelectorAll(".sub-x").forEach((b) => b.addEventListener("click", () => {
        if (confirm("Remove this from tracked subscriptions? (it stays detected, just untagged)")) untrackKey(b.dataset.key);
      }));
      list.querySelectorAll(".cf-cad").forEach((s) => s.addEventListener("change", () => {
        setSubCadence(s.dataset.key, s.value);
        Store.emit();  // cadence ripples to the must-pay total + Budget
      }));
      list.querySelectorAll(".sub-name").forEach((b) => b.addEventListener("click", () =>
        openSubDetail(detected.find((x) => x.key === b.dataset.key), () => Store.emit())));
    }
    Store.subscribe(el, (d) => {
      const s = dataStamp(d);
      if (seenStamp === undefined && !offline) { seenStamp = s; render(); return; }  // boot ripple — creation loadData already pulled
      // rev moved → server data changed (a tag from ANY widget or another device, a
      // delete, an import, a sync) → re-pull the four feeds. Our own controls also
      // loadData() directly, so one redundant re-pull after our own edit is the price
      // of staying correct even when the summary refresh itself fails. No loop: a
      // re-pull is read-only and never bumps rev.
      if (offline || s !== seenStamp) { seenStamp = s; loadData(); }
      else render();  // local-only ripple (pin / pause / must-pay / cadence) → cheap repaint
    });
    el.querySelector(".bd-fix").addEventListener("click", () => openCategorizer(() => Store.refresh()));
    el.querySelector(".sub-add").addEventListener("click", () => {
      const v = prompt("Add a recurring bill — type the merchant as it reads on your statement (e.g. netflix, spotify). It links to any transaction containing that text.");
      if (v && v.trim()) trackKey(v.trim().toLowerCase());
    });
    loadData();
  },
  months(el) {
    el.classList.add("is-breakdown", "is-months");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">months</span></div>' +
        '<div class="fc-sub mo-sub">…</div>' +
      '</div>' +
      '<div class="bd-list mo-list"></div>';
    const sub = el.querySelector(".mo-sub");
    const list = el.querySelector(".mo-list");
    let rendered = false;   // months on screen — a transient failure must not wipe them
    // the expansion body, factored so a rebuild can re-open the months the user had open
    function openDetail(row, m) {
      const det = row.querySelector(".mo-detail");
      const cmax = (m.categories[0] && m.categories[0].amount) || 1;
      det.innerHTML = m.categories.slice(0, 6).map((c) => {
        const meta = catMeta(c.key);
        return '<div class="mo-cat"><span class="mo-cat-name">' + meta.label + "</span>" +
          '<span class="mo-cat-track"><span class="mo-cat-fill" style="width:' +
            Math.max(3, c.amount / cmax * 100) + "%;background:" + meta.color + '"></span></span>' +
          '<span class="mo-cat-amt">' + fmtUSD(c.amount) + "</span></div>";
      }).join("") || '<div class="mo-empty">no categorized spending</div>';
      row.classList.add("open");
    }
    function loadMonths() {
    fetch("data/monthly.json?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then((d) => {
        const months = (d && d.months) || [];
        rendered = true;
        if (!months.length) { sub.textContent = "no history yet · run sync"; list.innerHTML = ""; return; }
        sub.textContent = months.length + " months · tap one for detail";
        // remember which months the user has open — a Store ripple from any widget
        // rebuilds this list, and snapping a breakdown shut mid-read is hostile
        const openYms = new Set(Array.from(list.querySelectorAll(".mo-row.open")).map((r) => r.dataset.ym));
        const maxFlow = months.reduce((mx, m) => Math.max(mx, m.income, m.spending), 1);
        list.innerHTML = months.map((m, i) => {
          const inW = Math.max(3, m.income / maxFlow * 100);
          const outW = Math.max(3, m.spending / maxFlow * 100);
          const src = m.imported === 0 ? "synced" : (m.live === 0 ? "imported" : "mixed");
          return '<div class="mo-row" data-i="' + i + '" data-ym="' + escapeHtml(m.ym || m.label) + '">' +
            '<div class="mo-top">' +
              '<span class="mo-label">' + escapeHtml(m.label) + "</span>" +
              '<span class="mo-net" style="color:' + (m.net >= 0 ? "#3f8f4e" : "#c9542e") + '">' +
                (m.net >= 0 ? "+" : "−") + fmtUSD(Math.abs(m.net)) + "</span>" +
            "</div>" +
            '<div class="mo-bar-row">' +
              '<span class="mo-tag mo-in-tag">in</span>' +
              '<span class="mo-track"><span class="mo-fill mo-in" style="width:' + inW + '%"></span></span>' +
              '<span class="mo-val">' + fmtUSD(m.income) + "</span>" +
            "</div>" +
            '<div class="mo-bar-row">' +
              '<span class="mo-tag mo-out-tag">out</span>' +
              '<span class="mo-track"><span class="mo-fill mo-out" style="width:' + outW + '%"></span></span>' +
              '<span class="mo-val">' + fmtUSD(m.spending) + "</span>" +
            "</div>" +
            '<div class="mo-src">' + m.count + " txns · " + src + "</div>" +
            '<div class="mo-detail"></div>' +
          "</div>";
        }).join("");
        list.querySelectorAll(".mo-row").forEach((row) => {
          const m = months[+row.dataset.i];
          row.querySelector(".mo-top").addEventListener("click", () => {
            const det = row.querySelector(".mo-detail");
            if (det.innerHTML) { det.innerHTML = ""; row.classList.remove("open"); return; }
            openDetail(row, m);
          });
          if (openYms.has(row.dataset.ym)) openDetail(row, m);   // restore what the user had open
        });
      })
      .catch((e) => {
        if (rendered) return;   // keep the good list — a blip must not erase it
        sub.textContent = (e && e.message === "no file") ? "no data · run sync" : "backend off — restart the server";
        list.innerHTML = "";
      });
    }
    Store.subscribe(el, loadMonths);  // re-pulls month rollups whenever data changes
  },
};

// ── In-app category editor (talks to the local backend) ────
function closeCategorizer(onDone) {
  const m = document.querySelector(".cat-modal");
  const b = document.getElementById("catBackdrop");
  if (m) m.remove();
  if (b) b.remove();
  if (typeof onDone === "function") onDone();
}
function catOptions(cur) {
  return allCatKeys()
    .map((k) => '<option value="' + k + '"' + (k === cur ? " selected" : "") + ">" + escapeHtml(catMeta(k).label) + "</option>")
    .join("") + '<option value="__new__">+ New category…</option>';
}

// ── Category Manager: list, rename (ledger-wide), delete→merge, one-off recategorize ──
function openCategoryManager() {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal cm-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Categories</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-hint">rename updates it everywhere · delete folds a category into another · click a category to fix its merchants one-by-one</div>' +
    '<div class="cm-list cat-list">loading…</div>' +
    '<button class="cm-new" type="button">+ new category</button>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  makeModalResizable(modal, "money.catMgr");
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
  const listEl = modal.querySelector(".cm-list");

  const opts = (cats, cur, exclude) => cats
    .filter((c) => c.key !== exclude)
    .map((c) => '<option value="' + c.key + '"' + (c.key === cur ? " selected" : "") + ">" + escapeHtml(c.label) + "</option>")
    .join("");

  function post(body) {
    return fetch("/api/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
      .then(() => { Store.refresh(); load(); })
      .catch(() => flash("couldn't save — backend down? click the server light to restart"));
  }

  function load() {
    fetch("/api/categories?t=" + Date.now()).then((r) => r.json()).then((d) => {
      const cats = d.categories || [];
      listEl.innerHTML = cats.map((c) =>
        '<div class="cm-cat" data-key="' + escapeHtml(c.key) + '">' +
          '<div class="cm-row">' +
            '<button class="cm-name" title="show merchants">' + escapeHtml(c.label) + "</button>" +
            '<span class="cm-count">' + c.count + "</span>" +
            '<button class="cm-act cm-rename" title="rename">✎</button>' +
            '<button class="cm-act cm-del" title="delete / merge">🗑</button>' +
          "</div><div class='cm-merch'></div></div>").join("") ||
        '<div class="cat-empty">no categories yet</div>';
      listEl.querySelectorAll(".cm-cat").forEach((row) => {
        const key = row.dataset.key;
        const cat = cats.find((c) => c.key === key);
        const drawer = row.querySelector(".cm-merch");
        const closeDrawer = () => { drawer.innerHTML = ""; drawer.classList.remove("open"); };
        row.querySelector(".cm-rename").addEventListener("click", () => {
          const v = prompt("Rename “" + cat.label + "” to:", cat.label);
          if (v && v.trim()) post({ action: "rename", key, label: v.trim() });
        });
        row.querySelector(".cm-del").addEventListener("click", () => {
          drawer.classList.add("open");
          drawer.innerHTML = '<div class="cm-delbar">move its <b>' + cat.count + "</b> transactions → " +
            '<select class="cm-delto">' + opts(cats, "other", key) + "</select>" +
            '<button class="cm-delgo">delete</button><button class="cm-x">cancel</button></div>';
          drawer.querySelector(".cm-delgo").addEventListener("click", () =>
            post({ action: "delete", key, to: drawer.querySelector(".cm-delto").value }));
          drawer.querySelector(".cm-x").addEventListener("click", closeDrawer);
        });
        row.querySelector(".cm-name").addEventListener("click", () => {
          if (drawer.classList.contains("open")) return closeDrawer();
          drawer.classList.add("open");
          drawer.innerHTML = cat.merchants.length
            ? cat.merchants.map((mk) =>
                '<div class="cm-m"><span class="cm-mname" title="' + escapeHtml(mk) + '">' + escapeHtml(mk) + "</span>" +
                '<select class="cm-mto" data-merch="' + escapeHtml(mk) + '">' + opts(cats, key) + "</select></div>").join("")
            : '<div class="cm-empty2">no merchants here</div>';
          drawer.querySelectorAll(".cm-mto").forEach((s) => s.addEventListener("change", (e) =>
            post({ action: "reassign", merchant: e.target.dataset.merch, to: e.target.value })));
        });
      });
    }).catch(() => { listEl.innerHTML = '<div class="cat-empty">backend down — restart and reopen</div>'; });
  }

  modal.querySelector(".cm-new").addEventListener("click", () => {
    const v = prompt("New category name:");
    if (v && v.trim()) post({ action: "create", label: v.trim() });
  });
  load();
}

// ── Profile + Settings ─────────────────────────────────────
function getProfile() { try { return JSON.parse(localStorage.getItem("money.profile") || "{}"); } catch (e) { return {}; } }
function getRent() { try { return JSON.parse(localStorage.getItem("money.rent") || "{}"); } catch (e) { return {}; } }
// priority order of your must-pays (keys; "__rent__" is rent). Drag in the plan to set it.
const MUSTPAY_ORDER_KEY = "money.mustpayOrder";
function mustPayOrder() {
  try { const o = JSON.parse(localStorage.getItem(MUSTPAY_ORDER_KEY) || "null"); return Array.isArray(o) ? o : []; }
  catch (e) { return []; }
}
function setMustPayOrder(o) { localStorage.setItem(MUSTPAY_ORDER_KEY, JSON.stringify(o)); }
// The ONE waterfall computation — both the Priority Plan widget and the top stats
// bar read from this so their numbers can never disagree.
//
// Must-pays are EXACT and bank-confirmed: rent (declared) + recurring bills you
// marked non-negotiable (isSubCore), with the bank's own amounts. Food / everything
// else are ESTIMATES from your category averages, ranked below the exact bills.
function planSummary(d, monthOffset) {
  monthOffset = monthOffset || 0;
  if (!d || !d.spending) return null;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const nextStart = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cash = d.cash || 0;
  const income = guaranteedIncome(d);

  // rent is earmarked — funded only from the account it lives in
  const rentAmt = parseFloat(getRent().amount) || 0;
  const dueDay = parseInt(getRent().day, 10) || 1;
  const rentAcctName = localStorage.getItem("money.rentAccount") || "";
  let rentBal = null, rentLabel = "";
  if (rentAcctName) {
    const acct = (d.accounts || []).find((a) => a.name === rentAcctName);
    rentBal = acct ? (acct.balance || 0) : 0;
    rentLabel = (typeof shortAcct === "function" ? shortAcct(rentAcctName) : rentAcctName);
  }

  // ── exact must-pays ──
  const bills = [];
  if (rentAmt > 0) {
    const rdue = new Date(now.getFullYear(), now.getMonth() + monthOffset, dueDay);
    const rdays = Math.round((rdue - today0) / 86400000);
    bills.push({ key: "__rent__", name: "Rent", amt: rentAmt, kind: "rent", earmark: true,
      paid: monthOffset === 0 && rdays < 0, daysUntil: rdays,
      dueStr: rdue.toLocaleDateString("en-US", { month: "short", day: "numeric" }) });
  }
  (Store.recurring || []).forEach((r) => {
    if (!isSubCore(r.key) || isSubPaused(r.key)) return;
    const lastD = r.last ? new Date(r.last * 1000) : null;
    const cad = subCadence(r.key);
    // only monthly bills get "paid this cycle"; non-monthly are funded as a steady set-aside
    const paid = cad === "monthly" && monthOffset === 0 && lastD && lastD >= monthStart && lastD < nextStart;
    bills.push({ key: r.key, name: r.name, amt: monthlyAmount(r), kind: "bill", paid: !!paid, cadence: cad,
      perCharge: r.amount || 0,
      dueStr: lastD ? lastD.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "" });
  });
  // rank by your saved order; unranked appended (rent floats to the top by default)
  const order = mustPayOrder();
  const rankOf = (b) => { const i = order.indexOf(b.key); return i < 0 ? (b.kind === "rent" ? -1 : 998) : i; };
  bills.sort((a, b) => rankOf(a) - rankOf(b));

  // ── estimated everyday spending (variable, from category averages) ──
  const FOOD = new Set(["groceries", "dining"]);
  const w = d.spending.window_days || 30;
  const mo = (a) => (a / w) * 30;
  let food = 0, flex = 0;
  (d.spending.categories || []).forEach((c) => {
    if (c.key === "transfer" || c.key === "housing" || c.key === "subscriptions") return;
    const m = mo(c.amount);
    if (FOOD.has(c.key)) food += m; else flex += m;
  });
  const estimates = [];
  if (food > 0.5) estimates.push({ key: "__food__", name: "Food", amt: food, kind: "est" });
  if (flex > 0.5) estimates.push({ key: "__flex__", name: "Everything else", amt: flex, kind: "est" });

  // ── pour the money in: rent from its account, the rest from cash + guaranteed income ──
  const pool = (rentBal !== null ? Math.max(0, cash - rentBal) : cash) + income;
  let rem = pool, cut = -1, totalShort = 0;
  const tiers = bills.concat(estimates);
  tiers.forEach((t, i) => {
    if (t.paid) { t.funded = t.amt; }
    else if (t.kind === "rent" && rentBal !== null) { t.funded = Math.min(t.amt, Math.max(0, rentBal)); }
    else { t.funded = Math.min(t.amt, Math.max(0, rem)); rem -= t.funded; if (cut < 0 && t.funded < t.amt - 0.5) cut = i; }
    t.pct = t.amt > 0 ? t.funded / t.amt : 1;
    if (!t.paid) totalShort += Math.max(0, t.amt - t.funded);
  });
  const rentTier = bills.find((b) => b.kind === "rent");
  const covered = totalShort < 0.5;
  const rate = parseFloat(localStorage.getItem("money.rate")) || 25;
  const leftover = rem + (rentBal !== null && rentTier ? Math.max(0, rentBal - rentTier.amt) : 0);
  return { bills, estimates, tiers, cash, income, rentBal, rentLabel, pool, cut, rentTier,
    totalShort, covered, rate, hrs: Math.max(1, Math.round(totalShort / rate)),
    leftover, hasMustpays: bills.length > 0 };
}
// guaranteed (reliable) monthly income — NOT variable side-gig. The plan funds from
// this so the shortfall shows how much gig/side work you actually need.
function guaranteedIncome(d) {
  const g = parseFloat(localStorage.getItem("money.guaranteedIncome"));
  if (g > 0) return g;
  return (d && d.income && d.income.per_month) || 0;  // fallback until you set it
}
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
// LEGACY writer — nothing calls this anymore: the Edit-profile surface writes
// name/role/note to money.profileCard (GENERIC, converges), and money.profile's
// stats ride saveStats. Kept so an in-flight branch calling it still works;
// if you're about to use it, you almost certainly want setProfileCard instead.
function setProfile(p) { localStorage.setItem("money.profile", JSON.stringify(p)); updateGreeting(); }
// Founder mode: a goofy compliment under the greeting, just for Cozy K Ace.
function isFounder() {
  if (localStorage.getItem("money.founder") === "1") return true;
  const n = (profileName() || "").toLowerCase().trim();   // card first, legacy money.profile fallback
  return ["cozy k ace", "cozy", "king cozy", "cozyace", "cozy ace"].includes(n);
}
const FOUNDER_COMPLIMENTS = [
  "your code slaps harder than your morning coffee ☕",
  "certified menace to bad UX 😼",
  "100% of caches surveyed agree: you're doing great ✨",
  "the dollar bills fear you 💸",
  "built different, debugging differenter 🛠",
  "your git history is basically poetry 📜",
  "the bugs file restraining orders against you 🐛🚫",
  "objectively too powerful for one menu pane ⚡",
  "you could ship a feature in your sleep (please sleep tho) 😴",
  "ssh… the widgets whisper your name",
  "founder, artist, and full-time legend — no notes 👑",
];
// Approved public jokes — shipped to everyone on the public build. Add to this
// repository to "approve" a new one; pushing it ships it to all members.
const PUBLIC_JOKES = [
  "your money is having a great hair day 💇",
  "the spreadsheets could never 📉",
  "budget so clean it squeaks ✨",
  "certified not-broke behavior 💪",
  "your cache, your rules 🗝️",
  "tracking like a hawk, spending like a saint 🦅",
  "future you says thanks 🙏",
  "tiny gains, big brain 🧠",
  "you vs. impulse buys — and you're winning 🥊",
  "your cache approves ✨",
];
function updateGreeting() {
  const g = document.getElementById("greeting");
  if (!g) return;
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = (profileName() || "").trim().replace(/\b\w/g, (m) => m.toUpperCase());
  if (!name) { g.textContent = ""; g.style.display = "none"; return; }
  let html = "Good " + part + ", " + escapeHtml(name) + ".";
  const set = isFounder() ? FOUNDER_COMPLIMENTS : PUBLIC_JOKES;
  html += '<span class="founder-compliment">' + escapeHtml(set[Math.floor(Math.random() * set.length)]) + "</span>";
  g.innerHTML = html;
  g.style.display = "";
}
// King Cozy console — founder/developer-only retro-futuristic dashboard of the build,
// by the numbers. (Idea: make this an unlockable achievement later — logged in BACKLOG.)
function openKingCozy() {
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal king-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const days = Math.max(1, Math.round((Date.now() - charSince()) / 86400000));
  const lv = cacheLevel(PROFILE_STATS.exp);
  const tile = (id, label) => '<div class="king-tile"><b id="' + id + '">…</b><span>' + label + "</span></div>";
  modal.innerHTML =
    '<div class="cat-head king-head"><span>👑 KING&nbsp;COZY // SYSTEM</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="king-body">' +
      '<div class="king-sub">founder &amp; developer console · member №1 · the build, by the numbers</div>' +
      '<div class="king-grid">' +
        tile("kc-shipped", "features shipped") +
        tile("kc-progress", "in progress") +
        tile("kc-planned", "planned") +
        tile("kc-fixes", "fixes logged") +
        tile("kc-stars", "stars") +
        tile("kc-forks", "forks") +
        tile("kc-downloads", "downloads") +
        '<div class="king-tile"><b>' + PROFILE_STATS.exp.toLocaleString() + "</b><span>project EXP</span></div>" +
        '<div class="king-tile"><b>' + days + "</b><span>days building</span></div>" +
      "</div>" +
      '<div class="king-sub" style="margin-top:18px">🔒 deeper · tucked away</div>' +
      '<div class="king-grid">' +
        '<div class="king-tile"><b>№1</b><span>founding member</span></div>' +
        '<div class="king-tile"><b>L' + lv.lvl + "</b><span>" + escapeHtml(lv.title) + "</span></div>" +
        '<div class="king-tile"><b>' + (PROFILE_STATS.clicks || 0).toLocaleString() + "</b><span>interactions</span></div>" +
        tile("kc-commits", "commits") +
        tile("kc-loc", "lines of code") +
        tile("kc-files", "files") +
        tile("kc-ledger", "txns tracked") +
        tile("kc-accounts", "accounts") +
        tile("kc-coverage", "days covered") +
      "</div>" +
      '<div class="king-sub" style="margin-top:18px">PostHog · live · last 7 days</div>' +
      '<div class="king-ph" id="kingPh"><span class="king-dim">connecting to PostHog…</span></div>' +
      '<div class="king-foot">live from the public repo · downloads track once you cut a Release</div>' +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
  const set = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = (n == null ? "—" : n.toLocaleString ? n.toLocaleString() : n); };
  fetch("https://raw.githubusercontent.com/cozykace/thecache/main/BACKLOG.md?t=" + Date.now())
    .then((r) => r.text()).then((md) => {
      set("kc-shipped", (md.match(/^- \[x\]/gim) || []).length);
      set("kc-progress", (md.match(/^- \[~\]/gim) || []).length);
      set("kc-planned", (md.match(/^- \[ \]/gim) || []).length);
      set("kc-fixes", (md.match(/\bfix(?:ed|es)?\b/gi) || []).length);
    }).catch(() => {});
  fetch("https://api.github.com/repos/cozykace/thecache")
    .then((r) => r.json()).then((d) => { set("kc-stars", d.stargazers_count); set("kc-forks", d.forks_count); })
    .catch(() => {});
  fetch("/api/downloads?t=" + Date.now()).then((r) => r.json()).then((d) => { if (d && d.ok) set("kc-downloads", d.downloads); }).catch(() => {});
  fetch("/api/king-stats?t=" + Date.now()).then((r) => r.json()).then((d) => {
    if (!d || !d.ok) return;
    set("kc-commits", d.commits); set("kc-loc", d.loc); set("kc-files", d.files);
    set("kc-ledger", d.ledger); set("kc-accounts", d.accounts); set("kc-coverage", d.coverage_days);
  }).catch(() => {});
  fetch("/api/posthog-stats?t=" + Date.now()).then((r) => r.json()).then((d) => {
    const ph = document.getElementById("kingPh"); if (!ph) return;
    if (!d || !d.ok) { ph.innerHTML = '<span class="king-dim">' + (d && d.error === "no key" ? "drop your PostHog Personal API key in <b>.posthog</b> to see live stats" : "PostHog not connected yet") + "</span>"; return; }
    ph.innerHTML = '<div class="king-phtop"><b>' + (d.total || 0).toLocaleString() + "</b> events · <b>" + (d.users || 0).toLocaleString() + "</b> people</div>" +
      ((d.events || []).map((e) => '<div class="king-phrow"><span>' + escapeHtml(e.event) + "</span><b>" + (e.count || 0).toLocaleString() + "</b></div>").join("") || '<span class="king-dim">no events yet — opt in + click around</span>');
  }).catch(() => {});
}

// ── Gamification: every click banks 1 EXP into your profile's stats ──
// The EXP ledger: each device banks the points it earns in its OWN slot
// (stats.expBy), and the character's total is the SUM of every slot. Merging is
// slot-wise max — safe in any order, offline included — so points earned on an
// accidental fresh start (or a plane) always AGGREGATE into the main bank,
// never erase or get erased. The device id never rides the sync bundle.
const DEVICE_KEY = "money.deviceId";
function devId() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = "d" + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch (e) { return "d0"; }
}
let PROFILE_STATS = (function () {
  const p = getProfile();
  const s = Object.assign({ exp: 0, clicks: 0 }, p.stats || {});
  s.dev = devId();
  if (!s.expBy || typeof s.expBy !== "object") s.expBy = {};
  if (!(s.dev in s.expBy)) {
    // first run on this device: claim whatever history isn't already banked in
    // other devices' slots (a pre-ledger profile claims its whole total once)
    const others = Object.keys(s.expBy).reduce((t, k) => t + (+s.expBy[k] || 0), 0);
    s.expBy[s.dev] = Math.max(0, (s.exp || 0) - others);
  }
  return s;
})();
let _statsTimer = null;
function saveStats() {
  // Storage-swap latch: once the live slot was swapped or cleared under this page (logout
  // park, account switch, parked restore, a vault-merge reload), the in-memory stats belong
  // to the PREVIOUS storage world — and this function is wired to pagehide/beforeunload, so
  // without the latch it would stomp the swap on the very reload those flows schedule
  // (writing the parked account's EXP back into the cleared slot, or a near-zero ledger over
  // a just-restored one). The latch dies with the page; the reload starts fresh.
  if (window.__cacheStorageSwapped) return;
  const p = getProfile();
  p.stats = PROFILE_STATS;
  try { localStorage.setItem("money.profile", JSON.stringify(p)); } catch (e) {}
  autoPushSoon();
}
// ── Your cache: it's named (yours), and it levels up as you do the work ──
// (one cache character for now; multi-cache + a combined profile character are
//  the north-star — see money vision. No shop: EXP auto-applies, the game is real life.)
function getCacheName() {
  try { const n = localStorage.getItem("money.cacheName"); if (n && n.trim()) return n.trim(); } catch (e) {}
  if (isFounder()) return "King Cozy Cache";  // the founder's cache — built + tested on his own life
  const nm = (profileName() || "").trim();
  return nm ? nm.replace(/\b\w/g, (m) => m.toUpperCase()) + "’s Cache" : "THE CACHE";
}
function setCacheName(n) {
  try { if (n && n.trim()) localStorage.setItem("money.cacheName", n.trim()); else localStorage.removeItem("money.cacheName"); } catch (e) {}
}
// the menu header shows the cache's name as text (free Google font); click to rename it
function renderBrand() {
  const b = document.getElementById("brandName");
  if (!b) return;
  b.textContent = getCacheName();
  // Renaming lives ONLY in the profile pane now (openProfile → #profCacheName). A title
  // that renames on a misclick is convenience that costs more than it gives, so the
  // menu-header brand name is a plain label — no pointer, no dialog.
}
const CACHE_TITLES = ["Newcomer", "Tracker", "Saver", "Planner", "Strategist", "Steward", "Tactician", "Architect", "Sage", "Legend"];
function cacheLevel(exp) {
  const base = 60, x = exp || 0;
  const lvl = Math.max(1, Math.floor(Math.sqrt(x / base)) + 1);
  const start = base * Math.pow(lvl - 1, 2), next = base * Math.pow(lvl, 2);
  const into = x - start, span = next - start;
  return {
    lvl, into, span, next, pct: span ? Math.max(0, Math.min(1, into / span)) : 0,
    title: CACHE_TITLES[Math.min(lvl - 1, CACHE_TITLES.length - 1)],
    emoji: lvl >= 9 ? "👑" : lvl >= 7 ? "💠" : lvl >= 5 ? "🗝️" : lvl >= 3 ? "🔑" : "🌱",
  };
}
let _charLevel = -1;
// ── Cache character ledger: an append-only log of feats/events (what + when), so
//    character-building is as rock-solid + auditable as the money ledger. ──
const CHARLOG_KEY = "money.charLog", CHARSINCE_KEY = "money.charSince";
function charLog() { try { return JSON.parse(localStorage.getItem(CHARLOG_KEY) || "[]"); } catch (e) { return []; } }
function charSince() {
  let s = localStorage.getItem(CHARSINCE_KEY);
  if (!s) { s = String(Date.now()); localStorage.setItem(CHARSINCE_KEY, s); }
  return +s;
}
function logChar(kind, detail, t) {
  // `t` optional: a DETERMINISTIC timestamp (e.g. the server's fixed-at time) makes the
  // entry's union key (t|k|d) identical on every device, so charLog dedupes it instead
  // of journaling the same feat once per device.
  const log = charLog();
  log.push({ k: kind, d: detail, t: t || Date.now() });
  try { localStorage.setItem(CHARLOG_KEY, JSON.stringify(log.slice(-800))); } catch (e) {}
}
function agoStr(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 172800) return "yesterday";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const CHAR_ICON = { level: "🎉", widget: "➕", sync: "🔌", feat: "⭐", note: "📌", bugfix: "🛠️" };
// Your activity, in its OWN window. It used to render inline in the profile, so a long
// history buried everything under it and you had to scroll past your whole life to reach
// account settings. The profile now folds it to one button that opens this.
function closeActivity() { ["actBackdrop", "actModal"].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); }); }
function openActivity() {
  closeActivity();
  const log = charLog().slice().reverse();   // newest first
  const rows = log.length
    ? log.map((ev) => '<div class="char-ev"><span class="char-ev-i">' + (CHAR_ICON[ev.k] || "•") + "</span>" +
        '<span class="char-ev-d">' + escapeHtml(ev.d == null ? "" : String(ev.d)) + '</span>' +
        '<span class="char-ev-t">' + agoStr(ev.t) + "</span></div>").join("")
    : '<div class="char-empty">Your journey is just beginning — do the work and it fills in here.</div>';
  const back = document.createElement("div"); back.className = "cat-backdrop"; back.id = "actBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeActivity(); });
  const modal = document.createElement("div"); modal.className = "cat-modal act-modal"; modal.id = "actModal";
  modal.innerHTML =
    '<div class="cat-head"><span>🕘 Your activity</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-list act-list">' + rows + "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);   // the .cat-modal observer adds dialog semantics + Escape
  modal.querySelector(".cat-close").addEventListener("click", closeActivity);
}
const JOURNEY = [
  { arc: "Awakening", lvls: "1–2", feats: ["Connect a bank", "Name your cache", "Tag your income"] },
  { arc: "Foundation", lvls: "3–4", feats: ["Mark must-pays", "Build a budget", "Categorize a month"] },
  { arc: "Momentum", lvls: "5–6", feats: ["First on-time month", "Link work to income", "Goal in sight"] },
  { arc: "Mastery", lvls: "7–8", feats: ["Multi-month streak", "Positive net trend", "Full data coverage"] },
  { arc: "Legend", lvls: "9–10", feats: ["Long streak", "Real cushion", "Verified vault"] },
];
// ── 8-bit pixel glyphs for the merit badges — duotone (currentColor on transparent),
//    drawn on an 8×8 grid so they read as flat retro sprites, not hi-fi icons. ──
const PIX = {
  founder:   ["##.##.##", "##.##.##", "########", "########", ".######.", ".######.", ".######.", "########"],
  awakened:  ["...##...", "#.#..#.#", "##....##", ".##..##.", "...##...", "...##...", "..####..", ".######."],
  connected: ["##..##..", "##..##..", "########", "########", "...##...", "...##...", "...##...", "...##..."],
  earner:    [".######.", "########", "###..###", "##.##.##", "##.##.##", "###..###", "########", ".######."],
  architect: ["###.####", "###.####", "........", "#.####.#", "#.####.#", "........", "###.####", "###.####"],
  watchful:  ["........", ".######.", "##....##", "#..##..#", "##....##", ".######.", "........", "........"],
  verified:  ["..####..", ".#....#.", ".#....#.", "########", "##....##", "##.##.##", "##....##", "########"],
  ascendant: ["..###...", ".#...#..", ".#...#..", "..###...", "...#....", "...#....", "...##...", "...#.#.."],
  blessed:   ["...##...", "...##...", "#.####.#", "########", "########", "#.####.#", "...##...", "...##..."],
  steadfast: ["...#....", "..###...", "..###...", ".#####..", "#######.", "#######.", ".#####..", "..###..."],
  devoted:   ["#.####.#", "########", "########", "##.##.##", "##.##.##", "########", "........", "........"],
  legend:    ["...##...", "..####..", ".######.", "########", ".######.", "..####..", "...##...", "........"],
};
function pixSVG(id) {
  const rows = PIX[id] || [];
  let cells = "";
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === "#") cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>'; });
  return '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">' + cells + "</svg>";
}
// ── Merit badges: achievements you earn by doing the real work. Each badge has a
//    plain-English earn rule read from live state (level, health, connected data,
//    streaks, the founder lock). Earned ones are inked-in; locked ones show what to
//    do. New earns get logged to your ledger so the pride is permanent. ──
const BADGES = [
  { id: "founder",   name: "Founder",       icon: "👑", tier: "mythic", desc: "Built THE CACHE. One of one.",            earn: (c) => c.king },
  { id: "awakened",  name: "Awakened",      icon: "🌱", tier: "bronze", desc: "Named your cache and began the journey.", earn: (c) => c.named },
  { id: "connected", name: "Connected",     icon: "🔌", tier: "bronze", desc: "Linked a real account to your cache.",    earn: (c) => c.accounts > 0 },
  { id: "earner",    name: "Earner",        icon: "💰", tier: "bronze", desc: "Tagged where your income comes from.",     earn: (c) => c.incomeTagged },
  { id: "architect", name: "Architect",     icon: "🧱", tier: "silver", desc: "Laid out a budget / your must-pays.",      earn: (c) => c.budget },
  { id: "watchful",  name: "Watchful",      icon: "🛰️", tier: "silver", desc: "Surfaced your recurring subscriptions.",   earn: (c) => c.subs > 0 },
  { id: "verified",  name: "Vault Verified",icon: "🔒", tier: "silver", desc: "Ledger audited — private & intact.",       earn: (c) => c.verified },
  { id: "ascendant", name: "Ascendant",     icon: "🗝️", tier: "gold",   desc: "Reached cache Level 5.",                   earn: (c) => c.lvl >= 5 },
  { id: "blessed",   name: "Blessed",       icon: "✦",  tier: "gold",   desc: "Maxed your cache health.",                 earn: (c) => c.healthFull },
  { id: "steadfast", name: "Steadfast",     icon: "🔥", tier: "gold",   desc: "Held a 3-month expenses streak.",          earn: (c) => c.streak >= 3 },
  { id: "devoted",   name: "Devoted",       icon: "📅", tier: "gold",   desc: "30 days with your cache.",                 earn: (c) => c.days >= 30 },
  { id: "legend",    name: "Legend",        icon: "💠", tier: "mythic", desc: "Reached cache Level 10.",                  earn: (c) => c.lvl >= 10 },
];
function badgeCtx() {
  const d = Store.data || {};
  const L = cacheLevel(PROFILE_STATS.exp);
  const has = (k) => { const v = localStorage.getItem(k); return v != null && v !== ""; };
  let streak = 0;
  try { ensureCustomStats().forEach((c) => { if (c.kind === "streak") streak = Math.max(streak, streakCount(c.marks)); }); } catch (e) {}
  return {
    king: typeof KING !== "undefined" && KING,
    lvl: L.lvl, days: Math.max(1, Math.round((Date.now() - charSince()) / 86400000)),
    accounts: (d.accounts || []).length,
    incomeTagged: (((d.income || {}).sources) || []).some((s) => s.tagged),
    subs: (((d.subscriptions || {}).items) || []).length,
    named: has("money.cacheName"),
    budget: has("money.mustpayOrder") || has("money.need") || has("money.core") || has("money.reserve"),
    healthFull: _healthFull, verified: _integrityOk === true, streak,
  };
}
function earnedBadges() {
  const c = badgeCtx(), s = new Set();
  BADGES.forEach((b) => { try { if (b.earn(c)) s.add(b.id); } catch (e) {} });
  return s;
}
function renderBadges() {
  const got = earnedBadges();
  const cells = BADGES.map((b) => {
    const on = got.has(b.id);
    return '<div class="badge ' + (on ? "got tier-" + b.tier : "lock") + '" data-bn="' + escapeHtml(b.name) +
      '" data-bd="' + escapeHtml(b.desc) + '" data-on="' + (on ? "1" : "0") + '" title="' + escapeHtml(b.name + " — " + b.desc) + '">' +
      '<div class="badge-disc">' + pixSVG(b.id) + "</div>" +
      '<span class="badge-name">' + escapeHtml(b.name) + "</span></div>";
  }).join("");
  return '<div class="char-sec">Merit badges <span class="badge-count">' + got.size + "/" + BADGES.length + "</span></div>" +
    '<div class="badge-grid">' + cells + "</div>" +
    '<div class="badge-caption" id="badgeCaption">Tap a badge to see how it’s earned.</div>';
}
const BADGES_KEY = "money.badges";
function syncBadges() {
  const got = earnedBadges();
  let prev;
  try { prev = JSON.parse(localStorage.getItem(BADGES_KEY) || "null"); } catch (e) { prev = null; }
  if (!Array.isArray(prev)) { localStorage.setItem(BADGES_KEY, JSON.stringify([...got])); return; }  // first run: seed silently, no feat spam
  const prevSet = new Set(prev);
  let changed = false;
  BADGES.forEach((b) => { if (got.has(b.id) && !prevSet.has(b.id)) { logChar("feat", "Earned the " + b.name + " badge"); changed = true; } });
  if (changed || got.size !== prevSet.size) localStorage.setItem(BADGES_KEY, JSON.stringify([...got]));
}
// ── Edit profile: the character view is where you ARE someone — see who you are,
//    edit it inline, and choose what (if anything) is public. ALL editable text
//    (name/role/note/pronouns/bio) lives in money.profileCard, its OWN GENERIC
//    key (per-key newest-wins by mtime — the engine handles it with zero
//    merge-code changes), deliberately NOT on money.profile: that key's merge +
//    witness are the EXP ledger's (see _authoredProject), widening them re-opens
//    the livelock class this codebase keeps rediscovering, and its text fields
//    are exp-richer-wins — a peer with more EXP at merge time would silently
//    revert a fresh edit. The surface NEVER writes money.profile; legacy values
//    there read through via profileField() until the first card edit. ──
const PROFILE_CARD_KEY = "money.profileCard";
function getProfileCard() { try { return JSON.parse(localStorage.getItem(PROFILE_CARD_KEY) || "{}") || {}; } catch (e) { return {}; } }
function setProfileCard(patch) {
  const c = Object.assign(getProfileCard(), patch || {});
  try { localStorage.setItem(PROFILE_CARD_KEY, JSON.stringify(c)); } catch (e) {}
  try { autoPushSoon(); } catch (e) {}
  return c;
}
// name/role/note live on the CARD too (not money.profile): that key's text fields
// are exp-richer-wins — a peer with more EXP at merge time would silently revert a
// fresh edit, and the witness (EXP-core-only, on purpose) could never see it to
// correct it. The card is GENERIC newest-wins, so edits actually follow you.
// Legacy values already sitting on money.profile still read through until the
// first card edit; nothing writes money.profile's text fields anymore.
function profileField(key) {
  const c = getProfileCard();
  if (typeof c[key] === "string") return c[key];   // an explicit clear ("") is respected
  const p = getProfile();
  return typeof p[key] === "string" ? p[key] : "";
}
function profileName() { return profileField("name"); }
function openProfile() {
  if (document.getElementById("profSpace")) return;
  syncBadges();  // award + log any newly-earned badges before we draw them
  const root = document.createElement("div"); root.id = "profSpace"; root.className = "daily-space prof-space";
  // the old character view was a focus-trapped dialog (the cat-modal auto-enhancer);
  // this surface must not be less accessible than what it replaced
  root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Your profile"); root.tabIndex = -1;
  const opener = document.activeElement;
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  let pubRow = null, pubTouched = false, shareBusy = false;   // pubRow = the server's profiles row (the authority on what's public)
  let shareArmed = false;   // an explicit toggle-ON press arms ONE publish-by-typing; consumed on the first success (after that the server row itself authorizes updates)
  // ONE writer at a time to the public row: a toggle-off retract must land AFTER any
  // in-flight typed-name save — never be overtaken by it and silently undone
  let pubQueue = Promise.resolve();
  const queuePub = (fn) => { const run = pubQueue.then(fn, fn); pubQueue = run.then(() => {}, () => {}); return run; };
  // debounced autosaves are FLUSHED on close, never dropped — "it saves as you type"
  // must stay true for the edit made half a second before tapping ✕
  const debounced = {};
  const later = (id, fn, ms) => { if (debounced[id]) clearTimeout(debounced[id].t); debounced[id] = { fn: fn, t: setTimeout(() => { delete debounced[id]; fn(); }, ms) }; };
  const flushEdits = () => { Object.keys(debounced).forEach((k) => { const d = debounced[k]; delete debounced[k]; clearTimeout(d.t); try { d.fn(); } catch (e) {} }); };
  const onKey = (e) => {
    if (document.querySelector(".cat-modal")) return;   // a stacked modal (Settings) owns the keyboard — one Escape must not close both layers
    if (e.key === "Escape") {
      // the modal enhancer closes its modal SYNCHRONOUSLY inside this same keydown
      // (so the DOM check above already misses it) — but it preventDefaults when it
      // consumes the key, and that signal survives
      if (e.defaultPrevented) return;
      close(); return;
    }
    if (e.key === "Tab") {   // keep Tab inside the dialog (parity with the enhanced modals)
      const list = [...root.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  // a vault merge may have adopted fresher fields — repaint, but never yank a field
  // mid-edit; bank any pending debounce FIRST so the repaint can't show pre-edit
  // values, and put focus back where it was so the Tab trap never leaks
  const onLogged = () => {
    if (!root.isConnected) { cleanup(); return; }
    const a = document.activeElement;
    if (root.contains(a) && a !== root && a.id !== "profClose") return;   // an editor is live — leave the DOM alone
    const fid = root.contains(a) && a.id ? a.id : "";
    flushEdits();
    render();
    if (fid) { const el = root.querySelector("#" + fid); if (el && el.focus) el.focus(); }
  };
  const cleanup = () => { flushEdits(); document.removeEventListener("keydown", onKey); document.removeEventListener("cache:logged", onLogged); };
  const close = () => { cleanup(); root.remove(); try { if (opener && opener.isConnected && opener.focus) opener.focus(); } catch (e) {} };
  document.addEventListener("keydown", onKey);
  document.addEventListener("cache:logged", onLogged);
  const savedTick = (sel) => { const el = root.querySelector(sel); if (!el) return; el.textContent = "saved ✓"; later("tick" + sel, () => { if (el.isConnected) el.textContent = ""; }, 1600); };

  function heroHtml() {
    const L = cacheLevel(PROFILE_STATS.exp);
    const since = new Date(charSince()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return '<div class="prof-hero">' +
      '<div class="prof-emoji" aria-hidden="true">' + L.emoji + "</div>" +
      '<input class="prof-name-in" id="profCacheName" type="text" maxlength="40" autocomplete="off" value="' + esc(getCacheName()) + '" aria-label="your cache&#39;s name" title="rename your cache — it saves as you type">' +
      '<div class="char-stats">' +
        '<div class="char-stat"><b>Lvl ' + L.lvl + "</b><span>" + esc(L.title) + "</span></div>" +
        '<div class="char-stat"><b>' + PROFILE_STATS.exp.toLocaleString() + "</b><span>EXP</span></div>" +
        '<div class="char-stat"><b>' + (PROFILE_STATS.clicks || 0).toLocaleString() + "</b><span>interactions</span></div>" +
        '<div class="char-stat"><b>' + charLog().length + "</b><span>feats logged</span></div>" +
      "</div>" +
      '<div class="char-bar"><span style="width:' + (L.pct * 100).toFixed(1) + '%"></span></div>' +
      '<div class="char-since">since ' + since + " · " + L.into.toLocaleString() + "/" + L.span.toLocaleString() + " to Lvl " + (L.lvl + 1) + "</div>" +
      '<div class="prof-saved" id="profSavedHero" aria-live="polite"></div>' +
    "</div>";
  }
  function aboutHtml() {
    const c = getProfileCard();
    return '<div class="char-sec">About you · <span class="prof-tag">🔒 only you see these</span></div>' +
      '<div class="prof-hint">These live in your cache and only ever travel inside your encrypted vault. Fill in as much or as little as you like — empty is fine.</div>' +
      '<div class="prof-fields">' +
        '<label class="prof-field"><span>Name</span><input id="profName" type="text" maxlength="60" autocomplete="off" value="' + esc(profileField("name")) + '" placeholder="what you go by"></label>' +
        '<label class="prof-field"><span>Pronouns</span><input id="profPronouns" type="text" maxlength="24" autocomplete="off" value="' + esc(c.pronouns || "") + '" placeholder="if you want them here"></label>' +
        '<label class="prof-field"><span>What you do</span><input id="profRole" type="text" maxlength="80" autocomplete="off" value="' + esc(profileField("role")) + '" placeholder="musician · gig work · freelance"></label>' +
        '<label class="prof-field prof-field-area"><span>About</span><textarea id="profBio" maxlength="400" rows="3" placeholder="anything you want your cache to hold for you">' + esc(c.bio || "") + "</textarea></label>" +
        '<label class="prof-field"><span>Note to self</span><input id="profNote" type="text" maxlength="120" autocomplete="off" value="' + esc(profileField("note")) + '" placeholder="optional"></label>' +
      "</div>" +
      '<div class="prof-saved" id="profSavedAbout" aria-live="polite"></div>';
  }
  // The public section. The ONLY thing that can be public today is what Messages
  // already needs: your @handle (claimed there) and, per-field opt-in, a display
  // name on the same profiles row. The sharing-tier model (Ghost/Neighbor/Beacon)
  // is a pending product decision — do NOT add public fields here without it.
  function pubHintHtml(on, curName) {
    const st = socialState();
    return on
      ? (String(curName || "").trim()
        ? "This name is <b>public</b> — anyone who can find @" + esc(st.username) + " sees it. Everything else on this page stays private."
        : "Type a name above — it becomes <b>public</b> (visible to anyone who can find @" + esc(st.username) + ") once it saves.")
      : "Off — only your @handle is public, and only to people who search for it exactly. The name box just holds your draft.";
  }
  function publicHtml() {
    const c = getProfileCard(), st = socialState();
    let inner;
    if (!socialLoggedIn())
      inner = '<div class="prof-hint">You have no public profile — everything on this page stays with your cache, and that&#39;s a complete setup. Friends and messaging start with a cloud account, whenever (and if) you want them.</div>';
    else if (!st.optedIn || !st.username)
      inner = '<div class="prof-hint">You&#39;re not discoverable — nothing about you is visible to anyone. If you&#39;d like friends to find you, claim an @handle in Messages.</div>' +
        '<div class="prof-btnrow"><button class="set-btn" id="profToMessages">💬 Open Messages</button></div>';
    else {
      const on = !!c.shareName;
      const pubName = pubRow && typeof pubRow.name === "string" ? pubRow.name : "";
      const curName = (c.publicName != null ? c.publicName : pubName) || "";
      inner =
        '<div class="prof-handle"><span class="prof-at">@</span><b>' + esc(st.username) + '</b><span class="prof-handle-note">your handle — friends find you by searching it exactly</span></div>' +
        '<button class="prof-share-tgl' + (on ? " on" : "") + '" id="profShareTgl" role="switch" aria-checked="' + (on ? "true" : "false") + '"' + (shareBusy ? " disabled" : "") + '><span class="prof-share-knob" aria-hidden="true"></span><span class="prof-share-lbl">Show a display name next to your handle</span></button>' +
        '<label class="prof-field"><span>Display name</span><input id="profPubName" type="text" maxlength="40" autocomplete="off" value="' + esc(curName) + '" placeholder="how you&#39;d appear"' + (shareBusy ? " disabled" : "") + "></label>" +
        '<div class="prof-hint" id="profPubHint">' + pubHintHtml(on, curName) + "</div>";
    }
    return '<div class="char-sec">Public · <span class="prof-tag">🌐 opt-in, one field at a time</span></div>' + inner +
      '<div class="prof-saved" id="profSavedPub" aria-live="polite"></div>';
  }
  function acctHtml() {
    if (!cloudState().token)
      return '<div class="prof-acct"><span class="prof-acct-who">Not signed in — your cache lives on this device.</span>' +
        '<button class="set-btn" id="profCloudSet">☁️ Cloud settings</button></div>';
    return '<div class="prof-acct"><span class="prof-acct-who">Signed in as <b>' + esc(cloudState().email || "your account") + "</b></span>" +
      '<button class="set-btn" id="profSwitch"><i data-lucide="users"></i> Switch account</button></div>';
  }
  function render() {
    const prevBody = root.querySelector(".prof-body");
    const scrollAt = prevBody ? prevBody.scrollTop : 0;   // a background merge repaint must not yank the reader back to the top
    const actN = charLog().length;   // folded to a count — the full list opens in its own window (openActivity)
    const L = cacheLevel(PROFILE_STATS.exp);
    const curArc = Math.min(JOURNEY.length - 1, Math.floor((L.lvl - 1) / 2));
    const arcs = JOURNEY.map((a, i) => {
      const st = i < curArc ? "done" : i === curArc ? "now" : "lock";
      return '<div class="tt-tier ' + st + '"><div class="tt-node"><span class="tt-arc">' + esc(a.arc) + '</span><span class="tt-lvl">Lvl ' + a.lvls + "</span></div>" +
        '<div class="tt-branch">' + a.feats.map((f) => '<span class="tt-feat">' + esc(f) + "</span>").join("") + "</div></div>";
    }).join("");
    const skills = [
      { name: "Blessed clicks", req: "max cache health", got: _healthFull },
      { name: "Sword shing", req: "max cache health", got: _healthFull },
      { name: "Cursor magnification", req: "coming soon", got: false },
      { name: "Art backgrounds", req: "coming soon", got: false },
    ].map((s) => '<button class="sk-pill ' + (s.got ? "got" : "lock") + '"' + (s.got ? "" : " disabled") + '><span class="sk-i">' + (s.got ? "✦" : "🔒") + "</span>" + esc(s.name) + (s.got ? '<span class="sk-go">unleashed</span>' : '<span class="sk-req">' + esc(s.req) + "</span>") + "</button>").join("");
    root.innerHTML =
      '<div class="daily-top"><button class="daily-icn" id="profClose" aria-label="close">✕</button>' +
        '<div class="cal-title">Your profile</div><span class="daily-icn" aria-hidden="true"></span></div>' +
      '<div class="prof-body">' +
        heroHtml() + aboutHtml() +
        '<div id="profPubSec">' + publicHtml() + "</div>" +
        renderBadges() +
        '<div class="char-sec">Skills &amp; unlocks</div><div class="sk-pills">' + skills + "</div>" +
        '<div class="char-sec">Journey · tech tree</div><div class="tt-tree">' + arcs + "</div>" +
        '<div class="char-sec">Your activity</div>' +
        '<button class="prof-act" id="profActivity">' +
          '<span class="prof-act-i">🕘</span>' +
          '<span class="prof-act-txt">' +
            (actN ? actN + (actN === 1 ? " thing" : " things") + " you've done" : "Nothing logged yet") +
          "</span>" +
          '<span class="prof-act-go">Open</span>' +
        "</button>" +
        acctHtml() +
      "</div>";
    const nb = root.querySelector(".prof-body"); if (nb && scrollAt) nb.scrollTop = scrollAt;
    wire(); wirePublic();
    try { drawIcons(); } catch (e) {}
  }
  function paintPublic() {
    const box = root.querySelector("#profPubSec"); if (!box) return;
    const a = document.activeElement, fid = box.contains(a) && a.id ? a.id : "";   // a rebuild must not drop focus out of the aria-modal trap
    box.innerHTML = publicHtml(); wirePublic();
    if (fid) { const el = root.querySelector("#" + fid); if (el && !el.disabled && el.focus) el.focus(); else root.focus(); }
    try { drawIcons(); } catch (e) {}
  }
  // sync the switch (class + aria) AND the hint without touching the name input —
  // used when the heal lands while the user is typing in the public box, so neither
  // the switch nor the words under it can disagree with what the next click will do
  function paintPublicSoft() {
    const tgl = root.querySelector("#profShareTgl"); if (!tgl) return;
    const c = getProfileCard(), on = !!c.shareName;
    tgl.classList.toggle("on", on); tgl.setAttribute("aria-checked", on ? "true" : "false");
    const hint = root.querySelector("#profPubHint"), pn0 = root.querySelector("#profPubName");
    if (hint) hint.innerHTML = pubHintHtml(on, (pn0 && pn0.value) || c.publicName || "");
  }
  function wire() {
    root.querySelector("#profClose").addEventListener("click", close);
    // cache name — inline rename, saves as you type (blank falls back to the default name)
    const nameIn = root.querySelector("#profCacheName");
    if (nameIn) nameIn.addEventListener("input", () => later("cacheName", () => {
      setCacheName(nameIn.value);
      try { renderBrand(); renderCharacter(); } catch (e) {}
      savedTick("#profSavedHero");
    }, 500));
    // every About field saves to the CARD (GENERIC newest-wins — edits converge);
    // money.profile is never written here, so its EXP ledger can't be touched
    const bindCard = (sel, key, after) => { const el = root.querySelector(sel); if (!el) return; el.addEventListener("input", () => later("c." + key, () => {
      const patch = {}; patch[key] = el.value.trim(); setProfileCard(patch);
      if (after) try { after(); } catch (e) {}
      savedTick("#profSavedAbout");
    }, 500)); };
    bindCard("#profName", "name", () => { try { updateGreeting(); renderBrand(); renderCharacter(); } catch (e) {} });   // the greeting + default cache name read it
    bindCard("#profRole", "role"); bindCard("#profNote", "note");
    bindCard("#profPronouns", "pronouns"); bindCard("#profBio", "bio");
    root.querySelectorAll(".sk-pill.got").forEach((b) => b.addEventListener("click", () => {  // "unleash" pulse
      b.classList.remove("unleash"); void b.offsetWidth; b.classList.add("unleash");
    }));
    const cap = root.querySelector("#badgeCaption");
    root.querySelectorAll(".badge").forEach((el) => el.addEventListener("click", () => {  // tap to reveal name + how it's earned
      if (cap) cap.textContent = el.dataset.bn + " — " + el.dataset.bd + (el.dataset.on === "1" ? " ✓ earned" : " · locked");
    }));
    const act = root.querySelector("#profActivity");
    if (act) act.addEventListener("click", () => { try { openActivity(); } catch (e) {} });
    const cs = root.querySelector("#profCloudSet"); if (cs) cs.addEventListener("click", () => { try { openSettings(); } catch (e) {} });
    const sw = root.querySelector("#profSwitch");
    if (sw) sw.addEventListener("click", () => {
      // ONE account switcher only (data-safety decision — see account-isolation):
      // route to the cloud chip's 2-tap account menu once it ships; until that
      // worktree merges, cloud Settings (log out / sign in) is the honest fallback.
      if (typeof openAccountMenu === "function") openAccountMenu(sw);
      else { try { openSettings(); } catch (e) {} }
    });
  }
  function wirePublic() {
    const toMsg = root.querySelector("#profToMessages");
    if (toMsg) toMsg.addEventListener("click", () => { close(); try { openMessages(); } catch (e) {} });
    const tgl = root.querySelector("#profShareTgl");
    if (tgl) tgl.addEventListener("click", async () => {
      pubTouched = true;
      // trust what the user SAW, not storage — a background heal may have moved the
      // flag under a stale paint, and the click must do what the switch showed
      const was = tgl.getAttribute("aria-checked") === "true", on = !was;
      const nameEl = root.querySelector("#profPubName");
      const typed = nameEl ? nameEl.value.trim() : (getProfileCard().publicName || "");
      const card = setProfileCard({ shareName: on ? 1 : 0, publicName: typed });
      shareArmed = on;
      if (on && !typed) {   // nothing to publish yet — arm it and ask for the name (publishes as they type)
        paintPublic();
        const pn2 = root.querySelector("#profPubName"); if (pn2) pn2.focus();
        return;
      }
      shareBusy = true; paintPublic();
      try {
        await queuePub(() => socialSetPublicName(card, on));
        shareArmed = false;   // consumed — from here the server row itself authorizes typed updates (requireShared passes because the name is live)
        shareBusy = false; paintPublic();
        flash(on ? "Display name is now public" : "Display name hidden — handle-only again");
      } catch (e) {
        // couldn't confirm the change — read the row back and show the SERVER's truth
        // (a dropped response can land after the server already applied the PATCH)
        let truth = null;
        try {
          const d = await socialApi("/api/collections/profiles/records" + socialFilter('owner="' + cloudState().userId + '"'));
          const row = (d.items || [])[0]; truth = row && typeof row.name === "string" ? row.name : "";
        } catch (e2) {}
        if (truth === null) setProfileCard({ shareName: was ? 1 : 0 });   // fully unreachable → put the switch back
        else setProfileCard({ shareName: truth.trim() ? 1 : 0, publicName: truth.trim() ? truth : typed });
        shareArmed = false; shareBusy = false; paintPublic();
        flash(e.message || "couldn't update your public profile");
      }
    });
    const pn = root.querySelector("#profPubName");
    if (pn) pn.addEventListener("input", () => {
      pubTouched = true;   // SYNCHRONOUS — the open-heal must never flip a draft into a publish mid-typing
      later("pubName", async () => {
        setProfileCard({ publicName: pn.value.trim() });
        if (!getProfileCard().shareName) { savedTick("#profSavedPub"); return; }   // switch off → the name stays a local draft
        try {
          await queuePub(async () => {
            const c2 = getProfileCard();
            if (!c2.shareName) return;   // a queued retract ran first — it stands; this save stays local
            // without this visit's explicit toggle-ON press, typing may only UPDATE a name
            // the server already shows — it must never RE-publish one retracted elsewhere
            await socialSetPublicName(c2, true, !shareArmed);
            shareArmed = false;   // the arm covers one publish; after it the live server name authorizes the rest
          });
          savedTick("#profSavedPub");
        } catch (e) {
          if (e && e.notShared) {   // retracted on another device — respect it, never silently re-publish
            setProfileCard({ shareName: 0 });
            paintPublic();
            flash("Sharing was turned off on another device — flip the switch if you still want a public name.");
          } else flash(e.message || "couldn't update your public name");
        }
      }, 700);
    });
  }
  render();
  try { root.focus(); } catch (e) {}   // move focus into the dialog (restored to the opener on close)
  // the Settings → "Edit profile" path closes the modal in the same task, and the
  // modal enhancer's focus-restore runs AFTER ours (its MutationObserver fires at
  // end of task) — re-assert on the next task so focus can't be parked behind the dialog
  setTimeout(() => { try { if (root.isConnected && !root.contains(document.activeElement)) root.focus(); } catch (e) {} }, 0);
  // the server's profiles row is the authority on what's actually public — fetch it,
  // and heal the local flag TOWARD it (reflect a publish, respect a retraction; this
  // path never publishes anything itself)
  if (socialReady()) {
    socialApi("/api/collections/profiles/records" + socialFilter('owner="' + cloudState().userId + '"'))
      .then((d) => {
        pubRow = (d.items || [])[0] || null;
        if (!pubTouched && pubRow) {
          const c = getProfileCard();
          if (pubRow.name && !c.shareName) setProfileCard({ shareName: 1, publicName: pubRow.name });        // published elsewhere → reflect it
          else if (!pubRow.name && c.shareName) setProfileCard({ shareName: 0 });                            // retracted elsewhere → respect it
        }
        if (!root.isConnected) return;
        const box = root.querySelector("#profPubSec"), a = document.activeElement;
        if (!box || !box.contains(a)) paintPublic();   // focus elsewhere (About fields etc.) is safe — only the public box repaints
        else paintPublicSoft();                        // typing in the public box → sync the switch, leave the input alone
      })
      .catch(() => {});
  }
}
function openCharLog() { openProfile(); }   // the character modal grew into the full profile surface — one view, same journey + badges + ledger
function renderCharacter() {
  const e = document.getElementById("sidebarXp");
  if (!e) return;
  const L = cacheLevel(PROFILE_STATS.exp);
  _charLevel = L.lvl;
  e.innerHTML =
    '<div class="cache-char">' +
      '<div class="cc-top"><span class="cc-emoji">' + L.emoji + "</span>" +
        '<button class="cc-name" title="open your profile">' + escapeHtml(getCacheName()) + "</button></div>" +
      '<div class="cc-meta">Lvl <b class="cc-lvl">' + L.lvl + "</b> · " + escapeHtml(L.title) + "</div>" +
      '<div class="cc-bar"><span class="cc-fill" style="width:' + (L.pct * 100).toFixed(1) + '%"></span></div>' +
      '<div class="cc-xp"><b>' + PROFILE_STATS.exp.toLocaleString() + "</b> EXP · " + L.into.toLocaleString() + "/" + L.span.toLocaleString() + " to Lvl " + (L.lvl + 1) + "</div>" +
    "</div>";
  const card = e.querySelector(".cache-char");
  if (card) { card.style.cursor = "pointer"; card.title = "your profile — view & edit"; card.addEventListener("click", openCharLog); }
  const nameBtn = e.querySelector(".cc-name");
  if (nameBtn) nameBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();   // one open, not two — the surrounding card also opens the profile
    openProfile();          // the cache name opens your profile; renaming lives THERE (#profCacheName)
  });
}
function updateXp() {
  const e = document.getElementById("sidebarXp");
  if (e) {
    const L = cacheLevel(PROFILE_STATS.exp);
    if (L.lvl !== _charLevel || !e.querySelector(".cache-char")) {  // level-up → rebuild + log the feat
      if (_charLevel >= 1 && L.lvl > _charLevel) logChar("level", "Reached Lvl " + L.lvl + " — " + L.title);
      renderCharacter();
    }
    else {  // in place on every click — no thrash
      const fill = e.querySelector(".cc-fill"); if (fill) fill.style.width = (L.pct * 100).toFixed(1) + "%";
      const xp = e.querySelector(".cc-xp"); if (xp) xp.innerHTML = "<b>" + PROFILE_STATS.exp.toLocaleString() + "</b> EXP · " + L.into.toLocaleString() + "/" + L.span.toLocaleString() + " to Lvl " + (L.lvl + 1);
    }
  }
  const chip = document.querySelector('.stat-chip[data-stat="exp"] .stat-val');
  if (chip) chip.textContent = "⭐ " + PROFILE_STATS.exp.toLocaleString();
}
function addExp(n) {
  PROFILE_STATS.clicks += n;
  if (_healthFull) { _expAcc += n * 0.1; if (_expAcc >= 1) { const b = Math.floor(_expAcc); n += b; _expAcc -= b; } }  // +10% EXP at full health
  PROFILE_STATS.exp += n;
  try { PROFILE_STATS.expBy[PROFILE_STATS.dev] = (+PROFILE_STATS.expBy[PROFILE_STATS.dev] || 0) + n; } catch (e) {}   // bank it in this device's ledger slot
  updateXp();
  clearTimeout(_statsTimer);
  _statsTimer = setTimeout(saveStats, 700);
}
// ── Bug credits: closing the loop with the person who reported a bug ─────────
// When a report you chose to credit to your cache gets marked fixed, you hear about
// it, earn EXP for it, and it counts toward a stat you can be proud of.
// money.bugCredits is the idempotency SET: [{id, at, exp}] per credited report, one
// entry per feedback-record id. Its merge class is SPECIAL — a union by report id
// (exactly like money.badges unions earned ids) — so two devices that both see the
// same fixed report converge on ONE entry.
// The EXP grant is made exactly-once the same way: it banks into a DETERMINISTIC
// EXP-ledger slot named after the report (expBy["bug:<id>"] = BUG_FIX_EXP), never the
// device slot. The profile merge is slot-wise MAX, so two devices independently
// granting the same report collapse to one grant; different reports use different
// slots and both count. (No health bonus here — the slot value must be byte-identical
// on every device or the ledger would double-count.)
const BUG_CREDITS_KEY = "money.bugCredits";
const BUG_FIX_EXP = 25;
function bugCredits() { try { const a = JSON.parse(localStorage.getItem(BUG_CREDITS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
// The stat is DERIVED from the credits set (count + EXP sum) — a derived stat can't
// drift from its source the way a second mutable counter could.
function bugCreditStat() {
  const a = bugCredits().filter((c) => c && c.id);
  return { count: a.length, exp: a.reduce((t, c) => t + (+c.exp || 0), 0) };
}
// Claim a fixed report EXACTLY once. Returns true only if the id was genuinely new
// to the union (that's the only path that grants EXP / celebrates / journals).
function bugCreditClaim(id, at) {
  if (!id) return false;
  const a = bugCredits();
  if (a.some((c) => c && c.id === id)) return false;
  a.push({ id: id, at: at || "", exp: BUG_FIX_EXP });
  try { localStorage.setItem(BUG_CREDITS_KEY, JSON.stringify(a)); } catch (e) {}
  PROFILE_STATS.exp += BUG_FIX_EXP;
  if (!PROFILE_STATS.expBy || typeof PROFILE_STATS.expBy !== "object") PROFILE_STATS.expBy = {};
  PROFILE_STATS.expBy["bug:" + id] = BUG_FIX_EXP;   // deterministic slot — slot-wise max ⇒ one grant across devices
  try { updateXp(); } catch (e) {}
  clearTimeout(_statsTimer);
  _statsTimer = setTimeout(saveStats, 700);
  // deterministic t (the server's fixed-at time) → the journey entry dedupes across devices
  try { logChar("bugfix", "Something you reported got fixed — you made the Cache better", Date.parse(at) || Date.now()); } catch (e) {}
  return true;
}
// ── Trust badge: a live, non-destructive proof the ledger is solid (/api/integrity) ──
function renderTrust() {
  const el = document.getElementById("trustBadge");
  if (!el) return;
  fetch("/api/integrity?t=" + Date.now()).then((r) => r.json()).then((d) => {
    if (!d) { el.innerHTML = ""; return; }
    _integrityOk = d.ok; renderHealth();  // integrity feeds cache health
    el.innerHTML = '<button class="trust-chip ' + (d.ok ? "ok" : "warn") + '" title="how your data is protected">' +
      "<span>" + (d.ok ? "🔒 Private &amp; verified" : "⚠ Check your data") + "</span>" +
      '<span class="trust-n">' + (d.ok ? "✓" : "!") + "</span></button>";
    el.querySelector(".trust-chip").addEventListener("click", () => openTrust(d));
  }).catch(() => { el.innerHTML = ""; });
}
function openTrust(d) {
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal trust-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const rows = (d.checks || []).map((c) =>
    '<div class="trust-row"><span class="' + (c.ok ? "trust-pass" : "trust-fail") + '">' + (c.ok ? "✓" : "✗") + "</span>" +
    '<span class="trust-name">' + escapeHtml(c.name) + "</span>" +
    '<span class="trust-detail">' + escapeHtml(c.detail || "") + "</span></div>").join("");
  modal.innerHTML =
    '<div class="cat-head"><span>' + (d.ok ? "🔒 Private &amp; verified" : "⚠ Data needs attention") + '</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="trust-body">' +
      '<div class="trust-lead"><b>Your financial data never leaves this machine.</b> This is a live, non-destructive audit of your local ledger — proof it’s readable, complete, uncorrupted, and recoverable.</div>' +
      rows +
      '<div class="trust-foot">' + (d.count || 0).toLocaleString() + " transactions · " + (d.backups || 0) + " daily backups" + (d.last_backup ? " · last " + escapeHtml(d.last_backup) : "") + "</div>" +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
}
// ── Cache health: how fully connected/solid your cache is. Max it → +10% EXP per click. ──
let _integrityOk = null;   // last /api/integrity result (set by renderTrust)
let _healthFull = false, _expAcc = 0;
function cacheHealth() {
  const d = Store.data || {};
  const has = (k) => { const v = localStorage.getItem(k); return v != null && v !== ""; };
  const cores = (Store.recurring || []).filter((r) => isSubCore(r.key) && !isSubPaused(r.key)).length;
  const items = [
    { label: "Bank connected", action: "Menu → Connect a bank", ok: !!(d.accounts && d.accounts.length) },
    { label: "Income tagged", action: "Money Map → tag deposits", ok: !!(d.income && d.income.untagged === 0 && d.income.sources && d.income.sources.length) },
    { label: "Must-pay bills starred", action: "Money Map → star bills", ok: cores > 0 },
    { label: "Reserve set", action: "Settings → Safety buffer", ok: has("money.reserve") },
    { label: "Monthly need set", action: "Budget → build", ok: has("money.need") || has("money.guaranteedIncome") },
    { label: "Data verified", action: "auto — integrity check", ok: _integrityOk === true },
  ];
  // Email verified — only for cloud accounts (a local-only cache has no email to verify). It's a
  // gentle checkbox, NEVER a login gate: verification makes password-reset + recovery actually
  // reach you. Signup already sends the email; this just tracks it in your cache health.
  try { const cs = cloudState(); if (cs.token || cs.userId) items.push({ label: "Email verified", action: "Settings → Cache cloud → Verify your email", ok: cs.verified === true }); } catch (e) {}
  const done = items.filter((i) => i.ok).length;
  return { score: Math.round(done / items.length * 100), done, total: items.length, items };
}
function renderHealth() {
  const el = document.getElementById("healthBadge");
  if (!el) return;
  const h = cacheHealth();
  _healthFull = h.score >= 100;
  document.body.classList.toggle("blessed", _healthFull);  // blessed clicks: cursor + celebration upgrade
  el.innerHTML = '<button class="health-chip' + (_healthFull ? " full" : "") + '" style="--p:' + h.score + '" title="cache health — connect everything to max it (+10% EXP when full)">' +
    '<span class="health-ring"></span><span class="health-lbl">cache health</span><span class="health-pct">' + h.score + "%</span></button>";
  el.querySelector(".health-chip").addEventListener("click", openHealth);
}
function openHealth() {
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal health-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const h = cacheHealth();
  const rows = h.items.map((i) => '<div class="health-row ' + (i.ok ? "ok" : "todo") + '">' +
    '<span class="health-mk">' + (i.ok ? "✓" : "○") + "</span>" +
    '<span class="health-name">' + escapeHtml(i.label) + "</span>" +
    (i.ok ? "" : '<span class="health-act">' + escapeHtml(i.action) + "</span>") + "</div>").join("");
  modal.innerHTML =
    '<div class="cat-head"><span>Cache health</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="health-body">' +
      '<div class="health-big">' + h.score + "%<span>" + h.done + " of " + h.total + " connected</span></div>" +
      (h.score >= 100
        ? '<div class="health-bonus">🔥 Full blast — every click earns <b>+10% EXP</b>.</div>'
        : '<div class="health-bonus dim">Max it for a <b>+10% EXP</b> bonus on every click.</div>') +
      '<div class="char-sec">Checklist</div>' + rows +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
  // if you're signed in but not-yet-verified, quietly re-check with the server on open — so an
  // email you JUST verified checks off here without a reload. Only fires while unverified, so it
  // can't loop (a verified refresh flips the flag and the guard stops).
  try {
    const cs = cloudState();
    if (cs.token && cs.verified !== true) {
      cloudAuthCheck().then(() => {
        if (document.body.contains(modal) && cloudState().verified === true) { close(); openHealth(); }
      }).catch(() => {});
    }
  } catch (e) {}
}
document.addEventListener("pointerdown", () => addExp(1), true);  // capture → counts every click
// ── Anonymous, opt-in analytics (PostHog) — autocapture OFF so it can NEVER scoop
//    your dollar amounts/merchant names; only named, safe events. Off by default. ──
const PH_KEY = "phc_ks2GEXApcUXG7tyj9GbBYBTWJDEUKAbz2Gcb3mJCujRp";
const PH_HOST = "https://us.i.posthog.com";
let _phLoaded = false;
function analyticsOn() { return localStorage.getItem("money.analytics") === "1"; }
function track(ev, props) { try { if (_phLoaded && window.posthog && window.posthog.capture) window.posthog.capture(ev, props || {}); } catch (e) {} }
function initAnalytics() {
  if (_phLoaded || !analyticsOn()) return;
  _phLoaded = true;
  !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split("."); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } } (p = t.createElement("script")).type = "text/javascript", p.crossOrigin = "anonymous", p.async = !0, p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js", (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = "posthog", u.people = u.people || [], u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e }, u.people.toString = function () { return u.toString(1) + ".people (stub)" }, o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "), n = 0; n < o.length; n++)g(u, o[n]); e._i.push([i, s, a]) }, e.__SV = 1) }(document, window.posthog || []);
  window.posthog.init(PH_KEY, {
    api_host: PH_HOST,
    autocapture: false,              // NEVER auto-grab DOM text (your financial data)
    disable_session_recording: true, // never record the screen
    capture_pageview: true,
    person_profiles: "identified_only", // stay anonymous — no person profiles created
    persistence: "localStorage",
    respect_dnt: true,
  });
  try { if (window.posthog.opt_in_capturing) window.posthog.opt_in_capturing(); } catch (e) {}  // clear any persisted opt-out from a prior session
  track("app_loaded", { widgets: Object.keys(layout || {}) });
}

// ── End-to-end encrypted backup (the cloud E2E core, proven locally first) ──
// Client-side only: a passphrase → AES-GCM key (PBKDF2). The server never sees the
// passphrase or the key — it only ever hands over / receives the bundle; encryption
// happens here in the browser. Same crypto will wrap the blob before any cloud upload.
function _b64(buf) { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function _unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
async function _deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _deriveKey(pass, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ app: "thecache", v: 1, kdf: "PBKDF2-SHA256", iter: 210000, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) });
}
async function decryptJSON(envStr, pass) {
  const env = JSON.parse(envStr);
  const key = await _deriveKey(pass, _unb64(env.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(env.iv) }, key, _unb64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
// ── Cloud data key (v2 vaults) ──────────────────────────────
// The cloud vault is sealed with a random 256-bit data key K, not the passphrase
// directly. K rides on the vault record in a "keybox":
//   escrow mode (default, no passphrase): keybox holds K as-is — the account is
//     the key, forgot-password never loses data, and we CAN technically open it;
//   zero-knowledge mode (passphrase set): keybox holds K wrapped by the
//     passphrase — the server holds only ciphertext it can never open.
// Either way K is cached on this device (money.cloudKey) so background auto-push
// can seal without prompting. File/WebDAV backups stay on the v1 passphrase
// envelope — a .cache file must open anywhere with just the passphrase.
const CLOUDKEY_KEY = "money.cloudKey";
function cloudKeyGet() { try { return localStorage.getItem(CLOUDKEY_KEY) || ""; } catch (e) { return ""; } }
function cloudKeySet(b64) { try { if (b64) localStorage.setItem(CLOUDKEY_KEY, b64); else localStorage.removeItem(CLOUDKEY_KEY); } catch (e) {} }

// TEST-ONLY: a "+cachetest" email marks a throwaway account. The reset tool below (and its
// button) exist ONLY for these — a real account (no "+cachetest") can never see or run it.
// Gmail plus-addressing means hellocozyace+cachetest@gmail.com lands in your normal inbox but
// is its own account, so you can make as many as you want without a single extra mailbox.
function isTestAccount() { return (cloudState().email || "").toLowerCase().indexOf("+cachetest") !== -1; }
// Return a test account to a TRULY brand-new state: delete its cloud vault AND its whole
// account (the user record), then LOG OUT and hard-discard this device's copy — so you land
// on a clean signup screen and can re-run the entire onboarding (account creation + the
// "Just me / Keep a spare" key choice) with the same +cachetest email. Deleting-but-staying-
// logged-in was confusing; this makes "reset to a fresh signup" mean exactly that.
// Double-guarded (button hidden AND this refuses) so it can never touch a real account.
async function resetTestToFresh() {
  const s = cloudState();
  if (!isTestAccount()) { try { flash("Fresh-reset is only for +cachetest test accounts."); } catch (e) {} return; }
  if (!s.token) { try { flash("Log into the test account first."); } catch (e) {} return; }
  confirmDelete("the ENTIRE test account " + (s.email || "") + " — its account, cloud vault, and this device's copy (fresh-signup reset)", async () => {
    // Refresh the token FIRST. The "worked on the second try" bug was a stale token: the first
    // DELETE 401'd and we swallowed it; some later interaction refreshed the token, so the
    // second attempt worked. auth-refresh gets a fresh token before we touch anything.
    try { await cloudAuthCheck(); } catch (e) {}
    const cur = cloudState(); const tok = cur.token || s.token; const uid = cur.userId || s.userId;
    if (!tok) { try { flash("Your login expired — log back in, then reset."); } catch (e) {} return; }
    let acctGone = false, why = "";
    try {
      const id = await cloudFindVaultId(cur);   // delete the cloud vault (blob + keybox) if any
      if (id) { try { await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { method: "DELETE", headers: { Authorization: tok } }); } catch (e) {} }
      if (uid) {                                 // delete the account itself, so the same email can sign up fresh
        try {
          const r = await fetch(cloudUrl() + "/api/collections/users/records/" + uid, { method: "DELETE", headers: { Authorization: tok } });
          acctGone = r.ok;
          if (!r.ok) { try { why = " (" + ((await r.json()).message || ("HTTP " + r.status)) + ")"; } catch (e) { why = " (HTTP " + r.status + ")"; } }
        } catch (e) { why = " (" + ((e && e.message) || "network error") + ")"; }
      }
    } catch (e) {}
    // HARD local discard (no parking — the account is gone): drop the key, wipe every
    // account-scoped key from the live slot, remove any parked silo, clear the session pointer.
    try { cloudKeySet(""); } catch (e) {}
    try { clearAccountData(); } catch (e) {}
    try { if (uid) localStorage.removeItem(PROFILE_PREFIX + uid); } catch (e) {}
    try { localStorage.removeItem(CLOUD_KEY); } catch (e) {}
    try {
      flash(acctGone
        ? "Account deleted — you're logged out. Sign up fresh to test onboarding again."
        : "Logged out + wiped here, but the account wasn't deleted server-side" + why + ". Add a self-delete rule to the PocketBase users collection, or use a new +cachetest email.");
    } catch (e) {}
    setTimeout(() => location.reload(), acctGone ? 1100 : 2600);   // linger longer so you can read the failure reason
  });
}
async function cloudGenKey() {
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return _b64(await crypto.subtle.exportKey("raw", k));
}
function _importK(b64) { return crypto.subtle.importKey("raw", _unb64(b64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function cloudSeal(obj) {
  const kb = cloudKeyGet();
  if (!kb) throw new Error("no cloud key on this device yet");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await _importK(kb), new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ app: "thecache", v: 2, iv: _b64(iv), ct: _b64(ct) });
}
async function cloudOpen(envStr, pass) {
  const env = JSON.parse(envStr);
  if ((env.v || 1) >= 2) {
    const kb = cloudKeyGet();
    if (!kb) throw new Error("this device doesn't hold the cloud key yet");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(env.iv) }, await _importK(kb), _unb64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  return decryptJSON(envStr, pass);   // v1 legacy vault — passphrase path, kept forever
}
async function keyboxMake(kb64, pass) {
  if (pass) {   // zero-knowledge: K wrapped by the passphrase, server sees only ciphertext
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const kek = await _deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, _unb64(kb64));
    return JSON.stringify({ m: "zk", kdf: "PBKDF2-SHA256", iter: 210000, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) });
  }
  return JSON.stringify({ m: "esc", k: kb64 });   // escrow: the account is the key
}
// ── Multi-wrap keybox (v2): ONE vault key K, several independent WRAPPINGS ───────
// The v1 keybox held exactly one wrapping — escrow ({m:"esc"}) OR passphrase
// ({m:"zk"}). v2 holds a LIST, side by side: {v:2, wraps:[…]}. Each wrap seals the
// SAME K under a different secret, so ANY one opens the vault and NONE weakens the
// others: adding a wrap never touches the rest, and removing escrow drops only the
// raw key. Both v1 shapes still open FOREVER (migrate-on-read) — a v1 box is never
// rewritten destructively; it becomes v2 only on the next deliberate keybox edit.
//   wrap types:  t:"pass" (passphrase) · t:"file" (recovery file) · t:"code"
//   (recovery code) — all PBKDF2-wrapped {kdf,iter,salt,iv,ct};  t:"esc" — the raw
//   key {k}, the escrow spare, the ONLY shape the SERVER can read.
const KEYBOX_ITER = 210000;
async function _keyboxWrap(t, kb64, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await _deriveKey(secret, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, _unb64(kb64));
  return { t, kdf: "PBKDF2-SHA256", iter: KEYBOX_ITER, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) };
}
async function _keyboxUnwrap(wrap, secret) {
  const kek = await _deriveKey(secret, _unb64(wrap.salt));
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(wrap.iv) }, kek, _unb64(wrap.ct));
  return _b64(raw);
}
// Normalize ANY keybox shape (v1 esc, v1 zk, v2) to the v2 wrap list, so every
// helper below reads one shape. A v1 box is read, never rewritten, by this.
function _keyboxParse(box) { return typeof box === "string" ? JSON.parse(box) : box; }
function keyboxWraps(box) {
  box = _keyboxParse(box);
  if (Array.isArray(box.wraps)) return box.wraps;
  if (box.m === "esc") return [{ t: "esc", k: box.k }];
  if (box.m === "zk") return [{ t: "pass", kdf: box.kdf, iter: box.iter, salt: box.salt, iv: box.iv, ct: box.ct }];
  return [];
}
function keyboxHasEsc(box) { return keyboxWraps(box).some((w) => w.t === "esc"); }
function keyboxEscKey(box) { const w = keyboxWraps(box).find((x) => x.t === "esc"); return w ? w.k : null; }
// "esc" ⟺ an escrow wrap is present ⟺ the server holds a raw key it could open with.
// The downgrade guard keys off this: a zk-mode device must never accept an esc box.
function keyboxMode(box) { return keyboxHasEsc(box) ? "esc" : "zk"; }
function keyboxMethods(box) { return keyboxWraps(box).map((w) => w.t); }
// Build a v2 keybox from whatever secrets are in hand. opts: {passphrase, fileKey,
// code, escrow}. Only the methods present are wrapped; escrow adds the raw key.
async function keyboxBuild(kb64, opts) {
  opts = opts || {};
  const wraps = [];
  if (opts.passphrase) wraps.push(await _keyboxWrap("pass", kb64, opts.passphrase));
  if (opts.fileKey) wraps.push(await _keyboxWrap("file", kb64, opts.fileKey));
  if (opts.code) wraps.push(await _keyboxWrap("code", kb64, opts.code));
  if (opts.escrow) wraps.push({ t: "esc", k: kb64 });
  return JSON.stringify({ v: 2, wraps });
}
// Return a NEW keybox string with `wrap` added (always v2). Migrates a v1 box to v2
// first, PRESERVING its existing wrap — so adding a method never drops the one you
// already had. A same-type wrap is REPLACED (re-issuing a recovery file/code, or
// changing the passphrase, retires the old one) while every other wrap stays intact.
function keyboxAddWrap(boxStr, wrap) {
  const wraps = keyboxWraps(boxStr).filter((w) => w.t !== wrap.t);
  wraps.push(wrap);
  return JSON.stringify({ v: 2, wraps });
}
// Return a NEW keybox string with every wrap of type `t` removed. Removing "esc"
// takes the raw key off the server; the surviving wraps still seal the SAME K, so
// nobody is locked out of the methods they kept.
function keyboxRemoveType(boxStr, t) {
  return JSON.stringify({ v: 2, wraps: keyboxWraps(boxStr).filter((w) => w.t !== t) });
}
// Open ANY keybox → the raw vault key. `opts` is a bare passphrase string
// (back-compat) OR {passphrase, fileKey, code}. Explicit recovery secrets win, then
// the passphrase, then a silent escrow unlock (the account is the key). A v2 box
// with a "pass" wrap but no secret in hand asks for the passphrase, exactly like v1.
async function keyboxOpen(boxStr, opts) {
  const box = JSON.parse(boxStr);
  const o = (opts && typeof opts === "object") ? opts : { passphrase: opts || "" };
  const wraps = keyboxWraps(box);
  const find = (t) => wraps.find((w) => w.t === t);
  if (o.code && find("code")) return _keyboxUnwrap(find("code"), o.code);
  if (o.fileKey && find("file")) return _keyboxUnwrap(find("file"), o.fileKey);
  if (o.passphrase && find("pass")) return _keyboxUnwrap(find("pass"), o.passphrase);
  const esc = find("esc"); if (esc) return esc.k;
  if (find("pass")) throw new Error("zero-knowledge vault — enter your passphrase once on this device");
  throw new Error("no unlock method for this vault on this device — use your recovery file or code");
}
// ── Recovery secrets (the nets that keep a forgotten passphrase from meaning "gone") ──
// Both are high-entropy secrets that wrap the SAME vault key K, side by side in the
// keybox. The FILE holds its secret in a downloaded .cachekey (nothing to memorize);
// the CODE is shown once for paper / a password manager. Neither is stored by the app
// after it is wrapped — the user holds it — so re-issuing mints a fresh one.
function _b64url(buf) { return _b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
// Crockford base32 — no I L O U, so it can't be misread on paper or turn into a word.
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function recoveryFileSecret() { return _b64url(crypto.getRandomValues(new Uint8Array(32))); }   // 256-bit file secret
function recoveryCode() {
  // 20 chars × 5 bits = 100 bits. 256 % 32 === 0, so byte % 32 is perfectly uniform (no modulo bias).
  const b = crypto.getRandomValues(new Uint8Array(20));
  let s = ""; for (let i = 0; i < b.length; i++) { if (i && i % 5 === 0) s += "-"; s += RECOVERY_ALPHABET[b[i] % 32]; }
  return s;   // XXXXX-XXXXX-XXXXX-XXXXX
}
// Forgiving normalize: uppercase, map the classic look-alikes (O→0, I/L→1), then keep
// only alphabet chars (drops the dashes and any stray spaces). Idempotent on a real code.
function recoveryCodeNormalize(s) {
  s = String(s || "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  let out = ""; for (const c of s) if (RECOVERY_ALPHABET.indexOf(c) >= 0) out += c;
  return out;
}
function recoveryFilePayload(secret) {
  return { app: "thecache", kind: "recovery-file", v: 1, secret: secret,
    note: "This is a recovery key for your Cache. Anyone who has this file can open your cache, so keep it somewhere safe and private (a password manager, a USB stick, a printout in a drawer). If you ever get locked out, open the app, choose “I can’t get in”, and load this file." };
}
// Pull the secret back out of an uploaded .cachekey. Returns null on anything that
// isn't one of our recovery files, so the caller can say so plainly.
function parseRecoveryFile(text) {
  let o; try { o = JSON.parse(text); } catch (e) { return null; }
  if (!o || o.kind !== "recovery-file" || typeof o.secret !== "string" || !o.secret) return null;
  return o.secret;
}
async function downloadEncryptedBackup(pass) {
  const d = await (await fetch("/api/export-data")).json();
  if (!d || !d.ok) throw new Error("couldn't read your data");
  const env = await encryptJSON({ files: d.files, exported: d.exported }, pass);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([env], { type: "application/octet-stream" }));
  a.download = "cache-backup-" + new Date().toISOString().slice(0, 10) + ".cache";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  return d.count || Object.keys(d.files || {}).length;
}
// Download the recovery key as a small .cachekey file. Returns true on a real click —
// callers MUST treat a thrown error / falsy as "the net did NOT land" and say so
// loudly, never proceed as if the user is protected.
function downloadRecoveryFile(secret) {
  const payload = JSON.stringify(recoveryFilePayload(secret), null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  a.download = "cache-recovery-" + new Date().toISOString().slice(0, 10) + ".cachekey";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  return true;
}
async function restoreEncryptedBackup(file, pass) {
  let obj;
  try { obj = await decryptJSON(await file.text(), pass); }
  catch (e) { throw new Error("wrong passphrase or not a Cache backup file"); }
  const res = await (await fetch("/api/import-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: (obj && obj.files) || {}, filesMeta: (obj && obj.filesMeta) || {}, local: snapshotLocal() }) })).json();
  if (!res || !res.ok) throw new Error((res && res.error) || "restore failed");
  return res;
}
// Encrypt locally (browser, E2E) then hand the ciphertext to the local server to PUT
// onto the user's own WebDAV — the WebDAV host only ever sees the sealed blob.
async function pushBackupToWebdav(pass) {
  const d = await (await fetch("/api/export-data")).json();
  if (!d || !d.ok) throw new Error("couldn't read your data");
  const env = await encryptJSON({ files: d.files, exported: d.exported }, pass);
  const fn = "cache-backup-" + new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "") + ".cache";
  const res = await (await fetch("/api/webdav-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: fn, data: env }) })).json();
  if (!res || !res.ok) throw new Error((res && res.error) || "push failed");
  return fn;
}

// ── The Cache cloud (PocketBase) — accounts + an E2E-encrypted blob sync. The browser
//    talks to PocketBase over its REST API with fetch (no SDK); the data is encrypted
//    here with the passphrase before it ever leaves, so PocketBase only stores ciphertext.
const CLOUD_KEY = "money.cloud";
const CLOUD_DEFAULT_URL = "https://thecache.pockethost.io";
function cloudState() { try { return JSON.parse(localStorage.getItem(CLOUD_KEY) || "{}") || {}; } catch (e) { return {}; } }
function cloudSaveState(s) { localStorage.setItem(CLOUD_KEY, JSON.stringify(s)); }
function cloudUrl() { return ((cloudState().url || CLOUD_DEFAULT_URL) + "").replace(/\/+$/, ""); }
function cloudErr(d) {
  if (!d) return "";
  try { const f = Object.values(d.data || {})[0]; if (f && f.message) return f.message; } catch (e) {}
  return d.message || "";
}
async function cloudLogin(url, email, password) {
  const base = (url || "").replace(/\/+$/, "");
  const r = await fetch(base + "/api/collections/users/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }) });
  const d = await r.json();
  if (!r.ok || !d.token) throw new Error(cloudErr(d) || "login failed");
  const prev = cloudState();
  const newUid = d.record && d.record.id;
  if (prev.parked && newUid) {
    // The previous session was PARKED by logout: its silo already holds its data and the live
    // slot was cleared. RESTORE the incoming account's silo (a clean slate if it's new here) —
    // and never stash first: the live slot is empty, so stashing it would overwrite the parked
    // account's good silo with nothing. Clear the live slot before loading so anything a
    // logged-out visitor scribbled into the empty cache can't blend into the restored account.
    clearAccountData();
    try { window.__cacheStorageSwapped = true; } catch (e) {}   // mute unload-time savers — the page's in-memory state predates this swap
    if (!loadAccountData(newUid)) {
      // the restore itself ran out of storage midway — wipe the partial copy and ABORT.
      // Nothing is lost: the state is still parked and the silo untouched, so the next
      // login retries a clean restore once space is freed.
      clearAccountData();
      throw new Error("Not enough storage to restore this account safely — free up space and try again. Your data is safe.");
    }
    _cloudLoginRestored = true;   // the board booted from the empty slot — the caller must reload
    if (newUid !== prev.userId) {
      // a DIFFERENT account than the parked one → it must not inherit the parked account's
      // vault key, seal-mode memory, record pointer, or sync marks
      cloudKeySet(""); prev.recordId = null; prev.lastPush = null; prev.lastHash = null; prev.lastSeenVault = null; prev.mode = null;
    }
  } else if (prev.userId && newUid && newUid !== prev.userId) {
    // FULL per-account isolation: silo the outgoing account's ENTIRE local cache (deck, tasks,
    // journal, layout, forms, character — AND its @handle, private key, message cache) under its
    // userId, then load the incoming account's silo (a clean slate if it's new here), so this
    // account can never inherit another's data and switching back restores each account exactly.
    // If the outgoing account can't be safely siloed (storage full), ABORT the whole login BEFORE
    // relabeling the session — never leave the session pointing at the new account while the old
    // account's data (incl. its private key) is still live, or a later backup would seal one
    // account's data into another's vault. Data stays untouched on abort.
    if (!stashAccountData(prev.userId)) throw new Error("Not enough storage to switch accounts safely — free up space (or back up and remove an account's cloud copy) and try again. Your data is untouched.");
    // The outgoing account is now safely parked in its silo. Record that BEFORE restoring the
    // incoming one: if the restore below fails (storage), the login aborts into a clean PARKED
    // state — both silos intact, live slot clear — and the next attempt heals itself through
    // the parked path instead of leaving a half-restored hybrid labeled as the old session.
    // VERIFY the write landed: a swallowed failure here would leave the state saying "live
    // session" over a cleared slot, and the next logout would stash that emptiness over the
    // good silo. If it didn't land, un-stash (put the live copy back) and abort unchanged.
    try { cloudSaveState(Object.assign({}, prev, { token: "", parked: true })); } catch (e) {}
    if (cloudState().parked !== true) { loadAccountData(prev.userId); throw new Error("Not enough storage to switch accounts safely — free up space and try again. Your data is untouched."); }
    try { window.__cacheStorageSwapped = true; } catch (e) {}   // mute unload-time savers — they hold the outgoing account's world
    if (!loadAccountData(newUid)) { clearAccountData(); throw new Error("Not enough storage to restore this account safely — free up space and try again. Your data is safe."); }
    cloudKeySet(""); prev.recordId = null; prev.lastPush = null; prev.lastHash = null; prev.lastSeenVault = null; prev.mode = null;
  }
  // same account → mode RIDES ALONG: the zero-knowledge downgrade guard reads it,
  // and losing it on a routine re-login would disarm the guard exactly when a
  // tampering server would love that. `parked` is deliberately NOT carried — a
  // successful login always un-parks (the account's data is live again).
  cloudSaveState({ url: base, token: d.token, email: (d.record && d.record.email) || email, userId: newUid, recordId: prev.recordId, lastPush: prev.lastPush, lastHash: prev.lastHash, lastSeenVault: prev.lastSeenVault, mode: prev.mode || null, verified: !!(d.record && d.record.verified) });
  return d;
}
// Set when cloudLogin restored a parked silo — the board/theme/character booted from the empty
// live slot, so the login UI must reload to render the restored account (see reloadIfSwitched).
let _cloudLoginRestored = false;
async function cloudSignup(url, email, password) {
  const base = (url || "").replace(/\/+$/, "");
  const r = await fetch(base + "/api/collections/users/records", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, passwordConfirm: password }) });
  const d = await r.json();
  if (!r.ok) throw new Error(cloudErr(d) || "sign up failed");
  // ask the cloud to send the verification email (fire-and-forget — delivers
  // once SMTP is configured on the instance; harmless before that)
  try { fetch(base + "/api/collections/users/request-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => {}); } catch (e) {}
  return cloudLogin(base, email, password);   // auto log in
}
function cloudLogout() {
  const s = cloudState();
  cloudKeySet("");   // drop this device's vault data key (explicit logout is stricter than an expiry)
  // PARK the account: silo its entire decrypted world (deck, tasks, journal, notes, @handle,
  // ECDH private key, message cache, __lmeta) under cacheprof.<userId> and CLEAR the live slot,
  // so the next person at a shared computer meets an empty cache — not this account's life.
  // `parked` tells the next login "the silo already holds this account's data — RESTORE it,
  // don't stash the (now empty) live slot over it". Two guarded edges:
  //   · silo write failed (quota) → keep the data LIVE and don't park; losing data is worse
  //     than leaving it visible on this one device (stashAccountData never deletes on failure).
  //   · already parked (double logout) → skip the stash entirely; re-stashing the empty live
  //     slot would overwrite the good silo with nothing.
  const parked = s.parked ? true : stashAccountData(s.userId);
  if (parked) try { window.__cacheStorageSwapped = true; } catch (e) {}   // mute unload-time savers (saveStats) — they'd write the parked data back into the cleared slot
  // Same shape as an expired session (see cloudAuthCheck): drop only the TOKEN, KEEP the
  // account pointer (userId/email/mode + sync marks). Wiping userId would blind cloudLogin's
  // different-account guard, so the NEXT account to log in on this browser would inherit the
  // previous one's messaging identity — its @handle AND private key. Keeping userId means a
  // switch to a different account correctly clears money.social/msgKey/dms.
  cloudSaveState({ url: s.url || CLOUD_DEFAULT_URL, email: s.email, userId: s.userId, recordId: s.recordId, mode: s.mode || null, lastPush: s.lastPush, lastHash: s.lastHash, lastSeenVault: s.lastSeenVault, parked: !!parked });
  return !!parked;   // callers reload on true (board renders from memory); warn on false with a live account
}
// PocketBase auth tokens expire (~14 days). Refresh on every real cloud touch so
// regular use never logs you out — and when a session is truly dead, log out
// honestly instead of letting requests degrade to guest and fail with a cryptic
// "Failed to create record."
async function cloudAuthCheck() {
  const s = cloudState();
  if (!s.token) return false;
  try {
    const r = await fetch(cloudUrl() + "/api/collections/users/auth-refresh", { method: "POST", headers: { Authorization: s.token } });
    if (r.status === 401 || r.status === 403) {
      // keep email/userId/mode — re-login is one password away, the same-account
      // check needs userId, and the zk guard must survive an expiry round-trip.
      // `parked` rides along too: dropping it would make the next login stash the
      // empty live slot over a parked account's good silo (undefined just falls out)
      cloudSaveState({ url: s.url, email: s.email, userId: s.userId, recordId: s.recordId, mode: s.mode || null, lastPush: s.lastPush, lastHash: s.lastHash, lastSeenVault: s.lastSeenVault, parked: s.parked });
      return false;
    }
    if (r.ok) {
      const d = await r.json();
      if (d && d.token) cloudSaveState(Object.assign(cloudState(), { token: d.token, userId: (d.record && d.record.id) || s.userId, email: (d.record && d.record.email) || s.email, verified: !!(d.record && d.record.verified) }));
    }
    return true;  // 5xx → don't log out over a server blip
  } catch (e) { return true; }  // offline → keep state; the op itself surfaces the network error
}
// If two devices ever raced a first push (or both hit the 404-recreate path) the account
// can hold TWO vault records. Without an explicit sort, each device could latch a
// DIFFERENT one via items[0] — permanent split-brain, both chips green over different
// vaults. An explicit sort makes every device agree on ONE canonical vault; the loser's
// content folds back in via merge-before-seal.
// ⚠️ Sort by `id`, NEVER by `created`/`updated`. Those are AUTODATE fields, and a
// PocketBase collection only has them if they were explicitly defined — ours does not.
// Sorting on a field the collection lacks makes PocketBase reject the whole request with
// a 400, which bricked every vault read (desktop push/pull AND the web unlock gate — it
// stranded the user on a dead "Unlock my cache" button). `id` is guaranteed to exist and
// is identical on every device, which is the only property this sort actually needs:
// canonical, not chronological.
// (The real belt-and-braces fix is a unique index on `owner` in the vaults collection.)
const VAULT_Q = "?perPage=1&sort=id&filter=";
async function cloudFindVaultId(s) {
  // always ask the server for the real current record (never trust a cached id — it can go stale
  // if the record was cleared, and then a PATCH 404s with "resource wasn't found")
  const r = await fetch(cloudUrl() + "/api/collections/vaults/records" + VAULT_Q + encodeURIComponent("owner='" + s.userId + "'"), { headers: { Authorization: s.token } });
  const d = await r.json();
  if (!r.ok) throw new Error(cloudErr(d) || "couldn't reach the vault (is the 'vaults' collection created?)");
  return d.items && d.items[0] ? d.items[0].id : null;
}
// ── Per-key merge classification ─────────────────────────────
// Three classes of money.* key decide how a key crosses devices:
//   INTERNAL — never rides the vault. Two reasons a key doesn't sync:
//     · cloud/identity internals (the data key, device slot, sync toggles), and
//     · device-ergonomic geometry (zoom, sidebar width, stats-scroll, modal
//       positions) — these are per-device by nature; syncing them made the phone
//       snap to desktop-pixel layout on every unlock.
//   SPECIAL  — has its own dedicated merge (union, EXP-ledger, rev, min); handled
//              explicitly in mergeRemoteLocal so nothing accumulator-shaped is lost.
//   GENERIC  — everything else (layout, look, config, note, forecast, cats…);
//              per-key newest-wins by an mtime stamp so a stale device can't revert
//              a fresher edit and the web app can't blind-adopt on every unlock.
const CLOUD_INTERNAL_KEYS = ["money.cloud", "money.cloudKey", "money.cloudPaused", "money.deviceId", "money.__lmeta", "money.deckRev"];   // deckRev is RETIRED (per-item `updated` replaced it) — excluded from the vault AND the witness, or two converged devices would hash differently forever
// device-ergonomic geometry — pinned to the device that set it, never synced
const DEVICE_LOCAL_KEYS = ["money.dockMobile", "money.zoom", "money.gutter", "money.sidebar", "money.sidebarWidth", "money.statsScroll", "money.icons.collapsed", "money.balExpanded", "money.settings", "money.connect", "money.wiki", "money.timerRun", "money.deckDay", "money.dms", "money.simplefin"];   // + deckDay (calendar) + dms (messages cache) + simplefin (the browser bank credential — a bearer secret; DEVICE-LOCAL so it never rides the vault, same as the desktop's chmod-600 .simplefin file; see WIKI 2026-07-24-bank-credential-device-only)
const SPECIAL_MERGE_KEYS = ["money.log", "money.logPending", "money.deck", "money.things", "money.forms", "money.formData", "money.charLog", "money.profile", "money.badges", "money.customStats", "money.charSince", "money.notifs", "money.bugCredits"];   // + forms/formData (reuse the things per-item merge) + notifs (per-id newest-wins read state) + bugCredits (union by report id, like badges)
// the user-authored data/ files that merge key-wise across devices (via the backend's
// /api/merge-maps + the vault's filesMeta sidecar) — everything else in the files
// bundle is engine-computed and travels whole-file. catmeta.json (your category
// renames, fold-ins and custom categories) is user-authored too, so it merges here
// rather than being stranded per-device.
const MAP_FILE_NAMES = ["categories.json", "income.json", "subs.json", "income_links.json", "catmeta.json", "deleted.json"];
function isInternalKey(k) { return CLOUD_INTERNAL_KEYS.indexOf(k) !== -1 || DEVICE_LOCAL_KEYS.indexOf(k) !== -1; }
function isSpecialKey(k) { return SPECIAL_MERGE_KEYS.indexOf(k) !== -1; }
function isGenericKey(k) { return k.indexOf("money.") === 0 && !isInternalKey(k) && !isSpecialKey(k); }
// ── per-account local isolation (one browser, many accounts) ─────────────────
// Each account's data is siloed so logging in as B never shows — or absorbs — A's
// cache. The silo lives OUTSIDE the "money." namespace (prefix "cacheprof.") so the
// vault/sync engine, which only ever touches money.*, never sees it. Account-scoped =
// every money.* key that isn't a device/cloud internal, PLUS money.dms (device-local by
// sync-class, but it IS this account's message cache). money.cloudKey (the vault key) is
// deliberately NOT siloed — the switch clears it so no account keeps another's key.
const PROFILE_PREFIX = "cacheprof.", LMETA_KEY = "money.__lmeta";
function isAccountDataKey(k) {
  if (typeof k !== "string" || k.indexOf("money.") !== 0) return false;
  if (isInternalKey(k)) return k === "money.dms" || k === "money.simplefin";       // internals aren't account data — except dms (this account's messages) and simplefin (this account's BANK CREDENTIAL: keep it out of the vault, but silo it per account + clear it on logout, so a shared browser never lets one account pull another's bank)
  if (DEVICE_LOCAL_KEYS.some((dk) => k.indexOf(dk + ".") === 0)) return false;     // a suffixed device key stays device-scoped (e.g. money.settings.w modal geometry)
  return true;
}
function accountDataKeys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isAccountDataKey(k)) out.push(k); } return out; }
// Save this account's whole local cache — PLUS its money.__lmeta merge bookkeeping, so its
// un-pushed generic edits keep winning merges after a round-trip — to its silo, THEN clear the
// active slot. Returns false WITHOUT deleting anything if the silo can't be written (quota), so a
// failed write never destroys the outgoing account's data.
function stashAccountData(uid) {
  if (!uid) return false;
  const keys = accountDataKeys(), snap = {};
  keys.forEach((k) => { snap[k] = localStorage.getItem(k); });
  const lm = localStorage.getItem(LMETA_KEY); if (lm != null) snap[LMETA_KEY] = lm;
  let ok = false;
  try { localStorage.setItem(PROFILE_PREFIX + uid, JSON.stringify(snap)); ok = true; } catch (e) {}
  if (!ok) return false;   // couldn't silo it → keep the live data put; never delete what wasn't saved
  keys.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  try { localStorage.removeItem(LMETA_KEY); } catch (e) {}   // its own __lmeta went into the silo; the incoming account's is loaded next (or absent = fresh)
  return true;
}
// Restore this account's siloed cache + its __lmeta (clean slate + fresh bookkeeping if it's new
// here). Returns false if any key FAILED to restore (quota — possible when other accounts' silos
// grew since this one was stashed): a silent partial restore would look like a working login with
// missing data, and the NEXT logout would stash that partial copy over the good silo, making the
// loss permanent. Callers abort into a clean parked state instead (the silo keeps everything).
function loadAccountData(uid) {
  if (!uid) return true;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PROFILE_PREFIX + uid) || "null"); } catch (e) {}
  if (!saved || typeof saved !== "object") return true;   // new on this device → clean slate
  let ok = true;
  Object.keys(saved).forEach((k) => { if (isAccountDataKey(k) || k === LMETA_KEY) { try { localStorage.setItem(k, saved[k]); } catch (e) { ok = false; } } });
  return ok;
}
// Wipe the live account-data slot (incl. __lmeta), leaving device keys + silos untouched. Used
// by the parked-restore login path: the desktop app is usable while logged out, so a logged-out
// visitor may have scribbled into the empty slot — restore must be CLEAN, never a blend of a
// stranger's scratch data and the account's real life. (In the switch path the stash already
// performed this clear, so only parked logins need it explicitly.)
function clearAccountData() {
  accountDataKeys().forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  try { localStorage.removeItem(LMETA_KEY); } catch (e) {}
}
// (switchAccountData is RETIRED: cloudLogin composes stash → interim parked-save → guarded load
//  directly, so a restore failure aborts into a clean parked state instead of a silent partial.)
// djb2 — a cheap content fingerprint so we can tell a real local edit apart from a
// key we merely re-read (must match webcache.js's wLhash exactly).
function lhash(s) { let h = 5381; s = s || ""; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }
// Deterministic total order used to break an EXACT mtime tie so two devices pick the
// same winner and converge (must match webcache.js's _wValWins). Higher djb2 wins;
// a hash collision falls back to string compare — strictly asymmetric for a!==b.
function _valWins(a, b) { const ha = lhash(a), hb = lhash(b); return ha > hb || (ha === hb && a > b); }
function lmetaGet() { try { return JSON.parse(localStorage.getItem("money.__lmeta") || "{}") || {}; } catch (e) { return {}; } }
function lmetaSet(m) { try { localStorage.setItem("money.__lmeta", JSON.stringify(m)); } catch (e) {} }
// Give every generic key a per-key mtime. A newly-seen key claims NOTHING (m:0) so
// simply shipping this code never lets a key win a merge; only a real edit (its
// content hash changed since the last stamp) claims Date.now() and thus outranks an
// un-edited copy on another device. Idempotent — safe to call on every push/pull.
function stampGeneric(lm) {
  lm = lm || lmetaGet();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isGenericKey(k)) continue;
      const v = localStorage.getItem(k), h = lhash(v), cur = lm[k];
      if (!cur) lm[k] = { m: 0, h };
      else if (cur.h !== h) lm[k] = { m: Date.now(), h };
    }
  } catch (e) {}
  lmetaSet(lm);
  return lm;
}
// The mtimes to seal alongside a snapshot (generic keys only; special keys carry
// their own ordering). Old vaults simply lack this map — read as {} → all mtime 0.
function buildLocalMeta(localSnap) {
  const lm = lmetaGet(), out = {};
  Object.keys(localSnap).forEach((k) => { if (isGenericKey(k)) out[k] = (lm[k] && +lm[k].m) || 0; });
  return out;
}
// ── authored-layer witness (concurrency-honest sync) ─────────────
// A content fingerprint over just the AUTHORED (mergeable) layer — the localStorage
// snapshot + the four user-edit maps, VALUES ONLY. It answers one question after
// merge-before-seal: does the vault ALREADY hold every authored edit we have? If yes,
// the push short-circuit (and the pull-side chip) may honestly say "synced"; if a
// concurrent overwrite silently dropped one of our edits, ours differs from the
// vault's and we re-seal instead of falsely claiming cloud ✓. Deliberately EXCLUDES
// the engine files (balances/transactions/ledger/monthly/coverage), api, and mtimes —
// those are last-writer-wins and would make peers' bank-sync churn livelock this.
// Canonicalizes recursively (sorted keys, parsed JSON values) so two devices that
// serialize the same data in different key orders don't ping-pong corrective pushes.
function _canonVal(v) {
  if (Array.isArray(v)) return v.map(_canonVal);
  if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = _canonVal(v[k]); }); return o; }
  return v;
}
function _canonStr(s) {
  if (typeof s !== "string") return s;
  try { const v = JSON.parse(s); if (v && typeof v === "object") return _canonVal(v); } catch (e) {}
  return s;   // plain string (note, theme, a number) — compared as-is
}
// The set-union / keep-local SPECIAL keys converge to a SET with device-LOCAL order
// (log/logPending/charLog/badges appended in each device's own order) — and customStats
// keeps its label device-local. Byte-hashing them would see two converged devices as
// forever "ahead" and re-push every poll (a livelock). So the witness hashes each such
// key's CONVERGENT projection: entries sorted by their dedup identity, and for
// customStats only id+marks (the parts the merge actually makes equal). Order-significant
// keys (money.deck) and lattice keys (money.profile) are left to _canonStr — they
// converge to byte-identical content on their own (deck by rev, profile by EXP-ledger).
function _ckLog(e) { return (e && e.at || 0) + "|" + (e && e.itemId || ""); }
function _ckChar(e) { return (e && e.t || 0) + "|" + (e && e.k || "") + "|" + (e && e.d || ""); }
function _sortBy(arr, keyfn) { return arr.slice().sort((a, b) => { const x = keyfn(a), y = keyfn(b); return x < y ? -1 : x > y ? 1 : 0; }); }
function _authoredProject(k, str) {
  try {
    const v = JSON.parse(str);
    if ((k === "money.log" || k === "money.logPending") && Array.isArray(v)) return _sortBy(v, _ckLog).map(_canonVal);
    if (k === "money.charLog" && Array.isArray(v)) return _sortBy(v, _ckChar).map(_canonVal);
    if (k === "money.badges" && Array.isArray(v)) return v.slice().map(String).sort();
    if (k === "money.customStats" && Array.isArray(v)) return _sortBy(v.filter((s) => s && s.id), (s) => s.id).map((s) => ({ id: s.id, marks: (s.marks || []).slice().sort() }));
    // bugCredits unions by report id but each device APPENDS in its own claim order, and
    // on an id both hold the union keeps the LOCAL entry (an `at` can differ by clock) —
    // so project to the converged parts only (id + exp), sorted by id. Hashing the raw
    // array would read two converged devices as forever "ahead" (the livelock class).
    if (k === "money.bugCredits" && Array.isArray(v)) return _sortBy(v.filter((c) => c && c.id), (c) => c.id).map((c) => ({ id: c.id, exp: +c.exp || 0 }));
    // money.profile converges ONLY on its EXP-ledger core (expBy slot-max, exp=sum,
    // clicks=max). stats.dev is a per-device id the merge never reconciles, and
    // name/role/note are richer-wins (device-local at equal exp) — hashing them raw
    // would make two synced devices forever "ahead" (a livelock). Project to the core.
    if (k === "money.profile" && v && typeof v === "object") {
      const s = v.stats || {}, by = {};
      Object.keys(s.expBy || {}).sort().forEach((d) => { by[d] = +s.expBy[d] || 0; });
      return { exp: +s.exp || 0, clicks: +s.clicks || 0, expBy: by };
    }
    // the deck is now a per-item MERGE, not an ordered document — hash it by id so two
    // devices that converged on the same items can't read as forever "ahead" of each
    // other over array order (the livelock class this codebase keeps rediscovering)
    if (k === "money.deck" && Array.isArray(v)) return _sortBy(v.filter((q) => q && q.id), (q) => q.id).map(_canonVal);
    // money.things — per-item merge like the deck: hash by id (array-order-insensitive so
    // two converged devices don't read as forever "ahead"), and via _canonVal it includes
    // `ord`, so a REAL reorder still registers. Without this branch a SPECIAL key falls
    // through to the order-sensitive canonicalizer → infinite corrective-push ping-pong.
    if (k === "money.things" && Array.isArray(v)) return _sortBy(v.filter((q) => q && q.id), (q) => q.id).map(_canonVal);
    // money.forms (templates) + money.formData (submissions) are per-item merges too
    // (they reuse the things algorithm) — hash them by id, array-order-insensitive, so two
    // converged devices don't read as forever "ahead" (the corrective-push livelock). Via
    // _canonVal this still includes `ord`, so a real reorder registers.
    if (k === "money.forms" && Array.isArray(v)) return _sortBy(v.filter((q) => q && q.id), (q) => q.id).map(_canonVal);
    if (k === "money.formData" && Array.isArray(v)) return _sortBy(v.filter((q) => q && q.id), (q) => q.id).map(_canonVal);
    // money.notifs — per-id read state {id:{read,at}}: project each entry to normalized
    // {at, read} NUMBERS with sorted ids, so two converged devices hash identically even
    // if one writer stored read:true, a different key order, or a stray extra field.
    // Without this a SPECIAL key that converges by value could still differ by bytes →
    // the corrective-push livelock this codebase keeps rediscovering.
    if (k === "money.notifs" && v && typeof v === "object" && !Array.isArray(v)) {
      const o = {};
      Object.keys(v).sort().forEach((id) => { const e = v[id]; if (e && typeof e === "object") o[id] = { at: +e.at || 0, read: e.read ? 1 : 0 }; });
      return o;
    }
  } catch (e) {}
  return _canonStr(str);
}
// catmeta's `custom` is a UNION-merged list — two devices holding the same custom
// categories in a different order would read as permanently "ahead" of each other and
// re-push forever. The backend writes it sorted; project it here too so even a copy
// written by an older build can't start that churn.
function _mapProject(name, str) {
  if (name === "catmeta.json") {
    try {
      const v = JSON.parse(str);
      if (v && typeof v === "object") {
        const c = Array.isArray(v.custom) ? v.custom.map(String).sort() : [];
        return _canonVal(Object.assign({}, v, { custom: c }));
      }
    } catch (e) {}
  }
  return _canonStr(str);
}
function authoredHash(local, maps) {
  // filter to the keys snapshotLocal actually seals — an OLD vault blob can still
  // carry since-reclassified device-local keys (zoom, sidebar…) in its local layer,
  // and hashing them would make the witness "ahead" of a vault we can never equal
  const L = {}; Object.keys(local || {}).sort().forEach((k) => { if (isInternalKey(k)) return; L[k] = _authoredProject(k, local[k]); });
  const M = {}; MAP_FILE_NAMES.forEach((n) => { if (maps && maps[n] != null) M[n] = _mapProject(n, maps[n]); });
  const str = JSON.stringify({ local: L, maps: M });
  let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return str.length + ":" + h;
}
// Snapshot the user's money.* localStorage (deck, daily log, base, config) — the setup that
// makes the app YOURS — so it rides in the encrypted bundle to any device. Excludes the auth token.
function snapshotLocal() {
  const out = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("money.") === 0 && !isInternalKey(k)) out[k] = localStorage.getItem(k); } } catch (e) {}
  return out;
}
// Manual "Restore from cloud" is a MERGE, not a wipe: route it through the same
// per-key rules as an auto-pull so unpushed local check-ins / EXP / edits survive.
function restoreLocal(local, meta) {
  if (!local || typeof local !== "object") return 0;
  return mergeRemoteLocal(local, meta || {}) ? 1 : 0;
}
// opts (all optional, only the signup/settings flows pass them):
//   escrow  — the user explicitly chose to keep a spare key with The Cache. Decides
//             the FIRST keybox's shape; never inferred from an empty passphrase.
// Existing/auto pushes pass no opts and behave exactly as before. Recovery FILE/CODE
// wraps are added AFTER the first push via cloudUpdateKeybox, never folded in here —
// so background pushes can never accidentally rewrite or drop a recovery wrap.
async function cloudPush(passphrase, opts) {
  opts = opts || {};
  if (!cloudState().token) throw new Error("log in first");
  if (cloudPaused()) throw new Error("cloud sync is off — flip “Sync to cloud” on first (nothing leaves this device while it's off)");
  if (!(await cloudAuthCheck())) throw new Error("your login expired — log in again in Step 1 (your data is safe)");
  const s = cloudState();  // fresh token after the refresh
  const hdr = { Authorization: s.token, "Content-Type": "application/json" };
  // fetch the current record once — we need its keybox (to adopt the data key on a
  // new device) and, on the web, its blob (to preserve the financial data)
  let id = await cloudFindVaultId(s), rec = null;
  if (id) { try { rec = await (await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { headers: { Authorization: s.token } })).json(); } catch (e) {} }
  // a record exists but we couldn't READ it → stop. Guessing here could write a
  // fresh escrow keybox over a zero-knowledge one — never act blind on the keybox.
  if (id && (!rec || !rec.id)) throw new Error("cloud hiccup — couldn't read your vault, try again");
  const wantZk = !!(passphrase && passphrase.length >= 6);
  const curBox = rec && rec.keybox ? JSON.parse(rec.keybox) : null;
  const curMode = curBox ? keyboxMode(curBox) : null;   // "esc" ⟺ an escrow wrap is present (v1 or v2)
  if (curBox) keyboxGuard(curBox);   // BEFORE any adoption — never touch a downgraded keybox
  // make sure this device holds the data key: adopt from the keybox, or mint one
  let kb = cloudKeyGet(), mintedKey = false;
  const escK = curBox ? keyboxEscKey(curBox) : null;   // the raw escrow key, from either shape (null if no escrow wrap)
  if (kb && escK && escK !== kb) { kb = escK; cloudKeySet(kb); }  // server keybox is the authority — heal key divergence (escrow only)
  if (!kb && curBox) { kb = await keyboxOpen(rec.keybox, passphrase || ""); cloudKeySet(kb); }
  if (!kb) {
    // a zero-knowledge account whose keybox vanished must ask BEFORE minting —
    // a junk key stored here would shadow the real one forever
    if ((curMode === "zk" || (!curMode && s.mode === "zk")) && !wantZk) throw new Error("your zero-knowledge key needs re-sealing — enter your passphrase (Step 2) once");
    // v1 → v2 migration: v1 vaults were always passphrase-sealed, so require the
    // passphrase once — zero-knowledge intent must never silently become escrow
    let isV1 = false; try { isV1 = !!(rec && rec.blob) && (JSON.parse(rec.blob).v || 1) < 2; } catch (e) {}
    if (isV1 && !wantZk) throw new Error("this vault is sealed with your passphrase — enter it once (Step 2) to upgrade it");
    kb = await cloudGenKey(); cloudKeySet(kb); mintedKey = true;
  }
  // held-key validation: if a zero-knowledge vault was re-sealed on another device
  // (key rotation), sealing with this stale key would FORK the vault — check the
  // held key actually opens the current blob before trusting it
  if (kb && !mintedKey && curMode === "zk" && rec && rec.blob) {
    let v2 = false; try { v2 = (JSON.parse(rec.blob).v || 1) >= 2; } catch (e) {}
    if (v2) {
      try { await cloudOpen(rec.blob, ""); }
      catch (e) { cloudKeySet(""); throw new Error("this vault was re-sealed on another device — enter your passphrase (Step 2) once to catch up"); }
    }
  }
  // gather the payload BEFORE any key rotation — the web branch must open the
  // existing blob with the CURRENT key, and must never overwrite real financial
  // data with an empty bundle just because the open failed
  let files = {}, api = {}, exported, filesMeta = {}, curLocal = null, curLocalMeta = null, vaultAuthored = null;
  let _foldedMoney = null;   // web: the CSV deltas this push is sealing — confirmed only after upload lands (so a failed push stays retryable)
  if (window.__CACHE_WEB__) {
    if (rec && rec.blob) { const cur = await cloudOpen(rec.blob, passphrase); files = cur.files || {}; api = cur.api || {}; exported = cur.exported; filesMeta = cur.filesMeta || {}; curLocal = cur.local || null; curLocalMeta = cur.localMeta || null; vaultAuthored = authoredHash(cur.local || {}, cur.files || {}); }
    // web money WRITER (the ONE narrow write): fold this session's CSV imports into the
    // vault's FRESHEST ledger — never this device's possibly-stale copy — so a concurrent
    // desktop bank sync is never lost. mergeLedger is append-only + honors tombstones, so
    // re-running this on every push is idempotent (the content-hash short-circuit then makes
    // repeats free). The imported money files (ledger/balances/transactions) aren't in
    // MAP_FILE_NAMES, so the authored-hash witness is unaffected.
    // total/cash/accounts/burn/spend_window are the REAL bank balances from the last in-browser
    // SimpleFIN pull. They can't be re-derived from a transaction ledger, so the fold below
    // (rebuildFromLedger) drops them — grab the freshest live copy from the served store BEFORE
    // the fold overwrites it, then carry it into the sealed vault so a reload of this tab AND
    // every other device keep the balances, not just the transactions. (No-op for a CSV-only
    // session — those fields are simply absent, so the guard skips them.)
    let _liveBalHdr = null;
    try { if (window.__cacheWebMoney) { const lb = JSON.parse((window.__cacheWebMoney.getFiles() || {})["balances.json"] || "{}"); _liveBalHdr = { total: lb.total, cash: lb.cash, accounts: lb.accounts, burn_per_day: lb.burn_per_day, spend_window_days: lb.spend_window_days, updated: lb.updated }; } } catch (e) {}
    try {
      if (window.__cacheMoneyApplyToVault) {
        const applied = window.__cacheMoneyApplyToVault(files);
        if (applied) {
          files = applied.files;
          // carry the real bank balances into the vault copy (they survive the ledger rebuild)
          if (_liveBalHdr && files["balances.json"]) {
            try {
              const vb = JSON.parse(files["balances.json"]);
              ["total", "cash", "accounts", "burn_per_day", "spend_window_days", "updated"].forEach((f) => { if (_liveBalHdr[f] !== undefined) vb[f] = _liveBalHdr[f]; });
              files["balances.json"] = JSON.stringify(vb, null, 2); applied.files["balances.json"] = files["balances.json"];
            } catch (e) {}
          }
          _foldedMoney = applied.folded || null;
          // drop any stale precomputed summary from the sealed vault — every web reader
          // (this device and others) computes /api/summary LIVE from the merged ledger,
          // which also keeps a mixed desktop+CSV cache correct. A now-dependent mtd summary
          // would otherwise churn the content hash and re-upload on every push.
          if (api && typeof api === "object") delete api.summary;
          try { if (window.__cacheWebMoney) window.__cacheWebMoney.commit(applied.files); } catch (e) {}   // serve() now reflects the sealed truth
        }
      }
    } catch (e) {}   // a failed fold leaves _pending intact (unconfirmed) → cloudSealPendingMoney keeps retrying and tells the user; the vault meanwhile seals its own files, never a half-merge
  } else {
    // open the vault FIRST so we can merge another device's user-edit maps
    // (categories/income/subs/income-links) into our local backend before exporting —
    // then the exported snapshot is the converged truth, not this device's stale copy.
    if (rec && rec.blob) {
      try {
        const cur = await cloudOpen(rec.blob, passphrase || "");
        curLocal = cur.local || null; curLocalMeta = cur.localMeta || null;
        vaultAuthored = authoredHash(cur.local || {}, cur.files || {});   // witness of the vault's authored layer BEFORE merge-maps mutates our backend
        if (cur.files) {
          const rf = {}; MAP_FILE_NAMES.forEach((n) => { if (cur.files[n] != null) rf[n] = cur.files[n]; });
          try {
            const mm = await (await fetch("/api/merge-maps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: rf, filesMeta: cur.filesMeta || {} }) })).json();
            if (mm && mm.changed) { try { if (typeof Store !== "undefined" && Store.refresh) Store.refresh(); } catch (e) {} }   // adopted another device's tags → repaint
          } catch (e) {}   // best-effort — a failed merge just means this push carries our own maps
        }
      } catch (e) {}   // v1/keyless blobs just skip the merge
    }
    const data = await (await fetch("/api/export-data")).json();
    if (!data || !data.ok) throw new Error("couldn't read your data");
    files = data.files || {}; api = data.api || {}; exported = data.exported; filesMeta = data.filesMeta || {};
  }
  const count = Object.keys(files).length;
  // converge BOTH ways on every push: ADOPT the vault's shared "local" layer into
  // this device first (EXP bank aggregates, check-ins + journey union, deck by
  // revision, per-key newest-wins for config) — so the device that pushes also ends
  // up HOLDING the full bank it uploads, not just mailing it, and a STALE device can
  // never seal its old copy of a key another device edited more recently. Then
  // snapshot the converged state and seal that.
  if (curLocal) {
    try {
      if (mergeRemoteLocal(curLocal, curLocalMeta)) {
        try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {}   // widgets repaint with the merged truth
        try { ckSync(); } catch (e) {}                                                  // merged check-ins reach the server ledger
      }
    } catch (e) {}
  }
  stampGeneric();   // ensure every generic key has an mtime even on a first (curLocal-less) push
  const localSnap = snapshotLocal();
  // our authored layer AFTER merge-before-seal — a superset (per-key newest-wins) of
  // the vault's. Equal to vaultAuthored ⟺ the vault already holds all our authored data.
  const ourAuthored = authoredHash(localSnap, files);
  // the keybox is only ever written when it doesn't exist yet, or when a manual
  // passphrase push upgrades escrow → zero-knowledge. Background pushes never
  // touch it. A zero-knowledge account (mode remembered locally) never accepts a
  // silent fallback to escrow — if the server's keybox vanished, we stop and ask.
  const zkIntent = curMode === "zk" || (!curMode && s.mode === "zk");
  let writeKeybox = false;
  if (zkIntent && !curBox) {
    if (kb && s.keyboxMissing && !wantZk) { /* server schema lacks the field — blob sync still works; the chip's setup note carries the fix */ }
    else if (!wantZk) throw new Error("your zero-knowledge key needs re-sealing — enter your passphrase (Step 2) once");
    else writeKeybox = true;   // zk keybox restored, passphrase in hand
  } else if (!curBox) {
    writeKeybox = true;   // first keybox for this vault
  } else if (wantZk && curMode === "esc" && !Array.isArray(curBox.wraps)) {
    // LEGACY escrow → zero-knowledge upgrade: ROTATE the key. The old key sat on the
    // server in plaintext — wrapping that same key would be zero-knowledge in name
    // only. Fresh key, blob re-sealed below, other devices re-ask once. Restricted to
    // LEGACY boxes: a v2 box carries recovery wraps (file/code) that only their held
    // secrets could re-wrap, so a v2 escrow account changes methods through Settings
    // (cloudUpdateKeybox, additive, no rotation) — the push never rewrites its keybox.
    kb = await cloudGenKey(); cloudKeySet(kb); mintedKey = true;
    writeKeybox = true;
  }
  const payloadCore = JSON.stringify({ files, api, filesMeta, local: localSnap, localMeta: buildLocalMeta(localSnap) });
  // content short-circuit: unchanged data never re-uploads (auto-push fires freely).
  // Hashes the real content only — exported is a timestamp and would defeat it.
  let h = 5381; for (let i = 0; i < payloadCore.length; i++) h = ((h << 5) + h + payloadCore.charCodeAt(i)) | 0;
  const hash = payloadCore.length + ":" + h;
  // Two clauses, both required, so "cloud ✓ / unchanged" is never a lie:
  //   hash === s.lastHash        → we have nothing new to upload (incl. fresh bank files)
  //   vaultAuthored === ourAuthored → the vault provably still holds all our authored
  //                                   data (a concurrent push didn't drop one of our
  //                                   edits). vaultAuthored is null on an unread/v1
  //                                   vault → we never claim synced against one.
  if (!mintedKey && !writeKeybox && id && hash === s.lastHash && vaultAuthored !== null && vaultAuthored === ourAuthored) {
    cloudSaveState(Object.assign(cloudState(), { lastPush: new Date().toISOString() }));   // confirmed in sync — the chip stays truthful
    // the vault's blob already equals this (folded) payload → the imported money is provably
    // sealed → clear it from _pending so the import's "still saving…" watcher resolves
    if (_foldedMoney && window.__cacheMoneyConfirmSealed) { try { window.__cacheMoneyConfirmSealed(_foldedMoney); } catch (e) {} }
    return { count, bytes: s.bytes || 0, unchanged: true };
  }
  const body = { blob: await cloudSeal(Object.assign(JSON.parse(payloadCore), { exported })) };
  if (writeKeybox) body.keybox = await _keyboxForPush(kb, passphrase, wantZk, opts);
  let r;
  if (id) r = await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { method: "PATCH", headers: hdr, body: JSON.stringify(body) });
  else r = await fetch(cloudUrl() + "/api/collections/vaults/records", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ owner: s.userId }, body)) });
  if (r.status === 404) {
    // record vanished mid-push → recreate it WITH a keybox, never without one
    // (a keybox-less record would invite a silent escrow write on the next push)
    id = null;
    if (!body.keybox) {
      if (zkIntent && !wantZk) throw new Error("your vault was recreated and its zero-knowledge key needs re-sealing — enter your passphrase (Step 2)");
      body.keybox = await _keyboxForPush(kb, passphrase, wantZk, opts);
    }
    r = await fetch(cloudUrl() + "/api/collections/vaults/records", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ owner: s.userId }, body)) });
  }
  const d = await r.json();
  if (!r.ok) throw new Error(cloudErr(d) || ("cloud backup failed (HTTP " + r.status + " — is the 'vaults' collection set up?)"));
  cloudSaveState(Object.assign(cloudState(), {
    recordId: d.id || id, lastPush: new Date().toISOString(), lastPushCount: count,
    bytes: (body.blob || "").length, lastHash: hash, lastSeenVault: d.updated || "",
    mode: body.keybox ? keyboxMode(body.keybox) : (curMode || s.mode || null),   // remember the seal mode from the box actually written — the downgrade guard reads it
    // schema lacks the keybox field → sync works on THIS device, but other devices
    // can't adopt the key until the field exists (self-clears once it does)
    keyboxMissing: body.keybox ? (d && d.keybox === undefined) : (d && d.keybox !== undefined ? false : !!s.keyboxMissing),
  }));
  // the upload landed → the folded CSV import is now durably in the vault → clear it from
  // _pending so the import's "still saving…" watcher resolves to "sealed ✓"
  if (_foldedMoney && window.__cacheMoneyConfirmSealed) { try { window.__cacheMoneyConfirmSealed(_foldedMoney); } catch (e) {} }
  return { count, bytes: (body.blob || "").length };
}
// a zero-knowledge account must never silently accept a keybox whose escrow-ness
// INCREASED — an escrow wrap appearing (in EITHER the v1 {m:"esc"} shape or a v2
// box that now carries a t:"esc" wrap) is exactly what a tampering or compromised
// server would send to gain the ability to read a vault it previously could not.
// keyboxHasEsc sees through both shapes, so this is strictly stronger than the old
// box.m === "esc" check (which a v2 escrow box would have slipped straight past).
function keyboxGuard(box) {
  if (cloudState().mode === "zk" && box && keyboxHasEsc(box))
    throw new Error("your vault's key seal changed unexpectedly — re-enter your passphrase in Settings to re-seal it");
}
// Decide the FIRST keybox's shape from the signup choice. escrow+passphrase is the one
// combo the legacy shapes can't express, so it goes straight to v2; everything else
// stays a legacy shape (recovery FILE/CODE wraps are ADDED afterwards, migrating it to
// v2). The no-choice fallback (no passphrase, no escrow) is today's escrow default —
// only the old flow / a bare manual push hits it; the new signup UI always steers a choice.
async function _keyboxForPush(kb, passphrase, wantZk, opts) {
  const escrow = !!(opts && opts.escrow);
  if (escrow && wantZk) return keyboxBuild(kb, { escrow: true, passphrase });
  if (escrow) return keyboxMake(kb, "");                     // {m:"esc"} — spare key only
  return keyboxMake(kb, wantZk ? passphrase : "");           // {m:"zk"} with a passphrase, else {m:"esc"}
}
// ── Manage the keybox WITHOUT touching the blob ─────────────────────────────────
// Every method change (add a passphrase / recovery file / recovery code, turn escrow
// on or off) is an atomic PATCH of ONLY the keybox field. Read-before-write (never act
// blind), guard-checked, and — critically — the held key is proven to open the CURRENT
// vault before we wrap it, so a stale key can't mint a recovery method that opens the
// wrong data. A failed PATCH leaves the OLD keybox exactly in place (no half-written
// box — the "brick everyone" failure). `mutate(boxStr, kb)` returns the new keybox.
async function cloudUpdateKeybox(mutate) {
  const s = cloudState();
  if (!s.token) throw new Error("log in first");
  if (!(await cloudAuthCheck())) throw new Error("your login expired — log in again (your data is safe)");
  const kb = cloudKeyGet();
  if (!kb) throw new Error("this device doesn't hold your vault key yet — back up or unlock once first");
  const tok = cloudState().token;
  const id = await cloudFindVaultId(cloudState());
  if (!id) throw new Error("no cloud vault yet — back up to cloud once first");
  const rec = await (await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { headers: { Authorization: tok } })).json();
  if (!rec || !rec.id || !rec.keybox) throw new Error("cloud hiccup — couldn't read your vault, try again");
  keyboxGuard(JSON.parse(rec.keybox));   // never mutate a box the guard would refuse
  // prove the held key opens the CURRENT blob — else we'd wrap a stale key into a
  // recovery method that silently opens the wrong (old) vault
  if (rec.blob) {
    let v2 = false; try { v2 = (JSON.parse(rec.blob).v || 1) >= 2; } catch (e) {}
    if (v2) { try { await cloudOpen(rec.blob, ""); } catch (e) { throw new Error("this vault was re-sealed on another device — open it here once (enter your passphrase) before changing unlock methods"); } }
  }
  const newBox = await mutate(rec.keybox, kb);
  if (!newBox || newBox === rec.keybox) throw new Error("nothing to change");
  const r = await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { method: "PATCH", headers: { Authorization: tok, "Content-Type": "application/json" }, body: JSON.stringify({ keybox: newBox }) });
  const d = await r.json();
  if (!r.ok) throw new Error(cloudErr(d) || ("couldn't update your unlock methods (HTTP " + r.status + ")"));
  // the field must have actually PERSISTED — if the vaults collection is missing its
  // 'keybox' text field, PocketBase silently drops it and returns d.keybox === undefined.
  // Never let a user believe they added a recovery method that wasn't stored.
  if (d.keybox !== newBox) throw new Error("your cloud didn't save the change — the 'vaults' collection is missing its 'keybox' text field. Add it, then try again. Nothing on your account changed.");
  cloudSaveState(Object.assign(cloudState(), { mode: keyboxMode(newBox), keyboxMissing: false }));
  return { methods: keyboxMethods(newBox), mode: keyboxMode(newBox) };
}
// Issue (or re-issue) the recovery FILE: fresh secret, wrap the SAME key, return the
// secret so the caller downloads the .cachekey. A prior file wrap is retired.
async function cloudAddRecoveryFile() {
  const secret = recoveryFileSecret();
  await cloudUpdateKeybox(async (boxStr, kb) => keyboxAddWrap(boxStr, await _keyboxWrap("file", kb, secret)));
  return secret;
}
// Issue (or re-issue) the recovery CODE: return the pretty grouped form to show once;
// the wrap is keyed on the NORMALIZED code so a messily-typed recovery still opens it.
async function cloudAddRecoveryCode() {
  const code = recoveryCode();
  await cloudUpdateKeybox(async (boxStr, kb) => keyboxAddWrap(boxStr, await _keyboxWrap("code", kb, recoveryCodeNormalize(code))));
  return code;
}
async function cloudAddPassphrase(passphrase) {
  if (!passphrase || passphrase.length < 6) throw new Error("choose a passphrase of at least 6 characters");
  await cloudUpdateKeybox(async (boxStr, kb) => keyboxAddWrap(boxStr, await _keyboxWrap("pass", kb, passphrase)));
}
// Turn escrow ON (add the raw-key wrap) or OFF (remove it — the raw key leaves the
// server; the other wraps still open the SAME vault, so nobody is locked out). Turning
// it OFF is REFUSED when the spare is the only wrap left — that would empty the keybox
// and brick the vault (the exact "no working wrap" failure).
async function cloudSetEscrow(on) {
  return cloudUpdateKeybox(async (boxStr, kb) => {
    if (on) return keyboxAddWrap(boxStr, { t: "esc", k: kb });
    if (!keyboxWraps(boxStr).some((w) => w.t !== "esc")) throw new Error("the spare key is your only way in right now — add a passphrase or recovery file first, then turn it off");
    return keyboxRemoveType(boxStr, "esc");
  });
}
// Remove one unlock method. Refuses to leave the vault with NO way in — the last wrap
// can never be removed (the UI warns before the last NON-escrow one; this enforces the
// absolute floor).
async function cloudRemoveMethod(t) {
  return cloudUpdateKeybox(async (boxStr) => {
    const left = keyboxWraps(boxStr).filter((w) => w.t !== t);
    if (!left.length) throw new Error("that's your only way in — add another method before removing this one");
    return keyboxRemoveType(boxStr, t);
  });
}
// List the unlock methods currently on the server's keybox (for the Settings list).
// Returns [] if we can't read it — the caller shows a calm "couldn't check" state.
async function cloudListMethods() {
  try {
    const s = cloudState(); if (!s.token) return [];
    const id = await cloudFindVaultId(s); if (!id) return [];
    const rec = await (await fetch(cloudUrl() + "/api/collections/vaults/records/" + id + "?fields=keybox", { headers: { Authorization: s.token } })).json();
    return (rec && rec.keybox) ? keyboxMethods(rec.keybox) : [];
  } catch (e) { return []; }
}
// "I can't get in" — open the vault key with a recovery FILE secret / recovery CODE /
// passphrase, then cache it locally so the normal read + sync path takes over. Recovery
// is a READ: it never rewrites the keybox (no downgrade). opts: {fileKey|code|passphrase}.
async function cloudRecoverUnlock(opts) {
  const s = cloudState();
  if (!s.token) throw new Error("log in first");
  if (!(await cloudAuthCheck())) throw new Error("your login expired — log in again (your data is safe)");
  const id = await cloudFindVaultId(cloudState());
  if (!id) throw new Error("no cloud vault to recover — this account hasn't backed up yet");
  const rec = await (await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { headers: { Authorization: cloudState().token } })).json();
  if (!rec || !rec.keybox) throw new Error("no keybox on your vault yet — nothing to recover with");
  const box = JSON.parse(rec.keybox);
  keyboxGuard(box);
  let kb; try { kb = await keyboxOpen(rec.keybox, opts); } catch (e) { throw new Error("that recovery key didn't open your vault — double-check the file or code and try again"); }
  cloudKeySet(kb);
  cloudSaveState(Object.assign(cloudState(), { mode: keyboxMode(box) }));
  return { mode: keyboxMode(box) };
}
// "3 minutes ago" style relative time for the cloud status line
function cloudAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime(); if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
  const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24); return d + (d === 1 ? " day ago" : " days ago");
}
async function cloudPull(passphrase) {
  // gate the auto-push engine for the WHOLE restore, set BEFORE the first await:
  // a push armed before the user clicked Restore (the confirm() blocks JS while the
  // 9s debounce elapses, so the timer fires the instant OK is clicked) must not slip
  // through the cloudAuthCheck await and seal a half-applied file set to the vault
  clearTimeout(_apT); _apT = null; _restoreBusy = true;
  try {
    if (!cloudState().token) throw new Error("log in first");
    if (cloudPaused()) throw new Error("cloud sync is off — flip “Sync to cloud” on first");
    if (!(await cloudAuthCheck())) throw new Error("your login expired — log in again in Step 1 (your data is safe)");
    const s = cloudState();  // fresh token after the refresh
    const r = await fetch(cloudUrl() + "/api/collections/vaults/records" + VAULT_Q + encodeURIComponent("owner='" + s.userId + "'"), { headers: { Authorization: s.token } });
    const d = await r.json();
    if (!r.ok) throw new Error(cloudErr(d) || "couldn't reach the vault");
    const rec = d.items && d.items[0];
    if (!rec || !rec.blob) throw new Error("no cloud backup yet — push one first");
    // v2 vaults: adopt the data key from the keybox if this device doesn't hold it yet
    if (rec.keybox) {
      const box = JSON.parse(rec.keybox);
      keyboxGuard(box);
      if (!cloudKeyGet()) { try { cloudKeySet(await keyboxOpen(rec.keybox, passphrase || "")); } catch (e) { throw new Error(e.message || "couldn't unlock the vault key"); } }
      cloudSaveState(Object.assign(cloudState(), { mode: keyboxMode(box) }));   // remember the seal mode (escrow-ness of the box)
    }
    let obj;
    try { obj = await cloudOpen(rec.blob, passphrase); } catch (e) { throw new Error(e.message === "this device doesn't hold the cloud key yet" ? "open this vault from a device that has it, or enter your passphrase" : "wrong passphrase or corrupt backup"); }
    // filesMeta rides along so the backend merges the four user-edit maps newest-per-key;
    // the localStorage layer rides along so the pre-restore snapshot covers it too
    const res = await (await fetch("/api/import-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: (obj && obj.files) || {}, filesMeta: (obj && obj.filesMeta) || {}, local: snapshotLocal() }) })).json();
    if (!res || !res.ok) throw new Error((res && res.error) || "restore failed");
    if (obj && obj.local) res.localRestored = restoreLocal(obj.local, obj.localMeta);   // bring your deck / base / config back too (merged, never clobbered)
    // the restored subs.json is now the truth on disk — drop the in-memory copy's
    // authority so a pending debounce/pagehide flush can't write pre-restore SUBS back
    try { clearTimeout(_subsSaveTimer); _subsSaveTimer = null; _subsDirty = false; _subsLoaded = false; } catch (e) {}
    cloudSaveState(Object.assign(cloudState(), { recordId: rec.id, lastSeenVault: rec.updated || "" }));
    return res;
  } finally { _restoreBusy = false; }
}
// ── Cloud auto-sync ─────────────────────────────────────────
// Logged in = same data everywhere, without thinking about it. Meaningful changes
// arm a debounced push; boot + every return to the tab adopt the freshest "local"
// layer other devices left behind. The #cloudHealth chip narrates every state.
// Runs only once this device holds the data key (first backup/unlock plants it).
let _apT = null, _apBusy = false, _restoreBusy = false, _apFails = 0;   // _restoreBusy: a manual Restore is applying — pushes requeue behind it. _apFails: consecutive push failures (bounded retry)
// local-only by choice: the toggle pauses the whole engine — no pushes, no pulls,
// and the chip says so plainly. The cloud copy stays sealed until removed.
function cloudPaused() { try { return localStorage.getItem("money.cloudPaused") === "1"; } catch (e) { return false; } }
// Connected is enough — cloudPush mints/adopts the key itself. Devices that need
// a passphrase first (zero-knowledge, v1 migration) fail with a friendly message
// that the chip carries: "needs you" is the whole point, not a crash.
function cloudReady() { return !!cloudState().token && !cloudPaused(); }
// remove the sealed cloud copy — the explicit "local-only, for real" action
async function cloudWipe() {
  if (!cloudState().token) throw new Error("log in first");
  if (!(await cloudAuthCheck())) throw new Error("your login expired — log in again first");
  const s = cloudState();
  const id = await cloudFindVaultId(s);
  if (!id) { cloudSaveState(Object.assign(cloudState(), { lastPush: null, lastHash: null, lastSeenVault: null, recordId: null })); return { gone: true, none: true }; }
  const r = await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { method: "DELETE", headers: { Authorization: s.token } });
  if (!r.ok && r.status !== 404) { const d = await r.json().catch(() => null); throw new Error(cloudErr(d) || ("couldn't remove the cloud copy (HTTP " + r.status + ")")); }
  cloudSaveState(Object.assign(cloudState(), { lastPush: null, lastHash: null, lastSeenVault: null, recordId: null }));
  return { gone: true };
}
function autoPushSoon() {
  if (!cloudReady()) return;
  clearTimeout(_apT);
  // The FIRST backup fires fast, not on the 9s window. A brand-new (especially phone-only)
  // user who signs up, does one thing, and closes the tab must not lose that first session —
  // AND the escrow keybox rides that first push, so a lost first push = a key that only ever
  // existed in a browser that's now closed. Once a push has landed, keep the generous debounce.
  // (A short timeout, never a direct autoPushNow() call: when busy it re-queues via
  // autoPushSoon, which would recurse synchronously.)
  const wait = cloudState().lastPush ? 9000 : 800;
  _apT = setTimeout(autoPushNow, wait);
}
async function autoPushNow() {
  clearTimeout(_apT); _apT = null;
  if (!cloudReady()) return;
  if (_restoreBusy) { autoPushSoon(); return; }   // a Restore is applying — never seal a half-restored state
  if (_apBusy) { autoPushSoon(); return; }   // single-flight; re-queue behind the current push
  _apBusy = true;
  const prevErr = _cloudErr;   // read BEFORE cloudChip("syncing") wipes it
  cloudChip("syncing");
  try { await cloudPush(""); cloudChip("ok"); _apFails = 0; }
  catch (e) {
    // Say it out loud ONCE per new problem. The chip is a silent light now, so a real failure
    // needs a voice — but the retry backoff must not machine-gun toasts. Compare against the
    // error we captured above: cloudChip("syncing") already cleared _cloudErr, so comparing
    // against it here would ALWAYS differ and fire on every single retry.
    const em = (e && e.message) || "sync failed";
    if (prevErr !== em) { try { flash("Cloud sync needs you — " + em); } catch (e2) {} }
    cloudChip("err", em);
    // A CORRECTIVE push (armed because we hold authored data the vault lacks) must not
    // die on a transient blip: if the vault then goes quiet, cloudAutoPull early-returns
    // on the unchanged stamp, so the ahead-check never re-runs and nothing would ever
    // retry. Back off a few times, then stop — a permanent error (needs passphrase)
    // can't spin, and the next real change or vault move re-arms normally.
    if (++_apFails <= 3) { clearTimeout(_apT); _apT = setTimeout(autoPushNow, 15000 * _apFails); }
  }
  _apBusy = false;
}
// Web CSV imports live only in RAM (webcache FILES + webmoney _pending) until the vault push
// lands — there's no on-device money store to fall back on. The normal auto-push retry gives up
// after 3 tries, and cloudAutoPull's ahead-check can't see the money files (they're excluded
// from the authored-hash witness), so a failed/paused push would never re-arm and the import
// would vanish on reload while the toast claimed success. This watches the seal to completion:
// it fires a push, checks whether _pending drained (cloudPush clears it only after the upload
// confirms), reports truthfully, and keeps retrying so the import seals as soon as the network
// returns. (A reload BEFORE the first seal still loses it — an accepted v1 limit; the message
// tells the user to keep the tab open.)
let _moneySealT = null;
function cloudSealPendingMoney(label, tries) {
  if (!window.__CACHE_WEB__) return;
  tries = tries || 0;
  const pend = () => { try { return (window.__cacheMoneyPending && window.__cacheMoneyPending().length) || 0; } catch (e) { return 0; } };
  clearTimeout(_moneySealT); _moneySealT = null;
  if (!pend()) { if (tries > 0) flash((label ? "Saved " + label : "Your import") + " — sealed to your cloud ✓"); return; }
  if (!cloudReady()) { flash("Your import is only in memory — turn Cloud sync on to keep it (it's gone on reload until then)."); return; }
  try { autoPushNow(); } catch (e) {}                         // single-flight; re-queues if a push is already running
  if (tries === 5) flash("Still saving your import to the cloud — keep this tab open; it'll finish when the connection's back.");
  // retry until it seals: tight at first, then a calm background cadence (cleared the instant _pending drains)
  _moneySealT = setTimeout(() => cloudSealPendingMoney(label, tries + 1), tries < 5 ? 6000 : 30000);
}
// Merge the "local" layer another device left in the vault. NEVER wholesale —
// each key gets the merge it deserves, so nothing here can eat local progress:
//   check-in log + offline queue → union (deduped the same way ckSync dedupes)
//   deck → newest revision wins (the server's own rule)
//   character (profile) → EXP-ledger aggregate; charLog → union
//   badges → union of earned ids; customStats → union of tapped marks
//   charSince → earliest founding date wins (min)
//   everything else → per-key newest-wins by mtime (buildLocalMeta stamps them)
// Merge two profile snapshots under the EXP-ledger rule: per-device slots,
// slot-wise max, total = sum of slots — points earned anywhere always AGGREGATE.
// A legacy profile (no ledger yet) claims its unbanked balance under its own
// device slot. The richer character carries the profile's other fields.
function mergeProfileStrings(aStr, bStr) {
  const parse = (s) => { try { return JSON.parse(s || "{}") || {}; } catch (e) { return {}; } };
  const a = parse(aStr), b = parse(bStr);
  const sa = a.stats || {}, sb = b.stats || {};
  const claim = (s) => {
    const by = (s.expBy && typeof s.expBy === "object") ? Object.assign({}, s.expBy) : {};
    const banked = Object.keys(by).reduce((t, k) => t + (+by[k] || 0), 0);
    const rest = Math.max(0, (+s.exp || 0) - banked);
    if (rest > 0) { const slot = s.dev || "legacy"; by[slot] = (+by[slot] || 0) + rest; }
    return by;
  };
  const A = claim(sa), B = claim(sb), by = {};
  Object.keys(A).concat(Object.keys(B)).forEach((k) => { by[k] = Math.max(+A[k] || 0, +B[k] || 0); });
  const total = Object.keys(by).reduce((t, k) => t + by[k], 0);
  const bRicher = (+sb.exp || 0) > (+sa.exp || 0);
  const out = Object.assign({}, bRicher ? b : a);
  out.stats = Object.assign({}, bRicher ? sb : sa, { expBy: by, exp: total, clicks: Math.max(+sa.clicks || 0, +sb.clicks || 0) });
  return JSON.stringify(out);
}
// Union two character activity logs ({k, d, t} entries) — the journey survives
// every device, capped like charLog itself.
function mergeCharLogStrings(aStr, bStr) {
  const parse = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const a = parse(aStr), b = parse(bStr);
  const seen = new Set(a.map((e) => (e.t || 0) + "|" + (e.k || "") + "|" + (e.d || "")));
  const add = b.filter((e) => e && !seen.has((e.t || 0) + "|" + (e.k || "") + "|" + (e.d || "")));
  if (!add.length) return JSON.stringify(a.slice(-800));
  return JSON.stringify(a.concat(add).sort((x, y) => (x.t || 0) - (y.t || 0)).slice(-800));
}
// Achievements are monotonic — union the earned-badge ids so a badge earned on one
// device shows on every device and can never un-earn through a merge.
function mergeBadgesStr(remStr) {
  try {
    const rem = JSON.parse(remStr || "[]"); if (!Array.isArray(rem)) return false;
    const loc = JSON.parse(localStorage.getItem("money.badges") || "[]");
    const arr = Array.isArray(loc) ? loc.slice() : [], set = new Set(arr);
    let add = false; rem.forEach((b) => { if (b != null && !set.has(b)) { set.add(b); arr.push(b); add = true; } });
    if (add) localStorage.setItem("money.badges", JSON.stringify(arr));
    return add;
  } catch (e) { return false; }
}
// Custom stats: union by id, and per matching id union the tapped streak marks so a
// month marked on the phone is never lost to the desktop's copy. Local metadata
// (a rename) is kept; a stat that exists only remotely is adopted.
function mergeCustomStatsStr(remStr) {
  let rem; try { rem = JSON.parse(remStr || "null"); } catch (e) { return false; }
  if (!Array.isArray(rem)) return false;
  let loc; try { loc = JSON.parse(localStorage.getItem("money.customStats") || "null"); } catch (e) { loc = null; }
  if (!Array.isArray(loc)) loc = [];
  const remById = {}; rem.forEach((s) => { if (s && s.id) remById[s.id] = s; });
  const seen = {};
  const merged = loc.map((s) => {
    if (!s || !s.id) return s;
    seen[s.id] = 1; const r = remById[s.id];
    if (!r) return s;
    const marks = [...new Set([].concat(s.marks || [], r.marks || []))].sort();
    return Object.assign({}, s, { marks });
  });
  rem.forEach((s) => { if (s && s.id && !seen[s.id]) merged.push(s); });
  const after = JSON.stringify(merged);
  if (after !== JSON.stringify(loc)) { localStorage.setItem("money.customStats", after); return true; }
  return false;
}
// Notification read state: per-id NEWEST-WINS by `at` — NOT a union of read ids, because
// a union can't express "mark unread again" (un-reading would silently revert on the next
// merge). Stamps are deterministic (see the notifs block near openMessages): seed/detect
// stamp the entry's RELEASE DATE, a real user action stamps Date.now(). On an EXACT `at`
// tie with differing flags, UNREAD wins — that's the seed-vs-detect race (a fresh device
// seeding history as read while an older device already holds the same note unread), and
// losing an unread is invisible while re-showing a read one is calm. Mirrored byte-for-byte
// in webcache.js wMergeNotifs.
function mergeNotifsStr(remStr) {
  let rem; try { rem = JSON.parse(remStr || "null"); } catch (e) { return false; }
  if (!rem || typeof rem !== "object" || Array.isArray(rem)) return false;
  let loc; try { loc = JSON.parse(localStorage.getItem("money.notifs") || "null"); } catch (e) { loc = null; }
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) loc = {};
  let changed = false;
  Object.keys(rem).forEach((id) => {
    const r = rem[id]; if (!r || typeof r !== "object") return;
    const ra = +r.at || 0, rr = r.read ? 1 : 0, l = loc[id];
    const la = (l && typeof l === "object") ? (+l.at || 0) : -1;   // never seen here → adopt
    const lr = (l && typeof l === "object") ? (l.read ? 1 : 0) : 1;
    if (ra > la || (ra === la && rr < lr)) { loc[id] = { read: rr, at: ra }; changed = true; }
  });
  if (changed) { try { localStorage.setItem("money.notifs", JSON.stringify(loc)); } catch (e) {} }
  return changed;
}
// Bug credits: union by report id — a credit earned on one device shows on every
// device and can never un-earn (or re-grant) through a merge. On an id both sides
// hold, the LOCAL entry is kept (same rule as customStats keeping local metadata);
// the authored-hash witness projects to id+exp so a differing `at` can't livelock.
function mergeBugCreditsStr(remStr) {
  try {
    const rem = JSON.parse(remStr || "[]"); if (!Array.isArray(rem)) return false;
    const loc = JSON.parse(localStorage.getItem("money.bugCredits") || "[]");
    const arr = Array.isArray(loc) ? loc.slice() : [];
    const seen = new Set(arr.filter((c) => c && c.id).map((c) => c.id));
    let add = false;
    rem.forEach((c) => { if (c && c.id && !seen.has(c.id)) { seen.add(c.id); arr.push({ id: c.id, at: c.at || "", exp: +c.exp || 0 }); add = true; } });
    if (add) localStorage.setItem("money.bugCredits", JSON.stringify(arr));
    return add;
  } catch (e) { return false; }
}
// The founding date is the EARLIEST either device has seen — so a fresh install that
// mints charSince=now can never push the journey start (or the Devoted badge) forward.
function mergeCharSinceStr(remStr) {
  const rem = parseInt(remStr); if (!rem) return false;
  const loc = parseInt(localStorage.getItem("money.charSince") || "0");
  if (!loc || rem < loc) { localStorage.setItem("money.charSince", String(rem)); return true; }
  return false;
}
// mergeRemoteLocal(lo, meta): lo = the vault's "local" layer (flat {key:string}),
// meta = its sibling per-key mtime map (absent on pre-merge vaults → treated as {}).
function mergeRemoteLocal(lo, meta) {
  if (!lo || typeof lo !== "object") return false;
  meta = meta || {};
  let changed = false;
  ["money.log", "money.logPending"].forEach((key) => {
    try {
      const rem = JSON.parse(lo[key] || "[]");
      if (!Array.isArray(rem) || !rem.length) return;
      const loc = JSON.parse(localStorage.getItem(key) || "[]");
      const seen = new Set(loc.map((e) => (e.at || 0) + "|" + (e.itemId || "")));
      const add = rem.filter((e) => e && !seen.has((e.at || 0) + "|" + (e.itemId || "")));
      if (add.length) { localStorage.setItem(key, JSON.stringify(loc.concat(add))); changed = true; }
    } catch (e) {}
  });
  try {
    if (lo["money.deck"] != null) {
      const rem = JSON.parse(lo["money.deck"] || "[]");
      if (Array.isArray(rem)) {
        const cur = localStorage.getItem("money.deck") || "[]";
        let loc = []; try { loc = JSON.parse(cur) || []; } catch (e) {}
        // per-item merge, written VERBATIM — an adoption must never restamp what it
        // adopts, or two devices bump each other's stamps forever
        const merged = JSON.stringify(deckCap(mergeDecks(loc, rem.some((q) => q && q.updated == null) ? deckMigrate(rem) : rem)));
        if (merged !== cur) { localStorage.setItem("money.deck", merged); changed = true; try { document.dispatchEvent(new CustomEvent("cache:deck")); } catch (e) {} }
      }
    }
  } catch (e) {}
  try {
    if (lo["money.things"] != null) {
      const rem = JSON.parse(lo["money.things"] || "[]");
      if (Array.isArray(rem)) {
        const cur = localStorage.getItem("money.things") || "[]";
        let loc = []; try { loc = JSON.parse(cur) || []; } catch (e) {}
        // per-item merge, written VERBATIM — an adoption must never restamp what it adopts,
        // or two devices bump each other's stamps forever
        const merged = JSON.stringify(mergeThings(loc, rem));
        if (merged !== cur) { localStorage.setItem("money.things", merged); changed = true; try { document.dispatchEvent(new CustomEvent("cache:things")); } catch (e) {} }
      }
    }
  } catch (e) {}
  // money.forms (templates) + money.formData (submissions): per-item merge, written
  // VERBATIM — they reuse the things algorithm (mergeThings), so the phone and desktop
  // can't fork, and an adoption never restamps what it adopts.
  ["money.forms", "money.formData"].forEach((key) => {
    try {
      if (lo[key] != null) {
        const rem = JSON.parse(lo[key] || "[]");
        if (Array.isArray(rem)) {
          const cur = localStorage.getItem(key) || "[]";
          let loc = []; try { loc = JSON.parse(cur) || []; } catch (e) {}
          const merged = JSON.stringify(mergeThings(loc, rem));
          if (merged !== cur) { localStorage.setItem(key, merged); changed = true; try { document.dispatchEvent(new CustomEvent(key === "money.forms" ? "cache:forms" : "cache:formdata")); } catch (e) {} }
        }
      }
    } catch (e) {}
  });
  try {
    if (lo["money.charLog"] != null) {
      const cur = localStorage.getItem("money.charLog") || "[]";
      const merged = mergeCharLogStrings(cur, lo["money.charLog"]);
      if (merged !== cur) { localStorage.setItem("money.charLog", merged); changed = true; }
    }
  } catch (e) {}
  try {
    if (lo["money.profile"] != null) {
      // flush a pending debounced saveStats first — an EXP click inside the 700ms
      // window would otherwise be invisible to the merge and dropped by rehydration
      try { if (_statsTimer) { clearTimeout(_statsTimer); _statsTimer = null; saveStats(); } } catch (e) {}
      const cur = localStorage.getItem("money.profile") || "";
      const merged = mergeProfileStrings(cur, lo["money.profile"]);
      if (merged !== cur) {
        localStorage.setItem("money.profile", merged);
        // rehydrate the LIVE stats too — otherwise the very next click's saveStats
        // would write the stale in-memory copy right back over the merge. The dev
        // slot stays THIS device's own.
        try {
          const np = JSON.parse(merged);
          if (typeof PROFILE_STATS === "object" && np.stats) { Object.assign(PROFILE_STATS, np.stats); PROFILE_STATS.dev = devId(); if (typeof updateXp === "function") updateXp(); }
        } catch (e) {}
        changed = true;
      }
    }
  } catch (e) {}
  // accumulators — union badges, union custom-stat marks, earliest founding date
  try { if (lo["money.badges"] != null && mergeBadgesStr(lo["money.badges"])) changed = true; } catch (e) {}
  try { if (lo["money.customStats"] != null && mergeCustomStatsStr(lo["money.customStats"])) changed = true; } catch (e) {}
  try { if (lo["money.bugCredits"] != null && mergeBugCreditsStr(lo["money.bugCredits"])) changed = true; } catch (e) {}
  try { if (lo["money.charSince"] != null && mergeCharSinceStr(lo["money.charSince"])) changed = true; } catch (e) {}
  // notification read state — per-id newest-wins by `at`, exact tie → unread wins
  try { if (lo["money.notifs"] != null && mergeNotifsStr(lo["money.notifs"])) { changed = true; try { if (typeof socialUpdateBadge === "function") socialUpdateBadge(); document.dispatchEvent(new CustomEvent("cache:notifs")); } catch (e) {} } } catch (e) {}
  // everything else → per-key newest-wins. Stamp our own generic keys first (a real
  // local edit claims Date.now(); an un-edited key stays at m:0) so a fresher local
  // value is never overwritten, then adopt the vault's copy only where it is newer.
  try {
    const lm = stampGeneric();
    Object.keys(lo).forEach((k) => {
      if (!isGenericKey(k)) return;
      const vm = (+meta[k]) || 0;
      const has = localStorage.getItem(k) !== null;
      const localM = has ? ((lm[k] && +lm[k].m) || 0) : -1;   // never had it → adopt even a mtime-0 vault value
      const cur = has ? localStorage.getItem(k) : null;
      // strict-newer wins; on an EXACT mtime tie with differing values (the common
      // post-rollout m:0 state), both devices must pick the SAME winner or they
      // flip-flop forever — so break the tie by a deterministic total order on the
      // value (higher djb2, then string compare). Symmetric → both converge in one pass.
      const adopt = vm > localM || (vm === localM && has && cur !== lo[k] && _valWins(lo[k], cur));
      if (adopt) {
        try {
          if (cur !== lo[k]) {
            localStorage.setItem(k, lo[k]);
            changed = true;
            // the timer engine keeps live in-memory state — re-seat the adopted PRESETS
            // like the cross-tab storage handler does, or its next tick writes the stale
            // copy back with a fresh mtime that then outranks the vault everywhere.
            // (timerAdopt takes presets only, so a peer's countdown can never land here.)
            if (k === "money.timer") { try { timerAdopt(lo[k]); timerEmit(); } catch (e) {} }
          }
          lm[k] = { m: vm, h: lhash(lo[k]) };
        } catch (e) {}
      }
    });
    lmetaSet(lm);
  } catch (e) {}
  return changed;
}
let _pullBusy = false;
async function cloudAutoPull() {
  if (_pullBusy || !cloudReady()) return;
  const s = cloudState();
  _pullBusy = true;
  try {
    const r = await fetch(cloudUrl() + "/api/collections/vaults/records?perPage=1&sort=id&fields=id,updated," + encodeURIComponent("blob:excerpt(64)") + "&filter=" + encodeURIComponent("owner='" + s.userId + "'"), { headers: { Authorization: s.token } });
    const d = await r.json();
    const rec0 = r.ok && d.items && d.items[0];
    // Change fingerprint. `updated` is an AUTODATE field and our vaults collection does
    // NOT define one, so it comes back undefined — the old `rec0.updated !== lastSeenVault`
    // check was therefore ALWAYS false and this poll never pulled anything. Cross-device
    // "the phone pushed, the desktop notices" was silently dead.
    // So: take the best signal the server actually gives us. The blob excerpt carries the
    // seal's `iv`, which is freshly random on EVERY push → it changes whenever the vault
    // changes. If neither signal exists, fp is "" → we fall through and pull the full
    // record every poll: heavier, but CORRECT. This can never go quietly dead again.
    // (Adding `created`/`updated` autodate fields to the collection makes it cheap again.)
    const fp = rec0 ? (rec0.updated || rec0.blob || "") : "";
    if (rec0 && !(fp && fp === s.lastSeenVault)) {
      const rr = await fetch(cloudUrl() + "/api/collections/vaults/records/" + rec0.id, { headers: { Authorization: s.token } });
      const rec = await rr.json();
      if (rr.ok && rec && rec.blob) {
        if (rec.keybox) {
          const box = JSON.parse(rec.keybox);
          keyboxGuard(box);
          if (!cloudKeyGet() && keyboxHasEsc(box)) cloudKeySet(keyboxEscKey(box));   // silent adopt: escrow only
          cloudSaveState(Object.assign(cloudState(), { mode: keyboxMode(box) }));   // mode memory — the guard reads it
        }
        const obj = await cloudOpen(rec.blob, "");
        if (obj && obj.local && mergeRemoteLocal(obj.local, obj.localMeta)) {
          try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {}   // energy & friends repaint
          try { ckSync(); } catch (e) {}   // route merged check-ins into the server ledger
        }
        // adopt another device's category/income/subs/income-link edits into our
        // local backend, newest-per-key (desktop only — the web reads maps straight
        // from the vault's files and has no backend to merge into)
        let ourMaps = null;
        if (!window.__CACHE_WEB__ && obj && obj.files) {
          let mergeMapsOk = false;
          try {
            const rf = {}; MAP_FILE_NAMES.forEach((n) => { if (obj.files[n] != null) rf[n] = obj.files[n]; });
            const r = await fetch("/api/merge-maps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: rf, filesMeta: obj.filesMeta || {} }) });
            const mm = r.ok ? await r.json() : null;
            if (mm && mm.ok) { mergeMapsOk = true; if (mm.changed) { try { if (typeof Store !== "undefined" && Store.refresh) Store.refresh(); } catch (e) {} } }   // merged tags → repaint
          } catch (e) {}
          // Only trust our maps for the witness once the merge actually ran — read them
          // back from export-data (our REAL maps, never the vault's). If merge-maps didn't
          // run (old server not yet restarted, or a hiccup), leave ourMaps null: we must
          // NOT green over an unmerged state, and must NOT push our un-merged maps (that
          // would clobber the peer's tags). ourMaps stays null → syncing + retry next poll.
          if (mergeMapsOk) {
            try { const ex = await (await fetch("/api/export-data")).json(); if (ex && ex.files) { ourMaps = {}; MAP_FILE_NAMES.forEach((n) => { if (ex.files[n] != null) ourMaps[n] = ex.files[n]; }); } } catch (e) {}
          }
        } else {
          ourMaps = (obj && obj.files) || {};   // web: maps come straight from the vault (read-only) → vault == ours
        }
        if (ourMaps === null) {
          // couldn't merge/read our own authored maps (backend down or pre-merge-maps
          // server) → can't assert synced and mustn't push un-merged maps; leave
          // lastSeenVault as-is so the next poll retries, and keep the chip honest.
          cloudChip("syncing");
        } else {
          // store the SAME fingerprint the cheap poll compares against (not a different
          // shape, or every poll would miss and re-pull the whole vault forever)
          cloudSaveState(Object.assign(cloudState(), { lastSeenVault: fp }));
          // Honest chip + corrective push: if OUR authored layer is now AHEAD of the
          // vault (a concurrent push overwrote the vault with a version that lacked one
          // of our edits), arming a push re-seals it and we withhold the green until it
          // reconciles. This closes the finding's quiescent hole — where a keep-local
          // merge returned changed=false, so nothing re-uploaded yet the chip went green
          // over a vault that was missing our data.
          let ahead = false;
          try {
            const vaultAuthored = authoredHash((obj && obj.local) || {}, (obj && obj.files) || {});
            const ourAuthored = authoredHash(snapshotLocal(), ourMaps);
            ahead = vaultAuthored !== ourAuthored;
          } catch (e) {}
          if (ahead) { cloudChip("syncing"); autoPushSoon(); }
          else cloudChip("ok");
        }
      }
    }
  } catch (e) {
    // a key/seal problem must never rot silently behind a green chip; plain
    // network blips stay quiet and retry on the next tab-return
    const m = (e && e.message) || "";
    if (e && e.name === "OperationError") cloudChip("err", "this vault was re-sealed on another device — enter your passphrase in Settings once");
    else if (/passphrase|key|seal|vault/i.test(m)) cloudChip("err", m);
  }
  _pullBusy = false;
}
// The cloud chip — a status pill beside sync. Hidden until an account is connected;
// after that it always tells the truth: synced ✓ / syncing / needs you.
let _cloudErr = "";   // last sync error — the account menu surfaces it (the chip is a light, not a sentence)
function cloudChip(state, msg) {
  const el = document.getElementById("cloudHealth");
  if (!el) return;
  const s = cloudState();
  const dot = el.querySelector(".sync-dot"), txt = el.querySelector(".sync-text");
  el.hidden = false;
  if (!s.token) {
    // Not signed in → DON'T vanish, and DO keep the words. A logged-out desktop user otherwise
    // has no way to discover cloud sign-in (it's buried in Settings → Cache cloud) — the exact
    // wall a tester hit. This state is static (logging in reloads the page), so unlike the
    // signed-in states it can't oscillate and shove the dock. The hosted web app's login gate
    // guarantees a token, so this only ever surfaces on desktop.
    el.classList.remove("cloud-light");
    el.removeAttribute("data-cloud");
    if (dot) dot.style.background = "#6b9bd6";
    if (txt) txt.textContent = "sign in to sync";
    el.title = "sign in to sync your cache across your devices — tap to set up (Settings → Cache cloud)";
    el.setAttribute("aria-label", el.title);
    return;
  }
  // Signed in: a FIXED-FOOTPRINT status light. The label used to swing between "cloud ✓" and
  // "cloud: not synced", and since the chip is a flex child of the centered dock, every sync
  // resized it and shoved the whole dock sideways — twice per 75s poll. State now reads as
  // colour + SHAPE (never colour alone), and the words live on for screen readers, the
  // tooltip, and the account menu.
  let key, label, tip;
  if (cloudPaused()) {
    key = "off"; label = "cloud sync: off";
    tip = "cloud sync is off by your choice — your data stays on this device (Settings → Cache cloud)";
  } else if (state === "syncing") {
    key = "sync"; label = "cloud: syncing"; tip = "encrypting + syncing to your cloud";
  } else if (state === "err") {
    key = "err"; label = "cloud sync: needs you";
    tip = (msg || "cloud sync failed") + " — tap for cloud settings";
  } else if (s.keyboxMissing) {
    key = "warn"; label = "cloud: setup note";
    tip = "one-time server setup: add a 'keybox' text field to the vaults collection so your other devices can unlock";
  } else if (s.lastPush) {
    key = "ok"; label = "cloud: synced " + cloudAgo(s.lastPush);
    tip = "last sync " + cloudAgo(s.lastPush) + " — tap for your account & sync";
  } else {
    key = "warn"; label = "cloud: not backed up yet";
    tip = "connected — first backup pending (tap for your account & sync)";
  }
  _cloudErr = key === "err" ? (msg || "cloud sync failed") : "";
  el.classList.add("cloud-light");
  if (dot) dot.removeAttribute("style");   // heal chips painted by an older build (inline hex would beat the CSS)
  if (el.dataset.cloud === key && el.__cloudTip === tip) return;   // unchanged → no DOM write at all
  el.dataset.cloud = key;
  el.__cloudTip = tip;
  if (txt) txt.textContent = label;
  el.title = tip;
  el.setAttribute("aria-label", label + " — tap for your account & cloud settings");
}
// ── The account menu — tap the cloud chip while signed in and your account is right
//    there: cloud settings, log out, or hand the machine to a different account. This is
//    the two-tap answer to "how do I log out / switch?" (logout used to live only inside
//    Settings → Cache cloud, and nothing anywhere said "switch"). One-account-at-a-time
//    stays the rule: a "switch" is a real log-out (parking your cache) + a real log-in. ──
const SWITCH_ACCT_FLAG = "cache.switchAcct";   // sessionStorage: survives the logout reload, dies with the tab
// The one logout everything shares (Settings + Messages have their own message surfaces,
// the menu uses this). switching=true also routes the reload straight to a blank sign-in.
function accountLogout(switching) {
  if (switching) try { sessionStorage.setItem(SWITCH_ACCT_FLAG, "1"); } catch (e) {}
  const hadAcct = !!cloudState().userId;
  const parked = cloudLogout();
  try { cloudChip(); } catch (e) {}
  try { socialUpdateBadge(); } catch (e) {}
  if (parked) { flash(switching ? "Logged out — sign in as the other account." : "Logged out."); setTimeout(() => location.reload(), 500); return; }
  // stash failed (storage full) → data stays live by design; no reload, so finish the
  // switch intent right here instead of leaving the flag armed for some later reload
  try { sessionStorage.removeItem(SWITCH_ACCT_FLAG); } catch (e) {}
  if (hadAcct) flash("Logged out — but storage is full, so your data couldn't be cleared from this device.");
  else flash("Logged out.");
  if (switching) { openSettings(); prepSwitchSignin(); }
}
// blank the sign-in so it's obvious ANY account can enter (it prefills the previous email)
function prepSwitchSignin() {
  try {
    const em = document.getElementById("setCloudEmail"), pw = document.getElementById("setCloudPass");
    if (em) { em.value = ""; em.focus(); }
    if (pw) pw.value = "";
  } catch (e) {}
}
function closeAccountMenu() {
  const m = document.getElementById("acctMenu"); if (m) m.remove();
  document.removeEventListener("pointerdown", _acctMenuOutside);
}
function _acctMenuOutside(e) { const m = document.getElementById("acctMenu"); if (m && !m.contains(e.target)) closeAccountMenu(); }
function openAccountMenu(anchor) {
  if (document.getElementById("acctMenu")) { closeAccountMenu(); return; }   // second tap toggles it shut
  const s = cloudState();
  const menu = document.createElement("div");
  menu.className = "acct-menu"; menu.id = "acctMenu";
  menu.innerHTML =
    '<div class="am-who">Signed in as <b>' + escapeHtml(s.email || "your account") + "</b></div>" +
    // the sync detail the chip no longer spells out — one honest line, in words
    '<div class="am-sync' + (_cloudErr ? " bad" : "") + '">' +
      (_cloudErr ? "Sync needs you — " + escapeHtml(_cloudErr)
       : cloudPaused() ? "Cloud sync is off — this device only."
       : s.lastPush ? "Last sync " + escapeHtml(cloudAgo(s.lastPush))
       : "First backup pending.") + "</div>" +
    '<button class="am-item" data-act="settings"><i data-lucide="settings-2"></i>Cloud settings</button>' +
    '<button class="am-item" data-act="switch"><i data-lucide="users"></i>Use a different account…</button>' +
    '<button class="am-item am-out" data-act="logout"><i data-lucide="log-out"></i>Log out</button>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight, gap = 6;
  // RIGHT-align to the anchor and hug it. The cloud chip is now a small dot at the far-right
  // of the dock, so left-aligning the (much wider) menu to it clamps the menu leftward and it
  // floats away from the button. Aligning the menu's RIGHT edge to the button's right edge
  // keeps it visually hanging off the button, then clamp on-screen.
  const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  menu.style.left = left + "px";
  // Open upward, hugging the anchor (the dock sits at the bottom); FLIP below only when there
  // isn't room above (the profile's "Switch account" can sit high in a scrolling panel).
  if (r.top >= mh + gap) menu.style.bottom = (window.innerHeight - r.top + gap) + "px";
  else menu.style.top = Math.min(r.bottom + gap, Math.max(8, window.innerHeight - mh - 8)) + "px";
  drawIcons();
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act; closeAccountMenu();
    if (act === "settings") { autoPushNow(); openSettings(); }
    else if (act === "logout") accountLogout(false);
    else if (act === "switch") accountLogout(true);
  });
  setTimeout(() => document.addEventListener("pointerdown", _acctMenuOutside), 0);
}
// ── Click sparks: rapid clicking shoots theme-colored sparks from the cursor —
//    a playful nudge that every interaction banks EXP. Builds 5→10 thick the more
//    you click in quick succession. ──
let _clickTimes = [];
// a sword "shing" on blessed clicks — throttled so rapid clicks don't machine-gun it
let _shing = null, _shingT = 0;
function playShing() {
  const now = performance.now();
  if (now - _shingT < 110) return;
  _shingT = now;
  try {
    if (!_shing) _shing = new Audio("av%20assets/shing.wav");
    const a = _shing.cloneNode(); a.volume = 0.3; a.play().catch(() => {});
  } catch (e) {}
}
// Synthesized crowd applause/cheer (no audio asset) — a swelling burst of filtered
// noise with scattered louder claps. Played when a trip lands. Never throws.
let _actx;
function playApplause() {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _actx, dur = 2.4, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const swell = Math.min(1, t / 0.22) * Math.pow(1 - t / dur, 1.5);  // quick rise, long decay
      let v = (Math.random() * 2 - 1);
      if (Math.random() < 0.006) v *= 3.2;                               // scattered claps poke through
      ch[i] = Math.max(-1, Math.min(1, v * swell));
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 650;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.34;
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start();
  } catch (e) {}
}
// A gentle two-note chime for the work/rest timer (no audio asset) — soft sine
// dyad: ascending = back to work, descending = time to rest. Never throws.
function playChime(up) {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _actx, t0 = ctx.currentTime;
    const notes = up ? [523.25, 783.99] : [783.99, 523.25]; // C5→G5 / G5→C5
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const at = t0 + i * 0.22;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.14, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      o.connect(g); g.connect(ctx.destination);
      o.start(at); o.stop(at + 1);
    });
  } catch (e) {}
}
// Create/resume the audio context during a user gesture (the timer's Start tap)
// so the chime minutes later isn't blocked by autoplay rules.
function primeChime() {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === "suspended") _actx.resume();
  } catch (e) {}
}
// ── Work/rest timer engine (module scope) ──────────────────────────────
// The engine outlives any widget instance: phase turns, chimes, and EXP keep
// firing while you're on another page or the widget is closed. The widget is
// just a window onto this state — it repaints on the "cache:timer" event.
// The timer is TWO things and they must not travel together:
//   money.timer    — your PRESETS (block lengths, sound). Config: syncs across devices.
//   money.timerRun — the RUNNING state (phase, cycle, endsAt, pausedLeft). A countdown
//                    anchored to this machine's clock; device-local, never synced —
//                    otherwise a block running on the desktop would hijack the phone.
// One in-memory object still backs the widget; only the persistence is split.
const TIMER_KEY = "money.timer", TIMERRUN_KEY = "money.timerRun";
const TIMER_PRESETS = ["work", "rest", "longRest", "longEvery", "sound"];
const TIMER_RUNTIME = ["phase", "cycle", "endsAt", "pausedLeft"];
const timerSt = { work: 25, rest: 5, longRest: 15, longEvery: 4, phase: "work", cycle: 1, endsAt: null, pausedLeft: null, sound: true };
function _timerTake(raw, fields) {
  let s = {};
  try { s = JSON.parse(raw) || {}; } catch (e) {}
  if (!s || typeof s !== "object") return;
  fields.forEach((f) => { if (f in s) timerSt[f] = s[f]; });
}
// coerce anything corrupt — a bad value (wrong type, hand-edited storage) must never wedge the timer
function timerNormalize() {
  if (timerSt.phase !== "rest" && timerSt.phase !== "long") timerSt.phase = "work";
  timerSt.cycle = parseInt(timerSt.cycle) >= 1 ? parseInt(timerSt.cycle) : 1;
  timerSt.endsAt = parseInt(timerSt.endsAt) > 0 ? parseInt(timerSt.endsAt) : null;
  timerSt.pausedLeft = parseInt(timerSt.pausedLeft) > 0 ? parseInt(timerSt.pausedLeft) : null;
  timerSt.sound = timerSt.sound !== false;
}
// adopting the SYNCED key takes presets only — a legacy blob (or an older device's
// push) still carries runtime fields, and they must never move a countdown here
function timerAdopt(raw) { _timerTake(raw, TIMER_PRESETS); timerNormalize(); }
function timerAdoptRun(raw) { _timerTake(raw, TIMER_RUNTIME); timerNormalize(); }
function timerLoad() {
  const legacy = localStorage.getItem(TIMER_KEY);   // pre-split blobs held both halves
  _timerTake(legacy, TIMER_PRESETS);
  const run = localStorage.getItem(TIMERRUN_KEY);
  _timerTake(run != null ? run : legacy, TIMER_RUNTIME);   // one-time migration out of the old combined key
  timerNormalize();
}
try { timerLoad(); } catch (e) {}
function timerSave() {
  try {
    const pre = {}, run = {};
    TIMER_PRESETS.forEach((f) => { pre[f] = timerSt[f]; });
    TIMER_RUNTIME.forEach((f) => { run[f] = timerSt[f]; });
    localStorage.setItem(TIMER_KEY, JSON.stringify(pre));
    localStorage.setItem(TIMERRUN_KEY, JSON.stringify(run));
  } catch (e) {}
}
// presets clamp to their bounds instead of reverting to defaults — what the
// user typed (or the nearest allowed value) is what runs
function timerPreset(k, d) { const n = parseFloat(timerSt[k]); return n >= 1 ? Math.min(180, Math.round(n)) : d; }
function timerEvery() { const n = parseInt(timerSt.longEvery); return n >= 1 ? Math.min(12, n) : 4; }
function timerPhaseMins() { return timerSt.phase === "work" ? timerPreset("work", 25) : timerSt.phase === "long" ? timerPreset("longRest", 15) : timerPreset("rest", 5); }
function timerDur() { return timerPhaseMins() * 60000; }
function timerEmit() { document.dispatchEvent(new CustomEvent("cache:timer")); }
// move to the next phase; live=true → this block genuinely finished just now
// (chime + EXP). Skips and stale catch-ups advance silently — no fake rewards.
function timerAdvance(live) {
  if (timerSt.phase === "work") {
    if (live) {
      const w = timerPreset("work", 25);
      addExp(2); logChar("log", "Finished a " + w + "-min work block · +2 EXP");
      track("timer_work_done", { mins: w });
      if (timerSt.sound !== false) playChime(false); // descending — wind down
    }
    timerSt.phase = (timerSt.cycle % timerEvery() === 0) ? "long" : "rest";
    if (live) flash((timerSt.phase === "long" ? "Long rest — " : "Rest — ") + timerPhaseMins() + " min");
  } else {
    if (timerSt.phase === "long") timerSt.cycle = 1; else timerSt.cycle += 1;
    timerSt.phase = "work";
    if (live) {
      if (timerSt.sound !== false) playChime(true); // ascending — back to it
      flash("Back to it — " + timerPhaseMins() + " min");
    }
  }
}
function timerTick() {
  if (!timerSt.endsAt) return;
  let hops = 0;
  while (timerSt.endsAt <= Date.now() && hops++ < 96) {
    // live only if this is the first hop and it just happened (≤90s covers
    // background-tab throttling); a stale reload catches up silently
    timerAdvance(hops === 1 && Date.now() - timerSt.endsAt < 90000);
    timerSt.endsAt += timerDur();
  }
  if (hops) { timerSave(); timerEmit(); }
}
setInterval(timerTick, 1000); // idles at one no-op compare per second when nothing runs
window.addEventListener("storage", (e) => {
  // another TAB on this device moved the timer — adopt it, don't fight it. Both halves
  // are shared between tabs (same machine); only the cloud never sees the runtime.
  if (e.key === TIMER_KEY) { timerAdopt(e.newValue); timerEmit(); }
  else if (e.key === TIMERRUN_KEY) { timerAdoptRun(e.newValue); timerEmit(); }
});
let _sparkAlive = 0;
function expSpark(x, y, n, blessed) {
  if (reduceMotion()) return;  // no particle bursts when motion is reduced
  n = Math.min(n, Math.max(0, 28 - _sparkAlive));  // cap concurrent sparks so rapid clicks never flood the main thread
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    p.className = "exp-spark" + (blessed ? " blessed" : "");
    const a = Math.random() * Math.PI * 2, d = 22 + Math.random() * 42;
    p.style.left = x + "px"; p.style.top = y + "px";
    p.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px");
    p.style.setProperty("--dy", (Math.sin(a) * d - 12).toFixed(1) + "px");  // bias up a touch
    p.style.setProperty("--s", (0.5 + Math.random() * 0.8).toFixed(2));
    document.body.appendChild(p);
    _sparkAlive++;
    setTimeout(() => { p.remove(); _sparkAlive--; }, 680);
  }
}
document.addEventListener("pointerdown", (e) => {
  const now = performance.now();
  _clickTimes = _clickTimes.filter((t) => now - t < 1200);
  _clickTimes.push(now);
  if (_healthFull) { expSpark(e.clientX, e.clientY, 4, true); playShing(); }  // blessed → celebrate + a sword shing
  else if (_clickTimes.length >= 5) expSpark(e.clientX, e.clientY, Math.min(10, _clickTimes.length - 3));
  if (!_healthFull && _clickTimes.length === 7) {  // likely a rage-click burst (not blessed spark-spam)
    const el = e.target;
    track("rage_click", { el: (el && (el.id || (typeof el.className === "string" ? el.className.split(" ")[0] : "") || el.tagName)) || "" });
  }
}, true);
window.addEventListener("pagehide", saveStats);
window.addEventListener("beforeunload", saveStats);
// The web runtime (webcache.js pullVault) calls this after merging a pulled vault
// into localStorage when its once-per-30s reload guard suppresses the reload —
// re-seat the live stats so the next saveStats can't write the stale in-memory
// copy over the merge. Reads from localStorage, so it's idempotent + ordering-safe.
window.__cacheRehydrateStats = function () {
  try {
    const p = getProfile();
    if (typeof PROFILE_STATS === "object" && p.stats) { Object.assign(PROFILE_STATS, p.stats); PROFILE_STATS.dev = devId(); if (typeof updateXp === "function") updateXp(); }
    document.dispatchEvent(new CustomEvent("cache:logged"));   // energy & friends repaint with the merged truth
  } catch (e) {}
};
function applyPrivacy() {
  document.body.classList.toggle("privacy-on", localStorage.getItem("money.privacy") === "1");
}
// Phones hide the dock's pills so the deck is the one button; this per-device opt-in
// (never rides the vault — "this phone" means this phone) brings them back.
function applyDockMobile() {
  document.documentElement.toggleAttribute("data-dockmobile", localStorage.getItem("money.dockMobile") === "1");
}
// ── The SimpleFIN Access URL: a bearer credential to the user's bank ──────────────
// DEVICE-LOCAL — it never rides the vault (money.simplefin is in DEVICE_LOCAL_KEYS /
// W_INTERNAL), the browser equivalent of the desktop's chmod-600 .simplefin file. This
// ONE helper pair is the deliberate SEAM: if ZK-by-default ships and we later choose to
// sync the credential in the vault, it's a change HERE, not a hunt through the pull code.
// See WIKI 2026-07-24-bank-credential-device-only. Handled ONLY here + in webmoney's sf*
// functions — never placed in a URL, log, toast, title, or any data/*.json.
const SF_CRED_KEY = "money.simplefin";
function sfGetCred() { try { return localStorage.getItem(SF_CRED_KEY) || ""; } catch (e) { return ""; } }
function sfPutCred(url) { try { if (url) localStorage.setItem(SF_CRED_KEY, url); else localStorage.removeItem(SF_CRED_KEY); } catch (e) {} }
function sfHasCred() { return !!sfGetCred(); }

// "How does this work?" — a plain-language, visual walkthrough of the SimpleFIN bank link,
// so the safety model is legible before anyone pastes a token. The two ideas to land: a
// middleman (SimpleFIN) holds the bank login so we never see it, and the key stays on the
// device so we can't read the data. Reachable from ⚡ Connect and from Settings.
function openSfExplainer() {
  if (document.getElementById("sfxModal")) return;   // one at a time
  const step = (icon, title, desc) => '<div class="sfx-step"><span class="sfx-ic"><i data-lucide="' + icon + '"></i></span>' +
    '<div class="sfx-txt"><div class="sfx-t">' + title + '</div><div class="sfx-d">' + desc + "</div></div></div>";
  const trust = (icon, title, sub) => '<div class="sfx-trust"><i data-lucide="' + icon + '"></i>' +
    "<div><b>" + title + "</b><span>" + sub + "</span></div></div>";
  const back = document.createElement("div"); back.className = "cat-backdrop"; back.id = "sfxBackdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal sfx-modal"; modal.id = "sfxModal";
  const close = () => { modal.remove(); back.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  modal.innerHTML =
    '<div class="cat-head"><span>How your bank link works</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-list sfx-body">' +
      '<div class="sfx-sec">Set up once</div>' +
      step("building-2", "Connect your bank at SimpleFIN", "SimpleFIN is a secure middleman — <b>it</b> holds the connection to your bank, so The Cache never sees your bank login. It hands you a one-time setup code.") +
      step("clipboard", "Paste the code into The Cache", "On this device, drop that one-time code in and tap Connect my bank.") +
      step("key", "Your device gets a private key", "The code is traded for a private bank key — and that key <b>stays on this device</b>. It never goes to our servers.") +
      '<div class="sfx-sec">Every time you sync</div>' +
      step("refresh-cw", "Tap “Sync now”", "Your device uses its key to ask SimpleFIN for your latest balances and transactions.") +
      step("calculator", "The math happens on your device", "Spending, income, safe-to-spend — all worked out right here, not on a server.") +
      step("lock", "It’s sealed, then synced", "The result is encrypted and synced to your other devices. Our server only ever sees a <b>scrambled blob</b> it can’t read.") +
      '<div class="sfx-trustbox">' +
        trust("shield", "Your bank password never touches The Cache", "SimpleFIN holds it — we never see it.") +
        trust("smartphone", "Your bank key never leaves this device", "Set up on each device, so it’s never in the cloud.") +
        trust("eye-off", "We can’t read your money", "Only your devices can unlock it.") +
      "</div>" +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
  try { drawIcons(); } catch (e) {}
}

// First-run coaching: how to set up the SimpleFIN bank connection, in-app (no Terminal).
function openConnect() {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal connect-modal";
  // On the hosted web app, money comes in TWO ways, both computed in the browser and sealed
  // into the vault (nothing leaves the device unencrypted): a live SimpleFIN bank connection
  // (claim a token here, pull on demand — webmoney.js sf* functions), or a one-time CSV import.
  const web = !!window.__CACHE_WEB__;
  if (web) {
    const connected = sfHasCred();
    modal.innerHTML =
      '<div class="cat-head"><span>Get your money in</span><button class="cat-close" aria-label="Close">✕</button></div>' +
      '<div class="connect-body">' +
        (connected
          ? '<div class="cn-intro"><span class="cn-ok">✓ Your bank is connected.</span> <span id="sfAge"></span> Pull the latest whenever you want — SimpleFIN refreshes about once a day.</div>' +
            '<div class="cn-alts"><button class="cn-connect" id="sfSync">Sync now</button></div>' +
            '<div class="cn-result" id="sfResult"></div>' +
            '<div class="cn-or">— manage —</div>' +
            '<div class="cn-manage"><button class="cn-linkbtn" id="sfCsv">import a CSV instead</button></div>' +
            '<div class="cn-manage"><button class="cn-linkbtn cn-linkbtn-danger" id="sfDisconnect">Disconnect this bank</button></div>'
          : '<div class="cn-intro">Connect your bank right here — paste your <b>SimpleFIN</b> setup token and your cache pulls your balances and transactions itself, then <b>syncs them to your other devices</b>. Nothing leaves your device unencrypted. <button class="cn-linkbtn" id="sfExplain">How does this work?</button></div>' +
            '<ol class="cn-steps">' +
              '<li>Make a SimpleFIN account at <a href="https://bridge.simplefin.org" target="_blank" rel="noreferrer">bridge.simplefin.org</a> <span class="cn-dim">(~$15/yr — it protects your bank login)</span> and connect your bank(s).</li>' +
              '<li>Click <b>New app connection</b> → it shows a long <b>setup token</b>.</li>' +
              '<li>Paste it below. <span class="cn-dim">SimpleFIN emails you when a new device connects — that’s just you. Each device sets up its own connection for now.</span></li>' +
            '</ol>' +
            '<textarea class="cn-token" id="sfToken" rows="3" placeholder="paste your SimpleFIN setup token"></textarea>' +
            '<div class="cn-alts"><button class="cn-connect" id="sfConnect">Connect my bank</button></div>' +
            '<div class="cn-result" id="sfResult"></div>' +
            '<div class="cn-or">— or —</div>' +
            '<div class="cn-intro">Prefer a one-time file? <button class="cn-linkbtn" id="sfCsv">Import a bank CSV</button> — same cache, no subscription.</div>') +
      '</div>';
    document.body.appendChild(back);
    document.body.appendChild(modal);
    if (typeof makeModalResizable === "function") makeModalResizable(modal, "money.connect");
    modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
    const R = modal.querySelector("#sfResult");
    const say = (html, cls) => { if (R) R.innerHTML = cls ? ('<span class="' + cls + '">' + html + "</span>") : html; };
    const note = (p) => (p && p.errors && p.errors.length) ? (" Note: " + escapeHtml(p.errors.join("; "))) : "";
    // staleness: the app remembers, not the person — show how old the numbers are (guardrail:
    // manual sync must never mean silently-stale balances presented as current)
    const ageEl = modal.querySelector("#sfAge");
    if (ageEl) fetch("data/balances.json?t=" + Date.now()).then((r) => r.ok ? r.json() : null).then((d) => {
      if (d && d.updated) ageEl.innerHTML = "Your numbers are from <b>" + escapeHtml(ageStr(Date.now() - new Date(d.updated).getTime())) + "</b> ago.";
    }).catch(() => {});
    const exBtn = modal.querySelector("#sfExplain");
    if (exBtn) exBtn.addEventListener("click", () => { try { openSfExplainer(); } catch (e) {} });
    const csvBtn = modal.querySelector("#sfCsv");
    if (csvBtn) csvBtn.addEventListener("click", () => { closeCategorizer(); const b = document.getElementById("importStatement"); if (b) b.click(); });
    const conn = modal.querySelector("#sfConnect");
    if (conn) conn.addEventListener("click", async () => {
      const t = modal.querySelector("#sfToken"); const tok = t ? t.value.trim() : "";
      if (!tok) { say("Paste your setup token first.", "cn-err"); return; }
      conn.disabled = true; say("Connecting…", "cn-working");
      try {
        const c = await window.__cacheMoneySfClaim(tok);
        if (!c.ok) { say(escapeHtml(c.error), "cn-err"); conn.disabled = false; return; }
        sfPutCred(c.accessUrl);                          // device-local — the credential never rides the vault
        say("Pulling your accounts…", "cn-working");
        const p = await window.__cacheMoneySfPull(c.accessUrl);
        if (!p.ok) {
          // the claim SUCCEEDED (a used token can't be re-claimed) — keep the credential and let
          // "Sync now" retry, rather than stranding the user on a burned token
          say("Connected, but the first sync didn't land: " + escapeHtml(p.error) + " — try Sync now in a moment.", "cn-err");
          setTimeout(() => { if (!document.body.contains(modal)) return; closeCategorizer(); openConnect(); }, 1600); return;   // don't reopen if the user already closed it
        }
        try { autoPushNow(); } catch (e) {}
        try { Store.refresh(); } catch (e) {}
        say("✓ Connected — pulled " + p.added + " transaction(s)." + note(p), "cn-ok");
        setTimeout(() => { if (!document.body.contains(modal)) return; closeCategorizer(); openConnect(); }, 1300);   // reopen in the connected state, unless the user already closed it
      } catch (e) { say(escapeHtml((e && e.message) || "couldn't connect"), "cn-err"); conn.disabled = false; }
    });
    const sync = modal.querySelector("#sfSync");
    if (sync) sync.addEventListener("click", async () => {
      sync.disabled = true; say("Syncing…", "cn-working");
      try {
        const p = await window.__cacheMoneySfPull(sfGetCred());
        if (!p.ok) { say(escapeHtml(p.error), "cn-err"); sync.disabled = false; return; }
        try { autoPushNow(); } catch (e) {}
        try { Store.refresh(); } catch (e) {}
        say("✓ Synced — " + p.added + " new transaction(s)." + note(p), "cn-ok");
        sync.disabled = false;
      } catch (e) { say(escapeHtml((e && e.message) || "sync failed"), "cn-err"); sync.disabled = false; }   // never leave the button stuck disabled
    });
    const disc = modal.querySelector("#sfDisconnect");
    if (disc) disc.addEventListener("click", () => {
      sfPutCred("");   // device-local only — clears the credential from THIS device; the data stays
      closeCategorizer(); flash("Bank disconnected from this device — your money stays in your cache."); openConnect();
    });
    return;
  }
  {
    modal.innerHTML =
      '<div class="cat-head"><span>Connect a bank</span><button class="cat-close" aria-label="Close">✕</button></div>' +
      '<div class="connect-body">' +
        '<div class="cn-status">checking…</div>' +
        '<div class="cn-intro">Bank data comes through <b>SimpleFIN Bridge</b> — a read-only service that <b>never hands the app your bank login</b>. The connection is stored only on this computer. First time? Do this once:</div>' +
        '<ol class="cn-steps">' +
          '<li>Make a SimpleFIN account at <a href="https://bridge.simplefin.org" target="_blank" rel="noreferrer">bridge.simplefin.org</a> <span class="cn-dim">(~$15/yr — it protects your bank login)</span>.</li>' +
          '<li>In SimpleFIN, connect your bank(s).</li>' +
          '<li>Click <b>New app connection</b> → it shows a long <b>setup token</b>.</li>' +
          '<li>Copy the <b>whole</b> token and paste it below.</li>' +
        '</ol>' +
        '<textarea class="cn-token" rows="3" placeholder="paste YOUR SimpleFIN setup token here (it stays on this computer)"></textarea>' +
        '<button class="cn-connect">Connect &amp; sync</button>' +
        '<div class="cn-or">— or, free, no bank —</div>' +
        '<div class="cn-alts">' +
          '<button class="cn-demo">Load demo data</button>' +
          '<button class="cn-csv">Import a bank CSV</button>' +
        '</div>' +
        '<div class="cn-result"></div>' +
      '</div>';
  }
  document.body.appendChild(back);
  document.body.appendChild(modal);
  if (typeof makeModalResizable === "function") makeModalResizable(modal, "money.connect");
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
  const result = modal.querySelector(".cn-result");
  const statusEl = modal.querySelector(".cn-status");
  let connected = false;
  // (Only the desktop body reaches here — the web branch above returns after wiring itself.)
  fetch("/api/connect-status").then((r) => r.json()).then((d) => {
    connected = !!(d && d.connected);
    statusEl.innerHTML = connected
      ? '<span class="cn-ok">✓ A bank is connected.</span> Paste a new token to reconnect, or just close this.'
      : '<span class="cn-no">Not connected yet.</span> Follow the steps below.';
  }).catch(() => { statusEl.textContent = ""; });
  const doConnect = (body, label) => {
    result.innerHTML = '<span class="cn-working">' + label + "…</span>";
    fetch("/api/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.ok) {
          result.innerHTML = '<span class="cn-ok">✓ Connected — ' + (d.accounts || 0) + " account(s), " + (d.transactions || 0) + " transactions.</span> Reloading…";
          Store.refresh();
          setTimeout(() => location.reload(), 1500);
        } else {
          result.innerHTML = '<span class="cn-err">' + escapeHtml((d && d.error) || "Couldn’t connect.") + "</span>";
        }
      })
      .catch(() => { result.innerHTML = '<span class="cn-err">Couldn’t reach the backend — is the server running?</span>'; });
  };
  modal.querySelector(".cn-connect").addEventListener("click", () => {
    const tok = modal.querySelector(".cn-token").value.trim();
    if (!tok) { result.innerHTML = '<span class="cn-err">Paste your setup token first.</span>'; return; }
    doConnect({ token: tok }, "Connecting your bank");
  });
  modal.querySelector(".cn-demo").addEventListener("click", () => {
    if (connected && !confirm("This replaces your current bank connection with sample demo data. Continue?")) return;
    doConnect({ demo: true }, "Loading demo data");
  });
  modal.querySelector(".cn-csv").addEventListener("click", () => { closeCategorizer(); document.getElementById("importStatement").click(); });
}
// ── Accessibility ─────────────────────────────────────────────────────────
// One small system: each need persists in localStorage → is applied as an
// attribute on <html> → CSS and JS read it. To add a need: add a key here, an
// attribute in applyA11y(), a CSS rule, and a row in openA11y(). That's it.
const A11Y = {
  motion:     { key: "money.a11y.motion",     def: "auto" },    // auto (follow OS) | reduce | full
  contrast:   { key: "money.a11y.contrast",   def: "normal" },  // normal | high
  text:       { key: "money.a11y.text",       def: "base" },     // base | lg | xl
  colorblind: { key: "money.a11y.colorblind", def: "off" },      // off | on (Okabe-Ito safe palette)
};
function a11yGet(name) { return localStorage.getItem(A11Y[name].key) || A11Y[name].def; }
function a11ySet(name, val) {
  if (val && val !== A11Y[name].def) localStorage.setItem(A11Y[name].key, val);
  else localStorage.removeItem(A11Y[name].key);
  applyA11y();
}
function systemReducedMotion() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
// The single gate every animated / flashing surface checks before it moves.
function reduceMotion() {
  const m = a11yGet("motion");
  if (m === "reduce") return true;
  if (m === "full") return false;
  return systemReducedMotion();           // "auto" honours the operating system
}
function applyA11y() {
  const r = document.documentElement;
  r.setAttribute("data-reduce-motion", reduceMotion() ? "1" : "0");
  r.setAttribute("data-contrast", a11yGet("contrast"));
  r.setAttribute("data-text", a11yGet("text"));
  r.setAttribute("data-cb", a11yGet("colorblind") === "on" ? "1" : "0");
}
function colorBlindMode() { return document.documentElement.getAttribute("data-cb") === "1"; }
applyA11y();
try { matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", applyA11y); } catch (e) {}

// ── Keyboard + screen-reader: make every modal a proper focus-trapped dialog ──
function _focusables(el) {
  return [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.getClientRects().length > 0);
}
const _modalStack = [];
function enhanceModal(modal, label) {
  if (modal._a11yReady) return; modal._a11yReady = true;
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  if (label) modal.setAttribute("aria-label", label);
  modal.setAttribute("tabindex", "-1");
  const prev = document.activeElement;                  // remember where focus was, to restore on close
  const entry = { modal };
  _modalStack.push(entry);
  try { modal.focus(); } catch (e) {}                   // move focus into the dialog (announces the label)
  const obs = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      obs.disconnect();
      const i = _modalStack.indexOf(entry); if (i >= 0) _modalStack.splice(i, 1);
      try { if (prev && document.body.contains(prev) && prev.focus) prev.focus(); } catch (e) {}
    }
  });
  obs.observe(document.body, { childList: true });
}
// auto-wire every .cat-modal (settings, bug report, category mgr, accessibility…) the moment it mounts
new MutationObserver((muts) => {
  muts.forEach((m) => m.addedNodes.forEach((node) => {
    if (node.nodeType === 1 && node.classList && node.classList.contains("cat-modal")) {
      const h = node.querySelector(".cat-head span");
      enhanceModal(node, h ? h.textContent : "Dialog");
    }
  }));
}).observe(document.body, { childList: true });
// topmost modal: trap Tab inside it, close on Escape
document.addEventListener("keydown", (e) => {
  if (!_modalStack.length) return;
  const modal = _modalStack[_modalStack.length - 1].modal;
  if (e.key === "Escape") { const c = modal.querySelector(".cat-close"); if (c) { e.preventDefault(); c.click(); } return; }
  if (e.key !== "Tab") return;
  const f = _focusables(modal); if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function closeA11y() { ["a11yBackdrop", "a11yModal"].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); }); }
// The hub: one calm control block per need. Presets (one-tap loadouts that bundle
// these into a vibe) are deferred — we want this single surface to be excellent
// first. See BACKLOG "Comfort presets (deferred)".
function openA11y() {
  closeA11y();
  const back = document.createElement("div"); back.className = "cat-backdrop"; back.id = "a11yBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeA11y(); });
  const modal = document.createElement("div"); modal.className = "cat-modal a11y-modal"; modal.id = "a11yModal";
  // A heading, a plain-language line, and a full-width segmented choice you set one at a time.
  const ctrl = (name, title, desc, opts) =>
    '<section class="a11y-ctrl">' +
      '<div class="a11y-ctrl-head"><b>' + title + '</b><p>' + desc + "</p></div>" +
      '<div class="a11y-seg" role="group" aria-label="' + title.replace(/&amp;/g, "and") + '" data-name="' + name + '">' +
        opts.map((o) => '<button class="a11y-opt' + (a11yGet(name) === o.v ? " on" : "") + '" data-v="' + o.v + '" aria-pressed="' + (a11yGet(name) === o.v) + '">' + o.t + "</button>").join("") +
      "</div>" +
    "</section>";
  modal.innerHTML =
    '<div class="cat-head"><span>♿ Accessibility Hub</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="a11y-body">' +
      '<p class="a11y-intro">Built for how <em>you</em> actually use it. Adjust anything here, one thing at a time — and if something you need is missing, that request comes first.</p>' +
      '<div class="a11y-controls">' +
        ctrl("motion", "Motion &amp; flashing", "Calms the warp, removes the white flash, and stops looping animation — seizure-safe. <em>System</em> follows your device.", [{ v: "auto", t: "System" }, { v: "reduce", t: "Reduce" }, { v: "full", t: "Full" }]) +
        ctrl("contrast", "Contrast", "Stronger borders and text, so edges and numbers are easier to read.", [{ v: "normal", t: "Normal" }, { v: "high", t: "High" }]) +
        ctrl("text", "Text &amp; UI size", "Scale the whole interface up until it feels comfortable.", [{ v: "base", t: "Default" }, { v: "lg", t: "Large" }, { v: "xl", t: "Largest" }]) +
        ctrl("colorblind", "Color vision", "A color-blind-safe palette (Okabe-Ito) for the cache visualizer — and every value keeps its +/− sign, so color is never the only signal.", [{ v: "off", t: "Standard" }, { v: "on", t: "Safe palette" }]) +
      "</div>" +
      '<p class="a11y-note">This hub grows with the people who use it. Need a dyslexia-friendly font, reduced transparency, a full screen-reader pass — anything at all? Menu → ⚑ Report a bug or request. Accessibility asks jump the line.</p>' +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", closeA11y);
  const sync = () => {  // reflect current state across every segment (class + aria-pressed)
    modal.querySelectorAll(".a11y-seg").forEach((segEl) => {
      const name = segEl.dataset.name;
      segEl.querySelectorAll(".a11y-opt").forEach((b) => { const on = b.dataset.v === a11yGet(name); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    });
  };
  modal.querySelectorAll(".a11y-seg").forEach((segEl) => {
    const name = segEl.dataset.name;
    segEl.querySelectorAll(".a11y-opt").forEach((btn) => {
      btn.addEventListener("click", () => { a11ySet(name, btn.dataset.v); sync(); });
    });
  });
}

// ── Settings tiers: Minimalist (simple) → Standard (balanced) → Legendary (everything) ──
//    Renamed 2026-07-13 from Smooth/Big/Galaxy Brain — plain, literal, respectful labels per
//    Working Docs/1_PRINCIPLES.md. Stored tier VALUES (1/2/3) unchanged — nobody's settings move.
const TIER_KEY = "money.menuTier";
const TIERS = [{ n: 1, label: "Minimalist" }, { n: 2, label: "Standard" }, { n: 3, label: "Legendary" }];
function menuTier() { const t = parseInt(localStorage.getItem(TIER_KEY)); return (t >= 1 && t <= 3) ? t : 2; }
function applyTier() {
  const t = menuTier();
  document.documentElement.setAttribute("data-menutier", String(t));  // lets each mode get its own look
  document.querySelectorAll("[data-tier]").forEach((el) => { el.style.display = (+el.dataset.tier > t) ? "none" : ""; });
}
function openSettings() {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal set-modal";
  const v = (k) => { const x = localStorage.getItem(k); return x === null ? "" : x; };
  modal.innerHTML =
    '<div class="cat-head"><span>Settings</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="set-body">' +
      '<div class="set-sec">Mode</div>' +
      '<div class="set-tier" id="setTier"></div>' +
      '<div class="set-hint">how much of the app you want to see — <b>Minimalist</b> keeps it simple, <b>Legendary</b> shows every button</div>' +
      (window.__CACHE_DEMO__ ? "" :
      '<div class="set-sec">☁️ Cache cloud</div>' +
      // when signed in, your account (+ log out / switch) is the FIRST thing here — not
      // buried in the stepper below. Hidden while logged out (the stepper handles sign-in).
      '<div class="cloud-account" id="setCloudAccount" style="display:none">' +
        '<span class="cloud-acct-who">Signed in as <b id="setCloudWho"></b></span>' +
        '<span class="cloud-acct-acts">' +
          '<button class="set-btn cloud-btn-sub" id="setCloudLogout">Log out</button>' +
        '</span>' +
      '</div>' +
      '<div class="set-hint">Sign in and your cache <b>follows you to any device</b> — sealed on this device before it leaves. Prefer to keep everything on this machine? Flip sync off below.</div>' +
      '<button class="set-toggle" id="setCloudSync"><span>Sync to cloud</span><span class="set-state">on</span></button>' +
      '<div class="set-hint" id="setCloudSyncHint"></div>' +
      '<div class="set-bk-row" id="setCloudWipeRow" style="display:none"><button class="set-btn" id="setCloudWipe">Remove my cloud copy…</button></div>' +
      '<div class="cloud-guide" id="setCloudGuide"></div>' +
      '<div class="cloud-step" id="cloudStep1">' +
        '<div class="cloud-step-h"><span class="cloud-num">1</span><span class="cloud-step-t">Your account</span><span class="cloud-chk" id="cloudChk1"></span></div>' +
        '<div class="set-hint">This is your <b>Cache cloud</b> account — its own email + password, not your hosting (pockethost.io) login and not your bank.</div>' +
        '<label class="set-row"><span>Cloud URL</span><input id="setCloudUrl" type="text" autocomplete="off" readonly value="https://thecache.pockethost.io">' +
          '<button type="button" class="cloud-url-edit" id="setCloudUrlEdit" title="Only change this if you run your own cloud server">change</button></label>' +
        '<label class="set-row"><span>Email</span><input id="setCloudEmail" type="email" autocomplete="off" placeholder="you@email.com"></label>' +
        '<label class="set-row"><span>Password</span><input id="setCloudPass" type="password" autocomplete="off" placeholder="a password for your cloud account"></label>' +
        '<div class="set-bk-row">' +
          '<button class="set-btn" id="setCloudSignup">Create account</button>' +
          '<button class="set-btn" id="setCloudLogin">Log in</button>' +
        '</div>' +
        '<div class="set-hint cloud-verify" id="setCloudVerify" style="display:none"></div>' +
      '</div>' +
      '<div class="cloud-step" id="cloudStep2">' +
        '<div class="cloud-step-h"><span class="cloud-num">2</span><span class="cloud-step-t">How we open your cache</span><span class="cloud-chk" id="cloudChk2"></span></div>' +
        // FIRST-TIME setup: the key choice (ZK default) + passphrase + recovery-code opt-in.
        '<div id="cloudKeySetup">' +
          '<div class="set-hint">Your cache is always <b>encrypted on this device</b> before it leaves. Choose who can open it:</div>' +
          '<div class="key-choice" id="keyChoiceZk" data-keychoice="zk">' +
            '<span class="key-radio"></span>' +
            '<span class="key-choice-t"><b>Just me</b> — only you can open your cache. We physically can’t. <span class="key-rec">recommended</span></span>' +
          '</div>' +
          '<label class="set-row key-pass" id="keyPassRow"><span>Passphrase</span><input id="setCloudPhrase" type="password" autocomplete="off" placeholder="choose a passphrase (6+ characters)"></label>' +
          '<div class="key-choice" id="keyChoiceEsc" data-keychoice="esc">' +
            '<span class="key-radio"></span>' +
            '<span class="key-choice-t"><b>Keep a spare with The Cache</b> — we can help you get back in if you’re locked out. It means we <b>could technically read your data</b>.</span>' +
          '</div>' +
          '<label class="key-code-opt"><input type="checkbox" id="setCloudWantCode"> <span>Also give me a one-time <b>recovery code</b> (for paper or a password manager)</span></label>' +
          '<div class="set-hint key-file-note">However you choose, a <b>recovery file</b> downloads when you back up — keep it somewhere safe. If you lose <b>both</b> your way in and your recovery file, your cache is <b>gone for good</b> — we can’t recover it. That’s the price of real privacy.</div>' +
        '</div>' +
        // AFTER first backup: the unlock-methods manager (rendered by renderKeyMethods()).
        '<div id="cloudMethods" style="display:none"></div>' +
        // Always-available recovery ("I can't get in") — for when this device forgot the passphrase.
        '<div class="key-recover" id="cloudRecoverWrap" style="display:none"><button class="cloud-url-edit" id="cloudRecoverBtn" type="button">I can’t get in — use my recovery file or code</button></div>' +
        '<input id="setRecoverFile" type="file" accept=".cachekey,application/json" style="display:none">' +
      '</div>' +
      '<div class="cloud-step" id="cloudStep3">' +
        '<div class="cloud-step-h"><span class="cloud-num">3</span><span class="cloud-step-t">Sync</span><span class="cloud-chk" id="cloudChk3"></span></div>' +
        '<div class="set-bk-row">' +
          '<button class="set-btn" id="setCloudPush">⬆ Back up to cloud</button>' +
          '<button class="set-btn" id="setCloudPull">⬇ Restore from cloud</button>' +
        '</div>' +
        '<div class="set-hint cloud-msg" id="setCloudMsg"></div>' +
      '</div>') +
      // TEST TOOL — only ever appears for a "+cachetest" email (never your real account), so you
      // can re-run the fresh-signup / recovery flow a hundred times on ONE login. Wipes this test
      // account's cloud vault → back to the first-time "Just me / Keep a spare" choice.
      (isTestAccount()
        ? '<div class="set-sec">🧪 Test</div>' +
          '<div class="set-bk-row"><button class="set-btn resettest-btn" id="resetTestFresh">Reset to a fresh signup</button></div>' +
          '<div class="set-hint">Deletes <b>this test account\'s</b> cloud vault so the first-time key choice comes back. Only shows for <b>+cachetest</b> emails — your real account can never see this.</div>'
        : '') +
      '<div class="set-sec">Profile</div>' +
      '<div class="set-hint">your name, pronouns, about — plus what (if anything) you share publicly</div>' +
      '<div class="set-bk-row"><button class="set-btn" id="setEditProfile">🪪 Edit profile</button></div>' +
      // The token box only works where a local sync engine can claim it. On the hosted web
      // it POSTed to /api/connect, which webcache answers with "coming soon" — so a tester
      // pasted their one-time token, was told "it stays on this computer" (on a device that
      // ISN'T one), and dead-ended. Same trap that was fixed in openConnect and missed here.
      '<div class="set-sec">Bank connection</div>' +
      (window.__CACHE_WEB__
        ? '<div class="set-hint">Link your bank right here — open <b>⚡ Connect</b> to paste your SimpleFIN token (or import a bank CSV). Your cache pulls and computes everything in your browser; nothing leaves your device unencrypted. <button class="cn-linkbtn" id="setSfExplain">How does this work?</button></div>'
        : '<div class="set-bank-status" id="setBankStatus">checking…</div>' +
          '<div class="set-token-wrap"><input id="setToken" class="set-bank-input" type="password" placeholder="paste your SimpleFIN setup token">' +
            '<button class="set-token-eye" id="setTokenEye" type="button" aria-label="Show/hide token"><i data-lucide="eye"></i></button></div>' +
          '<div class="set-bank-row"><button class="set-bank-btn" id="setConnect">Connect &amp; sync</button>' +
            '<button class="set-bank-help" id="setConnectHelp">Help &amp; demo</button></div>' +
          '<div class="set-hint">Get a token from your SimpleFIN account → “New app connection”. It stays on this computer, never shared. New here? Tap <b>Help &amp; demo</b> for steps + free sample data.</div>') +
      '<div class="set-sec">Safety buffer</div>' +
      '<label class="set-row"><span>Reserve (don’t-touch)</span><input id="setReserve" type="number" value="' + v("money.reserve") + '" placeholder="0"></label>' +
      '<label class="set-row"><span>Monthly need</span><input id="setNeed" type="number" value="' + v("money.need") + '" placeholder="auto from core"></label>' +
      '<div class="set-hint">Reserve protects your runway in the Safe widget. Your <b>income, rent, rate &amp; bills</b> now live in the <b>Budget</b> widget → tap <b>build</b>.</div>' +
      '<div class="set-sec">Display</div>' +
      '<button class="set-toggle" id="setPrivacy"><span>Privacy blur</span><span class="set-state">off</span></button>' +
      '<div class="set-hint">blurs dollar amounts until you hover — good for screen-sharing</div>' +
      '<button class="set-toggle" id="setDockMobile"><span>Show the dock on this phone</span><span class="set-state">off</span></button>' +
      '<div class="set-hint">phones keep just <b>🃏 the deck</b> at the bottom — turn this on to bring the dock’s pills back on this device (this setting stays on this device)</div>' +
      '<button class="set-toggle" id="setAutoPin" data-tier="2"><span>Auto-pin favorites</span><span class="set-state">on</span></button>' +
      '<div class="set-hint" data-tier="2">starred widgets &amp; dock items jump to the top · turn off to leave them where they are when starred</div>' +
      '<button class="set-toggle" id="setAnalytics"><span>Share anonymous usage</span><span class="set-state">off</span></button>' +
      '<div class="set-hint">helps improve the app — <b>opt-in &amp; anonymous</b>. Your financial data is <b>never</b> sent — only which widgets you use, rage-clicks, and errors.</div>' +
      '<div class="set-sec">Backup &amp; restore</div>' +
      '<div class="set-hint">Encrypts a copy of <b>all your data</b> with a passphrase only you know — <b>end-to-end</b>: the file is unreadable without it. ⚠ Lose the passphrase and the backup can’t be opened.</div>' +
      '<label class="set-row"><span>Passphrase</span><input id="setBkPass" type="password" placeholder="choose / enter a passphrase" autocomplete="off"></label>' +
      '<div class="set-bk-row">' +
        '<button class="set-btn" id="setBkExport">⬇ Download encrypted backup</button>' +
        '<button class="set-btn" id="setBkRestore">⬆ Restore from backup…</button>' +
        '<input id="setBkFile" type="file" accept=".cache" style="display:none">' +
      '</div>' +
      '<div class="set-hint" id="setBkMsg"></div>' +
      '<div class="set-hint" style="margin-top:6px">Or push the encrypted backup to your own <b>WebDAV</b> (Nextcloud, Fastmail, a NAS) — it only ever stores the sealed file, never the passphrase.</div>' +
      '<label class="set-row"><span>WebDAV URL</span><input id="setWdUrl" type="text" autocomplete="off" placeholder="https://dav.example.com/thecache/"></label>' +
      '<label class="set-row"><span>Username</span><input id="setWdUser" type="text" autocomplete="off" placeholder="optional"></label>' +
      '<label class="set-row"><span>Password</span><input id="setWdPass" type="password" autocomplete="off" placeholder="optional"></label>' +
      '<div class="set-bk-row">' +
        '<button class="set-btn" id="setWdSave">Save WebDAV</button>' +
        '<button class="set-btn" id="setWdPush">⬆ Back up to WebDAV now</button>' +
      '</div>' +
      '<div class="set-hint" id="setWdMsg"></div>' +
      '<div class="set-themes" id="setThemes"></div>' +
      '<div class="set-sec">Fonts</div>' +
      '<div class="set-fonts" id="setFonts"></div>' +
      '<div class="set-sec">💛 Back the Cache</div>' +
      '<div class="set-hint">the Cache is free and stays free — this is only for people who feel like chipping in</div>' +
      '<div class="set-bk-row"><button class="set-btn" id="setBackCache">💛 Back the Cache</button></div>' +
      '<div class="set-sec" data-tier="3">Stats bar</div>' +
      '<div class="set-hint" data-tier="3">the live numbers along the top — toggle any on or off · drag them in the bar to reorder</div>' +
      '<div id="setStats" class="set-stats" data-tier="3"></div>' +
    '</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  makeModalResizable(modal, "money.settings");
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
  modal.querySelector("#setBackCache").addEventListener("click", () => openBackCache());

  // profile fields moved to the Edit-profile surface (openProfile) — it writes
  // money.profileCard only (GENERIC, converges); money.profile is never touched,
  // so the old whole-object save's stats-clobber can't happen anymore
  modal.querySelector("#setEditProfile").addEventListener("click", () => { closeCategorizer(); openProfile(); });
  const rtf = modal.querySelector("#resetTestFresh");   // only exists for +cachetest accounts
  if (rtf) rtf.addEventListener("click", () => { try { resetTestToFresh(); } catch (e) {} });

  const bind = (sel, key) => modal.querySelector(sel).addEventListener("change", (e) => {
    const val = e.target.value.trim();
    if (val === "") localStorage.removeItem(key);
    else localStorage.setItem(key, String(parseFloat(val.replace(/[^0-9.]/g, "")) || 0));
    Store.emit();  // ripple to Safe / Gap / Work
  });
  bind("#setReserve", "money.reserve"); bind("#setNeed", "money.need");

  // Encrypted backup / restore
  const bkPass = modal.querySelector("#setBkPass"), bkMsg = modal.querySelector("#setBkMsg"), bkFile = modal.querySelector("#setBkFile");
  modal.querySelector("#setBkExport").addEventListener("click", async () => {
    const p = (bkPass.value || "").trim();
    if (p.length < 6) { bkMsg.textContent = "Choose a passphrase of at least 6 characters first."; return; }
    bkMsg.textContent = "Encrypting…";
    try { const n = await downloadEncryptedBackup(p); bkMsg.textContent = "✓ Encrypted backup of " + n + " files downloaded. Store it (and the passphrase) somewhere safe."; }
    catch (e) { bkMsg.textContent = "Backup failed: " + (e.message || e); }
  });
  modal.querySelector("#setBkRestore").addEventListener("click", () => {
    if ((bkPass.value || "").trim().length < 6) { bkMsg.textContent = "Enter the backup’s passphrase above first."; return; }
    bkFile.click();
  });
  bkFile.addEventListener("change", async () => {
    const f = bkFile.files && bkFile.files[0]; if (!f) return;
    if (!confirm("Restore will OVERWRITE your current data with this backup.\n\nYour current data is snapshotted first (recoverable), but continue only if you mean it.")) { bkFile.value = ""; return; }
    bkMsg.textContent = "Decrypting + restoring…";
    try {
      const res = await restoreEncryptedBackup(f, (bkPass.value || "").trim());
      bkMsg.textContent = "✓ Restored " + res.written + " files (your previous data saved as " + res.snapshot + "). Reloading…";
      setTimeout(() => location.reload(), 1600);
    } catch (e) { bkMsg.textContent = "Restore failed: " + (e.message || e); }
    bkFile.value = "";
  });
  // WebDAV backup target
  const wdUrl = modal.querySelector("#setWdUrl"), wdUser = modal.querySelector("#setWdUser"),
        wdPass = modal.querySelector("#setWdPass"), wdMsg = modal.querySelector("#setWdMsg");
  fetch("/api/webdav-config").then((r) => r.json()).then((c) => {
    if (c && c.configured) { wdUrl.value = c.url || ""; wdUser.value = c.user || ""; wdMsg.textContent = "Connected to " + (c.url || "your WebDAV") + "."; }
  }).catch(() => {});
  modal.querySelector("#setWdSave").addEventListener("click", async () => {
    wdMsg.textContent = "Saving…";
    try {
      const c = await (await fetch("/api/webdav-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: wdUrl.value.trim(), user: wdUser.value.trim(), pass: wdPass.value }) })).json();
      wdMsg.textContent = c.configured ? "✓ WebDAV saved." : "WebDAV cleared.";
    } catch (e) { wdMsg.textContent = "Couldn’t save: " + (e.message || e); }
  });
  modal.querySelector("#setWdPush").addEventListener("click", async () => {
    const p = (bkPass.value || "").trim();
    if (p.length < 6) { wdMsg.textContent = "Set the backup passphrase (above) first — it encrypts the file before it leaves."; return; }
    if (!wdUrl.value.trim()) { wdMsg.textContent = "Add + save your WebDAV URL first."; return; }
    wdMsg.textContent = "Encrypting + uploading…";
    try { const fn = await pushBackupToWebdav(p); wdMsg.textContent = "✓ Encrypted backup pushed to WebDAV as " + fn; }
    catch (e) { wdMsg.textContent = "Backup to WebDAV failed: " + (e.message || e); }
  });
  // Cache cloud (PocketBase) — hidden in the demo. A guided 3-step flow:
  //   1 account · 2 encryption key · 3 sync — each step checks off, a banner says what's next.
  const clUrl = modal.querySelector("#setCloudUrl");
  if (clUrl) {
  const clEmail = modal.querySelector("#setCloudEmail"),
        clPass = modal.querySelector("#setCloudPass"), clMsg = modal.querySelector("#setCloudMsg"),
        clPhrase = modal.querySelector("#setCloudPhrase"), clGuide = modal.querySelector("#setCloudGuide"),
        clPush = modal.querySelector("#setCloudPush"), clPull = modal.querySelector("#setCloudPull"),
        clSignup = modal.querySelector("#setCloudSignup"), clLogin = modal.querySelector("#setCloudLogin"),
        clLogout = modal.querySelector("#setCloudLogout"),
        clAccount = modal.querySelector("#setCloudAccount"), clWho = modal.querySelector("#setCloudWho"),
        clStep = [null, modal.querySelector("#cloudStep1"), modal.querySelector("#cloudStep2"), modal.querySelector("#cloudStep3")],
        clChk = [null, modal.querySelector("#cloudChk1"), modal.querySelector("#cloudChk2"), modal.querySelector("#cloudChk3")];
  // the URL is locked by default — everyone uses the official cloud, and a typo here
  // was a support nightmare. The small "change" unlock keeps self-hosting possible.
  const clUrlEdit = modal.querySelector("#setCloudUrlEdit");
  if (clUrlEdit) clUrlEdit.addEventListener("click", (e) => {
    e.preventDefault();
    clUrl.readOnly = false; clUrlEdit.style.display = "none";
    clUrl.focus(); try { clUrl.select(); } catch (err) {}
  });
  // storage-mode toggle: cloud sync on ⇄ local-only, said plainly both ways
  const clSync = modal.querySelector("#setCloudSync"), clSyncHint = modal.querySelector("#setCloudSyncHint"),
        clWipeRow = modal.querySelector("#setCloudWipeRow"), clWipe = modal.querySelector("#setCloudWipe"),
        clVerify = modal.querySelector("#setCloudVerify");
  function paintSyncToggle() {
    const off = cloudPaused();
    clSync.querySelector(".set-state").textContent = off ? "off" : "on";
    clSyncHint.innerHTML = off
      ? "Cloud sync is <b>off</b> — your cache lives on this device only. Your last cloud copy stays sealed where it is until you remove it below."
      : "Changes sync to the cloud automatically, sealed on this device first. Sign in anywhere and your cache follows.";
    clWipeRow.style.display = off && cloudState().token ? "" : "none";
  }
  clSync.addEventListener("click", () => {
    const turnOff = !cloudPaused();
    try { localStorage.setItem("money.cloudPaused", turnOff ? "1" : "0"); } catch (e) {}
    if (!turnOff) autoPushSoon();
    paintSyncToggle(); cloudChip();
    clSay(turnOff ? "Cloud sync is off — local-only from here. Nothing leaves this device." : "✓ Cloud sync is back on — syncing shortly.", turnOff ? "" : "ok");
  });
  clWipe.addEventListener("click", async () => {
    if (!confirm("Remove your sealed cloud copy? Your data on THIS device is untouched — and you can push a fresh copy anytime by turning sync back on.")) return;
    clSay("Removing your cloud copy…", "work");
    try { const res = await cloudWipe(); refreshCloud(); clSay(res.none ? "Nothing in the cloud to remove — you're already local-only." : "✓ Cloud copy removed. You're fully local-only now.", "ok"); }
    catch (e) { clSay("Couldn't remove it: " + (e.message || e), "err"); }
  });
  clVerify.addEventListener("click", async (e) => {
    if (!e.target.closest("#setCloudResend")) return;
    clSay("Requesting a fresh verification email…", "work");
    try {
      const r = await fetch(cloudUrl() + "/api/collections/users/request-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: cloudState().email || clEmail.value.trim() }) });
      if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(cloudErr(d) || ("the cloud said no (HTTP " + r.status + ")")); }
      clSay("✓ Verification email requested — check your inbox (and spam).", "ok");
    } catch (err) { clSay("Couldn't request it: " + (err.message || err), "err"); }
  });
  paintSyncToggle();
  // one shared encryption key across the app: keep the cloud passphrase + the backup passphrase in sync
  clPhrase.addEventListener("input", () => { bkPass.value = clPhrase.value; refreshCloud(); });
  if (bkPass) bkPass.addEventListener("input", () => { clPhrase.value = bkPass.value; refreshCloud(); });
  const phrase = () => (clPhrase.value || "").trim();
  // ── Unlock & recovery (multi-wrap keybox) ──────────────────────────────────────
  // Before the first backup: the key CHOICE (zero-knowledge default vs a spare with us)
  // + passphrase + recovery-code opt-in. After it: the unlock-METHODS manager. Recovery
  // ("I can't get in") is always one tap away once a vault exists.
  const keySetup = modal.querySelector("#cloudKeySetup"),
        keyMethods = modal.querySelector("#cloudMethods"),
        keyPassRow = modal.querySelector("#keyPassRow"),
        keyChoiceZk = modal.querySelector("#keyChoiceZk"),
        keyChoiceEsc = modal.querySelector("#keyChoiceEsc"),
        wantCode = modal.querySelector("#setCloudWantCode"),
        recoverWrap = modal.querySelector("#cloudRecoverWrap"),
        recoverBtn = modal.querySelector("#cloudRecoverBtn"),
        recoverFile = modal.querySelector("#setRecoverFile");
  const keyChoice = () => (keyChoiceEsc && keyChoiceEsc.classList.contains("on")) ? "esc" : "zk";
  function paintKeyChoice() {
    const esc = keyChoice() === "esc";
    if (keyChoiceZk) keyChoiceZk.classList.toggle("on", !esc);
    if (keyChoiceEsc) keyChoiceEsc.classList.toggle("on", esc);
    if (keyPassRow) keyPassRow.style.display = esc ? "none" : "";   // "Just me" needs a passphrase; a spare doesn't
  }
  if (keyChoiceZk) keyChoiceZk.addEventListener("click", () => { keyChoiceZk.classList.add("on"); keyChoiceEsc.classList.remove("on"); paintKeyChoice(); refreshCloud(); });
  if (keyChoiceEsc) keyChoiceEsc.addEventListener("click", () => { keyChoiceEsc.classList.add("on"); keyChoiceZk.classList.remove("on"); paintKeyChoice(); refreshCloud(); });
  paintKeyChoice();
  // The after-backup methods manager. Re-pulls the live keybox so it always tells the
  // truth about what actually opens the vault (not a local guess).
  async function renderKeyMethods() {
    if (!keyMethods) return;
    let methods = [];
    try { methods = await cloudListMethods(); } catch (e) {}
    const has = (t) => methods.indexOf(t) >= 0;
    const nonEsc = methods.filter((m) => m !== "esc").length, hasEsc = has("esc");
    const label = { pass: "Passphrase", file: "Recovery file", code: "Recovery code" };
    const sub = { pass: "type it to open your cache anywhere", file: "a small file you keep safe", code: "a one-time code for paper / a password manager" };
    let rows = "";
    ["pass", "file", "code"].forEach((t) => {
      const on = has(t);
      // Remove only offers when this ISN'T the last personal method (keyDel still guards).
      const canDel = on && nonEsc > 1;
      rows += '<div class="key-method' + (on ? " on" : "") + '">' +
        '<span class="key-method-t">' + (on ? "✓ " : "") + label[t] + '<span class="key-sub">' + sub[t] + '</span></span>' +
        '<span class="key-method-acts">' +
          '<button class="cloud-url-edit" data-key-add="' + t + '">' + (on ? (t === "pass" ? "Change" : "Replace") : "Add") + '</button>' +
          (canDel ? ' <button class="cloud-url-edit" data-key-del="' + t + '">Remove</button>' : '') +
        '</span></div>';
    });
    rows += '<div class="key-method key-esc' + (hasEsc ? " on" : "") + '">' +
      '<span class="key-method-t">' + (hasEsc ? "✓ " : "") + 'Spare key with The Cache<span class="key-sub">' + (hasEsc ? "we hold a key — we could technically read your data" : "off — only your own methods can open your cache") + '</span></span>' +
      '<span class="key-method-acts"><button class="cloud-url-edit" data-key-esc="' + (hasEsc ? "off" : "on") + '">' + (hasEsc ? "Turn off" : "Turn on") + '</button></span></div>';
    keyMethods.innerHTML = '<div class="set-hint">Your <b>unlock methods</b> — <b>any one</b> opens your cache. Keep at least one you control.</div>' +
      (methods.length ? rows : '<div class="set-hint">Couldn’t read your unlock methods just now — check your connection and reopen Settings.</div>');
    keyMethods.querySelectorAll("[data-key-add]").forEach((b) => b.addEventListener("click", () => keyAdd(b.dataset.keyAdd)));
    keyMethods.querySelectorAll("[data-key-del]").forEach((b) => b.addEventListener("click", () => keyDel(b.dataset.keyDel, nonEsc, hasEsc)));
    keyMethods.querySelectorAll("[data-key-esc]").forEach((b) => b.addEventListener("click", () => keyEsc(b.dataset.keyEsc === "on")));
  }
  async function keyAdd(t) {
    try {
      if (t === "pass") {
        const pw = prompt("Choose a passphrase (at least 6 characters). You’ll type this to open your cache on a new device.");
        if (pw == null) return;
        if (pw.trim().length < 6) { clSay("A passphrase needs at least 6 characters.", "err"); return; }
        clSay("Adding your passphrase…", "work");
        await cloudAddPassphrase(pw.trim());
        clSay("✓ Passphrase added — it opens your cache on any device.", "ok");
      } else if (t === "file") {
        clSay("Making a fresh recovery file…", "work");
        const secret = await cloudAddRecoveryFile();
        let dl = false; try { dl = downloadRecoveryFile(secret); } catch (e) {}
        clSay(dl
          ? "✓ New recovery file downloaded — keep it somewhere safe. Your previous file no longer works."
          : "⚠ Your recovery file was created but the download didn’t start — check your browser’s download settings, then tap Replace again to get the file.", dl ? "ok" : "err");
      } else if (t === "code") {
        clSay("Making a recovery code…", "work");
        const code = await cloudAddRecoveryCode();
        clSay("✓ Recovery code created (see the box) — store it now, it won’t be shown again.", "ok");
        alert("Your one-time recovery code — write it down now, it won’t be shown again:\n\n    " + code + "\n\nAnyone with this code can open your cache, so keep it private.");
      }
      renderKeyMethods();
    } catch (e) { clSay((e.message || e), "err"); }
  }
  async function keyDel(t, nonEsc, hasEsc) {
    const human = { pass: "passphrase", file: "recovery file", code: "recovery code" }[t] || t;
    if (nonEsc <= 1) {   // this is the last method the USER controls
      if (!hasEsc) { clSay("That’s your only way in — add another method before removing this one.", "err"); return; }
      if (!confirm("Remove your " + human + "?\n\nThis is your only PERSONAL way in. After this, ONLY The Cache’s spare key can open your cache — if we ever can’t help, your data is gone. Continue?")) return;
    } else if (!confirm("Remove your " + human + "? You’ll no longer open your cache with it. Make sure you still have another way in.")) return;
    clSay("Removing your " + human + "…", "work");
    try { await cloudRemoveMethod(t); clSay("✓ Removed your " + human + ".", "ok"); renderKeyMethods(); refreshCloud(); }
    catch (e) { clSay((e.message || e), "err"); }
  }
  async function keyEsc(on) {
    if (on && !confirm("Keep a spare key with The Cache?\n\nWe’ll hold a key so we can help you back in if you’re locked out — but it means we could technically read your data. Your other unlock methods keep working.")) return;
    if (!on && !confirm("Turn off the spare key?\n\nWe’ll delete our copy of your key. Only your own methods (passphrase / recovery file / code) will open your cache. If you lose all of those, we can’t help. Continue?")) return;
    clSay(on ? "Turning on the spare key…" : "Removing our spare key…", "work");
    try { await cloudSetEscrow(on); clSay(on ? "✓ Spare key on — we can help you recover." : "✓ Spare key off — your cache is zero-knowledge now.", "ok"); renderKeyMethods(); refreshCloud(); }
    catch (e) { clSay((e.message || e), "err"); }
  }
  // Recovery ("I can't get in"): unlock the vault key with a file or code, cache it, reload.
  async function doRecover(opts, label) {
    clSay("Opening your cache with your " + label + "…", "work");
    try {
      await cloudRecoverUnlock(opts);
      clSay("✓ Unlocked with your " + label + " — loading your cache…", "ok");
      try { await cloudAutoPull(); } catch (e) {}
      setTimeout(() => location.reload(), 900);
    } catch (e) { clSay((e.message || e), "err"); }
  }
  if (recoverBtn) recoverBtn.addEventListener("click", () => {
    const c = prompt("Get back in.\n\n• Type  FILE  to load your recovery file (.cachekey), or\n• paste your recovery CODE here:");
    if (c == null) return;
    const t = c.trim();
    if (/^file$/i.test(t)) { if (recoverFile) recoverFile.click(); return; }
    if (t) doRecover({ code: recoveryCodeNormalize(t) }, "recovery code");
  });
  if (recoverFile) recoverFile.addEventListener("change", async () => {
    const fl = recoverFile.files && recoverFile.files[0]; if (!fl) { return; }
    let secret = null; try { secret = parseRecoveryFile(await fl.text()); } catch (e) {}
    recoverFile.value = "";
    if (!secret) { clSay("That doesn’t look like a Cache recovery file (.cachekey).", "err"); return; }
    doRecover({ fileKey: secret }, "recovery file");
  });
  // Repaint the whole stepper: checkmarks, which step is active, the next-step banner, button enabling.
  function refreshCloud() {
    const s = cloudState();
    // the "key" step is satisfied by a typed passphrase (zero-knowledge), OR by the
    // device already holding the cloud data key, OR simply by being logged in —
    // escrow mode needs nothing from the user (that's the point)
    const inAccount = !!s.token, hasBackup = !!s.lastPush;
    // a keybox exists on the server ⟺ your unlock is actually set up (survives across
    // devices: mode/recordId are learned on pull, lastPush on this device's own push)
    const hasVault = hasBackup || !!s.mode || !!s.recordId;
    const holdsKey = !!cloudKeyGet();
    // step checkmarks + active highlight
    [[1, inAccount], [2, hasVault], [3, hasBackup]].forEach(([n, done]) => {
      clChk[n].textContent = done ? "✓" : "";
      clChk[n].className = "cloud-chk" + (done ? " on" : "");
      clStep[n].classList.toggle("done", done);
    });
    const active = !inAccount ? 1 : (!hasVault ? 2 : 3);   // step 2 = choose how we open your cache
    clStep.forEach((el, n) => el && el.classList.toggle("active", n === active));
    // key panels: the setup CHOICE before the first backup, the methods MANAGER after
    // it (only where this device holds the key), and RECOVER when this device is locked out
    if (keySetup) keySetup.style.display = (inAccount && !hasVault) ? "" : "none";
    if (keyMethods) keyMethods.style.display = (inAccount && hasVault && holdsKey) ? "" : "none";
    if (recoverWrap) recoverWrap.style.display = (inAccount && hasVault && !holdsKey) ? "" : "none";
    if (inAccount && hasVault && holdsKey && keyMethods && !keyMethods.dataset.rendered) { keyMethods.dataset.rendered = "1"; renderKeyMethods(); }
    if (!(inAccount && hasVault && holdsKey) && keyMethods) keyMethods.dataset.rendered = "";   // re-render when it next becomes visible
    // account buttons
    clSignup.style.display = inAccount ? "none" : "";
    clLogin.style.display = inAccount ? "none" : "";
    // the prominent account row (with log out / switch) leads the panel when signed in
    if (clAccount) clAccount.style.display = inAccount ? "" : "none";
    if (clWho) clWho.textContent = s.email || "your account";
    // sync buttons need a login AND sync switched on — while it's off, the
    // toggle's "nothing leaves this device" promise is kept to the letter
    const canSync = inAccount && !cloudPaused();
    [clPush, clPull].forEach((b) => { b.disabled = !canSync; b.classList.toggle("is-disabled", !canSync); });
    clPull.disabled = !canSync || !hasBackup; clPull.classList.toggle("is-disabled", clPull.disabled);
    // the big "where am I / what next" banner
    let cls = "cloud-guide", html;
    if (!inAccount) {
      html = '<b>Step 1 — create your account</b><span class="cloud-sub">Pick an email + password below and hit <b>Create account</b> (or <b>Log in</b> if you have one).</span>';
    } else if (!hasBackup) {
      cls += " mid";
      html = '<b>✓ Signed in as ' + escapeHtml(s.email || "") + ' — you’re ready</b><span class="cloud-sub"><b>Hit ⬆ Back up to cloud</b> to seal &amp; upload your cache. From then on it syncs itself.</span>';
    } else {
      cls += " done";
      html = '<b>✓ All set — your cache syncs itself</b><span class="cloud-sub">Last sync <b>' + cloudAgo(s.lastPush) + '</b>' + (s.lastPushCount ? ' · ' + s.lastPushCount + ' files sealed' : '') + '. Sign in with this email on any device and your cache follows you.</span>';
    }
    clGuide.className = cls; clGuide.innerHTML = html;
    // gentle verify-your-email nudge (delivers once the instance can send mail)
    if (clVerify) {
      if (inAccount && s.verified === false) {
        clVerify.style.display = "";
        clVerify.innerHTML = '📧 <b>Verify your email</b> — a confirmation was requested for ' + escapeHtml(s.email || "") + '. Nothing arrived? <button type="button" class="cloud-url-edit" id="setCloudResend">resend</button>';
      } else clVerify.style.display = "none";
    }
    if (typeof paintSyncToggle === "function") paintSyncToggle();
  }
  // big, obvious feedback — green flash on success, red on failure, grey while working
  function clSay(text, kind) {
    clMsg.textContent = text;
    clMsg.className = "set-hint cloud-msg" + (kind ? " " + kind : "");
    if (kind === "ok") { clMsg.classList.remove("flash"); void clMsg.offsetWidth; clMsg.classList.add("flash"); }
  }
  (function initCloud() {
    const s = cloudState(); if (s.url) clUrl.value = s.url; if (s.email) clEmail.value = s.email; if (bkPass && bkPass.value) clPhrase.value = bkPass.value; refreshCloud();
    // validate the stored session for real — a token quietly expires after ~14 days,
    // and an eternal green check that fails on sync is worse than an honest re-login ask.
    // Repaint either way: a success may have just learned the verified flag.
    if (s.token) cloudAuthCheck().then((ok) => { refreshCloud(); if (!ok) clSay("Your cloud login expired — enter your password and hit Log in. Your data is safe.", "err"); });
  })();
  // when a DIFFERENT account takes over this browser, cloudLogin has already swapped
  // localStorage to the new account — but the board/theme/character render from in-memory state
  // loaded once at boot, so a full reload is the safe way to come up cleanly as the new account
  // (a stale board could even write the old account's layout into the new account's vault).
  // Mirrors the Restore path, which reloads after its wholesale localStorage swap.
  const reloadIfSwitched = (before) => {
    const now = cloudState().userId;
    if (before && now && now !== before) { clSay("✓ Switched account — reloading…", "ok"); setTimeout(() => location.reload(), 500); return true; }
    // a login that RESTORED a parked silo must also reload — the userId may be unchanged
    // (same account back from logout), but the board booted from the empty live slot and
    // would keep showing (and saving) that emptiness over the just-restored data
    if (_cloudLoginRestored) { clSay("✓ Logged in — loading your cache…", "ok"); setTimeout(() => location.reload(), 500); return true; }
    return false;
  };
  // a login that FAILED after the storage was already swapped (a mid-restore quota abort) leaves
  // the board rendering the previous account from memory over a cleared, parked slot — reload
  // once the error has been readable, so the screen matches the truth instead of ghosting data
  const reloadIfAborted = () => { if (window.__cacheStorageSwapped) setTimeout(() => location.reload(), 3000); };
  clSignup.addEventListener("click", async () => {
    clSay("Creating account…", "work");
    const before = cloudState().userId;
    try { await cloudSignup(clUrl.value.trim(), clEmail.value.trim(), clPass.value); if (reloadIfSwitched(before)) return; refreshCloud(); clSay("✓ Account created — you’re signed in. Hit ⬆ Back up to cloud and you’re done.", "ok"); }
    catch (e) { clSay("Couldn’t create account: " + (e.message || e), "err"); reloadIfAborted(); }
  });
  clLogin.addEventListener("click", async () => {
    clSay("Logging in…", "work");
    const before = cloudState().userId;
    try { await cloudLogin(clUrl.value.trim(), clEmail.value.trim(), clPass.value); if (reloadIfSwitched(before)) return; refreshCloud(); cloudChip(); cloudAutoPull(); clSay("✓ Logged in as " + cloudState().email + ".", "ok"); }
    catch (e) { clSay("Login failed: " + (e.message || e), "err"); reloadIfAborted(); }
  });
  clLogout.addEventListener("click", () => {
    const hadAcct = !!cloudState().userId;
    const parked = cloudLogout(); clPass.value = "";
    refreshCloud(); try { cloudChip(); } catch (e) {} try { socialUpdateBadge(); } catch (e) {}
    // parked → the account's data left the live slot, but the board still renders it from
    // memory — reload so a shared computer really shows a clean cache the moment you log out
    if (parked) { clSay("Logged out — clearing this screen…", "ok"); setTimeout(() => location.reload(), 500); }
    else if (hadAcct) clSay("Logged out — but this device is out of storage, so your data couldn't be tucked away and stays visible here. Free up space and log out again to clear it.", "err");
    else clSay("Logged out.", "");
  });
  clPush.addEventListener("click", async () => {
    if (!cloudState().token) { clSay("Do Step 1 first — create or log into your account.", "err"); return; }
    const st = cloudState();
    const isFirstSetup = !(st.lastPush || st.mode || st.recordId);   // no keybox on the server yet
    const escrow = keyChoice() === "esc";
    if (phrase() && phrase().length < 6) { clSay("A passphrase needs at least 6 characters (or leave it empty and choose “Keep a spare”).", "err"); return; }
    // "Just me" (zero-knowledge) needs a passphrase — it's what you type to open the vault
    // on a new device. Without it (and no spare) a new device would have no way in at all.
    if (isFirstSetup && !escrow && phrase().length < 6) { clSay("Choose a passphrase (6+ characters) so you can open your cache on your other devices — or pick “Keep a spare with The Cache” below.", "err"); return; }
    clSay("Encrypting + syncing to cloud…", "work");
    try {
      const res = await cloudPush(phrase(), { escrow });
      if (isFirstSetup) {
        // Auto-issue the recovery FILE to EVERYONE (+ a code if opted). If the download
        // doesn't land, say so LOUDLY — never let the user believe they're covered.
        let fileOk = false, fileErr = "";
        try { const secret = await cloudAddRecoveryFile(); try { fileOk = downloadRecoveryFile(secret); } catch (e) { fileErr = "the download didn’t start"; } }
        catch (e) { fileErr = (e && e.message) || "couldn’t create it"; }
        let codeMsg = "";
        if (wantCode && wantCode.checked) {
          try { const code = await cloudAddRecoveryCode(); alert("Your one-time recovery code — write it down now, it won’t be shown again:\n\n    " + code + "\n\nAnyone with this code can open your cache, so keep it private."); codeMsg = " Your recovery code is in the pop-up — store it now."; }
          catch (e) { codeMsg = " (Couldn’t create a recovery code — you can add one later in Settings.)"; }
        }
        refreshCloud(); cloudChip("ok");
        if (fileOk) clSay("✓ Backed up — " + res.count + " files sealed. Your recovery file just downloaded — keep it somewhere safe." + codeMsg, "ok");
        else clSay("✓ Backed up — " + res.count + " files sealed. ⚠ But your recovery file " + fileErr + " — use “Recovery file → Replace” below to get it. Without it, a forgotten " + (escrow ? "login" : "passphrase") + " could lock you out.", "err");
        return;
      }
      refreshCloud(); cloudChip("ok"); clSay("✓ Backed up to the cloud — " + res.count + " files sealed & encrypted. From here it syncs itself.", "ok");
    }
    catch (e) { clSay("Cloud backup failed: " + (e.message || e), "err"); }
  });
  clPull.addEventListener("click", async () => {
    if (window.__CACHE_WEB__) { clSay("Restoring runs from the desktop app — this device reads the synced result.", "err"); return; }
    if (!cloudState().token) { clSay("Do Step 1 first — log into your account.", "err"); return; }
    if (phrase() && phrase().length < 6) { clSay("A zero-knowledge passphrase needs 6+ characters (or clear the field for the simple default).", "err"); return; }
    if (!confirm("Restore from cloud replaces this device's money data files with your cloud copy (the current files are backed up first, so this is recoverable). Your check-ins, ledger history, character and settings are MERGED in — nothing local is erased. Continue?")) return;
    clSay("Pulling + decrypting…", "work");
    try {
      const res = await cloudPull(phrase());
      const mg = res.merged || {};
      const extra = (mg.checkins || mg.ledger) ? " (merged " + (mg.checkins || 0) + " check-ins, " + (mg.ledger || 0) + " ledger rows)" : "";
      clSay("✓ Restored " + res.written + " files from cloud" + extra + ". Reloading…", "ok");
      setTimeout(() => location.reload(), 1500);
    }
    catch (e) { clSay("Cloud restore failed: " + (e.message || e), "err"); }
  });
  }  // end cloud (hidden in demo)

  const privBtn = modal.querySelector("#setPrivacy");
  const paintPriv = () => {
    const on = localStorage.getItem("money.privacy") === "1";
    privBtn.classList.toggle("on", on);
    privBtn.querySelector(".set-state").textContent = on ? "on" : "off";
  };
  paintPriv();
  privBtn.addEventListener("click", () => {
    localStorage.setItem("money.privacy", localStorage.getItem("money.privacy") === "1" ? "0" : "1");
    applyPrivacy(); paintPriv();
  });

  const dockMbBtn = modal.querySelector("#setDockMobile");
  const paintDockMb = () => {
    const on = localStorage.getItem("money.dockMobile") === "1";
    dockMbBtn.classList.toggle("on", on);
    dockMbBtn.querySelector(".set-state").textContent = on ? "on" : "off";
  };
  paintDockMb();
  dockMbBtn.addEventListener("click", () => {
    localStorage.setItem("money.dockMobile", localStorage.getItem("money.dockMobile") === "1" ? "0" : "1");
    applyDockMobile(); paintDockMb();
  });

  const pinBtn = modal.querySelector("#setAutoPin");
  const paintPin = () => {
    const on = autoPinOn();
    pinBtn.classList.toggle("on", on);
    pinBtn.querySelector(".set-state").textContent = on ? "on" : "off";
  };
  paintPin();
  pinBtn.addEventListener("click", () => {
    localStorage.setItem(AUTOPIN_KEY, autoPinOn() ? "0" : "1");
    paintPin(); renderLibrary(); renderDockMenu(); applyDockConfig(document.getElementById("dock"));
  });

  const anBtn = modal.querySelector("#setAnalytics");
  const paintAn = () => { const on = analyticsOn(); anBtn.classList.toggle("on", on); anBtn.querySelector(".set-state").textContent = on ? "on" : "off"; };
  paintAn();
  anBtn.addEventListener("click", () => {
    const on = !analyticsOn();
    localStorage.setItem("money.analytics", on ? "1" : "0");
    paintAn();
    if (on) {
      if (_phLoaded) { try { if (window.posthog && window.posthog.opt_in_capturing) window.posthog.opt_in_capturing(); } catch (e) {} }
      else initAnalytics();   // first time this session → load + init (which opts in)
      track("opted_in");
    } else { try { if (window.posthog && window.posthog.opt_out_capturing) window.posthog.opt_out_capturing(); } catch (e) {} }
  });

  const tierHost = modal.querySelector("#setTier");
  const paintTier = () => {
    tierHost.innerHTML = TIERS.map((t) => '<button class="set-tier-opt' + (menuTier() === t.n ? " on" : "") + '" data-tier-n="' + t.n + '">' + t.label + "</button>").join("");
    tierHost.querySelectorAll(".set-tier-opt").forEach((b) => b.addEventListener("click", () => {
      localStorage.setItem(TIER_KEY, b.dataset.tierN); paintTier(); applyTier();
    }));
  };
  paintTier();
  applyTier();  // also hides any tier-gated rows in this freshly-rendered panel

  // Bank connection — paste a SimpleFIN setup token right here. Every lookup below is
  // null-guarded: on the hosted web the whole block is replaced by a hint, so these
  // elements genuinely don't exist there.
  const bankStatus = modal.querySelector("#setBankStatus");
  if (bankStatus) fetch("/api/connect-status").then((r) => r.json()).then((d) => {
    bankStatus.innerHTML = d && d.connected
      ? '<span style="color:#3f8f4e">✓ Connected</span>'
      : '<span style="color:#c9542e">Not connected yet</span>';
  }).catch(() => { bankStatus.textContent = ""; });
  const connectBtn = modal.querySelector("#setConnect");
  if (connectBtn) connectBtn.addEventListener("click", () => {
    const tokEl = modal.querySelector("#setToken");
    const tok = tokEl ? tokEl.value.trim() : "";
    if (!tok) { flash("Paste your SimpleFIN token first"); return; }
    flash("Connecting your bank…");
    fetch("/api/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tok }) })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.ok) { flash("✓ Connected — " + (d.accounts || 0) + " account(s). Reloading…"); Store.refresh(); setTimeout(() => location.reload(), 1500); }
        else { flash((d && d.error) || "Couldn’t connect"); }
      })
      .catch(() => flash("Couldn’t reach the backend"));
  });
  const helpBtn = modal.querySelector("#setConnectHelp");
  if (helpBtn) helpBtn.addEventListener("click", () => openConnect());
  const setEx = modal.querySelector("#setSfExplain");
  if (setEx) setEx.addEventListener("click", () => { try { openSfExplainer(); } catch (e) {} });
  const tokenInput = modal.querySelector("#setToken");
  const eyeBtn = modal.querySelector("#setTokenEye");
  if (eyeBtn && tokenInput) eyeBtn.addEventListener("click", () => {
    const show = tokenInput.type === "password";
    tokenInput.type = show ? "text" : "password";
    eyeBtn.innerHTML = '<i data-lucide="' + (show ? "eye-off" : "eye") + '"></i>';
    drawIcons();
  });
  drawIcons();  // render the eye icon

  // Stats bar editor — toggle built-in numbers + build your own custom trackers
  const statsHost = modal.querySelector("#setStats");
  const renderSetStats = () => {
    const hidden = new Set(statsList(STATS_HIDDEN_KEY));
    statsHost.innerHTML = allStats().map((d) => {
      const on = !hidden.has(d.id);
      const cs = d.cs;
      let ctrls = "";
      if (cs) {
        if (cs.kind === "streak") {
          const done = (cs.marks || []).includes(curYm());
          ctrls += '<button class="cst-act' + (done ? " on" : "") + '" data-mark="' + d.id + '" title="mark this month done">' + (done ? "✓ " : "") + curMonShort() + "</button>";
        } else if (cs.kind === "tally") {
          ctrls += '<button class="cst-act" data-dec="' + d.id + '">−</button><button class="cst-act" data-inc="' + d.id + '">+</button>';
        }
        ctrls += '<button class="cst-del" data-del="' + d.id + '" title="delete this stat">×</button>';
      }
      return '<div class="set-stat-row"><button class="set-toggle' + (on ? " on" : "") + '" data-st="' + d.id + '">' +
        "<span>" + escapeHtml(d.label) + '</span><span class="set-state">' + (on ? "on" : "off") + "</span></button>" +
        (ctrls ? '<span class="cst-ctrls">' + ctrls + "</span>" : "") + "</div>";
    }).join("") + '<button class="cst-add" id="cstAdd">+ Add a custom stat</button>';

    const reflow = () => { renderStatsBar(); reflowBelowStats(); renderSetStats(); };
    statsHost.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => {
      const h = new Set(statsList(STATS_HIDDEN_KEY));
      if (h.has(b.dataset.st)) h.delete(b.dataset.st); else h.add(b.dataset.st);
      localStorage.setItem(STATS_HIDDEN_KEY, JSON.stringify([...h]));
      reflow();
    }));
    statsHost.querySelectorAll("[data-mark]").forEach((b) => b.addEventListener("click", () => {
      const arr = ensureCustomStats(); const cs = arr.find((x) => x.id === b.dataset.mark);
      cs.marks = cs.marks || []; const ym = curYm();
      if (cs.marks.includes(ym)) cs.marks = cs.marks.filter((x) => x !== ym); else cs.marks.push(ym);
      saveCustomStats(arr); reflow();
    }));
    statsHost.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => {
      const arr = ensureCustomStats(); const cs = arr.find((x) => x.id === b.dataset.inc); cs.value = (cs.value || 0) + 1; saveCustomStats(arr); reflow();
    }));
    statsHost.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => {
      const arr = ensureCustomStats(); const cs = arr.find((x) => x.id === b.dataset.dec); cs.value = (cs.value || 0) - 1; saveCustomStats(arr); reflow();
    }));
    statsHost.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const arr = ensureCustomStats().filter((x) => x.id !== b.dataset.del); saveCustomStats(arr); reflow();
    }));
    statsHost.querySelector("#cstAdd").addEventListener("click", () => {
      const name = prompt("Name your stat (e.g. 'Coffees this month', 'Days no fast food'):");
      if (!name || !name.trim()) return;
      const kind = prompt("Type:\n  1 = monthly streak (mark each month done)\n  2 = days since a date\n  3 = count bank purchases matching a word\n  4 = manual counter", "1");
      const arr = ensureCustomStats(); const id = "cst-" + Date.now();
      if (kind === "2") { const date = prompt("Count days since which date? (YYYY-MM-DD)"); if (!date) return; arr.push({ id, label: name.trim(), kind: "since", date: date.trim() }); }
      else if (kind === "3") { const match = prompt("Match what in your purchases? (e.g. coffee, amazon, doordash)"); if (!match) return; arr.push({ id, label: name.trim(), kind: "bank", match: match.trim().toLowerCase(), window: "month" }); }
      else if (kind === "4") { arr.push({ id, label: name.trim(), kind: "tally", value: 0 }); }
      else { arr.push({ id, label: name.trim(), kind: "streak", marks: [] }); }
      saveCustomStats(arr); reflow();
    });
  };
  renderSetStats();

  const cur = document.documentElement.getAttribute("data-theme") || "mono";
  const th = modal.querySelector("#setThemes");
  th.innerHTML = themeUIHtml();
  wireThemeUI(th);

  const fh = modal.querySelector("#setFonts");
  if (fh) {
    const curFont = localStorage.getItem(FONT_KEY) || "system";
    fh.innerHTML = FONTS.map((f) => '<button class="font-chip' + (f.id === curFont ? " active" : "") +
      '" data-font="' + f.id + '" style="font-family:' + f.stack.replace(/"/g, "&quot;") + '">' + f.label + "</button>").join("");
    fh.querySelectorAll(".font-chip").forEach((b) => { loadFont(FONTS.find((f) => f.id === b.dataset.font)); b.addEventListener("click", () => applyFont(b.dataset.font)); });
  }
}
// make a modal centered + resizable (corner) with a persisted size, and movable by its header
function makeModalResizable(modal, key) {
  modal.classList.add("resizable");
  let w = parseInt(localStorage.getItem(key + ".w"), 10);
  let h = parseInt(localStorage.getItem(key + ".h"), 10);
  if (!w) w = Math.min(440, Math.round(window.innerWidth * 0.92));
  if (!h) h = Math.min(560, Math.round(window.innerHeight * 0.8));
  modal.style.width = w + "px";
  modal.style.height = h + "px";
  // explicit size => stable box, so async content can't shove it off-center
  modal.style.left = Math.max(8, Math.round((window.innerWidth - w) / 2)) + "px";
  modal.style.top = Math.max(8, Math.round((window.innerHeight - h) / 2)) + "px";
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      localStorage.setItem(key + ".w", String(modal.offsetWidth));
      localStorage.setItem(key + ".h", String(modal.offsetHeight));
    }).observe(modal);
  }
  const head = modal.querySelector(".cat-head");
  if (head) makeModalDraggable(modal, head);
}
function makeModalDraggable(modal, handle) {
  let sx = 0, sy = 0, sl = 0, st = 0, drag = false;
  handle.style.cursor = "move";
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;  // let the close button work
    drag = true;
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    sx = e.clientX; sy = e.clientY;
    sl = parseInt(modal.style.left, 10) || 0; st = parseInt(modal.style.top, 10) || 0;
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    modal.style.left = (sl + e.clientX - sx) + "px";
    modal.style.top = (st + e.clientY - sy) + "px";
  });
  const end = () => { drag = false; };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}
function openCategorizer(onDone) {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop";
  back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(onDone); });

  const modal = document.createElement("div");
  modal.className = "cat-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Categorize</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-hint">your biggest charges — every change auto-saves. drag the corner to resize.</div>' +
    '<div class="cat-list">loading…</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  makeModalResizable(modal, "money.catModal");
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer(onDone));

  const listEl = modal.querySelector(".cat-list");
  fetch("/api/merchants")
    .then((r) => r.json())
    .then((d) => {
      const ms = d.merchants || [];
      if (!ms.length) { listEl.innerHTML = '<div class="cat-empty">no transactions yet — sync first</div>'; return; }
      listEl.innerHTML = ms.map((m) =>
        '<div class="cat-row">' +
          '<span class="cat-merch-wrap">' +
            '<span class="cat-merch" title="' + escapeHtml(m.merchant) + '">' + escapeHtml(m.merchant) + '</span>' +
            (catDates(m) ? '<span class="cat-dates">' + catDates(m) + '</span>' : '') +
          '</span>' +
          '<span class="cat-amt">' + fmtUSD(m.amount) + '</span>' +
          '<select class="cat-select">' + catOptions(m.category) + '</select>' +
        '</div>').join("");
      listEl.querySelectorAll(".cat-row").forEach((row, i) => {
        const sel = row.querySelector(".cat-select");
        sel.addEventListener("change", (e) => {
          let cat = e.target.value;
          if (cat === "__new__") {
            const name = prompt("New category name (e.g. Pets, Childcare):");
            const key = name ? addCustomCat(name) : null;
            if (!key) { sel.value = ms[i].category; return; }
            // rebuild every dropdown so the new category is available everywhere
            listEl.querySelectorAll(".cat-select").forEach((s2, j) => { s2.innerHTML = catOptions(ms[j].category); });
            sel.value = key;
            cat = key;
          }
          ms[i].category = cat;
          row.classList.add("saving");
          fetch("/api/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ merchant: ms[i].key, category: cat }),
          })
            .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
            .then(() => {
              row.classList.remove("saving"); row.classList.add("saved");
              setTimeout(() => row.classList.remove("saved"), 900);
            })
            .catch(() => {
              row.classList.remove("saving");
              flash("couldn't save — backend down? click the server light to restart");
            });
        });
      });
    })
    .catch(() => {
      listEl.innerHTML = '<div class="cat-empty">backend stopped or out of date — restart it (double-click <b>start.command</b>), then reopen</div>';
    });
}

// ── In-app income tagger (define what counts as income) ────
function closeIncomeTagger(onDone) {
  const m = document.querySelector(".inc-modal");
  const b = document.getElementById("incBackdrop");
  if (m) m.remove();
  if (b) b.remove();
  if (typeof onDone === "function") onDone();
}
function openIncomeTagger(onDone) {
  closeIncomeTagger();
  const back = document.createElement("div");
  back.className = "cat-backdrop";
  back.id = "incBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeIncomeTagger(onDone); });

  const modal = document.createElement("div");
  modal.className = "cat-modal inc-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Define income</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-hint">every deposit — flip the ones that are real income. your call sticks.</div>' +
    '<div class="cat-list">loading…</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", () => closeIncomeTagger(onDone));

  const listEl = modal.querySelector(".cat-list");
  fetch("/api/deposits")
    .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
    .then((d) => {
      const ds = d.deposits || [];
      if (!ds.length) { listEl.innerHTML = '<div class="cat-empty">no deposits yet — sync first</div>'; return; }
      listEl.innerHTML = ds.map((m) =>
        '<div class="cat-row">' +
          '<span class="cat-merch" title="' + escapeHtml(m.source) + '">' + escapeHtml(m.source) + '</span>' +
          '<span class="cat-amt">' + fmtUSD(m.amount) + '</span>' +
          '<button class="inc-toggle ' + (m.status === "income" ? "is-income" : "is-skip") + '">' +
            (m.status === "income" ? "income" : "skip") + '</button>' +
        '</div>').join("");
      listEl.querySelectorAll(".inc-toggle").forEach((btn, i) => {
        btn.addEventListener("click", () => {
          const next = btn.classList.contains("is-income") ? "ignore" : "income";
          btn.classList.toggle("is-income", next === "income");
          btn.classList.toggle("is-skip", next === "ignore");
          btn.textContent = next === "income" ? "income" : "skip";
          fetch("/api/income", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: ds[i].key, status: next }),
          }).catch(() => {});
        });
      });
    })
    .catch(() => {
      listEl.innerHTML = '<div class="cat-empty">backend stopped or out of date — restart it (double-click <b>start.command</b>), then reopen</div>';
    });
}

// ── Single-instance widgets (the Widget Library) ───────────
const LIBRARY = [
  { type: "balance", title: "Total balance", w: 320, h: 190 },
  { type: "income", title: "What makes money", w: 300, h: 240 },
  { type: "plan", title: "Budget", w: 360, h: 360 },
  { type: "whatsnext", title: "What’s next", w: 320, h: 256 },
  { type: "gap", title: "The gap", w: 300, h: 230 },
  { type: "coreflex", title: "Core vs flex", w: 300, h: 300 },
  { type: "subscriptions", title: "Money Map", w: 320, h: 340 },
  { type: "accountflow", title: "Money flow", w: 320, h: 380 },
  { type: "incomeforecast", title: "Income forecast", w: 340, h: 340 },
  { type: "work", title: "Work planner", w: 300, h: 210 },
  { type: "averages", title: "Statistics", w: 330, h: 300 },
  { type: "devtree", title: "Dev Tree", w: 340, h: 380 },
  { type: "worklog", title: "Time worked", w: 300, h: 270 },
  { type: "energy", title: "Energy", w: 300, h: 230 },
  { type: "timer", title: "Work / rest timer", w: 300, h: 300 },
  { type: "bucket", title: "Brain Bucket", w: 300, h: 300 },
  { type: "tasks", title: "Tasks", w: 300, h: 340 },
  { type: "forms", title: "Forms", w: 300, h: 320 },
  { type: "safe", title: "Safe to spend", w: 300, h: 220 },
  { type: "breakdown", title: "Where it’s going", w: 300, h: 280 },
  { type: "months", title: "Months", w: 320, h: 340 },
  { type: "clock", title: "Local time", w: 260, h: 160 },
  { type: "date", title: "Today", w: 220, h: 150 },
  { type: "note", title: "Note", w: 280, h: 200 },
];
const libByType = Object.fromEntries(LIBRARY.map((l) => [l.type, l]));

// ── Icon library (Lucide names) ────────────────────────────
const ICONS = [
  "wallet", "credit-card", "piggy-bank", "dollar-sign", "banknote", "coins",
  "landmark", "receipt", "calculator", "trending-up", "trending-down", "activity",
  "calendar", "clock", "bell", "star", "heart", "music", "palette", "camera",
  "image", "mic", "headphones", "home", "car", "plane", "coffee", "gift",
  "briefcase", "target", "flag", "map", "compass", "zap", "flame", "sun",
  "moon", "cloud", "droplet", "leaf", "sparkles", "rocket", "user", "users",
  "settings", "lock", "eye", "search", "plus", "check", "circle", "square",
  "triangle", "hexagon", "trophy", "award", "gem", "bookmark", "tag", "anchor",
];

// ── Layout (persisted) ─────────────────────────────────────
function defaultLayout() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  return {
    balance: { type: "balance", x: Math.round(cx - 334), y: Math.round(cy - 95), w: 320, h: 190 },
    clock: { type: "clock", x: Math.round(cx + 14), y: Math.round(cy - 80), w: 260, h: 160 },
  };
}
// ── Pages: up to 6 independent board layouts you switch between ──
const PAGES_KEY = "money.pages";
const MAX_PAGES = 6;
function loadPages() {
  try {
    const p = JSON.parse(localStorage.getItem(PAGES_KEY) || "null");
    if (p && Array.isArray(p.list) && p.list.length) {
      if (typeof p.active !== "number" || p.active < 0 || p.active >= p.list.length) p.active = 0;
      return p;
    }
  } catch (e) {}
  let l0 = null;
  try { l0 = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"); } catch (e) {}  // migrate the existing board → Page 1
  return { active: 0, list: [{ name: "Page 1", layout: l0 || defaultLayout() }] };
}
let PAGES = loadPages();
function savePages() { try { localStorage.setItem(PAGES_KEY, JSON.stringify(PAGES)); } catch (e) {} }
function loadLayout() {
  const pg = PAGES.list[PAGES.active] || PAGES.list[0];
  let obj;
  try { obj = JSON.parse(JSON.stringify(pg && pg.layout ? pg.layout : defaultLayout())); }
  catch (e) { obj = defaultLayout(); }
  Object.keys(obj).forEach((id) => { if (obj[id] && !obj[id].type) obj[id].type = id; });
  return obj;
}
function saveLayout() {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));   // mirror the active board (back-compat)
  if (PAGES.list[PAGES.active]) { PAGES.list[PAGES.active].layout = layout; savePages(); }
  autoPushSoon();
}

// ── Saved views: snapshot the whole board under a name, jump back anytime ──
const VIEWS_KEY = "money.views";
function loadViews() { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "{}"); } catch (e) { return {}; } }
function persistViews(v) { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); }
function saveView(name) {
  const v = loadViews();
  v[name] = JSON.parse(JSON.stringify(layout));
  persistViews(v);
  renderViews();
}
function deleteView(name) { const v = loadViews(); delete v[name]; persistViews(v); renderViews(); }
function applyView(name) {
  const snap = loadViews()[name];
  if (!snap) return;
  Object.keys(nodes).forEach((id) => { if (nodes[id]) nodes[id].remove(); delete nodes[id]; });
  layout = JSON.parse(JSON.stringify(snap));
  saveLayout();
  Object.keys(layout).forEach((id) => makeAny(id, layout[id]));
  drawIcons();
  Store.emit();  // refill the rebuilt widgets + drop the removed ones' subscriptions
}

// ── Pages: switch / add / delete / rename, and the top-left button + window ──
function rebuildBoard() {
  Object.keys(nodes).forEach((id) => { if (nodes[id]) nodes[id].remove(); delete nodes[id]; });
  Object.keys(layout).forEach((id) => makeAny(id, layout[id]));
  drawIcons();
  Store.emit();
}
function loadActivePage() {
  layout = loadLayout();
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  rebuildBoard();
  renderPagesBtn();
}
function switchPage(i) {
  if (i === PAGES.active || i < 0 || i >= PAGES.list.length) return;
  saveLayout();                       // snapshot the current page first
  PAGES.active = i; savePages();
  loadActivePage();
}
function addPage() {
  if (PAGES.list.length >= MAX_PAGES) { flash("6 pages max"); return; }
  saveLayout();
  PAGES.list.push({ name: "Page " + (PAGES.list.length + 1), layout: {} });  // new page = blank canvas
  PAGES.active = PAGES.list.length - 1; savePages();
  loadActivePage();
  flash("Page " + PAGES.list.length + " added — add widgets from the library");
}
function deletePage(i) {
  if (PAGES.list.length <= 1 || i < 0 || i >= PAGES.list.length) return;
  PAGES.list.splice(i, 1);
  if (PAGES.active > i) PAGES.active -= 1;
  if (PAGES.active >= PAGES.list.length) PAGES.active = PAGES.list.length - 1;
  savePages();
  loadActivePage();
}
function renamePage(i, name) {
  if (!PAGES.list[i] || !name || !name.trim()) return;
  PAGES.list[i].name = name.trim().slice(0, 24); savePages(); renderPagesBtn();
}
function renderPagesBtn() {
  const b = document.getElementById("pagesToggle");
  if (!b) return;
  const n = PAGES.list.length;
  if (n <= 1) { b.innerHTML = "+"; b.classList.add("pg-add-btn"); b.title = "Add a page"; }
  else { b.innerHTML = '<span class="pg-num">' + n + "</span>"; b.classList.remove("pg-add-btn"); b.title = "Pages (" + n + ") — switch or add"; }
}
function closePagesWindow() {
  ["pagesPop", "pagesBackdrop"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
}
function openPagesWindow() {
  closePagesWindow();
  const back = document.createElement("div"); back.className = "theme-backdrop"; back.id = "pagesBackdrop";
  back.addEventListener("pointerdown", closePagesWindow);
  const pop = document.createElement("div"); pop.className = "pages-pop"; pop.id = "pagesPop";
  pop.innerHTML = '<div class="pg-head">Pages</div>' +
    PAGES.list.map((p, i) =>
      '<div class="pg-item' + (i === PAGES.active ? " active" : "") + '" data-i="' + i + '">' +
        '<span class="pg-name" data-i="' + i + '">' + escapeHtml(p.name) + "</span>" +
        '<button class="pg-rename" data-rn="' + i + '" title="Rename" aria-label="Rename">✎</button>' +
        (PAGES.list.length > 1 ? '<button class="pg-del" data-del="' + i + '" title="Delete page" aria-label="Delete">✕</button>' : "") +
      "</div>").join("") +
    (PAGES.list.length < MAX_PAGES ? '<button class="pg-addrow">+ Add page</button>' : '<div class="pg-max">6 pages max</div>');
  document.body.appendChild(back); document.body.appendChild(pop);
  pop.querySelectorAll(".pg-item").forEach((row) => row.addEventListener("click", (e) => {
    if (e.target.closest(".pg-del") || e.target.closest(".pg-rename")) return;
    switchPage(+row.dataset.i); closePagesWindow();
  }));
  pop.querySelectorAll(".pg-rename").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const i = +b.dataset.rn, nm = prompt("Rename page:", PAGES.list[i].name);
    if (nm !== null) { renamePage(i, nm); closePagesWindow(); openPagesWindow(); }
  }));
  pop.querySelectorAll(".pg-del").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const i = +b.dataset.del;
    if (confirm("Delete “" + PAGES.list[i].name + "” and all its widgets? This can't be undone.")) { deletePage(i); closePagesWindow(); }
  }));
  const addRow = pop.querySelector(".pg-addrow");
  if (addRow) addRow.addEventListener("click", () => { addPage(); closePagesWindow(); });
}
function renderViews() {
  const host = document.getElementById("viewList");
  if (!host) return;
  const names = Object.keys(loadViews());
  host.innerHTML = names.length
    ? names.map((n) => '<button class="lib-item view-item" data-v="' + escapeHtml(n) + '">' +
        '<span class="lib-label">' + escapeHtml(n) + "</span>" +
        '<span class="view-del" data-del="' + escapeHtml(n) + '" title="delete">✕</span></button>').join("")
    : '<div class="section-hint">none yet — save one below</div>';
  host.querySelectorAll(".view-item").forEach((b) => b.addEventListener("click", (e) => {
    if (e.target.classList.contains("view-del")) { deleteView(e.target.dataset.del); return; }
    applyView(b.dataset.v); setSidebar(false); flash("loaded “" + b.dataset.v + "”");
  }));
}

// ── State ──────────────────────────────────────────────────
const board = document.getElementById("board");          // scroll viewport
const canvas = document.getElementById("boardCanvas");   // scalable coordinate space
const CANVAS_W = 3200, CANVAS_H = 2200;
let layout = loadLayout();
const nodes = {};
let zTop = 10;
let stickerSeq = 0;

// ── Zoom the sandbox ───────────────────────────────────────
const ZOOM_KEY = "money.zoom";
let boardZoom = parseFloat(localStorage.getItem(ZOOM_KEY)) || 1;
function applyZoom() {
  boardZoom = Math.max(0.4, Math.min(1.6, Math.round(boardZoom * 100) / 100));
  canvas.style.transform = "scale(" + boardZoom + ")";
  localStorage.setItem(ZOOM_KEY, String(boardZoom));
  const lbl = document.getElementById("zoomReset");
  if (lbl) lbl.textContent = Math.round(boardZoom * 100) + "%";
}
function setZoom(z) { boardZoom = z; applyZoom(); }
// screen point → canvas coordinates (accounts for scroll + scale)
function toCanvas(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / boardZoom, y: (clientY - r.top) / boardZoom };
}

function titleFor(entry) {
  if (entry.type === "sticker") return entry.icon;
  return libByType[entry.type] ? libByType[entry.type].title : entry.type;
}
function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// ── Build a framed widget ──────────────────────────────────
// ── Back-of-card: exactly what data each widget uses & how it's calculated ──
const WIDGET_INFO = {
  _default: "<p>Local device info — no financial data.</p>",
  balance:
    "<p><b>Source:</b> your live bank balances (SimpleFIN sync → <code>balances.json</code>). Point-in-time, not affected by the Period.</p>" +
    "<p><b>Total cash</b> = sum of <i>positive</i> balances of non-credit accounts (checking + savings).</p>" +
    "<p><b>Checking / Savings</b> = those accounts grouped by name.</p>" +
    "<p><b>“include card debt”</b> adds your credit-card balances (negative) → net = cash − debt.</p>" +
    "<p><b>“as of”</b> = time of the last sync.</p>",
  income:
    "<p><b>Source:</b> the ledger, for the selected <b>Period</b> (<code>/api/summary</code>).</p>" +
    "<p><b>What counts as income:</b> a deposit where <i>your tag says income</i>, OR it's a gig/payroll deposit — and it's <i>not</i> a transfer or fee. Your tag always wins.</p>" +
    "<p><b>Per source</b> = deposits grouped by cleaned source name. <b>/mo</b> = period total ÷ days × 30.</p>",
  plan:
    "<p><b>Two modes.</b> <b>Plan</b> shows what you need to earn; <b>build</b> is where you set everything — your guaranteed income, rent, hourly rate, and which bank-detected bills are must-pays. Nothing lives in Settings anymore.</p>" +
    "<p><b>Must-pays are exact.</b> In build, star the recurring charges you have to pay — amounts come straight from your statements, nothing typed. Back in plan, drag them to rank what matters most.</p>" +
    "<p><b>The waterfall:</b> your money pours into that ranked list top-down until it runs out. Whatever's below the cutline is what you're short.</p>" +
    "<p><b>Rent is earmarked</b> — funded ONLY from the account it lives in (Settings). Everything else is funded from your other cash + your <b>guaranteed income</b> (your reliable base, NOT variable gig work).</p>" +
    "<p><b>Everyday spending</b> (food, etc.) sits below as an <b>estimate</b> from your history — clearly separated from the exact bills, ranked last.</p>" +
    "<p><b>This month is the hero</b> up top — it marks bills ✓ paid once they've already charged, so they stop counting against you. <b>Next month</b> is the peek bar below (tap to expand); it shows everything still due.</p>" +
    "<p>The shortfall is the money you actually need from side work — shown as <b>gig hours</b> (shortfall ÷ your rate, set in Settings).</p>",
  whatsnext:
    "<p><b>Anchored on rent</b> — your top priority bill. Set the amount + due day in <b>Settings → Rent</b>.</p>" +
    "<p><b>Due date</b> = next time the due-day comes around. <b>Days</b> = until then.</p>" +
    "<p><b>Left for rent</b> = cash on hand + income you'd usually get before the due date − other core spending before then.</p>" +
    "<p><b>Earn</b> = Rent − Left-for-rent (what you'd still be short). <b>Hours</b> = that ÷ your work rate.</p>" +
    "<p>Income is estimated from the selected Period's rate (it assumes your usual income lands).</p>",
  gap:
    "<p><b>Need</b> = your manual override, else your monthly <b>Core</b> spending + Core subscriptions.</p>" +
    "<p><b>Income</b> = income /mo (from What-makes-money).</p>" +
    "<p><b>The gap = Need − Income.</b> Positive means that's how much more you must earn each month.</p>",
  coreflex:
    "<p><b>Source:</b> spending categories for the Period (ledger; <b>transfers/card-payments excluded</b>).</p>" +
    "<p>Each category is normalized to <b>/mo</b> (period total ÷ days × 30).</p>" +
    "<p><b>Core vs Flex</b> is your own per-category mark — Core = non-negotiable, Flex = cuttable.</p>",
  subscriptions:
    "<p><b>The Money Map is where you define what everything is</b> — one place, so you’re never tagging income in one widget and bills in another.</p>" +
    "<p><b>Money in:</b> every deposit source, with a toggle to count it as <b>income</b> or <b>ignore</b> it (e.g. a friend paying you back). Feeds what the app treats as real income.</p>" +
    "<p><b>Money out · recurring:</b> a recurrence scan of your <b>whole ledger</b> (all accounts incl. cards). Star a bill <b>must-pay</b> and it funds your Budget first; leave it <b>optional</b> and it doesn’t.</p>" +
    "<p><b>🟢 active</b> = charged in the last ~40 days · <b>🟠 lapsed</b> = no charge in over a month · <b>⚫ paused</b> = you marked it off. Amounts are the bank’s exact median charge.</p>",
  work:
    "<p><b>Gap</b> = Need − Income /mo (same as The Gap).</p>" +
    "<p><b>Hours/week</b> = (Gap ÷ your $/hr rate) ÷ 4.33 weeks.</p>" +
    "<p>Set your rate in <b>Settings → Work rate</b>.</p>",
  averages:
    "<p><b>Source:</b> your whole ledger — lifetime totals, per-month buckets, and per-category sums (the partial current month is skipped for averages).</p>" +
    "<p>A spread of real <b>data facts</b>: monthly averages, savings rate, your best + leanest months, top category, biggest single expense, and lifetime in/out. Spending <b>excludes transfers</b>.</p>",
  devtree:
    "<p><b>Source:</b> a live scan of the project (<code>/api/devtree</code>): <b>BACKLOG.md</b> status (shipped / in-progress / planned) + a grep of the source files for unfinished markers (TODO, FIXME, HACK, XXX, BUG, NEXT, “coming soon”).</p>" +
    "<p>Worst files float to the top. 🔴 = <b>circle back</b> (FIXME/HACK/bug); 🟡 = to-do / scaffolded. Click a branch to expand. A dev tool — it reads code comments, never your data.</p>",
  worklog:
    "<p><b>Source:</b> Toggl hours (<code>toggl_sync.py</code> → <code>toggl.json</code>) paired with <b>real income from your ledger</b> over the same window.</p>" +
    "<p><b>Worked</b> = sum of this month's Toggl durations (a running timer counts now − start).</p>" +
    "<p><b>Earned</b> = income that <i>landed in your bank</i> this month — pay lags work, so it's most meaningful monthly.</p>" +
    "<p><b>Effective $/hr</b> = Earned ÷ Worked (blends all income, not just hourly).</p>",
  breakdown:
    "<p><b>Source:</b> spending categories for the Period (ledger; <b>transfers/card-payments excluded</b> so they don't inflate it).</p>" +
    "<p><b>/mo</b> = period spend ÷ days × 30. Bars = top categories by amount.</p>",
  safe:
    "<p><b>Spendable</b> = cash − your <b>Reserve</b> (set in Settings).</p>" +
    "<p><b>Burn</b> = average $/day spent over the Period.</p>" +
    "<p><b>Runway</b> = Spendable ÷ Burn → the date it would run out.</p>",
  months:
    "<p><b>Source:</b> your full ledger, bucketed by calendar month.</p>" +
    "<p><b>In</b> = income deposits that month · <b>Out</b> = spending (<b>transfers excluded</b>) · <b>Net</b> = In − Out.</p>" +
    "<p>Tap a month to see its category split.</p>",
  accountflow:
    "<p><b>A map of where your money lives and moves.</b> Each box is a real account (live balance). <b>Checking sits up top</b> — that's where new money lands — then it cascades down to savings, other accounts, and cards.</p>" +
    "<p><b>money in</b> = your monthly income · <b>money out</b> = your monthly spending (the bubbles on those lines).</p>" +
    "<p><b>Bubbles on the connectors</b> = recurring transfers detected from your ledger (exact amounts). They appear once you have transfers that repeat.</p>" +
    "<p><b>hide cards</b> collapses credit cards for a cash-only view. Card balances show in red (debt owed).</p>",
  incomeforecast:
    "<p><b>Slide to see the future.</b> Drag the slider to set how many hours of side work you'd do per week — the chart re-tilts live.</p>" +
    "<p>The line is your <b>cushion over the next 6 months</b>, starting from your cash now. Its slope = your monthly surplus: <b>income − needs</b>. Rising green = you're building savings; falling red = you're draining.</p>" +
    "<p><b>Income</b> = your guaranteed base + (hours/wk × your $/hr rate, set in Budget → build). <b>Needs</b> = the essentials you must clear — your must-pay bills + food — not discretionary spending.</p>" +
    "<p>The dashed line marks today's cash. It opens on the hours that break even — slide up from there to watch your cushion grow.</p>",
  clock: "<p>Your device's local time, formatted however you set it in the dock’s date/time popover.</p>",
  date: "<p>Today's date from your device. No financial data.</p>",
  note: "<p>A free-text note you type — saved locally in your browser. No financial data.</p>",
  energy: "<p><b>Your energy pattern</b> — every ⚡ answer from the Daily check-in, one bar per day for the last 14 days (1–5).</p><p>The point: your executive-function energy <i>varies</i>, and that's not a flaw — seeing the pattern lets you plan around it instead of fighting it. A missing bar just means no log that day; that's information, never a failure.</p>",
  bucket: "<p><b>Your actively-held working memory</b> — notes and links you deliberately drop here so your brain doesn't have to hold them. Lives in your cache, syncs across your devices, and rides your backups + encrypted vault.</p><p>Toss anything with one tap — no shame. A gentle monthly cleanout prompt is a coming brick.</p>",
  tasks: "<p><b>The things you need to do and remember.</b> Add a task, check it off (it's logged), or delete it — with a one-tap undo, no shame. Break any task into <b>subtasks</b>, as deep as you need (＋ on a row), and collapse a big one to tidy it away. <b>Tap a task's title</b> to see its activity trail — everything you checked off across it and its subtasks.</p><p>Turn a task into a <b>habit</b> (⋯ → Make a habit) and it becomes something you track: because habits repeat, they reset each day, and you can track a plain yes/no or a number (minutes, reps…). Every task, subtask, and habit syncs on its own, so edits on your phone and laptop both survive.</p>",
  timer: "<p><b>Work a block, rest a block</b> — with a longer rest every few blocks. The visible countdown does the time-keeping so your head doesn't have to.</p><p>All four numbers are yours — tap <i>presets</i>. The defaults are just a starting point, not a prescription. Pausing, skipping, or ending early is always one tap and never punished. Finishing a work block earns +2 EXP.</p>",
};

function makeWidget(id, entry) {
  const node = document.createElement("section");
  node.className = "widget" + (entry.bare ? " bare" : "");
  node.dataset.id = id;
  node.style.left = entry.x + "px";
  node.style.top = entry.y + "px";
  node.style.width = entry.w + "px";
  node.style.height = entry.h + "px";
  if (entry.snap === undefined) entry.snap = true;  // snapping is ON by default
  if (entry.snap) {  // re-inset the gutter for already-snapped widgets
    entry.w = snapSize(entry.w, MIN_W);
    entry.h = snapSize(entry.h, MIN_H);
    node.style.width = entry.w + "px";
    node.style.height = entry.h + "px";
  }

  const bar = document.createElement("header");
  bar.className = "widget-bar";
  bar.innerHTML =
    '<span class="bar-left">' +
    '<span class="bar-ico">' + (entry.barIcon ? '<i data-lucide="' + entry.barIcon + '"></i>' : "") + "</span>" +
    '<span class="widget-title">' + titleFor(entry) + "</span>" +
    (PERIOD_WIDGETS.has(entry.type) ? '<span class="w-period">' + periodLabel() + "</span>" : "") +
    "</span>" +
    '<span class="bar-right">' +
    '<button class="widget-help" title="What data &amp; how it’s calculated" aria-label="How it’s calculated">?</button>' +
    '<button class="widget-magnet' + (entry.snap ? " on" : "") +
      '" title="Snap to grid" aria-label="Toggle snap"><i data-lucide="magnet"></i></button>' +
    '<button class="widget-color" title="Widget color" aria-label="Widget color"><span class="color-dot"></span></button>' +
    '<button class="widget-close" aria-label="Remove">✕</button>' +
    "</span>";

  const body = document.createElement("div");
  body.className = "widget-body";

  // card flip: front (bar + body) / back (how it's calculated)
  const flip = document.createElement("div");
  flip.className = "widget-flip";
  const front = document.createElement("div");
  front.className = "widget-face face-front";
  front.appendChild(bar);
  front.appendChild(body);
  const back = document.createElement("div");
  back.className = "widget-face face-back";
  back.innerHTML =
    '<header class="widget-bar back-bar"><span class="bar-left"><span class="widget-title">how this is calculated</span></span>' +
    '<span class="bar-right"><button class="flip-back" title="flip back" aria-label="Flip back">↩</button></span></header>' +
    '<div class="widget-back-body">' + (WIDGET_INFO[entry.type] || WIDGET_INFO._default) + "</div>";
  flip.appendChild(front);
  flip.appendChild(back);
  node.appendChild(flip);

  const grips = ["nw", "ne", "sw", "se"].map((c) => {
    const g = document.createElement("div");
    g.className = "widget-resize r-" + c;
    node.appendChild(g);
    return { el: g, corner: c };
  });
  canvas.appendChild(node);
  nodes[id] = node;
  if (entry.color) node.style.setProperty("--accent", entry.color);  // per-widget color

  RENDERERS[entry.type](body, entry);
  drawIcons();
  bar.querySelector(".widget-help").addEventListener("click", (e) => { e.stopPropagation(); node.classList.add("flipped"); });
  back.querySelector(".flip-back").addEventListener("click", () => node.classList.remove("flipped"));
  bar.querySelector(".widget-close").addEventListener("click", () => removeWidget(id));
  bar.querySelector(".widget-color").addEventListener("click", (e) => {
    e.stopPropagation();
    openWidgetColor(e.currentTarget, entry, node);
  });
  bar.querySelector(".widget-magnet").addEventListener("click", () => {
    entry.snap = !entry.snap;
    bar.querySelector(".widget-magnet").classList.toggle("on", entry.snap);
    if (entry.snap) {
      // settle the widget onto the grid right away
      node.classList.add("tidying");
      node.style.left = snapTo(parseInt(node.style.left, 10)) + "px";
      node.style.top = snapTo(parseInt(node.style.top, 10)) + "px";
      node.style.width = snapSize(node.offsetWidth, MIN_W) + "px";
      node.style.height = snapSize(node.offsetHeight, MIN_H) + "px";
      entry.x = parseInt(node.style.left, 10);
      entry.y = parseInt(node.style.top, 10);
      entry.w = node.offsetWidth;
      entry.h = node.offsetHeight;
      setTimeout(() => node.classList.remove("tidying"), 480);
    }
    saveLayout();
  });
  makeDraggable(node, bar, id);
  makeResizable(node, grips, id);
}

// ── Build a free-floating sticker ──────────────────────────
function makeSticker(id, entry) {
  const node = document.createElement("div");
  node.className = "sticker";
  node.dataset.id = id;
  if (entry.snap === undefined) entry.snap = true;  // stickers snap to the grid by default
  if (entry.snap) { entry.x = snapTo(entry.x); entry.y = snapTo(entry.y); }
  node.style.left = entry.x + "px";
  node.style.top = entry.y + "px";
  node.style.width = entry.w + "px";
  node.style.height = entry.h + "px";
  node.innerHTML =
    '<i data-lucide="' + entry.icon + '"></i>' +
    '<button class="sticker-magnet' + (entry.snap ? " on" : "") + '" title="Snap to grid" aria-label="Toggle snap"><i data-lucide="magnet"></i></button>' +
    '<button class="sticker-close" aria-label="Remove">✕</button>' +
    '<div class="sticker-resize"></div>';
  canvas.appendChild(node);
  nodes[id] = node;
  drawIcons();

  node.querySelector(".sticker-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removeWidget(id);
  });
  node.querySelector(".sticker-magnet").addEventListener("click", (e) => {
    e.stopPropagation();
    entry.snap = !entry.snap;
    e.currentTarget.classList.toggle("on", entry.snap);
    if (entry.snap) {  // settle onto the grid right away
      node.classList.add("tidying");
      node.style.left = snapTo(parseInt(node.style.left, 10)) + "px";
      node.style.top = snapTo(parseInt(node.style.top, 10)) + "px";
      entry.x = parseInt(node.style.left, 10);
      entry.y = parseInt(node.style.top, 10);
      setTimeout(() => node.classList.remove("tidying"), 480);
    }
    saveLayout();
  });
  makeDraggable(node, node, id);
  makeResizable(node, [{ el: node.querySelector(".sticker-resize"), corner: "se" }], id);
}

function makeAny(id, entry) {
  if (entry.type === "sticker") makeSticker(id, entry);
  else if (RENDERERS[entry.type]) makeWidget(id, entry);
}

// ── Add / remove ───────────────────────────────────────────
function addSingleton(type) {
  if (layout[type]) { if (nodes[type]) nodes[type].style.zIndex = ++zTop; return; }
  const def = libByType[type];
  const n = Object.keys(layout).length;
  // drop it into the middle of whatever you're currently looking at
  const c = toCanvas(window.innerWidth / 2, window.innerHeight / 2);
  layout[type] = {
    type,
    x: Math.round(c.x - def.w / 2 + (n % 5) * 22),
    y: Math.round(c.y - def.h / 2 + (n % 5) * 22),
    w: def.w, h: def.h,
  };
  makeWidget(type, layout[type]);
  springIn(nodes[type]);
  saveLayout();
  renderLibrary();
  logChar("widget", "Added the " + ((def && def.title) || type) + " widget");
  track("widget_added", { widget: type });
}
function placeSticker(name, x, y) {
  const id = "sticker-" + name + "-" + stickerSeq++;
  layout[id] = { type: "sticker", icon: name, x: Math.round(x), y: Math.round(y), w: 110, h: 110 };
  makeSticker(id, layout[id]);
  springIn(nodes[id]);
  saveLayout();
}
function applyIconToWidget(id, name) {
  if (!layout[id] || layout[id].type === "sticker") return;
  layout[id].barIcon = name;
  saveLayout();
  const node = nodes[id];
  if (!node) return;
  node.querySelector(".bar-ico").innerHTML = '<i data-lucide="' + name + '"></i>';
  drawIcons();
}
function removeWidget(id) {
  track("widget_removed", { widget: (layout[id] && layout[id].type) || "" });
  if (nodes[id]) { nodes[id].remove(); delete nodes[id]; }
  delete layout[id];
  saveLayout();
  renderLibrary();
}

// ── Drag to move ───────────────────────────────────────────
function makeDraggable(node, handle, id) {
  let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(DRAG_IGNORE)) return;
    if (isMobile()) return;  // stacked layout → let the finger scroll the page
    drag = true;
    handle.setPointerCapture(e.pointerId);
    node.style.zIndex = ++zTop;
    node.classList.add("dragging");
    sx = e.clientX; sy = e.clientY;
    ox = parseInt(node.style.left, 10); oy = parseInt(node.style.top, 10);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const minY = topClamp();  // only below the stats bar at the top of the scroll
    let nx = ox + (e.clientX - sx) / boardZoom;
    let ny = oy + (e.clientY - sy) / boardZoom;
    nx = Math.max(0, Math.min(CANVAS_W - 40, nx));
    ny = Math.max(minY, Math.min(CANVAS_H - 40, ny));
    if (layout[id] && layout[id].snap) { nx = snapTo(nx); ny = Math.max(minY, snapTo(ny)); }
    node.style.left = nx + "px"; node.style.top = ny + "px";
  });
  const end = () => {
    if (!drag) return;
    drag = false;
    node.classList.remove("dragging");
    layout[id].x = parseInt(node.style.left, 10);
    layout[id].y = parseInt(node.style.top, 10);
    saveLayout();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ── Resize ─────────────────────────────────────────────────
// grips: array of { el, corner } where corner is "nw"|"ne"|"sw"|"se".
// Corners that move the top/left edge re-anchor the opposite edge so it stays put.
function makeResizable(node, grips, id) {
  grips.forEach(({ el, corner }) => {
    let sx = 0, sy = 0, sw = 0, sh = 0, sl = 0, st = 0, sizing = false;
    el.addEventListener("pointerdown", (e) => {
      if (isMobile()) return;  // no resizing in the stacked phone layout
      e.stopPropagation();
      sizing = true;
      el.setPointerCapture(e.pointerId);
      node.style.zIndex = ++zTop;
      sx = e.clientX; sy = e.clientY;
      sw = node.offsetWidth; sh = node.offsetHeight;
      sl = parseInt(node.style.left, 10) || 0; st = parseInt(node.style.top, 10) || 0;
    });
    el.addEventListener("pointermove", (e) => {
      if (!sizing) return;
      const dx = (e.clientX - sx) / boardZoom, dy = (e.clientY - sy) / boardZoom;
      let w = sw, h = sh, l = sl, t = st;
      if (corner.indexOf("e") >= 0) w = Math.max(MIN_W, sw + dx);
      if (corner.indexOf("w") >= 0) { w = Math.max(MIN_W, sw - dx); l = sl + sw - w; }
      if (corner.indexOf("s") >= 0) h = Math.max(MIN_H, sh + dy);
      if (corner.indexOf("n") >= 0) { h = Math.max(MIN_H, sh - dy); t = st + sh - h; }
      if (layout[id] && layout[id].snap) {
        // magnet ON → snap SIZE to the gutter grid AND position to the grid as you drag.
        // (Want a free, off-grid size? Toggle the magnet off and resize freely.)
        w = snapSize(w, MIN_W);
        h = snapSize(h, MIN_H);
        if (corner.indexOf("w") >= 0) l = sl + sw - w;
        if (corner.indexOf("n") >= 0) t = st + sh - h;
        l = snapTo(l); t = snapTo(t);
      }
      const minY = topClamp();  // only protect the stats-bar zone at the top of the scroll
      if (t < minY) { h = Math.max(MIN_H, h - (minY - t)); t = minY; }
      node.style.width = w + "px"; node.style.height = h + "px";
      node.style.left = l + "px"; node.style.top = t + "px";
    });
    const end = () => {
      if (!sizing) return;
      sizing = false;
      layout[id].w = node.offsetWidth; layout[id].h = node.offsetHeight;
      layout[id].x = parseInt(node.style.left, 10); layout[id].y = parseInt(node.style.top, 10);
      saveLayout();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  });
}

// ── Drag an icon out of the library ────────────────────────
function startIconDrag(downEvent, name, cell) {
  downEvent.preventDefault();
  const startX = downEvent.clientX, startY = downEvent.clientY;
  let moved = false, ghost = null;
  cell.setPointerCapture(downEvent.pointerId);

  const onMove = (e) => {
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
      moved = true;
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.innerHTML = '<i data-lucide="' + name + '"></i>';
      document.body.appendChild(ghost);
      drawIcons();
    }
    if (ghost) { ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px"; }
  };
  const onUp = (e) => {
    cell.removeEventListener("pointermove", onMove);
    cell.removeEventListener("pointerup", onUp);
    cell.removeEventListener("pointercancel", onUp);
    if (ghost) ghost.remove();

    if (e.type === "pointercancel") return;
    if (!moved) {
      // a plain click → drop a sticker in the middle of the current view
      const c = toCanvas(window.innerWidth / 2, window.innerHeight / 2);
      placeSticker(name, c.x - 55, c.y - 55);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.closest(".sidebar")) return; // dropped back on the panel → cancel
    const widget = el ? el.closest(".widget") : null;
    if (widget) showDropMenu(e.clientX, e.clientY, name, widget.dataset.id);
    else { const c = toCanvas(e.clientX, e.clientY); placeSticker(name, c.x - 55, c.y - 55); }
  };
  cell.addEventListener("pointermove", onMove);
  cell.addEventListener("pointerup", onUp);
  cell.addEventListener("pointercancel", onUp);
}

// ── Drop menu (apply to widget vs sticker) ─────────────────
function showDropMenu(x, y, name, widgetId) {
  closeDropMenu();
  const backdrop = document.createElement("div");
  backdrop.className = "drop-backdrop";
  backdrop.id = "dropBackdrop";
  backdrop.addEventListener("pointerdown", closeDropMenu);

  const menu = document.createElement("div");
  menu.className = "drop-menu";
  menu.style.left = Math.min(x, window.innerWidth - 190) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 90) + "px";

  const title = libByType[layout[widgetId] && layout[widgetId].type]
    ? libByType[layout[widgetId].type].title : "widget";

  const apply = document.createElement("button");
  apply.innerHTML = '<i data-lucide="' + name + '"></i> Apply to “' + title + "”";
  apply.addEventListener("click", () => { applyIconToWidget(widgetId, name); closeDropMenu(); });

  const sticker = document.createElement("button");
  sticker.innerHTML = '<i data-lucide="' + name + '"></i> Place as sticker';
  sticker.addEventListener("click", () => {
    const c = toCanvas(x, y);
    placeSticker(name, c.x - 55, c.y - 55);
    closeDropMenu();
  });

  menu.appendChild(apply);
  menu.appendChild(sticker);
  document.body.appendChild(backdrop);
  document.body.appendChild(menu);
  drawIcons();
}
function closeDropMenu() {
  const m = document.querySelector(".drop-menu");
  const b = document.getElementById("dropBackdrop");
  if (m) m.remove();
  if (b) b.remove();
}

// ── Sidebar: widget library ────────────────────────────────
const library = document.getElementById("library");
// ── Favorites: star a widget or dock item → auto-pin it to the top (toggle in Settings) ──
const FAV_KEY = "money.favorites", AUTOPIN_KEY = "money.autoPinFavorites";
function favs() { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch (e) { return new Set(); } }
function toggleFav(id) { const s = favs(); s.has(id) ? s.delete(id) : s.add(id); localStorage.setItem(FAV_KEY, JSON.stringify([...s])); }
function autoPinOn() { return localStorage.getItem(AUTOPIN_KEY) !== "0"; }  // default on
function renderLibrary() {
  library.innerHTML = "";
  const f = favs();
  const defs = LIBRARY.slice();
  if (autoPinOn()) defs.sort((a, b) => (f.has("widget:" + b.type) ? 1 : 0) - (f.has("widget:" + a.type) ? 1 : 0));
  defs.forEach((def) => {
    const on = !!layout[def.type], fav = f.has("widget:" + def.type);
    const item = document.createElement("button");
    item.className = "lib-item" + (on ? " active" : "") + (fav ? " fav" : "");
    item.innerHTML =
      '<span class="lib-star" role="button" title="favorite — pin to top">' + (fav ? "★" : "☆") + "</span>" +
      '<span class="lib-label">' + def.title + "</span>" +
      '<span class="lib-state">' + (on ? "on" : "add") + "</span>";
    item.querySelector(".lib-star").addEventListener("click", (e) => { e.stopPropagation(); toggleFav("widget:" + def.type); renderLibrary(); });
    item.addEventListener("click", () => (on ? removeWidget(def.type) : addSingleton(def.type)));
    library.appendChild(item);
  });
}

// ── Sidebar: icon library ──────────────────────────────────
const iconGrid = document.getElementById("iconGrid");
const iconSearch = document.getElementById("iconSearch");
function renderIcons() {
  iconGrid.innerHTML = "";
  ICONS.forEach((name) => {
    const cell = document.createElement("button");
    cell.className = "icon-cell";
    cell.dataset.name = name;
    cell.title = name;
    cell.innerHTML = '<i data-lucide="' + name + '"></i>';
    cell.addEventListener("pointerdown", (e) => startIconDrag(e, name, cell));
    iconGrid.appendChild(cell);
  });
  drawIcons();
}
iconSearch.addEventListener("input", () => {
  const q = iconSearch.value.trim().toLowerCase();
  iconGrid.querySelectorAll(".icon-cell").forEach((c) => {
    c.classList.toggle("hidden", q && !c.dataset.name.includes(q));
  });
});

// collapse / expand the Icon Library
const iconSection = document.getElementById("iconSection");
const ICONS_COLLAPSED = "money.icons.collapsed";
if (localStorage.getItem(ICONS_COLLAPSED) === "1") iconSection.classList.add("collapsed");
document.getElementById("iconToggle").addEventListener("click", () => {
  const c = iconSection.classList.toggle("collapsed");
  localStorage.setItem(ICONS_COLLAPSED, c ? "1" : "0");
});

// ── Sidebar open / close ───────────────────────────────────
function setSidebar(open) {
  document.body.classList.toggle("sidebar-open", open);
  localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
}
document.getElementById("sidebarToggle").addEventListener("click", () => setSidebar(true));
document.getElementById("sidebarClose").addEventListener("click", () => setSidebar(false));

// ── Resizable side menu (drag the right edge) ──────────────
(function setupSidebarResize() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const KEY = "money.sidebarWidth";
  const clamp = (w) => Math.max(230, Math.min(480, w));
  const saved = parseInt(localStorage.getItem(KEY), 10);
  if (saved) sidebar.style.width = clamp(saved) + "px";
  const grip = document.createElement("div");
  grip.className = "sidebar-resize";
  sidebar.appendChild(grip);
  let sizing = false, sx = 0, sw = 0;
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    sizing = true; sx = e.clientX; sw = sidebar.offsetWidth;
    try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    document.body.classList.add("sidebar-sizing");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!sizing) return;
    sidebar.style.width = clamp(sw - (e.clientX - sx)) + "px";  // grip is on the left edge (sidebar docks right)
  });
  const end = () => {
    if (!sizing) return;
    sizing = false;
    document.body.classList.remove("sidebar-sizing");
    localStorage.setItem(KEY, String(sidebar.offsetWidth));
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
})();

// ── Theme (color profiles) ─────────────────────────────────
const THEME_KEY = "money.theme";
const THEMES = [
  { id: "mono", label: "Mono (auto)", bg: "#f3f2ef", accent: "#1c1c1a" },
  { id: "cache", label: "The Cache", bg: "#16140c", accent: "#FFD409" },
  { id: "light", label: "Oat Milk", bg: "#ece6d6", accent: "#c9542e" },
  { id: "dark", label: "Beast Mode", bg: "#1c0307", accent: "#ff3a46" },
  { id: "terminal", label: "Gamer Sweat", bg: "#0c0f0a", accent: "#8fe388" },
  { id: "blueprint", label: "Bluetooth CEO", bg: "#0e1830", accent: "#6aa6ff" },
  { id: "mist", label: "Foggy Brain", bg: "#e8ecf0", accent: "#4a6da7" },
  { id: "vapor", label: "Mall Ghost", bg: "#1a0e2e", accent: "#ff4fd8" },
  { id: "acid", label: "Toxic Trait", bg: "#0a0a06", accent: "#aaff2b" },
  { id: "ember", label: "Campfire Menace", bg: "#1a0c08", accent: "#ff5a36" },
];
// star a theme just to flag a favorite (cosmetic — adds a ★ on its chip)
const THEME_STARS_KEY = "money.themeStars";
function themeStars() { try { return JSON.parse(localStorage.getItem(THEME_STARS_KEY) || "{}"); } catch (e) { return {}; } }
function isThemeStarred(id) { return !!themeStars()[id]; }
function toggleThemeStar(id) {
  const m = themeStars();
  if (m[id]) delete m[id]; else m[id] = 1;
  localStorage.setItem(THEME_STARS_KEY, JSON.stringify(m));
}
function themeChipHtml(t, cur) {
  const st = isThemeStarred(t.id);
  return '<div class="theme-chip' + (t.id === cur ? " active" : "") + '" data-id="' + t.id + '">' +
    '<span class="tc-swatch" style="background:' + t.bg + '"><span class="tc-dot" style="background:' + t.accent + '"></span></span>' +
    '<span class="tc-name">' + escapeHtml(t.label) + "</span>" +
    '<button class="tc-star' + (st ? " on" : "") + '" data-star="' + t.id + '" title="favorite" aria-label="favorite">' + (st ? "★" : "☆") + "</button>" +
  "</div>";
}
function wireThemeChips(container, onPick) {
  container.querySelectorAll(".tc-star").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleThemeStar(b.dataset.star);
    const on = b.classList.toggle("on");
    b.textContent = on ? "★" : "☆";
  }));
  container.querySelectorAll(".theme-chip").forEach((c) => c.addEventListener("click", () => {
    applyTheme(c.dataset.id);
    container.querySelectorAll(".theme-chip").forEach((x) => x.classList.toggle("active", x === c));
    container.querySelectorAll(".mono-btn").forEach((x) => x.classList.remove("on"));  // a color profile won the slot
    if (onPick) onPick(c.dataset.id);
  }));
}
// ── Mono tier: Light / Auto / Dark. "auto" follows the OS; light/dark force it.
//    A higher-level toggle that sits above the color profiles in the picker. ──
const MONO_MODE_KEY = "money.monoMode";
function monoMode() { const m = localStorage.getItem(MONO_MODE_KEY); return (m === "light" || m === "dark") ? m : "auto"; }
function applyMonoMode(m) {
  if (!["light", "auto", "dark"].includes(m)) m = "auto";
  localStorage.setItem(MONO_MODE_KEY, m);
  document.documentElement.setAttribute("data-monomode", m);
}
function monoSegHtml() {
  const onMono = document.documentElement.getAttribute("data-theme") === "mono";
  const m = monoMode();
  const btn = (id, label) => '<button class="mono-btn' + (onMono && m === id ? " on" : "") + '" data-mono="' + id + '" type="button">' + label + "</button>";
  return '<div class="mono-tier">' +
      '<div class="mono-tier-top"><span class="mono-tier-name">Mono</span><span class="mono-tier-sub">black &amp; white · follows your system</span></div>' +
      '<div class="mono-seg">' + btn("light", "Light") + btn("auto", "Auto") + btn("dark", "Dark") + "</div>" +
    "</div>";
}
function themeUIHtml() {
  const cur = document.documentElement.getAttribute("data-theme") || "mono";
  return monoSegHtml() +
    '<div class="theme-chips-grid">' + THEMES.filter((t) => t.id !== "mono").map((t) => themeChipHtml(t, cur)).join("") + "</div>";
}
function wireThemeUI(container, onPick) {
  container.querySelectorAll(".mono-btn").forEach((b) => b.addEventListener("click", () => {
    applyTheme("mono"); applyMonoMode(b.dataset.mono);
    container.querySelectorAll(".mono-btn").forEach((x) => x.classList.toggle("on", x === b));
    container.querySelectorAll(".theme-chip").forEach((x) => x.classList.remove("active"));
  }));
  wireThemeChips(container, onPick);
}
const themeBtn = document.getElementById("themeToggle");

function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = "mono";
  document.documentElement.setAttribute("data-theme", id);
  if (id === "mono") document.documentElement.setAttribute("data-monomode", monoMode());
  else document.documentElement.removeAttribute("data-monomode");
  localStorage.setItem(THEME_KEY, id);
  themeBtn.innerHTML = '<i data-lucide="palette"></i>';
  drawIcons();
  document.querySelectorAll(".theme-swatch, .theme-chip").forEach((s) =>
    s.classList.toggle("active", s.dataset.id === id));
}
function closeThemePop() {
  const p = document.querySelector(".theme-pop");
  const b = document.getElementById("themeBackdrop");
  if (p) p.remove();
  if (b) b.remove();
}
function openThemePop() {
  const cur = document.documentElement.getAttribute("data-theme") || "mono";
  const back = document.createElement("div");
  back.className = "theme-backdrop";
  back.id = "themeBackdrop";
  back.addEventListener("pointerdown", closeThemePop);
  const pop = document.createElement("div");
  pop.className = "theme-pop";
  pop.innerHTML = themeUIHtml();
  wireThemeUI(pop, () => closeThemePop());
  document.body.appendChild(back);
  document.body.appendChild(pop);
}
themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (document.querySelector(".theme-pop")) closeThemePop();
  else openThemePop();
});
applyTheme(localStorage.getItem(THEME_KEY) || "mono");

// ── Font packs: swap the whole UI typeface (loads the Google font on demand) ──
const FONT_KEY = "money.font";
const FONTS = [
  { id: "system", label: "Clean (default)", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: "mono", label: "Terminal", stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { id: "jet", label: "Hacker", stack: '"JetBrains Mono", ui-monospace, monospace', url: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" },
  { id: "grotesk", label: "Space Cadet", stack: '"Space Grotesk", system-ui, sans-serif', url: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap" },
  { id: "inter", label: "Clean Slate", stack: '"Inter", system-ui, sans-serif', url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" },
  { id: "fraunces", label: "Editorial", stack: '"Fraunces", Georgia, serif', url: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap" },
  { id: "courier", label: "Typewriter", stack: '"Courier Prime", "Courier New", monospace', url: "https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap" },
  { id: "archivo", label: "Brutalist", stack: '"Archivo", system-ui, sans-serif', url: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&display=swap" },
];
function loadFont(f) {
  if (!f || !f.url || document.getElementById("font-" + f.id)) return;
  const l = document.createElement("link"); l.id = "font-" + f.id; l.rel = "stylesheet"; l.href = f.url;
  document.head.appendChild(l);
}
function applyFont(id) {
  const f = FONTS.find((x) => x.id === id) || FONTS[0];
  loadFont(f);
  document.documentElement.style.setProperty("--font-ui", f.stack);
  localStorage.setItem(FONT_KEY, f.id);
  document.querySelectorAll(".font-chip").forEach((c) => c.classList.toggle("active", c.dataset.font === f.id));
}
applyFont(localStorage.getItem(FONT_KEY) || "system");

// ── Backgrounds (separate from theme; spins out, remembered) ──
const BG_KEY = "money.bg";
const BACKGROUNDS = [
  { cat: "Off", items: [{ id: "", label: "None" }] },
  { cat: "Motion", items: [
    { id: "motion-drift", label: "Drift" },
    { id: "motion-aurora", label: "Aurora" },
    { id: "motion-pulse", label: "Pulse" },
  ] },
  { cat: "Retro", items: [
    { id: "retro-grid", label: "Grid" },
    { id: "retro-scan", label: "Scanlines" },
    { id: "retro-sun", label: "Sunset" },
  ] },
  { cat: "Stickers", items: [
    { id: "sticker-dots", label: "Dots" },
    { id: "sticker-confetti", label: "Confetti" },
  ] },
];
function applyBg(id) {
  if (id) document.documentElement.setAttribute("data-bg", id);
  else document.documentElement.removeAttribute("data-bg");
  localStorage.setItem(BG_KEY, id || "");
}
function closeBgPop() {
  const p = document.querySelector(".bg-pop");
  const b = document.getElementById("bgBackdrop");
  if (p) p.remove();
  if (b) b.remove();
}
function openBgPop() {
  closeBgPop();
  const back = document.createElement("div");
  back.className = "theme-backdrop";
  back.id = "bgBackdrop";
  back.addEventListener("pointerdown", closeBgPop);
  const pop = document.createElement("div");
  pop.className = "bg-pop";
  const cur = localStorage.getItem(BG_KEY) || "";
  pop.innerHTML = BACKGROUNDS.map((g) =>
    '<div class="bg-cat">' + escapeHtml(g.cat) + "</div>" +
    '<div class="bg-row">' + g.items.map((it) =>
      '<button class="bg-swatch ' + it.id + (it.id === cur ? " active" : "") +
        '" data-id="' + it.id + '"><span>' + escapeHtml(it.label) + "</span></button>"
    ).join("") + "</div>"
  ).join("");
  document.body.appendChild(back);
  document.body.appendChild(pop);
  pop.querySelectorAll(".bg-swatch").forEach((b) => {
    b.addEventListener("click", () => {
      applyBg(b.dataset.id);
      pop.querySelectorAll(".bg-swatch").forEach((x) => x.classList.toggle("active", x === b));
    });
  });
}
document.getElementById("bgToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  if (document.querySelector(".bg-pop")) closeBgPop();
  else openBgPop();
});
applyBg(localStorage.getItem(BG_KEY) || "");  // restore the chosen background on load

// Pages button (top-left): + to add the 2nd page, then a count that opens the pages window
(function () {
  const b = document.getElementById("pagesToggle");
  if (!b) return;
  b.addEventListener("click", (e) => { e.stopPropagation(); if (PAGES.list.length <= 1) addPage(); else openPagesWindow(); });
  renderPagesBtn();
})();

// ── Sync health (bottom-right) ─────────────────────────────
const syncHealth = document.getElementById("syncHealth");
const syncDot = syncHealth.querySelector(".sync-dot");
const syncText = syncHealth.querySelector(".sync-text");
function ageStr(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : d + "d ago";
}
function updateSyncHealth() {
  fetch("data/balances.json?t=" + Date.now())
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.updated) {
        if (window.__CACHE_WEB__) { syncDot.style.background = "#8a8a8a"; syncText.textContent = "no money data yet"; syncHealth.title = "⚡ Connect to link your bank (SimpleFIN) or import a bank CSV — right here in your browser"; }
        else { syncDot.style.background = "#c9542e"; syncText.textContent = "no sync"; }
        return;
      }
      const hrs = (Date.now() - new Date(d.updated).getTime()) / 3600000;
      syncDot.style.background = hrs < 12 ? "#3f8f4e" : hrs < 48 ? "#d6920f" : "#c9542e";
      syncText.textContent = "synced " + ageStr(Date.now() - new Date(d.updated).getTime());
    })
    .catch(() => {});
}
function runSync() {   // one sync trigger for the button AND the pull-down gesture
  syncHealth.classList.add("syncing");
  syncText.textContent = "syncing…";
  if (window.__CACHE_WEB__ && cloudPaused()) {
    // honesty over a fake checkmark: nothing moves while sync is off
    syncText.textContent = "cloud sync is off";
    syncHealth.classList.remove("syncing");
    setTimeout(updateSyncHealth, 2500);
    return Promise.resolve();
  }
  if (window.__CACHE_WEB__) {
    // no bank engine on this device — here, sync means CLOUD sync: pull what's
    // new, push what's ours, and say so plainly
    return Promise.resolve(cloudAutoPull()).then(() => autoPushNow()).then(() => {
      syncText.textContent = "cloud synced ✓";
      syncHealth.classList.remove("syncing");
      setTimeout(updateSyncHealth, 2500);
    });
  }
  return fetch("/api/sync", { method: "POST" })
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ok) autoPushNow().then(() => location.reload());   // seal the fresh sync to the cloud, then reload
      else { syncText.textContent = "sync failed"; syncHealth.classList.remove("syncing"); }
    })
    .catch(() => { syncText.textContent = "backend off"; syncHealth.classList.remove("syncing"); });
}
syncHealth.addEventListener("click", runSync);
// ── Pull-to-sync: drag down from the top of the board to reveal "sync now" ──
// Touch-only by nature (touch events); the bar rides the pull with resistance,
// arms past the threshold, and springs away when done. Reduced motion = no ride.
(function () {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
  const bar = document.createElement("div");
  bar.className = "ptr-bar";
  bar.innerHTML = '<span class="ptr-txt">↓ pull to sync</span>';
  document.body.appendChild(bar);
  const txt = bar.querySelector(".ptr-txt");
  let startY = 0, pull = 0, armed = false, active = false;
  const THRESH = 72;
  const reset = () => { bar.style.transform = ""; bar.classList.remove("armed"); txt.textContent = "↓ pull to sync"; };
  boardEl.addEventListener("touchstart", (e) => {
    active = false;
    // phone-stack only: on wider touch screens (iPad desktop layout) a downward
    // widget drag or resize would ride the bar and fire a surprise sync+reload
    if (!matchMedia("(max-width: 640px)").matches) return;
    if (boardEl.scrollTop > 2) return;
    // never hijack a touch that belongs to an inner scroller (a list inside a widget)
    for (let el = e.target; el && el !== boardEl; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 2) { const o = getComputedStyle(el).overflowY; if (o === "auto" || o === "scroll") return; }
    }
    startY = e.touches[0].clientY; pull = 0; armed = false; active = true;
  }, { passive: true });
  boardEl.addEventListener("touchmove", (e) => {
    if (!active) return;
    pull = (e.touches[0].clientY - startY) / 2.2;   // resistance — half-speed ride
    if (pull <= 6) { reset(); armed = false; return; }
    armed = pull >= THRESH;
    if (!reduceMotion()) bar.style.transform = "translateY(" + Math.min(pull, THRESH + 16) + "px)";
    else bar.style.transform = armed ? "translateY(" + THRESH + "px)" : "";
    bar.classList.toggle("armed", armed);
    txt.textContent = armed ? "↑ release to sync" : "↓ pull to sync";
  }, { passive: true });
  const done = () => {
    if (!active) return;
    active = false;
    if (!armed) { reset(); return; }
    txt.textContent = "⟳ syncing…";
    Promise.resolve(runSync()).finally(() => setTimeout(reset, 900));
  };
  boardEl.addEventListener("touchend", done);
  boardEl.addEventListener("touchcancel", done);
})();
updateSyncHealth();
setInterval(updateSyncHealth, 60000);

// ── Data sources panel (bottom-right) ──────────────────────
const sourcesBtn = document.getElementById("sourcesBtn");
const sourcesPanel = document.getElementById("sourcesPanel");
function fmtDay(ts) { return ts ? new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"; }
function catDates(m) {
  if (!m.first && !m.last) return "";
  const span = (!m.first || m.first === m.last) ? fmtDay(m.last) : fmtDay(m.first) + " – " + fmtDay(m.last);
  return span + (m.count > 1 ? " · " + m.count + "×" : "");
}
function shortAcct(name) { return String(name || "").replace(/\s*\(\d+\)\s*$/, ""); }
function renderSources() {
  const grab = (u) => fetch(u + "?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([grab("data/balances.json"), grab("data/toggl.json"), grab("data/synclog.json"), grab("data/coverage.json")])
    .then(([d, tg, log, cov]) => {
      const orgs = {};
      ((d && d.accounts) || []).forEach((a) => {
        const o = a.org || "Bank";
        (orgs[o] = orgs[o] || []).push(a.name);
      });
      const banks = Object.keys(orgs);
      // A MISSING data/toggl.json reads as an empty object {} on the hosted web (webcache's
      // serve() answers absent data files with 200 {}), and {} is truthy — so gate on a REAL
      // payload (the `updated` stamp toggl_sync.py always writes), never bare truthiness, or a
      // fresh account shows a phantom "Toggl · 0 projects" it never connected.
      const tgOn = !!(tg && tg.updated);
      sourcesBtn.querySelector(".src-count").textContent = banks.length + (tgOn ? 1 : 0);
      const when = d && d.updated ? ageStr(Date.now() - new Date(d.updated).getTime()) : "—";

      let html = '<div class="src-title">Data sources</div>';
      banks.forEach((o) => {
        html += '<div class="src-bank"><span class="src-bankdot"></span><div>' +
          '<div class="src-bankname">' + escapeHtml(o) + '</div>' +
          '<div class="src-accts">' + orgs[o].map(escapeHtml).join(" · ") + '</div></div></div>';
      });
      if (tgOn) {
        html += '<a class="src-bank src-link" href="https://track.toggl.com" target="_blank" rel="noopener">' +
          '<span class="src-bankdot" style="background:#e9408f"></span><div>' +
          '<div class="src-bankname">Toggl ↗</div>' +
          '<div class="src-accts">' + ((tg.projects_month || []).length) + ' projects · time tracking</div></div></a>';
      }
      if (cov && cov.accounts && cov.accounts.length) {
        html += '<div class="src-subtitle">Data coverage</div>';
        if (cov.live_first && cov.live_last) {
          html += '<div class="cov-live">Live sync · ' + fmtDay(cov.live_first) + " → " + fmtDay(cov.live_last) + "</div>";
        }
        html += '<div class="cov-note">Live bank connection reaches back <b>~90 days</b> each sync. Older history stays saved permanently in your ledger — to extend an account further back, import an older CSV.</div>';
        cov.accounts.forEach((a) => {
          html += '<div class="cov-row"><span class="cov-dot cov-' + a.source + '"></span>' +
            '<div class="cov-body"><div class="cov-name">' + escapeHtml(shortAcct(a.account)) + "</div>" +
            '<div class="cov-meta">' + fmtDay(a.first) + " → " + fmtDay(a.last) +
              " · " + a.count + " txns · " + a.source + "</div></div></div>";
        });
      }
      if (log && log.length) {
        html += '<div class="src-subtitle">Recent syncs</div>';
        log.slice(-5).reverse().forEach((e) => {
          html += '<div class="src-log">' + ageStr(Date.now() - new Date(e.time).getTime()) +
            ' · ' + e.accounts + " accts, " + e.transactions + " txns</div>";
        });
      }
      html += '<div class="src-foot">last synced ' + when +
        '<br><span class="src-auto">⟳ auto-syncs 3×/day + on login</span></div>';
      sourcesPanel.innerHTML = html;
    });
}
sourcesBtn.addEventListener("click", (e) => { e.stopPropagation(); sourcesPanel.classList.toggle("open"); });
document.addEventListener("click", (e) => {
  if (!sourcesPanel.contains(e.target) && !sourcesBtn.contains(e.target)) sourcesPanel.classList.remove("open");
});
renderSources();

// ── Soundtrack (YouTube audio toggle) ──────────────────────
const SND_KEY = "money.soundtrack";
// The built-in default soundtrack, so ♪ plays something the very first time — no paste
// required. A shipped constant: every device gets the SAME default and it never enters the
// vault. Only a user override writes money.soundtrack (a GENERIC key), which then syncs.
// (parseYtId takes a full link or a bare 11-char id; the ?si= share tag is ignored.)
const SND_DEFAULT = "https://youtu.be/7XPGU7dmZXg";
const sndBtn = document.getElementById("soundtrack");
let ytPlayer = null, ytReady = false, ytRequested = false;

// Load YouTube's iframe API ON DEMAND — only when a soundtrack is actually used, never
// for everyone on every page load (security eval T4: fewer third-party scripts running
// next to decrypted data). The CSP allows www.youtube.com; this injects it lazily.
function ytEnsureApi(then) {
  if (ytReady) { if (then) then(); return; }
  if (then) ytPendingCbs.push(then);
  if (ytRequested) return;
  ytRequested = true;
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.async = true;
  document.body.appendChild(s);
}
let ytPendingCbs = [];

function parseYtId(u) {
  const m = String(u).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  if (m) return m[1];
  const s = String(u).trim();
  return /^[\w-]{11}$/.test(s) ? s : null;
}
function buildPlayer(id, playNow) {
  if (!ytReady || !window.YT) return;
  if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch (e) {} }
  ytPlayer = new YT.Player("ytAudio", {
    height: "0", width: "0", videoId: id,
    playerVars: { loop: 1, playlist: id },
    events: {
      onReady: (e) => { if (playNow) { e.target.playVideo(); sndBtn.classList.add("playing"); } },
      onStateChange: (e) => {
        if (e.data === 1) sndBtn.classList.add("playing");
        else if (e.data === 2 || e.data === 0) sndBtn.classList.remove("playing");
      },
    },
  });
}
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  const cbs = ytPendingCbs; ytPendingCbs = [];
  cbs.forEach((fn) => { try { fn(); } catch (e) {} });
};
// A saved soundtrack means the user opted into YouTube already — restore it (this triggers
// the lazy API load). Someone who never set a soundtrack never loads YouTube at all.
if (sndBtn) {
  // Only a REAL saved link auto-loads YouTube on page load. The default never loads here —
  // YouTube is only ever fetched once the user actually presses play (T4 lazy-load/privacy).
  if (localStorage.getItem(SND_KEY)) ytEnsureApi(() => { const id = localStorage.getItem(SND_KEY); if (id) buildPlayer(id, false); });
  // Override: paste your own link. Right-click / context-menu key (desktop) or long-press
  // (touch) — never hover-only, so it stays reachable on a phone (mobile SOP #2).
  function sndSetCustom() {
    const u = prompt("Paste a YouTube link for your soundtrack:", localStorage.getItem(SND_KEY) || "");
    if (u == null) return;                        // Cancel — keep whatever's playing
    const id = parseYtId(u);
    if (!id) { alert("Couldn't find a YouTube video ID in that link."); return; }
    localStorage.setItem(SND_KEY, id);
    ytEnsureApi(() => buildPlayer(id, true));     // buildPlayer() tears down the old player first
  }
  let sndSkipClick = false;
  sndBtn.addEventListener("click", () => {
    if (sndSkipClick) { sndSkipClick = false; return; }   // a long-press already opened the editor
    // Nothing saved → fall back to the built-in default so the button just works out of the box.
    const id = localStorage.getItem(SND_KEY) || parseYtId(SND_DEFAULT);
    if (!id) { sndSetCustom(); return; }          // no default configured either → ask once
    if (!ytPlayer || !ytPlayer.getPlayerState) { ytEnsureApi(() => buildPlayer(id, true)); return; }
    if (ytPlayer.getPlayerState() === 1) { ytPlayer.pauseVideo(); sndBtn.classList.remove("playing"); }
    else { ytPlayer.playVideo(); sndBtn.classList.add("playing"); }
  });
  sndBtn.addEventListener("contextmenu", (e) => { e.preventDefault(); sndSetCustom(); });
  let sndLp = 0, sndLx = 0, sndLy = 0;            // long-press (touch) — a bonus path, never the only one
  const sndCancelLp = () => { if (sndLp) { clearTimeout(sndLp); sndLp = 0; } };
  sndBtn.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") return; sndLx = e.clientX; sndLy = e.clientY; sndCancelLp(); sndLp = setTimeout(() => { sndLp = 0; sndSkipClick = true; sndSetCustom(); }, 500); });
  sndBtn.addEventListener("pointermove", (e) => { if (sndLp && (Math.abs(e.clientX - sndLx) > 8 || Math.abs(e.clientY - sndLy) > 8)) sndCancelLp(); });   // a scroll is not a hold
  sndBtn.addEventListener("pointerup", sndCancelLp);
  sndBtn.addEventListener("pointercancel", sndCancelLp);
}

// ── Menu: reset ────────────────────────────────────────────
document.getElementById("resetLayout").addEventListener("click", () => {
  localStorage.removeItem(LAYOUT_KEY);
  location.reload();
});

// pull the latest pushed code from GitHub and reload (works for anyone running a git clone)
function _fmtBytes(b) { return b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB"; }
// actually pull + restart + reload (only after the user opts in)
function runUpdate(closeFn) {
  if (closeFn) closeFn();
  flash("Updating — I'll reload when it's ready…");
  fetch("/api/update", { method: "POST" })
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.ok) { flash("Update failed: " + ((d && (d.error || d.message)) || "is this a git checkout?")); return; }
      if (!d.changed) { flash("Already up to date ✓"); return; }
      setTimeout(() => {
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          fetch("/api/ping?t=" + Date.now()).then((r) => { if (r.ok) { clearInterval(iv); location.reload(); } }).catch(() => {});
          if (tries > 30) { clearInterval(iv); flash("Updated — refresh to load it"); }
        }, 400);
      }, 1100);
    })
    .catch(() => flash("Update failed — backend down?"));
}
// full-transparency preview: what changes, why, how big, which version — decide before anything happens
function openUpdate(d) {
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "updBackdrop";
  const modal = document.createElement("div");
  modal.className = "cat-modal upd-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const changes = (d.changes || []).map((c) => "<li>" + escapeHtml(c) + "</li>").join("") || "<li>(no description provided)</li>";
  modal.innerHTML =
    '<div class="cat-head"><span>Update available</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="upd-body">' +
      '<div class="upd-lead">' + d.behind + " update" + (d.behind > 1 ? "s" : "") + " ready — here's exactly what changes.</div>" +
      '<div class="upd-sec">What’s new</div><ul class="upd-changes">' + changes + "</ul>" +
      '<div class="upd-meta">' +
        "<span>📦 download <b>" + _fmtBytes(d.size_bytes || 0) + "</b></span>" +
        "<span>📄 <b>" + (d.files || 0) + "</b> files</span>" +
        "<span>🔖 <b>" + d.current + "</b> → <b>" + d.latest + "</b></span>" +
      "</div>" +
      (d.stat ? '<div class="upd-stat">' + escapeHtml(d.stat) + "</div>" : "") +
      '<div class="upd-actions">' +
        '<button class="upd-skip" type="button">Skip this update</button>' +
        '<button class="upd-later" type="button">Not now</button>' +
        '<button class="upd-go" type="button">Update now</button>' +
      "</div>" +
      '<div class="upd-note">Nothing happens until you choose. <b>Skip</b> hides this version for good — no pop-ups, no nagging. <b>Not now</b> just closes; you can check again anytime.</div>' +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
  modal.querySelector(".upd-later").addEventListener("click", close);
  modal.querySelector(".upd-skip").addEventListener("click", () => {
    try { localStorage.setItem("money.skipUpdate", d.latest_full || d.latest); } catch (e) {}
    close(); flash("Skipped — I won't bring this one up again.");
  });
  modal.querySelector(".upd-go").addEventListener("click", () => runUpdate(close));
}
function updateApp() {
  flash("Checking for updates…");
  fetch("/api/update-check?t=" + Date.now())
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.ok) { flash("Update check failed — " + ((d && d.error) || "is this a git checkout?")); return; }
      if (!d.available) { flash("You're up to date ✓"); return; }
      openUpdate(d);
    })
    .catch(() => flash("Update check failed — backend down?"));
}
document.getElementById("updateApp").addEventListener("click", () => { updateApp(); setSidebar(false); });

// tidy: snap everything into a clean left-to-right grid
// the top stats bar floats over the board — reserve the canvas band beneath it so
// widgets never hide under it. Returns the minimum widget top (in canvas px, scroll/zoom aware).
function topInset() {
  const s = document.querySelector(".stats");
  if (!s || !s.children.length) return 8;
  const barBottom = s.getBoundingClientRect().bottom + 12;
  const board = document.getElementById("board");
  const z = boardZoom || 1;
  return Math.max(8, Math.round((barBottom + (board ? board.scrollTop : 0)) / z));
}
// Only protect the stats-bar zone at the very top of the scroll. Once you've scrolled
// down, the stats bar is just floating over mid-page content — don't yank widgets around.
function topClamp() { const b = document.getElementById("board"); return (b && b.scrollTop > 4) ? 0 : topInset(); }
// nudge any widget currently tucked under the stats bar down to just below it
function reflowBelowStats() {
  const minY = topInset();
  let changed = false;
  Object.keys(layout).forEach((id) => {
    const e = layout[id], node = nodes[id];
    if (!e || !node) return;
    if ((e.y || 0) < minY) {
      e.y = minY;
      node.style.top = minY + "px";
      changed = true;
    }
  });
  if (changed) saveLayout();
}
// Tidy IN PLACE: keep widgets in the rows/order you put them, just clean it up —
// align each row's tops, even out the gaps, and normalize widths so a row fits
// pleasantly across the canvas. Doesn't reflow everything into reading order.
function tidyLayout(animate) {
  if (animate === undefined) animate = true;
  const gap = gutterVal(), startX = 32, startY = Math.max(86, topInset());
  const zoom = (typeof boardZoom === "number" && boardZoom) ? boardZoom : 1;
  const avail = Math.max(560, (board ? board.clientWidth : window.innerWidth) / zoom - startX * 2);
  const items = Object.keys(layout).map((id) => {
    const node = nodes[id];
    return node ? { id, node, x: layout[id].x || 0, y: layout[id].y || 0, w: node.offsetWidth, h: node.offsetHeight } : null;
  }).filter(Boolean);
  if (!items.length) return;
  // group into rows by vertical proximity (preserves which widgets sit together)
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  items.forEach((it) => {
    const row = rows[rows.length - 1];
    if (row && it.y < row.top + row.maxH * 0.6) { row.items.push(it); row.maxH = Math.max(row.maxH, it.h); }
    else rows.push({ top: it.y, maxH: it.h, items: [it] });
  });
  let y = startY;
  rows.forEach((row) => {
    row.items.sort((a, b) => a.x - b.x);  // keep left→right order within the row
    const n = row.items.length, sumW = row.items.reduce((a, it) => a + it.w, 0);
    const scale = (avail - gap * (n - 1)) / (sumW || 1);  // fit the row to the canvas width
    let x = startX, rowH = 0;
    row.items.forEach((it) => {
      const w = Math.max(240, Math.min(620, Math.round(it.w * scale)));  // similar, bounded widths
      if (animate) it.node.classList.add("tidying");
      it.node.style.left = x + "px"; it.node.style.top = y + "px"; it.node.style.width = w + "px";
      layout[it.id].x = x; layout[it.id].y = y; layout[it.id].w = w;
      x += w + gap; rowH = Math.max(rowH, it.h);
    });
    y += rowH + gap;
  });
  saveLayout();
  if (animate) setTimeout(() => Object.values(nodes).forEach((n) => n.classList.remove("tidying")), 480);
}
document.getElementById("tidyLayout").addEventListener("click", () => { tidyLayout(); setSidebar(false); });
document.getElementById("saveView").addEventListener("click", () => {
  const name = prompt("Name this view (e.g. ‘daily’, ‘work mode’):");
  if (name && name.trim()) { saveView(name.trim()); flash("saved “" + name.trim() + "”"); }
});
renderViews();

// ── Zoom controls ──────────────────────────────────────────
document.getElementById("zoomIn").addEventListener("click", () => setZoom(boardZoom + 0.1));
document.getElementById("zoomOut").addEventListener("click", () => setZoom(boardZoom - 0.1));
document.getElementById("zoomReset").addEventListener("click", () => {
  setZoom(1);
  board.scrollTo({ left: 0, top: 0, behavior: "smooth" });
});
// ctrl / ⌘ + wheel zooms toward the cursor
board.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const before = toCanvas(e.clientX, e.clientY);
  setZoom(boardZoom - Math.sign(e.deltaY) * 0.1);
  const after = toCanvas(e.clientX, e.clientY);
  board.scrollLeft += (before.x - after.x) * boardZoom;
  board.scrollTop += (before.y - after.y) * boardZoom;
}, { passive: false });

// ── Bug reports & requests ─────────────────────────────────
// Reports go straight to cozy@cozyace.com via Web3Forms (a free client-side
// form relay — the key only ever sends to that one inbox, safe to ship public).
// Until the key is set we fall back to opening the reporter's mail app.
const FEEDBACK_KEY = "dc9d167b-fa61-486d-8435-e52997247c78";   // Web3Forms public key → emails cozy@cozyace.com
const FEEDBACK_TO = "cozy@cozyace.com";
function feedbackContext() {
  let theme = "?";
  try { theme = localStorage.getItem("money.theme") || "default"; } catch (e) {}
  return "theme: " + theme + " · " + (window.innerWidth + "×" + window.innerHeight) +
    " · " + navigator.userAgent;
}
// Every report ALSO lands in the shared beta feedback inbox — a `feedback` collection on
// the already-live PocketBase cloud — so Cozy's + Spencer's reports pool in ONE place the
// founder (and the future roadmap wizard) can read, instead of dying in an email inbox.
// Fire-and-forget: if the collection doesn't exist yet or the network is down, the email
// path above still carries the report — this never blocks or breaks the button.
// `credit` is the reporter's PER-REPORT opt-in ("credit this to my cache"): only then —
// and only while actually signed in — does the record carry `owner` (their account id),
// which is what lets the fixed-it news + EXP find their way back. Without it the report
// is exactly as anonymous as it always was: no owner, no auth header, equally welcome.
function sendFeedbackToInbox(kind, text, email, credit) {
  try {
    let from = "";
    try { from = profileName() || ""; } catch (e) {}   // card first, legacy money.profile fallback — the direct read went stale once edits moved to the card
    const s = cloudState();
    const withOwner = !!(credit && s.token && s.userId);
    const body = { kind: kind || "note", message: (text || "").slice(0, 4000), reply_to: email || "", from_name: from.slice(0, 80), context: feedbackContext().slice(0, 300) };
    if (withOwner) body.owner = s.userId;
    const hdr = { "Content-Type": "application/json" };
    if (withOwner) hdr.Authorization = s.token;   // the create rule only lets you attach YOURSELF
    fetch(cloudUrl() + "/api/collections/feedback/records", {
      method: "POST",
      headers: hdr,
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch (e) {}
}
// Returns a promise<boolean> — true if it was sent (or the mail app was opened).
function sendFeedback(kind, text, email, credit) {
  sendFeedbackToInbox(kind, text, email, credit);
  const subject = "THE CACHE — " + kind + (email ? " — " + email : "");
  if (!FEEDBACK_KEY) {
    const body = text + "\n\n— kind: " + kind +
      (email ? "\n— reply to: " + email : "") + "\n— " + feedbackContext();
    window.location.href = "mailto:" + FEEDBACK_TO +
      "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    return Promise.resolve(true);
  }
  return fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      access_key: FEEDBACK_KEY,
      subject: subject,
      from_name: "THE CACHE",
      replyto: email || "",
      Kind: kind,
      Message: text,
      Context: feedbackContext(),
      botcheck: "",
    }),
  })
    .then((r) => r.json())
    .then((d) => !!d.success)
    .catch(() => false);
}
// ── Closing the loop: "the thing you reported is fixed" ─────────────────────
// On the 75s cloud loop (gently — a real check only every ~4 min; fixes are rare
// events), fetch this account's OWN credited feedback rows that are marked fixed.
// Any id not yet in the money.bugCredits union is genuinely new: claim it (EXP,
// journey entry) and show one calm, celebratory card. Never a red alert, never
// nagging — a claimed id never resurfaces, on any device.
let _bugPolling = false, _bugPollAt = 0;
async function bugPoll() {
  const s = cloudState();
  if (_bugPolling || !s.token || !s.userId) return;
  if (Date.now() - _bugPollAt < 240000) return;
  _bugPolling = true; _bugPollAt = Date.now();
  try {
    const d = await socialApi("/api/collections/feedback/records?perPage=100&filter=" + encodeURIComponent('owner="' + s.userId + '" && status="fixed"'));
    const fresh = (d.items || []).filter((it) => it && it.id && bugCreditClaim(it.id, it.updated || it.created || ""));
    if (fresh.length) {
      try { renderStatsBar(); } catch (e) {}   // the contributor stat may have just appeared
      openBugFixedCard(fresh);
    }
  } catch (e) {} finally { _bugPolling = false; }   // collection not created yet / offline → quietly try again later
}
// The card. Warm and specific — their own words back to them, plus Cozy's fix note
// if there is one. Both strings go through escapeHtml before the DOM.
function openBugFixedCard(items) {
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal bugfix-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const st = bugCreditStat();
  const rows = items.map((it) => {
    const what = String(it.message || "").slice(0, 140);
    const note = String(it.fix_note || "");
    return '<div class="bugfix-row">' +
      '<div class="bugfix-what">“' + escapeHtml(what) + '”</div>' +
      (note ? '<div class="bugfix-note">' + escapeHtml(note) + "</div>" : "") +
      "</div>";
  }).join("");
  modal.innerHTML =
    '<div class="cat-head"><span>🛠️ Fixed — thanks to you</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="bugfix-body">' +
      '<div class="bugfix-lead">Remember ' + (items.length > 1 ? "these? You reported them, and now they’re" : "this? You reported it, and now it’s") + " fixed.</div>" +
      rows +
      '<div class="bugfix-exp">+' + (items.length * BUG_FIX_EXP) + " EXP · " + st.count + (st.count === 1 ? " report" : " reports") + " of yours " + (st.count === 1 ? "has" : "have") + " made the Cache better 💛</div>" +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
}
function closeBugReport() {
  const m = document.querySelector(".bug-modal");
  const b = document.getElementById("bugBackdrop");
  if (m) m.remove();
  if (b) b.remove();
}
function bugPost(url, body) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); });
}
function renderBugList(listEl, bugs) {
  if (!bugs || !bugs.length) { listEl.innerHTML = '<div class="cat-empty">no bugs logged — nice ✨</div>'; return; }
  const order = bugs.slice().sort((a, b) =>
    (a.status === "solved") - (b.status === "solved") || (b.id - a.id));
  listEl.innerHTML = order.map((bug) =>
    '<div class="bug-row' + (bug.status === "solved" ? " solved" : "") + '" data-id="' + bug.id + '">' +
      '<button class="bug-check" title="mark solved / reopen">' + (bug.status === "solved" ? "✓" : "○") + "</button>" +
      '<span class="bug-text">' + escapeHtml(bug.text) + "</span>" +
      '<button class="bug-del" title="delete">✕</button>' +
    "</div>").join("");
  listEl.querySelectorAll(".bug-row").forEach((row) => {
    const id = +row.dataset.id;
    row.querySelector(".bug-check").addEventListener("click", () => {
      const next = row.classList.contains("solved") ? "open" : "solved";
      bugPost("/api/bug-status", { id, status: next }).then((d) => renderBugList(listEl, d.bugs)).catch(() => {});
    });
    row.querySelector(".bug-del").addEventListener("click", () => {
      bugPost("/api/bug-status", { id, status: "delete" }).then((d) => renderBugList(listEl, d.bugs)).catch(() => {});
    });
  });
}
function openBugReport() {
  closeBugReport();
  const back = document.createElement("div");
  back.className = "cat-backdrop";
  back.id = "bugBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeBugReport(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal bug-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Report a bug or request</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="bug-new">' +
      '<div class="bug-types">' +
        '<button class="bug-type on" data-kind="bug" type="button">🐛 Bug</button>' +
        '<button class="bug-type" data-kind="request" type="button">💡 Request</button>' +
        '<button class="bug-type" data-kind="other" type="button">💬 Other</button>' +
      "</div>" +
      '<textarea class="bug-input" placeholder="What’s broken, or what would you love to see?"></textarea>' +
      '<input class="bug-email" type="email" placeholder="your email (optional — so cozy can reply)" />' +
      // per-report opt-in — only offered when a cloud account is actually signed in.
      // Plain about what gets attached; unchecked = exactly as anonymous as before.
      (cloudState().token && cloudState().userId
        ? '<label class="bug-credit"><input class="bug-credit-cb" type="checkbox" />' +
          '<span><b>Credit this to my cache</b> — attaches your account so you hear back when it’s fixed (and earn EXP). Leave it off to send anonymously.</span></label>'
        : "") +
      '<button class="bug-submit" type="button">Send to cozy</button>' +
      '<div class="bug-msg" aria-live="polite"></div>' +
    "</div>" +
    '<div class="cat-list bug-list">loading…</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", closeBugReport);
  const listEl = modal.querySelector(".bug-list");
  const input = modal.querySelector(".bug-input");
  const emailEl = modal.querySelector(".bug-email");
  const msgEl = modal.querySelector(".bug-msg");
  const submit = modal.querySelector(".bug-submit");
  let kind = "bug";
  modal.querySelectorAll(".bug-type").forEach((btn) => {
    btn.addEventListener("click", () => {
      kind = btn.dataset.kind;
      modal.querySelectorAll(".bug-type").forEach((b) => b.classList.toggle("on", b === btn));
    });
  });
  function load() {
    fetch("/api/bugs?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
      .then((d) => renderBugList(listEl, d.bugs || []))
      .catch(() => { listEl.innerHTML = '<div class="cat-empty">backend stopped or out of date — restart it (double-click <b>start.command</b>)</div>'; });
  }
  submit.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const email = emailEl.value.trim();
    const creditCb = modal.querySelector(".bug-credit-cb");
    const credit = !!(creditCb && creditCb.checked);
    submit.disabled = true;
    msgEl.className = "bug-msg";
    msgEl.textContent = "sending…";
    sendFeedback(kind, text, email, credit).then((ok) => {
      submit.disabled = false;
      if (ok) {
        input.value = "";
        msgEl.className = "bug-msg ok";
        msgEl.textContent = FEEDBACK_KEY ? "Sent — thank you! 🎉" : "Opening your email app — just hit send 📨";
        // best-effort local record (no-op for friends if backend is off)
        bugPost("/api/bug", { text: "[" + kind + "] " + text + (email ? " (" + email + ")" : "") })
          .then((d) => renderBugList(listEl, d.bugs)).catch(() => {});
      } else {
        msgEl.className = "bug-msg err";
        msgEl.textContent = "Couldn’t send — check your connection and try again.";
      }
    });
  });
  input.focus();
  load();
}
// ── 💛 Back the Cache (Phase 1 · choose-to-pay) ─────────────
// Free stays free: backing never gates or unlocks anything, and there is no
// payment processing in-app — these are OUTBOUND links to the founder's sponsor
// pages only. An entry with an empty url never renders a button, so the section
// ships quietly hidden until the real pages exist: a dead link can never ship.
const BACK_LINKS = [
  { label: "GitHub Sponsors", icon: "heart", url: "" },
  { label: "Ko-fi", icon: "coffee", url: "" },
];
function openBackCache() {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal back-modal";
  const live = BACK_LINKS.filter((l) => l.url);
  modal.innerHTML =
    '<div class="cat-head"><span>💛 Back the Cache</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="back-body">' +
      '<div class="back-em">💛</div>' +
      '<p class="back-p">The Cache is free, and it stays free — everything that runs on your own machine is yours, no locks, no timers, no asking twice. If it’s been good to your brain and you’d like to help it grow, backing is how: it covers the servers and buys time to keep building. And if now isn’t the moment, that’s genuinely fine — using the Cache and showing a friend already helps more than you know.</p>' +
      (live.length
        ? '<div class="back-links">' +
            live.map((l) => '<a class="back-link" href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer"><i data-lucide="' + l.icon + '"></i><span>' + escapeHtml(l.label) + '</span></a>').join("") +
          "</div>"
        : '<div class="back-soon">Backing links are still being set up — nothing to do here yet. Just knowing you’d look means a lot.</div>') +
      '<div class="back-fine">Backing never unlocks features. Free is the whole point.</div>' +
    "</div>";
  document.body.appendChild(back);
  document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
  drawIcons();
}
(function () { const b = document.getElementById("backCache"); if (b) b.addEventListener("click", () => { openBackCache(); setSidebar(false); }); })();
document.getElementById("connectBank").addEventListener("click", () => { openConnect(); setSidebar(false); });
(function () { const w = document.getElementById("openWizardBtn"); if (w) w.addEventListener("click", () => { openWizard(); setSidebar(false); }); })();
document.getElementById("openSettings").addEventListener("click", () => { openSettings(); setSidebar(false); });
(function () {  // King Cozy console — stays hidden until applyKing() confirms the founder lock (machine-local .founder)
  const k = document.getElementById("kingCozy");
  if (k) k.addEventListener("click", () => { openKingCozy(); setSidebar(false); });
})();

// In-app help wiki — ships with the app (works offline via the local WIKI.md) AND
// pushable: fetches WIKI.md fresh from the repo for instant updates, local fallback.
function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  let html = "", inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  md.split("\n").forEach((line) => {
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const li = line.match(/^[-*]\s+(.*)/);
    if (h) { closeList(); const lvl = Math.min(4, h[1].length + 1); html += "<h" + lvl + ' class="wk-h">' + inline(h[2]) + "</h" + lvl + ">"; return; }
    if (li) { if (!inList) { html += '<ul class="wk-ul">'; inList = true; } html += "<li>" + inline(li[1]) + "</li>"; return; }
    if (!line.trim()) { closeList(); return; }
    closeList(); html += '<p class="wk-p">' + inline(line) + "</p>";
  });
  closeList();
  return html;
}
function openWiki() {
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal wiki-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  modal.innerHTML = '<div class="cat-head"><span>📖 Help &amp; Learn</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="wk-body" id="wkBody"><p class="wk-p">Loading…</p></div>';
  document.body.appendChild(back); document.body.appendChild(modal);
  makeModalResizable(modal, "money.wiki");
  modal.querySelector(".cat-close").addEventListener("click", close);
  const body = modal.querySelector("#wkBody");
  const render = (md) => { body.innerHTML = mdToHtml(md); };
  fetch("https://raw.githubusercontent.com/cozykace/thecache/main/WIKI.md?t=" + Date.now())
    .then((r) => (r.ok ? r.text() : Promise.reject())).then(render)
    .catch(() => fetch("WIKI.md?t=" + Date.now()).then((r) => r.text()).then(render)
      .catch(() => { body.innerHTML = '<p class="wk-p">Couldn’t load the guide right now — it ships with the app as WIKI.md.</p>'; }));
}
document.getElementById("helpWiki").addEventListener("click", () => { openWiki(); setSidebar(false); });

// ── Enter the Ledger — a full-screen hyperspace warp into a separate cosmic space
//    that visualizes your real financial life as a constellation. ──
function fmtCompact(n) {
  const a = Math.abs(n);
  return (n < 0 ? "-" : "+") + "$" + (a >= 1000 ? (a / 1000).toFixed(1).replace(/\.0$/, "") + "k" : Math.round(a));
}
function buildConstellation(svg, months) {
  if (!months.length) { svg.innerHTML = '<text x="500" y="160" text-anchor="middle" fill="rgba(255,255,255,.4)" font-size="15" font-family="ui-monospace,monospace">your constellation fills in as the months accumulate</text>'; return; }
  const ACC = (getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()) || "#FFD409";  // match the app's theme
  const cb = colorBlindMode();
  const POS = cb ? "#0072B2" : ACC, NEG = cb ? "#D55E00" : "#e0734a";  // safe blue/vermillion vs theme gold/ember
  const RM = reduceMotion();  // no twinkle when motion is reduced
  const W = 1000, H = 320, pad = 64, n = months.length;
  const xAt = (i) => pad + i * (W - 2 * pad) / Math.max(1, n - 1);
  const maxA = Math.max(1, ...months.map((m) => Math.abs(m.net || 0)));
  const yAt = (net, i) => H / 2 - (net / maxA) * 88 + Math.sin(i * 0.8) * 8;
  const nodes = months.map((m, i) => ({ x: xAt(i), y: yAt(m.net || 0, i), m }));
  let path = "";
  nodes.forEach((p, i) => { path += (i ? "L" : "M") + p.x.toFixed(0) + " " + p.y.toFixed(0) + " "; });
  svg.innerHTML = '<path d="' + path + '" fill="none" stroke="rgba(180,130,255,.45)" stroke-width="1.5"/>' +
    nodes.map((p, i) => {
      const net = p.m.net || 0, pos = net >= 0, r = 6 + Math.min(14, Math.abs(net) / maxA * 14);
      return '<circle cx="' + p.x.toFixed(0) + '" cy="' + p.y.toFixed(0) + '" r="' + r.toFixed(0) + '" fill="' + (pos ? POS : NEG) + '" opacity="0.9">' + (RM ? "" : '<animate attributeName="opacity" values="0.55;1;0.55" dur="' + (2 + i * 0.25).toFixed(1) + 's" repeatCount="indefinite"/>') + "</circle>" +
        '<text x="' + p.x.toFixed(0) + '" y="' + (p.y - r - 8).toFixed(0) + '" text-anchor="middle" font-size="11" fill="#fff" opacity="0.8" font-family="ui-monospace,monospace">' + escapeHtml(p.m.label || "") + "</text>" +
        '<text x="' + p.x.toFixed(0) + '" y="' + (p.y + r + 16).toFixed(0) + '" text-anchor="middle" font-size="10" fill="' + (pos ? POS : NEG) + '" opacity="0.95" font-family="ui-monospace,monospace">' + fmtCompact(net) + "</text>";
    }).join("");
}
// Songs you've approved to play when a trip to the cache is booked (the travel
// soundtrack). Add more filenames here as you approve them (drop the .mp3 in
// "av assets/"); one is picked at random per trip.
const TRIP_SONGS = ["av%20assets/slingshot%20the%20airplane%20v4.mp3"];
const TRIP_SONG_START = 3;  // skip the intro — start (and loop) from the 3-second mark
// Cockpit / visualizer design language — vivid, monday.com-style colors. Each
// data domain gets one color, reused across the Ledger's dashboard bubbles.
const LG_COLORS = { sources: "#00c875", cash: "#fdab3d", spend: "#e2445c", months: "#a25ddc", exp: "#ffcb00" };
// Okabe-Ito color-blind-safe palette (used when Accessibility → Color vision = safe)
const LG_COLORS_SAFE = { sources: "#009E73", cash: "#E69F00", spend: "#D55E00", months: "#CC79A7", exp: "#F0E442" };
function lgPalette() { return colorBlindMode() ? LG_COLORS_SAFE : LG_COLORS; }
function fadeAudio(a, to, ms, then) {
  if (!a) return;
  const from = a.volume, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step); else if (then) then();
  };
  step();
}
function openLedger() {
  if (document.getElementById("ledgerSpace")) return;
  const root = document.createElement("div"); root.id = "ledgerSpace"; root.className = "lg-space";
  root.innerHTML =
    '<canvas class="lg-canvas"></canvas>' +
    '<div class="lg-board lg-scene">' +
      '<div class="lg-eyebrow">' + escapeHtml(getCacheName()) + '</div>' +
      '<div class="lg-cta">VISIT YOUR CACHE</div>' +
      '<div class="lg-board-sub">Book a trip and travel out to see your cache in person.</div>' +
      '<button class="lg-book">🛫 Book the trip</button>' +
      '<button class="lg-cancel">not now</button>' +
    "</div>" +
    '<div class="lg-intro lg-scene lg-hidden"><div class="lg-eyebrow">EN ROUTE</div><div class="lg-cta">TRAVELING TO YOUR CACHE</div></div>' +
    '<div class="lg-ledger lg-scene lg-hidden">' +
      '<div class="lg-hero">' +                              // centered hero grows to fill the space ABOVE the dash…
        '<div class="lg-eyebrow lg-gold">⟢ The Ledger ⟣</div>' +
        '<div class="lg-title">YOUR LIFE, IN DATA</div>' +
        '<div class="lg-headline" id="lgHeadline"></div>' +
        '<div class="lg-reward lg-hidden" id="lgReward"></div>' +
        '<svg class="lg-const" id="lgConst" viewBox="0 0 1000 320" preserveAspectRatio="xMidYMid meet"></svg>' +
        '<button class="lg-back">↩ Return</button>' +
      '</div>' +
      '<div class="lg-dash" id="lgDash"></div>' +             // …and the dash sits in-flow below it, so the two can never overlap
    "</div>" +
    '<button class="lg-mute lg-hidden" title="Mute the music">🔊</button>' +
    '<div class="lg-flash"></div>';
  document.body.appendChild(root);
  let song = null;
  try {  // preload the trip song NOW (while the booking screen shows) so it starts the instant you book
    song = new Audio(TRIP_SONGS[Math.floor(Math.random() * TRIP_SONGS.length)]);
    song.loop = false; song.volume = 0; song.preload = "auto";  // loop manually so it restarts at the 3s mark, not 0
    song.addEventListener("loadedmetadata", () => { try { song.currentTime = TRIP_SONG_START; } catch (e) {} });
    song.addEventListener("ended", () => { try { song.currentTime = TRIP_SONG_START; song.play().catch(() => {}); } catch (e) {} });
    song.load();
  } catch (e) { song = null; }
  const cv = root.querySelector(".lg-canvas"), ctx = cv.getContext("2d");
  let W, H, cx, cy;
  const size = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; cx = W / 2; cy = H / 2; };
  size();
  const N = 420, stars = [];
  const rs = (s) => { s.x = (Math.random() - 0.5) * W * 1.2; s.y = (Math.random() - 0.5) * H * 1.2; s.z = Math.random() * W; s.pz = s.z; };
  for (let i = 0; i < N; i++) { const s = {}; rs(s); stars.push(s); }
  let speed = 1.2, target = 0.5, mode = "idle", raf;  // calm drift while you decide; warp on book
  let yaw = 0, pitch = 0, tYaw = 0, tPitch = 0;       // drag to orbit the field in 3D
  const loop = () => {
    ctx.fillStyle = "rgba(6,4,15," + (mode === "warp" ? 0.2 : 0.36) + ")"; ctx.fillRect(0, 0, W, H);
    speed += (target - speed) * 0.06;
    if (mode === "idle" && target > 0.035) target *= 0.984;        // once you've arrived, the stars settle toward a halt
    yaw += (tYaw - yaw) * 0.08; pitch += (tPitch - pitch) * 0.08;  // ease toward where you dragged
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosX = Math.cos(pitch), sinX = Math.sin(pitch);
    const proj = (x, y, zRaw) => {                                 // rotate the point, then project (identity when yaw=pitch=0)
      const zc = zRaw - W / 2;
      const rx = x * cosY + zc * sinY, rz = -x * sinY + zc * cosY;
      const ry = y * cosX - rz * sinX, rz2 = y * sinX + rz * cosX;
      const z = Math.max(1, rz2 + W / 2), k = 140 / z;
      return [cx + rx * k, cy + ry * k, z];
    };
    for (const s of stars) {
      s.pz = s.z; s.z -= speed * (mode === "idle" ? 2.2 : 24); if (s.z < 1) { rs(s); s.pz = s.z; }
      const cur = proj(s.x, s.y, s.z), prev = proj(s.x, s.y, s.pz);
      const a = Math.min(1, Math.max(0, 1 - cur[2] / W) * 1.3), lw = Math.max(0.4, (1 - cur[2] / W) * 2.6);
      ctx.strokeStyle = "rgba(205,214,255," + a + ")"; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(cur[0], cur[1]); ctx.stroke();
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  const flash = root.querySelector(".lg-flash"), board = root.querySelector(".lg-board"),
    intro = root.querySelector(".lg-intro"), led = root.querySelector(".lg-ledger"), muteBtn = root.querySelector(".lg-mute");
  let booked = false;
  const bookTrip = () => {
    if (booked) return; booked = true;
    const calm = reduceMotion();                                 // seizure-safe path: no warp strobe, no flash, no whoosh
    board.classList.add("lg-hidden"); intro.classList.remove("lg-hidden");
    muteBtn.classList.remove("lg-hidden");                        // mute available the whole trip
    if (song) { try { song.currentTime = TRIP_SONG_START; } catch (e) {} song.volume = 0; song.play().then(() => fadeAudio(song, 0.45, 500)).catch(() => { song = null; }); }  // starts right now (preloaded), from 3s
    if (!calm) {
      mode = "warp"; target = 11;                                 // the slingshot — kick into the journey
      try { const warp = new Audio("av%20assets/warp.wav"); warp.volume = 0.5; warp.play().catch(() => {}); } catch (e) {}  // the whoosh
      setTimeout(() => flash.classList.add("on"), 1050);
    }
    setTimeout(() => {                                            // arrive: you're at your cache
      intro.classList.add("lg-hidden"); led.classList.remove("lg-hidden"); mode = "idle"; target = 0.5; flash.classList.remove("on");
      if (!calm && !(song && song.muted)) playApplause();         // the crowd cheers as you land

      const head = root.querySelector("#lgHeadline"), svg = root.querySelector("#lgConst");
      fetch("data/balances.json?t=" + Date.now()).then((r) => r.json()).then((d) => { head.innerHTML = "<b>" + fmtUSD(d.total != null ? d.total : (d.cash || 0)) + "</b><span>your cache, right now</span>"; }).catch(() => {});
      fetch("data/monthly.json?t=" + Date.now()).then((r) => r.json()).then((d) => buildConstellation(svg, (d.months || []).slice(-10))).catch(() => buildConstellation(svg, []));
      awardTripExp();                                             // every trip pays out EXP
      track("trip_booked", {});                                  // flagship action — booked a trip to the cache
      buildDash();                                                // light up the cockpit
    }, calm ? 700 : 1450);
  };
  const buildDash = () => {                                       // spaceship-cockpit readouts along the bottom
    const dash = root.querySelector("#lgDash");
    if (!dash) return;
    dash.innerHTML =
      '<button class="lg-bubble" data-k="sources" style="--c:' + lgPalette().sources + '">' +
        '<span class="lg-bub-ico">🛰</span>' +
        '<span class="lg-bub-val" id="lgBubSources">…</span>' +
        '<span class="lg-bub-lbl">data sources</span>' +
      "</button>";
    requestAnimationFrame(() => dash.classList.add("lg-dash-show"));
    const grab = (u) => fetch(u + "?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([grab("data/balances.json"), grab("data/toggl.json")]).then(([d, tg]) => {
      const orgs = {}; ((d && d.accounts) || []).forEach((a) => { orgs[a.org || "Bank"] = 1; });
      const count = Object.keys(orgs).length + ((tg && tg.updated) ? 1 : 0);   // {} for a missing file is truthy — see renderSources
      const el = root.querySelector("#lgBubSources"); if (el) el.textContent = count || "0";
    });
  };
  const awardTripExp = () => {
    const gained = 25;
    addExp(gained);                                              // actually banks it (persists + updates the top ⭐ EXP)
    logChar("trip", "Booked a trip to the cache · +" + gained + " EXP");
    const rw = root.querySelector("#lgReward");
    rw.innerHTML = '<span class="lg-rw-amt">+0</span>' +
      '<span class="lg-rw-lbl">EXP banked · <b>' + PROFILE_STATS.exp.toLocaleString() + '</b> total in your cache</span>' +
      '<span class="lg-rw-star">⭐</span>';
    rw.classList.remove("lg-hidden"); rw.classList.add("lg-rw-show");
    const amtEl = rw.querySelector(".lg-rw-amt"), t0 = performance.now();
    const countUp = () => {                                       // watch the points tick up
      const k = Math.min(1, (performance.now() - t0) / 800);
      amtEl.textContent = "+" + Math.round(k * gained);
      if (k < 1) requestAnimationFrame(countUp);
    };
    countUp();
  };
  const close = () => {
    cancelAnimationFrame(raf); window.removeEventListener("resize", size); document.removeEventListener("keydown", onKey);
    if (song) { const s = song; song = null; fadeAudio(s, 0, 450, () => { try { s.pause(); } catch (e) {} }); }
    root.remove();
  };
  muteBtn.addEventListener("click", () => {
    if (!song) return;
    song.muted = !song.muted;
    muteBtn.textContent = song.muted ? "🔇" : "🔊";
    muteBtn.classList.toggle("lg-muted", song.muted);
    muteBtn.title = song.muted ? "Unmute the music" : "Mute the music";
  });
  // click-drag to orbit the visualizer in 3D (empty space only — never on a control/the viz)
  let dragging = false, lastX = 0, lastY = 0;
  led.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, .lg-dash, #lgConst")) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY; led.classList.add("lg-dragging");
  });
  root.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tYaw += (e.clientX - lastX) * 0.005;
    tPitch = Math.max(-0.55, Math.min(0.55, tPitch + (e.clientY - lastY) * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = () => { dragging = false; led.classList.remove("lg-dragging"); };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  window.addEventListener("resize", size);
  document.addEventListener("keydown", onKey);
  root.querySelector(".lg-book").addEventListener("click", bookTrip);
  root.querySelector(".lg-cancel").addEventListener("click", close);
  root.querySelector(".lg-back").addEventListener("click", close);
}
// ── THE BASE — a full-screen base-builder view of your real life. Home Base is the
//    centerpiece: configure your household (people + pets + their upkeep) and it stays
//    coherent with your cache. Each building == a widget (two lenses, one truth). v1. ──
const HOMEBASE_KEY = "money.homebase";
// Inline fallback art for the "home-base" building (the skin loader tries skins/default first).
// currentColor tints the roof/flag/window to the app accent, so it themes.
const HOMEBASE_ART =
  '<svg viewBox="0 0 240 200" role="img" aria-label="building">' +
  '<polygon points="120,50 192,92 120,134 48,92" fill="currentColor"/>' +
  '<polygon points="48,92 120,134 120,184 48,142" fill="#e7ded0"/>' +
  '<polygon points="192,92 120,134 120,184 192,142" fill="#d8cfbd"/>' +
  '<polygon points="150,152 170,140 170,168 150,180" fill="#000" opacity="0.26"/></svg>';
function loadHomeBase() {
  try { const d = JSON.parse(localStorage.getItem(HOMEBASE_KEY) || "null"); if (d && Array.isArray(d.residents)) return { name: d.name || "Home Base", residents: d.residents }; } catch (e) {}
  return { name: "Home Base", residents: [{ name: "You", type: "adult", cost: 0 }] };
}
function saveHomeBase(d) { try { localStorage.setItem(HOMEBASE_KEY, JSON.stringify(d)); } catch (e) {} }
// Resolve a building's art from the active skin (skins/default/), inline fallback if unavailable.
async function skinArt(id) {
  try {
    const skin = await (await fetch("skins/default/skin.json")).json();
    const p = skin && skin.buildings && skin.buildings[id] && skin.buildings[id].art;
    if (p) { const svg = await (await fetch("skins/default/" + p)).text(); if (svg.indexOf("<svg") !== -1) return svg; }
  } catch (e) {}
  return id === "home-base" ? HOMEBASE_ART : "";
}
// The Base is a PEER view of the board (not an overlay): toggling it shows the base ground
// in place of the widget canvas while the dock + all chrome stay put. The dock's base pill flips it.
// ── Base building model: a base is a set of typed, positioned, titleable buildings ──
const BASE_KEY = "money.base";
const BLD_TYPES = [
  { id: "home", label: "Home Base", emoji: "🏠", color: "#7d6cf0" },   // purple
  { id: "income", label: "Income source", emoji: "💰", color: "#2ec16b" },   // green
  { id: "expense", label: "Expense", emoji: "💸", color: "#e0533d" },   // red
  { id: "group", label: "Group / district", emoji: "🏘️", color: "#d99a2b" },   // amber
];
function bldMeta(t) { return BLD_TYPES.find((x) => x.id === t) || BLD_TYPES[0]; }
function loadBase() {
  try { const d = JSON.parse(localStorage.getItem(BASE_KEY) || "null"); if (d && Array.isArray(d.buildings) && d.buildings.length) return d; } catch (e) {}
  const hb = loadHomeBase();  // migrate the old single Home Base into the new model
  return { buildings: [{ id: "home", type: "home", name: hb.name, x: 0, y: 0, residents: hb.residents }] };
}
function saveBase(d) { try { localStorage.setItem(BASE_KEY, JSON.stringify(d)); } catch (e) {} }

let _baseBuilt = false, _baseRefresh = function () {};
function buildBase() {
  if (_baseBuilt) return;
  _baseBuilt = true;
  const base = loadBase();
  const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString();
  const RES_TYPES = ["adult", "kid", "pet", "dog", "cat", "other"];
  let incomePerMonth = null, selected = null;

  const ground = document.createElement("div"); ground.id = "baseSpace"; ground.className = "base-space";
  ground.innerHTML =
    '<div class="base-ground" id="baseGround">' +
      '<div class="base-world" id="baseWorld"></div>' +
      '<div class="base-tools"><button class="base-tool primary" id="baseDaily"><i data-lucide="pencil-line"></i> Daily check-in</button>' +
        '<button class="base-tool" id="baseAdd"><i data-lucide="plus"></i> Building</button>' +
        '<button class="base-tool" id="baseAutofill"><i data-lucide="sparkles"></i> Auto-fill from cache</button></div>' +
      '<div class="base-hint" id="baseHint">tap a building to set it up · <b>+ Building</b> to place one · <b>' + (matchMedia("(hover: none)").matches ? "drag" : "WASD") + '</b> to pan</div>' +
    '</div>';
  document.body.appendChild(ground);
  const world = ground.querySelector("#baseWorld"), hint = ground.querySelector("#baseHint");

  const sheet = document.createElement("div"); sheet.id = "baseSheet"; sheet.className = "base-sheet base-hidden";
  sheet.innerHTML =
    '<div class="bs-head"><span class="bs-title" id="bsTitle"></span><button class="bs-close" aria-label="close">✕</button></div>' +
    '<div class="bs-scroll" id="bsScroll"></div>';
  document.body.appendChild(sheet);
  const scroll = sheet.querySelector("#bsScroll"), titleEl = sheet.querySelector("#bsTitle");
  const openSheet = () => sheet.classList.remove("base-hidden");
  const closeSheet = () => { sheet.classList.add("base-hidden"); selected = null; };
  sheet.querySelector(".bs-close").addEventListener("click", closeSheet);
  const persist = () => saveBase(base);

  let artSvg = HOMEBASE_ART;  // one fetch, reused for every building; color tints per type
  skinArt("home-base").then((svg) => { artSvg = svg; renderWorld(); });

  function bldBadge(b) {
    const c = (b.count || 1) > 1 ? " · " + b.count + " sources" : "";
    if (b.type === "home") return "upkeep " + money((b.residents || []).reduce((a, r) => a + (r.cost || 0), 0)) + "/mo";
    if (b.type === "income") return "+" + money(b.amount || 0) + "/mo" + c;
    if (b.type === "expense") return "−" + money(b.amount || 0) + "/mo" + c;
    return bldMeta(b.type).label;
  }
  function renderWorld() {
    world.innerHTML = "";
    base.buildings.forEach((b) => {
      const el = document.createElement("button");
      el.className = "base-bld"; el.dataset.id = b.id;
      el.style.left = "calc(50% + " + (b.x || 0) + "px)";
      el.style.top = "calc(50% + " + (b.y || 0) + "px)";
      el.style.color = bldMeta(b.type).color;
      el.style.setProperty("--bld-scale", Math.min(2.4, 1 + ((b.count || 1) - 1) * 0.3).toFixed(2));  // bigger when combined
      el.innerHTML = '<div class="bh-art">' + artSvg + "</div><div class=\"bh-name\">" + escapeHtml(b.name || "") + '</div><div class="bh-badge">' + escapeHtml(bldBadge(b)) + "</div>";
      attachDrag(el, b);
      world.appendChild(el);
    });
  }

  // drag to move a building; a tap (no real movement) opens it instead
  function attachDrag(el, b) {
    let sx = 0, sy = 0, bx = 0, by = 0, moved = false, dragging = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.stopPropagation();
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; bx = b.x || 0; by = b.y || 0;
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (moved) { b.x = Math.round(bx + dx); b.y = Math.round(by + dy); el.style.left = "calc(50% + " + b.x + "px)"; el.style.top = "calc(50% + " + b.y + "px)"; }
    });
    el.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch (er) {}
      if (moved) persist(); else openBuilding(b.id);
    });
    el.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });  // never let a building click trigger placement
  }
  function openBuilding(id) { const b = base.buildings.find((x) => x.id === id); if (!b) return; selected = id; paintSheet(b); openSheet(); }
  function calcHome(b) {
    const upEl = scroll.querySelector("#bsUp"); if (!upEl) return;
    const up = (b.residents || []).reduce((a, r) => a + (r.cost || 0), 0);
    upEl.textContent = money(up);
    const inEl = scroll.querySelector("#bsIn"), netEl = scroll.querySelector("#bsNet");
    if (incomePerMonth == null) { inEl.textContent = "—"; netEl.textContent = "—"; netEl.style.color = ""; return; }
    inEl.textContent = money(incomePerMonth);
    const net = incomePerMonth - up;
    netEl.textContent = (net >= 0 ? "+" : "") + money(net).replace("-", "");
    netEl.style.color = net >= 0 ? "#2ec16b" : "#e0533d";
  }
  function recomputeMerged(b) {
    if (b.members) { b.amount = b.members.reduce((a, m) => a + (m.amount || 0), 0); b.count = b.members.length; }
    const t = scroll.querySelector("#bsTotal");
    if (t) t.textContent = (b.type === "income" ? "+" : "−") + money(b.amount || 0) + "/mo";
  }
  function splitOut(b, i) {
    if (!b.members || !b.members[i]) return;
    const m = b.members.splice(i, 1)[0];
    base.buildings.push({ id: "b" + Date.now() + Math.floor(Math.random() * 1e5), type: b.type, name: m.name, x: (b.x || 0) + 120, y: (b.y || 0) + 70, amount: m.amount || 0 });
    if (b.members.length <= 1) { const last = b.members[0]; if (last) { b.name = last.name; b.amount = last.amount || 0; } delete b.members; b.count = 1; }
    else { b.amount = b.members.reduce((a, x) => a + (x.amount || 0), 0); b.count = b.members.length; }
    persist(); renderWorld(); paintSheet(b);
  }
  function paintSheet(b) {
    const meta = bldMeta(b.type);
    titleEl.textContent = meta.emoji + " " + (b.name || meta.label);
    let html =
      '<label class="bs-namerow"><span class="bs-namelbl">Name</span><input id="bsName" class="bs-name-in"></label>' +
      '<div class="bs-namerow"><span class="bs-namelbl">Type</span><select id="bsBldType" class="bs-name-in">' +
        BLD_TYPES.map((t) => '<option value="' + t.id + '"' + (t.id === b.type ? " selected" : "") + ">" + t.emoji + " " + t.label + "</option>").join("") + "</select></div>";
    if (b.type === "home") {
      html +=
        '<div class="bs-sec"><span>Household</span><button class="bs-add" id="bsAddRes">+ add</button></div>' +
        '<div class="bs-hint">everyone you provide for — people and pets — and what each costs you per month.</div>' +
        '<div id="bsResidents" class="bs-list"></div>' +
        '<div class="bs-totals">' +
          '<div class="bs-stat"><div class="bs-k">Monthly in</div><div class="bs-v" id="bsIn">—</div><div class="bs-note">from your cache</div></div>' +
          '<div class="bs-stat"><div class="bs-k">Household upkeep</div><div class="bs-v" id="bsUp">—</div><div class="bs-note">you set this</div></div>' +
          '<div class="bs-stat"><div class="bs-k">Left over</div><div class="bs-v" id="bsNet">—</div><div class="bs-note">in − upkeep</div></div>' +
        "</div>";
      const genSpend = loadLog().filter((e) => e && e.dest && e.dest.kind === "money" && !(e.dest.target || "") && (e.ts || "").slice(0, 7) === todayKey().slice(0, 7)).reduce((a, e) => a + (parseFloat(e.value) || 0), 0);
      if (genSpend) html += '<div class="bs-logged">📝 daily-logged spend this month (unassigned): <b>' + money(genSpend) + "</b> — route a Spend question at a building to file it there.</div>";
    } else if (b.type === "income" || b.type === "expense") {
      const isMerged = b.members && b.members.length > 1;
      if (isMerged) {
        html +=
          '<div class="bs-sec"><span>' + (b.type === "income" ? "Income sources" : "Expenses grouped here") + '</span>' +
            '<span class="bs-total" id="bsTotal">' + (b.type === "income" ? "+" : "−") + money(b.amount || 0) + "/mo</span></div>" +
          '<div class="bs-hint">the sources merged into this building — split any back out with ⤴.</div>' +
          '<div id="bsMembers" class="bs-list"></div>';
      } else {
        html +=
          '<label class="bs-namerow"><span class="bs-namelbl">' + (b.type === "income" ? "Monthly income" : "Monthly cost") + '</span>' +
          '<input id="bsAmount" class="bs-name-in" type="number" inputmode="decimal" value="' + (b.amount || 0) + '"></label>' +
          '<div class="bs-hint">' + (b.type === "income" ? "money this source brings in each month." : "what this costs you each month.") + "</div>";
      }
      const loggedMo = loadLog().filter((e) => e && e.dest && e.dest.kind === "money" && (e.dest.target || "") === b.name && (e.ts || "").slice(0, 7) === todayKey().slice(0, 7)).reduce((a, e) => a + (parseFloat(e.value) || 0), 0);
      if (loggedMo) html += '<div class="bs-logged">📝 logged this month via check-ins: <b>' + money(loggedMo) + "</b></div>";
      const others = base.buildings.filter((x) => x.type === b.type && x.id !== b.id);
      if (others.length) {
        html +=
          '<div class="bs-sec"><span>Combine</span></div>' +
          '<div class="bs-hint">merge another ' + (b.type === "income" ? "income source" : "expense") + ' into this to make one bigger building.</div>' +
          '<div class="bs-combine"><select id="bsMergeSel" class="bs-name-in">' +
            others.map((o) => '<option value="' + o.id + '">' + escapeHtml(o.name || "(unnamed)") + " · " + money(o.amount || 0) + "/mo</option>").join("") +
          '</select><button class="bs-add" id="bsMerge">Merge in</button></div>';
      }
    } else {
      html += '<div class="bs-hint">a district to group things under. (grouping tools coming soon.)</div>';
    }
    if (b.id !== "home") html += '<button class="bs-del" id="bsDel">Remove building</button>';
    html += '<div class="bs-coh">Every change here ripples the whole base — what’s in the game is real.</div>';
    scroll.innerHTML = html;

    const nameIn = scroll.querySelector("#bsName"); nameIn.value = b.name || "";
    nameIn.addEventListener("input", () => { b.name = nameIn.value; titleEl.textContent = meta.emoji + " " + (nameIn.value || meta.label); renderWorld(); persist(); });
    scroll.querySelector("#bsBldType").addEventListener("change", (e) => {
      b.type = e.target.value;
      if ((b.type === "income" || b.type === "expense") && b.amount == null) b.amount = 0;
      if (b.type === "home" && !b.residents) b.residents = [];
      persist(); renderWorld(); paintSheet(b);
    });
    if (b.type === "home") {
      const R = scroll.querySelector("#bsResidents");
      const renderRes = () => {
        R.innerHTML = "";
        b.residents.forEach((r, i) => {
          const row = document.createElement("div"); row.className = "bs-row";
          row.innerHTML =
            '<input class="bs-name" value="' + escapeHtml(r.name || "") + '" aria-label="name">' +
            '<select class="bs-type" aria-label="type">' + RES_TYPES.map((t) => '<option' + (t === r.type ? " selected" : "") + ">" + t + "</option>").join("") + "</select>" +
            '<input class="bs-cost" type="number" inputmode="decimal" value="' + (r.cost || 0) + '" aria-label="monthly cost">' +
            '<button class="bs-x" aria-label="remove">✕</button>';
          row.querySelector(".bs-name").addEventListener("input", (e) => { r.name = e.target.value; persist(); });
          row.querySelector(".bs-type").addEventListener("change", (e) => { r.type = e.target.value; persist(); });
          row.querySelector(".bs-cost").addEventListener("input", (e) => { r.cost = parseFloat(e.target.value) || 0; calcHome(b); renderWorld(); persist(); });
          row.querySelector(".bs-x").addEventListener("click", () => { b.residents.splice(i, 1); renderRes(); calcHome(b); renderWorld(); persist(); });
          R.appendChild(row);
        });
      };
      renderRes();
      scroll.querySelector("#bsAddRes").addEventListener("click", () => { b.residents.push({ name: "New", type: "adult", cost: 0 }); renderRes(); calcHome(b); renderWorld(); persist(); });
      calcHome(b);
    } else if (b.type === "income" || b.type === "expense") {
      const amountEl = scroll.querySelector("#bsAmount");
      if (amountEl) amountEl.addEventListener("input", (e) => { b.amount = parseFloat(e.target.value) || 0; renderWorld(); persist(); });
      const M = scroll.querySelector("#bsMembers");
      if (M) {
        const renderMembers = () => {
          M.innerHTML = "";
          b.members.forEach((m, i) => {
            const row = document.createElement("div"); row.className = "bs-row";
            row.innerHTML =
              '<input class="bs-name" value="' + escapeHtml(m.name || "") + '" aria-label="source name">' +
              '<input class="bs-cost" type="number" inputmode="decimal" value="' + (m.amount || 0) + '" aria-label="amount">' +
              '<button class="bs-x" title="split out into its own building" aria-label="split out">⤴</button>';
            row.querySelector(".bs-name").addEventListener("input", (e) => { m.name = e.target.value; renderWorld(); persist(); });
            row.querySelector(".bs-cost").addEventListener("input", (e) => { m.amount = parseFloat(e.target.value) || 0; recomputeMerged(b); renderWorld(); persist(); });
            row.querySelector(".bs-x").addEventListener("click", () => { splitOut(b, i); });
            M.appendChild(row);
          });
        };
        renderMembers();
      }
      const mergeBtn = scroll.querySelector("#bsMerge");
      if (mergeBtn) mergeBtn.addEventListener("click", () => {
        const other = base.buildings.find((x) => x.id === scroll.querySelector("#bsMergeSel").value);
        if (!other) return;
        const mine = (b.members && b.members.length) ? b.members : [{ name: b.name, amount: b.amount || 0 }];
        const theirs = (other.members && other.members.length) ? other.members : [{ name: other.name, amount: other.amount || 0 }];
        b.members = mine.concat(theirs);
        b.amount = b.members.reduce((a, m) => a + (m.amount || 0), 0);
        b.count = b.members.length;
        base.buildings = base.buildings.filter((x) => x.id !== other.id);
        persist(); renderWorld(); paintSheet(b);
      });
    }
    const del = scroll.querySelector("#bsDel");
    if (del) del.addEventListener("click", () => { base.buildings = base.buildings.filter((x) => x.id !== b.id); persist(); renderWorld(); closeSheet(); });
  }

  // ── placement: + Building → click the grid to drop one (banks +2 EXP) ──
  let placeMode = false, camX = 0, camY = 0;
  const setHint = () => { hint.innerHTML = placeMode ? "tap anywhere on the grid to place your building" : "tap a building to set it up · <b>+ Building</b> to place one · <b>" + (matchMedia("(hover: none)").matches ? "drag" : "WASD") + "</b> to pan"; };
  ground.querySelector("#baseDaily").addEventListener("click", (e) => { e.stopPropagation(); openDaily(); });
  ground.querySelector("#baseAdd").addEventListener("click", (e) => { e.stopPropagation(); placeMode = !placeMode; ground.classList.toggle("placing", placeMode); setHint(); });
  ground.addEventListener("click", (e) => {
    if (!placeMode) return;
    placeMode = false; ground.classList.remove("placing"); setHint();
    const b = { id: "b" + Date.now() + Math.floor(Math.random() * 1000), type: "income", name: "New building",
      x: Math.round(e.clientX - window.innerWidth / 2 - camX), y: Math.round(e.clientY - window.innerHeight / 2 - camY), amount: 0 };
    base.buildings.push(b); persist(); renderWorld();
    addExp(2);
    if (typeof expSpark === "function") try { expSpark(e.clientX, e.clientY, 2); } catch (er) {}
    if (typeof logChar === "function") try { logChar("build", "Placed a building · +2 EXP"); } catch (er) {}
    openBuilding(b.id);
  });

  // ── Auto-fill: read the real cache and build income + expense buildings from it.
  //    Income flows in from the left, expenses out to the right (ready for streets). ──
  function autofillFromCache() {
    hint.textContent = "reading your cache…";
    fetch("data/balances.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) { hint.textContent = "couldn't read your cache — is the app synced?"; return; }
      const mo = (amt, w) => Math.round((amt || 0) / (w || 30) * 30);   // window amount → monthly
      const pretty = (s) => (s || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).trim();
      const have = new Set(base.buildings.map((b) => b.type + "|" + (b.name || "").toLowerCase()));
      const rid = (p) => "b" + Date.now() + Math.floor(Math.random() * 1e5) + p;
      let added = 0;
      const iw = (d.income && d.income.window_days) || 30;
      let incs = ((d.income && d.income.sources) || []).slice();
      const tagged = incs.filter((s) => s.tagged); if (tagged.length) incs = tagged;
      incs = incs.slice(0, 6);
      incs.forEach((s, i) => {
        const name = pretty(s.source || s.key || "Income"), key = "income|" + name.toLowerCase();
        if (have.has(key)) return;
        base.buildings.push({ id: rid("i" + i), type: "income", name, x: -330, y: Math.round((i - (incs.length - 1) / 2) * 150), amount: mo(s.amount, iw) });
        have.add(key); added++;
      });
      const sw = (d.spending && d.spending.window_days) || 30;
      const exps = ((d.spending && d.spending.categories) || []).slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 6);
      exps.forEach((c, i) => {
        const name = pretty(c.key || "Expense"), key = "expense|" + name.toLowerCase();
        if (have.has(key)) return;
        base.buildings.push({ id: rid("e" + i), type: "expense", name, x: 330, y: Math.round((i - (exps.length - 1) / 2) * 150), amount: mo(c.amount, sw) });
        have.add(key); added++;
      });
      persist(); renderWorld();
      if (added) { addExp(2 * added); if (typeof logChar === "function") try { logChar("build", "Auto-filled " + added + " buildings from cache · +" + (2 * added) + " EXP"); } catch (er) {} }
      hint.textContent = added ? ("built " + added + " buildings from your cache · +" + (2 * added) + " EXP · rename or remove any of them") : "your cache buildings are already placed";
    }).catch(() => { hint.textContent = "couldn't read your cache."; });
  }
  ground.querySelector("#baseAutofill").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Build income + expense buildings from your cache?\n\nOne per income source + top spending category. You can rename, retype, or remove any of them.")) autofillFromCache();
  });

  _baseRefresh = function () {
    incomePerMonth = null;
    fetch("data/balances.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && d.income && typeof d.income.per_month === "number") {
        incomePerMonth = d.income.per_month;
        const b = base.buildings.find((x) => x.id === selected); if (b && b.type === "home") calcHome(b);
      }
    }).catch(() => {});
  };

  // ── WASD camera panning — drive around the base like an RTS ──
  let panRAF = 0;
  const keys = { w: false, a: false, s: false, d: false };
  const PAN = 9;  // px per frame while a key is held
  function panLoop() {
    let dx = 0, dy = 0;
    if (keys.w) dy += PAN; if (keys.s) dy -= PAN; if (keys.a) dx += PAN; if (keys.d) dx -= PAN;
    if (dx || dy) { camX += dx; camY += dy; world.style.transform = "translate(" + camX + "px," + camY + "px)"; }
    panRAF = (keys.w || keys.a || keys.s || keys.d) ? requestAnimationFrame(panLoop) : 0;
  }
  const isTyping = () => { const a = document.activeElement; return !!(a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA" || a.isContentEditable)); };
  document.addEventListener("keydown", (e) => {
    if (!baseInView() || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "w" || k === "a" || k === "s" || k === "d") {
      if (!keys[k]) { keys[k] = true; if (!panRAF) panRAF = requestAnimationFrame(panLoop); }
      e.preventDefault();
    }
  });
  document.addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); if (k in keys) keys[k] = false; });
  window.addEventListener("blur", () => { keys.w = keys.a = keys.s = keys.d = false; });  // don't get stuck panning

  renderWorld();
  if (typeof drawIcons === "function") try { drawIcons(); } catch (e) {}  // render the tool icons
}
function baseInView() { return document.body.classList.contains("view-base"); }
// The dock's view toggle: one pill whose icon IS the current view (house = Base, 2×2 grid = Widgets),
// plus the current view's name shown by the dock label.
function updateViewToggle() {
  const inBase = baseInView();
  const b = document.getElementById("baseBtn");
  if (b) {
    b.innerHTML = '<i data-lucide="' + (inBase ? "house" : "layout-grid") + '"></i>';
    b.title = inBase ? "switch to Widgets" : "switch to Base";
    if (typeof drawIcons === "function") try { drawIcons(); } catch (e) {}
  }
  const v = document.getElementById("dockView");
  if (v) v.textContent = "· " + (inBase ? "Base" : "Widgets");
}
function setBaseView(on) {
  buildBase();
  document.body.classList.toggle("view-base", on);
  updateViewToggle();
  if (on) { _baseRefresh(); }
  else { const s = document.getElementById("baseSheet"); if (s) s.classList.add("base-hidden"); const h = document.getElementById("baseHint"); if (h) h.style.opacity = ""; }
}
function toggleBaseView() { setBaseView(!baseInView()); }
(function () { const b = document.getElementById("baseBtn"); if (b) b.addEventListener("click", toggleBaseView); })();
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !baseInView()) return;
  const s = document.getElementById("baseSheet");
  if (s && !s.classList.contains("base-hidden")) { s.classList.add("base-hidden"); const h = document.getElementById("baseHint"); if (h) h.style.opacity = ""; }
  else setBaseView(false);
});

// ── Daily check-in — a customizable deck of "log items" you design. Each item asks a
//    question (chunky input) and routes its answer into a cache store (money / health /
//    tracker / day-log), so logging once feeds the whole base. This is the data-entry engine.
//    NORTH-STAR: dest.kind "health" entries are the raw feed for the EF-energy-variability
//    metric (see Working Docs/3_ROADMAP.md) — recalculate_health() reads them later. ──
const DECK_KEY = "money.deck", LOG_KEY = "money.log";
const DEFAULT_DECK = [
  { id: "meals", emoji: "🍳", prompt: "How did you eat today?", input: "choice",
    options: [["🍳", "Cooked"], ["🍔", "Ate out"], ["🥡", "Both"]], dest: { kind: "dayflag", target: "meals" } },
  { id: "spend", emoji: "💸", prompt: "Spend anything today?", input: "amount", dest: { kind: "money", target: "" } },
  { id: "energy", emoji: "⚡", prompt: "How's your energy right now?", input: "scale",
    hint: "No wrong answer — Cache learns your pattern so you can plan around it.",
    options: [["🪫", "Drained", 1], ["😮‍💨", "Low", 2], ["🔋", "OK", 3], ["✨", "Good", 4], ["⚡", "Charged", 5]],
    dest: { kind: "health", target: "energy" } },
];
const DAILY_FUNNIES = ["your cache thanks you 🙏", "skeletons: mildly less scary 💀", "another brick in the base 🧱",
  "your cache is proud of you ✨", "data so fresh it squeaks ✨", "high-res life unlocked 📈", "fed and watered 🌱"];
// ── Deck sync: PER-ITEM merge, not whole-document last-writer-wins ──────────
// The deck used to be one blob stamped with a client Date.now(): whoever saved last
// won the WHOLE deck. That meant an open editor could persist its stale copy over a
// question another device had just added, a fresh device's default deck could
// steamroll a customized one, and a fast clock won forever.
//
// Now each item carries its own stamps and merges independently:
//   updated — the CONTENT stamp (excludes ord). Set at the point of edit, never
//             re-derived, so a stale in-memory item keeps its OLD stamp and loses.
//   ordAt   — the POSITION stamp, merged separately, so a reorder can never
//             outrank someone else's text edit.
//   deleted — a TOMBSTONE. Deleting keeps the item (hidden) so the delete survives a
//             union with a device that still has it, instead of being resurrected.
// Anything equal to a shipped default stamps updated:0 — shipping code must never
// win a merge (the same rule the rest of the sync engine follows).
const DECK_LIVE_CAP = 60, DECK_TOMB_CAP = 60;
function deckNow() { return Date.now(); }
// canonical CONTENT form — excludes the stamps, sorted keys, so JS and Python agree
// byte-for-byte. Compared as a STRING (never hashed): a djb2 would have to match
// across three runtimes with int32 wraparound, which is a mismatch waiting to happen.
function deckCanon(it) {
  const skip = { updated: 1, ord: 1, ordAt: 1 };
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach((k) => { if (!skip[k]) o[k] = walk(v[k]); }); return o; }
    return v;
  };
  try { return JSON.stringify(walk(it || {})); } catch (e) { return ""; }
}
function deckIsDefault(it) {
  if (!it || !it.id) return false;
  const d = DEFAULT_DECK.find((q) => q.id === it.id);
  return !!d && deckCanon(d) === deckCanon(it);
}
// Merge two decks per item. Winner per id: newer `updated`; on an EXACT tie a
// tombstone wins (a card you killed coming back is the trust break — a card you have
// to re-add is a shrug); still tied → canonical-content compare, so every runtime
// picks the same side. Position merges on its own clock.
function mergeDecks(a, b) {
  const out = {};
  const take = (arr) => (Array.isArray(arr) ? arr : []).forEach((raw) => {
    if (!raw || !raw.id) return;
    const it = Object.assign({}, raw);
    const cur = out[it.id];
    if (!cur) { out[it.id] = it; return; }
    const cu = +cur.updated || 0, iu = +it.updated || 0;
    let win = cur;
    if (iu > cu) win = it;
    else if (iu === cu) {
      const cd = !!cur.deleted, id_ = !!it.deleted;
      if (id_ !== cd) win = id_ ? it : cur;                      // tombstone wins an exact tie
      else if (deckCanon(it) > deckCanon(cur)) win = it;          // deterministic on every runtime
    }
    const lose = win === cur ? it : cur;
    const merged = Object.assign({}, win);
    // position is its OWN field with its OWN clock — a reorder must never revert a text edit
    if ((+lose.ordAt || 0) > (+win.ordAt || 0)) { merged.ord = lose.ord; merged.ordAt = lose.ordAt; }
    out[it.id] = merged;
  });
  take(a); take(b);
  const items = Object.keys(out).map((k) => out[k]);
  items.sort((x, y) => {
    const dx = +x.ord || 0, dy = +y.ord || 0;
    return dx !== dy ? dx - dy : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  });
  return deckCap(items);
}
// Cap LIVE items and tombstones SEPARATELY. A single slice over a mixed array would
// silently drop real questions off the end, or drop tombstones (so deletes resurrect).
function deckCap(items) {
  const live = items.filter((i) => !i.deleted).slice(0, DECK_LIVE_CAP);
  const tomb = items.filter((i) => i.deleted).sort((a, b) => (+b.updated || 0) - (+a.updated || 0)).slice(0, DECK_TOMB_CAP);
  return live.concat(tomb);
}
function deckLive(items) { return (items || []).filter((i) => i && !i.deleted); }
// One-time migration off the old whole-document format.
function deckMigrate(items) {
  const out = (items || []).filter((i) => i && i.id).map((raw, idx) => {
    const it = Object.assign({}, raw);
    if (it.updated == null) it.updated = deckIsDefault(it) ? 0 : 1;   // a customization must beat an untouched default
    if (it.ord == null) it.ord = idx;
    if (it.ordAt == null) it.ordAt = 0;
    return it;
  });
  // Deletion used to be expressed by ABSENCE. Without this, the first merge with a
  // peer that still holds the card would resurrect every default the user ever killed.
  const have = {}; out.forEach((i) => { have[i.id] = 1; });
  DEFAULT_DECK.forEach((d, i) => {
    if (!have[d.id]) out.push({ id: d.id, deleted: 1, updated: 1, ord: 900 + i, ordAt: 0 });
  });
  return out;
}
function putDeck(items) {   // write VERBATIM — preserves every stamp. Adoption paths use this and NEVER stamp.
  try { localStorage.setItem(DECK_KEY, JSON.stringify(deckCap(items || []))); } catch (e) {}
  try { document.dispatchEvent(new CustomEvent("cache:deck")); } catch (e) {}   // an open editor re-reads
}
function loadDeck() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DECK_KEY) || "null"); } catch (e) {}
  if (Array.isArray(d) && d.length) {
    const needsMigrate = d.some((q) => q && q.updated == null);
    if (needsMigrate) { d = deckMigrate(d); putDeck(d); try { localStorage.removeItem(DECKREV_KEY); } catch (e) {} }
    // one-time upgrade: an UNTOUCHED old energy default (3-point → tracker) becomes the
    // 5-point → health version. A deck the user customized is left exactly as they made it.
    const i = d.findIndex((q) => q && q.id === "energy" && q.dest && q.dest.kind === "tracker" && q.dest.target === "Energy" && (q.options || []).length === 3);
    if (i !== -1) {
      const fresh = JSON.parse(JSON.stringify(DEFAULT_DECK.find((q) => q.id === "energy")));
      d[i] = Object.assign(fresh, { ord: d[i].ord, ordAt: d[i].ordAt || 0, updated: 0 });   // a DEFAULT — stamp 0, never Date.now(), or a mere page load would steamroll the account
      putDeck(d);
    }
    return d;
  }
  // fresh device: materialize the defaults at updated:0 so they can be ADDED where
  // absent but can never outrank another device's customization or tombstone
  return DEFAULT_DECK.map((q, i) => Object.assign(JSON.parse(JSON.stringify(q)), { ord: i, ordAt: 0, updated: 0 }));
}
// The USER-EDIT path. Merges into what is stored (so a question another device added
// while this array was held survives) but NEVER stamps — the editor stamps the item it
// actually touched. Re-deriving "what changed" here is what let a stale editor revert
// a remote edit and resurrect a remote delete.
function saveDeck(d) {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(DECK_KEY) || "[]") || []; } catch (e) {}
  putDeck(mergeDecks(stored, d));
  ckPushDeckSoon();
}

// ── THE DECK, fully realized — money.things ──────────────────────────────────────────
// Routines / tasks / subtasks / habits / fields, per the signed-off data-model spec
// (2026-07-14, hardened by a 4-agent adversarial review). Every object is a FLAT,
// id-keyed, first-class item that merges INDEPENDENTLY; structure is a PARENT-ID
// REFERENCE, never containment — nesting would let whole-document last-writer-wins sneak
// back in (phone checks off subtask A, desktop renames subtask B, both save the parent
// task, per-item merge sees one id, one edit is silently gone).
//
// VAULT-ONLY, merged by the two JS runtimes ONLY (app.js + webcache.js) — deliberately
// NOT routed through store.py. Python serializes 72.0 where JS writes 72, and native `>`
// picks OPPOSITE winners on emoji (UTF-16 code-unit vs code-point order) — and emoji is a
// required field. Two byte-identical JS runtimes can't fork; a Python third runtime with
// those two latent bugs would. If a server feature ever needs Things, its merge is added
// THEN, with the unicode/float fixes.
//
// Reuses the deck's proven per-item algorithm with two spec changes: a SYMMETRIC ord
// tie-break (§6) and NO live cap (§5 — live structure is durable, never an ephemeral card).
const THINGS_KEY = "money.things";
// A stable, globally-unique id, minted ONCE and NEVER changed: base36 time + a 4-char
// device fingerprint + 6 chars of entropy. NOT Date.now()+small-random, which two devices
// can collide on in the same millisecond — and an id collision silently FUSES two
// different objects into one, destroying data. An id that changed on edit would read as a
// delete + a new object.
function thingId() {
  const d = (typeof devId === "function" ? devId() : "") || "";
  let r = ""; while (r.length < 6) r += Math.random().toString(36).slice(2);
  return "t" + Date.now().toString(36) + "-" + (d + "xxxx").slice(0, 4) + "-" + r.slice(0, 6);
}
// canonical CONTENT form — excludes the stamps (updated/ord/ordAt), sorts keys, normalizes
// booleans to 0|1 (a stray true/false can never fork the tie-break), emits as a STRING.
// Compared as a string, never hashed — a djb2 would have to agree across runtimes' int math.
function thingCanon(it) {
  const skip = { updated: 1, ord: 1, ordAt: 1 };
  const walk = (v) => {
    if (v === true) return 1; if (v === false) return 0;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach((k) => { if (!skip[k]) o[k] = walk(v[k]); }); return o; }
    return v;
  };
  try { return JSON.stringify(walk(it || {})); } catch (e) { return ""; }
}
// Merge two Thing arrays per id. Winner: newer `updated` → exact tie: tombstone wins →
// still tied: canonical-content STRING compare (deterministic on every runtime). Position
// (`ord`/`ordAt`) merges on its OWN clock so a drag never reverts a text edit.
function mergeThings(a, b) {
  const out = {};
  const take = (arr) => (Array.isArray(arr) ? arr : []).forEach((raw) => {
    if (!raw || !raw.id) return;
    const it = Object.assign({}, raw);
    const cur = out[it.id];
    if (!cur) { out[it.id] = it; return; }
    const cu = +cur.updated || 0, iu = +it.updated || 0;
    let win = cur;
    if (iu > cu) win = it;
    else if (iu === cu) {
      const cd = !!cur.deleted, id_ = !!it.deleted;
      if (id_ !== cd) win = id_ ? it : cur;                      // tombstone wins an exact tie
      else if (thingCanon(it) > thingCanon(cur)) win = it;       // deterministic on every runtime
    }
    const lose = win === cur ? it : cur;
    const merged = Object.assign({}, win);
    // position is its OWN field on its OWN clock. SYMMETRIC tie-break: newer ordAt wins;
    // on an EQUAL ordAt with differing ord the SMALLER ord wins regardless of which side is
    // `win`, so two devices that reordered the same item concurrently converge in one pass
    // instead of each keeping its own (whole-document LWW sneaking back through position).
    const lo = +lose.ordAt || 0, wo = +win.ordAt || 0;
    if (lo > wo || (lo === wo && (+lose.ord || 0) < (+win.ord || 0))) { merged.ord = lose.ord; merged.ordAt = lose.ordAt; }
    out[it.id] = merged;
  });
  take(a); take(b);
  const items = Object.keys(out).map((k) => out[k]);
  // stable global sort (by ord, then id). `ord` is scoped to the sibling group; rendering
  // re-groups by parent/routine, so a single global storage order is fine.
  items.sort((x, y) => {
    const dx = +x.ord || 0, dy = +y.ord || 0;
    return dx !== dy ? dx - dy : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  });
  return items;   // NO cap — live structure is durable; tombstones are GC'd by age only (uncapped in v1)
}
function thingsLive(items) { return (items || []).filter((i) => i && !i.deleted); }
// Read-time LIVENESS filter — render a Thing only if its WHOLE ancestor chain (following
// BOTH parent and routine) is live; a missing/absent referenced id is treated as deleted
// (hidden, never resurrected). A pure read filter, identical in both JS runtimes, so it
// can't diverge at merge time. Depth-capped against reference cycles.
function thingsVisible(items) {
  const by = {}; (items || []).forEach((i) => { if (i && i.id) by[i.id] = i; });
  const liveChain = (it) => {
    let cur = it, depth = 0;
    while (cur && depth++ < 64) {
      if (cur.deleted) return false;
      const pid = cur.parent || cur.routine;
      if (!pid) return true;
      cur = by[pid];
      if (!cur) return false;   // dangling ref → treat as deleted (hidden, not resurrected)
    }
    return true;   // cycle → depth-capped; treat as visible rather than hang
  };
  return (items || []).filter((i) => i && i.id && !i.deleted && liveChain(i));
}
// Cascade delete — stamp a fresh tombstone (deleted:1, updated:now) on the container AND
// every descendant (walk parent + routine) at delete time. Each object's death is
// self-contained: no tombstone's meaning depends on another item still existing, so a
// GC'd ancestor can never resurrect or orphan a subtree. Mirrors how delete_txn keeps the
// whole txn in its tombstone.
function thingsCascadeDelete(items, id, now) {
  now = now || Date.now();
  const list = (items || []).slice();
  const kids = {};   // parentId → [childId]
  list.forEach((i) => { if (!i || !i.id) return; const p = i.parent || i.routine; if (p) (kids[p] = kids[p] || []).push(i.id); });
  const doomed = {}; const stack = [id];
  while (stack.length) { const cur = stack.pop(); if (doomed[cur]) continue; doomed[cur] = 1; (kids[cur] || []).forEach((k) => stack.push(k)); }
  return list.map((i) => (i && i.id && doomed[i.id]) ? Object.assign({}, i, { deleted: 1, updated: now }) : i);
}
function loadThings() { try { return JSON.parse(localStorage.getItem(THINGS_KEY) || "[]") || []; } catch (e) { return []; } }
// write VERBATIM — every adoption path uses this and NEVER restamps, or two devices bump
// each other's stamps forever. (mergeThings with an empty second arg just dedups + sorts.)
function putThings(items) {
  try { localStorage.setItem(THINGS_KEY, JSON.stringify(mergeThings(items || [], []))); } catch (e) {}
  try { document.dispatchEvent(new CustomEvent("cache:things")); } catch (e) {}
}
// the USER-EDIT path — merges into what's stored (so a Thing another device added while
// this array was held survives) but NEVER stamps; the editor stamps the item it touched.
// Vault-only, so it arms the encrypted push — no server call (unlike saveDeck).
function saveThings(items) {
  let stored = []; try { stored = JSON.parse(localStorage.getItem(THINGS_KEY) || "[]") || []; } catch (e) {}
  putThings(mergeThings(stored, items));
  try { if (typeof autoPushSoon === "function") autoPushSoon(); } catch (e) {}
}

// ── FORMS — build-your-own data-intake templates + their submissions ─────────────────
// money.forms = TEMPLATES (a form is ONE merge unit; its `fields` array travels WITH it,
// exactly like a deck question carries its `options` — the spec's "never nest" rule forbids
// separately-mergeable children stored nested, not a payload that moves as one). money.formData
// = SUBMISSIONS. Both are per-item id-keyed arrays that REUSE money.things' proven merge
// VERBATIM (mergeThings/thingCanon) — one algorithm, so there is NO new cross-runtime fork
// surface to keep byte-identical (the whole reason the deck/things pulled store.py out of the
// loop). VAULT-ONLY, JS-merged (app.js + webcache.js), NEVER store.py — same float/emoji rule.
//
//   form: { id, type:"form", name, emoji, updated, ord, ordAt, deleted:0|1, dated:0|1,
//           fields:[ {id, label, ftype, area, target, unit, options} ] }
//     ftype ∈ text|number|dollar|date|choice|yesno|notes|scale|count|duration (the deck input vocab)
//     area  = a TD_AREAS name (routing destination); target = money-building / health sub-target
//   submission: { id, type:"formsub", formId, date:"YYYY-MM-DD", updated, ord, ordAt,
//                 deleted:0|1, values:[ {fieldId, value} ] }
//
// Every id (form, submission, AND field) is minted ONCE and never changes — per-item merge is
// id-based. So IF fields ever need concurrent per-field editing across devices, they can be
// promoted to flat parent-referenced items (the things pattern) with NO data migration.
const FORMS_KEY = "money.forms", FORMDATA_KEY = "money.formData";
const FORM_FTYPES = ["text", "number", "dollar", "date", "choice", "yesno", "notes", "scale", "count", "duration"];
function _mintId(prefix) {
  const d = (typeof devId === "function" ? devId() : "") || "";
  let r = ""; while (r.length < 6) r += Math.random().toString(36).slice(2);
  return prefix + Date.now().toString(36) + "-" + (d + "xxxx").slice(0, 4) + "-" + r.slice(0, 6);
}
function formId() { return _mintId("f"); }
function formSubId() { return _mintId("fd"); }
function fieldId() { return _mintId("ff"); }
function loadForms() { try { return JSON.parse(localStorage.getItem(FORMS_KEY) || "[]") || []; } catch (e) { return []; } }
function loadFormData() { try { return JSON.parse(localStorage.getItem(FORMDATA_KEY) || "[]") || []; } catch (e) { return []; } }
function formsLive(items) { return (items || []).filter((i) => i && !i.deleted); }
function formDataLive(items) { return (items || []).filter((i) => i && !i.deleted); }
function formById(id) { return loadForms().find((f) => f && f.id === id) || null; }
// write VERBATIM (mergeThings with [] just dedups + sorts) — adoption paths never restamp.
function putForms(items) { try { localStorage.setItem(FORMS_KEY, JSON.stringify(mergeThings(items || [], []))); } catch (e) {} try { document.dispatchEvent(new CustomEvent("cache:forms")); } catch (e) {} }
function putFormData(items) { try { localStorage.setItem(FORMDATA_KEY, JSON.stringify(mergeThings(items || [], []))); } catch (e) {} try { document.dispatchEvent(new CustomEvent("cache:formdata")); } catch (e) {} }
// USER-EDIT path — merge into what's stored (so a peer's concurrent add survives) but NEVER
// stamp; the caller stamps the item it actually touched (updated: Date.now()) at the edit.
// Vault-only, so it arms the encrypted push — no server call.
function saveForms(items) { let s = []; try { s = JSON.parse(localStorage.getItem(FORMS_KEY) || "[]") || []; } catch (e) {} putForms(mergeThings(s, items)); try { if (typeof autoPushSoon === "function") autoPushSoon(); } catch (e) {} }
function saveFormData(items) { let s = []; try { s = JSON.parse(localStorage.getItem(FORMDATA_KEY) || "[]") || []; } catch (e) {} putFormData(mergeThings(s, items)); try { if (typeof autoPushSoon === "function") autoPushSoon(); } catch (e) {} }

// ── Document → template: parse an uploaded artifact into a DRAFT form ─────────────────
// The doc only SEEDS the schema — the user always lands in the editor to confirm before it
// saves (deterministic; confirm-before-commit). These are PURE (no DOM, no app helpers) so
// the test harness can exercise them directly.
//
// A tiny RFC-4180-ish CSV splitter (none existed client-side — bank CSVs parse server-side).
// Handles quoted fields, "" escaped quotes, and commas / newlines inside quotes, plus CRLF.
function parseCsvRows(text) {
  const s = String(text == null ? "" : text);
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') { q = true; }
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && String(r[0]).trim() === ""));   // drop blank rows
}
// Best-guess a field type from one sample cell (used for CSV columns and label examples).
function inferFtype(sample) {
  const v = String(sample == null ? "" : sample).trim();
  if (!v) return "text";
  if (/^-?\$\s?\d[\d,]*(\.\d+)?$/.test(v) || /^-?\d[\d,]*\.\d{2}$/.test(v)) return "dollar";
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) return "date";
  if (/^-?\d[\d,]*(\.\d+)?$/.test(v)) return "number";
  if (/^(yes|no|y|n|true|false)$/i.test(v)) return "yesno";
  return "text";
}
// CSV → { template, rows }. Header row → one field each; type inferred from the first data
// row; a column with few distinct values across the data becomes a choice. `rows` (the data
// rows) is handed back so a later brick can turn each row into a submission.
function csvToTemplate(text, name) {
  const rows = parseCsvRows(text);
  if (!rows.length) return null;
  const headers = rows[0].map((h) => String(h == null ? "" : h).trim());
  const data = rows.slice(1), sample = data[0] || [];
  const distinct = headers.map(() => ({}));
  data.forEach((r) => r.forEach((c, i) => { const t = String(c == null ? "" : c).trim(); if (t && distinct[i]) distinct[i][t] = 1; }));
  const fields = headers.map((h, i) => {
    const vals = Object.keys(distinct[i] || {});
    let ftype = inferFtype(sample[i]), options;
    if (ftype === "text" && vals.length && vals.length <= 6 && data.length > 3) { ftype = "choice"; options = vals.slice(0, 6); }
    const f = { id: fieldId(), label: h || ("Field " + (i + 1)), ftype: ftype, area: "" };
    if (options) f.options = options;
    return f;
  });
  return { template: { id: formId(), type: "form", name: name || "Imported form", emoji: "📋", dated: 0, fields: fields, updated: 0, ord: 0, ordAt: 0 }, rows: data };
}
// Plain text (a pasted Q&A / label / checklist list) → { template }. One field per line:
//   "Label: example"  → field, type inferred from the example
//   "Question?"       → notes field
//   "[ ] Did X" / "- item" → yes/no field
//   a "(1-5)" / "/10" hint anywhere → scale field
function textToTemplate(text, name) {
  const lines = String(text == null ? "" : text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  const scaleRe = /\(?\b1\s*[-–]\s*(?:5|10)\b\)?|\/\s*(?:5|10)\b/;   // "(1-5)", "1-10", "/10"
  const fields = [];
  lines.forEach((line) => {
    const stripped = line.replace(/^([-*•]|\d+[.)])\s+/, "");
    const wasBullet = stripped !== line;
    let label = stripped, ftype = "notes", m;
    // scale hint FIRST — so a dash inside "(1-5)" is never mistaken for a label separator
    if (scaleRe.test(stripped)) { ftype = "scale"; label = stripped.replace(/\s*\(?\b1\s*[-–]\s*(?:5|10)\b\)?/, "").replace(/\s*\/\s*(?:5|10)\b/, "").trim() || stripped; }
    else if (/^\[.?\]/.test(stripped)) { label = stripped.replace(/^\[.?\]\s*/, ""); ftype = "yesno"; }
    // "Label: value" (tight colon) or "Label – value" (dash only when space-surrounded, so
    // "1-5" and "co-op" never split); the example seeds the type.
    else if ((m = stripped.match(/^(.+?)(?:\s*[:：]\s*|\s+[-–]\s+)(.+)$/))) { label = m[1].trim(); ftype = inferFtype(m[2].trim()); if (ftype === "text") ftype = "notes"; }
    else if (/\?\s*$/.test(stripped)) { label = stripped; ftype = "notes"; }
    else if (wasBullet) { label = stripped; ftype = "yesno"; }
    if (label) fields.push({ id: fieldId(), label: label, ftype: ftype, area: "" });
  });
  if (!fields.length) return null;
  return { template: { id: formId(), type: "form", name: name || "Imported form", emoji: "📝", dated: 0, fields: fields, updated: 0, ord: 0, ordAt: 0 } };
}

// ── Thing EVENTS → the check-in log (§4) ─────────────────────────────────────────────
// Completions, habit occurrences, and field values are NOT stored on the Thing — they are
// append-only LOG events. Why: a `done` flag never resets, so it can't express "checked
// EVERY morning" for a recurring item, and resetting it would mutate the template and fight
// the merge. So "done today" is DERIVED from the log per (item, day). The log is the ONE
// source of truth for events; it round-trips through store.py's checkin-log.jsonl, whose
// whitelist was grown to carry root/kind/field (a field not on that whitelist is silently
// dropped on the first sync). `done`/`doneAt` ON the object are valid ONLY for a true one-off
// task (routine==null, no schedule); everything recurring derives from here.
//
// Entry: { ts:<device-local day>, at:<ms, monotonic per itemId>, itemId, root:<top-level id>,
//          kind:"done"|"undone"|"habit"|"fieldval"|"fielddel", value:<any>, field:<id|null> }.
// `root` is DENORMALIZED at write time so a task's activity trail is a flat filter (root==T)
// that survives an interior subtask being deleted or GC'd — no graph walk to sever.

// monotonic `at` per itemId — dedup is by (at,itemId), so two toggles of ONE item in the
// same millisecond would collide and the second would be silently dropped. Bump past the
// item's latest logged `at` so every toggle survives (the audit trail keeps them all).
function _thingEventAt(itemId, log) {
  const now = Date.now(); let max = 0;
  (log || []).forEach((e) => { if (e && e.itemId === itemId && (+e.at || 0) > max) max = +e.at; });
  return now > max ? now : max + 1;
}
// resolve a Thing's top-level ancestor id (walk parent → routine), depth-capped for cycles.
function thingRoot(items, id) {
  const by = {}; (items || []).forEach((i) => { if (i && i.id) by[i.id] = i; });
  let cur = by[id], depth = 0;
  while (cur && depth++ < 64) {
    const pid = cur.parent || cur.routine;
    if (!pid || !by[pid]) return cur.id;   // top-level, or chain broken → the deepest resolvable id
    cur = by[pid];
  }
  return id;
}
// Append a Thing event to the log and push it to the cache (same path as a check-in answer:
// offline it queues in money.logPending and retries, never lost). Returns the entry.
function logThingEvent(itemId, kind, opts) {
  opts = opts || {};
  const items = opts.items || loadThings();
  const log = loadLog();
  const entry = { ts: opts.ts || todayKey(), at: _thingEventAt(itemId, log), itemId: itemId,
                  root: opts.root || thingRoot(items, itemId), kind: kind };
  if (opts.value !== undefined) entry.value = opts.value;
  if (opts.field !== undefined) entry.field = opts.field;
  log.push(entry);
  if (saveLog(log)) { try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {} ckPush([entry]); }
  return entry;
}
// The LATEST log entry for (itemId, day) by `at` — the single winner the derives read.
function thingDayEntry(log, itemId, day) {
  let best = null;
  (log || []).forEach((e) => { if (e && e.itemId === itemId && e.ts === day && (!best || (+e.at || 0) > (+best.at || 0))) best = e; });
  return best;
}
// Derived "done today" for a recurring item = latest entry for (itemId, day); kind:"undone"
// un-checks. Multiple toggles all survive in the log (audit); the derive is latest-wins.
function thingDoneOn(log, itemId, day) {
  const e = thingDayEntry(log, itemId, day);
  return !!(e && e.kind !== "undone" && e.kind !== "fielddel");
}
// An amount habit's value for a day = the latest entry's value, NOT a sum of the day's
// entries (editing a reading logs a new entry; summing would double-count).
function thingAmountOn(log, itemId, day) {
  const e = thingDayEntry(log, itemId, day);
  return e && e.kind !== "undone" ? e.value : null;
}
// Activity trail for a task/routine T = every log entry with root==T, oldest→newest.
// Reconstructable from the LOG ALONE (no graph walk), so a deleted interior subtask can't
// sever it.
function thingTrail(log, rootId) {
  return (log || []).filter((e) => e && e.root === rootId).sort((a, b) => (+a.at || 0) - (+b.at || 0));
}
// Field values over time = kind:"fieldval" entries for that field, one per day (latest per
// (field,day) wins), oldest→newest; a fielddel tombstone removes that day. So fields are
// editable, not write-only.
function fieldValues(log, fieldId) {
  const byDay = {};
  (log || []).forEach((e) => {
    if (!e || e.field !== fieldId || (e.kind !== "fieldval" && e.kind !== "fielddel")) return;
    const cur = byDay[e.ts];
    if (!cur || (+e.at || 0) > (+cur.at || 0)) byDay[e.ts] = e;
  });
  return Object.keys(byDay).map((d) => byDay[d]).filter((e) => e.kind === "fieldval")
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

// ── Routine recurrence engine (§3 sched) — PURE: is a routine scheduled for a given local
//    day? Daily (every N days), weekly (days-of-week, every N weeks), monthly (days-of-month
//    OR nth-weekday), yearly (month/day), honoring start/end and pause. "Due today" is the
//    VIEWING device's local day; a member's completion stays LOG-derived per (member, day).
function _ymd2date(ymd) { const p = String(ymd || "").split("-"); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
function _weekStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); }
function _nthWeekdayOfMonth(d, nth, weekday) {
  if (d.getDay() !== weekday) return false;
  const dom = d.getDate();
  if (nth === -1) return new Date(d.getFullYear(), d.getMonth(), dom + 7).getMonth() !== d.getMonth();   // the LAST such weekday
  return Math.floor((dom - 1) / 7) + 1 === nth;
}
function routineDueOn(sched, ymd) {
  if (!sched) return true;                        // no schedule → always available
  if (sched.paused) return false;
  const d = _ymd2date(ymd); if (!d) return false;
  if (sched.start && ymd < sched.start) return false;
  if (sched.end && ymd > sched.end) return false;
  const every = Math.max(1, +sched.every || 1), freq = sched.freq || "daily", start = sched.start ? _ymd2date(sched.start) : d;
  if (freq === "daily") { if (every === 1) return true; const n = Math.round((d - start) / 86400000); return n >= 0 && n % every === 0; }
  if (freq === "weekly") {
    const dow = d.getDay(), days = (Array.isArray(sched.days) && sched.days.length) ? sched.days : [dow];
    if (days.indexOf(dow) === -1) return false;
    if (every === 1) return true;
    const wk = Math.round((_weekStart(d) - _weekStart(start)) / 604800000); return wk >= 0 && wk % every === 0;
  }
  if (freq === "monthly") {
    if (Array.isArray(sched.monthly) && sched.monthly.length) return sched.monthly.indexOf(d.getDate()) !== -1;
    if (sched.monthly && sched.monthly.weekday != null) return _nthWeekdayOfMonth(d, sched.monthly.nth, sched.monthly.weekday);
    return d.getDate() === start.getDate();
  }
  if (freq === "yearly") { const y = sched.yearly || { month: start.getMonth() + 1, day: start.getDate() }; return (d.getMonth() + 1) === +y.month && d.getDate() === +y.day; }
  return true;
}
// ── Calendar occurrence EXPANSION (Brick 0) — the calendar's recurrence spine. routineDueOn
//    is a per-DAY predicate; a calendar needs every day in a visible window a routine (or a
//    recurring event) lands on. So we DRIVE the pure predicate across the range — never
//    reimplement recurrence. Local-day throughout (matches the engine's local-midnight parse),
//    bounded + capped so a runaway range can't hang a render. All pure: same JS-only ethos as
//    routineDueOn, so it can't fork across runtimes.
function ymdOf(date) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }
// every "YYYY-MM-DD" from startYmd..endYmd inclusive (local days). `new Date(y,m,d+1)` rolls
// month/year over automatically, so short months / year boundaries just work. Capped (default
// 400 ≈ a year + a month grid's overflow) so a bad range can't loop away.
function calDaysInRange(startYmd, endYmd, cap) {
  const s = _ymd2date(startYmd), e = _ymd2date(endYmd); if (!s || !e) return [];
  cap = cap || 400; const out = [];
  let d = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  while (d <= e && out.length < cap) { out.push(ymdOf(d)); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
  return out;
}
// the days in [startYmd, endYmd] a schedule is due — routineDueOn per day. O(range); a month
// grid (≤42 days) × N recurring things is trivial. A null sched (a plain always-available
// routine) is due every day in range — the same contract routineDueOn(null) gives.
function calOccurrencesInRange(sched, startYmd, endYmd, cap) {
  return calDaysInRange(startYmd, endYmd, cap).filter((ymd) => routineDueOn(sched, ymd));
}
function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") || []; } catch (e) { return []; } }
function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l)); return true; } catch (e) { return false; } }
function todayKey() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// ── check-in sync — browser storage is the fast cache; the SERVER files are the shared
//    truth (data/checkin-log.jsonl + checkin-deck.json), so phone and desktop converge on
//    one log and one deck, and answers ride real backups + the encrypted vault. Answers
//    that can't reach the server queue in money.logPending and retry on the next sync.
//    Offline, the demo, and the hosted read-only app all degrade gracefully to local-only. ──
const LOGPEND_KEY = "money.logPending", DECKREV_KEY = "money.deckRev";
const ckKey = (e) => (e.at || 0) + "|" + (e.itemId || "");
function ckPending() { try { return JSON.parse(localStorage.getItem(LOGPEND_KEY) || "[]") || []; } catch (e) { return []; } }
function ckSetPending(l) { try { localStorage.setItem(LOGPEND_KEY, JSON.stringify(l.slice(-500))); } catch (e) {} }
function ckPush(entries) {
  if (!entries || !entries.length) return Promise.resolve(true);
  return fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) })
    .then((r) => { if (!r.ok) throw new Error("offline"); return r.json(); })
    .then(() => true)
    .catch(() => {   // couldn't reach the cache — keep the answers safe and retry later
      const p = ckPending(), have = new Set(p.map(ckKey));
      entries.forEach((e) => { if (!have.has(ckKey(e))) p.push(e); });
      ckSetPending(p);
      return false;
    });
}
let _deckPushT = null;
function ckPushDeckSoon() {
  // debounced — the deck editor saves on every keystroke; the server needs one write, not fifty
  clearTimeout(_deckPushT);
  _deckPushT = setTimeout(() => {
    // v:2 — per-item merge on the server. No whole-document rev: each item carries its
    // own `updated`, so an older device can no longer replace the entire deck.
    fetch("/api/checkin-deck", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 2, items: loadDeck() }) }).catch(() => {});
    autoPushSoon();
  }, 1200);
}
let _ckSyncing = false;
function ckSync() {
  if (_ckSyncing) return; _ckSyncing = true;
  const pend = ckPending();
  (pend.length ? ckPush(pend).then((ok) => { if (ok) ckSetPending([]); }) : Promise.resolve())
    .then(() => fetch("/api/checkin-log").then((r) => { if (!r.ok) throw new Error("offline"); return r.json(); }))
    .then((d) => {
      const server = (d && d.log) || [], local = loadLog();
      const sHave = new Set(server.map(ckKey)), lHave = new Set(local.map(ckKey));
      const toServer = local.filter((e) => !sHave.has(ckKey(e)));
      const toLocal = server.filter((e) => !lHave.has(ckKey(e)));
      if (toServer.length) ckPush(toServer);
      if (toLocal.length) {
        const merged = local.concat(toLocal);
        merged.sort((a, b) => (a.at || 0) - (b.at || 0));
        if (saveLog(merged)) try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {}
      }
    })
    .catch(() => {})
    .then(() => fetch("/api/checkin-deck").then((r) => { if (!r.ok) throw new Error("offline"); return r.json(); }))
    .then((d) => {
      const srv = (d && d.deck) || {};
      if (Array.isArray(srv.items)) {
        let loc = []; try { loc = JSON.parse(localStorage.getItem(DECK_KEY) || "[]") || []; } catch (e) {}
        const merged = mergeDecks(loc, srv.items);
        const before = JSON.stringify(loc), after = JSON.stringify(merged);
        if (after !== before) putDeck(merged);                  // adopt VERBATIM — never restamp what we adopt
        if (after !== JSON.stringify(srv.items)) ckPushDeckSoon();   // we hold something the server lacks
      }
    })
    .catch(() => {})
    .then(() => { _ckSyncing = false; }, () => { _ckSyncing = false; });
}
function dailyBurst(host, x, y) {
  if (reduceMotion()) return;
  const C = ["#ff3b30", "#ff9500", "#ffcc00", "#2ec16b", "#0a84ff", "#7d6cf0", "#ff6bd6"];
  for (let n = 0; n < 32; n++) {
    const p = document.createElement("span"); const em = n % 6 === 0;
    p.textContent = em ? "✨" : "";
    p.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;pointer-events:none;font-size:18px;" + (em ? "" : "width:9px;height:9px;border-radius:50%;background:" + C[n % C.length] + ";");
    host.appendChild(p);
    const a = (Math.PI * 2 * n) / 32 + Math.random() * 0.5, d = 70 + Math.random() * 120;
    p.animate([{ transform: "translate(-50%,-50%)", opacity: 1 }, { transform: "translate(-50%,-50%) translate(" + Math.cos(a) * d + "px," + (Math.sin(a) * d - 30) + "px) scale(.3) rotate(" + (Math.random() * 540 - 270) + "deg)", opacity: 0 }], { duration: 800 + Math.random() * 350, easing: "cubic-bezier(.16,.8,.3,1)" });
  }
}
function buildDailyInput(holder, it, onAnswer) {
  const t = it.input, opts = it.options && it.options.length ? it.options : null;
  let locked = false;  // one-shot: a rendered question can only be answered once (kills double-tap corruption)
  const answer = (v) => { if (locked) return; locked = true; onAnswer(v); };
  const tap = (v) => { if (locked) return; locked = true; setTimeout(() => onAnswer(v), 110); };
  const focusIn = (sel) => { const inp = holder.querySelector(sel); if (inp) requestAnimationFrame(() => { try { inp.focus(); inp.scrollIntoView({ block: "center" }); } catch (e) {} }); };
  if (t === "choice" || t === "scale") {
    const list = opts || [["✅", "Yes"], ["🚫", "No"]];
    // an option can be [emoji, label] or [emoji, label, value] — when a value exists (e.g. the
    // 1–5 energy scale) THAT is what gets logged, so pattern math gets numbers, not words.
    holder.innerHTML = '<div class="daily-opts">' + list.map((o, ix) => { const em = Array.isArray(o) ? o[0] : "", lb = Array.isArray(o) ? o[1] : o; return '<button class="daily-btn" data-i="' + ix + '">' + (em ? '<span class="e">' + em + "</span>" : "") + "<span>" + escapeHtml(lb) + "</span></button>"; }).join("") + "</div>";
    holder.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { const o = list[parseInt(b.dataset.i, 10)]; const lb = Array.isArray(o) ? o[1] : o; tap(Array.isArray(o) && o[2] !== undefined ? o[2] : lb); }));
  } else if (t === "yesno") {
    holder.innerHTML = '<div class="daily-opts"><button class="daily-btn" data-v="yes"><span class="e">✅</span><span>Yes</span></button><button class="daily-btn" data-v="no"><span class="e">🚫</span><span>No</span></button></div>';
    holder.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => tap(b.dataset.v)));
  } else if (t === "amount") {
    holder.innerHTML = '<button class="daily-none" data-v="0">🎉 None today</button><div class="daily-chips">' + ["5", "10", "20", "40", "75"].map((c) => '<button class="daily-chip" data-v="' + c + '">$' + c + "</button>").join("") + '<button class="daily-chip" data-v="__other">Other</button></div>';
    holder.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.v === "__other") { holder.innerHTML = '<input class="daily-note" id="dcAmt" type="number" inputmode="decimal" placeholder="amount…"><button class="daily-cta" id="dcGo">Next</button>'; holder.querySelector("#dcGo").addEventListener("click", () => answer(parseFloat(holder.querySelector("#dcAmt").value) || 0)); focusIn("#dcAmt"); return; }
      tap(parseFloat(b.dataset.v) || 0);
    }));
  } else if (t === "count") {
    let n = 0; holder.innerHTML = '<div class="daily-stepper"><button class="daily-step" data-d="-1">−</button><span class="daily-num" id="dcN">0</span><button class="daily-step" data-d="1">+</button></div><button class="daily-cta" id="dcGo">Next</button>';
    holder.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => { n = Math.max(0, n + parseInt(b.dataset.d, 10)); holder.querySelector("#dcN").textContent = n; }));
    holder.querySelector("#dcGo").addEventListener("click", () => answer(n));
  } else if (t === "duration") {
    holder.innerHTML = '<button class="daily-none" data-v="0">😌 None</button><div class="daily-chips">' + ["1", "2", "3", "4", "6", "8"].map((c) => '<button class="daily-chip" data-v="' + c + '">' + c + "h</button>").join("") + "</div>";
    holder.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => tap(parseFloat(b.dataset.v) || 0)));
  } else {
    holder.innerHTML = '<input class="daily-note" id="dcNote" placeholder="type a note…"><button class="daily-cta" id="dcGo">Next</button>';
    holder.querySelector("#dcGo").addEventListener("click", () => answer(holder.querySelector("#dcNote").value));
    focusIn("#dcNote");
  }
}
function openDaily() {
  if (document.getElementById("dailySpace")) return;
  const deck = deckLive(loadDeck());
  const root = document.createElement("div"); root.id = "dailySpace"; root.className = "daily-space";
  root.innerHTML =
    '<div class="daily-top"><button class="daily-icn" id="dailyClose" aria-label="close">✕</button>' +
      '<div class="daily-dots" id="dailyDots"></div>' +
      '<button class="daily-icn" id="dailyGear" aria-label="customize" title="customize your deck">⚙</button></div>' +
    '<div class="daily-stage" id="dailyStage"></div>';
  document.body.appendChild(root);
  const stage = root.querySelector("#dailyStage"), dotsEl = root.querySelector("#dailyDots");
  let i = 0, done = false; const answers = [];
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); };
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  root.querySelector("#dailyClose").addEventListener("click", close);
  root.querySelector("#dailyGear").addEventListener("click", () => { close(); openDeckEditor(); });
  function dots() { dotsEl.innerHTML = ""; for (let s = 0; s < deck.length; s++) { const d = document.createElement("span"); d.className = "daily-dot" + (s < i ? " done" : (s === i && !done ? " on" : "")); dotsEl.appendChild(d); } }
  function advance(v) { if (done) return; answers.push({ item: deck[i], value: v }); i++; if (i >= deck.length) finish(); else render(); }
  function render() {
    if (!deck.length) { finish(); return; }
    dots();
    const it = deck[i];
    const body = document.createElement("div"); body.className = "daily-body daily-in";
    body.innerHTML = '<div class="daily-q">' + escapeHtml(it.prompt || "") + "</div>" +
      (it.hint ? '<div class="daily-hint">' + escapeHtml(it.hint) + "</div>" : "");
    const holder = document.createElement("div"); holder.className = "daily-input"; body.appendChild(holder);
    buildDailyInput(holder, it, advance);
    stage.innerHTML = ""; stage.appendChild(body);
  }
  function finish() {
    done = true; dots();
    const day = todayKey(), log = loadLog(), now = Date.now(), fresh = [];
    answers.forEach((a) => { if (a.value === undefined || a.value === null || a.value === "") return; const entry = { ts: day, at: now, itemId: a.item.id, prompt: a.item.prompt, input: a.item.input, value: a.value, dest: a.item.dest || null }; log.push(entry); fresh.push(entry); });
    const ok = saveLog(log);
    const b = document.createElement("div"); b.className = "daily-body daily-in daily-done";
    if (!ok) {   // storage full / write failed — DON'T claim success or award EXP
      b.innerHTML = '<div class="daily-emoji">😬</div><div class="daily-big">Couldn’t save</div>' +
        '<div class="daily-funny">your browser storage looks full — nothing was logged. Free up space and try again.</div>' +
        '<button class="daily-cta" id="dailyDone">Close</button>';
      stage.innerHTML = ""; stage.appendChild(b);
      b.querySelector("#dailyDone").addEventListener("click", close);
      return;
    }
    const gained = answers.filter((a) => a.value !== undefined && a.value !== null && a.value !== "").length * 2;
    if (gained) addExp(gained);
    if (typeof logChar === "function") try { logChar("log", "Daily check-in · +" + gained + " EXP"); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {}   // live-refresh any widget reading the log (Energy pattern, etc.)
    ckPush(fresh);   // answers flow to the cache itself — offline they queue and retry, never lost
    // energy-pattern receipt: show how many distinct days of health data exist, so the user
    // SEES the pattern building (the point of logging) instead of answers vanishing into a void.
    let hLine = "";
    try { if (answers.some((a) => a.item && a.item.dest && a.item.dest.kind === "health")) { const s = new Set(); log.forEach((e) => { if (e && e.dest && e.dest.kind === "health") s.add(e.ts); }); if (s.size) hLine = '<div class="daily-health">⚡ energy pattern: ' + s.size + (s.size === 1 ? " day" : " days") + " logged</div>"; } } catch (e) {}
    b.innerHTML = '<div id="dailyDone" class="daily-emoji">✨</div><div class="daily-big">Logged!</div>' +
      '<div id="dailyExp" class="daily-exp">+0 EXP</div><div class="daily-funny">' + DAILY_FUNNIES[Math.floor(Math.random() * DAILY_FUNNIES.length)] + "</div>" + hLine +
      '<button class="daily-cta" id="dailyDone">Done</button>';
    stage.innerHTML = ""; stage.appendChild(b);
    const r = stage.getBoundingClientRect(); dailyBurst(stage, r.width / 2, r.height * 0.36);
    const pop = b.querySelector("#dailyDone"); if (!reduceMotion()) pop.animate([{ transform: "scale(.4) rotate(-12deg)" }, { transform: "scale(1.15) rotate(6deg)" }, { transform: "scale(1)" }], { duration: 600, easing: "cubic-bezier(.2,1.3,.4,1)" });
    const expEl = b.querySelector("#dailyExp"); let v = 0; const iv = setInterval(() => { v++; expEl.textContent = "+" + v + " EXP"; if (v >= gained) { expEl.textContent = "+" + gained + " EXP"; clearInterval(iv); } }, 42); if (gained === 0) { expEl.textContent = "+0 EXP"; clearInterval(iv); }
    b.querySelector("#dailyDone").addEventListener("click", close);
  }
  render();
}
function openDeckEditor() {
  if (document.getElementById("deckEditor")) return;
  const deck = loadDeck();
  const root = document.createElement("div"); root.id = "deckEditor"; root.className = "daily-space deck-editor";
  root.innerHTML =
    '<div class="daily-top"><div class="deck-title">Customize your daily deck</div><button class="daily-cta sm" id="deckClose">Done</button></div>' +
    '<div class="deck-help">Every answer saves where you point it: 🩺 Health builds your energy pattern · 💰 Money lands on your money · 📈 Tracker counts anything · 📅 Day-log just remembers the day.</div>' +
    '<div class="deck-scroll" id="deckList"></div>' +
    '<div class="deck-foot"><button class="daily-cta ghost" id="deckAdd">＋ Add a question</button><button class="daily-cta" id="deckRun">▶ Run check-in</button></div>';
  document.body.appendChild(root);
  const listEl = root.querySelector("#deckList");
  const INPUTS = ["choice", "scale", "yesno", "amount", "count", "duration", "note"];
  const bldNames = (function () { try { return (loadBase().buildings || []).map((b) => b.name).filter(Boolean); } catch (e) { return []; } })();
  const persist = () => saveDeck(deck);
  const optStr = (o) => (!o || !o.length) ? "" : o.map((x) => Array.isArray(x) ? x[1] : x).join(", ");
  const parseOpts = (s) => s.split(",").map((x) => x.trim()).filter(Boolean).map((lb) => ["", lb]);
  // drag-to-reorder by the grip handle — pointer events so it works on touch + mouse
  function attachRowDrag(row) {
    const grip = row.querySelector(".deck-grip"); if (!grip) return;
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      row.classList.add("dragging");
      try { grip.setPointerCapture(e.pointerId); } catch (er) {}
      const move = (ev) => {
        const rows = [...listEl.querySelectorAll(".deck-row")];
        for (const r of rows) {
          if (r === row) continue;
          const rect = r.getBoundingClientRect();
          if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
            listEl.insertBefore(row, ev.clientY < rect.top + rect.height / 2 ? r : r.nextSibling);
            break;
          }
        }
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        row.classList.remove("dragging");
        // Only the DRAGGED item moves: give it a fractional ord midway between its new
        // neighbours and stamp ordAt. Renumbering every item (the old way) would mark
        // the whole deck as edited and steamroll anyone else's concurrent text edit —
        // whole-document last-writer-wins sneaking back in through position.
        const rows = [...listEl.querySelectorAll(".deck-row")];
        const at = rows.indexOf(row);
        const prev = at > 0 ? rows[at - 1].__item : null;
        const next = at < rows.length - 1 ? rows[at + 1].__item : null;
        const po = prev ? (+prev.ord || 0) : null, no = next ? (+next.ord || 0) : null;
        let nord;
        if (po == null && no == null) nord = 0;
        else if (po == null) nord = no - 1;
        else if (no == null) nord = po + 1;
        else nord = (po + no) / 2;
        const item = row.__item;
        if (item) { item.ord = nord; item.ordAt = deckNow(); }
        // float gaps eventually underflow — renormalise (positions only, no content stamps)
        if (prev && next && Math.abs(no - po) < 1e-6) {
          deckLive(deck).sort((a, b) => (+a.ord || 0) - (+b.ord || 0)).forEach((x, i) => { x.ord = i; x.ordAt = deckNow(); });
        }
        persist(); render();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);   // interrupted drag still commits + re-syncs
    });
  }
  function render() {
    listEl.innerHTML = "";
    deckLive(deck).forEach((it, idx) => {   // tombstones stay in the array, hidden
      const row = document.createElement("div"); row.className = "deck-row";
      row.innerHTML =
        '<div class="deck-row-top"><button class="deck-grip" aria-label="drag to reorder">⠿</button>' +
          '<input class="deck-emoji" value="' + escapeHtml(it.emoji || "📝") + '" maxlength="4" aria-label="emoji">' +
          '<input class="deck-prompt" value="' + escapeHtml(it.prompt || "") + '" placeholder="your question">' +
          '<button class="deck-del" aria-label="remove">✕</button></div>' +
        '<div class="deck-row-cfg">' +
          '<label>Answer<select class="deck-input">' + INPUTS.map((t) => "<option" + (t === it.input ? " selected" : "") + ">" + t + "</option>").join("") + "</select></label>" +
          '<label>Area<select class="deck-kind"><option value=""' + (!deckDestToArea(it.dest) ? " selected" : "") + ">—</option>" + TD_AREAS.map((a) => '<option value="' + escapeHtml(a[1]) + '"' + (deckDestToArea(it.dest) === a[1] ? " selected" : "") + ">" + a[0] + " " + escapeHtml(a[1]) + "</option>").join("") + "</select></label>" +
          (deckDestToArea(it.dest) === "Money" ? '<label class="deck-target">Building<input class="deck-tgt" value="' + escapeHtml((it.dest && it.dest.target) || "") + '" placeholder="e.g. Groceries" list="deckBldNames"></label>' : "") + "</div>" +
        ((it.input === "choice" || it.input === "scale") ? '<div class="deck-row-cfg"><label class="deck-optlbl">Buttons<input class="deck-opts" value="' + escapeHtml(optStr(it.options)) + '" placeholder="Cooked, Ate out, Both"></label></div>' : "");
      // stamp AT THE POINT OF EDIT — the item the user actually touched. Deriving
      // "what changed" inside the save would make this stale array authoritative for
      // every item another device changed underneath it (reverting their edit, and
      // resurrecting their delete). Only the touched item gets a fresh stamp.
      const touch = () => { it.updated = deckNow(); persist(); };
      row.querySelector(".deck-emoji").addEventListener("input", (e) => { it.emoji = e.target.value; touch(); });
      row.querySelector(".deck-prompt").addEventListener("input", (e) => { it.prompt = e.target.value; touch(); });
      row.querySelector(".deck-input").addEventListener("change", (e) => { it.input = e.target.value; touch(); render(); });
      row.querySelector(".deck-kind").addEventListener("change", (e) => { it.dest = e.target.value ? deckAreaToDest(e.target.value, it.dest) : { kind: "area", target: "" }; touch(); render(); });   // 12-area vocabulary, shared with the card sheet
      const tgt = row.querySelector(".deck-tgt"); if (tgt) tgt.addEventListener("input", (e) => { it.dest = it.dest || {}; it.dest.target = e.target.value; touch(); });
      const oi = row.querySelector(".deck-opts"); if (oi) oi.addEventListener("input", (e) => { it.options = parseOpts(e.target.value); touch(); });
      row.__item = it;
      // delete leaves a TOMBSTONE. Removing the item outright would let any device
      // that still holds it re-add it on the next union — "the question I killed
      // keeps coming back" is the trust break we're here to prevent.
      row.querySelector(".deck-del").addEventListener("click", () => {
        it.deleted = 1; it.updated = deckNow(); persist(); render();
      });
      attachRowDrag(row);
      listEl.appendChild(row);
    });
    if (!document.getElementById("deckBldNames")) { const dl = document.createElement("datalist"); dl.id = "deckBldNames"; dl.innerHTML = bldNames.map((n) => '<option value="' + escapeHtml(n) + '">').join(""); root.appendChild(dl); }
  }
  root.querySelector("#deckAdd").addEventListener("click", () => {
    // the id must be unique ACROSS DEVICES: under a per-item union, two devices minting
    // the same id in the same millisecond would silently fuse two different questions
    const id = "q" + Date.now().toString(36) + "-" + String(devId()).slice(0, 4) + "-" + Math.random().toString(36).slice(2, 8);
    const last = deckLive(deck).slice(-1)[0];
    deck.push({ id: id, emoji: "📝", prompt: "New question", input: "choice", options: [["👍", "Yes"], ["👎", "No"]],
      dest: { kind: "dayflag", target: "" }, ord: (last ? (+last.ord || 0) : 0) + 1, ordAt: deckNow(), updated: deckNow() });
    persist(); render();
  });
  root.querySelector("#deckClose").addEventListener("click", () => { document.removeEventListener("cache:deck", onDeckChange); root.remove(); });
  root.querySelector("#deckRun").addEventListener("click", () => { document.removeEventListener("cache:deck", onDeckChange); root.remove(); openDaily(); });
  // another device's edit landed while this editor is open — re-read and repaint, so
  // the user is never typing over text they can't see (and can't overwrite it blind)
  function onDeckChange() {
    if (!root.isConnected) { document.removeEventListener("cache:deck", onDeckChange); return; }
    if (root.contains(document.activeElement)) return;   // don't yank the field they're typing in
    const fresh = loadDeck();
    deck.length = 0; fresh.forEach((x) => deck.push(x));
    render();
  }
  document.addEventListener("cache:deck", onDeckChange);
  render();
}
// ── The deck coach: a one-time card that installs the habit (when you open
//    your cache → tap the deck). Anchored above the action button, one job. ──
const DECKCOACH_KEY = "money.deckCoach";
function showDeckCoach() {
  try { if (localStorage.getItem(DECKCOACH_KEY)) return; } catch (e) { return; }
  if (document.querySelector(".deck-coach")) return;
  const card = document.createElement("div");
  card.className = "deck-coach";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "The deck");
  card.innerHTML =
    '<h3>🃏 The deck</h3>' +
    '<p>Your day, one card at a time. <b>When you open your cache, tap the deck.</b> One minute — that’s the whole job.</p>' +
    '<div class="dc-row"><button class="dc-open" type="button">Open the deck</button><button class="dc-later" type="button">got it</button></div>';
  document.body.appendChild(card);
  const pill = document.getElementById("dailyBtn");
  if (pill && !reduceMotion()) pill.classList.add("coaching");
  // Aim the card + its tail at the REAL deck button. The dock is ONE centered bar of
  // pills, so the + sits LEFT of screen-center on desktop — the old fixed left:50%
  // parked the tail over a neighbour pill (VISIT) instead of the deck. Measure the
  // button, center the card on it (clamped on-screen), and offset the tail to match.
  const anchorCoach = () => {
    if (!pill) return;
    const r = pill.getBoundingClientRect();
    if (!r.width || !r.height) return;   // hidden/not laid out yet — keep the CSS default
    const cx = r.left + r.width / 2, margin = 8;
    card.style.bottom = Math.max(12, window.innerHeight - r.top + 12) + "px";
    const cw = card.getBoundingClientRect().width;
    const leftPx = Math.max(margin, Math.min(cx - cw / 2, window.innerWidth - cw - margin));
    card.style.left = leftPx + "px";
    card.style.transform = "none";
    card.style.setProperty("--tail-x", Math.max(12, Math.min(cx - leftPx, cw - 12)) + "px");
  };
  anchorCoach();
  window.addEventListener("resize", anchorCoach);
  const done = () => {
    try { localStorage.setItem(DECKCOACH_KEY, String(Date.now())); } catch (e) {}
    if (pill) pill.classList.remove("coaching");
    window.removeEventListener("resize", anchorCoach);
    card.remove();
  };
  card.querySelector(".dc-open").addEventListener("click", () => { done(); openDeck(); });
  card.querySelector(".dc-later").addEventListener("click", done);
}
// ── The DECK is a DATE-DEPENDENT scroller (Cozy 2026-07-15). Which day the deck is showing is
//    per-DEVICE and SILOED — money.deckDay is DEVICE_LOCAL (never rides the vault), so each
//    device keeps its own place and the UI can be customized per device. It restores the EXACT
//    last-viewed day on reopen (defaults to today when unset/invalid). Completion travels with
//    the DAY, not the habit: reads + writes key off deckViewDay(), and the completion log is
//    already day-keyed, so scrolling to another day shows THAT day's history. `cache:deckday`
//    is the change signal the deck body + the task/habit renderer listen for.
const DECKDAY_KEY = "money.deckDay";
function deckViewDay() {
  let v = null; try { v = localStorage.getItem(DECKDAY_KEY); } catch (e) {}
  return (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : todayKey();
}
function setDeckViewDay(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) ymd = todayKey();
  try { localStorage.setItem(DECKDAY_KEY, ymd); } catch (e) {}                                   // persist immediately (per-device)
  try { document.dispatchEvent(new CustomEvent("cache:deckday", { detail: { ymd: ymd } })); } catch (e) {}
}
// The satisfying day SCROLLWHEEL at the bottom of the deck — yesterday / today / tomorrow sit
// as the primary three, snap-centered; scroll (or ‹ ›, or tap a day) to travel through recent
// days. The centered day is the selected day. Commits on settle (so the body doesn't thrash
// mid-scroll); a live highlight tracks the finger. Built ONCE per open so the scroll position
// is the user's to keep — selection updates a class, never a rebuild.
function renderDeckDayWheel(host) {
  if (!host) return;
  const BACK = 45, FWD = 14;                          // recent-days emphasis (a bit of runway forward)
  const t0 = _ymd2date(todayKey()) || new Date(), sel = deckViewDay(), cells = [];
  for (let i = -BACK; i <= FWD; i++) {
    const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i), ymd = ymdOf(d), isToday = i === 0;
    const rel = i === 0 ? "Today" : i === -1 ? "Yesterday" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
    cells.push('<button class="deck-day' + (ymd === sel ? " on" : "") + (isToday ? " istoday" : "") + '" data-ymd="' + ymd + '" role="tab" aria-selected="' + (ymd === sel ? "true" : "false") + '">' +
      '<span class="deck-day-rel">' + rel + "</span>" +
      '<span class="deck-day-num">' + d.getDate() + "</span>" +
      '<span class="deck-day-mon">' + d.toLocaleDateString("en-US", { month: "short" }) + "</span>" +
      "</button>");
  }
  host.innerHTML =
    '<button class="deck-wheel-nav" id="deckWheelPrev" aria-label="previous day">‹</button>' +
    '<div class="deck-wheel" id="deckWheel" role="tablist" aria-label="pick a day">' + cells.join("") + "</div>" +
    '<button class="deck-wheel-nav" id="deckWheelNext" aria-label="next day">›</button>' +
    '<button class="deck-today-jump" id="deckTodayJump" aria-label="back to today">Today</button>';
  const wheel = host.querySelector("#deckWheel"), dayCells = Array.prototype.slice.call(wheel.querySelectorAll(".deck-day"));
  const centerOf = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
  // POSITIONING must be truly instant: the wheel's CSS scroll-behavior is smooth, and
  // scrollTo(behavior:"auto") DEFERS to CSS — so the open-center was a slow animated scroll
  // from 0 that the very next layout pass (fonts/icons/the .on scale) cancelled a few px in.
  // The wheel then sat at the range start, and the settle-commit below adopted that day —
  // a first open could silently select a day ~6 weeks in the past. Force instant here.
  const centerCell = (el, smooth) => {
    if (!el) return;
    // Rect-based, never offsetLeft: the wheel isn't positioned, so a chip's offsetParent is the
    // DAYBAR — offsetLeft carried a constant +~52px bias (bar padding + ‹ nav + gap) that
    // mandatory snap rounded to the NEIGHBOR chip: taps committed the wrong day, ‹ looked dead,
    // › skipped a day. Rects measure true geometry (and .on's scale transform is center-anchored).
    const wr = wheel.getBoundingClientRect(), cr = el.getBoundingClientRect();
    const left = wheel.scrollLeft + (cr.left + cr.width / 2) - (wr.left + wr.width / 2);
    if (smooth) { wheel.scrollTo({ left: left, behavior: "smooth" }); return; }
    const prev = wheel.style.scrollBehavior;
    wheel.style.scrollBehavior = "auto";
    wheel.scrollTo({ left: left, behavior: "auto" });
    wheel.style.scrollBehavior = prev;
  };
  // The wheel's CSS padding is calc(50% - 30px) — but %-padding on a flex item resolves against
  // the DAYBAR, not the wheel, so the row always overflowed by ~28px and the › button hung off
  // the right screen edge. Resolve the padding in real pixels from the wheel's actual width.
  const padWheel = () => {
    wheel.style.paddingLeft = wheel.style.paddingRight = "0px";
    const w = wheel.getBoundingClientRect().width;
    const pad = Math.max(0, Math.round(w / 2 - 30));
    wheel.style.paddingLeft = wheel.style.paddingRight = pad + "px";
  };
  const nearest = () => { const wr = wheel.getBoundingClientRect(), cx = wr.left + wr.width / 2; let best = null, bd = Infinity; dayCells.forEach((c) => { const dd = Math.abs(centerOf(c) - cx); if (dd < bd) { bd = dd; best = c; } }); return best; };
  const highlight = (cell) => dayCells.forEach((c) => { const on = c === cell; c.classList.toggle("on", on); c.setAttribute("aria-selected", on ? "true" : "false"); c.tabIndex = on ? 0 : -1; });   // roving tabindex rides the highlight: exactly one tabbable chip (ARIA tabs pattern)
  const jump = host.querySelector("#deckTodayJump"), updJump = (ymd) => { if (jump) jump.classList.toggle("show", ymd !== todayKey()); };
  const selChip = () => dayCells.filter((c) => c.dataset.ymd === deckViewDay())[0] || dayCells.filter((c) => c.classList.contains("istoday"))[0];
  // A saved day OUTSIDE the wheel's range (a device untouched for 45+ days) used to be silently
  // "healed" to today by the settle-commit; commits are user-only now, so heal it explicitly —
  // otherwise the header/body would sit greyed on the old day while the wheel shows today.
  // The cache:deckday listeners (already attached by openDeck) refresh the header + grey state.
  if (!dayCells.some((c) => c.dataset.ymd === deckViewDay())) {
    try { setDeckViewDay(todayKey()); } catch (e) {}
    const c0 = selChip(); if (c0) highlight(c0);
  }
  // Roving tabindex from the start: 60 tabbable role=tab chips meant one Tab past ‹ focused the
  // OLDEST chip (first in DOM), the browser focus-scrolled it into view, and the settle-commit
  // (userTook armed by that very Tab's keydown) persisted a day 45 days back. Only the selected
  // chip is in the tab order; ← → move between days.
  dayCells.forEach((c) => { c.tabIndex = -1; });
  (function () { const c0 = selChip(); if (c0) c0.tabIndex = 0; })();
  padWheel();
  centerCell(selChip(), false);
  updJump(deckViewDay());
  wheel.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".deck-day") : null;
    const i = cur ? dayCells.indexOf(cur) : dayCells.indexOf(selChip());
    const j = i + (e.key === "ArrowRight" ? 1 : -1);
    if (j >= 0 && j < dayCells.length) { const t = dayCells[j]; centerCell(t, true); try { t.focus({ preventScroll: true }); } catch (err) { t.focus(); } }
  });
  function onWheelResize() {
    if (!host.isConnected) { window.removeEventListener("resize", onWheelResize); return; }
    padWheel(); const c = selChip(); if (c) centerCell(c, false);   // rotation/resize: re-resolve padding, keep the selected day centered
  }
  window.addEventListener("resize", onWheelResize);
  // Re-assert the opening position once layout truly settles (web fonts resize the chips and a
  // mandatory-snap container may re-snap on that reflow) — but never fight a user who has
  // already touched the wheel. Any interaction anywhere in the daybar hands over control.
  let userTook = false, extGlide = false;   // extGlide: a top-date-swipe glide is in charge — disarm the one-shot re-centers without arming commits
  const takeOver = () => { userTook = true; };
  host.addEventListener("pointerdown", takeOver, { capture: true });
  host.addEventListener("wheel", takeOver, { capture: true, passive: true });
  host.addEventListener("keydown", takeOver, { capture: true });
  requestAnimationFrame(() => { if (!userTook && !extGlide && host.isConnected) centerCell(selChip(), false); });
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!userTook && !extGlide && host.isConnected) { centerCell(selChip(), false); const c = selChip(); if (c) highlight(c); } }); } catch (e) {}
  let raf = 0, settle = 0;
  wheel.addEventListener("scroll", () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const c = nearest(); if (c) highlight(c); });   // live highlight tracks the scroll
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!wheel.isConnected) return;   // deck closed mid-coast: a detached wheel's rects are all zero, nearest() degenerates to the FIRST cell (today-45) and would persist it — the review's close-race blocker
      const c = nearest();
      if (userTook && c && c.dataset.ymd !== deckViewDay()) { setDeckViewDay(c.dataset.ymd); updJump(c.dataset.ymd); }
      else if (!userTook) { const s = selChip(); if (s) highlight(s); }   // a no-input scroll (AT focus-scroll, find-in-page) settles without committing — snap the highlight/aria back to the truth
    }, 110);   // commit once it settles — but only motion the USER started (programmatic centering/re-snap drift must never rewrite the selected day)
  });
  // takeOver() in these handlers too: an assistive-tech activation can be a bare click with no
  // pointerdown/keydown — a click on a day control is user intent by definition, so it must commit.
  dayCells.forEach((c) => c.addEventListener("click", () => { takeOver(); centerCell(c, true); }));
  host.querySelector("#deckWheelPrev").addEventListener("click", () => { takeOver(); const i = dayCells.indexOf(nearest()); if (i > 0) centerCell(dayCells[i - 1], true); });
  host.querySelector("#deckWheelNext").addEventListener("click", () => { takeOver(); const i = dayCells.indexOf(nearest()); if (i >= 0 && i < dayCells.length - 1) centerCell(dayCells[i + 1], true); });
  if (jump) jump.addEventListener("click", () => { takeOver(); centerCell(dayCells.filter((c) => c.classList.contains("istoday"))[0], true); });
  // 1:1 with the top date: if the day changes from ELSEWHERE (the top swipe), glide the wheel to match.
  function onWheelExtDay() {
    if (!host.isConnected) { document.removeEventListener("cache:deckday", onWheelExtDay); return; }   // self-clean when the deck closes
    const vd = deckViewDay(), cur = nearest();
    if (cur && cur.dataset.ymd === vd) return;   // already here (or this change came FROM the wheel) — no feedback loop
    const target = dayCells.filter((c) => c.dataset.ymd === vd)[0];
    if (target) { extGlide = true; centerCell(target, true); highlight(target); updJump(vd); }   // extGlide: don't let the fonts-settle re-center teleport-cancel this glide
  }
  document.addEventListener("cache:deckday", onWheelExtDay);
}
// ── The DECK — the full-screen front door the action button opens (mobile AND desktop). It
//    holds "every kind of thing you want to track": today's check-in, and your tasks + habits
//    (the SAME responsive widget, mounted here so your one CTA reaches it without touching the
//    board). Routines / fields / day-by-day paging slot in as later cards. One surface, one CTA.
function openDeck() {
  if (document.getElementById("deckSpace") || document.getElementById("dailySpace")) return;
  const root = document.createElement("div"); root.id = "deckSpace"; root.className = "daily-space deck-space";
  // Your check-in QUESTIONS now show as cards right here. They used to be invisible on this
  // surface — the ⚙ gear edited them but the view showed only tasks, so "edit the deck → open
  // the deck → the questions aren't there." One deck, one surface: questions + tasks together.
  const DECK_INPUT_HINT = { choice: "pick", scale: "1–5", yesno: "yes/no", amount: "$", count: "count", duration: "time", note: "note" };
  const qs = (typeof deckLive === "function" ? deckLive(loadDeck()) : []).slice().sort((a, b) => (+a.ord || 0) - (+b.ord || 0));
  const qCards = qs.map((q) => '<button class="deck-q" data-qid="' + escapeHtml(q.id) + '">' +
    '<span class="deck-q-emoji" aria-hidden="true">' + escapeHtml(q.emoji || "🃏") + "</span>" +
    '<span class="deck-q-txt">' + escapeHtml(q.prompt || "") + "</span>" +
    '<span class="deck-q-kind">' + escapeHtml(DECK_INPUT_HINT[q.input] || "") + "</span></button>").join("");
  let ciOpen = false; try { ciOpen = localStorage.getItem("deckCiCollapsed") === "0"; } catch (e) {}   // DEFAULT collapsed — only the header shows until you expand; remembered per device (non-money key → not synced)
  root.innerHTML =
    '<div class="daily-top">' +
      '<button class="daily-icn" id="deckSpClose" aria-label="close">✕</button>' +
      '<div class="deck-sp-title" id="deckDateHdr"></div>' +   // shows the day you're viewing (+ "Today" when it is)
      '<button class="daily-icn" id="deckSpGear" aria-label="deck settings" title="deck settings">⚙</button>' +
    '</div>' +
    '<div class="deck-sp-scroll">' +
      '<div class="deck-ci-sec' + (ciOpen ? "" : " collapsed") + '" id="deckCiSec">' +
        '<div class="deck-ci-head-row">' +
          '<button class="deck-ci-head" id="deckCiHead" aria-expanded="' + (ciOpen ? "true" : "false") + '">' +
            '<span class="deck-ci-caret" aria-hidden="true">▾</span>' +
            '<span class="deck-ci-label">Today’s check-in</span>' +
            '<span class="deck-ci-count">' + qs.length + "</span>" +
          "</button>" +
          '<button class="deck-ci-edit" id="deckCiEdit" aria-label="edit your check-in questions" title="edit your check-in questions">⚙</button>' +
        "</div>" +
        '<button class="deck-ci-run" id="deckCiRun"><span class="deck-ci-emoji" aria-hidden="true">☀️</span><span class="deck-ci-run-t">Run today’s check-in</span><span class="deck-ci-go" aria-hidden="true">▶</span></button>' +
        (qCards ? '<div class="deck-q-list">' + qCards + "</div>" : '<div class="deck-q-empty sub">No questions yet — tap ⚙ to build your check-in deck.</div>') +
      "</div>" +
      '<div class="deck-sec-h deck-sec-h2">Tasks &amp; habits</div>' +
      '<div class="deck-sp-tasks" id="deckSpTasks"></div>' +
      '<div class="deck-sec-h deck-sec-h2">📝 Notes</div>' +
      '<div class="deck-notes" id="deckNotes"></div>' +
      '<button class="deck-forms-link" id="deckFormsLink"><span>🗒️ Your forms</span><span class="deck-fl-go" aria-hidden="true">▸</span></button>' +
    "</div>" +
    '<div class="deck-daybar" id="deckDayBar"></div>' +   // date-nav: the day scrollwheel lives at the bottom
    '<button class="deck-fab" id="deckFab" aria-label="add to your deck" title="add to your deck">＋</button>' +
    '<div class="deck-bubbles" id="deckBubbles" hidden></div>';
  document.body.appendChild(root);
  const onDeckThings = () => { const a = document.activeElement; if (a && a.classList && a.classList.contains("deck-note-t")) return; renderNotes(); };   // refresh notes on external change, but never yank focus while a note is being edited
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); document.removeEventListener("cache:things", onDeckThings); document.removeEventListener("cache:deckday", onDeckDay); };
  function onKey(e) { if (e.key === "Escape" && !document.getElementById("dailySpace")) close(); }   // if the check-in is open on top, its own Escape handles it first
  document.addEventListener("keydown", onKey);
  let deckLastDay = null;   // remembers the prior viewed day so the header can slide in the right direction
  function onDeckDay() { try { toggleBubbles(false); } catch (e) {} root.classList.toggle("deck-not-today", deckViewDay() !== todayKey()); renderDeckDate(); }   // grey the deck + refresh the header date when browsing a non-today day; scrolling to another day closes the ＋ flyout so it never covers what you're looking at
  function renderDeckDate() {   // the viewed day + a relative cue ("Today" blue, else "in N days" / "N days ago"), sliding in tandem with the wheel
    const hdr = root.querySelector("#deckDateHdr"); if (!hdr) return;
    const ymd = (typeof deckViewDay === "function") ? deckViewDay() : todayKey(), today = todayKey();
    const p = String(ymd).split("-").map(Number), dt = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
    const label = isNaN(dt) ? String(ymd) : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const tp = String(today).split("-").map(Number), td = new Date(tp[0], tp[1] - 1, tp[2]);
    const diff = Math.round((dt - td) / 86400000);   // signed day offset from today
    let sub;
    if (diff === 0) sub = '<span class="deck-hdr-today">Today</span>';
    else { const n = Math.abs(diff), rel = diff < 0 ? (n === 1 ? "Yesterday" : n + " days ago") : (n === 1 ? "Tomorrow" : "in " + n + " days"); sub = '<span class="deck-hdr-rel">' + rel + "</span>"; }
    let anim = "deckDateIn";   // a NEW day slides in from the side it moved — the tandem cue
    if (deckLastDay && deckLastDay !== ymd) anim = ymd > deckLastDay ? "deckDateInR" : "deckDateInL";
    deckLastDay = ymd;
    hdr.innerHTML = '<div class="deck-hdr-inner" style="animation:' + anim + ' .22s ease">' + '<span class="deck-hdr-date">' + escapeHtml(label) + "</span>" + sub + "</div>";
  }
  // The top date is ALSO a slider: a horizontal swipe steps the day ±1, 1:1 with the bottom wheel
  // (both drive setDeckViewDay → cache:deckday, so each mirrors the other). Swipe left = next day.
  function wireDateSwipe() {
    const hdr = root.querySelector("#deckDateHdr"); if (!hdr) return;
    let sx = 0, sy = 0, active = false;
    hdr.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; active = true; });
    hdr.addEventListener("pointerup", (e) => {
      if (!active) return; active = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy)) {
        const d = _ymd2date(deckViewDay()) || new Date();
        try { setDeckViewDay(ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (dx < 0 ? 1 : -1)))); } catch (er) {}
      }
    });
    hdr.addEventListener("pointercancel", () => { active = false; });
  }
  document.addEventListener("cache:deckday", onDeckDay);
  root.querySelector("#deckSpClose").addEventListener("click", close);
  root.querySelector("#deckSpGear").addEventListener("click", () => { try { openSettings(); } catch (e) {} });   // DECK-level settings (overall) — separate from the check-in form builder
  root.querySelector("#deckCiEdit").addEventListener("click", () => { try { openDeckEditor(); } catch (e) {} });   // CHECK-IN level — the form builder (add / reorder / manage questions), where it belongs
  root.querySelector("#deckCiRun").addEventListener("click", () => { try { openDaily(); } catch (e) {} });   // the check-in opens on top; the deck stays behind it
  root.querySelectorAll(".deck-q").forEach((c) => c.addEventListener("click", () => { try { openQuestionDetail(c.dataset.qid); } catch (e) {} }));   // tap a card → edit that one question (same gesture as a task)
  const ciHead = root.querySelector("#deckCiHead"), ciSec = root.querySelector("#deckCiSec");
  if (ciHead && ciSec) ciHead.addEventListener("click", () => {   // toggle: collapse to a compact entry, or expand to see every question at a glance
    const collapsed = !ciSec.classList.contains("collapsed");
    ciSec.classList.toggle("collapsed", collapsed);
    ciHead.setAttribute("aria-expanded", collapsed ? "false" : "true");
    try { localStorage.setItem("deckCiCollapsed", collapsed ? "1" : "0"); } catch (e) {}
  });
  const fl = root.querySelector("#deckFormsLink"); if (fl) fl.addEventListener("click", () => { try { openFormsHome(); } catch (e) {} });   // your build-your-own forms, one tap from the front door
  try { if (typeof RENDERERS === "object" && RENDERERS.tasks) RENDERERS.tasks(root.querySelector("#deckSpTasks")); } catch (e) {}   // the real Tasks/Habits widget, mounted full-screen

  // ── Notes — synced memory items (money.things, type "note"), deck-scoped so they never leak
  //    onto the board's Tasks widget. A note is a first-class Thing → merges per-item, tombstone
  //    delete, works offline on web (no server). Values are the text itself, not a log event.
  function renderNotes() {
    const host = root.querySelector("#deckNotes"); if (!host) return;
    const notes = thingsVisible(loadThings()).filter((x) => x.type === "note").sort((a, b) => (+b.ordAt || 0) - (+a.ordAt || 0));   // newest first
    host.innerHTML = notes.length
      ? notes.map((n) => '<div class="deck-note"><textarea class="deck-note-t" data-nid="' + escapeHtml(n.id) + '" rows="1" placeholder="a thought…" aria-label="note">' + escapeHtml(n.text || "") + "</textarea><button class=\"deck-note-x\" data-nid=\"" + escapeHtml(n.id) + "\" aria-label=\"delete note\">✕</button></div>").join("")
      : '<div class="sub deck-note-empty">Quick thoughts you want to hold — add one with ＋ → Note.</div>';
    host.querySelectorAll(".deck-note-t").forEach((ta) => {
      const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 240) + "px"; };
      grow(); ta.addEventListener("input", grow);
      ta.addEventListener("blur", () => {   // save on blur; a blank/cleared note tidies itself away
        const n = loadThings().find((x) => x && x.id === ta.dataset.nid); if (!n) return;
        const v = ta.value.trim() ? ta.value : "";
        if (!v) { if (!n.deleted) { saveThings([Object.assign({}, n, { deleted: 1, updated: Date.now() })]); const row = ta.closest(".deck-note"); if (row) row.remove(); } return; }
        if ((n.text || "") !== v) { saveThings([Object.assign({}, n, { text: v, updated: Date.now() })]); try { flash("Saved"); } catch (e) {} }
      });
    });
    host.querySelectorAll(".deck-note-x").forEach((b) => b.addEventListener("click", () => {
      const n = loadThings().find((x) => x && x.id === b.dataset.nid); if (!n) return;
      confirmDelete("this note", () => {
        saveThings([Object.assign({}, n, { deleted: 1, updated: Date.now() })]);   // notes have no children → a plain tombstone
        renderNotes(); try { flash("Note deleted"); } catch (e) {}
      });
    }));
  }
  function mkThing(extra) {   // a new top-level Thing with a collision-proof id + real stamps (deck contract)
    const now = Date.now(), roots = thingsVisible(loadThings()).filter((x) => !x.parent && !x.routine);
    const ord = roots.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;
    const t = Object.assign({ id: thingId(), updated: now, ord: ord, ordAt: now, deleted: 0, parent: null, routine: null }, extra);
    saveThings([t]); return t.id;
  }
  function gotoRoutine(rid) {   // open + scroll to a routine in the mounted tasks widget
    try { const f = JSON.parse(localStorage.getItem("deckFold") || "{}") || {}; f[rid] = 1; localStorage.setItem("deckFold", JSON.stringify(f)); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("cache:things")); } catch (e) {}   // widget re-renders, re-reads fold → routine now open
    setTimeout(() => {
      const sel = (window.CSS && CSS.escape) ? CSS.escape(rid) : rid;
      const el = root.querySelector('#deckSpTasks [data-id="' + sel + '"]'), row = el && el.closest(".tk-item");
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }
  let bubblesOpen = false;
  function renderBubbles() {
    const bub = root.querySelector("#deckBubbles"); if (!bub) return;
    const routines = thingsVisible(loadThings()).filter((x) => x.type === "routine").sort((a, b) => (+a.ord || 0) - (+b.ord || 0));
    bub.innerHTML =
      '<button class="deck-bub" data-add="task"><span class="db-i">✅</span> Add task</button>' +
      '<button class="deck-bub" data-add="habit"><span class="db-i">↻</span> Add habit</button>' +
      '<button class="deck-bub" data-add="note"><span class="db-i">📝</span> Add note</button>' +
      '<button class="deck-bub" data-add="event"><span class="db-i">📅</span> Add event</button>' +
      (routines.length ? '<div class="deck-bub-sep">Go to routine</div>' + routines.map((r) => '<button class="deck-bub deck-bub-goto" data-goto="' + escapeHtml(r.id) + '"><span class="db-i">' + escapeHtml(r.emoji || "🔁") + "</span> " + escapeHtml(r.name || "Routine") + "</button>").join("") : "");
  }
  function toggleBubbles(open) {
    const bub = root.querySelector("#deckBubbles"), fab = root.querySelector("#deckFab");
    bubblesOpen = (open == null) ? !bubblesOpen : !!open;
    if (bubblesOpen) renderBubbles();
    bub.hidden = !bubblesOpen; fab.classList.toggle("on", bubblesOpen);
  }
  root.querySelector("#deckFab").addEventListener("click", (e) => { e.stopPropagation(); toggleBubbles(); });
  root.querySelector("#deckBubbles").addEventListener("click", (e) => {
    const b = e.target.closest(".deck-bub"); if (!b) return; e.stopPropagation();
    if (b.dataset.goto) { toggleBubbles(false); gotoRoutine(b.dataset.goto); return; }
    toggleBubbles(false);
    const add = b.dataset.add;
    if (add === "task") { const nid = mkThing({ type: "task", title: "New task", done: 0, doneAt: null }); try { openTaskDetail(nid); } catch (e) {} }
    else if (add === "habit") { const nid = mkThing({ type: "habit", title: "New habit", track: "check", done: 0, doneAt: null }); try { openTaskDetail(nid); } catch (e) {} }
    else if (add === "note") { const nid = mkThing({ type: "note", text: "" }); renderNotes(); setTimeout(() => { const ta = root.querySelector('.deck-note-t[data-nid="' + ((window.CSS && CSS.escape) ? CSS.escape(nid) : nid) + '"]'); if (ta) { ta.scrollIntoView({ block: "center" }); ta.focus(); } }, 40); }
    else if (add === "event") { try { if (typeof calAddEvent === "function") calAddEvent(deckViewDay()); else flash("Events arrive with the calendar"); } catch (e) {} }   // create an event on the day you're viewing + open its editor
  });
  root.addEventListener("click", (e) => { if (bubblesOpen && !e.target.closest("#deckBubbles") && !e.target.closest("#deckFab")) toggleBubbles(false); });
  // Scrolling the deck closes the ＋ flyout — on a phone an open flyout covers the list, and
  // the user's intent when they start scrolling is to SEE the list, not keep the menu up.
  (function () { const sc = root.querySelector(".deck-sp-scroll"); if (sc) sc.addEventListener("scroll", () => { if (bubblesOpen) toggleBubbles(false); }, { passive: true }); })();
  document.addEventListener("cache:things", onDeckThings);
  renderNotes();
  root.classList.toggle("deck-not-today", deckViewDay() !== todayKey());   // date-nav: obvious at a glance when you're not on today
  try { renderDeckDate(); } catch (e) {}   // seed the header date on open
  try { wireDateSwipe(); } catch (e) {}    // make the top date swipeable, 1:1 with the wheel
  try { renderDeckDayWheel(root.querySelector("#deckDayBar")); } catch (e) {}   // the satisfying day scrollwheel at the bottom
}
// ── Task / habit DETAIL — tap a row's bar to open the full editor, like any task manager:
//    rename, notes, due date + time, task↔habit + how it's tracked, the life AREA it belongs
//    to (its "data store"), its activity trail, and delete. Full-screen, mobile-first (reuses
//    the deck shell). Routine membership arrives with routines. Every edit merges per-item.
const TD_AREAS = [
  ["💰", "Money"], ["🩺", "Health"], ["⏱️", "Time"], ["🏠", "Household"], ["✅", "Tasks"], ["🍳", "Meals"],
  ["🤝", "Community"], ["👥", "Relationships"], ["📚", "Learning"], ["🎨", "Creative"], ["🧰", "Home & Stuff"], ["📓", "Journal"],
];
// ONE "how it's tracked" vocabulary — the full set (yes/no · number · 1–5 rating · a few
// words), shared by the widget's ⋯ menu AND the detail sheet so the two pickers can't drift.
// The values map onto the check-in runner's input primitives (yesno→check, amount, scale, note).
const HABIT_TRACKS = [["check", "✓ Yes / no"], ["amount", "🔢 A number"], ["scale", "★ 1–5 rating"], ["note", "✏️ A few words"]];
// ONE schedule vocabulary — shared by the routine sheet AND the habit sheet (habits recur too).
const SCHED_FREQS = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]];
const SCHED_DOW = [["0", "S"], ["1", "M"], ["2", "T"], ["3", "W"], ["4", "T"], ["5", "F"], ["6", "S"]];
// The schedule picker's shared MARKUP + WIRING — rendered inside a detail sheet's .td-scroll.
// Both the routine sheet and the habit sheet call these, so the recurrence UI is one thing.
// getSched() reads the freshest sched; setSched(patch) merges + saves it (the caller stamps).
function schedPickerHtml(s, esc) {
  s = s || { freq: "daily", every: 1 };
  const freq = s.freq || "daily", days = Array.isArray(s.days) ? s.days.map(String) : [];
  const unit = freq === "weekly" ? "week(s)" : freq === "monthly" ? "month(s)" : freq === "yearly" ? "year(s)" : "day(s)";
  return '<div class="td-field"><label>Repeats</label><div class="td-seg" id="spFreq">' + SCHED_FREQS.map((fq) => '<button data-freq="' + fq[0] + '"' + (freq === fq[0] ? ' class="on"' : "") + ">" + fq[1] + "</button>").join("") + "</div></div>" +
    (freq === "weekly" ? '<div class="td-field"><label>On these days</label><div class="rd-days">' + SCHED_DOW.map((d) => '<button class="rd-day' + (days.indexOf(d[0]) !== -1 ? " on" : "") + '" data-dow="' + d[0] + '">' + d[1] + "</button>").join("") + "</div></div>" : "") +
    '<div class="td-field"><label>Every</label><div class="rd-every"><input type="number" inputmode="numeric" class="rd-everyin" id="spEvery" value="' + esc(s.every || 1) + '" min="1"><span class="rd-everylbl">' + unit + "</span></div></div>" +
    '<div class="td-field"><label>Starts</label><input type="date" class="td-due" id="spStart" value="' + esc(s.start) + '"></div>' +
    '<div class="td-field rd-pausefield"><label class="rd-pauselbl"><input type="checkbox" id="spPaused"' + (s.paused ? " checked" : "") + "> Paused</label></div>";
}
function schedPickerWire(root, getSched, setSched, rerender) {
  root.querySelectorAll("#spFreq button").forEach((b) => b.addEventListener("click", () => { setSched({ freq: b.dataset.freq }); rerender(); }));
  root.querySelectorAll(".rd-day").forEach((b) => b.addEventListener("click", () => {
    const s = getSched() || {}, days = Array.isArray(s.days) ? s.days.map(Number) : [], d = +b.dataset.dow, i = days.indexOf(d);
    if (i === -1) days.push(d); else days.splice(i, 1);
    setSched({ days: days.sort((x, y) => x - y) }); rerender();
  }));
  const ev = root.querySelector("#spEvery"); if (ev) ev.addEventListener("change", () => setSched({ every: Math.max(1, parseInt(ev.value) || 1) }));
  const st = root.querySelector("#spStart"); if (st) st.addEventListener("change", (e) => setSched({ start: e.target.value || null }));
  const pz = root.querySelector("#spPaused"); if (pz) pz.addEventListener("change", () => setSched({ paused: pz.checked ? 1 : 0 }));
}
// The ONE code path for task↔habit conversion + tracking mode — used by BOTH the widget's ⋯
// quick menu and the detail sheet, so they can't drift. An edit, id UNCHANGED (§3). Callers
// re-render their own surface (the widget via its cache:things listener; the sheet explicitly).
function thingSetType(id, type) {
  const t = loadThings().find((x) => x && x.id === id); if (!t) return;
  if (type === "habit") { if (t.type !== "habit") saveThings([Object.assign({}, t, { type: "habit", track: t.track || "check", done: 0, doneAt: null, updated: Date.now() })]); }
  else { const c = Object.assign({}, t, { type: "task", updated: Date.now() }); delete c.track; delete c.unit; delete c.sched; saveThings([c]); }   // drop the tracking AND the schedule on downgrade — tasks are one-off, they never recur
}
function thingSetTrack(id, mode) {
  const t = loadThings().find((x) => x && x.id === id); if (!t) return;
  saveThings([Object.assign({}, t, { track: mode, updated: Date.now() })]);
}
// A reusable "confirm deletion" gate — NOTHING gets deleted without an explicit second tap.
// Non-negotiable for the people we build for (ADHD/TBI/overwhelmed): a mis-tapped ✕ or 🗑 must
// never silently destroy data. Every delete routes through this: confirmDelete(label, () => …).
// Default focus lands on the SAFE choice ("Keep it"), the destructive button is clearly red.
function confirmDelete(label, onConfirm) {
  const ex = document.getElementById("confirmDel"); if (ex) ex.remove();
  const root = document.createElement("div"); root.id = "confirmDel"; root.className = "confirm-del";
  root.innerHTML =
    '<div class="cd-backdrop"></div>' +
    '<div class="cd-card" role="alertdialog" aria-modal="true" aria-label="confirm deletion">' +
      '<div class="cd-icon" aria-hidden="true">🗑️</div>' +
      '<div class="cd-title">Delete ' + escapeHtml(label || "this") + "?</div>" +
      '<div class="cd-sub">This removes it from your cache.</div>' +
      '<div class="cd-row"><button class="cd-cancel" type="button">Keep it</button><button class="cd-go" type="button">Delete</button></div>' +
    "</div>";
  document.body.appendChild(root);
  function close() { root.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  root.querySelector(".cd-backdrop").addEventListener("click", close);
  root.querySelector(".cd-cancel").addEventListener("click", close);
  root.querySelector(".cd-go").addEventListener("click", () => { close(); try { onConfirm(); } catch (e) {} });
  try { root.querySelector(".cd-cancel").focus(); } catch (e) {}
}
function openTaskDetail(id) {
  const t0 = loadThings().find((x) => x && x.id === id);
  if (!t0 || t0.deleted) return;
  const ex = document.getElementById("taskDetail"); if (ex) ex.remove();
  const root = document.createElement("div"); root.id = "taskDetail"; root.className = "daily-space td-space";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  const get = () => loadThings().find((x) => x && x.id === id) || t0;   // always read the freshest copy
  const patch = (p) => { const t = get(); saveThings([Object.assign({}, t, p, { updated: Date.now() })]); try { flash("Saved"); } catch (e) {} };   // a quick bottom toast so autosave is never silent
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  function render() {
    const t = get(), habit = t.type === "habit", amount = habit && t.track === "amount", now = Date.now();
    const byId = {}; loadThings().forEach((x) => { if (x && x.id) byId[x.id] = x; });
    const trail = (typeof thingTrail === "function" ? thingTrail(loadLog(), id) : []).slice().reverse();
    const trailRow = (e) => {
      const it = byId[e.itemId], name = it ? "“" + esc(it.title) + "”" : "an item", self = e.itemId === id;
      let w = esc(e.kind) + " " + name;
      if (e.kind === "done") w = "<b>✓</b> completed " + (self ? "this" : name);
      else if (e.kind === "undone") w = "<b>↩</b> un-checked " + (self ? "this" : name);
      else if (e.kind === "habit") { const v = e.value || {}; w = "<b>◆</b> logged " + name + (v.qty != null ? " · " + esc(v.qty) : v.rating != null ? " · " + esc(v.rating) + "/5" : v.text ? " · “" + esc(String(v.text).slice(0, 24)) + "”" : ""); }
      return '<div class="tkt-row"><span class="tkt-what">' + w + '</span><span class="tkt-when">' + esc(ageStr(now - (+e.at || 0))) + "</span></div>";
    };
    const areaChips = TD_AREAS.map((a) => '<button class="td-area' + (t.area === a[1] ? " on" : "") + '" data-area="' + esc(a[1]) + '">' + a[0] + " " + esc(a[1]) + "</button>").join("") +
      (t.area ? '<button class="td-area td-area-clear" data-area="">✕ clear</button>' : "");
    const routines = loadThings().filter((x) => x && x.type === "routine" && !x.deleted);
    const curRt = t.routine || null;
    const rtChips = routines.map((r) => '<button class="td-rt' + (r.id === curRt ? " on" : "") + '" data-rt="' + esc(r.id) + '">' + esc(r.emoji || "🔁") + " " + esc(r.name || "Routine") + "</button>").join("") +
      '<button class="td-rt' + (!curRt ? " on" : "") + '" data-rt="">↩ None</button>';
    root.innerHTML =
      '<div class="daily-top">' +
        '<button class="daily-icn" id="tdClose" aria-label="close">✕</button>' +
        '<div class="td-htitle">' + (habit ? "↻ Habit" : "✅ Task") + '</div>' +
        '<button class="daily-icn td-del" id="tdDel" aria-label="delete" title="delete">🗑</button>' +
      '</div>' +
      '<div class="td-scroll">' +
        '<input class="td-title" id="tdTitle" value="' + esc(t.title) + '" placeholder="name…" aria-label="name">' +
        '<div class="td-field"><label>Type</label><div class="td-seg" id="tdType">' +
          '<button data-type="task"' + (!habit ? ' class="on"' : "") + '>✅ Task</button>' +
          '<button data-type="habit"' + (habit ? ' class="on"' : "") + '>↻ Habit</button>' +
        "</div></div>" +
        (habit ? '<div class="td-field"><label>How it’s tracked</label><div class="td-seg td-seg-wrap" id="tdTrack">' +
          HABIT_TRACKS.map((tr) => '<button data-mode="' + tr[0] + '"' + ((t.track || "check") === tr[0] ? ' class="on"' : "") + ">" + tr[1] + "</button>").join("") +
          "</div>" + (amount ? '<input class="td-unit" id="tdUnit" value="' + esc(t.unit) + '" placeholder="unit — min, reps, pages…" aria-label="unit">' : "") + "</div>" : "") +
        // a HABIT recurs → its due area IS the schedule (same picker as a routine; no sched =
        // every day). A task stays one-off: a due date + time, never a recurrence.
        (habit ? schedPickerHtml(t.sched, esc)
          : '<div class="td-field"><label>Due</label><div class="td-due-row">' +
            '<input type="date" class="td-due" id="tdDue" value="' + esc(t.due) + '" aria-label="due date">' +
            '<input type="time" class="td-due" id="tdDueTime" value="' + esc(t.dueTime) + '" aria-label="due time">' +
          "</div></div>") +
        '<div class="td-field"><label>Area — where it belongs</label><div class="td-areas">' + areaChips + "</div></div>" +
        '<div class="td-field"><label>Notes</label><textarea class="td-notes" id="tdNotes" placeholder="anything to remember…" aria-label="notes">' + esc(t.notes) + "</textarea></div>" +
        '<div class="td-field"><label>Routine — part of a saved routine?</label><div class="td-areas td-rtrow">' + (routines.length ? rtChips : '<span class="td-soon-txt" style="margin-right:8px">No routines yet — make one in your deck.</span><button class="td-rt on" data-rt="">↩ None</button>') + "</div></div>" +
        '<div class="td-field"><label>Activity</label>' + (trail.length ? '<div class="td-trail">' + trail.map(trailRow).join("") + "</div>" : '<div class="tkt-empty">No activity yet — check it off and it shows here.</div>') + "</div>" +
      "</div>";
    wire();
  }
  function wire() {
    root.querySelector("#tdClose").addEventListener("click", close);
    root.querySelector("#tdDel").addEventListener("click", () => {
      const t = get();
      confirmDelete(t && t.title ? t.title : "this", () => {
        const all = loadThings(), now = Date.now(), liveBefore = {};
        all.forEach((x) => { if (x && !x.deleted) liveBefore[x.id] = 1; });
        saveThings(thingsCascadeDelete(all, id, now).filter((x) => x && x.deleted && liveBefore[x.id]));
        close();
      });
    });
    const title = root.querySelector("#tdTitle");
    title.addEventListener("change", () => { const v = title.value.trim(); if (v) patch({ title: v }); });   // save on blur / Enter
    root.querySelectorAll("#tdType button").forEach((b) => b.addEventListener("click", () => { thingSetType(id, b.dataset.type); render(); }));
    root.querySelectorAll("#tdTrack button").forEach((b) => b.addEventListener("click", () => { thingSetTrack(id, b.dataset.mode); render(); }));
    const unit = root.querySelector("#tdUnit"); if (unit) unit.addEventListener("change", () => patch({ unit: unit.value.trim() }));
    // task → the due inputs; habit → the shared schedule picker (both null-safe: only one renders)
    const due = root.querySelector("#tdDue"); if (due) due.addEventListener("change", (e) => patch({ due: e.target.value || null }));
    const dueT = root.querySelector("#tdDueTime"); if (dueT) dueT.addEventListener("change", (e) => patch({ dueTime: e.target.value || null }));
    schedPickerWire(root, () => get().sched, (p) => { const t = get(); patch({ sched: Object.assign({ freq: "daily", every: 1 }, t.sched || {}, p) }); }, render);
    root.querySelectorAll(".td-area").forEach((b) => b.addEventListener("click", () => { patch({ area: b.dataset.area || null }); render(); }));
    root.querySelectorAll(".td-rt").forEach((b) => b.addEventListener("click", () => {   // move in/out of a routine — same per-item edit as the deck's ⋯ picker
      const rid = b.dataset.rt || null, cur = get();
      if ((cur.routine || null) === rid) { render(); return; }   // already there — no-op
      const nowm = Date.now(), parent = rid ? null : (cur.parent || null);   // into a routine → top-level member; out → keep parent (usually null)
      const sibs = loadThings().filter((x) => x && !x.deleted && x.id !== id && (rid ? x.routine === rid : ((x.parent || null) === parent && !x.routine)));
      const ord = sibs.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;
      saveThings([Object.assign({}, cur, { routine: rid, parent: parent, ord: ord, ordAt: nowm, updated: nowm })]);
      try { flash(rid ? "Moved to routine" : "Removed from routine"); } catch (e) {}
      render();
    }));
    const notes = root.querySelector("#tdNotes"); notes.addEventListener("change", () => patch({ notes: notes.value }));
  }
  render();
}
// ONE "where does this belong" vocabulary — the 12 areas — shared by the question detail
// sheet AND the batch form-builder AND (as a tag) tasks. Questions map areas to the dest
// kinds: Money/Health keep the kinds that have live readers (spend building, energy widget);
// every other area routes to {kind:"area"}. Legacy tracker/dayflag questions read as unmapped
// until re-tagged. Kept as two tiny pure functions so all three surfaces stay in lockstep.
function deckDestToArea(d) {
  if (!d) return null;
  if (d.kind === "money") return "Money";
  if (d.kind === "health") return "Health";
  if (d.kind === "area") { const t = String(d.target || "").toLowerCase(); const m = TD_AREAS.find((a) => a[1].toLowerCase() === t); return m ? m[1] : null; }
  return null;
}
function deckAreaToDest(area, prev) {
  if (area === "Money") return { kind: "money", target: (prev && prev.target) || "" };
  if (area === "Health") return { kind: "health", target: (prev && prev.target) || "energy" };
  return { kind: "area", target: area };
}
// A check-in QUESTION's detail sheet — the SAME gesture as a task (tap a card → edit it),
// reusing the td-space shell. Fields differ by card type; a question's are emoji, prompt,
// answer type, and — via the SHARED 12-area picker — the area its answer lands in. The
// money/health areas map to the dest kinds that have live readers (spend building, energy
// widget); every other area routes to {kind:"area"}. Saves per-item through saveDeck.
function openQuestionDetail(qid) {
  const q0 = (loadDeck() || []).find((x) => x && x.id === qid);
  if (!q0 || q0.deleted) return;
  const ex = document.getElementById("taskDetail"); if (ex) ex.remove();
  const root = document.createElement("div"); root.id = "taskDetail"; root.className = "daily-space td-space";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  const get = () => (loadDeck() || []).find((x) => x && x.id === qid) || q0;
  const save = (p) => { const q = get(); saveDeck([Object.assign({}, q, p, { updated: deckNow() })]); try { if (!p.deleted) flash("Saved"); } catch (e) {} };   // stamp AT the edit; saveDeck merges per-item
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  const INPUTS = ["choice", "scale", "yesno", "amount", "count", "duration", "note"];
  const optStr = (o) => (!o || !o.length) ? "" : o.map((x) => (Array.isArray(x) ? x[1] : x)).join(", ");
  const parseOpts = (s) => s.split(",").map((x) => x.trim()).filter(Boolean).map((lb) => ["", lb]);
  const destArea = deckDestToArea, areaDest = deckAreaToDest;   // shared with the batch form-builder — one vocabulary
  function render() {
    const q = get(), area = destArea(q.dest), opt = q.input === "choice" || q.input === "scale";
    const areaChips = TD_AREAS.map((a) => '<button class="td-area' + (area === a[1] ? " on" : "") + '" data-area="' + esc(a[1]) + '">' + a[0] + " " + esc(a[1]) + "</button>").join("");
    root.innerHTML =
      '<div class="daily-top">' +
        '<button class="daily-icn" id="qdClose" aria-label="close">✕</button>' +
        '<div class="td-htitle">🃏 Check-in card</div>' +
        '<button class="daily-icn td-del" id="qdDel" aria-label="delete" title="delete">🗑</button>' +
      "</div>" +
      '<div class="td-scroll">' +
        '<div class="qd-titlerow"><input class="qd-emoji" id="qdEmoji" value="' + esc(q.emoji) + '" maxlength="4" aria-label="emoji"><input class="td-title qd-prompt" id="qdPrompt" value="' + esc(q.prompt) + '" placeholder="your question…" aria-label="question"></div>' +
        '<div class="td-field"><label>Answer type</label><select class="qd-input" id="qdInput">' + INPUTS.map((t) => "<option" + (t === q.input ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
        (opt ? '<div class="td-field"><label>Buttons</label><input class="td-unit" id="qdOpts" value="' + esc(optStr(q.options)) + '" placeholder="Cooked, Ate out, Both"></div>' : "") +
        '<div class="td-field"><label>Where the answer lands — an area</label><div class="td-areas">' + areaChips + "</div></div>" +
      "</div>";
    wire();
  }
  function wire() {
    root.querySelector("#qdClose").addEventListener("click", close);
    root.querySelector("#qdDel").addEventListener("click", () => { const q = get(); confirmDelete(q && q.prompt ? "this question" : "this question", () => { save({ deleted: 1 }); close(); }); });   // tombstone (never absence) — the deck merge relies on it
    const em = root.querySelector("#qdEmoji"); em.addEventListener("change", () => save({ emoji: em.value }));
    const pr = root.querySelector("#qdPrompt"); pr.addEventListener("change", () => { const v = pr.value.trim(); if (v) save({ prompt: v }); });
    const inp = root.querySelector("#qdInput"); inp.addEventListener("change", () => { save({ input: inp.value }); render(); });
    const op = root.querySelector("#qdOpts"); if (op) op.addEventListener("change", () => save({ options: parseOpts(op.value) }));
    root.querySelectorAll(".td-area").forEach((b) => b.addEventListener("click", () => { save({ dest: areaDest(b.dataset.area, get().dest) }); render(); }));
  }
  render();
}

// ── FORMS UI — the library widget, the designer, the filler, and document import ─────
// Build your own data-intake forms, route each field into your 12 areas, and fill them —
// on a board widget OR from the deck front door. Templates + submissions merge per-item via
// the money.forms / money.formData store (reusing the things algorithm). The doc importers
// turn a CSV or a pasted list into a DRAFT template you confirm in the designer.
const FTYPE_LABEL = { text: "Text", number: "Number", dollar: "Dollar $", date: "Date", choice: "Choice", yesno: "Yes / no", notes: "Long notes", scale: "1–5 scale", count: "Count", duration: "Hours" };
// Coerce a raw input value to what the submission stores (numbers as numbers, yes/no as 0|1
// ints per the merge-canon rule). Empty → null (a blank field is simply not answered).
function coerceFormValue(ft, raw) {
  if (raw === "" || raw == null) return null;
  if (ft === "number" || ft === "dollar" || ft === "count" || ft === "duration") { const n = parseFloat(String(raw).replace(/[$,\s]/g, "")); return isNaN(n) ? null : n; }
  if (ft === "yesno") return (raw === "1" || raw === 1 || /^y/i.test(String(raw))) ? 1 : 0;
  if (ft === "scale") { const n = parseInt(raw, 10); return isNaN(n) ? null : n; }
  return String(raw);
}
// A routed check-in-log entry for a field WHOSE AREA HAS A LIVE READER — Money+numeric →
// the spend building, Health+scale → the energy pattern. Everything else lives only in the
// durable submission (a future area reader picks it up). `at` is the day's midnight so a
// re-fill of the same day REPLACES rather than double-counts (the (at,itemId) union converges
// cross-device to one entry). Returns null when there's nothing a reader would correctly claim.
function formFieldLogEntry(field, coerced, day) {
  if (coerced == null || coerced === "" || !field || !field.area) return null;
  const at = Date.parse(day + "T00:00:00") || 0;
  if (field.area === "Money" && (field.ftype === "dollar" || field.ftype === "number"))
    return { ts: day, at: at, itemId: field.id, prompt: field.label, input: "amount", value: coerced, dest: { kind: "money", target: field.target || "" } };
  if (field.area === "Health" && field.ftype === "scale")
    return { ts: day, at: at, itemId: field.id, prompt: field.label, input: "scale", value: coerced, dest: { kind: "health", target: "energy" } };
  return null;
}
// Write routed entries into the check-in log, REPLACING any prior entry for the same
// (field, day) so a re-fill edits instead of duplicating. Then fan out like a check-in does.
function appendFormLogEntries(entries) {
  if (!entries || !entries.length) return true;
  let log = loadLog();
  entries.forEach((en) => { const key = (en.at || 0) + "|" + en.itemId; log = log.filter((e) => ((e.at || 0) + "|" + (e.itemId || "")) !== key); log.push(en); });
  const ok = saveLog(log);
  if (ok) { try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {} try { if (typeof ckPush === "function") ckPush(entries); } catch (e) {} }
  return ok;
}
// Shared rows for the widget AND the full-screen home (one markup, no drift).
function formsRowsHTML() {
  const forms = formsLive(loadForms()).slice().sort((a, b) => (+a.ord || 0) - (+b.ord || 0));
  if (!forms.length) return '<div class="frm-empty sub">No forms yet — build one, or import a CSV / a pasted list to start.</div>';
  return '<div class="frm-list">' + forms.map((f) => {
    const n = (f.fields || []).length;
    return '<div class="frm-row" data-id="' + escapeHtml(f.id) + '">' +
      '<button class="frm-fill" data-act="fill" title="fill this form">' +
        '<span class="frm-emoji" aria-hidden="true">' + escapeHtml(f.emoji || "📋") + "</span>" +
        '<span class="frm-nm"><span class="frm-nm-t">' + escapeHtml(f.name || "Untitled form") + "</span>" +
        '<span class="frm-meta">' + n + " field" + (n === 1 ? "" : "s") + (f.dated ? " · one a day" : "") + "</span></span></button>" +
      '<button class="frm-ic" data-act="edit" aria-label="edit form">✎</button>' +
      '<button class="frm-ic" data-act="del" aria-label="delete form">✕</button>' +
    "</div>";
  }).join("") + "</div>";
}
function wireFormsList(scope) {
  scope.querySelectorAll(".frm-row").forEach((row) => {
    const id = row.dataset.id;
    const fill = row.querySelector('[data-act="fill"]'); if (fill) fill.addEventListener("click", () => openFormFill(id));
    const ed = row.querySelector('[data-act="edit"]'); if (ed) ed.addEventListener("click", () => openFormEditor(id));
    const del = row.querySelector('[data-act="del"]'); if (del) del.addEventListener("click", () => {
      const f = loadForms().find((x) => x && x.id === id); if (!f) return;
      if (typeof confirm === "function" && !confirm("Delete “" + (f.name || "this form") + "”? Your past entries stay saved.")) return;
      saveForms([Object.assign({}, f, { deleted: 1, updated: Date.now() })]);   // tombstone, never absence
    });
  });
  const nw = scope.querySelector('[data-act="new"]'); if (nw) nw.addEventListener("click", () => openFormEditor());
  const doc = scope.querySelector('[data-act="doc"]'); if (doc) doc.addEventListener("click", () => openFormDocPicker());
}
// The full-screen forms home (the deck / phone path). The board widget is the desktop lens;
// this is the same list reachable without the board.
function openFormsHome() {
  if (document.getElementById("formsHome")) return;
  const root = document.createElement("div"); root.id = "formsHome"; root.className = "daily-space forms-home";
  const paint = () => {
    root.innerHTML =
      '<div class="daily-top"><button class="daily-icn" id="fhClose" aria-label="close">✕</button><div class="deck-sp-title">🗒️ Your forms</div><span class="daily-icn" aria-hidden="true"></span></div>' +
      '<div class="deck-sp-scroll">' + formsRowsHTML() +
        '<div class="frm-foot"><button class="frm-btn" data-act="new">＋ New form</button><button class="frm-btn ghost" data-act="doc">⬆ From a document</button></div>' +
      "</div>";
    drawIcons(); wireFormsList(root);
    const c = root.querySelector("#fhClose"); if (c) c.addEventListener("click", close);
  };
  const onKey = (e) => { if (e.key === "Escape" && !document.getElementById("formEditor") && !document.getElementById("formFill") && !document.getElementById("formDoc")) close(); };
  const onChange = () => { if (root.isConnected) paint(); };
  function close() { root.remove(); document.removeEventListener("keydown", onKey); document.removeEventListener("cache:forms", onChange); }
  document.body.appendChild(root);
  document.addEventListener("keydown", onKey);
  document.addEventListener("cache:forms", onChange);
  paint();
}

// The DESIGNER. arg: a form id (edit), a draft template object (from a doc import — persisted
// on open), or nothing (a blank new form, persisted on first edit). Mirrors openDeckEditor:
// every edit stamps updated AT the point of edit, then saveForms merges per-item.
function openFormEditor(arg) {
  if (document.getElementById("formEditor")) return;
  let form, fromDoc = false;
  if (arg && typeof arg === "object") { form = arg; fromDoc = true; }
  else if (typeof arg === "string") { form = loadForms().find((f) => f && f.id === arg); if (!form) return; form = JSON.parse(JSON.stringify(form)); }
  else {
    const last = formsLive(loadForms()).slice(-1)[0];
    form = { id: formId(), type: "form", name: "", emoji: "📋", dated: 0, fields: [], updated: 0, ord: (last ? (+last.ord || 0) : 0) + 1, ordAt: 0 };
  }
  const persist = () => { form.updated = Date.now(); saveForms([form]); };
  if (fromDoc) persist();   // a doc import is intentional — make it real immediately (stamps a real `updated`)
  const root = document.createElement("div"); root.id = "formEditor"; root.className = "daily-space deck-editor form-editor";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  function fieldRowHTML(fl, idx) {
    const ftype = fl.ftype || "text", opt = ftype === "choice";
    return '<div class="fe-row" data-idx="' + idx + '">' +
      '<div class="fe-row-top"><button class="deck-grip" aria-label="drag to reorder">⠿</button>' +
        '<input class="fe-label" value="' + esc(fl.label) + '" placeholder="field label…" aria-label="field label">' +
        '<button class="deck-del fe-del" aria-label="remove field">✕</button></div>' +
      '<div class="fe-row-cfg">' +
        '<label>Type<select class="fe-type">' + FORM_FTYPES.map((t) => '<option value="' + t + '"' + (t === ftype ? " selected" : "") + ">" + FTYPE_LABEL[t] + "</option>").join("") + "</select></label>" +
        '<label>Area<select class="fe-area"><option value=""' + (!fl.area ? " selected" : "") + ">—</option>" + TD_AREAS.map((a) => '<option value="' + esc(a[1]) + '"' + (fl.area === a[1] ? " selected" : "") + ">" + a[0] + " " + esc(a[1]) + "</option>").join("") + "</select></label>" +
        (fl.area === "Money" ? '<label class="fe-tgt-l">Building<input class="fe-tgt" value="' + esc(fl.target) + '" placeholder="e.g. Groceries"></label>' : "") +
      "</div>" +
      (opt ? '<div class="fe-row-cfg"><label class="fe-opt-l">Choices<input class="fe-opts" value="' + esc((fl.options || []).join(", ")) + '" placeholder="Cooked, Ate out, Both"></label></div>' : "") +
      ((ftype === "number" || ftype === "duration" || ftype === "count") ? '<div class="fe-row-cfg"><label class="fe-opt-l">Unit<input class="fe-unit" value="' + esc(fl.unit) + '" placeholder="min, reps, pages…"></label></div>' : "");
  }
  function attachFieldDrag(row, listEl) {
    const grip = row.querySelector(".deck-grip"); if (!grip) return;
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault(); row.classList.add("dragging");
      try { grip.setPointerCapture(e.pointerId); } catch (er) {}
      const move = (ev) => { const rows = [...listEl.querySelectorAll(".fe-row")]; for (const r of rows) { if (r === row) continue; const rect = r.getBoundingClientRect(); if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) { listEl.insertBefore(row, ev.clientY < rect.top + rect.height / 2 ? r : r.nextSibling); break; } } };
      const up = () => {
        grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); row.classList.remove("dragging");
        // fields are nested in ONE merge unit (the form) — reordering is just the array order,
        // stamped on the form. (No per-field ord/ordAt: the form is the merge granularity.)
        const order = [...listEl.querySelectorAll(".fe-row")].map((r) => parseInt(r.dataset.idx, 10));
        form.fields = order.map((i) => form.fields[i]);
        persist(); render();
      };
      grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
    });
  }
  function render() {
    root.innerHTML =
      '<div class="daily-top"><div class="deck-title">Build a form</div><button class="daily-cta sm" id="feDone">Done</button></div>' +
      '<div class="fe-meta"><input class="deck-emoji fe-emoji" id="feEmoji" value="' + esc(form.emoji || "📋") + '" maxlength="4" aria-label="emoji">' +
        '<input class="fe-name" id="feName" value="' + esc(form.name) + '" placeholder="form name — e.g. Daily journal"></div>' +
      '<label class="fe-dated"><input type="checkbox" id="feDated"' + (form.dated ? " checked" : "") + '> One entry per day <span class="sub">(a dated journal — fill in or fix past days)</span></label>' +
      '<div class="deck-help">Each field routes where you point it: 💰 Money + a dollar/number lands on your spending · 🩺 Health + a 1–5 scale feeds your energy pattern · every other area is saved on the entry for that area to read.</div>' +
      '<div class="deck-scroll fe-list" id="feList"></div>' +
      '<div class="deck-foot"><button class="daily-cta ghost" id="feAdd">＋ Add a field</button><button class="daily-cta" id="feFill">▶ Fill it out</button></div>';
    const listEl = root.querySelector("#feList");
    (form.fields || []).forEach((fl, idx) => { const wrap = document.createElement("div"); wrap.innerHTML = fieldRowHTML(fl, idx); const row = wrap.firstChild; listEl.appendChild(row); wireFieldRow(row, fl, listEl); });
    wireHead();
  }
  function wireFieldRow(row, fl, listEl) {
    const lab = row.querySelector(".fe-label"); lab.addEventListener("input", (e) => { fl.label = e.target.value; persist(); });
    row.querySelector(".fe-type").addEventListener("change", (e) => { fl.ftype = e.target.value; persist(); render(); });
    row.querySelector(".fe-area").addEventListener("change", (e) => { fl.area = e.target.value || ""; if (fl.area !== "Money") delete fl.target; persist(); render(); });
    const tgt = row.querySelector(".fe-tgt"); if (tgt) tgt.addEventListener("input", (e) => { fl.target = e.target.value; persist(); });
    const opts = row.querySelector(".fe-opts"); if (opts) opts.addEventListener("input", (e) => { fl.options = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); persist(); });
    const unit = row.querySelector(".fe-unit"); if (unit) unit.addEventListener("input", (e) => { fl.unit = e.target.value; persist(); });
    row.querySelector(".fe-del").addEventListener("click", () => { form.fields = form.fields.filter((x) => x !== fl); persist(); render(); });
    attachFieldDrag(row, listEl);
  }
  function wireHead() {
    root.querySelector("#feDone").addEventListener("click", close);
    root.querySelector("#feEmoji").addEventListener("input", (e) => { form.emoji = e.target.value || "📋"; persist(); });
    root.querySelector("#feName").addEventListener("input", (e) => { form.name = e.target.value; persist(); });
    root.querySelector("#feDated").addEventListener("change", (e) => { form.dated = e.target.checked ? 1 : 0; persist(); });
    root.querySelector("#feAdd").addEventListener("click", () => { form.fields = (form.fields || []).concat([{ id: fieldId(), label: "", ftype: "text", area: "" }]); persist(); render(); const inp = root.querySelector(".fe-row:last-child .fe-label"); if (inp) inp.focus(); });
    root.querySelector("#feFill").addEventListener("click", () => { if (!(form.fields || []).length) { flash("Add a field first"); return; } const id = form.id; close(); openFormFill(id); });
  }
  const onKey = (e) => { if (e.key === "Escape" && !document.getElementById("formFill")) close(); };
  function close() { root.remove(); document.removeEventListener("keydown", onKey); }
  document.addEventListener("keydown", onKey);
  render();
}

// The FILLER — a single scrollable form (native inputs, big targets). On save it writes a
// money.formData submission and routes money/health fields into the check-in log. A dated form
// lets you pick the day and EDIT that day's entry (prefilled) instead of piling up duplicates.
function openFormFill(formIdArg, opts) {
  if (document.getElementById("formFill")) return;
  const form = loadForms().find((f) => f && f.id === formIdArg && !f.deleted);
  if (!form) return;
  const fields = (form.fields || []);
  if (!fields.length) { flash("This form has no fields yet — tap ✎ to add some"); return; }
  opts = opts || {};
  const root = document.createElement("div"); root.id = "formFill"; root.className = "daily-space form-fill";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  let day = form.dated ? (opts.date || todayKey()) : todayKey();
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() { root.remove(); document.removeEventListener("keydown", onKey); }
  document.addEventListener("keydown", onKey);
  // prefill from an existing submission for this (form, day) so a dated form edits its day
  function existingSub() { return form.dated ? formDataLive(loadFormData()).find((s) => s && s.formId === form.id && s.date === day) : null; }
  function valOf(sub, fid) { if (!sub) return ""; const v = (sub.values || []).find((x) => x && x.fieldId === fid); return v ? (v.value == null ? "" : v.value) : ""; }
  function fieldInputHTML(fl, val) {
    const ft = fl.ftype || "text", id = "ffi_" + esc(fl.id);
    if (ft === "notes") return '<textarea class="ff-in" id="' + id + '" placeholder="…">' + esc(val) + "</textarea>";
    if (ft === "date") return '<input class="ff-in" id="' + id + '" type="date" value="' + esc(val) + '">';
    if (ft === "number" || ft === "count") return '<input class="ff-in" id="' + id + '" type="number" inputmode="decimal" value="' + esc(val) + '" placeholder="' + esc(fl.unit || "number") + '">';
    if (ft === "dollar") return '<div class="ff-dollar"><span>$</span><input class="ff-in" id="' + id + '" type="number" inputmode="decimal" step="0.01" value="' + esc(val) + '" placeholder="0.00"></div>';
    if (ft === "duration") return '<input class="ff-in" id="' + id + '" type="number" inputmode="decimal" value="' + esc(val) + '" placeholder="hours">';
    if (ft === "choice") { const os = (fl.options || []); return '<select class="ff-in" id="' + id + '"><option value="">—</option>' + os.map((o) => '<option value="' + esc(o) + '"' + (String(val) === String(o) ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>"; }
    if (ft === "yesno") return '<div class="ff-chips" data-fid="' + esc(fl.id) + '" data-val="' + (val === 1 || val === "1" ? "1" : val === 0 || val === "0" ? "0" : "") + '">' + [["1", "✅ Yes"], ["0", "🚫 No"]].map((o) => '<button type="button" class="ff-chip' + (String(val) === o[0] ? " on" : "") + '" data-v="' + o[0] + '">' + o[1] + "</button>").join("") + "</div>";
    if (ft === "scale") return '<div class="ff-chips" data-fid="' + esc(fl.id) + '" data-val="' + (val === "" ? "" : esc(val)) + '">' + [1, 2, 3, 4, 5].map((n) => '<button type="button" class="ff-chip' + (String(val) === String(n) ? " on" : "") + '" data-v="' + n + '">' + n + "</button>").join("") + "</div>";
    return '<input class="ff-in" id="' + id + '" type="text" value="' + esc(val) + '" placeholder="…">';
  }
  function render() {
    const sub = existingSub();
    root.innerHTML =
      '<div class="daily-top"><button class="daily-icn" id="ffClose" aria-label="close">✕</button>' +
        '<div class="ff-title">' + esc(form.emoji || "📋") + " " + esc(form.name || "Form") + "</div>" +
        '<button class="daily-cta sm" id="ffSave">Save</button></div>' +
      '<div class="ff-scroll">' +
        (form.dated ? '<div class="ff-datebar"><label>Day</label><input type="date" id="ffDate" value="' + esc(day) + '">' + (sub ? '<span class="ff-editing">editing this day</span>' : "") + "</div>" : "") +
        '<div class="ff-fields">' + fields.map((fl) => '<div class="ff-field" data-fid="' + esc(fl.id) + '" data-ftype="' + esc(fl.ftype || "text") + '"><label class="ff-lbl">' + esc(fl.label || "Field") + (fl.area ? ' <span class="ff-area">' + esc(fl.area) + "</span>" : "") + "</label>" + fieldInputHTML(fl, valOf(sub, fl.id)) + "</div>").join("") + "</div>" +
      "</div>";
    root.querySelector("#ffClose").addEventListener("click", close);
    root.querySelector("#ffSave").addEventListener("click", save);
    const dEl = root.querySelector("#ffDate"); if (dEl) dEl.addEventListener("change", (e) => { day = e.target.value || todayKey(); render(); });
    root.querySelectorAll(".ff-chips").forEach((grp) => grp.querySelectorAll(".ff-chip").forEach((b) => b.addEventListener("click", () => { grp.dataset.val = b.dataset.v; grp.querySelectorAll(".ff-chip").forEach((x) => x.classList.toggle("on", x === b)); })));
  }
  function readValues() {
    return fields.map((fl) => {
      const cont = root.querySelector('.ff-field[data-fid="' + (window.CSS && CSS.escape ? CSS.escape(fl.id) : fl.id) + '"]');
      let raw = "";
      if (cont) { if (fl.ftype === "yesno" || fl.ftype === "scale") { const g = cont.querySelector(".ff-chips"); raw = g ? (g.dataset.val || "") : ""; } else { const inp = cont.querySelector(".ff-in"); raw = inp ? inp.value : ""; } }
      return { fieldId: fl.id, value: coerceFormValue(fl.ftype, raw) };
    });
  }
  function save() {
    const values = readValues();
    const answered = values.filter((v) => v.value !== null && v.value !== "");
    if (!answered.length) { flash("Nothing filled in yet"); return; }
    const prev = existingSub();
    const sub = prev
      ? Object.assign({}, prev, { values: values, updated: Date.now() })
      : { id: formSubId(), type: "formsub", formId: form.id, date: day, values: values, updated: Date.now(), ord: Date.now(), ordAt: 0 };
    saveFormData([sub]);
    // route the fields a live reader understands (money spend, health energy) into the log
    const entries = []; fields.forEach((fl) => { const v = values.find((x) => x.fieldId === fl.id); const en = formFieldLogEntry(fl, v ? v.value : null, day); if (en) entries.push(en); });
    appendFormLogEntries(entries);
    const gained = Math.min(10, 2 + answered.length);
    try { if (typeof addExp === "function") addExp(gained); } catch (e) {}
    try { if (typeof logChar === "function") logChar("log", "Form: " + (form.name || "entry") + " · +" + gained + " EXP"); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("cache:forms")); } catch (e) {}
    flash("Saved to your cache · +" + gained + " EXP ✨");
    close();
  }
  render();
}

// Document → form: upload a CSV (headers become fields) or paste a list (Q&A / labels /
// checkboxes). The parse only SEEDS a draft — you land in the designer to confirm.
function openFormDocPicker() {
  if (document.getElementById("formDoc")) return;
  const root = document.createElement("div"); root.id = "formDoc"; root.className = "daily-space form-doc";
  document.body.appendChild(root);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() { root.remove(); document.removeEventListener("keydown", onKey); }
  document.addEventListener("keydown", onKey);
  root.innerHTML =
    '<div class="daily-top"><button class="daily-icn" id="fdClose" aria-label="close">✕</button><div class="deck-sp-title">⬆ Start from a document</div><span class="daily-icn" aria-hidden="true"></span></div>' +
    '<div class="fd-scroll">' +
      '<div class="fd-card"><div class="fd-h">📄 A spreadsheet (CSV)</div><div class="fd-p sub">Its column headers become your fields — types are guessed from the first row. Export from a bank, a tracker, a Google Sheet…</div><button class="frm-btn" id="fdCsv">Choose a .csv file</button></div>' +
      '<div class="fd-card"><div class="fd-h">📝 A list you already have</div><div class="fd-p sub">Paste your questions or labels — one per line. “Weight: 175”, “How did you sleep?”, “[ ] Took meds”, “Mood (1-5)”.</div>' +
        '<textarea class="fd-paste" id="fdPaste" placeholder="Weight: 175&#10;How did you sleep?&#10;[ ] Took meds&#10;Mood (1-5)"></textarea>' +
        '<button class="frm-btn" id="fdBuild">Build a form from this</button></div>' +
      '<div class="fd-note sub">Nothing is saved until you confirm it in the designer.</div>' +
    "</div>";
  root.querySelector("#fdClose").addEventListener("click", close);
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = ".csv,text/csv,.txt,text/plain"; fileInput.style.display = "none"; root.appendChild(fileInput);
  root.querySelector("#fdCsv").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { const f = fileInput.files[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => { const name = f.name.replace(/\.[^.]+$/, ""); const out = /\.csv$/i.test(f.name) ? csvToTemplate(String(reader.result || ""), name) : textToTemplate(String(reader.result || ""), name); if (!out || !out.template.fields.length) { flash("Couldn’t find any fields in that file"); return; } close(); openFormEditor(out.template); }; reader.readAsText(f); fileInput.value = ""; });
  root.querySelector("#fdBuild").addEventListener("click", () => { const txt = root.querySelector("#fdPaste").value; const out = textToTemplate(txt, "Imported form"); if (!out || !out.template.fields.length) { flash("Add a line or two first — one field per line"); return; } close(); openFormEditor(out.template); });
}
// A ROUTINE's detail sheet — name, emoji, the recurrence schedule (feeds routineDueOn), and
// delete (cascades to its steps). Same td-space shell as tasks/questions. Steps are added from
// the routine card in the deck. Members complete log-derived per day; the schedule decides
// which days the routine is "due".
function openRoutineDetail(id) {
  const r0 = loadThings().find((x) => x && x.id === id && x.type === "routine");
  if (!r0 || r0.deleted) return;
  const ex = document.getElementById("taskDetail"); if (ex) ex.remove();
  const root = document.createElement("div"); root.id = "taskDetail"; root.className = "daily-space td-space";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  const get = () => loadThings().find((x) => x && x.id === id) || r0;
  const patch = (p) => { const t = get(); saveThings([Object.assign({}, t, p, { updated: Date.now() })]); try { flash("Saved"); } catch (e) {} };   // a quick bottom toast so autosave is never silent
  const sched = (p) => { const t = get(); patch({ sched: Object.assign({}, t.sched || {}, p) }); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  function render() {
    const r = get();
    root.innerHTML =
      '<div class="daily-top"><button class="daily-icn" id="rdClose" aria-label="close">✕</button><div class="td-htitle">🔁 Routine</div><button class="daily-icn td-del" id="rdDel" aria-label="delete" title="delete">🗑</button></div>' +
      '<div class="td-scroll">' +
        '<div class="qd-titlerow"><input class="qd-emoji" id="rdEmoji" value="' + esc(r.emoji) + '" maxlength="4" aria-label="emoji"><input class="td-title" id="rdName" value="' + esc(r.name) + '" placeholder="routine name…" aria-label="name"></div>' +
        schedPickerHtml(r.sched, esc) +   // the SHARED recurrence picker (habits use the same one)
        '<div class="td-field td-soon"><label>Steps</label><div class="td-soon-txt">Add steps with the ＋ on the routine card in your deck.</div></div>' +
      "</div>";
    wire();
  }
  function wire() {
    root.querySelector("#rdClose").addEventListener("click", close);
    root.querySelector("#rdDel").addEventListener("click", () => {
      const r = get();
      confirmDelete(r && r.name ? r.name : "this routine", () => {
        const all = loadThings(), now = Date.now(), liveBefore = {}; all.forEach((x) => { if (x && !x.deleted) liveBefore[x.id] = 1; });
        saveThings(thingsCascadeDelete(all, id, now).filter((x) => x && x.deleted && liveBefore[x.id]));   // cascade tombstones its steps too
        close();
      });
    });
    const em = root.querySelector("#rdEmoji"); em.addEventListener("change", () => patch({ emoji: em.value }));
    const nm = root.querySelector("#rdName"); nm.addEventListener("change", () => { const v = nm.value.trim(); if (v) patch({ name: v }); });
    schedPickerWire(root, () => get().sched, sched, render);
  }
  render();
}
// The action button opens whatever it's SET to open (the deck by default). A tiny registry
// gives the target indirection the flagship "configurable action button" needs; a settings
// picker can write money.actionTarget later without touching this dispatch.
function actionButtonRun() {
  let target = "deck"; try { target = localStorage.getItem("money.actionTarget") || "deck"; } catch (e) {}
  const fn = ({ deck: openDeck, checkin: openDaily })[target] || openDeck;
  try { fn(); } catch (e) { try { openDeck(); } catch (e2) {} }
}
(function () {
  const b = document.getElementById("dailyBtn"); if (b) b.addEventListener("click", actionButtonRun);
  // ── The action button remembers your touch. Every tap's landing spot is
  //    banked (normalized 0..1) — the raw material for the living, wearing,
  //    heat-mapped button of the FLAGSHIP action-button vision. Starts now so
  //    the future button is born with real history. ──
  if (b) b.addEventListener("pointerdown", (e) => {
    try {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const pt = [Math.round(((e.clientX - r.left) / r.width) * 100) / 100, Math.round(((e.clientY - r.top) / r.height) * 100) / 100];
      const taps = JSON.parse(localStorage.getItem("money.actionTaps") || "[]");
      taps.push(pt);
      localStorage.setItem("money.actionTaps", JSON.stringify(taps.slice(-1000)));
    } catch (err) {}
  });
  // returning users who finished setup before the coach existed, and have never
  // run the deck: one gentle nudge, once
  setTimeout(() => {
    try { if (localStorage.getItem(WIZ_KEY) && !localStorage.getItem(DECKCOACH_KEY) && loadLog().length === 0) showDeckCoach(); } catch (e) {}
  }, 1800);
  ckSync();   // converge with the cache on boot…
  document.addEventListener("visibilitychange", () => {
    // …and every return to the tab (log on your phone, walk to the desk, it's there).
    // maybeWhatsChanged retries here so a pop deferred because the tab was hidden (or you
    // were typing when the poll fired) still lands, without needing its own queue.
    if (!document.hidden) { ckSync(); cloudAutoPull(); try { maybeWhatsChanged(); } catch (e) {} }
    else if (_apT) autoPushNow();   // leaving the tab with a push pending → flush it now
  });
})();

// ── THE CALENDAR — a full-screen SURFACE (a lens, NOT a 13th area; areas are fixed at 12).
//    It reads date-bearing data from across your cache and lays it on a month / day grid:
//    dated tasks (t.due), routine occurrences (routineDueOn driven across the visible range,
//    §Brick 0), and events (type:"event", added in a later brick). It is a LENS — tapping any
//    item opens THAT item's own editor; the calendar never owns the data. Its own launcher
//    (📅) sits by the action button and NEVER touches it (openDeck/actionButtonRun are the
//    parallel session's). Local-day throughout, matching the recurrence engine.
function calWeekdayLabels(weekStart) {
  const base = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; weekStart = weekStart || 0;
  return base.slice(weekStart).concat(base.slice(0, weekStart));
}
// the 6×7 month grid for the month containing anchorYmd, aligned to weekStart. Always 42 cells
// (stable height); leading/trailing days from adjacent months are flagged inMonth:false.
function calMonthGrid(anchorYmd, weekStart) {
  weekStart = weekStart || 0;
  const a = _ymd2date(anchorYmd) || new Date(), y = a.getFullYear(), m = a.getMonth();
  const lead = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
  const gs = new Date(y, m, 1 - lead), cells = [];
  for (let i = 0; i < 42; i++) { const d = new Date(gs.getFullYear(), gs.getMonth(), gs.getDate() + i); cells.push({ ymd: ymdOf(d), inMonth: d.getMonth() === m, day: d.getDate() }); }
  return cells;
}
// The day-JOIN: every live Thing landing on one local day, split by kind. Tasks land on their
// due date; a non-recurring event spans start..end (inclusive); a recurring event or a routine
// matches via routineDueOn. Routine MEMBERS (routine:<id>) are not standalone items here — the
// routine container carries the occurrence. Pass thingsVisible(loadThings()) so tombstoned /
// dangling subtrees are already filtered (same liveness rule as the Tasks widget).
function calThingsOnDay(things, ymd) {
  const tasks = [], events = [], routines = [], habits = [];
  (things || []).forEach((t) => {
    if (!t || t.deleted) return;
    if (t.type === "task" && !t.routine) { if (t.due === ymd) tasks.push(t); }
    else if (t.type === "event") {
      if (t.sched) { if (routineDueOn(t.sched, ymd)) events.push(t); }
      else { const s = t.start, e = t.end || t.start; if (s && ymd >= s && ymd <= e) events.push(t); }
    } else if (t.type === "routine") { if (routineDueOn(t.sched, ymd)) routines.push(t); }
    // a habit with an EXPLICIT schedule spreads through the same engine as a routine. No
    // sched = a plain daily habit that lives in the deck, NOT on the calendar — otherwise
    // every habit would paint every single day (noise). A routine member's occurrence is
    // carried by its routine, never doubled here.
    else if (t.type === "habit" && !t.routine) { if (t.sched && routineDueOn(t.sched, ymd)) habits.push(t); }
  });
  return { tasks: tasks, events: events, routines: routines, habits: habits };
}
// the 7 local days of the week (aligned to weekStart) containing anchorYmd.
function calWeekDays(anchorYmd, weekStart) {
  weekStart = weekStart || 0;
  const d = _ymd2date(anchorYmd) || new Date(), off = (d.getDay() - weekStart + 7) % 7;
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - off), out = [];
  for (let i = 0; i < 7; i++) { const dd = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i); out.push(ymdOf(dd)); }
  return out;
}
// Check a ONE-OFF task off from the calendar — same rule as the Tasks widget: a plain task's
// done is a flag ON the object (routine members / habits recur and are log-derived, never shown
// as checkable here). Logs the completion + awards EXP so the calendar and the deck agree.
function calToggleTask(id, ymd) {
  const all = loadThings(), t = all.find((x) => x && x.id === id);
  if (!t || t.routine) return;
  if (t.type === "habit") {
    // a yes/no habit checks off from the calendar too — log-derived for THAT day (never a flag),
    // exactly like the deck. Amount/rating/text habits open their detail instead (no checkbox).
    if ((t.track || "check") !== "check") return;
    const day = ymd || todayKey(), done = thingDoneOn(loadLog(), id, day);
    try { logThingEvent(id, done ? "undone" : "done", { items: all, ts: day }); } catch (e) {}
    if (!done) { try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Habit done · +2 EXP"); } catch (e) {} }
    return;
  }
  if (t.type !== "task") return;
  const now = Date.now(), next = t.done ? 0 : 1;
  saveThings([Object.assign({}, t, { done: next, doneAt: next ? now : null, updated: now })]);
  try { logThingEvent(id, next ? "done" : "undone", { items: all }); } catch (e) {}
  if (next) { try { if (typeof addExp === "function") addExp(2); } catch (e) {} try { if (typeof logChar === "function") logChar("log", "Task done · +2 EXP"); } catch (e) {} }
}
function openCalendar() {
  if (document.getElementById("calSpace")) return;
  const root = document.createElement("div"); root.id = "calSpace"; root.className = "daily-space cal-space";
  document.body.appendChild(root);
  // durable, SYNCED prefs (money.calview) — a GENERIC key: default view, week-start, and how
  // the month grid paints routines. Auto-classified GENERIC (per-key newest-wins), so it rides
  // the vault with no merge/registration code. The transient cursor stays in memory.
  let prefs = {}; try { prefs = JSON.parse(localStorage.getItem("money.calview") || "{}") || {}; } catch (e) {}
  let weekStart = prefs.weekStart === 1 ? 1 : 0;                                  // 0 = Sunday (default), 1 = Monday
  let view = (prefs.view === "day" || prefs.view === "week") ? prefs.view : "month";
  let density = prefs.density === "chips" ? "chips" : "dots";                     // month grid: routines as dots (calm) or names
  let settingsOpen = false;
  let infinite = false;                   // endless-scroll mode (∞ toggle) — OFF by default, transient per open
  let infAnchors = [];                    // period-anchor ymds currently stacked, in order (infinite mode)
  let cursor = todayKey();                // the focused day (its month/week, in those views)
  const savePrefs = () => { try { localStorage.setItem("money.calview", JSON.stringify({ view: view, weekStart: weekStart, density: density })); } catch (e) {} };
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  const onKey = (e) => { if (e.key === "Escape" && !document.getElementById("taskDetail")) close(); };   // a detail sheet open on top handles its own Escape first
  const onCache = () => { if (root.isConnected) render(); else cleanup(); };   // a peer's sync landed → repaint
  const cleanup = () => { document.removeEventListener("keydown", onKey); document.removeEventListener("cache:things", onCache); document.removeEventListener("cache:logged", onCache); };
  const close = () => { root.remove(); cleanup(); };
  document.addEventListener("keydown", onKey);
  document.addEventListener("cache:things", onCache);
  document.addEventListener("cache:logged", onCache);
  const monthTitle = (ymd) => { const d = _ymd2date(ymd); return d ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : ""; };
  const dayTitle = (ymd) => { const d = _ymd2date(ymd); return d ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""; };
  const chipsOf = (j) => {              // discrete, high-signal items → text chips (events first, then dated tasks)
    const out = [];
    j.events.forEach((e) => out.push({ cls: "event", em: e.emoji || "📌", tx: (!e.allDay && e.startTime ? e.startTime + " " : "") + (e.title || "Event") }));
    j.tasks.forEach((t) => out.push({ cls: "task" + (t.done ? " done" : ""), em: t.emoji || "✅", tx: t.title || "Task" }));
    return out;
  };
  function renderMonth() {
    const cells = calMonthGrid(cursor, weekStart), things = thingsVisible(loadThings()), today = todayKey();
    const dow = calWeekdayLabels(weekStart).map((d) => "<span>" + d + "</span>").join("");
    const cellHtml = cells.map((c) => {
      const j = calThingsOnDay(things, c.ymd), et = chipsOf(j);   // events + dated tasks → chips
      const rec = j.routines.concat(j.habits);   // the recurring layer — routines + scheduled habits, one visual family
      const chips = density === "chips" ? et.concat(rec.map((r) => ({ cls: "routine", em: r.emoji || (r.type === "habit" ? "↻" : "🔁"), tx: r.name || r.title || "Routine" }))) : et;
      const shown = chips.slice(0, 3), extra = chips.length - shown.length;
      const chipsH = shown.map((ch) => '<span class="cal-chip ' + ch.cls + '"><span class="ci-em" aria-hidden="true">' + ch.em + '</span><span class="ci-tx">' + esc(ch.tx) + "</span></span>").join("");
      const rdots = density === "dots" ? rec.slice(0, 5).map((r) => '<span class="cal-dot" title="' + esc(r.name || r.title || "routine") + '"></span>').join("") : "";
      const nDots = (et.length ? '<span class="cal-dot cal-dot-i"></span>' : "") + rec.slice(0, 5).map((r) => '<span class="cal-dot" title="' + esc(r.name || r.title || "routine") + '"></span>').join("");   // narrow: always dots
      return '<button class="cal-cell' + (c.inMonth ? "" : " other") + (c.ymd === today ? " today" : "") + '" data-ymd="' + c.ymd + '" aria-label="' + esc(dayTitle(c.ymd)) + '">' +
        '<span class="cal-daynum">' + c.day + "</span>" +
        '<div class="cal-items">' + chipsH + (extra > 0 ? '<span class="cal-more">+' + extra + " more</span>" : "") + (rdots ? '<div class="cal-dots">' + rdots + "</div>" : "") + "</div>" +
        '<div class="cal-dotsrow">' + nDots + (extra > 0 ? '<span class="cal-more">+' + extra + "</span>" : "") + "</div>" +
        "</button>";
    }).join("");
    return '<div class="cal-month"><div class="cal-dow">' + dow + '</div><div class="cal-grid">' + cellHtml + "</div></div>";
  }
  function itemRow(act, id, em, tx, sub, done, checkable, ymd) {
    return '<div class="cal-arow' + (done ? " done" : "") + '" data-act="' + act + '" data-id="' + esc(id) + '" role="button" tabindex="0">' +
      (checkable
        ? '<button class="cal-check' + (done ? " on" : "") + '" data-check="' + esc(id) + '"' + (ymd ? ' data-ymd="' + esc(ymd) + '"' : "") + ' aria-label="' + (done ? "mark not done" : "mark done") + '"></button>'
        : '<span class="cal-arow-em" aria-hidden="true">' + em + "</span>") +
      '<span class="cal-arow-tx">' + esc(tx) + (sub ? '<span class="cal-arow-sub">' + esc(sub) + "</span>" : "") + "</span>" +
      '<span class="cal-arow-go" aria-hidden="true">›</span></div>';
  }
  function renderDay() {
    const log = loadLog(), things = thingsVisible(loadThings()), j = calThingsOnDay(things, cursor), rows = [];
    j.events.forEach((e) => rows.push(itemRow("event", e.id, e.emoji || "📌", e.title || "Event", (!e.allDay && e.startTime ? e.startTime + (e.endTime ? "–" + e.endTime : "") : e.allDay ? "all day" : ""), false, false)));
    j.tasks.forEach((t) => rows.push(itemRow("detail", t.id, t.emoji || "✅", t.title || "Task", t.dueTime ? "due " + t.dueTime : "due", !!t.done, true)));
    j.habits.forEach((h) => rows.push(itemRow("detail", h.id, "↻", h.title || "Habit", "habit", thingDoneOn(log, h.id, cursor), (h.track || "check") === "check", cursor)));   // scheduled habits — log-derived per day; yes/no checks off in place
    j.routines.forEach((r) => {
      const members = things.filter((x) => x && x.routine === r.id), doneCt = members.filter((m) => thingDoneOn(log, m.id, cursor)).length;
      rows.push(itemRow("rdetail", r.id, r.emoji || "🔁", r.name || "Routine", members.length ? doneCt + "/" + members.length + " done" : "routine", members.length > 0 && doneCt === members.length, false));
    });
    return '<div class="cal-day"><button class="cal-addevent" data-ymd="' + cursor + '">＋ New event</button>' +
      (rows.length ? '<div class="cal-agenda">' + rows.join("") + "</div>" : '<div class="cal-empty sub">Nothing on the calendar for this day yet.</div>') + "</div>";
  }
  function renderWeek() {
    const log = loadLog(), things = thingsVisible(loadThings()), today = todayKey(), days = calWeekDays(cursor, weekStart);
    const blocks = days.map((ymd) => {
      const j = calThingsOnDay(things, ymd), d = _ymd2date(ymd), rows = [];
      j.events.forEach((e) => rows.push(itemRow("event", e.id, e.emoji || "📌", e.title || "Event", (!e.allDay && e.startTime ? e.startTime : e.allDay ? "all day" : ""), false, false)));
      j.tasks.forEach((t) => rows.push(itemRow("detail", t.id, t.emoji || "✅", t.title || "Task", t.dueTime ? "due " + t.dueTime : "", !!t.done, true)));
      j.habits.forEach((h) => rows.push(itemRow("detail", h.id, "↻", h.title || "Habit", "", thingDoneOn(log, h.id, ymd), (h.track || "check") === "check", ymd)));
      j.routines.forEach((r) => { const members = things.filter((x) => x && x.routine === r.id), doneCt = members.filter((m) => thingDoneOn(log, m.id, ymd)).length; rows.push(itemRow("rdetail", r.id, r.emoji || "🔁", r.name || "Routine", members.length ? doneCt + "/" + members.length : "", members.length > 0 && doneCt === members.length, false)); });
      return '<div class="cal-wday' + (ymd === today ? " today" : "") + '"><button class="cal-wday-head" data-ymd="' + ymd + '"><span class="cal-wday-dow">' + d.toLocaleDateString("en-US", { weekday: "short" }) + '</span><span class="cal-wday-num">' + d.getDate() + "</span></button>" +
        (rows.length ? '<div class="cal-wrows">' + rows.join("") + "</div>" : '<div class="cal-wempty" aria-hidden="true">·</div>') + "</div>";
    }).join("");
    return '<div class="cal-week">' + blocks + "</div>";
  }
  function calTitle() {
    if (view === "day") return dayTitle(cursor);
    if (view === "week") { const w = calWeekDays(cursor, weekStart), a = _ymd2date(w[0]), b = _ymd2date(w[6]); return a.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " – " + b.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    return monthTitle(cursor);
  }
  function settingsHtml() {
    if (!settingsOpen) return "";
    return '<div class="cal-settings">' +
      '<div class="cal-setrow"><span class="cal-setlbl">Week starts</span><div class="td-seg" id="calWeekStart"><button data-ws="0"' + (weekStart === 0 ? ' class="on"' : "") + ">Sun</button><button data-ws=\"1\"" + (weekStart === 1 ? ' class="on"' : "") + ">Mon</button></div></div>" +
      '<div class="cal-setrow"><span class="cal-setlbl">Month grid routines as</span><div class="td-seg" id="calDensity"><button data-den="dots"' + (density === "dots" ? ' class="on"' : "") + ">Dots</button><button data-den=\"chips\"" + (density === "chips" ? ' class="on"' : "") + ">Names</button></div></div>" +
    "</div>";
  }
  function render() {
    root.innerHTML =
      '<div class="daily-top">' +
        '<button class="daily-icn" id="calClose" aria-label="close">✕</button>' +
        '<div class="cal-titlewrap"><button class="cal-nav" id="calPrev" aria-label="previous">‹</button><div class="cal-title">' + esc(calTitle()) + '</div><button class="cal-nav" id="calNext" aria-label="next">›</button></div>' +
        '<div class="cal-headright"><button class="cal-today" id="calToday">Today</button><button class="daily-icn cal-inf-btn' + (infinite ? " on" : "") + '" id="calInf" aria-pressed="' + (infinite ? "true" : "false") + '" aria-label="endless scroll" title="endless scroll — flow through the calendar">∞</button><button class="daily-icn cal-gear' + (settingsOpen ? " on" : "") + '" id="calGear" aria-label="calendar settings" title="week start &amp; density">⚙</button></div>' +
      "</div>" +
      '<div class="cal-viewbar"><div class="td-seg cal-seg" id="calSeg">' +
        '<button data-view="month"' + (view === "month" ? ' class="on"' : "") + ">Month</button>" +
        '<button data-view="week"' + (view === "week" ? ' class="on"' : "") + ">Week</button>" +
        '<button data-view="day"' + (view === "day" ? ' class="on"' : "") + ">Day</button>" +
      "</div></div>" +
      settingsHtml() +
      '<div class="cal-body' + (infinite ? " cal-body-inf" : "") + '" id="calBody">' + (infinite ? "" : (view === "day" ? renderDay() : view === "week" ? renderWeek() : renderMonth())) + "</div>";
    wire();
    if (infinite) buildInfinite();   // stack consecutive periods + wire endless scroll
  }
  function step(dir) {
    const d = _ymd2date(cursor) || new Date();
    if (view === "day") cursor = ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir));
    else if (view === "week") cursor = ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7));
    else cursor = ymdOf(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    render();
  }
  function wire() {
    root.querySelector("#calClose").addEventListener("click", close);
    root.querySelector("#calPrev").addEventListener("click", () => step(-1));
    root.querySelector("#calNext").addEventListener("click", () => step(1));
    root.querySelector("#calToday").addEventListener("click", () => { cursor = todayKey(); render(); });
    root.querySelectorAll("#calSeg button").forEach((b) => b.addEventListener("click", () => { view = b.dataset.view; savePrefs(); render(); }));
    const gear = root.querySelector("#calGear"); if (gear) gear.addEventListener("click", () => { settingsOpen = !settingsOpen; render(); });
    root.querySelectorAll("#calWeekStart button").forEach((b) => b.addEventListener("click", () => { weekStart = b.dataset.ws === "1" ? 1 : 0; savePrefs(); render(); }));
    root.querySelectorAll("#calDensity button").forEach((b) => b.addEventListener("click", () => { density = b.dataset.den === "chips" ? "chips" : "dots"; savePrefs(); render(); }));
    root.querySelectorAll(".cal-cell").forEach((c) => c.addEventListener("click", () => { cursor = c.dataset.ymd; view = "day"; render(); }));   // tap a day → that day's agenda
    root.querySelectorAll(".cal-wday-head").forEach((h) => h.addEventListener("click", () => { cursor = h.dataset.ymd; view = "day"; render(); }));   // tap a week-day header → its agenda
    root.querySelectorAll(".cal-check").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); try { calToggleTask(c.dataset.check, c.dataset.ymd); } catch (er) {} }));   // check a task/habit off in place (habits per-day); onCache repaints
    root.querySelectorAll(".cal-arow").forEach((r) => {
      const openRow = () => { const id = r.dataset.id, act = r.dataset.act; try { if (act === "detail") openTaskDetail(id); else if (act === "rdetail") openRoutineDetail(id); else if (act === "event") openEventDetail(id); } catch (e) {} };
      r.addEventListener("click", openRow);
      r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(); } });
    });
    const inf = root.querySelector("#calInf"); if (inf) inf.addEventListener("click", () => { infinite = !infinite; render(); });   // endless-scroll toggle
    root.querySelectorAll(".cal-addevent").forEach((ae) => ae.addEventListener("click", () => { try { calAddEvent(ae.dataset.ymd || cursor); } catch (e) {} }));   // new event on that day
  }
  // ── Endless scroll (∞) ─ stack consecutive periods and append/prepend as you scroll, so the
  //    dates flow continuously. Parameterized by `view`, so one engine covers month/week/day.
  function periodAnchor(ymd) {   // normalize any day to its period's anchor
    const d = _ymd2date(ymd) || new Date();
    if (view === "day") return ymdOf(d);
    if (view === "week") return calWeekDays(ymdOf(d), weekStart)[0];
    return ymdOf(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  function periodStep(anchor, dir) {   // the anchor one period earlier / later
    const d = _ymd2date(anchor) || new Date();
    if (view === "day") return ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir));
    if (view === "week") return ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7));
    return ymdOf(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }
  function periodLabel(anchor) {
    if (view === "day") return dayTitle(anchor);
    if (view === "week") { const w = calWeekDays(anchor, weekStart), a = _ymd2date(w[0]), b = _ymd2date(w[6]); return a.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " – " + b.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    return monthTitle(anchor);
  }
  function renderPeriod(anchor) {   // one period's content, wrapped with a sticky label (renderers read `cursor`)
    const saved = cursor; cursor = anchor;
    const inner = view === "day" ? renderDay() : view === "week" ? renderWeek() : renderMonth();
    cursor = saved;
    return '<section class="cal-inf-sec" data-anchor="' + anchor + '"><div class="cal-inf-h">' + esc(periodLabel(anchor)) + "</div>" + inner + "</section>";
  }
  function onInfClick(e) {   // delegated — the stacked sections are dynamic, so one handler covers all
    const cell = e.target.closest(".cal-cell"); if (cell) { cursor = cell.dataset.ymd; view = "day"; render(); return; }
    const wh = e.target.closest(".cal-wday-head"); if (wh) { cursor = wh.dataset.ymd; view = "day"; render(); return; }
    const chk = e.target.closest(".cal-check"); if (chk) { e.stopPropagation(); try { calToggleTask(chk.dataset.check, chk.dataset.ymd); } catch (er) {} return; }
    const add = e.target.closest(".cal-addevent"); if (add) { try { calAddEvent(add.dataset.ymd || cursor); } catch (er) {} return; }
    const arow = e.target.closest(".cal-arow"); if (arow) { const id = arow.dataset.id, act = arow.dataset.act; try { if (act === "detail") openTaskDetail(id); else if (act === "rdetail") openRoutineDetail(id); else if (act === "event") openEventDetail(id); } catch (er) {} }
  }
  function buildInfinite() {
    const body = root.querySelector("#calBody"); if (!body) return;
    const start = periodAnchor(cursor);
    infAnchors = [periodStep(start, -1), start, periodStep(start, 1)];   // seed: prev, current, next
    body.innerHTML = infAnchors.map(renderPeriod).join("");
    const cur = body.querySelector('.cal-inf-sec[data-anchor="' + start + '"]');   // center on the current period
    if (cur) body.scrollTop = cur.offsetTop;
    body.addEventListener("click", onInfClick);
    let busy = false;
    body.addEventListener("scroll", () => {
      if (busy) return;
      if (body.scrollHeight - body.scrollTop - body.clientHeight < 260) {   // near bottom → append the next period
        busy = true;
        const next = periodStep(infAnchors[infAnchors.length - 1], 1);
        infAnchors.push(next); body.insertAdjacentHTML("beforeend", renderPeriod(next));
        busy = false;
      } else if (body.scrollTop < 160) {   // near top → prepend, preserving scroll position (no jump)
        busy = true;
        const prev = periodStep(infAnchors[0], -1);
        infAnchors.unshift(prev);
        const h0 = body.scrollHeight; body.insertAdjacentHTML("afterbegin", renderPeriod(prev));
        body.scrollTop += body.scrollHeight - h0;
        busy = false;
      }
      // track which period is at the top, so a live-sync re-render re-seeds near where you are
      const secs = body.querySelectorAll(".cal-inf-sec"); let vis = secs[0];
      for (let i = 0; i < secs.length; i++) { if (secs[i].offsetTop <= body.scrollTop + 8) vis = secs[i]; else break; }
      if (vis) cursor = vis.dataset.anchor;
    });
  }
  render();
}
// ── EVENTS (type:"event") — a first-class Thing on money.things, so it inherits the ENTIRE
//    proven per-item merge / tombstone / sync stack for free (no backend, no webcache, no
//    store.py change). An event is a SPAN (start..end) with an optional time, distinct from a
//    task's `due` (a deadline). Recurrence via `sched` (reusing routineDueOn) arrives in the
//    next brick. Non-negotiables (deck contract): a stable id minted ONCE by thingId(); a
//    reschedule is an EDIT (same id, bump updated); a cancel is a TOMBSTONE, never array removal.
function calAddEvent(ymd) {
  const now = Date.now(), id = thingId();
  const sibs = thingsVisible(loadThings()).filter((x) => x && x.type === "event");
  const ord = sibs.reduce((m, x) => Math.max(m, +x.ord || 0), 0) + 1;
  saveThings([{ id: id, type: "event", title: "", emoji: "📌", start: ymd || todayKey(), end: null, allDay: 0, startTime: null, endTime: null, area: null, notes: "", sched: null, updated: now, ord: ord, ordAt: now, deleted: 0, parent: null, routine: null }]);
  try { openEventDetail(id); } catch (e) {}
}
// An event's detail sheet — cloned from openTaskDetail (td-space shell): emoji + title, timed
// vs all-day, start/end date + time (native inputs → correct mobile keyboards), the shared
// 12-area picker, notes, delete. Every edit merges per-item through saveThings (vault-only).
function openEventDetail(id) {
  const e0 = loadThings().find((x) => x && x.id === id && x.type === "event");
  if (!e0 || e0.deleted) return;
  const ex = document.getElementById("taskDetail"); if (ex) ex.remove();
  const root = document.createElement("div"); root.id = "taskDetail"; root.className = "daily-space td-space";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  const get = () => loadThings().find((x) => x && x.id === id) || e0;
  const patch = (p) => { const t = get(); saveThings([Object.assign({}, t, p, { updated: Date.now() })]); };
  const onKey = (ev) => { if (ev.key === "Escape") close(); };
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  const setSched = (p) => { const cur = get(); patch({ sched: Object.assign({}, cur.sched || {}, p) }); };   // merge a patch into the event's sched
  function render() {
    const t = get(), allDay = !!t.allDay, s = t.sched, recurring = !!s, freq = s ? (s.freq || "daily") : "daily";
    const days = s && Array.isArray(s.days) ? s.days.map(String) : [];
    const FREQS = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]];
    const DOW = [["0", "S"], ["1", "M"], ["2", "T"], ["3", "W"], ["4", "T"], ["5", "F"], ["6", "S"]];
    const everyUnit = freq === "weekly" ? "week(s)" : freq === "monthly" ? "month(s)" : freq === "yearly" ? "year(s)" : "day(s)";
    const areaChips = TD_AREAS.map((a) => '<button class="td-area' + (t.area === a[1] ? " on" : "") + '" data-area="' + esc(a[1]) + '">' + a[0] + " " + esc(a[1]) + "</button>").join("") +
      (t.area ? '<button class="td-area td-area-clear" data-area="">✕ clear</button>' : "");
    const timeStart = (!allDay ? '<input type="time" class="td-due" id="edStartTime" value="' + esc(t.startTime) + '" aria-label="start time">' : "");
    const recurFields = recurring
      ? '<div class="td-field"><label>Repeats</label><div class="td-seg" id="edFreq">' + FREQS.map((fq) => '<button data-freq="' + fq[0] + '"' + (freq === fq[0] ? ' class="on"' : "") + ">" + fq[1] + "</button>").join("") + "</div></div>"
        + (freq === "weekly" ? '<div class="td-field"><label>On these days</label><div class="rd-days" id="edDays">' + DOW.map((d) => '<button class="rd-day' + (days.indexOf(d[0]) !== -1 ? " on" : "") + '" data-dow="' + d[0] + '">' + d[1] + "</button>").join("") + "</div></div>" : "")
        + '<div class="td-field"><label>Every</label><div class="rd-every"><input type="number" inputmode="numeric" class="rd-everyin" id="edEvery" value="' + esc(s.every || 1) + '" min="1"><span class="rd-everylbl">' + everyUnit + "</span></div></div>"
        + '<div class="td-field"><label>Until (optional)</label><input type="date" class="td-due" id="edUntil" value="' + esc(s.end) + '" aria-label="repeat until"></div>'
      : "";
    root.innerHTML =
      '<div class="daily-top"><button class="daily-icn" id="edClose" aria-label="close">✕</button><div class="td-htitle">📅 Event</div><button class="daily-icn td-del" id="edDel" aria-label="delete" title="delete">🗑</button></div>' +
      '<div class="td-scroll">' +
        '<div class="qd-titlerow"><input class="qd-emoji" id="edEmoji" value="' + esc(t.emoji) + '" maxlength="4" aria-label="emoji"><input class="td-title" id="edTitle" value="' + esc(t.title) + '" placeholder="what is it…" aria-label="title"></div>' +
        '<div class="td-field"><label>Kind</label><div class="td-seg" id="edAllday"><button data-allday="0"' + (!allDay ? ' class="on"' : "") + ">Timed</button><button data-allday=\"1\"" + (allDay ? ' class="on"' : "") + ">All day</button></div></div>" +
        '<div class="td-field"><label>' + (recurring ? "First on" : "Starts") + '</label><div class="td-due-row"><input type="date" class="td-due" id="edStart" value="' + esc(t.start) + '" aria-label="start date">' + timeStart + "</div></div>" +
        (recurring ? "" : '<div class="td-field"><label>Ends (optional)</label><div class="td-due-row"><input type="date" class="td-due" id="edEnd" value="' + esc(t.end) + '" aria-label="end date">' + (!allDay ? '<input type="time" class="td-due" id="edEndTime" value="' + esc(t.endTime) + '" aria-label="end time">' : "") + "</div></div>") +
        '<div class="td-field rd-pausefield"><label class="rd-pauselbl"><input type="checkbox" id="edRepeat"' + (recurring ? " checked" : "") + "> Repeat this event</label></div>" +
        recurFields +
        '<div class="td-field"><label>Area — where it belongs</label><div class="td-areas">' + areaChips + "</div></div>" +
        '<div class="td-field"><label>Notes</label><textarea class="td-notes" id="edNotes" placeholder="anything to remember…" aria-label="notes">' + esc(t.notes) + "</textarea></div>" +
      "</div>";
    wire();
  }
  function wire() {
    root.querySelector("#edClose").addEventListener("click", close);
    root.querySelector("#edDel").addEventListener("click", () => {
      const ev = loadThings().find((x) => x && x.id === id);
      confirmDelete(ev && ev.title ? ev.title : "this event", () => {
        const all = loadThings(), now = Date.now(), liveBefore = {}; all.forEach((x) => { if (x && !x.deleted) liveBefore[x.id] = 1; });
        saveThings(thingsCascadeDelete(all, id, now).filter((x) => x && x.deleted && liveBefore[x.id]));
        close();
      });
    });
    const em = root.querySelector("#edEmoji"); em.addEventListener("change", () => patch({ emoji: em.value }));
    const ti = root.querySelector("#edTitle"); ti.addEventListener("change", () => { const v = ti.value.trim(); if (v) patch({ title: v }); });
    root.querySelectorAll("#edAllday button").forEach((b) => b.addEventListener("click", () => { patch({ allDay: b.dataset.allday === "1" ? 1 : 0 }); render(); }));
    root.querySelector("#edStart").addEventListener("change", (e) => {   // keep the recurrence anchor in step with the start date
      const v = e.target.value || todayKey(), cur = get(), p = { start: v };
      if (cur.sched) p.sched = Object.assign({}, cur.sched, { start: v });
      patch(p);
    });
    const st = root.querySelector("#edStartTime"); if (st) st.addEventListener("change", (e) => patch({ startTime: e.target.value || null }));
    const en = root.querySelector("#edEnd"); if (en) en.addEventListener("change", (e) => patch({ end: e.target.value || null }));
    const et = root.querySelector("#edEndTime"); if (et) et.addEventListener("change", (e) => patch({ endTime: e.target.value || null }));
    const rep = root.querySelector("#edRepeat"); rep.addEventListener("change", () => {
      if (rep.checked) { const t = get(), d = _ymd2date(t.start) || new Date(); patch({ sched: { freq: "weekly", every: 1, days: [d.getDay()], start: t.start } }); }   // sensible default: weekly on the start weekday
      else patch({ sched: null });
      render();
    });
    root.querySelectorAll("#edFreq button").forEach((b) => b.addEventListener("click", () => { setSched({ freq: b.dataset.freq }); render(); }));
    root.querySelectorAll(".rd-day").forEach((b) => b.addEventListener("click", () => { const s = get().sched || {}, days = Array.isArray(s.days) ? s.days.map(Number) : [], d = +b.dataset.dow, i = days.indexOf(d); if (i === -1) days.push(d); else days.splice(i, 1); setSched({ days: days.sort((x, y) => x - y) }); render(); }));
    const ev = root.querySelector("#edEvery"); if (ev) ev.addEventListener("change", () => setSched({ every: Math.max(1, parseInt(ev.value) || 1) }));
    const un = root.querySelector("#edUntil"); if (un) un.addEventListener("change", (e) => setSched({ end: e.target.value || null }));
    root.querySelectorAll(".td-area").forEach((b) => b.addEventListener("click", () => { patch({ area: b.dataset.area || null }); render(); }));
    const nt = root.querySelector("#edNotes"); nt.addEventListener("change", () => patch({ notes: nt.value }));
  }
  render();
}
(function () { const b = document.getElementById("calBtn"); if (b) b.addEventListener("click", openCalendar); })();   // the calendar's OWN launcher — never the action button

// ══ SOCIAL MESSAGES (Community area #7 · P5 social layer) ═══════════════════════════════
//    End-to-end-encrypted DMs between Cache accounts, found by a public @username. The three
//    non-negotiables from the docs: OPT-IN (undiscoverable until you claim a handle), lone-wolf
//    stays 100% local (nothing here fires without a cloud login + opt-in), and the SERVER NEVER
//    READS a message body (sealed client-side; PocketBase stores ciphertext only).
//
//    Backend: three PocketBase collections Cozy creates in the pockethost admin —
//      profiles     {owner(rel users, uniq), username(text, uniq), pubkey(text), name(text)}
//      friendships  {from(rel users), to(rel users), status(select pending/accepted/blocked)}
//      messages     {from(rel users), to(rel users), body(text "iv:ct"), epub(text, reserved)}
//    All three no-op gracefully (try/catch per call) until they exist, so a half-set-up account
//    just sees a calm empty state instead of an error. See the hand-off note for exact schemas.
//
//    Crypto: a per-account static ECDH P-256 keypair. The PUBLIC key is published in the profile;
//    the PRIVATE key lives in money.msgKey which rides the E2E vault (GENERIC, encrypted), so your
//    identity follows you across your own devices. A→B seals with AES-GCM under the ECDH shared
//    secret of (myPriv, theirPub); B opens with (theirPub, myPriv) — the same symmetric key, so
//    both ends read the thread and only the pair can. Known v1 limits: TOFU trust on published
//    pubkeys (no out-of-band verify yet) and no forward secrecy (the reserved `epub` field is the
//    hook for a future ephemeral/ratchet upgrade).
const SOCIAL_KEY = "money.social", MSGKEY_KEY = "money.msgKey", DMS_KEY = "money.dms";
function socialState() { try { return JSON.parse(localStorage.getItem(SOCIAL_KEY) || "{}") || {}; } catch (e) { return {}; } }
function socialSaveState(s) { try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(s)); } catch (e) {} }
function socialLoggedIn() { return !!cloudState().token; }                       // messaging follows the LOGIN, not the vault-pause toggle
function socialReady() { return socialLoggedIn() && !!socialState().optedIn; }   // logged in AND claimed a handle
function socialNormHandle(h) { return String(h == null ? "" : h).trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9_]/g, ""); }
function socialHandleValid(h) { return /^[a-z0-9_]{3,20}$/.test(h); }
// ── the identity keypair (ECDH P-256) ──
function msgKeyGet() { try { return JSON.parse(localStorage.getItem(MSGKEY_KEY) || "null"); } catch (e) { return null; } }
function msgKeySet(o) { try { localStorage.setItem(MSGKEY_KEY, JSON.stringify(o)); } catch (e) {} }
async function socialEnsureKeypair() {
  let kp = msgKeyGet();
  if (kp && kp.priv && kp.pub) return kp;
  const g = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  kp = { priv: await crypto.subtle.exportKey("jwk", g.privateKey), pub: await crypto.subtle.exportKey("jwk", g.publicKey) };
  msgKeySet(kp);
  return kp;
}
async function socialMyPub() {   // the compact raw public key (base64) we publish to the profile
  const kp = await socialEnsureKeypair();
  const pk = await crypto.subtle.importKey("jwk", kp.pub, { name: "ECDH", namedCurve: "P-256" }, true, []);
  return _b64(await crypto.subtle.exportKey("raw", pk));
}
async function socialSharedKey(theirPubB64) {   // AES-GCM key from ECDH(myPriv, theirPub)
  const kp = await socialEnsureKeypair();
  const myPriv = await crypto.subtle.importKey("jwk", kp.priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const theirPub = await crypto.subtle.importKey("raw", _unb64(theirPubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: theirPub }, myPriv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function socialSeal(theirPubB64, text) {
  const key = await socialSharedKey(theirPubB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return _b64(iv) + ":" + _b64(ct);
}
async function socialUnseal(theirPubB64, body) {
  const parts = String(body == null ? "" : body).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("bad ciphertext");
  const key = await socialSharedKey(theirPubB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(parts[0]) }, key, _unb64(parts[1]));
  return new TextDecoder().decode(pt);
}
// ── the local message cache (money.dms — DEVICE_LOCAL, a mirror of server data + read marks) ──
function dmsGet() { try { const o = JSON.parse(localStorage.getItem(DMS_KEY) || "{}") || {}; o.threads = o.threads || {}; o.reqs = o.reqs || []; return o; } catch (e) { return { threads: {}, reqs: [] }; } }
function dmsSet(o) { try { localStorage.setItem(DMS_KEY, JSON.stringify(o)); } catch (e) {} }
function dmsThread(o, uid, prof) {
  let th = o.threads[uid];
  if (!th) th = o.threads[uid] = { uid: uid, handle: "", name: "", pub: "", msgs: [], readTs: "" };
  if (prof) { th.handle = prof.username || th.handle; th.name = prof.name || th.name; th.pub = prof.pubkey || th.pub; }
  return th;
}
function socialUnreadCount() {
  const o = dmsGet(); let n = 0;
  Object.keys(o.threads).forEach((uid) => { const th = o.threads[uid]; (th.msgs || []).forEach((m) => { if (!m.mine && (!th.readTs || m.ts > th.readTs)) n++; }); });
  return n + (o.reqs || []).length;
}
function socialUpdateBadge() {
  const b = document.getElementById("msgBtn"); if (!b) return;
  const dot = b.querySelector(".msg-unread");
  if (dot) {
    const c = socialReady() ? socialUnreadCount() : 0;
    if (c > 0) { dot.textContent = c > 99 ? "99+" : String(c); dot.hidden = false; }
    else { dot.hidden = true; dot.textContent = ""; }
  }
  // the OTHER corner: unread Cache news (bottom-right, a different shape/tone so a
  // glance tells "a person is waiting" apart from "there's news"). Works logged-out too.
  const news = b.querySelector(".msg-news");
  if (news) {
    const n = typeof notifsUnread === "function" ? notifsUnread() : 0;
    if (n > 0) { news.textContent = n > 99 ? "99+" : String(n); news.hidden = false; }
    else { news.hidden = true; news.textContent = ""; }
  }
}
function dmsMarkRead(uid) {
  const o = dmsGet(), th = o.threads[uid]; if (!th) return;
  th.readTs = (th.msgs || []).reduce((mx, m) => (m.ts > mx ? m.ts : mx), th.readTs || "");
  dmsSet(o); socialUpdateBadge();
}
// ── PocketBase calls (mirror the vault engine's auth: refresh the token, raw Authorization header) ──
async function socialApi(path, opts) {
  await cloudAuthCheck();
  const s = cloudState();
  if (!s.token) throw new Error("log in to your cloud account first");
  opts = opts || {};
  const hdr = { Authorization: s.token };
  if (opts.body) hdr["Content-Type"] = "application/json";
  const r = await fetch(cloudUrl() + path, Object.assign({}, opts, { headers: Object.assign(hdr, opts.headers || {}) }));
  const d = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(cloudErr(d) || ("request failed (" + r.status + ")")); e.status = r.status; throw e; }
  return d;
}
function socialFilter(expr) { return "?perPage=200&filter=" + encodeURIComponent(expr); }
async function socialProfiles(uids) {   // owner-uid → profile row, one batched fetch
  uids = Array.from(new Set((uids || []).filter(Boolean)));
  if (!uids.length) return {};
  const d = await socialApi("/api/collections/profiles/records" + socialFilter(uids.map((u) => 'owner="' + u + '"').join(" || ")));
  const map = {}; (d.items || []).forEach((p) => { map[p.owner] = p; }); return map;
}
async function socialFriendships() {
  const s = cloudState();
  const d = await socialApi("/api/collections/friendships/records" + socialFilter('from="' + s.userId + '" || to="' + s.userId + '"'));
  return d.items || [];
}
async function socialSearch(raw) {
  const username = socialNormHandle(raw);
  if (!username) return [];
  const s = cloudState();
  const d = await socialApi("/api/collections/profiles/records?perPage=8&filter=" + encodeURIComponent('username="' + username + '"'));
  return (d.items || []).filter((p) => p.owner !== s.userId);   // never return yourself
}
async function socialClaimUsername(raw) {
  const username = socialNormHandle(raw);
  if (!socialHandleValid(username)) throw new Error("Handle must be 3–20 letters, numbers or _");
  const s = cloudState();
  if (!s.token) throw new Error("log in to your cloud account first");
  const found = await socialApi("/api/collections/profiles/records?perPage=2&filter=" + encodeURIComponent('username="' + username + '"'));
  if ((found.items || []).some((p) => p.owner !== s.userId)) throw new Error("@" + username + " is taken — try another");
  const pubkey = await socialMyPub();
  const own = await socialApi("/api/collections/profiles/records" + socialFilter('owner="' + s.userId + '"'));
  const row = (own.items || [])[0];
  // Guard the multi-device key fork: if the account already published a DIFFERENT key from
  // another device, overwriting it would orphan every message sealed to it. Ask to sync first
  // (the vault carries the private half) rather than mint a competing identity.
  if (row && row.pubkey && row.pubkey !== pubkey) throw new Error("This account set up messaging on another device. Sync this device first (Settings → cloud), then reopen Messages.");
  const body = JSON.stringify({ owner: s.userId, username: username, pubkey: pubkey });
  if (row) await socialApi("/api/collections/profiles/records/" + row.id, { method: "PATCH", body: body });
  else await socialApi("/api/collections/profiles/records", { method: "POST", body: body });
  socialSaveState(Object.assign(socialState(), { username: username, optedIn: true }));
  document.dispatchEvent(new CustomEvent("cache:social"));
  return username;
}
// The ONLY fields the Edit-profile surface may ever put on the public profiles row,
// and only while the per-field toggle is on. Private-by-default is the whole
// posture: pronouns/bio/note/etc. must NEVER appear here. Do not add a field
// without an explicit product decision — the sharing-tier model
// (Ghost/Neighbor/Beacon, anonymity-line proposal) is pending and this is the floor.
function profilePublicPayload(card, shareName) {
  return { name: shareName ? String((card && card.publicName) || "").trim().slice(0, 40) : "" };
}
// Publish / retract the optional public display name — the profiles row's `name`
// field Messages already renders in find-friends. Only ever PATCHes an EXISTING
// row: claiming the @handle (socialClaimUsername) is the sole opt-in that creates
// a public row at all. With requireShared, the PATCH goes through only if the
// server ALREADY shows a name — so a debounced text edit can update a shared name
// but can never re-publish one that was retracted on another device (the caller
// gets e.notShared and heals its local flag instead).
async function socialSetPublicName(card, shareName, requireShared) {
  const s = cloudState();
  if (!s.token) throw new Error("log in to your cloud account first");
  const own = await socialApi("/api/collections/profiles/records" + socialFilter('owner="' + s.userId + '"'));
  const row = (own.items || [])[0];
  if (!row) throw new Error("claim your @handle in Messages first");
  if (requireShared && !(typeof row.name === "string" && row.name.trim())) {
    const e = new Error("sharing is off for this account right now"); e.notShared = true; throw e;
  }
  await socialApi("/api/collections/profiles/records/" + row.id, { method: "PATCH", body: JSON.stringify(profilePublicPayload(card, shareName)) });
  return true;
}
async function socialRequest(toUid) {
  const s = cloudState();
  const existing = (await socialFriendships()).find((r) => r.from === toUid || r.to === toUid);
  if (existing) {
    if (existing.status === "accepted") throw new Error("You're already friends");
    if (existing.status === "pending") { if (existing.to === s.userId) return socialAccept(existing.id); throw new Error("Request already sent"); }
  }
  await socialApi("/api/collections/friendships/records", { method: "POST", body: JSON.stringify({ from: s.userId, to: toUid, status: "pending" }) });
  document.dispatchEvent(new CustomEvent("cache:social"));
}
async function socialAccept(id) { await socialApi("/api/collections/friendships/records/" + id, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }); document.dispatchEvent(new CustomEvent("cache:social")); }
async function socialIgnore(id) { await socialApi("/api/collections/friendships/records/" + id, { method: "PATCH", body: JSON.stringify({ status: "blocked" }) }); document.dispatchEvent(new CustomEvent("cache:social")); }
async function socialSend(toUid, text) {
  text = String(text == null ? "" : text).trim();
  if (!text) return;
  const prof = (await socialProfiles([toUid]))[toUid];
  if (!prof || !prof.pubkey) throw new Error("This friend hasn't set up messaging yet");
  const s = cloudState();
  const rec = await socialApi("/api/collections/messages/records", { method: "POST", body: JSON.stringify({ from: s.userId, to: toUid, body: await socialSeal(prof.pubkey, text) }) });
  const o = dmsGet(), th = dmsThread(o, toUid, prof);
  if (!th.msgs.some((x) => x.id === rec.id)) th.msgs.push({ id: rec.id, mine: true, text: text, ts: rec.created || new Date().toISOString() });
  th.readTs = th.msgs.reduce((mx, m) => (m.ts > mx ? m.ts : mx), th.readTs || "");   // my own send is "read"
  dmsSet(o);
  document.dispatchEvent(new CustomEvent("cache:messages"));
  return rec;
}
// The poll: pull friendships + messages, decrypt, mirror into money.dms. Robust to a
// not-yet-created collection (each call try/caught) so it never throws into the console.
let _socialPolling = false;
async function socialPoll() {
  if (!socialReady() || _socialPolling) { socialUpdateBadge(); return; }
  _socialPolling = true;
  try {
    const s = cloudState(), o = dmsGet();
    let fr = []; try { fr = await socialFriendships(); } catch (e) {}
    const accepted = fr.filter((r) => r.status === "accepted");
    const pendingIn = fr.filter((r) => r.to === s.userId && r.status === "pending");
    const friendUids = accepted.map((r) => (r.from === s.userId ? r.to : r.from));
    let msgs = []; try { const d = await socialApi("/api/collections/messages/records?perPage=100&sort=-created&filter=" + encodeURIComponent('from="' + s.userId + '" || to="' + s.userId + '"')); msgs = (d.items || []).reverse(); } catch (e) {}
    const need = Array.from(new Set([].concat(friendUids, msgs.map((m) => (m.from === s.userId ? m.to : m.from)), pendingIn.map((r) => r.from)).filter(Boolean)));
    let profs = {}; try { profs = await socialProfiles(need); } catch (e) {}
    friendUids.forEach((uid) => dmsThread(o, uid, profs[uid]));   // accepted friends show even with no messages yet
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i], otherUid = m.from === s.userId ? m.to : m.from, th = dmsThread(o, otherUid, profs[otherUid]);
      if (th.msgs.some((x) => x.id === m.id)) continue;
      let text = "🔒";
      const prof = profs[otherUid];
      if (prof && prof.pubkey) { try { text = await socialUnseal(prof.pubkey, m.body); } catch (e) { text = "🔒 couldn't read this one"; } }
      th.msgs.push({ id: m.id, mine: m.from === s.userId, text: text, ts: m.created });
    }
    Object.keys(o.threads).forEach((uid) => o.threads[uid].msgs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)));
    o.reqs = pendingIn.map((r) => ({ id: r.id, uid: r.from, handle: (profs[r.from] || {}).username || "", name: (profs[r.from] || {}).name || "" }));
    dmsSet(o); socialUpdateBadge();
    document.dispatchEvent(new CustomEvent("cache:messages"));
  } finally { _socialPolling = false; }
}

// ── The notification center — the Cache's OWN news, the second half of Messages. ──
//    Notifications come from release-notes.json: a static array [{id, date, title, body}],
//    newest first, shipped by build-app.sh/build-demo.sh in LOCKSTEP with the code it
//    describes (works on web + desktop, zero backend; served by server.py from the repo
//    root, same-origin so the CSP already allows it). Read state lives in money.notifs
//    {id: {read:0|1, at:ms}} — SPECIAL merge, per-id newest-wins by `at` (mergeNotifsStr)
//    so reading on the phone un-bolds the desktop. Stamps are DETERMINISTIC:
//      seed (first-ever run)  → {read:1, at:<release date>} — a brand-new install never
//                               opens to a backlog of "unread" history, and two fresh
//                               devices of one account mint byte-identical maps.
//      detect (a new entry)   → {read:0, at:<release date>} — every device mints the SAME
//                               unread stamp, so no clock ever outranks another device.
//      user read / unread     → {read, at:Date.now()} — always newer than a release date,
//                               so a real action wins everywhere.
//    On an exact-`at` tie the merge lets UNREAD win: that's the only race (a fresh device
//    seeding history as read vs. an older device holding the same note unread), and a
//    swallowed unread is invisible while a re-shown read note is calm.
const NOTIFS_KEY = "money.notifs";
let _relNotes = null;   // in-memory cache of the fetched release-notes list (null = not loaded yet)
function notifsGet() { try { const o = JSON.parse(localStorage.getItem(NOTIFS_KEY) || "null"); return (o && typeof o === "object" && !Array.isArray(o)) ? o : null; } catch (e) { return null; } }
function notifsSet(o) { try { localStorage.setItem(NOTIFS_KEY, JSON.stringify(o)); } catch (e) {} }
function notifDateMs(e) { const t = Date.parse(String((e && e.date) || "") + "T00:00:00Z"); return isFinite(t) ? t : 0; }
// Seed-or-detect. First-ever run (no money.notifs at all) marks the WHOLE file read at its
// release dates — ZERO fabricated notifications for a new install; after that, an entry
// we've never seen becomes unread, stamped at its release date (deterministic — see above).
function notifsSeed(list) {
  if (!Array.isArray(list) || !list.length) return false;
  const cur = notifsGet(), map = cur || {}, first = !cur;
  let changed = false;
  list.forEach((e) => {
    if (!e || !e.id || map[e.id]) return;
    map[e.id] = { read: first ? 1 : 0, at: notifDateMs(e) };
    changed = true;
  });
  if (changed) notifsSet(map);
  return changed && !first;   // "anything newly unread?" — first-run seeding is silent
}
function notifsUnread() {
  const m = notifsGet() || {}; let n = 0;
  Object.keys(m).forEach((id) => { const e = m[id]; if (e && typeof e === "object" && !e.read) n++; });
  return n;
}
function notifsMark(id, read) {
  if (!id) return;
  const m = notifsGet() || {};
  m[id] = { read: read ? 1 : 0, at: Date.now() };
  notifsSet(m);
  socialUpdateBadge();
  try { document.dispatchEvent(new CustomEvent("cache:notifs")); } catch (e) {}
}
// One fetch per session (plus a refresh when the What's-new view opens). Never throws;
// a missing file (demo without the copy, offline) just leaves the calm empty state.
async function notifsFetch(force) {
  if (_relNotes && !force) return _relNotes;
  try {
    const r = await fetch("release-notes.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("no notes");
    const d = await r.json();
    _relNotes = (Array.isArray(d) ? d : []).filter((e) => e && e.id);
    // Arm on a never-seen entry (first-run seeding is silent). STICKY on purpose: if the pop
    // is deferred because the user was busy, a later fetch must not disarm it — otherwise the
    // one poll that detected the news is the only one that ever tries to deliver it.
    if (notifsSeed(_relNotes)) _wcPending = true;
    socialUpdateBadge();
    try { document.dispatchEvent(new CustomEvent("cache:notifs")); } catch (e) {}
  } catch (e) {}
  return _relNotes || [];
}

// ── "What's changed" ────────────────────────────────────────────────────────────
//   The news finds YOU. Same read-state as the bell (money.notifs) is the single source
//   of truth, so this can never re-nag about something you've already seen, and marking
//   read still happens exactly once, through notifsMark.
let _wcOpen = false;          // a What's-changed dialog is mounted right now
let _wcPending = false;       // genuinely-new news is ARMED until a pop actually lands
const _wcShown = new Set();   // ids surfaced this session but not yet dismissed (de-dups the poll)
// the release entries currently UNREAD, newest-first (absent-from-map reads as READ)
function notifsUnseen() {
  if (!Array.isArray(_relNotes)) return [];
  const map = notifsGet() || {};
  return _relNotes.filter((e) => { const st = e && e.id ? map[e.id] : null; return st && typeof st === "object" && !st.read; });
}
// Never yank focus mid-task: no double-pop, not while typing, not over another surface or
// dialog, not in a backgrounded tab. Returning true just defers — the poll and the
// return-to-tab handler retry, and the item stays unseen until it's actually shown.
function wcBusy() {
  if (_wcOpen || document.hidden) return true;
  if (isTypingTarget(document.activeElement)) return true;
  // .wc-gate is webcache's hosted-web sign-in gate at z-index 2147483000. A .cat-modal is
  // 100031, so without this the dialog mounts INVISIBLE underneath it: unseeable, focus
  // yanked off the login form, and a stray Escape would run close() and mark every listed
  // release read that nobody ever saw. (Inert on desktop — .wc-gate never exists there.)
  if (document.querySelector(".cat-modal, .cat-backdrop, .daily-space, .wc-gate, .deck-coach")) return true;
  return false;
}
function maybeWhatsChanged() {
  if (wcBusy()) return false;
  // Only auto-pop news the app DETECTED. The stamp already tells the two apart: a detect
  // stamps the entry's release date, a human ⋯ "mark unread" stamps Date.now(). Someone who
  // deliberately saved an item for later must not have it shoved back at them — and then
  // silently re-marked read on dismiss.
  const items = notifsUnseen().filter((e) => {
    if (_wcShown.has(e.id)) return false;
    const st = (notifsGet() || {})[e.id];
    return st && st.at === notifDateMs(e);   // untouched by a human
  });
  if (!items.length) { _wcPending = false; return false; }   // nothing to deliver → disarm
  openWhatsChanged(items);
  _wcPending = false;
  return true;
}
// A .cat-modal, so the observer gives it dialog semantics, a focus trap, Escape and
// focus-restore for free. Marks read on DISMISS, never on open — auto-popping and
// instantly clearing the badge would erase the news before it was actually read.
function openWhatsChanged(items) {
  if (_wcOpen || !Array.isArray(items) || !items.length) return;
  _wcOpen = true;
  // Render a bounded list, but NEVER mark read what we didn't SHOW. notifsMark stamps
  // Date.now(), which wins the money.notifs merge on every device — an unread we swallowed
  // here would be gone for good. _wcShown is session-only, so the overflow can safely go in
  // it (it just won't re-pop this session; the bell still has it).
  const shown = items.slice(0, 12);
  const ids = shown.map((e) => e.id);
  items.forEach((e) => _wcShown.add(e.id));
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  const niceDate = (d) => { const t = Date.parse(String(d || "") + "T00:00:00"); return isFinite(t) ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : ""; };
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal wcn-modal";
  let dismissed = false;
  const close = () => {
    // seen + dismissed == read. A real user action, so notifsMark stamps Date.now(), which
    // correctly outranks the release-date seed on every device (see the money.notifs contract).
    if (!dismissed) { dismissed = true; ids.forEach((id) => { try { notifsMark(id, 1); } catch (e) {} }); }
    back.remove(); modal.remove(); _wcOpen = false;
  };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const rows = shown.map((e) =>
    '<div class="wcn-row">' +
      '<div class="wcn-row-title">' + esc(e.title) + "</div>" +
      (e.body ? '<div class="wcn-row-body">' + esc(e.body) + "</div>" : "") +
      '<div class="wcn-row-date">' + esc(niceDate(e.date)) + "</div>" +
    "</div>").join("");
  modal.innerHTML =
    '<div class="cat-head"><span>🔔 ' + (shown.length > 1 ? "What’s changed" : "What’s new") + '</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-list wcn-body">' +
      '<div class="wcn-lead">' + (shown.length > 1 ? "A few things changed since you were last here." : "Something new landed while you were away.") + "</div>" +
      rows +
      '<div class="wcn-actions"><button class="wcn-ok" type="button">Got it</button></div>' +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
  modal.querySelector(".wcn-ok").addEventListener("click", close);
}

// ── The Messages surface — a full-screen lens, cloned from openCalendar (daily-space shell).
//    One surface, several views: onboarding (connect / claim handle) · list · thread · find · requests.
function openMessages() {
  if (document.getElementById("msgSpace")) return;
  const root = document.createElement("div"); root.id = "msgSpace"; root.className = "daily-space msg-space";
  document.body.appendChild(root);
  const esc = (s) => escapeHtml(s == null ? "" : String(s));
  let view = "list", activeUid = null, results = null, findErr = "", claimErr = "", notifsTried = false;
  const draft = {};
  const timeOf = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
  const onKey = (e) => { if (e.key !== "Escape") return; if (root.querySelector(".msg-notif-menu")) { closeNotifMenu(); return; } if (view === "list") close(); else { view = "list"; activeUid = null; render(); } };
  const onCache = () => { if (!root.isConnected) { cleanup(); return; } if (view === "thread") { paintThreadMsgs(); } else if (view !== "notifs") render(); socialUpdateBadge(); };
  // read-state changed (auto-read, a manual mark, a vault merge, a fetch that found news):
  // paint in place on the notifs view (a full re-render would reset scroll + observers);
  // refresh the list view so the bell's news dot stays honest; never touch a view with a
  // live input (thread composer, find box).
  const onNotifs = () => { if (!root.isConnected) { cleanup(); return; } socialUpdateBadge(); if (view === "notifs") paintNotifRows(); else if (view === "list") render(); };
  const pollTimer = setInterval(() => { if (!document.hidden && socialReady()) socialPoll().catch(() => {}); }, 15000);   // near-live while open
  const cleanup = () => { clearInterval(pollTimer); notifsUnwire(); closeNotifMenu(); document.removeEventListener("keydown", onKey); document.removeEventListener("cache:messages", onCache); document.removeEventListener("cache:social", onCache); document.removeEventListener("cache:notifs", onNotifs); };
  const close = () => { root.remove(); cleanup(); };
  document.addEventListener("keydown", onKey);
  document.addEventListener("cache:messages", onCache);
  document.addEventListener("cache:social", onCache);
  document.addEventListener("cache:notifs", onNotifs);
  socialPoll().catch(() => {});   // fresh pull the moment it opens

  // The bell lives on BOTH home renders (the conversations list and the logged-out
  // onboard — both keep view === "list"): the Cache's own news never needs an account.
  const header = (title, back) => {
    const onHome = view === "list";
    const nn = onHome ? notifsUnread() : 0;
    return '<div class="daily-top">' +
      (back ? '<button class="daily-icn" id="msgBack" aria-label="back">‹</button>' : '<button class="daily-icn" id="msgClose" aria-label="close">✕</button>') +
      '<div class="cal-title">' + esc(title) + "</div>" +
      '<div class="msg-headright">' + (onHome && socialReady()
        ? '<button class="daily-icn msg-hbtn" id="msgReq" aria-label="friend requests" title="friend requests">👋</button><button class="daily-icn msg-hbtn" id="msgFind" aria-label="find friends" title="find friends">🔍</button>'
        : "") +
        (onHome ? '<button class="daily-icn msg-hbtn' + (nn ? " has-news" : "") + '" id="msgNotifs" aria-label="' + (nn ? "what's new — " + nn + " unread" : "what's new") + '" title="what&#39;s new">🔔</button>' : "") +
      "</div>" +
    "</div>";
  };

  // Account controls (switch account / log out) intentionally DON'T live here anymore —
  // they belong in ONE place: your profile ("Switch account") and Cloud settings ("Log out").
  // Scattering them across surfaces made it unclear where account state actually changes.
  // Kept as a no-op so the views that reference it don't need touching.
  const acctFooter = () => "";
  function renderOnboard() {
    if (!socialLoggedIn())
      return header("Messages", false) + '<div class="msg-body"><div class="msg-onboard">' +
        '<div class="msg-onboard-em">💬</div>' +
        "<h2>Chat with your friends</h2>" +
        "<p>Messages are end-to-end encrypted and ride your Cache cloud account. Log in (or make a free account) to turn them on.</p>" +
        '<button class="msg-cta-btn" id="msgToSettings">Set up your cloud account</button>' +
        '<p class="msg-fine">Local-only? That\'s fine — messaging is fully opt-in and nothing syncs until you turn it on.</p>' +
        "</div></div>";
    const st = socialState();
    return header("Messages", false) + '<div class="msg-body"><div class="msg-onboard">' +
      '<div class="msg-onboard-em">🪪</div>' +
      "<h2>Claim your @username</h2>" +
      "<p>This is how friends find you. Your email stays private — only your handle is searchable, and only once you claim it.</p>" +
      '<div class="msg-claimrow"><span class="msg-at">@</span><input class="msg-claim-in" id="msgClaimIn" placeholder="username" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + esc((st.username || "")) + '" maxlength="20" inputmode="text"></div>' +
      (claimErr ? '<p class="msg-err">' + esc(claimErr) + "</p>" : '<p class="msg-fine">3–20 letters, numbers or _</p>') +
      '<button class="msg-cta-btn" id="msgClaimGo">Claim &amp; turn on messages</button>' +
      "</div>" + acctFooter() + "</div>";
  }
  function convRows() {
    const o = dmsGet();
    const threads = Object.keys(o.threads).map((k) => o.threads[k]).sort((a, b) => {
      const la = (a.msgs[a.msgs.length - 1] || {}).ts || "", lb = (b.msgs[b.msgs.length - 1] || {}).ts || "";
      if (la !== lb) return la < lb ? 1 : -1;
      return (a.handle || a.name || "") < (b.handle || b.name || "") ? -1 : 1;
    });
    if (!threads.length) return '<div class="msg-empty"><div class="msg-empty-em">💬</div><p>No conversations yet.</p><p class="sub">Find a friend by their @username to say hi.</p><button class="msg-cta-btn" id="msgFindEmpty">🔍 Find a friend</button></div>';
    return '<div class="msg-list">' + threads.map((th) => {
      const last = th.msgs[th.msgs.length - 1];
      const unread = th.msgs.filter((m) => !m.mine && (!th.readTs || m.ts > th.readTs)).length;
      const preview = last ? (last.mine ? "You: " : "") + last.text : "Say hi 👋";
      const nm = th.handle ? "@" + th.handle : (th.name || "friend");
      return '<button class="msg-conv" data-uid="' + esc(th.uid) + '">' +
        '<span class="msg-ava">' + esc((th.handle || th.name || "?").slice(0, 1).toUpperCase()) + "</span>" +
        '<span class="msg-conv-mid"><span class="msg-conv-name">' + esc(nm) + '</span><span class="msg-conv-prev">' + esc(preview) + "</span></span>" +
        (unread ? '<span class="msg-conv-badge">' + unread + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function threadMsgsHtml() {
    const o = dmsGet(), th = o.threads[activeUid];
    if (!th || !th.msgs.length) return '<div class="msg-empty2">No messages yet — say something 👋</div>';
    return th.msgs.map((m) => '<div class="msg-b' + (m.mine ? " me" : "") + '"><span class="msg-b-tx">' + esc(m.text) + '</span><span class="msg-b-ts">' + esc(timeOf(m.ts)) + "</span></div>").join("");
  }
  function paintThreadMsgs() {
    const box = root.querySelector("#msgThreadMsgs"); if (!box) return;
    box.innerHTML = threadMsgsHtml(); box.scrollTop = box.scrollHeight;
    dmsMarkRead(activeUid);
  }
  function renderThread() {
    const o = dmsGet(), th = o.threads[activeUid] || { handle: "", name: "" };
    const nm = th.handle ? "@" + th.handle : (th.name || "friend");
    return header(nm, true) +
      '<div class="msg-thread"><div class="msg-thread-msgs" id="msgThreadMsgs">' + threadMsgsHtml() + "</div>" +
      '<div class="msg-composer"><textarea class="msg-ta" id="msgTa" rows="1" placeholder="Message…" aria-label="message"></textarea><button class="msg-send" id="msgSend" aria-label="send">➤</button></div></div>';
  }
  function renderFind() {
    const rows = results == null ? "" : (results.length
      ? '<div class="msg-list">' + results.map((p) => '<div class="msg-result"><span class="msg-ava">' + esc((p.username || "?").slice(0, 1).toUpperCase()) + '</span><span class="msg-conv-mid"><span class="msg-conv-name">@' + esc(p.username) + "</span>" + (p.name ? '<span class="msg-conv-prev">' + esc(p.name) + "</span>" : "") + '</span><button class="msg-add" data-uid="' + esc(p.owner) + '">Add</button></div>').join("") + "</div>"
      : '<div class="msg-empty2">No one found with that handle.</div>');
    return header("Find friends", true) + '<div class="msg-body">' +
      '<div class="msg-findbar"><span class="msg-at">@</span><input class="msg-claim-in" id="msgFindIn" placeholder="their username" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="msg-find-go" id="msgFindGo">Search</button></div>' +
      (findErr ? '<p class="msg-err">' + esc(findErr) + "</p>" : "") + rows + "</div>";
  }
  function renderRequests() {
    const o = dmsGet();
    const rows = (o.reqs || []).length
      ? (o.reqs || []).map((r) => '<div class="msg-req"><span class="msg-ava">' + esc((r.handle || r.name || "?").slice(0, 1).toUpperCase()) + '</span><span class="msg-conv-mid"><span class="msg-conv-name">' + (r.handle ? "@" + esc(r.handle) : esc(r.name || "someone")) + '</span><span class="msg-conv-prev">wants to be friends</span></span><button class="msg-add" data-acc="' + esc(r.id) + '">Accept</button><button class="msg-ign" data-ign="' + esc(r.id) + '">Ignore</button></div>').join("")
      : '<div class="msg-empty2">No friend requests right now.</div>';
    return header("Friend requests", true) + '<div class="msg-body"><div class="msg-list">' + rows + "</div></div>";
  }
  // ── What's new — the notification center view. Every field is authored by us but
  //    still runs through esc() (no raw interpolation, ever). Absent-from-map reads as
  //    READ: a failed first-run seed must never fabricate a backlog of unread news.
  function renderNotifs() {
    const map = notifsGet() || {};
    const niceDate = (d) => { const t = Date.parse(String(d || "") + "T00:00:00"); return isFinite(t) ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : ""; };
    let bodyHtml;
    if (_relNotes === null) bodyHtml = '<div class="msg-empty2">' + (notifsTried ? "Couldn't check for news right now — it'll be here next time." : "Checking for news…") + "</div>";
    else if (!_relNotes.length) bodyHtml = '<div class="msg-empty2">No news yet. Updates to your Cache will land here.</div>';
    else bodyHtml = '<div class="msg-list" id="msgNotifList" role="list" aria-label="what\'s new">' + _relNotes.slice(0, 30).map((e) => {
      const st = map[e.id], unread = !!(st && typeof st === "object" && !st.read);
      return '<div class="msg-notif' + (unread ? " unread" : "") + '" role="listitem" tabindex="0" data-nid="' + esc(e.id) + '">' +
        '<span class="msg-notif-dot"' + (unread ? ' role="img" aria-label="unread"' : ' aria-hidden="true"') + "></span>" +
        '<span class="msg-notif-mid">' +
          '<span class="msg-notif-title">' + esc(e.title) + "</span>" +
          (e.body ? '<span class="msg-notif-body">' + esc(e.body) + "</span>" : "") +
          '<span class="msg-notif-date">' + esc(niceDate(e.date)) + "</span>" +
        "</span>" +
        '<button class="msg-notif-more" data-more="' + esc(e.id) + '" aria-haspopup="menu" aria-label="options for ' + esc(e.title) + '">⋯</button>' +
      "</div>";
    }).join("") + "</div>";
    return header("What's new", true) + '<div class="msg-body">' + bodyHtml + "</div>";
  }
  function paintNotifRows() {
    const map = notifsGet() || {};
    root.querySelectorAll(".msg-notif").forEach((row) => {
      const st = map[row.dataset.nid], unread = !!(st && typeof st === "object" && !st.read);
      row.classList.toggle("unread", unread);
      const dot = row.querySelector(".msg-notif-dot");
      if (!dot) return;
      if (unread) { dot.setAttribute("role", "img"); dot.setAttribute("aria-label", "unread"); dot.removeAttribute("aria-hidden"); }
      else { dot.removeAttribute("role"); dot.removeAttribute("aria-label"); dot.setAttribute("aria-hidden", "true"); }
    });
  }
  // ── auto-read: a notification marks itself read after ~5s of GENUINE visibility —
  //    on screen (IntersectionObserver) AND in a visible tab. A backgrounded tab must
  //    never quietly mark everything read (that would silently defeat the feature), so
  //    hiding the tab pauses every clock; time on screen accumulates across peeks.
  const NOTIF_READ_MS = 5000;
  let _nW = null;
  function notifsWire() {
    notifsUnwire();
    const listEl = root.querySelector("#msgNotifList"); if (!listEl) return;
    const rows = new Map();   // rowEl → {id, acc, since, timer, inView, done}
    const start = (row) => {
      const s = rows.get(row);
      if (!s || s.done || s.timer || !s.inView || document.visibilityState !== "visible") return;
      s.since = Date.now();
      s.timer = setTimeout(() => { s.timer = 0; s.done = true; notifsMark(s.id, 1); }, Math.max(0, NOTIF_READ_MS - s.acc));
    };
    const stop = (row) => {
      const s = rows.get(row); if (!s) return;
      if (s.timer) { clearTimeout(s.timer); s.timer = 0; }
      if (s.since) { s.acc += Date.now() - s.since; s.since = 0; }
    };
    const io = ("IntersectionObserver" in window) ? new IntersectionObserver((ents) => {
      ents.forEach((en) => { const s = rows.get(en.target); if (!s) return; s.inView = en.isIntersecting; if (en.isIntersecting) start(en.target); else stop(en.target); });
    }, { threshold: 0.55 }) : null;
    const onVis = () => { rows.forEach((s, row) => { if (document.visibilityState === "visible") start(row); else stop(row); }); };
    document.addEventListener("visibilitychange", onVis);
    root.querySelectorAll(".msg-notif.unread").forEach((row) => {
      rows.set(row, { id: row.dataset.nid, acc: 0, since: 0, timer: 0, inView: false, done: false });
      if (io) io.observe(row);
      else { rows.get(row).inView = true; start(row); }   // no IO at all → visible-tab timer only
    });
    _nW = { io, rows, onVis };
  }
  function notifsUnwire() {
    if (!_nW) return;
    try { document.removeEventListener("visibilitychange", _nW.onVis); } catch (e) {}
    try { if (_nW.io) _nW.io.disconnect(); } catch (e) {}
    _nW.rows.forEach((s) => { if (s.timer) clearTimeout(s.timer); });
    _nW = null;
  }
  function notifsHold(id) {   // a manual "mark unread" means "I'll come back" — park this visit's auto-read for that row
    if (!_nW) return;
    _nW.rows.forEach((s) => { if (s.id === id) { if (s.timer) clearTimeout(s.timer); s.timer = 0; s.done = true; } });
  }
  // the row menu — mark unread / mark read. Reached three ways, never gesture-only:
  // the visible ⋯ button (keyboard + screen-reader reachable), right-click / the
  // context-menu key on a focused row, and long-press on touch.
  function closeNotifMenu() {
    const m = root.querySelector(".msg-notif-menu"); if (!m) return;
    try { if (m._cleanup) m._cleanup(); } catch (e) {}
    const back = m._anchor; m.remove();
    try { if (back && back.isConnected) back.focus(); } catch (e) {}
  }
  function openNotifMenu(id, anchor) {
    closeNotifMenu();
    const st = (notifsGet() || {})[id];
    const isRead = !(st && typeof st === "object" && !st.read);
    const m = document.createElement("div"); m.className = "msg-notif-menu"; m.setAttribute("role", "menu");
    m.innerHTML = '<button role="menuitem" data-toggle>' + (isRead ? "Mark unread" : "Mark read") + "</button>";
    m._anchor = anchor;
    root.appendChild(m);
    try {   // anchored by the row control on a wide surface; CSS makes it a bottom sheet under 480px
      const r = anchor.getBoundingClientRect();
      m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4)) + "px";
      m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + "px";
    } catch (e) {}
    const onDown = (e) => { if (!m.contains(e.target)) closeNotifMenu(); };
    setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    m._cleanup = () => document.removeEventListener("pointerdown", onDown);
    const b = m.querySelector("[data-toggle]");
    b.addEventListener("click", () => { if (isRead) { notifsMark(id, 0); notifsHold(id); } else notifsMark(id, 1); closeNotifMenu(); });
    b.focus();
  }
  function render() {
    notifsUnwire();
    closeNotifMenu();
    if (view === "notifs") root.innerHTML = renderNotifs();   // the Cache's own news — no account needed
    else if (!socialReady()) root.innerHTML = renderOnboard();
    else if (view === "thread") root.innerHTML = renderThread();
    else if (view === "find") root.innerHTML = renderFind();
    else if (view === "requests") root.innerHTML = renderRequests();
    else root.innerHTML = header("Messages", false) + '<div class="msg-body">' + convRows() + acctFooter() + "</div>";
    wire();
    if (view === "notifs") notifsWire();
    if (view === "thread") { const box = root.querySelector("#msgThreadMsgs"); if (box) box.scrollTop = box.scrollHeight; dmsMarkRead(activeUid); }
  }
  function wire() {
    const c = root.querySelector("#msgClose"); if (c) c.addEventListener("click", close);
    const bk = root.querySelector("#msgBack"); if (bk) bk.addEventListener("click", () => { view = "list"; activeUid = null; results = null; findErr = ""; render(); });
    const toS = root.querySelector("#msgToSettings"); if (toS) toS.addEventListener("click", () => { try { openSettings(); } catch (e) {} });
    // (Account switch / log out used to live here as a strip; they now live only in the
    //  profile and Cloud settings — acctFooter() is a no-op, so there's nothing to wire.)
    const claimGo = root.querySelector("#msgClaimGo"), claimIn = root.querySelector("#msgClaimIn");
    if (claimGo && claimIn) {
      const go = async () => { claimErr = ""; try { await socialClaimUsername(claimIn.value); flash("You're on — @" + socialState().username); } catch (e) { claimErr = e.message || "couldn't claim that"; render(); } };
      claimGo.addEventListener("click", go);
      claimIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    }
    root.querySelectorAll(".msg-conv").forEach((r) => r.addEventListener("click", () => { activeUid = r.dataset.uid; view = "thread"; render(); }));
    // the bell → What's new. Render immediately from the session cache, then refresh the
    // file (same-origin, tiny) so a long-lived tab still sees news from a newer deploy.
    const nb = root.querySelector("#msgNotifs");
    if (nb) nb.addEventListener("click", () => {
      view = "notifs"; render();
      notifsFetch(true).then(() => { notifsTried = true; if (view === "notifs" && root.isConnected) render(); });
    });
    root.querySelectorAll(".msg-notif-more").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openNotifMenu(b.dataset.more, b); }));
    root.querySelectorAll(".msg-notif").forEach((row) => {
      const anchor = () => row.querySelector(".msg-notif-more") || row;
      row.addEventListener("contextmenu", (e) => { e.preventDefault(); openNotifMenu(row.dataset.nid, anchor()); });   // right-click + the keyboard context-menu key
      let lp = 0, lx = 0, ly = 0;   // long-press (touch) — a bonus path, never the only one
      const cancelLp = () => { if (lp) { clearTimeout(lp); lp = 0; } };
      row.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        lx = e.clientX; ly = e.clientY;
        cancelLp();
        lp = setTimeout(() => { lp = 0; openNotifMenu(row.dataset.nid, anchor()); }, 500);
      });
      row.addEventListener("pointermove", (e) => { if (lp && (Math.abs(e.clientX - lx) > 8 || Math.abs(e.clientY - ly) > 8)) cancelLp(); });   // a scroll is not a hold
      row.addEventListener("pointerup", cancelLp);
      row.addEventListener("pointercancel", cancelLp);
    });
    const req = root.querySelector("#msgReq"); if (req) req.addEventListener("click", () => { view = "requests"; render(); });
    const find = root.querySelector("#msgFind"); if (find) find.addEventListener("click", () => { view = "find"; results = null; findErr = ""; render(); });
    const findEmpty = root.querySelector("#msgFindEmpty"); if (findEmpty) findEmpty.addEventListener("click", () => { view = "find"; results = null; findErr = ""; render(); });
    const findGo = root.querySelector("#msgFindGo"), findIn = root.querySelector("#msgFindIn");
    if (findGo && findIn) {
      const go = async () => { findErr = ""; results = null; render(); try { results = await socialSearch(findIn.value); } catch (e) { findErr = e.message || "search failed"; } render(); const fi = root.querySelector("#msgFindIn"); if (fi) { fi.value = findIn.value; fi.focus(); } };
      findGo.addEventListener("click", go);
      findIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      findIn.focus();
    }
    root.querySelectorAll(".msg-add[data-uid]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { await socialRequest(b.dataset.uid); flash("Request sent"); view = "list"; socialPoll().catch(() => {}); render(); } catch (e) { b.disabled = false; flash(e.message || "couldn't send request"); } }));
    root.querySelectorAll(".msg-add[data-acc]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { await socialAccept(b.dataset.acc); flash("You're friends now"); socialPoll().catch(() => {}); render(); } catch (e) { b.disabled = false; flash(e.message || "couldn't accept"); } }));
    root.querySelectorAll(".msg-ign[data-ign]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { await socialIgnore(b.dataset.ign); socialPoll().catch(() => {}); render(); } catch (e) { b.disabled = false; flash(e.message || "couldn't ignore"); } }));
    const ta = root.querySelector("#msgTa"), send = root.querySelector("#msgSend");
    if (ta && send) {
      ta.value = draft[activeUid] || "";
      const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; };
      const doSend = async () => {
        const text = ta.value.trim(); if (!text) return;
        ta.value = ""; draft[activeUid] = ""; grow();
        try { await socialSend(activeUid, text); } catch (e) { ta.value = text; draft[activeUid] = text; grow(); flash(e.message || "couldn't send"); return; }
        paintThreadMsgs();
      };
      ta.addEventListener("input", () => { draft[activeUid] = ta.value; grow(); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
      send.addEventListener("click", doSend);
      grow(); ta.focus();
    }
  }
  render();
}
(function () { const b = document.getElementById("msgBtn"); if (b) b.addEventListener("click", openMessages); })();   // messages' OWN launcher — never the action button

// ── Setup wizard — coached first-run screens (design locked 2026-07-13, Working Docs/3_ROADMAP.md).
//    A coached version of the check-in experience: one question per screen, chunky one-tap
//    buttons, a plain hint under every question, everything skippable with zero shame.
//    Auto-runs ONCE for anyone with no bank connected and no dismissal; lives in the menu
//    (🧭 Setup) forever. Reuses the daily-space UI machinery — no second onboarding system. ──
const WIZ_KEY = "money.wizardDone", WIZ_PICKS_KEY = "money.areasInterest";
const WIZ_AREAS = [
  ["💰", "Money", true], ["🩺", "Health", true], ["⏱️", "Time", false], ["🏠", "Household", false],
  ["✅", "Tasks", false], ["🍳", "Meals", false], ["🤝", "Community", false], ["👥", "Relationships", false],
  ["📚", "Learning", false], ["🎨", "Creative", false], ["🧰", "Home & Stuff", false], ["📓", "Journal", false],
];
const WIZ_SEEDS = {   // picking an area seeds a matching check-in question (only kinds that exist today)
  Learning: { id: "learn", emoji: "📚", prompt: "Minutes on learning today?", input: "count", dest: { kind: "tracker", target: "Learning" } },
  Creative: { id: "create", emoji: "🎨", prompt: "Did you make something today?", input: "yesno", dest: { kind: "tracker", target: "Creative" } },
  Journal: { id: "day", emoji: "📓", prompt: "One line about today?", input: "note", dest: { kind: "dayflag", target: "journal" } },
};
function wizSeedDeck(picks) {
  try {
    const deck = loadDeck(); let changed = false;
    // check the UNFILTERED deck: a tombstone counts as PRESENT, so the wizard (which
    // auto-runs on a fresh device) can never silently resurrect a card the user deleted.
    // Seeds stamp updated:0 — shipping content must never outrank a real customization.
    picks.forEach((p) => {
      const sd = WIZ_SEEDS[p];
      if (sd && !deck.some((q) => q && q.id === sd.id)) {
        const last = deckLive(deck).slice(-1)[0];
        deck.push(Object.assign(JSON.parse(JSON.stringify(sd)), { ord: (last ? (+last.ord || 0) : 0) + 1, ordAt: 0, updated: 0 }));
        changed = true;
      }
    });
    if (changed) saveDeck(deck);
  } catch (e) {}
}
function openWizard() {
  if (document.getElementById("wizSpace")) return;
  const root = document.createElement("div"); root.id = "wizSpace"; root.className = "daily-space";
  root.innerHTML =
    '<div class="daily-top"><button class="daily-icn" id="wizClose" aria-label="close setup">✕</button>' +
      '<div class="daily-dots" id="wizDots"></div><span class="daily-icn" aria-hidden="true"></span></div>' +
    '<div class="daily-stage" id="wizStage"></div>';
  document.body.appendChild(root);
  const stage = root.querySelector("#wizStage"), dotsEl = root.querySelector("#wizDots");
  let i = 0, maxSeen = 0; let doneGranted = false;
  const picks = (() => { try { return JSON.parse(localStorage.getItem(WIZ_PICKS_KEY) || "[]") || []; } catch (e) { return []; } })();
  const markDone = () => { try { localStorage.setItem(WIZ_KEY, String(Date.now())); } catch (e) {} };
  const close = () => { markDone(); root.remove(); document.removeEventListener("keydown", onKey); };
  // Escape closes the wizard — UNLESS a .cat-modal is layered on top (the connect panel); then
  // let that panel's own Escape handler take it, so one press doesn't close both.
  function onKey(e) { if (e.key === "Escape" && !(typeof _modalStack !== "undefined" && _modalStack.length)) close(); }
  document.addEventListener("keydown", onKey);
  root.querySelector("#wizClose").addEventListener("click", close);
  const STEPS = [wWelcome, wName, wAreas, wMoney, wDeck, wDone];
  // tappable progress dots: revisit any step you've SEEN (≤ maxSeen); future dots are inert, so
  // a tired brain can move freely without blind-jumping past the data steps into the finish.
  function dots() {
    dotsEl.innerHTML = "";
    for (let s = 0; s < STEPS.length; s++) {
      const d = document.createElement("button"); d.type = "button";
      d.className = "daily-dot" + (s < i ? " done" : (s === i ? " on" : "")) + (s <= maxSeen ? "" : " future");
      if (s > maxSeen) d.disabled = true; else if (s !== i) d.addEventListener("click", () => goTo(s));
      dotsEl.appendChild(d);
    }
  }
  function next() { i++; if (i >= STEPS.length) { close(); return; } maxSeen = Math.max(maxSeen, i); render(); }
  function back() { if (i > 0) { i--; render(); } }
  function goTo(s) { if (s >= 0 && s <= maxSeen && s < STEPS.length) { i = s; render(); } }
  function render() {
    dots();
    const body = document.createElement("div"); body.className = "daily-body daily-in";
    STEPS[i](body);
    if (i > 0) { const bk = document.createElement("button"); bk.type = "button"; bk.className = "wiz-back"; bk.textContent = "‹ Back"; bk.addEventListener("click", back); body.appendChild(bk); }
    stage.innerHTML = ""; stage.appendChild(body);
  }
  const skipBtn = '<button class="wiz-skip" data-skip>skip this step</button>';
  // Open the real connect panel LAYERED over the wizard, then re-render the money step once it's
  // TRULY closed — surviving openConnect's own close-then-reopen-in-connected-state churn (450ms).
  function openConnectLayered(onDone) {
    try { openConnect(); } catch (e) { return; }
    let settle = 0;
    const obs = new MutationObserver(() => {
      if (document.querySelector(".connect-modal")) { if (settle) { clearTimeout(settle); settle = 0; } return; }
      if (settle) return;
      settle = setTimeout(() => { obs.disconnect(); try { onDone(); } catch (e) {} }, 450);
    });
    obs.observe(document.body, { childList: true });
  }
  // is money actually in? web: a SimpleFIN credential OR imported balances/ledger (CSV makes no
  // credential). The served FILES are decrypted in memory, so this is a synchronous check.
  function webMoneyIn() {
    if (typeof sfHasCred === "function" && sfHasCred()) return true;
    try {
      const f = (window.__cacheWebMoney && window.__cacheWebMoney.getFiles && window.__cacheWebMoney.getFiles()) || {};
      if ((f["ledger.jsonl"] || "").trim()) return true;
      const bal = JSON.parse(f["balances.json"] || "{}");
      if (bal && (bal.total != null || (Array.isArray(bal.accounts) && bal.accounts.length))) return true;
    } catch (e) {}
    return false;
  }

  function wWelcome(b) {
    b.innerHTML = '<div class="daily-emoji">✨</div><div class="daily-q">Welcome to your cache</div>' +
      '<div class="daily-hint">A calm, private home for your life — money first, the rest as you’re ready. A few short steps, and nothing here leaves your device without your say-so. You can move back and forth any time; you can’t lose your place.</div>' +
      '<div class="daily-opts"><button class="daily-btn" data-go><span class="e">🧭</span><span>Set me up</span></button>' +
      '<button class="daily-btn" data-explore><span class="e">👀</span><span>Just let me look around</span></button></div>';
    b.querySelector("[data-go]").addEventListener("click", next);
    b.querySelector("[data-explore]").addEventListener("click", close);
  }
  function wName(b) {
    const cur = (() => { try { return localStorage.getItem("money.cacheName") || ""; } catch (e) { return ""; } })();
    b.innerHTML = '<div class="daily-q">Name your cache</div>' +
      '<div class="daily-hint">It’s yours — call it anything. You can rename it any time from the menu.</div>' +
      '<input class="daily-note" id="wizName" maxlength="40" placeholder="e.g. The Vault, Mission Control, Pat’s Cache…" value="' + escapeHtml(cur) + '">' +
      '<button class="daily-cta" id="wizNameGo">Next</button>' + skipBtn;
    const save = () => { const v = (b.querySelector("#wizName").value || "").trim(); if (v) { try { localStorage.setItem("money.cacheName", v); } catch (e) {} try { if (typeof renderCharacter === "function") renderCharacter(); } catch (e) {} } };
    b.querySelector("#wizName").addEventListener("input", save);   // saves as you type, so Back keeps it
    b.querySelector("#wizNameGo").addEventListener("click", () => {
      save();
      next();
    });
    b.querySelector("[data-skip]").addEventListener("click", next);
  }
  function wAreas(b) {
    b.innerHTML = '<div class="daily-q">What should your cache keep an eye on?</div>' +
      '<div class="daily-hint">Tap anything that fits. Money and Health work today; the rest say “soon” honestly — your picks become cards in your daily deck and tell us what to build next.</div>' +
      '<div class="wiz-grid">' + WIZ_AREAS.map((a, ix) =>
        '<button class="wiz-chip' + (picks.indexOf(a[1]) !== -1 ? " on" : "") + '" data-ix="' + ix + '"><span class="e">' + a[0] + '</span><span>' + a[1] + '</span><span class="wiz-tag' + (a[2] ? " now" : "") + '">' + (a[2] ? "works today" : "soon") + "</span></button>").join("") + "</div>" +
      '<button class="daily-cta" id="wizAreasGo">Next</button>' + skipBtn;
    const savePicks = () => { try { localStorage.setItem(WIZ_PICKS_KEY, JSON.stringify(picks)); } catch (e) {} };
    b.querySelectorAll(".wiz-chip").forEach((c) => c.addEventListener("click", () => {
      const label = WIZ_AREAS[parseInt(c.dataset.ix, 10)][1];
      const at = picks.indexOf(label);
      if (at === -1) { picks.push(label); c.classList.add("on"); } else { picks.splice(at, 1); c.classList.remove("on"); }
      savePicks();   // persist immediately — Back re-marks chips from picks, never loses a tap
    }));
    b.querySelector("#wizAreasGo").addEventListener("click", () => { savePicks(); wizSeedDeck(picks); next(); });
    b.querySelector("[data-skip]").addEventListener("click", next);
  }
  function wMoney(b) {
    const renderConnect = () => {
      b.innerHTML = '<div class="daily-q">Get your money in</div>' +
        '<div class="daily-hint">This is the real payoff — and it replaces a pile of questions. Bring in your bank and your cache works out your spending, income and what’s safe to spend, no numbers typed by hand. It’s all read on <b>this device</b>; the server only ever sees a scrambled blob it can’t open. Not now? Totally fine — the ⚡ in the menu is here whenever you’re ready.</div>' +
        '<div class="daily-opts"><button class="daily-btn" data-connect><span class="e">🏦</span><span>Connect my bank</span></button></div>' +
        '<button class="wiz-skip" data-explain>How does this work?</button>' +
        '<button class="wiz-skip" data-later>I’ll connect later</button>';
      // desktop connect reloads on success, so mark setup done first (it just won't re-onboard)
      b.querySelector("[data-connect]").addEventListener("click", () => { if (!window.__CACHE_WEB__) markDone(); openConnectLayered(() => render()); });
      const ex = b.querySelector("[data-explain]"); if (ex) ex.addEventListener("click", () => { try { openSfExplainer(); } catch (e) {} });
      b.querySelector("[data-later]").addEventListener("click", next);
    };
    const renderIn = (line) => {
      b.innerHTML = '<div class="daily-emoji">✅</div><div class="daily-q">Your money is in</div>' +
        '<div class="daily-hint">' + escapeHtml(line || "Your cache is reading your spending, income and safe-to-spend right here — sealed so only your devices can open it.") + "</div>" +
        '<button class="daily-cta" data-next>Next</button>' +
        '<button class="wiz-skip" data-reconnect>Manage the connection</button>';
      b.querySelector("[data-next]").addEventListener("click", next);
      b.querySelector("[data-reconnect]").addEventListener("click", () => openConnectLayered(() => render()));
    };
    if (window.__CACHE_WEB__) {
      if (webMoneyIn()) renderIn(); else renderConnect();
    } else {
      renderConnect();   // desktop: default to the pitch, then flip to ✓ if the backend says connected
      fetch("/api/connect-status").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.connected && b.isConnected) renderIn("Your bank is connected — your cache pulls your balances and transactions."); }).catch(() => {});
    }
  }
  function wDeck(b) {
    let card = null;
    try { card = (deckLive(loadDeck()) || []).find((q) => q && q.prompt) || (typeof DEFAULT_DECK !== "undefined" ? DEFAULT_DECK.find((q) => q && q.prompt) : null) || null; } catch (e) {}
    const prompt = card && card.prompt ? card.prompt : "How’s your energy today?";
    b.innerHTML = '<div class="daily-q">Meet the deck</div>' +
      '<div class="daily-hint">The deck is the heart of your cache — a tiny daily check-in. Open it from the <b>🃏 button</b> at the bottom, answer a card or two, and your cache stays fed. One minute a day, no streaks, no guilt. The areas you just picked are already waiting in there.</div>' +
      '<div class="wiz-deckcard"><div class="wiz-deckcard-q">' + escapeHtml(prompt) + "</div>" +
        '<div class="wiz-deckcard-pips"><span class="wiz-pip"></span><span class="wiz-pip"></span><span class="wiz-pip on"></span><span class="wiz-pip"></span><span class="wiz-pip"></span></div>' +
        '<div class="wiz-deckcard-note">a card in your deck — nothing to answer right now</div></div>' +
      '<button class="daily-cta" id="wizDeckGo">Got it</button>';
    b.querySelector("#wizDeckGo").addEventListener("click", next);
  }
  function wDone(b) {
    // grant EXP + confetti ONCE — bouncing back into Done via Back or a dot must not re-grant
    const firstArrival = !doneGranted;
    if (firstArrival) {
      doneGranted = true; markDone();
      try { if (typeof addExp === "function") addExp(10); } catch (e) {}
      try { if (typeof logChar === "function") logChar("feat", "Setup complete · +10 EXP"); } catch (e) {}
    }
    const bits = [];
    try { if ((localStorage.getItem("money.cacheName") || "").trim()) bits.push("name set"); } catch (e) {}
    if (picks.length) bits.push(picks.length + (picks.length === 1 ? " area" : " areas") + " picked");
    bits.push((window.__CACHE_WEB__ && webMoneyIn()) ? "money in" : "bank saved for later (⚡ in the menu)");
    b.innerHTML = '<div id="wizDone" class="daily-emoji">✨</div><div class="daily-big">Your cache is ready</div>' +
      '<div class="daily-exp">+10 EXP</div><div class="daily-funny">' + escapeHtml(bits.join(" · ")) + "</div>" +
      '<div class="daily-hint">One thing to remember: <b>🃏 the deck</b> at the bottom — that’s your daily minute. (Didn’t link a bank? The ⚡ in the menu is there whenever you’re ready.)</div>' +
      '<button class="daily-cta" id="wizEnter">Enter your cache</button>';
    if (firstArrival) { try { const r = stage.getBoundingClientRect(); dailyBurst(stage, r.width / 2, r.height * 0.36); } catch (e) {} }
    const pop = b.querySelector("#wizDone"); if (pop && !reduceMotion() && pop.animate) pop.animate([{ transform: "scale(.4) rotate(-12deg)" }, { transform: "scale(1.15) rotate(6deg)" }, { transform: "scale(1)" }], { duration: 600, easing: "cubic-bezier(.2,1.3,.4,1)" });
    b.querySelector("#wizEnter").addEventListener("click", () => { close(); setTimeout(showDeckCoach, 700); });   // money is already in-flow; just land the deck ritual
  }
  render();
}
(function () {
  // auto-run once: only when nothing is connected AND it was never shown. The public demo
  // fakes connected:true, existing connected installs are connected — neither ever sees this.
  try { if (localStorage.getItem(WIZ_KEY)) return; } catch (e) { return; }
  fetch("/api/connect-status").then((r) => { if (!r.ok) throw new Error("no"); return r.json(); })
    .then((d) => {
      // re-check AFTER the fetch: on the hosted app this request parks until login,
      // and login restores money.wizardDone from the vault — without this second look
      // every fresh device re-ran setup for people who already did it (found 2026-07-13)
      try { if (localStorage.getItem(WIZ_KEY)) return; } catch (e) { return; }
      if (!d || !d.connected) setTimeout(openWizard, 900);
    })
    .catch(() => {});   // no backend, no login → never auto-nag
})();

// The visit unicorn goes psychedelic tie-dye and bursts into rainbow confetti, then we warp to the Ledger.
function explodeUnicorn(btn, done) {
  const uni = btn.querySelector(".lp-uni");
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const TIE = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0a84ff", "#5e5ce6", "#bf5af2"];
  if (uni) uni.classList.add("tiedye");
  const layer = document.createElement("div");
  layer.className = "uni-burst";
  document.body.appendChild(layer);
  const N = 28;
  for (let i = 0; i < N; i++) {
    const p = document.createElement("span");
    if (i % 5 === 0) { p.className = "uni-bit emoji"; p.textContent = (i % 10 === 0) ? "🦄" : "✨"; }
    else { p.className = "uni-bit dot"; p.style.background = TIE[i % TIE.length]; }
    p.style.left = cx + "px"; p.style.top = cy + "px";
    layer.appendChild(p);
    const ang = (Math.PI * 2 * i) / N + Math.random() * 0.6;
    const dist = 70 + Math.random() * 110;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 28;
    p.animate(
      [{ transform: "translate(-50%,-50%) scale(1) rotate(0deg)", opacity: 1 },
       { transform: "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) scale(0.15) rotate(" + (Math.random() * 560 - 280) + "deg)", opacity: 0 }],
      { duration: 720 + Math.random() * 380, easing: "cubic-bezier(.16,.8,.3,1)" }
    );
  }
  setTimeout(() => { if (typeof done === "function") done(); }, 380);   // warp ignites under the still-flying confetti
  setTimeout(() => { layer.remove(); if (uni) uni.classList.remove("tiedye"); }, 1180);
}
(function () {
  const lb = document.getElementById("ledgerBtn");
  if (!lb) return;
  lb.addEventListener("click", () => {
    if (reduceMotion()) { openLedger(); return; }   // seizure-safe: skip the tie-dye strobe + burst
    explodeUnicorn(lb, openLedger);
  });
})();
document.getElementById("manageCats").addEventListener("click", () => { openCategoryManager(); setSidebar(false); });
// mobile-only menu row (the bottom bar holds only the deck there)
(function () {
  const ms = document.getElementById("menuSync");
  if (ms) ms.addEventListener("click", () => {
    setSidebar(false);
    flash("Syncing…");
    Promise.resolve(runSync()).then(() => flash("Synced ✓")).catch(() => flash("Sync hit a snag — try again"));
  });
  // theme + background live in the menu now — the rows drive the original buttons'
  // handlers, so the pickers behave exactly as before (they're fixed-position pops)
  const mt = document.getElementById("menuTheme");
  if (mt) mt.addEventListener("click", () => { setSidebar(false); const b = document.getElementById("themeToggle"); if (b) b.click(); });
  const mb = document.getElementById("menuBg");
  if (mb) mb.addEventListener("click", () => { setSidebar(false); const b = document.getElementById("bgToggle"); if (b) b.click(); });
  // the stats strip remembers where you swiped it — pick your stat once, it sticks
  setTimeout(() => {
    const s = document.querySelector(".stats");
    if (!s) return;
    try { const x = parseInt(localStorage.getItem("money.statsScroll")) || 0; if (x > 0) s.scrollLeft = x; } catch (e) {}
    let t = null;
    s.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => { try { localStorage.setItem("money.statsScroll", String(Math.round(s.scrollLeft))); } catch (e) {} }, 300);
    }, { passive: true });
  }, 700);
})();
document.getElementById("reportBug").addEventListener("click", () => { openBugReport(); setSidebar(false); });
document.getElementById("openA11y").addEventListener("click", () => { openA11y(); setSidebar(false); });

// ── Subscription detail + rename (alias only) ──────────────
function closeSubDetail() {
  const m = document.querySelector(".subd-modal");
  const b = document.getElementById("subdBackdrop");
  if (m) m.remove();
  if (b) b.remove();
}
function openSubDetail(item, onDone) {
  closeSubDetail();
  if (!item) return;
  const back = document.createElement("div");
  back.className = "cat-backdrop";
  back.id = "subdBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeSubDetail(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal subd-modal";
  const cur = subName(item);
  const descs = (item.descriptions || []).map((d) => "<li>" + escapeHtml(d) + "</li>").join("") || "<li>—</li>";
  const accts = (item.accounts || []).map(escapeHtml).join(" · ") || "—";
  modal.innerHTML =
    '<div class="cat-head"><span>Subscription</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="subd-body">' +
      '<label class="subd-field"><span>Display name</span>' +
        '<input class="subd-input" type="text" value="' + escapeHtml(cur) + '" /></label>' +
      '<div class="subd-note">Just a label — renaming won’t change what data this is tied to.</div>' +
      '<label class="subd-field"><span>Charges</span><select class="subd-cad">' +
        CADENCES.map((c) => '<option value="' + c.id + '"' + (c.id === subCadence(item.key) ? " selected" : "") + ">" + c.label + "</option>").join("") +
      "</select></label>" +
      '<div class="subd-note">' + fmtUSD(item.amount) + " per charge" +
        (subCadence(item.key) !== "monthly" ? " ≈ <b>" + fmtUSD(monthlyAmount(item)) + "/mo</b> in your budget" : "") + "</div>" +
      '<div class="subd-meta"><span class="subd-k">matches</span><code>' + escapeHtml(item.key) + "</code></div>" +
      '<div class="subd-meta"><span class="subd-k">charges</span>' + (item.count || 0) +
        " · " + fmtUSD(item.amount) + " total</div>" +
      '<div class="subd-meta"><span class="subd-k">account</span>' + accts + "</div>" +
      '<div class="subd-meta"><span class="subd-k">bank lines</span></div>' +
      '<ul class="subd-descs">' + descs + "</ul>" +
      '<div class="subd-actions">' +
        '<button class="subd-reset" type="button">reset</button>' +
        '<button class="subd-save" type="button">Save name</button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(back);
  document.body.appendChild(modal);
  const finish = () => { closeSubDetail(); if (typeof onDone === "function") onDone(); };
  modal.querySelector(".cat-close").addEventListener("click", closeSubDetail);
  modal.querySelector(".subd-cad").addEventListener("change", (e) => {
    setSubCadence(item.key, e.target.value);
    if (typeof onDone === "function") onDone();  // ripple to the map + budget; modal stays open
  });
  const input = modal.querySelector(".subd-input");
  modal.querySelector(".subd-save").addEventListener("click", () => { setSubName(item.key, input.value); finish(); });
  modal.querySelector(".subd-reset").addEventListener("click", () => { setSubName(item.key, ""); finish(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { setSubName(item.key, input.value); finish(); } });
  input.focus();
  input.select();
}

// ── Roadmap + Features (reads BACKLOG.md / FEATURES.md) ────
function closeRoadmap() {
  const m = document.querySelector(".rm-modal");
  const b = document.getElementById("rmBackdrop");
  if (m) m.remove();
  if (b) b.remove();
}
function rmInline(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
function rmParse(md) {
  let html = "";
  md.split("\n").forEach((line) => {
    const h = line.match(/^##\s+(.*)/);
    if (h) { html += '<div class="rm-section">' + escapeHtml(h[1]) + "</div>"; return; }
    const chk = line.match(/^- \[([ xX])\]\s+(.*)/);
    if (chk) {
      const done = chk[1].toLowerCase() === "x";
      html += '<div class="rm-item' + (done ? " done" : "") + '"><span class="rm-box">' +
        (done ? "✓" : "•") + '</span><span class="rm-text">' + rmInline(chk[2]) + "</span></div>";
      return;
    }
    const b = line.match(/^[-*]\s+(.*)/);
    if (b) {
      html += '<div class="rm-item"><span class="rm-box">•</span><span class="rm-text">' +
        rmInline(b[1]) + "</span></div>";
    }
  });
  return html;
}
function openRoadmap() {
  if (document.querySelector(".rm-modal")) return;
  const back = document.createElement("div");
  back.className = "cat-backdrop";
  back.id = "rmBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeRoadmap(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal rm-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Roadmap</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="rm-tabs">' +
      '<button class="rm-tab active" data-src="BACKLOG.md">Roadmap</button>' +
      '<button class="rm-tab" data-src="FEATURES.md">Features</button>' +
    "</div>" +
    '<div class="cat-list rm-list">loading…</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", closeRoadmap);
  const listEl = modal.querySelector(".rm-list");
  const rmCache = {};
  function show(btn) {
    modal.querySelectorAll(".rm-tab").forEach((t) => t.classList.toggle("active", t === btn));
    const src = btn.dataset.src;
    // cached → swap instantly; otherwise keep the current content visible while
    // the (tiny, local) file loads, so the modal never collapses and flickers
    if (rmCache[src] !== undefined) { listEl.innerHTML = rmCache[src]; return; }
    // Same-origin first — desktop's server.py serves the repo root, and build-app.sh copies
    // BACKLOG.md/FEATURES.md into docs/ for the hosted app. Fall back to the public repo so
    // the modal still fills if a deploy predates that copy (raw.githubusercontent is already
    // in the CSP allowlist; it's how docs/roadmap/index.html loads the same two files).
    const rmBust = (u) => u + (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    fetch(rmBust(src))
      .then((r) => { if (!r.ok) throw new Error("local " + r.status); return r.text(); })
      .catch(() => fetch(rmBust("https://raw.githubusercontent.com/cozykace/thecache/main/" + src))
        .then((r) => { if (!r.ok) throw new Error("raw " + r.status); return r.text(); }))
      .then((md) => { rmCache[src] = rmParse(md) || '<div class="cat-empty">empty</div>'; listEl.innerHTML = rmCache[src]; })
      .catch(() => { listEl.innerHTML = '<div class="cat-empty">couldn’t load ' + src + "</div>"; });
  }
  modal.querySelectorAll(".rm-tab").forEach((t) => t.addEventListener("click", () => show(t)));
  show(modal.querySelector(".rm-tab"));
}
document.getElementById("roadmapBtn").addEventListener("click", (e) => { e.stopPropagation(); openRoadmap(); });

// ── Status & next actions (bottom-right) ───────────────────
const statusBtn = document.getElementById("statusBtn");
const statusPanel = document.getElementById("statusPanel");
const statusText = statusBtn ? statusBtn.querySelector(".status-text") : null;

function syncNow() {
  flash("Syncing…");
  fetch("/api/sync", { method: "POST" })
    .then((r) => r.json())
    .then((res) => {
      if (res && res.ok) {
        // A pull can succeed with good data yet still carry per-account warnings the
        // bank returned (e.g. one login expired) — show them instead of a plain "Synced".
        const warn = (res.errors && res.errors.length) ? res.errors.join("; ") : "";
        flash(warn ? ("Synced, but your bank flagged: " + warn) : "Synced — reloading…");
        autoPushNow().then(() => setTimeout(() => location.reload(), warn ? 3200 : 1200));
      }
      else flash((res && res.error) || "sync failed");
    })
    .catch(() => flash("backend not running — start python3 server.py"));
}

// cheap pill update from Store data (runs on every ripple) — the heavy issue
// list is only fetched when you actually open the Review panel
function renderStatus() {
  if (!statusBtn) return;
  const d = Store.data;
  let n = 0, sev = -1;
  if (d) {
    n += (d.income && d.income.untagged) || 0;
    const other = ((d.spending && d.spending.categories) || []).find((c) => c.key === "other");
    if (other && other.amount > 0) n += 1;
    if (d.updated) {
      const days = (Date.now() - new Date(d.updated).getTime()) / 86400000;
      if (days >= 2) { n += 1; sev = Math.max(sev, days >= 7 ? 2 : 1); }
    }
    if (n) sev = Math.max(sev, 1);
  }
  statusText.textContent = n ? "review" : "all clear";
  statusBtn.dataset.sev = String(n ? sev : -1);
}

const catOpts = (cats, cur) => cats
  .map((c) => '<option value="' + c.key + '"' + (c.key === cur ? " selected" : "") + ">" + escapeHtml(c.label) + "</option>").join("");

// put a deleted transaction back — the escape hatch that makes tombstones safe
function wireUndelete() {
  statusPanel.querySelectorAll(".rv-undel").forEach((b) => b.addEventListener("click", () => {
    const id = b.closest(".rv-item").dataset.id;
    if (!id) return;
    apiPost("/api/undelete-txn", { id: id }, () => { Store.refresh(); openReview(); });
  }));
}
function openReview() {
  statusPanel.innerHTML = '<div class="src-title">Review</div><div class="status-clear">loading…</div>';
  Promise.all([
    fetch("/api/issues?t=" + Date.now()).then((r) => (r.ok ? r.json() : { issues: [] })).catch(() => ({ issues: [] })),
    fetch("/api/categories?t=" + Date.now()).then((r) => (r.ok ? r.json() : { categories: [] })).catch(() => ({ categories: [] })),
    fetch("/api/deleted?t=" + Date.now()).then((r) => (r.ok ? r.json() : { deleted: [] })).catch(() => ({ deleted: [] })),
  ]).then(([iss, cat, del]) => {
    const issues = iss.issues || [];
    const cats = (cat.categories || []).filter((c) => c.key !== "transfer");
    const gone = (del && del.deleted) || [];
    // deleting a transaction is reversible — show what you removed so a mistake is
    // one tap from being put back (a delete otherwise sticks across every device)
    const goneHtml = gone.length
      ? '<div class="rv-group rv-gone-h">Deleted · ' + gone.length + " · <span class=\"rv-gone-sub\">tap undo to put one back</span></div>" +
        gone.slice(0, 8).map((t) => '<div class="rv-item rv-gone" data-id="' + escapeHtml(t.id || "") + '">' +
          '<span class="rv-txt">' + escapeHtml(t.description || "(no description)") +
          (t.amount != null ? ' · <span class="rv-amt">' + fmtUSD(Math.abs(+t.amount || 0)) + "</span>" : "") + "</span>" +
          '<button class="rv-act rv-undel">undo</button></div>').join("")
      : "";
    let html = '<div class="src-title">Review · ' + issues.length + "</div>";
    if (!issues.length) {
      statusPanel.innerHTML = html + '<div class="status-clear">✓ nothing needs you right now</div>' + goneHtml;
      wireUndelete();
      return;
    }
    const groups = [["duplicate", "Possible duplicates"], ["subscription", "Recurring · not tracked"],
                    ["sub_dropped", "Recurring · stopped?"],
                    ["category", "Uncategorized"], ["income", "Untagged deposits"]];
    groups.forEach(([type, label]) => {
      const items = issues.filter((i) => i.type === type);
      if (!items.length) return;
      html += '<div class="rv-group">' + label + " · " + items.length + "</div>";
      html += items.slice(0, 10).map((it) => {
        const base = '<div class="rv-item" data-type="' + type + '" data-key="' + escapeHtml(it.key || "") + '"' +
          (it.ids ? " data-ids='" + escapeHtml(JSON.stringify(it.ids)) + "'" : "") + ">" +
          '<div class="rv-top"><span class="rv-label" title="' + escapeHtml(it.detail) + '">' + escapeHtml(it.label) + "</span></div>" +
          '<div class="rv-detail">' + escapeHtml(it.detail) + "</div>";
        if (type === "category") return base + '<select class="rv-cat">' + catOpts(cats, "other") + "</select></div>";
        if (type === "subscription") return base + '<button class="rv-act rv-sub">+ track as subscription</button></div>';
        if (type === "sub_dropped") return base + '<button class="rv-act rv-pause">mark paused</button></div>';
        if (type === "income") return base + '<button class="rv-act rv-inc">tag this income</button></div>';
        if (type === "duplicate") return base + '<button class="rv-act rv-del">remove one</button></div>';
        return base + "</div>";
      }).join("");
      if (items.length > 10) html += '<div class="rv-more">+' + (items.length - 10) + " more…</div>";
    });
    statusPanel.innerHTML = html + goneHtml;
    wireUndelete();
    const refresh = () => { Store.refresh(); openReview(); };
    statusPanel.querySelectorAll(".rv-cat").forEach((s) => s.addEventListener("change", (e) => {
      const merch = e.target.closest(".rv-item").dataset.key;
      apiPost("/api/category", { action: "reassign", merchant: merch, to: e.target.value }, refresh);
    }));
    statusPanel.querySelectorAll(".rv-sub").forEach((b) => b.addEventListener("click", () =>
      apiPost("/api/categorize", { merchant: b.closest(".rv-item").dataset.key, category: "subscriptions" }, refresh)));
    statusPanel.querySelectorAll(".rv-del").forEach((b) => b.addEventListener("click", () => {
      let ids = []; try { ids = JSON.parse(b.closest(".rv-item").dataset.ids || "[]"); } catch (e) {}
      if (ids[0]) apiPost("/api/delete-txn", { id: ids[0] }, refresh);
    }));
    statusPanel.querySelectorAll(".rv-inc").forEach((b) => b.addEventListener("click", () =>
      openIncomeTagger(refresh)));
    statusPanel.querySelectorAll(".rv-pause").forEach((b) => b.addEventListener("click", () => {
      const key = b.closest(".rv-item").dataset.key;
      setSubPaused(key, true);  // updates SUBS + marks dirty
      // persist immediately (merge-guarded — never a raw whole-map POST) so the
      // re-fetched issues reflect it, then refresh
      pushSubs().then(refresh);
    }));
  });
}
function apiPost(url, body, done) {
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
    .then(() => { flash("✓ updated"); if (done) done(); })
    .catch(() => flash("couldn't save — backend down? click the server light"));
}
if (statusBtn) {
  statusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !statusPanel.classList.contains("open");
    statusPanel.classList.toggle("open");
    if (opening) openReview();
  });
  document.addEventListener("click", (e) => {
    if (!statusPanel.contains(e.target) && !statusBtn.contains(e.target)) statusPanel.classList.remove("open");
  });
  // NOTE: don't call renderStatus() here — Store isn't defined yet (it's below).
  // The pill fills in on the first Store.refresh() at boot (emit → renderStatus).
}

// ── Import CSV statements (button + drag-drop) ─────────────
function flash(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove("show"), 2800);
}
function handleCsvFile(file) {
  if (!file || !/\.csv$/i.test(file.name)) { flash("Drop a .csv file (export from your bank)"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    flash("Importing " + file.name + "…");
    // On the hosted web app there's no backend — the money engine (webmoney.js) parses,
    // dedupes, computes the ledger + snapshot HERE in the browser, then seals it into the
    // encrypted vault. This is the one place the web app writes money; everything else
    // still routes to the desktop. Falls back to the friendly message if the engine or
    // cloud store isn't ready yet.
    if (window.__CACHE_WEB__ && window.__cacheMoneyImport) {
      // On the web there is NO on-device persistence for money — the ONLY durable copy is the
      // sealed cloud vault. So an import is safe only once its push lands; never claim "syncing"
      // when we can't, and refuse the volatile import rather than lose it silently on reload.
      if (!cloudReady()) {
        flash(cloudPaused()
          ? "Turn Cloud sync on first (Settings) — on the web your cache lives in your cloud, so an import can't be kept while sync is off."
          : "Log in to import — on the web your imported data is saved to your cloud.");
        return;
      }
      let res;
      try { res = window.__cacheMoneyImport(file.name, String(reader.result)); }
      catch (e) { flash("Couldn't import that CSV — " + ((e && e.message) || "unknown error")); return; }
      if (!res || !res.ok) { flash((res && res.error) || "import failed"); return; }
      if (!res.added) { flash("Nothing new — those " + (res.dup || 0) + " were already in your cache"); return; }
      flash("Imported " + res.added + " new from " + file.name + " — saving to your cloud…");
      Store.refresh();                                        // re-pull /api/summary (now live from the new ledger)
      try { updateSyncHealth(); } catch (e) {}
      cloudSealPendingMoney(file.name);                       // seal into the vault, report truthfully, retry until it lands
      return;
    }
    fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, content: String(reader.result) }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) { flash(res.error || "import failed"); return; }
        if (res.new === 0) { flash("Nothing new — those " + res.dup + " were already in"); return; }
        flash("Imported " + res.new + " new from " + file.name + " — reloading…");
        setTimeout(() => location.reload(), 1300);
      })
      .catch(() => flash("backend not running — start python3 server.py"));
  };
  reader.readAsText(file);
}
// hidden file input, opened by the sidebar button
const csvInput = document.createElement("input");
csvInput.type = "file";
csvInput.accept = ".csv,text/csv";
csvInput.style.display = "none";
csvInput.addEventListener("change", () => {
  if (csvInput.files[0]) handleCsvFile(csvInput.files[0]);
  csvInput.value = "";
});
document.body.appendChild(csvInput);
const importBtn = document.getElementById("importStatement");
if (importBtn) importBtn.addEventListener("click", () => { csvInput.click(); setSidebar(false); });
// drag a CSV anywhere onto the dashboard
const dropZone = document.createElement("div");
dropZone.className = "csv-drop";
dropZone.innerHTML = '<div class="csv-drop-inner"><i data-lucide="file-down"></i><span>Drop CSV to import</span></div>';
document.body.appendChild(dropZone);
let dragDepth = 0;
function hasFiles(e) { return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes("Files"); }
window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; dragDepth++; dropZone.classList.add("show"); });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropZone.classList.remove("show"); });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove("show");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleCsvFile(f);
});

// ── Hold space to pan the canvas (hand cursor) ─────────────
let panning = false, panStart = null;
function isTypingTarget(t) {
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  if (isTypingTarget(e.target) || document.querySelector(".cat-modal, .subd-modal")) return;
  e.preventDefault();           // EVERY keydown incl. repeats — held space used to scroll the board wildly while the pan-hand showed (only the first press was prevented; repeats slipped through)
  if (e.repeat) return;
  panning = true;
  document.body.classList.add("panning");   // → grab (open hand) cursor
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  panning = false; panStart = null;
  document.body.classList.remove("panning", "grabbing");
});
// If the space keyup gets eaten (Spotlight, app switch), pan-mode used to stick forever —
// clicks kept panning until a reload. Losing window focus now always ends the pan.
window.addEventListener("blur", () => {
  panning = false; panStart = null;
  document.body.classList.remove("panning", "grabbing");
});
// capture phase so a space-drag pans instead of grabbing a widget
board.addEventListener("pointerdown", (e) => {
  if (!panning) return;
  e.stopPropagation(); e.preventDefault();
  panStart = { x: e.clientX, y: e.clientY, sl: board.scrollLeft, st: board.scrollTop };
  document.body.classList.add("grabbing");  // → grabbing (closed hand)
  try { board.setPointerCapture(e.pointerId); } catch (err) {}
}, true);
board.addEventListener("pointermove", (e) => {
  if (!panStart) return;
  board.scrollLeft = panStart.sl - (e.clientX - panStart.x);
  board.scrollTop = panStart.st - (e.clientY - panStart.y);
});
const endPan = () => { panStart = null; document.body.classList.remove("grabbing"); };
board.addEventListener("pointerup", endPan);
board.addEventListener("pointercancel", endPan);

// ── Backend heartbeat (HUD light) ──────────────────────────
const serverBtn = document.getElementById("serverBtn");
// hosted web (webcache.js sets __CACHE_WEB__) OR the public demo (demo-data.js sets
// __CACHE_DEMO__ and fakes /api/ping + /api/restart) — neither has a server.py to restart.
const _noLocalBackend = !!(window.__CACHE_WEB__ || window.__CACHE_DEMO__);
if (serverBtn && _noLocalBackend) serverBtn.style.display = "none";   // no local backend here — a "restart" pill would be theater
const serverText = serverBtn ? serverBtn.querySelector(".server-text") : null;
let _srvWasDown = false;
function setServer(state) {
  // edge-triggered recovery: the moment the backend comes back after being down,
  // (1) tell widgets sitting in an honest offline state (cache:online — the Brain
  // Bucket and friends listen), (2) re-pull the board's numbers, (3) flush any
  // subs edit that queued while it was unreachable. Fires once per transition.
  const cameBack = _srvWasDown && state !== "down";
  _srvWasDown = state === "down";
  if (cameBack) {
    try { document.dispatchEvent(new CustomEvent("cache:online")); } catch (e) {}
    // mirror the boot order: subs decisions load BEFORE the summary pull, so the
    // emit never paints every bill as optional/unpaused from an empty SUBS map
    try {
      const refresh = () => { try { if (typeof Store !== "undefined" && Store.refresh) Store.refresh(); } catch (e) {} };
      if (!_subsLoaded) loadSubs().then(refresh);
      else { if (_subsDirty) pushSubs(); refresh(); }
    } catch (e) {}
  }
  // mirror live status on the brand dot next to the THE CACHE title
  const brandDot = document.querySelector(".brand-dot");
  if (brandDot) brandDot.dataset.state = state;
  if (!serverBtn) return;
  serverBtn.dataset.state = state;
  serverText.textContent = state === "live" ? "live" : state === "stale" ? "restart" : "offline";
  serverBtn.title =
    state === "live" ? "backend running — click to restart" :
    state === "stale" ? "backend running OLD code — click to restart and load the latest" :
    "backend not running — double-click start.command (or run python3 server.py)";
}
function restartServer() {
  flash("Restarting backend…");
  fetch("/api/restart", { method: "POST" }).catch(() => {});
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    fetch("/api/ping?t=" + Date.now())
      .then((r) => {
        if (r.ok) {
          clearInterval(iv);
          setServer("live");
          flash("Backend restarted ✓ — reloading…");
          setTimeout(() => location.reload(), 700);
        }
      })
      .catch(() => {});
    if (tries > 25) { clearInterval(iv); pingServer(); flash("Restart timed out — try start.command"); }
  }, 400);
}
function pingServer() {
  // any HTTP response = process is up; 200 from /api/ping = current build; reject = down
  fetch("/api/ping?t=" + Date.now())
    .then((r) => {
      const prev = serverBtn ? serverBtn.dataset.state : "";
      setServer(r.ok ? "live" : "stale");
      // server is up but the boot pull never landed (page loaded before it) → the
      // board is wedged at "…"/"syncing…"; rescue it. The truthy-prev guard skips
      // the very first ping so the deliberate boot order (loadSubs → refresh) holds.
      if (r.ok && prev && !Store.data) { try { Store.refresh(); } catch (e) {} }
    })
    .catch(() => setServer("down"));
}
// Skipped entirely without a local backend: otherwise the hidden pill still polls /api/ping
// every 8s forever, and webcache/demo's faked 200 paints a green "backend running" brand dot
// for a backend that doesn't exist.
if (serverBtn && !_noLocalBackend) {
  serverBtn.addEventListener("click", () => {
    if (serverBtn.dataset.state === "down") {
      flash("Server's off — double-click start.command (or run python3 server.py)");
      pingServer();
    } else {
      restartServer();  // up (or stale) → restart it in place
    }
  });
  pingServer();
  setInterval(pingServer, 8000);
}

// ── Global Period (the date range the span widgets are showing) ────────────
//   One source of truth. The span widgets fetch /api/summary?<period>, so
//   changing it re-filters income / spending / subs / gap from the ledger.
const PERIOD_KEY = "money.period";
const PERIOD_WIDGETS = new Set(["breakdown", "income", "gap", "work", "coreflex", "subscriptions", "whatsnext", "plan"]);
let PERIOD = (function () {
  try { return JSON.parse(localStorage.getItem(PERIOD_KEY)) || { kind: "mtd" }; }
  catch (e) { return { kind: "mtd" }; }
})();
function periodQS() {
  let qs = "kind=" + encodeURIComponent(PERIOD.kind);
  if (PERIOD.ym) qs += "&ym=" + encodeURIComponent(PERIOD.ym);
  if (PERIOD.kind === "custom" && PERIOD.start && PERIOD.end) qs += "&start=" + PERIOD.start + "&end=" + PERIOD.end;
  return qs;
}
function periodLabel() {
  if (PERIOD.kind === "30d") return "Last 30 days";
  if (PERIOD.kind === "90d") return "Last 90 days";
  if (PERIOD.kind === "all") return "All time";
  if (PERIOD.kind === "custom" && PERIOD.start && PERIOD.end) {
    const f = (s) => { const a = s.split("-"); return new Date(+a[0], +a[1] - 1, +a[2]).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
    return f(PERIOD.start) + " – " + f(PERIOD.end);
  }
  let d;
  if (PERIOD.ym) { const a = PERIOD.ym.split("-"); d = new Date(+a[0], +a[1] - 1, 1); }
  else d = new Date();
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function setPeriod(p) {
  const prev = PERIOD;
  PERIOD = p;  // must be set BEFORE refresh — periodQS() reads it inside Store.refresh
  try { localStorage.setItem(PERIOD_KEY, JSON.stringify(p)); } catch (e) {}
  updatePeriodUI();
  Store.refresh().then((d) => {
    if (d) return;  // pull succeeded — widgets now show the new period
    if (PERIOD !== p) return;  // a newer selection owns the label — don't revert over it
    // pull failed → every number on screen is still the OLD period; a label
    // claiming the new one would be a lie. Put the truthful label back.
    PERIOD = prev;
    try { localStorage.setItem(PERIOD_KEY, JSON.stringify(prev)); } catch (e) {}
    updatePeriodUI();
    flash("Couldn't load that period — still showing " + periodLabel());
  });
}
function updatePeriodUI() {
  const lab = periodLabel();
  const txt = document.querySelector("#periodBtn .period-text");
  if (txt) txt.textContent = lab;
  document.querySelectorAll(".w-period").forEach((e) => { e.textContent = lab; });
}
// The snapshot's identity: `updated` moves only on a bank sync, `rev` bumps on ANY
// derived-data change (category edit, income tag, delete, CSV import, a merged tag
// from another device). Widgets that cache their own side-feeds key their re-pull on
// this stamp, so a tag change in one widget ripples to every other — and a purely
// local ripple (pin, must-pay, core/flex) leaves it unchanged and stays fetch-free.
function dataStamp(d) { return d ? (d.updated || "") + "|" + (d.rev || 0) : null; }
// ── Store: the single source of truth ──────────────────────────────────────
//   ONE fetch of /api/summary?<period>. Every money widget subscribes and
//   renders from the same object, so they can never disagree. Any edit calls
//   Store.refresh() (re-pull) or Store.emit() (local-only change like core/flex)
//   and EVERY widget re-renders from the same data — edits ripple everywhere.
const Store = {
  data: null,
  recurring: [],   // bank-confirmed recurring bills (exact amounts) — shared by plan + stats
  ready: false,
  _subs: [],
  subscribe(el, fn) {
    this._subs.push({ el, fn });
    if (this.data) { try { fn(this.data); } catch (e) {} }  // paint now if data's already here
  },
  emit() {  // re-render everyone from the CURRENT data (no re-fetch)
    if (!this.data) return;
    this._subs = this._subs.filter((s) => document.body.contains(s.el));  // drop removed widgets
    this._subs.forEach((s) => { try { s.fn(this.data); } catch (e) {} });
    drawIcons();
    if (typeof renderStatus === "function") renderStatus();
  },
  refresh() {  // re-pull from the server, then ripple to every subscriber
    const t = Date.now();
    return Promise.all([
      fetch("/api/summary?" + periodQS() + "&t=" + t).then((r) => { if (!r.ok) throw new Error("backend"); return r.json(); }),
      fetch("/api/recurring?t=" + t).then((r) => (r.ok ? r.json() : { recurring: [] })).catch(() => ({ recurring: [] })),
    ])
      .then(([d, rec]) => {
        if (d.catmeta && d.catmeta.labels) CAT_LABELS = d.catmeta.labels;  // renames ripple to every widget
        // server data moved (categorize, tag, delete, import, sync…) → arm a cloud
        // auto-push. Keyed on the STAMP, not `updated`: a tag edit bumps only rev, and
        // keying on updated alone meant a categorization never armed a push at all —
        // it reached the cloud only if some unrelated change happened to trigger one.
        // The push's own content hash makes repeats free, so boot is harmless here.
        const st = dataStamp(d);
        if (st && st !== this._cloudSeen) { this._cloudSeen = st; autoPushSoon(); }
        this.data = d; this.recurring = (rec && rec.recurring) || []; this.ready = true; this.emit(); return d;
      })
      .catch(() => {});  // keep the last good data on the screen if a pull fails
  },
};
function closePeriodMenu() {
  const m = document.getElementById("periodMenu");
  if (m) m.remove();
  document.removeEventListener("pointerdown", periodOutside);
}
function periodOutside(e) {
  const m = document.getElementById("periodMenu");
  if (m && !m.contains(e.target) && !e.target.closest("#periodBtn")) closePeriodMenu();
}
function openPeriodMenu(anchor) {
  if (document.getElementById("periodMenu")) { closePeriodMenu(); return; }
  const menu = document.createElement("div");
  menu.className = "period-menu"; menu.id = "periodMenu";
  const presets = [
    { kind: "mtd", label: "This month" },
    { kind: "30d", label: "Last 30 days" },
    { kind: "90d", label: "Last 90 days" },
    { kind: "all", label: "All time" },
  ];
  const cstart = PERIOD.kind === "custom" ? PERIOD.start || "" : "";
  const cend = PERIOD.kind === "custom" ? PERIOD.end || "" : "";
  menu.innerHTML =
    '<div class="pm-group">' +
    presets.map((o) =>
      '<button class="pm-item' + (PERIOD.kind === o.kind ? " active" : "") +
      '" data-kind="' + o.kind + '">' + o.label + "</button>").join("") +
    '</div><div class="pm-label">custom range</div>' +
    '<div class="pm-custom' + (PERIOD.kind === "custom" ? " active" : "") + '">' +
      '<input type="date" class="pm-start" value="' + cstart + '" />' +
      '<span class="pm-dash">–</span>' +
      '<input type="date" class="pm-end" value="' + cend + '" />' +
      '<button class="pm-apply">apply</button>' +
    "</div>" +
    '<div class="pm-label">jump to a month</div>' +
    '<div class="pm-group pm-months">loading…</div>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.bottom = (window.innerHeight - r.top + 8) + "px";
  menu.querySelectorAll(".pm-item[data-kind]").forEach((b) =>
    b.addEventListener("click", () => { setPeriod({ kind: b.dataset.kind }); closePeriodMenu(); }));
  const startI = menu.querySelector(".pm-start"), endI = menu.querySelector(".pm-end");
  menu.querySelector(".pm-apply").addEventListener("click", () => {
    if (!startI.value || !endI.value) { flash("pick a start and end date"); return; }
    setPeriod({ kind: "custom", start: startI.value, end: endI.value });
    closePeriodMenu();
  });
  fetch("data/monthly.json?t=" + Date.now())
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const rows = (d && d.months) || [];
      const host = menu.querySelector(".pm-months");
      if (!rows.length) { host.innerHTML = '<div class="pm-empty">no months yet — sync or import</div>'; return; }
      host.innerHTML = rows.map((m) => {
        const on = PERIOD.kind === "month" && PERIOD.ym === m.ym;
        const pos = (m.net || 0) >= 0;
        return '<button class="pm-item' + (on ? " active" : "") + '" data-ym="' + m.ym + '">' +
          "<span>" + m.label + "</span>" +
          '<span class="pm-net ' + (pos ? "pos" : "neg") + '">' + (pos ? "+" : "−") +
          fmtUSD(Math.abs(m.net || 0)) + "</span></button>";
      }).join("");
      host.querySelectorAll(".pm-item[data-ym]").forEach((b) =>
        b.addEventListener("click", () => { setPeriod({ kind: "month", ym: b.dataset.ym }); closePeriodMenu(); }));
    })
    .catch(() => {});
  setTimeout(() => document.addEventListener("pointerdown", periodOutside), 0);
}

// ── The Dock (one cohesive bottom bar: drag to reorder, toggle in the menu) ──
const DOCK_ORDER_KEY = "money.dockOrder";
const DOCK_HIDDEN_KEY = "money.dockHidden";
// Roadmap is a dock OPTION, not a default — it's still one tap away in the dock ＋ menu.
// ⚠️ NEVER PERSIST that default. money.dockHidden is a GENERIC vault key, and a written value
// is NOT neutral: mergeRemoteLocal treats an ABSENT key as -1 (always defers to the vault) but
// a present one enters the mtime tie-break, where a value written by shipping code can BEAT
// this user's real preference arriving from another device — and then get re-sealed.
// So "absent" MEANS "roadmap hidden", computed on read; only a real tap ever writes the key.
const DOCK_HIDDEN_DEFAULT = ["roadmap"];
function dockHiddenSet() {
  let raw = null;
  try { raw = localStorage.getItem(DOCK_HIDDEN_KEY); } catch (e) {}
  return new Set(raw === null ? DOCK_HIDDEN_DEFAULT : dockList(DOCK_HIDDEN_KEY));
}
const DOCK_DEFS = [
  { id: "scale", label: "Scale" },
  { id: "datetime", label: "Date / time" },
  { id: "period", label: "Period" },
  { id: "msg", label: "Messages" },
  { id: "daily", label: "The deck (daily check-in)" },
  { id: "cal", label: "Calendar" },
  { id: "base", label: "The Base" },
  { id: "ledger", label: "Visit your cache" },
  { id: "status", label: "Status" },
  { id: "soundtrack", label: "Soundtrack" },
  { id: "roadmap", label: "Roadmap" },
  { id: "sources", label: "Sources" },
  { id: "server", label: "Server" },
  { id: "cloud", label: "Cloud" },
];
function dockList(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } }
function applyDockConfig(dock) {
  // A dock order saved before the cloud chip became a dock item doesn't list "cloud", and the
  // reflow below appends every SAVED id to the end — which would strand the unlisted cloud
  // chip at the far LEFT. Append it here, at APPLY time, and never write it back: money.dockOrder
  // is a GENERIC vault key, so persisting a shipping-code rewrite would claim a fresh mtime and
  // steamroll a peer device's genuine reorder.
  const order = dockList(DOCK_ORDER_KEY);
  if (order.length && !order.includes("cloud")) order.push("cloud");
  order.forEach((id) => {
    const el = dock.querySelector('[data-dock="' + id + '"]');
    if (el) dock.appendChild(el);  // reflow into saved order
  });
  if (autoPinOn()) {  // favorited dock items jump to the front of the bar
    const f = favs();
    const favEls = DOCK_DEFS.filter((d) => f.has("dock:" + d.id))
      .map((d) => dock.querySelector('[data-dock="' + d.id + '"]')).filter(Boolean);
    favEls.reverse().forEach((el) => dock.insertBefore(el, dock.firstChild));
  }
  const hidden = dockHiddenSet();
  dock.querySelectorAll(".dock-item").forEach((el) => {
    el.style.display = hidden.has(el.dataset.dock) ? "none" : "";
  });
  // No local backend here (hosted web / demo) → a "restart" pill is theater. The loop above
  // rewrites display on EVERY apply, so the one-time hide at boot has to be re-asserted or
  // the pill comes back — and with its ping loop skipped it would sit there dead at "…".
  if (_noLocalBackend) {
    const srv = dock.querySelector('[data-dock="server"]');
    if (srv) srv.style.display = "none";
  }
  // the deck is the PRIMARY CTA — always first, always visible, on every device.
  // External memory needs one findable anchor; a hideable, driftable button isn't one.
  const deck = dock.querySelector('[data-dock="daily"]');
  if (deck) { deck.style.display = ""; dock.insertBefore(deck, dock.firstChild); }
  // the calendar is the deck's PEER — a prominent circular button pinned right after it,
  // always visible (like the deck) so "see your month" is one tap on every device.
  const cal = dock.querySelector('[data-dock="cal"]');
  if (cal && deck) { cal.style.display = ""; deck.after(cal); }
  // messages is the third day-anchor — pinned to the FAR LEFT of the deck/calendar cluster,
  // always visible (chatting with friends is one tap on every device). Inserted last so it
  // lands before the deck (order: [msg][＋][cal]).
  const msg = dock.querySelector('[data-dock="msg"]');
  if (msg) { msg.style.display = ""; dock.insertBefore(msg, dock.firstChild); }
}
function renderDockMenu() {
  const host = document.getElementById("dockMenu");
  if (!host) return;
  const hidden = dockHiddenSet(), f = favs();
  // the deck + calendar + messages can't be hidden — the day's three anchors. Server is
  // dropped where there's no local backend, so the menu can't offer a pill that never shows.
  const defs = DOCK_DEFS.filter((d) => d.id !== "daily" && d.id !== "cal" && d.id !== "msg" && !(d.id === "server" && _noLocalBackend));
  if (autoPinOn()) defs.sort((a, b) => (f.has("dock:" + b.id) ? 1 : 0) - (f.has("dock:" + a.id) ? 1 : 0));
  host.innerHTML = defs.map((d) => {
    const on = !hidden.has(d.id), fav = f.has("dock:" + d.id);
    return '<button class="lib-item' + (on ? " active" : "") + (fav ? " fav" : "") + '" data-dt="' + d.id + '">' +
      '<span class="lib-star" role="button" data-fav="' + d.id + '" title="favorite — pin to front">' + (fav ? "★" : "☆") + "</span>" +
      '<span class="lib-label">' + d.label + "</span>" +
      '<span class="lib-state">' + (on ? "on" : "off") + "</span></button>";
  }).join("");
  host.querySelectorAll(".lib-star").forEach((s) => s.addEventListener("click", (e) => {
    e.stopPropagation(); toggleFav("dock:" + s.dataset.fav); renderDockMenu(); applyDockConfig(document.getElementById("dock"));
  }));
  host.querySelectorAll("[data-dt]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.dt;
    const h = dockHiddenSet();   // materializes the default on the first real tap — that IS a user edit, so stamping it is correct
    if (h.has(id)) h.delete(id); else h.add(id);
    localStorage.setItem(DOCK_HIDDEN_KEY, JSON.stringify([...h]));
    applyDockConfig(document.getElementById("dock"));
    renderDockMenu();
  }));
}
// ── Clock formatting (shared by the dock pill; configurable via its popover) ──
const TZ_OPTS = [
  { id: "", label: "Device (local)" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "UTC", label: "UTC" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Central Europe" },
  { id: "Asia/Tokyo", label: "Tokyo" },
];
const DATE_FMTS = [
  { id: "short", label: "Jun 23", opt: { month: "short", day: "numeric" } },
  { id: "weekday", label: "Mon, Jun 23", opt: { weekday: "short", month: "short", day: "numeric" } },
  { id: "long", label: "June 23", opt: { month: "long", day: "numeric" } },
  { id: "numeric", label: "6/23/2026", opt: { year: "numeric", month: "numeric", day: "numeric" } },
  { id: "iso", label: "2026-06-23", iso: true },
];
function clockTZ() { return localStorage.getItem("money.tz") || ""; }
function fmtClockTime(d) {
  const h24 = localStorage.getItem("money.clock24") !== "0";  // default 24h
  const o = { hour: "numeric", minute: "2-digit", hour12: !h24 };
  if (localStorage.getItem("money.clockSecs") === "1") o.second = "2-digit";
  const tz = clockTZ(); if (tz) o.timeZone = tz;
  return d.toLocaleTimeString("en-US", o);
}
function fmtClockDate(d) {
  const def = DATE_FMTS.find((f) => f.id === (localStorage.getItem("money.dateFmt") || "short")) || DATE_FMTS[0];
  const tz = clockTZ();
  if (def.iso) { const o = { year: "numeric", month: "2-digit", day: "2-digit" }; if (tz) o.timeZone = tz; return d.toLocaleDateString("en-CA", o); }
  const o = Object.assign({}, def.opt); if (tz) o.timeZone = tz;
  return d.toLocaleDateString("en-US", o);
}
let _retickClock = () => {};  // set by buildDock so the popover can refresh the pill live
function closeClockPop() {
  const p = document.getElementById("clockPop"), b = document.getElementById("clockPopBack");
  if (p) p.remove(); if (b) b.remove();
}
function openClockSettings(anchor) {
  if (document.getElementById("clockPop")) { closeClockPop(); return; }
  const back = document.createElement("div");
  back.id = "clockPopBack"; back.className = "theme-backdrop";
  back.addEventListener("pointerdown", closeClockPop);
  const pop = document.createElement("div");
  pop.id = "clockPop"; pop.className = "clock-pop";
  const h24 = localStorage.getItem("money.clock24") !== "0";
  const secs = localStorage.getItem("money.clockSecs") === "1";
  const tz = clockTZ();
  const dfmt = localStorage.getItem("money.dateFmt") || "short";
  pop.innerHTML =
    '<div class="cp-title">date &amp; time</div>' +
    '<label class="cp-row"><span>Time zone</span><select class="cp-tz">' +
      TZ_OPTS.map((z) => '<option value="' + z.id + '"' + (z.id === tz ? " selected" : "") + ">" + z.label + "</option>").join("") +
    "</select></label>" +
    '<div class="cp-row"><span>Clock</span><span class="cp-seg">' +
      '<button class="cp-h' + (!h24 ? " on" : "") + '" data-h="12">12h</button>' +
      '<button class="cp-h' + (h24 ? " on" : "") + '" data-h="24">24h</button></span></div>' +
    '<div class="cp-row"><span>Show seconds</span><button class="cp-secs cp-toggle' + (secs ? " on" : "") + '">' + (secs ? "on" : "off") + "</button></div>" +
    '<label class="cp-row"><span>Date format</span><select class="cp-date">' +
      DATE_FMTS.map((f) => '<option value="' + f.id + '"' + (f.id === dfmt ? " selected" : "") + ">" + f.label + "</option>").join("") +
    "</select></label>";
  document.body.appendChild(back);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12)) + "px";
  pop.style.bottom = (window.innerHeight - r.top + 8) + "px";
  pop.querySelector(".cp-tz").addEventListener("change", (e) => { localStorage.setItem("money.tz", e.target.value); _retickClock(); });
  pop.querySelector(".cp-date").addEventListener("change", (e) => { localStorage.setItem("money.dateFmt", e.target.value); _retickClock(); });
  pop.querySelectorAll(".cp-h").forEach((b) => b.addEventListener("click", () => {
    localStorage.setItem("money.clock24", b.dataset.h === "24" ? "1" : "0");
    pop.querySelectorAll(".cp-h").forEach((x) => x.classList.toggle("on", x === b));
    _retickClock();
  }));
  pop.querySelector(".cp-secs").addEventListener("click", (e) => {
    const on = localStorage.getItem("money.clockSecs") !== "1";
    localStorage.setItem("money.clockSecs", on ? "1" : "0");
    e.target.classList.toggle("on", on); e.target.textContent = on ? "on" : "off";
    _retickClock();
  });
}
(function buildDock() {
  const bar = document.createElement("div");
  bar.className = "dock-bar";
  bar.innerHTML = '<div id="dock" class="dock"><div class="dock-label">dock<span class="dock-view" id="dockView"></span></div></div>';
  document.body.appendChild(bar);
  const dock = bar.querySelector("#dock");

  // date / time item
  const dt = document.createElement("button");
  dt.id = "datetimeBtn"; dt.className = "status-pill"; dt.title = "date & time — click to format";
  dt.innerHTML = '<span class="dt-time">–</span><span class="dt-date">–</span>';
  const tickDt = () => {
    const n = new Date();
    dt.querySelector(".dt-time").textContent = fmtClockTime(n);
    dt.querySelector(".dt-date").textContent = fmtClockDate(n);
  };
  tickDt(); setInterval(tickDt, 1000);
  _retickClock = tickDt;  // let the format popover refresh the pill instantly
  dt.addEventListener("click", () => openClockSettings(dt));

  // period item — the date range the span widgets are showing
  const pd = document.createElement("button");
  pd.id = "periodBtn"; pd.className = "status-pill"; pd.title = "date range shown — click to change";
  pd.innerHTML = '<i data-lucide="calendar-range"></i><span class="period-text">' + periodLabel() + "</span>";
  pd.addEventListener("click", () => openPeriodMenu(pd));

  const els = {
    scale: document.querySelector(".zoom-control"),
    datetime: dt,
    period: pd,
    msg: document.getElementById("msgBtn"),
    daily: document.getElementById("dailyBtn"),
    cal: document.getElementById("calBtn"),
    base: document.getElementById("baseBtn"),
    ledger: document.getElementById("ledgerBtn"),
    status: document.getElementById("statusBtn"),
    soundtrack: document.getElementById("soundtrack"),
    roadmap: document.getElementById("roadmapBtn"),
    sources: document.getElementById("sourcesBtn"),
    server: document.getElementById("serverBtn"),
    cloud: document.getElementById("cloudHealth"),
  };
  DOCK_DEFS.forEach((d) => {
    const el = els[d.id];
    if (!el) return;
    el.classList.add("dock-item");
    el.dataset.dock = d.id;
    el.setAttribute("draggable", "true");
    dock.appendChild(el);  // re-home it (keeps its event listeners)
  });
  // sync (the LOCAL-backend one) stays OUTSIDE the dock, pinned bottom-right
  const sync = document.getElementById("syncHealth");
  if (sync) bar.appendChild(sync);
  // The cloud chip now lives INSIDE the dock (homed by the DOCK_DEFS loop above) instead of
  // floating beside it — it's a normal draggable/hideable dock item. Only its click stays here.
  const cloud = document.getElementById("cloudHealth");
  if (cloud) {
    cloud.addEventListener("click", () => {
      // signed in → the account menu (cloud settings / log out / different account);
      // signed out → straight to Settings, where the sign-in stepper lives
      if (cloudState().token) { openAccountMenu(cloud); return; }
      autoPushNow(); openSettings();
    });
  }
  // finish an account switch: "Use a different account…" logs out (parking the cache),
  // reloads to this clean slate, and left a one-shot flag — take them straight to a
  // blank sign-in instead of making them re-find Settings. (The hosted web app reloads
  // into webcache's login gate instead, which reads the same flag itself.)
  if (!window.__CACHE_WEB__) {
    try {
      if (sessionStorage.getItem(SWITCH_ACCT_FLAG) === "1") {
        sessionStorage.removeItem(SWITCH_ACCT_FLAG);
        setTimeout(() => { openSettings(); prepSwitchSignin(); flash("Sign in as the other account."); }, 350);
      }
    } catch (e) {}
  }
  const oldBar = document.querySelector(".status-bar");
  if (oldBar) oldBar.remove();

  applyDockConfig(dock);
  updateViewToggle();  // set the toggle icon (grid = Widgets on load) + the dock view name

  // drag to reorder (HTML5 DnD → clicks still work)
  let dragEl = null;
  dock.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".dock-item");
    if (!item) return;
    // a click on a control NESTED inside an item (the scale −/100%/+ buttons)
    // must never turn into a reorder drag — so the buttons always register
    const btn = e.target.closest("button");
    if (btn && btn !== item && item.contains(btn)) { e.preventDefault(); return; }
    dragEl = item; item.classList.add("dock-dragging");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  dock.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const after = [...dock.querySelectorAll(".dock-item:not(.dock-dragging)")]
      .find((el) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    if (after) dock.insertBefore(dragEl, after); else dock.appendChild(dragEl);
  });
  dock.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("dock-dragging");
    dragEl = null;
    localStorage.setItem(DOCK_ORDER_KEY, JSON.stringify(
      [...dock.querySelectorAll(".dock-item")].map((el) => el.dataset.dock)));
  });

  renderDockMenu();
})();

// ── The top stats bar (a HUD of live numbers, mirrors the dock) ──
const STATS_ORDER_KEY = "money.statsOrder";
const STATS_HIDDEN_KEY = "money.statsHidden";
// each stat reads from the SAME sources the widgets do, so nothing can disagree
const STAT_DEFS = [
  { id: "exp", label: "EXP", fn: () => ({ val: "⭐ " + PROFILE_STATS.exp.toLocaleString(), tone: "exp" }) },
  { id: "cash", label: "Cash", fn: (d) => ({ val: d ? fmtUSD(d.cash || 0) : "…" }) },
  { id: "earn", label: "To earn", fn: (d) => {
      const S = d && planSummary(d, 0);
      if (!S) return { val: d ? "—" : "…" };
      return S.covered ? { val: "✓ covered", tone: "ok" } : { val: fmtUSD(S.totalShort), tone: "bad" };
    } },
  { id: "hours", label: "Gig hours", fn: (d) => {
      const S = d && planSummary(d, 0);
      if (!S) return { val: d ? "—" : "…" };
      return S.covered ? { val: "0 h", tone: "ok" } : { val: S.hrs + " h", tone: "warn" };
    } },
  { id: "rent", label: "Rent", fn: (d) => {
      const S = d && planSummary(d, 0);
      if (!S) return { val: d ? "—" : "…" };
      const rt = S.rentTier;
      if (!rt) return { val: "—" };
      if (rt.paid) return { val: "✓ paid", tone: "ok" };
      const short = Math.max(0, rt.amt - rt.funded);
      if (short < 0.5) return { val: "✓ ready", tone: "ok" };
      return { val: fmtUSD(short) + " short", tone: "bad" };
    } },
  { id: "spend", label: "Spend/mo", fn: (d) => ({ val: d && d.spending ? fmtUSD(d.spending.per_month) : (d ? "—" : "…") }) },
];
// ── Custom stat trackers: monthly streak · days-since · bank-purchase count · manual tally ──
const CUSTOM_STATS_KEY = "money.customStats";
function customStats() { try { const a = JSON.parse(localStorage.getItem(CUSTOM_STATS_KEY) || "null"); return Array.isArray(a) ? a : null; } catch (e) { return null; } }
function saveCustomStats(arr) { localStorage.setItem(CUSTOM_STATS_KEY, JSON.stringify(arr)); }
function ensureCustomStats() {
  let a = customStats();
  if (a === null) { a = [{ id: "streak-rent", label: "Expenses streak", kind: "streak", marks: [] }]; saveCustomStats(a); }
  return a;
}
function curYm() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function curMonShort() { return new Date().toLocaleDateString("en-US", { month: "short" }); }
function streakCount(marks) {
  const set = new Set(marks || []);
  if (!set.size) return 0;
  let [y, m] = [...set].sort().pop().split("-").map(Number);  // walk back from the most recent marked month
  let n = 0;
  while (set.has(y + "-" + String(m).padStart(2, "0"))) { n++; m--; if (m === 0) { m = 12; y--; } }
  return n;
}
const BANK_COUNTS = {};  // id -> { val, total, ts, fetching } — cached, refetched when stale
function bankCount(cs) {
  const c = BANK_COUNTS[cs.id];
  if (c && Date.now() - c.ts < 30000) return c;
  if (!(c && c.fetching)) {
    BANK_COUNTS[cs.id] = Object.assign({ val: c && c.val }, { fetching: true, ts: (c && c.ts) || 0 });
    fetch("/api/match-count?q=" + encodeURIComponent(cs.match || "") + "&window=" + (cs.window || "month"))
      .then((r) => r.json())
      .then((x) => { BANK_COUNTS[cs.id] = { val: x.count || 0, total: x.total || 0, ts: Date.now() }; renderStatsBar(); })
      .catch(() => { BANK_COUNTS[cs.id] = { val: (c && c.val) || 0, total: 0, ts: Date.now() }; });
  }
  return BANK_COUNTS[cs.id];
}
function customStatEntry(cs) {
  return { id: cs.id, label: cs.label, custom: true, cs, fn: () => {
    if (cs.kind === "streak") { const n = streakCount(cs.marks); return { val: (n > 0 ? "🔥 " : "") + n + " mo", tone: n > 0 ? "ok" : "" }; }
    if (cs.kind === "since") { const days = cs.date ? Math.max(0, Math.floor((Date.now() - new Date(cs.date + "T00:00:00").getTime()) / 86400000)) : 0; return { val: days + " d" }; }
    if (cs.kind === "tally") return { val: String(cs.value || 0) };
    if (cs.kind === "bank") { const b = bankCount(cs); return { val: b && b.val != null ? String(b.val) : "…" }; }
    return { val: "—" };
  } };
}
// ── The contributor stat: how many reports of yours have been fixed ──
// DERIVED from money.bugCredits (count + EXP sum) — never a second mutable counter.
// Hidden entirely until the first one lands (no sad zero-state, per 1_PRINCIPLES:
// someone who reports nothing must never see a gap where a stat "should" be), then
// it appears in the strip as a small standing honor. Respects statsOrder/statsHidden
// like every other chip once it exists.
function bugStatEntry() {
  const st = bugCreditStat();
  if (!st.count) return [];
  return [{ id: "bugfixes", label: "Cache builder", fn: () => ({ val: "🛠️ " + st.count, tone: "ok" }) }];
}
function allStats() { return STAT_DEFS.concat(bugStatEntry(), ensureCustomStats().map(customStatEntry)); }
function statsList(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } }
function statsDefOrder() {
  const defs = allStats();
  const known = new Set(defs.map((s) => s.id));
  const ordered = statsList(STATS_ORDER_KEY).filter((id) => known.has(id));
  defs.forEach((s) => { if (!ordered.includes(s.id)) ordered.push(s.id); });
  return ordered;
}
function renderStatsBar() {
  const host = document.getElementById("stats");
  if (!host) return;
  const hidden = new Set(statsList(STATS_HIDDEN_KEY));
  const d = Store.data;
  const defs = allStats();
  host.innerHTML = statsDefOrder().filter((id) => !hidden.has(id)).map((id) => {
    const def = defs.find((s) => s.id === id);
    if (!def) return "";
    const r = def.fn(d) || {};
    return '<div class="stat-chip" data-stat="' + id + '" draggable="true">' +
      '<span class="stat-val' + (r.tone ? " t-" + r.tone : "") + '">' + r.val + "</span>" +
      '<span class="stat-label">' + escapeHtml(def.label) + "</span></div>";
  }).join("");
}
function renderStatsMenu() {
  const host = document.getElementById("statsMenu");
  if (!host) return;
  const hidden = new Set(statsList(STATS_HIDDEN_KEY));
  host.innerHTML = allStats().map((d) => {
    const on = !hidden.has(d.id);
    return '<button class="lib-item' + (on ? " active" : "") + '" data-st="' + d.id + '">' +
      '<span class="lib-dot"></span><span class="lib-label">' + escapeHtml(d.label) + '</span>' +
      '<span class="lib-state">' + (on ? "on" : "off") + "</span></button>";
  }).join("");
  host.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.st;
    const h = new Set(statsList(STATS_HIDDEN_KEY));
    if (h.has(id)) h.delete(id); else h.add(id);
    localStorage.setItem(STATS_HIDDEN_KEY, JSON.stringify([...h]));
    renderStatsBar();
    renderStatsMenu();
  }));
}
(function buildStatsBar() {
  const bar = document.createElement("div");
  bar.className = "stats-bar";
  bar.innerHTML = '<div id="stats" class="stats"></div>';
  document.body.appendChild(bar);
  const stats = bar.querySelector("#stats");
  // drag to reorder (clicks elsewhere unaffected)
  let dragEl = null;
  stats.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".stat-chip");
    if (!item) return;
    dragEl = item; item.classList.add("stat-dragging");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  stats.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const after = [...stats.querySelectorAll(".stat-chip:not(.stat-dragging)")]
      .find((el) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    if (after) stats.insertBefore(dragEl, after); else stats.appendChild(dragEl);
  });
  stats.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("stat-dragging");
    dragEl = null;
    localStorage.setItem(STATS_ORDER_KEY, JSON.stringify(
      [...stats.querySelectorAll(".stat-chip")].map((el) => el.dataset.stat)));
  });
  renderStatsBar();
  renderStatsMenu();
  Store.subscribe(stats, () => renderStatsBar());  // live update on every data ripple
})();

// ── King Cozy bar: a founder-only SECOND stats layer, stacked just beneath the
//    personal bar. Same build-by-the-numbers as the King Cozy console (click it to
//    open the full console). Auto-absent for non-founders, so the personal stats
//    bar a normal member sees is never touched. ──
function renderKingExp() {
  const e = document.getElementById("kb-exp");
  if (e) e.textContent = "⭐ " + PROFILE_STATS.exp.toLocaleString();
}
let _kingBarBuilt = false;
function buildKingBar() {
  if (_kingBarBuilt) return;  // gated by applyKing() — only ever runs on the founder's own machine
  _kingBarBuilt = true;
  const bar = document.createElement("div");
  bar.className = "stats-bar king-bar";
  const days = Math.max(1, Math.round((Date.now() - charSince()) / 86400000));
  const chip = (id, val, label) =>
    '<div class="stat-chip" data-kb="' + id + '">' +
      '<span class="stat-val" id="' + id + '">' + val + "</span>" +
      '<span class="stat-label">' + label + "</span></div>";
  bar.innerHTML =
    '<div class="stats king-stats" title="King Cozy — the build, by the numbers · click for the full console">' +
      '<span class="king-crown" aria-hidden="true">👑</span>' +
      chip("kb-exp", "⭐ " + PROFILE_STATS.exp.toLocaleString(), "project EXP") +
      chip("kb-days", days, "days building") +
      chip("kb-shipped", "…", "shipped") +
      chip("kb-progress", "…", "in progress") +
      chip("kb-planned", "…", "planned") +
      chip("kb-fixes", "…", "fixes") +
      chip("kb-stars", "…", "stars") +
      chip("kb-forks", "…", "forks") +
      chip("kb-downloads", "…", "downloads") +
      chip("kb-events", "…", "events 7d") +
      chip("kb-people", "…", "people 7d") +
    "</div>";
  document.body.appendChild(bar);
  const pill = bar.querySelector(".king-stats");
  pill.addEventListener("click", () => openKingCozy());
  const set = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = (n == null ? "—" : n.toLocaleString ? n.toLocaleString() : n); };
  (function kingRefresh() {
    renderKingExp();
    fetch("https://raw.githubusercontent.com/cozykace/thecache/main/BACKLOG.md?t=" + Date.now())
      .then((r) => r.text()).then((md) => {
        set("kb-shipped", (md.match(/^- \[x\]/gim) || []).length);
        set("kb-progress", (md.match(/^- \[~\]/gim) || []).length);
        set("kb-planned", (md.match(/^- \[ \]/gim) || []).length);
        set("kb-fixes", (md.match(/\bfix(?:ed|es)?\b/gi) || []).length);
      }).catch(() => {});
    fetch("https://api.github.com/repos/cozykace/thecache")
      .then((r) => r.json()).then((d) => { set("kb-stars", d.stargazers_count); set("kb-forks", d.forks_count); })
      .catch(() => {});
    fetch("/api/downloads?t=" + Date.now()).then((r) => r.json()).then((d) => { if (d && d.ok) set("kb-downloads", d.downloads); }).catch(() => {});
    fetch("/api/posthog-stats?t=" + Date.now()).then((r) => r.json()).then((d) => {
      if (d && d.ok) { set("kb-events", d.total || 0); set("kb-people", d.users || 0); }
      else { set("kb-events", "—"); set("kb-people", "—"); }
    }).catch(() => {});
  })();
  Store.subscribe(pill, () => renderKingExp());  // EXP ticks up live with every click
}

// ── Founder lock ────────────────────────────────────────────
// Every founder-only surface (King Cozy bar, King menu item, console) is gated
// HERE on a machine-local secret — the backend reports founder:true only if a
// `.founder` file exists on this Mac. Typing the founder name into a profile can
// NEVER unlock it, and the public demo (no backend) is always false.
let KING = false;
function applyKing() {
  if (!KING) return;
  buildKingBar();
  document.body.classList.add("king-on");  // founder marker (for any founder-only styling)
  const k = document.getElementById("kingCozy");
  if (k) k.style.display = "";  // reveal the King menu item
  syncBadges();  // award the Founder badge now that the lock is confirmed
}
fetch("/api/ping").then((r) => r.json()).then((d) => { KING = !!(d && d.founder); applyKing(); }).catch(() => {});

// ── Boot ───────────────────────────────────────────────────
Object.keys(layout).forEach((id) => makeAny(id, layout[id]));
renderLibrary();
renderIcons();
setSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
applyZoom();
drawIcons();
applyPrivacy();
applyDockMobile();
updateGreeting();
updateXp();
renderTrust();
applyTier();
renderBrand();
renderHealth();
syncBadges();  // seed/award badges from state available at boot (level, named, budget, streak)
Store.subscribe(document.getElementById("healthBadge"), () => renderHealth());  // health updates as data connects
Store.subscribe(document.getElementById("trustBadge"), syncBadges);  // award data-based badges as accounts/income/subs load
initAnalytics();  // no-op unless the user opted in (Settings → Share anonymous usage)
window.addEventListener("error", (e) => track("client_error", { msg: String(e.message || "").slice(0, 140), src: (e.filename || "").split("/").pop() }));
requestAnimationFrame(reflowBelowStats);  // once the stats bar has measured, clear the top band
cloudChip();               // the chip tells the truth from the first paint
// Adopt another device's read-state FIRST, then fetch the news, THEN — if anything is
// genuinely unseen and you're not mid-task — open "What's changed" so you don't have to go
// hunting for the bell. The order matters: pulling first means we never nag about a note you
// already read on your phone. (An account switch / restore reloads the page, so this same
// boot path is what runs when you log back in.)
Promise.resolve(cloudAutoPull())
  .then(() => notifsFetch())
  .then(() => { try { maybeWhatsChanged(); } catch (e) {} })
  .catch(() => {});
let _notesPolled = 0;
setInterval(() => {
  if (document.hidden) return;
  cloudAutoPull();
  // Deliver a pop that was armed but DEFERRED (the web login gate was up at boot, or a surface
  // was open, or the user was typing) as soon as the way is clear. _wcPending stays armed until
  // maybeWhatsChanged actually shows it or finds nothing left to show, so this can't nag.
  if (_wcPending) { try { maybeWhatsChanged(); } catch (e) {} }
  // Re-read release-notes.json periodically. It's a static per-origin file, NOT vault content,
  // so a long-lived tab would otherwise never notice a new deploy until you opened the bell.
  // Throttled to ~4 min (same self-throttle as bugPoll) — news doesn't need 75s resolution.
  if (Date.now() - _notesPolled > 240000) {
    _notesPolled = Date.now();
    notifsFetch(true).then(() => { try { if (_wcPending) maybeWhatsChanged(); } catch (e) {} }).catch(() => {});
  }
}, 75000);   // near-live: a tiny two-field check while you're looking
document.addEventListener("cache:logged", autoPushSoon);   // a finished check-in is worth syncing
socialUpdateBadge();       // show any unread count from the last session's cache immediately
if (socialReady()) socialPoll().catch(() => {});   // pull new messages + friend requests on load
setInterval(() => { if (!document.hidden && socialReady()) socialPoll().catch(() => {}); }, 75000);   // near-live message check (the open surface polls faster)
bugPoll().catch(() => {});   // did something you reported get fixed while you were away?
setInterval(() => { if (!document.hidden) bugPoll().catch(() => {}); }, 75000);   // rides the same cadence; bugPoll self-throttles to ~4 min
loadSubs().then(() => Store.refresh());  // load your decisions first, then pull data → widgets render correct on first paint
