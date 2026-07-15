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
// positions land on the grid; snapped SIZES are inset by a gutter so that
// grid-adjacent widgets get a little breathing room instead of touching
// global gutter between widgets — a live slider sets this; drives the snap inset,
// so widgets resize in place to open/close the gaps without moving.
const gutterVal = () => { const g = parseInt(localStorage.getItem("money.gutter")); return isNaN(g) ? 10 : Math.max(4, Math.min(48, g)); };
const snapSize = (v, min) => Math.max(min || MIN_W, Math.round(v / SNAP) * SNAP - gutterVal());

const fmtUSD = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// soft, pleasing palette assigned per-account
const ACCT_COLORS = ["#c9542e", "#2e7dc9", "#3f8f4e", "#6a4bc4", "#d6920f", "#1fa6a6", "#bf6ba5", "#8a8f2e"];
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
function setProfile(p) { localStorage.setItem("money.profile", JSON.stringify(p)); updateGreeting(); }
// Founder mode: a goofy compliment under the greeting, just for Cozy K Ace.
function isFounder() {
  if (localStorage.getItem("money.founder") === "1") return true;
  const n = (getProfile().name || "").toLowerCase().trim();
  return ["cozy k ace", "cozy", "king cozy", "cozyace", "cozy ace"].includes(n);
}
const FOUNDER_COMPLIMENTS = [
  "your code slaps harder than your morning coffee ☕",
  "certified menace to bad UX 😼",
  "100% of caches surveyed agree: you're the GOAT 🐐",
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
  "the goat approves 🐐",
];
function updateGreeting() {
  const g = document.getElementById("greeting");
  if (!g) return;
  const p = getProfile();
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = (p.name || "").trim().replace(/\b\w/g, (m) => m.toUpperCase());
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
  const nm = (getProfile().name || "").trim();
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
  b.style.cursor = "pointer";
  b.title = "rename your cache";
  b.onclick = () => {
    const v = prompt("Name your cache (this is yours — call it whatever you want):", getCacheName());
    if (v === null) return;
    setCacheName(v); renderBrand(); if (typeof renderCharacter === "function") renderCharacter();
  };
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
function logChar(kind, detail) {
  const log = charLog();
  log.push({ k: kind, d: detail, t: Date.now() });
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
const CHAR_ICON = { level: "🎉", widget: "➕", sync: "🔌", feat: "⭐", note: "📌" };
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
function openCharLog() {
  syncBadges();  // award + log any newly-earned badges before we draw them
  const back = document.createElement("div"); back.className = "cat-backdrop";
  const modal = document.createElement("div"); modal.className = "cat-modal char-modal";
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  const L = cacheLevel(PROFILE_STATS.exp);
  const log = charLog().slice().reverse();
  const rows = log.length
    ? log.map((ev) => '<div class="char-ev"><span class="char-ev-i">' + (CHAR_ICON[ev.k] || "•") + "</span>" +
        '<span class="char-ev-d">' + escapeHtml(ev.d) + '</span><span class="char-ev-t">' + agoStr(ev.t) + "</span></div>").join("")
    : '<div class="char-empty">Your journey is just beginning — do the work and it fills in here.</div>';
  const since = new Date(charSince()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const curArc = Math.min(JOURNEY.length - 1, Math.floor((L.lvl - 1) / 2));
  const arcs = JOURNEY.map((a, i) => {
    const st = i < curArc ? "done" : i === curArc ? "now" : "lock";
    return '<div class="tt-tier ' + st + '"><div class="tt-node"><span class="tt-arc">' + escapeHtml(a.arc) + '</span><span class="tt-lvl">Lvl ' + a.lvls + "</span></div>" +
      '<div class="tt-branch">' + a.feats.map((f) => '<span class="tt-feat">' + escapeHtml(f) + "</span>").join("") + "</div></div>";
  }).join("");
  const skills = [
    { name: "Blessed clicks", req: "max cache health", got: _healthFull },
    { name: "Sword shing", req: "max cache health", got: _healthFull },
    { name: "Cursor magnification", req: "coming soon", got: false },
    { name: "Art backgrounds", req: "coming soon", got: false },
  ].map((s) => '<button class="sk-pill ' + (s.got ? "got" : "lock") + '"' + (s.got ? "" : " disabled") + '><span class="sk-i">' + (s.got ? "✦" : "🔒") + "</span>" + escapeHtml(s.name) + (s.got ? '<span class="sk-go">unleashed</span>' : '<span class="sk-req">' + escapeHtml(s.req) + "</span>") + "</button>").join("");
  modal.innerHTML =
    '<div class="cat-head"><span>' + L.emoji + " " + escapeHtml(getCacheName()) + '</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="char-body">' +
      '<div class="char-stats">' +
        '<div class="char-stat"><b>Lvl ' + L.lvl + "</b><span>" + escapeHtml(L.title) + "</span></div>" +
        '<div class="char-stat"><b>' + PROFILE_STATS.exp.toLocaleString() + "</b><span>EXP</span></div>" +
        '<div class="char-stat"><b>' + (PROFILE_STATS.clicks || 0).toLocaleString() + "</b><span>interactions</span></div>" +
        '<div class="char-stat"><b>' + log.length + "</b><span>feats logged</span></div>" +
      "</div>" +
      '<div class="char-bar"><span style="width:' + (L.pct * 100).toFixed(1) + '%"></span></div>' +
      '<div class="char-since">since ' + since + " · " + L.into.toLocaleString() + "/" + L.span.toLocaleString() + " to Lvl " + (L.lvl + 1) + "</div>" +
      renderBadges() +
      '<div class="char-sec">Skills &amp; unlocks</div><div class="sk-pills">' + skills + "</div>" +
      '<div class="char-sec">Journey · tech tree</div><div class="tt-tree">' + arcs + "</div>" +
      '<div class="char-sec">Your ledger</div>' + rows +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", close);
  modal.querySelectorAll(".sk-pill.got").forEach((b) => b.addEventListener("click", () => {  // "unleash" pulse
    b.classList.remove("unleash"); void b.offsetWidth; b.classList.add("unleash");
  }));
  const cap = modal.querySelector("#badgeCaption");
  modal.querySelectorAll(".badge").forEach((el) => el.addEventListener("click", () => {  // tap to reveal name + how it's earned
    if (cap) cap.textContent = el.dataset.bn + " — " + el.dataset.bd + (el.dataset.on === "1" ? " ✓ earned" : " · locked");
  }));
}
function renderCharacter() {
  const e = document.getElementById("sidebarXp");
  if (!e) return;
  const L = cacheLevel(PROFILE_STATS.exp);
  _charLevel = L.lvl;
  e.innerHTML =
    '<div class="cache-char">' +
      '<div class="cc-top"><span class="cc-emoji">' + L.emoji + "</span>" +
        '<button class="cc-name" title="rename your cache">' + escapeHtml(getCacheName()) + "</button></div>" +
      '<div class="cc-meta">Lvl <b class="cc-lvl">' + L.lvl + "</b> · " + escapeHtml(L.title) + "</div>" +
      '<div class="cc-bar"><span class="cc-fill" style="width:' + (L.pct * 100).toFixed(1) + '%"></span></div>' +
      '<div class="cc-xp"><b>' + PROFILE_STATS.exp.toLocaleString() + "</b> EXP · " + L.into.toLocaleString() + "/" + L.span.toLocaleString() + " to Lvl " + (L.lvl + 1) + "</div>" +
    "</div>";
  const card = e.querySelector(".cache-char");
  if (card) { card.style.cursor = "pointer"; card.title = "view your journey, skills & ledger"; card.addEventListener("click", openCharLog); }
  const nameBtn = e.querySelector(".cc-name");
  if (nameBtn) nameBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();  // don't open the ledger when renaming
    const v = prompt("Name your cache (this is yours — call it whatever you want):", getCacheName());
    if (v === null) return;
    setCacheName(v); renderCharacter(); renderBrand();
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
async function keyboxOpen(boxStr, pass) {
  const box = JSON.parse(boxStr);
  if (box.m === "esc") return box.k;
  if (!pass) throw new Error("zero-knowledge vault — enter your passphrase once on this device");
  const kek = await _deriveKey(pass, _unb64(box.salt));
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(box.iv) }, kek, _unb64(box.ct));
  return _b64(raw);
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
  // a DIFFERENT account is signing in on this browser → drop the old account's
  // device key, seal-mode memory, and record pointer, or the vaults would entangle
  if (prev.userId && d.record && d.record.id !== prev.userId) { cloudKeySet(""); prev.recordId = null; prev.lastPush = null; prev.lastHash = null; prev.lastSeenVault = null; prev.mode = null; }
  // same account → mode RIDES ALONG: the zero-knowledge downgrade guard reads it,
  // and losing it on a routine re-login would disarm the guard exactly when a
  // tampering server would love that
  cloudSaveState({ url: base, token: d.token, email: (d.record && d.record.email) || email, userId: d.record && d.record.id, recordId: prev.recordId, lastPush: prev.lastPush, lastHash: prev.lastHash, lastSeenVault: prev.lastSeenVault, mode: prev.mode || null, verified: !!(d.record && d.record.verified) });
  return d;
}
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
function cloudLogout() { cloudKeySet(""); cloudSaveState({ url: cloudState().url || CLOUD_DEFAULT_URL }); }
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
      // check needs userId, and the zk guard must survive an expiry round-trip
      cloudSaveState({ url: s.url, email: s.email, userId: s.userId, recordId: s.recordId, mode: s.mode || null, lastPush: s.lastPush, lastHash: s.lastHash, lastSeenVault: s.lastSeenVault });
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
const DEVICE_LOCAL_KEYS = ["money.dockMobile", "money.zoom", "money.gutter", "money.sidebar", "money.sidebarWidth", "money.statsScroll", "money.icons.collapsed", "money.balExpanded", "money.settings", "money.connect", "money.wiki", "money.timerRun"];
const SPECIAL_MERGE_KEYS = ["money.log", "money.logPending", "money.deck", "money.things", "money.charLog", "money.profile", "money.badges", "money.customStats", "money.charSince"];
// the user-authored data/ files that merge key-wise across devices (via the backend's
// /api/merge-maps + the vault's filesMeta sidecar) — everything else in the files
// bundle is engine-computed and travels whole-file. catmeta.json (your category
// renames, fold-ins and custom categories) is user-authored too, so it merges here
// rather than being stranded per-device.
const MAP_FILE_NAMES = ["categories.json", "income.json", "subs.json", "income_links.json", "catmeta.json", "deleted.json"];
function isInternalKey(k) { return CLOUD_INTERNAL_KEYS.indexOf(k) !== -1 || DEVICE_LOCAL_KEYS.indexOf(k) !== -1; }
function isSpecialKey(k) { return SPECIAL_MERGE_KEYS.indexOf(k) !== -1; }
function isGenericKey(k) { return k.indexOf("money.") === 0 && !isInternalKey(k) && !isSpecialKey(k); }
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
async function cloudPush(passphrase) {
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
  const curMode = curBox ? (curBox.m || "esc") : null;
  if (curBox) keyboxGuard(curBox);   // BEFORE any adoption — never touch a downgraded keybox
  // make sure this device holds the data key: adopt from the keybox, or mint one
  let kb = cloudKeyGet(), mintedKey = false;
  if (kb && curBox && curBox.m === "esc" && curBox.k && curBox.k !== kb) { kb = curBox.k; cloudKeySet(kb); }  // server keybox is the authority — heal key divergence
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
  if (window.__CACHE_WEB__) {
    if (rec && rec.blob) { const cur = await cloudOpen(rec.blob, passphrase); files = cur.files || {}; api = cur.api || {}; exported = cur.exported; filesMeta = cur.filesMeta || {}; curLocal = cur.local || null; curLocalMeta = cur.localMeta || null; vaultAuthored = authoredHash(cur.local || {}, cur.files || {}); }
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
  } else if (wantZk && curMode === "esc") {
    // escrow → zero-knowledge upgrade: ROTATE the key. The old key sat on the
    // server in plaintext — wrapping that same key would be zero-knowledge in
    // name only. Fresh key, blob re-sealed below, other devices re-ask once.
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
    return { count, bytes: s.bytes || 0, unchanged: true };
  }
  const body = { blob: await cloudSeal(Object.assign(JSON.parse(payloadCore), { exported })) };
  if (writeKeybox) body.keybox = await keyboxMake(kb, wantZk ? passphrase : "");
  let r;
  if (id) r = await fetch(cloudUrl() + "/api/collections/vaults/records/" + id, { method: "PATCH", headers: hdr, body: JSON.stringify(body) });
  else r = await fetch(cloudUrl() + "/api/collections/vaults/records", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ owner: s.userId }, body)) });
  if (r.status === 404) {
    // record vanished mid-push → recreate it WITH a keybox, never without one
    // (a keybox-less record would invite a silent escrow write on the next push)
    id = null;
    if (!body.keybox) {
      if (zkIntent && !wantZk) throw new Error("your vault was recreated and its zero-knowledge key needs re-sealing — enter your passphrase (Step 2)");
      body.keybox = await keyboxMake(kb, wantZk ? passphrase : "");
    }
    r = await fetch(cloudUrl() + "/api/collections/vaults/records", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ owner: s.userId }, body)) });
  }
  const d = await r.json();
  if (!r.ok) throw new Error(cloudErr(d) || ("cloud backup failed (HTTP " + r.status + " — is the 'vaults' collection set up?)"));
  cloudSaveState(Object.assign(cloudState(), {
    recordId: d.id || id, lastPush: new Date().toISOString(), lastPushCount: count,
    bytes: (body.blob || "").length, lastHash: hash, lastSeenVault: d.updated || "",
    mode: body.keybox ? (wantZk ? "zk" : "esc") : (curMode || s.mode || null),   // remember the seal mode — the downgrade guard reads it
    // schema lacks the keybox field → sync works on THIS device, but other devices
    // can't adopt the key until the field exists (self-clears once it does)
    keyboxMissing: body.keybox ? (d && d.keybox === undefined) : (d && d.keybox !== undefined ? false : !!s.keyboxMissing),
  }));
  return { count, bytes: (body.blob || "").length };
}
// a zero-knowledge account must never silently accept an escrow keybox — that
// shape change is exactly what a tampering or compromised server would send
function keyboxGuard(box) {
  if (cloudState().mode === "zk" && box && box.m === "esc")
    throw new Error("your vault's key seal changed unexpectedly — re-enter your passphrase in Settings to re-seal it");
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
      cloudSaveState(Object.assign(cloudState(), { mode: box.m === "zk" ? "zk" : "esc" }));   // remember the seal mode
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
  _apT = setTimeout(autoPushNow, 9000);   // generous window — a push seals + uploads the whole vault
}
async function autoPushNow() {
  clearTimeout(_apT); _apT = null;
  if (!cloudReady()) return;
  if (_restoreBusy) { autoPushSoon(); return; }   // a Restore is applying — never seal a half-restored state
  if (_apBusy) { autoPushSoon(); return; }   // single-flight; re-queue behind the current push
  _apBusy = true;
  cloudChip("syncing");
  try { await cloudPush(""); cloudChip("ok"); _apFails = 0; }
  catch (e) {
    cloudChip("err", (e && e.message) || "sync failed");
    // A CORRECTIVE push (armed because we hold authored data the vault lacks) must not
    // die on a transient blip: if the vault then goes quiet, cloudAutoPull early-returns
    // on the unchanged stamp, so the ahead-check never re-runs and nothing would ever
    // retry. Back off a few times, then stop — a permanent error (needs passphrase)
    // can't spin, and the next real change or vault move re-arms normally.
    if (++_apFails <= 3) { clearTimeout(_apT); _apT = setTimeout(autoPushNow, 15000 * _apFails); }
  }
  _apBusy = false;
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
  try { if (lo["money.charSince"] != null && mergeCharSinceStr(lo["money.charSince"])) changed = true; } catch (e) {}
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
          if (!cloudKeyGet() && box.m === "esc") cloudKeySet(box.k);
          cloudSaveState(Object.assign(cloudState(), { mode: box.m === "zk" ? "zk" : "esc" }));   // mode memory — the guard reads it
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
function cloudChip(state, msg) {
  const el = document.getElementById("cloudHealth");
  if (!el) return;
  const s = cloudState();
  if (!s.token) { el.hidden = true; return; }
  el.hidden = false;
  const dot = el.querySelector(".sync-dot"), txt = el.querySelector(".sync-text");
  if (cloudPaused()) { dot.style.background = "#8a8a8a"; txt.textContent = "cloud: off"; el.title = "cloud sync is off by your choice — your data stays on this device (Settings → Cache cloud)"; return; }
  if (state === "syncing") { dot.style.background = "#d6920f"; txt.textContent = "cloud: syncing…"; el.title = "encrypting + syncing to your cloud"; return; }
  if (state === "err") { dot.style.background = "#c9542e"; txt.textContent = "cloud: needs you"; el.title = (msg || "cloud sync failed") + " — tap for cloud settings"; return; }
  if (s.keyboxMissing) { dot.style.background = "#d6920f"; txt.textContent = "cloud: setup note"; el.title = "one-time server setup: add a 'keybox' text field to the vaults collection so your other devices can unlock"; return; }
  dot.style.background = s.lastPush ? "#3f8f4e" : "#d6920f";
  txt.textContent = s.lastPush ? "cloud ✓" : "cloud: not synced";
  el.title = s.lastPush ? ("last sync " + cloudAgo(s.lastPush) + " — tap for cloud settings") : "connected — first backup pending (Settings → Cache cloud)";
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
// First-run coaching: how to set up the SimpleFIN bank connection, in-app (no Terminal).
function openConnect() {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal connect-modal";
  // On the hosted web app there is no local sync engine — it's a read-only window into the
  // cache the DESKTOP app pulls from the bank. Presenting the SimpleFIN steps + a token box
  // here dead-ends the user with a generic "editing is coming soon" reject AFTER they've done
  // all the work (exactly how a tester got stuck). So on web we say it plainly up front and
  // point them at the desktop app, instead of offering controls that can't work.
  const web = !!window.__CACHE_WEB__;
  if (web) {
    modal.innerHTML =
      '<div class="cat-head"><span>Connect a bank</span><button class="cat-close" aria-label="Close">✕</button></div>' +
      '<div class="connect-body">' +
        '<div class="cn-status">checking…</div>' +
        '<div class="cn-intro">You’re viewing your cache on the <b>web</b> — a read-only window into it. Connecting a bank happens once in the <b>desktop app</b> (the part that securely pulls your bank data). After that, your cache <b>syncs here automatically</b> and you can see everything from any device.</div>' +
        '<ol class="cn-steps">' +
          '<li>Open <b>THE CACHE desktop app</b> on your computer.</li>' +
          '<li>Tap <b>Connect a bank</b> and paste your SimpleFIN <b>setup token</b> there.</li>' +
          '<li>Come back here — your accounts and transactions will already be showing.</li>' +
        '</ol>' +
        '<div class="cn-result"></div>' +
      '</div>';
  } else {
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
  fetch("/api/connect-status").then((r) => r.json()).then((d) => {
    connected = !!(d && d.connected);
    if (web) {
      statusEl.innerHTML = connected
        ? '<span class="cn-ok">✓ Your bank is already connected</span> — synced from your desktop. There’s nothing to do here.'
        : '<span class="cn-no">No bank connected yet.</span> Set it up in the desktop app (below), then it’ll appear here.';
    } else {
      statusEl.innerHTML = connected
        ? '<span class="cn-ok">✓ A bank is connected.</span> Paste a new token to reconnect, or just close this.'
        : '<span class="cn-no">Not connected yet.</span> Follow the steps below.';
    }
  }).catch(() => { statusEl.textContent = ""; });
  if (web) return;   // web body has no token/demo/csv controls to wire
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
// One-click comfort loadouts — bundle the fine-tune settings into a vibe.
const A11Y_PRESETS = [
  { id: "calm",  t: "🌙 Calm",    d: "Gentle motion · high contrast · larger", set: { motion: "reduce", contrast: "high",   text: "lg" } },
  { id: "crisp", t: "🔆 Crisp",   d: "Max readability, motion as-is",          set: { motion: "auto",   contrast: "high",   text: "lg" } },
  { id: "full",  t: "🚀 Full FX", d: "Every effect, default size",             set: { motion: "full",   contrast: "normal", text: "base" } },
];
function a11yMatchesPreset(p) { return Object.keys(p.set).every((k) => a11yGet(k) === p.set[k]); }
function a11yApplyPreset(p) {
  Object.keys(p.set).forEach((k) => {
    const v = p.set[k];
    if (v && v !== A11Y[k].def) localStorage.setItem(A11Y[k].key, v); else localStorage.removeItem(A11Y[k].key);
  });
  applyA11y();
}
function openA11y() {
  closeA11y();
  const back = document.createElement("div"); back.className = "cat-backdrop"; back.id = "a11yBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeA11y(); });
  const modal = document.createElement("div"); modal.className = "cat-modal a11y-modal"; modal.id = "a11yModal";
  const seg = (name, opts) => '<div class="a11y-seg" role="group" aria-label="' + name + '" data-name="' + name + '">' +
    opts.map((o) => '<button class="a11y-opt' + (a11yGet(name) === o.v ? " on" : "") + '" data-v="' + o.v + '" aria-pressed="' + (a11yGet(name) === o.v) + '">' + o.t + "</button>").join("") + "</div>";
  modal.innerHTML =
    '<div class="cat-head"><span>♿ Accessibility Hub</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="a11y-body">' +
      '<div class="a11y-intro">Built for how <em>you</em> actually use it. Tune anything here — and if something you need is missing, that request comes first.</div>' +
      '<div class="a11y-sec">Comfort presets</div>' +
      '<div class="a11y-presets">' +
        A11Y_PRESETS.map((p) => '<button class="a11y-preset' + (a11yMatchesPreset(p) ? " on" : "") + '" data-p="' + p.id + '" aria-pressed="' + a11yMatchesPreset(p) + '"><b>' + p.t + "</b><span>" + p.d + "</span></button>").join("") +
      "</div>" +
      '<div class="a11y-sec">Fine-tune</div>' +
      '<div class="a11y-row"><div class="a11y-lbl"><b>Motion &amp; flashing</b><span>Calms the warp, removes the white flash, and stops looping animation — seizure-safe. <em>System</em> follows your device setting.</span></div>' +
        seg("motion", [{ v: "auto", t: "System" }, { v: "reduce", t: "Reduce" }, { v: "full", t: "Full" }]) + "</div>" +
      '<div class="a11y-row"><div class="a11y-lbl"><b>Contrast</b><span>Stronger borders and text for easier reading.</span></div>' +
        seg("contrast", [{ v: "normal", t: "Normal" }, { v: "high", t: "High" }]) + "</div>" +
      '<div class="a11y-row"><div class="a11y-lbl"><b>Text &amp; UI size</b><span>Scale the whole interface up.</span></div>' +
        seg("text", [{ v: "base", t: "Default" }, { v: "lg", t: "Large" }, { v: "xl", t: "Largest" }]) + "</div>" +
      '<div class="a11y-row"><div class="a11y-lbl"><b>Color vision</b><span>A color-blind-safe palette (Okabe-Ito) for the cache visualizer — and it always shows +/− so color is never the only signal.</span></div>' +
        seg("colorblind", [{ v: "off", t: "Standard" }, { v: "on", t: "Safe palette" }]) + "</div>" +
      '<div class="a11y-note">This hub grows with the people who use it. Need a screen-reader pass, a color-blind-safe palette, bigger touch targets, anything? Menu → ⚑ Report a bug or request — accessibility asks jump the line.</div>' +
    "</div>";
  document.body.appendChild(back); document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", closeA11y);
  const sync = () => {  // reflect current state across segments + presets (class + aria-pressed)
    modal.querySelectorAll(".a11y-seg").forEach((segEl) => {
      const name = segEl.dataset.name;
      segEl.querySelectorAll(".a11y-opt").forEach((b) => { const on = b.dataset.v === a11yGet(name); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    });
    modal.querySelectorAll(".a11y-preset").forEach((pb) => {
      const p = A11Y_PRESETS.find((x) => x.id === pb.dataset.p);
      const on = !!p && a11yMatchesPreset(p); pb.classList.toggle("on", on); pb.setAttribute("aria-pressed", on);
    });
  };
  modal.querySelectorAll(".a11y-seg").forEach((segEl) => {
    const name = segEl.dataset.name;
    segEl.querySelectorAll(".a11y-opt").forEach((btn) => {
      btn.addEventListener("click", () => { a11ySet(name, btn.dataset.v); sync(); });
    });
  });
  modal.querySelectorAll(".a11y-preset").forEach((pb) => {
    pb.addEventListener("click", () => { const p = A11Y_PRESETS.find((x) => x.id === pb.dataset.p); if (p) { a11yApplyPreset(p); sync(); } });
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
  const p = getProfile();
  const v = (k) => { const x = localStorage.getItem(k); return x === null ? "" : x; };
  modal.innerHTML =
    '<div class="cat-head"><span>Settings</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="set-body">' +
      '<div class="set-sec">Mode</div>' +
      '<div class="set-tier" id="setTier"></div>' +
      '<div class="set-hint">how much of the app you want to see — <b>Minimalist</b> keeps it simple, <b>Legendary</b> shows every button</div>' +
      (window.__CACHE_DEMO__ ? "" :
      '<div class="set-sec">☁️ Cache cloud</div>' +
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
          '<button class="set-btn cloud-btn-sub" id="setCloudLogout">Log out</button>' +
        '</div>' +
        '<div class="set-hint cloud-verify" id="setCloudVerify" style="display:none"></div>' +
      '</div>' +
      '<div class="cloud-step" id="cloudStep2">' +
        '<div class="cloud-step-h"><span class="cloud-num">2</span><span class="cloud-step-t">Zero-knowledge mode <span class="cloud-opt">optional</span></span><span class="cloud-chk" id="cloudChk2"></span></div>' +
        '<label class="set-row"><span>Passphrase</span><input id="setCloudPhrase" type="password" autocomplete="off" placeholder="leave empty for the simple default"></label>' +
        '<div class="set-hint">Your cache is always <b>encrypted on your device</b> before it leaves. By default your account keeps a spare key, so a forgotten password never loses your data. Set a passphrase here for <b>zero-knowledge mode</b>: only you hold the key — <b>write it down</b>, because then not even we can recover it.</div>' +
      '</div>' +
      '<div class="cloud-step" id="cloudStep3">' +
        '<div class="cloud-step-h"><span class="cloud-num">3</span><span class="cloud-step-t">Sync</span><span class="cloud-chk" id="cloudChk3"></span></div>' +
        '<div class="set-bk-row">' +
          '<button class="set-btn" id="setCloudPush">⬆ Back up to cloud</button>' +
          '<button class="set-btn" id="setCloudPull">⬇ Restore from cloud</button>' +
        '</div>' +
        '<div class="set-hint cloud-msg" id="setCloudMsg"></div>' +
      '</div>') +
      '<div class="set-sec">Profile</div>' +
      '<label class="set-row"><span>Your name</span><input id="setName" type="text" value="' + escapeHtml(p.name || "") + '" placeholder="your name"></label>' +
      '<label class="set-row"><span>What you do</span><input id="setRole" type="text" value="' + escapeHtml(p.role || "") + '" placeholder="musician · gig work · freelance"></label>' +
      '<label class="set-row"><span>Note to self</span><input id="setNote" type="text" value="' + escapeHtml(p.note || "") + '" placeholder="optional"></label>' +
      '<div class="set-sec">Bank connection</div>' +
      '<div class="set-bank-status" id="setBankStatus">checking…</div>' +
      '<div class="set-token-wrap"><input id="setToken" class="set-bank-input" type="password" placeholder="paste your SimpleFIN setup token">' +
        '<button class="set-token-eye" id="setTokenEye" type="button" aria-label="Show/hide token"><i data-lucide="eye"></i></button></div>' +
      '<div class="set-bank-row"><button class="set-bank-btn" id="setConnect">Connect &amp; sync</button>' +
        '<button class="set-bank-help" id="setConnectHelp">Help &amp; demo</button></div>' +
      '<div class="set-hint">Get a token from your SimpleFIN account → “New app connection”. It stays on this computer, never shared. New here? Tap <b>Help &amp; demo</b> for steps + free sample data.</div>' +
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
      '<div class="set-sec" data-tier="3">Stats bar</div>' +
      '<div class="set-hint" data-tier="3">the live numbers along the top — toggle any on or off · drag them in the bar to reorder</div>' +
      '<div id="setStats" class="set-stats" data-tier="3"></div>' +
    '</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  makeModalResizable(modal, "money.settings");
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());

  const saveProfile = () => setProfile({
    name: modal.querySelector("#setName").value.trim(),
    role: modal.querySelector("#setRole").value.trim(),
    note: modal.querySelector("#setNote").value.trim(),
  });
  ["#setName", "#setRole", "#setNote"].forEach((s) => modal.querySelector(s).addEventListener("input", saveProfile));

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
  // Repaint the whole stepper: checkmarks, which step is active, the next-step banner, button enabling.
  function refreshCloud() {
    const s = cloudState();
    // the "key" step is satisfied by a typed passphrase (zero-knowledge), OR by the
    // device already holding the cloud data key, OR simply by being logged in —
    // escrow mode needs nothing from the user (that's the point)
    const inAccount = !!s.token, hasPhrase = phrase().length >= 6, hasBackup = !!s.lastPush;
    // the zero-knowledge check means zero-knowledge is actually ON — an escrow
    // account showing ✓ there would be claiming a protection it doesn't have
    const zkOn = s.mode === "zk" || hasPhrase;
    // step checkmarks + active highlight
    [[1, inAccount], [2, zkOn], [3, hasBackup]].forEach(([n, done]) => {
      clChk[n].textContent = done ? "✓" : "";
      clChk[n].className = "cloud-chk" + (done ? " on" : "");
      clStep[n].classList.toggle("done", done);
    });
    const active = !inAccount ? 1 : 3;   // step 2 is optional — never the blocker
    clStep.forEach((el, n) => el && el.classList.toggle("active", n === active));
    // account buttons
    clSignup.style.display = inAccount ? "none" : "";
    clLogin.style.display = inAccount ? "none" : "";
    clLogout.style.display = inAccount ? "" : "none";
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
    const s = cloudState(); if (s.url) clUrl.value = s.url; if (s.token) clEmail.value = s.email || ""; if (bkPass && bkPass.value) clPhrase.value = bkPass.value; refreshCloud();
    // validate the stored session for real — a token quietly expires after ~14 days,
    // and an eternal green check that fails on sync is worse than an honest re-login ask.
    // Repaint either way: a success may have just learned the verified flag.
    if (s.token) cloudAuthCheck().then((ok) => { refreshCloud(); if (!ok) clSay("Your cloud login expired — enter your password and hit Log in. Your data is safe.", "err"); });
  })();
  clSignup.addEventListener("click", async () => {
    clSay("Creating account…", "work");
    try { await cloudSignup(clUrl.value.trim(), clEmail.value.trim(), clPass.value); refreshCloud(); clSay("✓ Account created — you’re signed in. Hit ⬆ Back up to cloud and you’re done.", "ok"); }
    catch (e) { clSay("Couldn’t create account: " + (e.message || e), "err"); }
  });
  clLogin.addEventListener("click", async () => {
    clSay("Logging in…", "work");
    try { await cloudLogin(clUrl.value.trim(), clEmail.value.trim(), clPass.value); refreshCloud(); cloudChip(); cloudAutoPull(); clSay("✓ Logged in as " + cloudState().email + ".", "ok"); }
    catch (e) { clSay("Login failed: " + (e.message || e), "err"); }
  });
  clLogout.addEventListener("click", () => { cloudLogout(); clPass.value = ""; refreshCloud(); clSay("Logged out.", ""); });
  clPush.addEventListener("click", async () => {
    if (!cloudState().token) { clSay("Do Step 1 first — create or log into your account.", "err"); return; }
    if (phrase() && phrase().length < 6) { clSay("A zero-knowledge passphrase needs 6+ characters (or clear the field for the simple default).", "err"); return; }
    clSay("Encrypting + syncing to cloud…", "work");
    try { const res = await cloudPush(phrase()); refreshCloud(); cloudChip("ok"); clSay("✓ Backed up to the cloud — " + res.count + " files sealed & encrypted. From here it syncs itself.", "ok"); }
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

  // Bank connection — paste a SimpleFIN setup token right here
  const bankStatus = modal.querySelector("#setBankStatus");
  fetch("/api/connect-status").then((r) => r.json()).then((d) => {
    bankStatus.innerHTML = d && d.connected
      ? '<span style="color:#3f8f4e">✓ Connected</span>'
      : '<span style="color:#c9542e">Not connected yet</span>';
  }).catch(() => { bankStatus.textContent = ""; });
  modal.querySelector("#setConnect").addEventListener("click", () => {
    const tok = modal.querySelector("#setToken").value.trim();
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
  modal.querySelector("#setConnectHelp").addEventListener("click", () => openConnect());
  const tokenInput = modal.querySelector("#setToken");
  const eyeBtn = modal.querySelector("#setTokenEye");
  eyeBtn.addEventListener("click", () => {
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
    const curFont = localStorage.getItem(FONT_KEY) || "mono";
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
applyFont(localStorage.getItem(FONT_KEY) || "mono");

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
        if (window.__CACHE_WEB__) { syncDot.style.background = "#8a8a8a"; syncText.textContent = "no money data yet"; syncHealth.title = "money joins from a computer you own — this device reads the synced result"; }
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
      sourcesBtn.querySelector(".src-count").textContent = banks.length + (tg ? 1 : 0);
      const when = d && d.updated ? ageStr(Date.now() - new Date(d.updated).getTime()) : "—";

      let html = '<div class="src-title">Data sources</div>';
      banks.forEach((o) => {
        html += '<div class="src-bank"><span class="src-bankdot"></span><div>' +
          '<div class="src-bankname">' + escapeHtml(o) + '</div>' +
          '<div class="src-accts">' + orgs[o].map(escapeHtml).join(" · ") + '</div></div></div>';
      });
      if (tg) {
        html += '<a class="src-bank src-link" href="https://track.toggl.com" target="_blank" rel="noopener">' +
          '<span class="src-bankdot" style="background:#e9408f"></span><div>' +
          '<div class="src-bankname">Toggl ↗</div>' +
          '<div class="src-accts">' + (tg.projects || 0) + ' projects · time tracking</div></div></a>';
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
const sndBtn = document.getElementById("soundtrack");
let ytPlayer = null, ytReady = false;

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
  const id = localStorage.getItem(SND_KEY);
  if (id) buildPlayer(id, false);
};
sndBtn.addEventListener("click", () => {
  let id = localStorage.getItem(SND_KEY);
  if (!id) {
    const u = prompt("Paste a YouTube link for your soundtrack:");
    if (!u) return;
    id = parseYtId(u);
    if (!id) { alert("Couldn't find a YouTube video ID in that link."); return; }
    localStorage.setItem(SND_KEY, id);
    buildPlayer(id, true);
    return;
  }
  if (!ytPlayer || !ytPlayer.getPlayerState) { buildPlayer(id, true); return; }
  if (ytPlayer.getPlayerState() === 1) { ytPlayer.pauseVideo(); sndBtn.classList.remove("playing"); }
  else { ytPlayer.playVideo(); sndBtn.classList.add("playing"); }
});

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
(function () {
  const gs = document.getElementById("gutterSlider");
  if (!gs) return;
  gs.value = gutterVal();
  // Resize widgets IN PLACE: each keeps its grid cell + position, only its size
  // changes to open/close the gutter. Nothing moves around.
  let spans = null;
  const snapshot = () => {
    spans = {};
    const g = gutterVal();
    Object.keys(layout).forEach((id) => {
      const n = nodes[id];
      if (!n || layout[id].type === "sticker") return;
      spans[id] = { cw: Math.round((n.offsetWidth + g) / SNAP) * SNAP, ch: Math.round((n.offsetHeight + g) / SNAP) * SNAP };
    });
  };
  const DETENTS = [6, 18, 30, 42];                       // 4 Apple-style detents
  const softSnap = (v) => { for (const d of DETENTS) if (Math.abs(v - d) <= 3) return d; return v; };  // magnetic, but free between
  gs.addEventListener("pointerdown", snapshot);
  gs.addEventListener("input", () => {
    if (!spans) snapshot();
    const v = softSnap(parseInt(gs.value, 10) || 18);
    gs.value = v;                                         // pull the thumb to the detent when close
    localStorage.setItem("money.gutter", v);
    const g = v;
    Object.keys(spans).forEach((id) => {
      const n = nodes[id];
      if (!n) return;
      const w = Math.max(MIN_W, spans[id].cw - g), h = Math.max(MIN_H, spans[id].ch - g);
      n.style.width = w + "px"; n.style.height = h + "px";
      layout[id].w = w; layout[id].h = h;
    });
  });
  gs.addEventListener("change", () => { saveLayout(); spans = null; });
})();
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
function sendFeedbackToInbox(kind, text, email) {
  try {
    let from = "";
    try { from = (JSON.parse(localStorage.getItem("money.profile") || "{}").name || ""); } catch (e) {}
    fetch(cloudUrl() + "/api/collections/feedback/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: kind || "note", message: (text || "").slice(0, 4000), reply_to: email || "", from_name: from.slice(0, 80), context: feedbackContext().slice(0, 300) }),
    }).catch(() => {});
  } catch (e) {}
}
// Returns a promise<boolean> — true if it was sent (or the mail app was opened).
function sendFeedback(kind, text, email) {
  sendFeedbackToInbox(kind, text, email);
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
    submit.disabled = true;
    msgEl.className = "bug-msg";
    msgEl.textContent = "sending…";
    sendFeedback(kind, text, email).then((ok) => {
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
      '<div class="lg-eyebrow lg-gold">⟢ The Ledger ⟣</div>' +
      '<div class="lg-title">YOUR LIFE, IN DATA</div>' +
      '<div class="lg-headline" id="lgHeadline"></div>' +
      '<div class="lg-reward lg-hidden" id="lgReward"></div>' +
      '<svg class="lg-const" id="lgConst" viewBox="0 0 1000 320" preserveAspectRatio="xMidYMid meet"></svg>' +
      '<button class="lg-back">↩ Return</button>' +
      '<div class="lg-dash" id="lgDash"></div>' +
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
      const count = Object.keys(orgs).length + (tg ? 1 : 0);
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
  "the goat is proud of you 🐐", "data so fresh it squeaks ✨", "high-res life unlocked 📈", "fed and watered 🌱"];
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
    p.textContent = em ? (n % 12 === 0 ? "🐐" : "✨") : "";
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
      b.innerHTML = '<div class="daily-goat">😬</div><div class="daily-big">Couldn’t save</div>' +
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
    b.innerHTML = '<div id="dailyGoat" class="daily-goat">🐐</div><div class="daily-big">Logged!</div>' +
      '<div id="dailyExp" class="daily-exp">+0 EXP</div><div class="daily-funny">' + DAILY_FUNNIES[Math.floor(Math.random() * DAILY_FUNNIES.length)] + "</div>" + hLine +
      '<button class="daily-cta" id="dailyDone">Done</button>';
    stage.innerHTML = ""; stage.appendChild(b);
    const r = stage.getBoundingClientRect(); dailyBurst(stage, r.width / 2, r.height * 0.36);
    const goat = b.querySelector("#dailyGoat"); if (!reduceMotion()) goat.animate([{ transform: "scale(.4) rotate(-12deg)" }, { transform: "scale(1.15) rotate(6deg)" }, { transform: "scale(1)" }], { duration: 600, easing: "cubic-bezier(.2,1.3,.4,1)" });
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
          '<label>Store<select class="deck-kind">' + [["money", "💰 Money"], ["health", "🩺 Health"], ["tracker", "📈 Tracker"], ["dayflag", "📅 Day-log"]].map((k) => '<option value="' + k[0] + '"' + ((it.dest && it.dest.kind) === k[0] ? " selected" : "") + ">" + k[1] + "</option>").join("") + "</select></label>" +
          '<label class="deck-target">Where<input class="deck-tgt" value="' + escapeHtml((it.dest && it.dest.target) || "") + '" placeholder="name (e.g. Groceries)" list="deckBldNames"></label></div>' +
        ((it.input === "choice" || it.input === "scale") ? '<div class="deck-row-cfg"><label class="deck-optlbl">Buttons<input class="deck-opts" value="' + escapeHtml(optStr(it.options)) + '" placeholder="Cooked, Ate out, Both"></label></div>' : "");
      // stamp AT THE POINT OF EDIT — the item the user actually touched. Deriving
      // "what changed" inside the save would make this stale array authoritative for
      // every item another device changed underneath it (reverting their edit, and
      // resurrecting their delete). Only the touched item gets a fresh stamp.
      const touch = () => { it.updated = deckNow(); persist(); };
      row.querySelector(".deck-emoji").addEventListener("input", (e) => { it.emoji = e.target.value; touch(); });
      row.querySelector(".deck-prompt").addEventListener("input", (e) => { it.prompt = e.target.value; touch(); });
      row.querySelector(".deck-input").addEventListener("change", (e) => { it.input = e.target.value; touch(); render(); });
      row.querySelector(".deck-kind").addEventListener("change", (e) => { it.dest = it.dest || {}; it.dest.kind = e.target.value; touch(); });
      row.querySelector(".deck-tgt").addEventListener("input", (e) => { it.dest = it.dest || {}; it.dest.target = e.target.value; touch(); });
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
  const done = () => {
    try { localStorage.setItem(DECKCOACH_KEY, String(Date.now())); } catch (e) {}
    if (pill) pill.classList.remove("coaching");
    card.remove();
  };
  card.querySelector(".dc-open").addEventListener("click", () => { done(); openDaily(); });
  card.querySelector(".dc-later").addEventListener("click", done);
}
(function () {
  const b = document.getElementById("dailyBtn"); if (b) b.addEventListener("click", openDaily);
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
    if (!document.hidden) { ckSync(); cloudAutoPull(); }   // …and every return to the tab (log on your phone, walk to the desk, it's there)
    else if (_apT) autoPushNow();   // leaving the tab with a push pending → flush it now
  });
})();

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
  let i = 0; const picks = []; let door = "later"; let energyLogged = false;
  const markDone = () => { try { localStorage.setItem(WIZ_KEY, String(Date.now())); } catch (e) {} };
  const close = () => { markDone(); root.remove(); document.removeEventListener("keydown", onKey); };
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  root.querySelector("#wizClose").addEventListener("click", close);
  const STEPS = [wWelcome, wName, wAreas, wMoney, wEnergy, wReserve, wDone];
  function dots() { dotsEl.innerHTML = ""; for (let s = 0; s < STEPS.length; s++) { const d = document.createElement("span"); d.className = "daily-dot" + (s < i ? " done" : (s === i ? " on" : "")); dotsEl.appendChild(d); } }
  function next() { i++; if (i >= STEPS.length) { close(); return; } render(); }
  function render() { dots(); const body = document.createElement("div"); body.className = "daily-body daily-in"; STEPS[i](body); stage.innerHTML = ""; stage.appendChild(body); }
  const skipBtn = '<button class="wiz-skip" data-skip>skip this step</button>';

  function wWelcome(b) {
    b.innerHTML = '<div class="daily-goat">🐐</div><div class="daily-q">Welcome to your cache</div>' +
      '<div class="daily-hint">A calm, private home for your life — starting with your money. Six quick steps, all of them skippable, nothing leaves your machine.</div>' +
      '<div class="daily-opts"><button class="daily-btn" data-go><span class="e">🧭</span><span>Set me up</span></button>' +
      '<button class="daily-btn" data-explore><span class="e">👀</span><span>Just let me look around</span></button></div>';
    b.querySelector("[data-go]").addEventListener("click", next);
    b.querySelector("[data-explore]").addEventListener("click", close);
  }
  function wName(b) {
    b.innerHTML = '<div class="daily-q">Name your cache</div>' +
      '<div class="daily-hint">It’s yours — call it anything. You can rename it any time from the menu.</div>' +
      '<input class="daily-note" id="wizName" maxlength="40" placeholder="e.g. The Vault, Mission Control, Pat’s Cache…">' +
      '<button class="daily-cta" id="wizNameGo">Next</button>' + skipBtn;
    b.querySelector("#wizNameGo").addEventListener("click", () => {
      const v = (b.querySelector("#wizName").value || "").trim();
      if (v) { try { localStorage.setItem("money.cacheName", v); } catch (e) {} try { if (typeof renderCharacter === "function") renderCharacter(); } catch (e) {} }
      next();
    });
    b.querySelector("[data-skip]").addEventListener("click", next);
  }
  function wAreas(b) {
    b.innerHTML = '<div class="daily-q">What parts of your life do you already track?</div>' +
      '<div class="daily-hint">Tap everything that fits. Money and Health work today; the rest say “soon” honestly — your picks shape your daily check-in and tell us what to build next.</div>' +
      '<div class="wiz-grid">' + WIZ_AREAS.map((a, ix) =>
        '<button class="wiz-chip" data-ix="' + ix + '"><span class="e">' + a[0] + '</span><span>' + a[1] + '</span><span class="wiz-tag' + (a[2] ? " now" : "") + '">' + (a[2] ? "works today" : "soon") + "</span></button>").join("") + "</div>" +
      '<button class="daily-cta" id="wizAreasGo">Next</button>' + skipBtn;
    b.querySelectorAll(".wiz-chip").forEach((c) => c.addEventListener("click", () => {
      const label = WIZ_AREAS[parseInt(c.dataset.ix, 10)][1];
      const at = picks.indexOf(label);
      if (at === -1) { picks.push(label); c.classList.add("on"); } else { picks.splice(at, 1); c.classList.remove("on"); }
    }));
    b.querySelector("#wizAreasGo").addEventListener("click", () => {
      try { localStorage.setItem(WIZ_PICKS_KEY, JSON.stringify(picks)); } catch (e) {}
      wizSeedDeck(picks);
      next();
    });
    b.querySelector("[data-skip]").addEventListener("click", next);
  }
  function wMoney(b) {
    if (window.__CACHE_WEB__) {
      // the money engine lives on a computer you own — on the phone, every bank
      // door would be a dead end. Say so plainly instead of promising a payoff.
      b.innerHTML = '<div class="daily-q">Money joins from a computer</div>' +
        '<div class="daily-hint">Bank connections run on a computer you own — your phone reads the synced result, always sealed. Nothing to do here today; everything else works right now.</div>' +
        '<div class="daily-opts">' +
          '<button class="daily-btn" data-door="later"><span class="e">👍</span><span>Got it — keep going</span></button>' +
          '<button class="daily-btn" data-door="webdemo"><span class="e">🎮</span><span>Peek at the demo (new tab)</span></button></div>';
      b.querySelectorAll("[data-door]").forEach((d) => d.addEventListener("click", () => {
        if (d.dataset.door === "webdemo") { try { window.open("/demo/", "_blank"); } catch (e) {} door = "later"; return; }
        door = "later"; next();
      }));
      return;
    }
    b.innerHTML = '<div class="daily-q">Boss battle: connect your money</div>' +
      '<div class="daily-hint">The biggest payoff in the whole setup. Plain truth: your bank data stays on YOUR machine, the app never sees your bank login, and the demo is a zero-risk way to look around first. I’ll open the connection panel when we finish.</div>' +
      '<div class="daily-opts">' +
        '<button class="daily-btn" data-door="bank"><span class="e">🏦</span><span>Connect my real bank</span></button>' +
        '<button class="daily-btn" data-door="demo"><span class="e">🎮</span><span>Load demo data first</span></button>' +
        '<button class="daily-btn" data-door="csv"><span class="e">📄</span><span>Import a CSV statement</span></button>' +
        '<button class="daily-btn" data-door="later"><span class="e">⏭️</span><span>Later — keep going</span></button></div>';
    b.querySelectorAll("[data-door]").forEach((d) => d.addEventListener("click", () => { door = d.dataset.door; next(); }));
  }
  function wEnergy(b) {
    const it = (deckLive(loadDeck()).find((q) => q && q.id === "energy")) || DEFAULT_DECK.find((q) => q.id === "energy");
    b.innerHTML = '<div class="daily-q">' + escapeHtml(it.prompt) + '</div>' +
      '<div class="daily-hint">This is a card from <b>the deck</b> — the heart of Cache. Your energy varies; that’s not a flaw. One tap a day builds a pattern you can plan around.</div>';
    const holder = document.createElement("div"); holder.className = "daily-input"; b.appendChild(holder);
    const sk = document.createElement("button"); sk.className = "wiz-skip"; sk.textContent = "skip this step"; b.appendChild(sk);
    sk.addEventListener("click", next);
    buildDailyInput(holder, it, (v) => {
      try {
        const entry = { ts: todayKey(), at: Date.now(), itemId: it.id, prompt: it.prompt, input: it.input, value: v, dest: it.dest || null };
        const log = loadLog(); log.push(entry);
        if (saveLog(log)) { energyLogged = true; ckPush([entry]); try { document.dispatchEvent(new CustomEvent("cache:logged")); } catch (e) {} }
      } catch (e) {}
      next();
    });
  }
  function wReserve(b) {
    b.innerHTML = '<div class="daily-q">Set your safety buffer</div>' +
      '<div class="daily-hint">Money you never want to touch — Safe-to-spend subtracts it before telling you what’s truly spendable. Changeable any time in Settings.</div>' +
      '<button class="daily-none" data-v="">🌱 Not yet — skip</button>' +
      '<div class="daily-chips">' + ["100", "250", "500", "1000"].map((c) => '<button class="daily-chip" data-v="' + c + '">$' + c + "</button>").join("") + '<button class="daily-chip" data-v="__other">Other</button></div>';
    b.querySelectorAll("[data-v]").forEach((btn) => btn.addEventListener("click", () => {
      const v = btn.dataset.v;
      if (v === "__other") {
        b.innerHTML = '<div class="daily-q">Set your safety buffer</div><input class="daily-note" id="wizRes" type="number" inputmode="decimal" placeholder="amount…"><button class="daily-cta" id="wizResGo">Next</button>';
        b.querySelector("#wizResGo").addEventListener("click", () => { const n = parseFloat(b.querySelector("#wizRes").value) || 0; if (n > 0) try { localStorage.setItem(RESERVE_KEY, String(n)); } catch (e) {} next(); });
        return;
      }
      if (v) try { localStorage.setItem(RESERVE_KEY, v); } catch (e) {}
      next();
    }));
  }
  function wDone(b) {
    markDone();
    try { if (typeof addExp === "function") addExp(10); } catch (e) {}
    try { if (typeof logChar === "function") logChar("feat", "Setup complete · +10 EXP"); } catch (e) {}
    const bits = [];
    if (picks.length) bits.push(picks.length + (picks.length === 1 ? " life area" : " life areas") + " picked");
    if (energyLogged) bits.push("energy day 1 logged");
    if (!window.__CACHE_WEB__) bits.push(door === "later" ? "money connection saved for later (⚡ in the menu)" : "opening the connection panel next");
    b.innerHTML = '<div id="wizGoat" class="daily-goat">🐐</div><div class="daily-big">Your cache is ready</div>' +
      '<div class="daily-exp">+10 EXP</div><div class="daily-funny">' + escapeHtml(bits.join(" · ")) + "</div>" +
      '<div class="daily-hint">One thing to remember: <b>🃏 the deck!</b> button at the bottom. When you open your cache, tap the deck — one minute keeps it fed.</div>' +
      '<button class="daily-cta" id="wizEnter">Enter your cache</button>';
    const r = stage.getBoundingClientRect(); dailyBurst(stage, r.width / 2, r.height * 0.36);
    const goat = b.querySelector("#wizGoat"); if (!reduceMotion() && goat.animate) goat.animate([{ transform: "scale(.4) rotate(-12deg)" }, { transform: "scale(1.15) rotate(6deg)" }, { transform: "scale(1)" }], { duration: 600, easing: "cubic-bezier(.2,1.3,.4,1)" });
    b.querySelector("#wizEnter").addEventListener("click", () => {
      close();
      if (!window.__CACHE_WEB__ && door !== "later") { try { openConnect(); } catch (e) {} }
      else setTimeout(showDeckCoach, 700);   // land the ritual: point at the deck
    });
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
    fetch(src + "?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.text(); })
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
      if (res && res.ok) { flash("Synced — reloading…"); autoPushNow().then(() => setTimeout(() => location.reload(), 1200)); }
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
  if (e.code !== "Space" || e.repeat) return;
  if (isTypingTarget(e.target) || document.querySelector(".cat-modal, .subd-modal")) return;
  e.preventDefault();           // stop the page from scrolling on space
  panning = true;
  document.body.classList.add("panning");   // → grab (open hand) cursor
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
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
if (serverBtn && window.__CACHE_WEB__) serverBtn.style.display = "none";   // no local backend here — a "restart" pill would be theater
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
if (serverBtn) {
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
const DOCK_DEFS = [
  { id: "scale", label: "Scale" },
  { id: "datetime", label: "Date / time" },
  { id: "period", label: "Period" },
  { id: "daily", label: "The deck (daily check-in)" },
  { id: "base", label: "The Base" },
  { id: "ledger", label: "Visit your cache" },
  { id: "status", label: "Status" },
  { id: "soundtrack", label: "Soundtrack" },
  { id: "roadmap", label: "Roadmap" },
  { id: "sources", label: "Sources" },
  { id: "server", label: "Server" },
];
function dockList(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } }
function applyDockConfig(dock) {
  dockList(DOCK_ORDER_KEY).forEach((id) => {
    const el = dock.querySelector('[data-dock="' + id + '"]');
    if (el) dock.appendChild(el);  // reflow into saved order
  });
  if (autoPinOn()) {  // favorited dock items jump to the front of the bar
    const f = favs();
    const favEls = DOCK_DEFS.filter((d) => f.has("dock:" + d.id))
      .map((d) => dock.querySelector('[data-dock="' + d.id + '"]')).filter(Boolean);
    favEls.reverse().forEach((el) => dock.insertBefore(el, dock.firstChild));
  }
  const hidden = new Set(dockList(DOCK_HIDDEN_KEY));
  dock.querySelectorAll(".dock-item").forEach((el) => {
    el.style.display = hidden.has(el.dataset.dock) ? "none" : "";
  });
  // the deck is the PRIMARY CTA — always first, always visible, on every device.
  // External memory needs one findable anchor; a hideable, driftable button isn't one.
  const deck = dock.querySelector('[data-dock="daily"]');
  if (deck) { deck.style.display = ""; dock.insertBefore(deck, dock.firstChild); }
}
function renderDockMenu() {
  const host = document.getElementById("dockMenu");
  if (!host) return;
  const hidden = new Set(dockList(DOCK_HIDDEN_KEY)), f = favs();
  const defs = DOCK_DEFS.filter((d) => d.id !== "daily");   // the deck can't be hidden — it's the front door of the day
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
    const h = new Set(dockList(DOCK_HIDDEN_KEY));
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
    daily: document.getElementById("dailyBtn"),
    base: document.getElementById("baseBtn"),
    ledger: document.getElementById("ledgerBtn"),
    status: document.getElementById("statusBtn"),
    soundtrack: document.getElementById("soundtrack"),
    roadmap: document.getElementById("roadmapBtn"),
    sources: document.getElementById("sourcesBtn"),
    server: document.getElementById("serverBtn"),
  };
  DOCK_DEFS.forEach((d) => {
    const el = els[d.id];
    if (!el) return;
    el.classList.add("dock-item");
    el.dataset.dock = d.id;
    el.setAttribute("draggable", "true");
    dock.appendChild(el);  // re-home it (keeps its event listeners)
  });
  // sync lives OUTSIDE the dock, to its right — the cloud chip rides beside it
  const sync = document.getElementById("syncHealth");
  if (sync) bar.appendChild(sync);
  const cloud = document.getElementById("cloudHealth");
  if (cloud) { bar.appendChild(cloud); cloud.addEventListener("click", () => { autoPushNow(); openSettings(); }); }
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
function allStats() { return STAT_DEFS.concat(ensureCustomStats().map(customStatEntry)); }
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
cloudAutoPull();           // adopt whatever another device left in the cloud
setInterval(() => { if (!document.hidden) cloudAutoPull(); }, 75000);   // near-live: a tiny two-field check while you're looking
document.addEventListener("cache:logged", autoPushSoon);   // a finished check-in is worth syncing
loadSubs().then(() => Store.refresh());  // load your decisions first, then pull data → widgets render correct on first paint
