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
const GUTTER = 8;
const snapSize = (v, min) => Math.max(min || MIN_W, Math.round(v / SNAP) * SNAP - GUTTER);

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
function subEntry(key) { return SUBS[key] || {}; }
function saveSubs() {
  clearTimeout(_subsSaveTimer);
  _subsSaveTimer = setTimeout(() => {
    fetch("/api/subs", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subs: SUBS }) }).catch(() => {});
  }, 350);
}
function setSubField(key, field, value) {
  const e = SUBS[key] || (SUBS[key] = {});
  const isDefault = value === false || value == null || value === "" || (field === "cadence" && value === "monthly");
  if (isDefault) delete e[field]; else e[field] = value;
  if (!Object.keys(e).length) delete SUBS[key];  // keep the file tidy — no empty entries
  saveSubs();
}
function loadSubs() {
  return fetch("/api/subs?t=" + Date.now())
    .then((r) => (r.ok ? r.json() : { subs: {} }))
    .then((d) => {
      SUBS = (d && d.subs) || {};
      if (!Object.keys(SUBS).length && localStorage.getItem("money.subsMigrated") !== "1") migrateLocalSubs();
      localStorage.setItem("money.subsMigrated", "1");
    })
    .catch(() => {});
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
const DRAG_IGNORE = ".widget-close,.widget-toggle,.widget-magnet,.widget-help,.sticker-close,.sticker-magnet,.widget-resize,.sticker-resize";
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
        : "synced";
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
    let transfers = [], lastTypes = null;
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
    Store.subscribe(el, (d) => render(d));
    fetch("/api/transfers?t=" + Date.now()).then((r) => r.json())
      .then((t) => { transfers = t.transfers || []; if (Store.data) render(Store.data); }).catch(() => {});
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
        sl.addEventListener("input", () => {
          s.value = parseFloat(sl.value) || 0;
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
    Store.subscribe(el, (d) => { if (!d || !d.spending) { big.textContent = "…"; return; } ensureSources(d); paint(d); });
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
  date(el) {
    const now = new Date();
    el.innerHTML =
      '<div><div class="big">' + now.getDate() +
      '</div><div class="sub">' + now.toLocaleDateString("en-US", { month: "long" }) +
      '</div></div>';
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
  averages(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">monthly averages</span></div>' +
        '<div class="big bd-avg">…</div>' +
        '<div class="fc-sub avg-sub"></div>' +
      '</div>' +
      '<div class="bd-list avg-list"></div>';
    const big = el.querySelector(".bd-avg");
    const sub = el.querySelector(".avg-sub");
    const list = el.querySelector(".avg-list");
    const row = (label, val, color) =>
      '<div class="avg-row"><span class="avg-label">' + label + "</span>" +
      '<span class="avg-val"' + (color ? ' style="color:' + color + '"' : "") + ">" + val + "</span></div>";
    function load() {
      fetch("/api/averages?t=" + Date.now()).then((r) => r.json()).then((a) => {
        if (!a || !a.months) { big.textContent = "—"; sub.textContent = "no history yet"; list.innerHTML = ""; return; }
        const short = a.deficit > 0;
        big.textContent = fmtUSD(Math.abs(short ? a.deficit : a.net)) + " /mo";
        big.style.color = short ? "#c9542e" : "#3f8f4e";
        sub.textContent = (short ? "avg shortfall — income to find each month" : "avg surplus — you're ahead") +
          " · over " + a.months + " mo";
        list.innerHTML =
          row("Income in", fmtUSD(a.income) + "/mo", "#3f8f4e") +
          row("Spending out", fmtUSD(a.spend) + "/mo", "#c9542e") +
          row("Gig work", fmtUSD(a.instacart) + "/mo") +
          row("Subscriptions", fmtUSD(a.subscriptions) + "/mo") +
          row("Spend / day", fmtUSD(a.per_day));
      }).catch(() => { big.textContent = "—"; sub.textContent = "no data · run sync"; list.innerHTML = ""; });
    }
    Store.subscribe(el, () => load());
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
    function load() {
      fetch("/api/work?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).then((d) => {
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
      }).catch(() => { hoursEl.textContent = "—"; earnedEl.textContent = "—"; sub.textContent = "no data · run toggl_sync.py"; list.innerHTML = ""; });
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
    function loadData() {
      const t = Date.now();
      Promise.all([
        fetch("/api/recurring?t=" + t).then((r) => r.json()).catch(() => ({ recurring: [] })),
        fetch("/api/deposits?t=" + t).then((r) => r.json()).catch(() => ({ deposits: [] })),
        fetch("/api/work?t=" + t).then((r) => r.json()).catch(() => ({ projects_month: [] })),
        fetch("/api/income-links?t=" + t).then((r) => r.json()).catch(() => ({ links: {} })),
      ]).then(([rec, dep, work, lk]) => {
        detected = rec.recurring || []; deposits = dep.deposits || [];
        projects = (work && work.projects_month) || []; incomeLinks = (lk && lk.links) || {};
        render();
      });
    }
    function setIncomeLink(key, project) {
      if (project) incomeLinks[key] = project; else delete incomeLinks[key];
      fetch("/api/income-links", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: incomeLinks }) }).catch(() => {});
      render();
    }
    function trackKey(key) {
      fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: key, category: "subscriptions" }) })
        .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
        .then(() => { flash("✓ now tracking as a subscription"); loadData(); Store.refresh(); })
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
    Store.subscribe(el, () => render());  // re-render on ripple (must-pay toggles, etc.)
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
    function loadMonths() {
    fetch("data/monthly.json?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then((d) => {
        const months = (d && d.months) || [];
        if (!months.length) { sub.textContent = "no history yet · run sync"; list.innerHTML = ""; return; }
        sub.textContent = months.length + " months · tap one for detail";
        const maxFlow = months.reduce((mx, m) => Math.max(mx, m.income, m.spending), 1);
        list.innerHTML = months.map((m, i) => {
          const inW = Math.max(3, m.income / maxFlow * 100);
          const outW = Math.max(3, m.spending / maxFlow * 100);
          const src = m.imported === 0 ? "synced" : (m.live === 0 ? "imported" : "mixed");
          return '<div class="mo-row" data-i="' + i + '">' +
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
            const cmax = (m.categories[0] && m.categories[0].amount) || 1;
            det.innerHTML = m.categories.slice(0, 6).map((c) => {
              const meta = catMeta(c.key);
              return '<div class="mo-cat"><span class="mo-cat-name">' + meta.label + "</span>" +
                '<span class="mo-cat-track"><span class="mo-cat-fill" style="width:' +
                  Math.max(3, c.amount / cmax * 100) + "%;background:" + meta.color + '"></span></span>' +
                '<span class="mo-cat-amt">' + fmtUSD(c.amount) + "</span></div>";
            }).join("") || '<div class="mo-empty">no categorized spending</div>';
            row.classList.add("open");
          });
        });
      })
      .catch(() => { sub.textContent = "no data · run sync"; list.innerHTML = ""; });
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
          drawer.innerHTML = '<div class="cm-delbar">move its <b>' + cat.count + "</b> txns → " +
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
function updateGreeting() {
  const g = document.getElementById("greeting");
  if (!g) return;
  const p = getProfile();
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = (p.name || "").trim().replace(/\b\w/g, (m) => m.toUpperCase());
  g.textContent = name ? "Good " + part + ", " + name + "." : "";
  g.style.display = name ? "" : "none";
}

// ── Gamification: every click banks 1 EXP into your profile's stats ──
let PROFILE_STATS = (function () { const p = getProfile(); return Object.assign({ exp: 0, clicks: 0 }, p.stats || {}); })();
let _statsTimer = null;
function saveStats() {
  const p = getProfile();
  p.stats = PROFILE_STATS;
  try { localStorage.setItem("money.profile", JSON.stringify(p)); } catch (e) {}
}
function updateXp() {
  const e = document.getElementById("sidebarXp");
  if (e) e.innerHTML = "⭐ <b>" + PROFILE_STATS.exp.toLocaleString() + "</b> EXP";
  // update just the EXP chip in place (no full re-render → no thrash on every click)
  const chip = document.querySelector('.stat-chip[data-stat="exp"] .stat-val');
  if (chip) chip.textContent = "⭐ " + PROFILE_STATS.exp.toLocaleString();
}
function addExp(n) {
  PROFILE_STATS.exp += n;
  PROFILE_STATS.clicks += n;
  updateXp();
  clearTimeout(_statsTimer);
  _statsTimer = setTimeout(saveStats, 700);
}
document.addEventListener("pointerdown", () => addExp(1), true);  // capture → counts every click
window.addEventListener("pagehide", saveStats);
window.addEventListener("beforeunload", saveStats);
function applyPrivacy() {
  document.body.classList.toggle("privacy-on", localStorage.getItem("money.privacy") === "1");
}
// First-run coaching: how to set up the SimpleFIN bank connection, in-app (no Terminal).
function openConnect() {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop"; back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(); });
  const modal = document.createElement("div");
  modal.className = "cat-modal connect-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Connect a bank</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="connect-body">' +
      '<div class="cn-status">checking…</div>' +
      '<div class="cn-intro">Bank data comes through <b>SimpleFIN Bridge</b> — a read-only service that <b>never hands the app your bank login</b>. The connection is stored only on this Mac. First time? Do this once:</div>' +
      '<ol class="cn-steps">' +
        '<li>Make a SimpleFIN account at <a href="https://bridge.simplefin.org" target="_blank" rel="noreferrer">bridge.simplefin.org</a> <span class="cn-dim">(~$15/yr — it protects your bank login)</span>.</li>' +
        '<li>In SimpleFIN, connect your bank(s).</li>' +
        '<li>Click <b>New app connection</b> → it shows a long <b>setup token</b>.</li>' +
        '<li>Copy the <b>whole</b> token and paste it below.</li>' +
      '</ol>' +
      '<textarea class="cn-token" rows="3" placeholder="paste YOUR SimpleFIN setup token here (it stays on this Mac)"></textarea>' +
      '<button class="cn-connect">Connect &amp; sync</button>' +
      '<div class="cn-or">— or, free, no bank —</div>' +
      '<div class="cn-alts">' +
        '<button class="cn-demo">Load demo data</button>' +
        '<button class="cn-csv">Import a bank CSV</button>' +
      '</div>' +
      '<div class="cn-result"></div>' +
    '</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  if (typeof makeModalResizable === "function") makeModalResizable(modal, "money.connect");
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer());
  const result = modal.querySelector(".cn-result");
  const statusEl = modal.querySelector(".cn-status");
  let connected = false;
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
      '<div class="set-hint">Get a token from your SimpleFIN account → “New app connection”. It stays on this Mac, never shared. New here? Tap <b>Help &amp; demo</b> for steps + free sample data.</div>' +
      '<div class="set-sec">Safety buffer</div>' +
      '<label class="set-row"><span>Reserve (don’t-touch)</span><input id="setReserve" type="number" value="' + v("money.reserve") + '" placeholder="0"></label>' +
      '<label class="set-row"><span>Monthly need</span><input id="setNeed" type="number" value="' + v("money.need") + '" placeholder="auto from core"></label>' +
      '<div class="set-hint">Reserve protects your runway in the Safe widget. Your <b>income, rent, rate &amp; bills</b> now live in the <b>Budget</b> widget → tap <b>build</b>.</div>' +
      '<div class="set-sec">Display</div>' +
      '<button class="set-toggle" id="setPrivacy"><span>Privacy blur</span><span class="set-state">off</span></button>' +
      '<div class="set-hint">blurs dollar amounts until you hover — good for screen-sharing</div>' +
      '<div class="set-themes" id="setThemes"></div>' +
      '<div class="set-sec">Stats bar</div>' +
      '<div class="set-hint">the live numbers along the top — toggle any on or off · drag them in the bar to reorder</div>' +
      '<div id="setStats" class="set-stats"></div>' +
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

  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const th = modal.querySelector("#setThemes");
  th.innerHTML = THEMES.map((t) => themeChipHtml(t, cur)).join("");
  wireThemeChips(th);
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
  { type: "averages", title: "Averages", w: 300, h: 260 },
  { type: "worklog", title: "Time worked", w: 300, h: 270 },
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
function loadLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (!saved) return defaultLayout();
    const obj = JSON.parse(saved);
    Object.keys(obj).forEach((id) => { if (!obj[id].type) obj[id].type = id; });
    return obj;
  } catch (e) {
    return defaultLayout();
  }
}
function saveLayout() {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
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
    "<p><b>Source:</b> your full ledger, bucketed by calendar month (the partial current month is skipped).</p>" +
    "<p>Each row = the <b>average across those months</b>. Spending <b>excludes transfers</b>.</p>" +
    "<p><b>Gig work</b> = deposits from gig platforms (delivery, rideshare, etc.). <b>Shortfall</b> = avg spend − avg income.</p>",
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
    '<button class="widget-toggle" title="Hide / show frame" aria-label="Toggle frame"><span class="toggle-dot"></span></button>' +
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

  RENDERERS[entry.type](body, entry);
  drawIcons();
  bar.querySelector(".widget-help").addEventListener("click", (e) => { e.stopPropagation(); node.classList.add("flipped"); });
  back.querySelector(".flip-back").addEventListener("click", () => node.classList.remove("flipped"));
  bar.querySelector(".widget-close").addEventListener("click", () => removeWidget(id));
  bar.querySelector(".widget-toggle").addEventListener("click", () => {
    entry.bare = !entry.bare;
    node.classList.toggle("bare", entry.bare);
    saveLayout();
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
    const minY = topInset();  // keep the widget's top below the stats bar
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
        w = snapSize(w, MIN_W); h = snapSize(h, MIN_H);
        if (corner.indexOf("w") >= 0) l = sl + sw - w;
        if (corner.indexOf("n") >= 0) t = st + sh - h;
        l = snapTo(l); t = snapTo(t);
      }
      const minY = topInset();  // don't let the top edge slip under the stats bar
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
function renderLibrary() {
  library.innerHTML = "";
  LIBRARY.forEach((def) => {
    const on = !!layout[def.type];
    const item = document.createElement("button");
    item.className = "lib-item" + (on ? " active" : "");
    item.innerHTML =
      '<span class="lib-dot"></span><span class="lib-label">' + def.title +
      '</span><span class="lib-state">' + (on ? "on" : "add") + "</span>";
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
  { id: "cache", label: "The Cache", bg: "#16140c", accent: "#FFD409" },
  { id: "light", label: "Oat Milk", bg: "#ece6d6", accent: "#c9542e" },
  { id: "dark", label: "Goblin Mode", bg: "#14130e", accent: "#e0734a" },
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
    if (onPick) onPick(c.dataset.id);
  }));
}
const themeBtn = document.getElementById("themeToggle");

function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = "light";
  document.documentElement.setAttribute("data-theme", id);
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
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const back = document.createElement("div");
  back.className = "theme-backdrop";
  back.id = "themeBackdrop";
  back.addEventListener("pointerdown", closeThemePop);
  const pop = document.createElement("div");
  pop.className = "theme-pop";
  pop.innerHTML = THEMES.map((t) => themeChipHtml(t, cur)).join("");
  wireThemeChips(pop, () => closeThemePop());
  document.body.appendChild(back);
  document.body.appendChild(pop);
}
themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (document.querySelector(".theme-pop")) closeThemePop();
  else openThemePop();
});
applyTheme(localStorage.getItem(THEME_KEY) || "light");

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
      if (!d || !d.updated) { syncDot.style.background = "#c9542e"; syncText.textContent = "no sync"; return; }
      const hrs = (Date.now() - new Date(d.updated).getTime()) / 3600000;
      syncDot.style.background = hrs < 12 ? "#3f8f4e" : hrs < 48 ? "#d6920f" : "#c9542e";
      syncText.textContent = "synced " + ageStr(Date.now() - new Date(d.updated).getTime());
    })
    .catch(() => {});
}
syncHealth.addEventListener("click", () => {
  syncHealth.classList.add("syncing");
  syncText.textContent = "syncing…";
  fetch("/api/sync", { method: "POST" })
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ok) location.reload();
      else { syncText.textContent = "sync failed"; syncHealth.classList.remove("syncing"); }
    })
    .catch(() => { syncText.textContent = "backend off"; syncHealth.classList.remove("syncing"); });
});
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
function updateApp() {
  flash("Checking for updates…");
  fetch("/api/update", { method: "POST" })
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.ok) { flash("Update failed: " + ((d && (d.error || d.message)) || "is this a git checkout?")); return; }
      if (!d.changed) { flash("Already up to date ✓"); return; }
      flash("Updating " + d.before + " → " + d.after + " — reloading…");
      // server is restarting with the new code; wait for it, then reload
      setTimeout(() => {
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          fetch("/api/ping?t=" + Date.now()).then((r) => {
            if (r.ok) { clearInterval(iv); location.reload(); }
          }).catch(() => {});
          if (tries > 30) { clearInterval(iv); flash("Updated — refresh to load it"); }
        }, 400);
      }, 1100);
    })
    .catch(() => flash("Update failed — backend down?"));
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
function tidyLayout() {
  const pad = 16, startX = 32, startY = Math.max(86, topInset());
  const maxRight = window.innerWidth - 24;
  let x = startX, y = startY, rowH = 0;
  Object.keys(layout).forEach((id) => {
    const node = nodes[id];
    if (!node) return;
    const w = node.offsetWidth, h = node.offsetHeight;
    if (x + w > maxRight && x > startX) { x = startX; y += rowH + pad; rowH = 0; }
    node.classList.add("tidying");
    node.style.left = x + "px";
    node.style.top = y + "px";
    layout[id].x = x; layout[id].y = y;
    x += w + pad;
    rowH = Math.max(rowH, h);
  });
  saveLayout();
  setTimeout(() => Object.values(nodes).forEach((n) => n.classList.remove("tidying")), 480);
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
// Returns a promise<boolean> — true if it was sent (or the mail app was opened).
function sendFeedback(kind, text, email) {
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
document.getElementById("openSettings").addEventListener("click", () => { openSettings(); setSidebar(false); });
document.getElementById("manageCats").addEventListener("click", () => { openCategoryManager(); setSidebar(false); });
document.getElementById("reportBug").addEventListener("click", () => { openBugReport(); setSidebar(false); });

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
      if (res && res.ok) { flash("Synced — reloading…"); setTimeout(() => location.reload(), 1200); }
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

function openReview() {
  statusPanel.innerHTML = '<div class="src-title">Review</div><div class="status-clear">loading…</div>';
  Promise.all([
    fetch("/api/issues?t=" + Date.now()).then((r) => (r.ok ? r.json() : { issues: [] })).catch(() => ({ issues: [] })),
    fetch("/api/categories?t=" + Date.now()).then((r) => (r.ok ? r.json() : { categories: [] })).catch(() => ({ categories: [] })),
  ]).then(([iss, cat]) => {
    const issues = iss.issues || [];
    const cats = (cat.categories || []).filter((c) => c.key !== "transfer");
    let html = '<div class="src-title">Review · ' + issues.length + "</div>";
    if (!issues.length) { statusPanel.innerHTML = html + '<div class="status-clear">✓ nothing needs you right now</div>'; return; }
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
    statusPanel.innerHTML = html;
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
      setSubPaused(key, true);  // updates SUBS + debounced save
      // persist immediately so the re-fetched issues reflect it, then refresh
      fetch("/api/subs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subs: SUBS }) }).then(refresh).catch(refresh);
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
const serverText = serverBtn ? serverBtn.querySelector(".server-text") : null;
function setServer(state) {
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
    .then((r) => setServer(r.ok ? "live" : "stale"))
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
  PERIOD = p;
  try { localStorage.setItem(PERIOD_KEY, JSON.stringify(p)); } catch (e) {}
  updatePeriodUI();
  Store.refresh();  // new period → one re-pull → ripples to every widget
}
function updatePeriodUI() {
  const lab = periodLabel();
  const txt = document.querySelector("#periodBtn .period-text");
  if (txt) txt.textContent = lab;
  document.querySelectorAll(".w-period").forEach((e) => { e.textContent = lab; });
}
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
  const hidden = new Set(dockList(DOCK_HIDDEN_KEY));
  dock.querySelectorAll(".dock-item").forEach((el) => {
    el.style.display = hidden.has(el.dataset.dock) ? "none" : "";
  });
}
function renderDockMenu() {
  const host = document.getElementById("dockMenu");
  if (!host) return;
  const hidden = new Set(dockList(DOCK_HIDDEN_KEY));
  host.innerHTML = DOCK_DEFS.map((d) => {
    const on = !hidden.has(d.id);
    return '<button class="lib-item' + (on ? " active" : "") + '" data-dt="' + d.id + '">' +
      '<span class="lib-dot"></span><span class="lib-label">' + d.label + '</span>' +
      '<span class="lib-state">' + (on ? "on" : "off") + "</span></button>";
  }).join("");
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
  bar.innerHTML = '<div id="dock" class="dock"><div class="dock-label">dock</div></div>';
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
  // sync lives OUTSIDE the dock, to its right
  const sync = document.getElementById("syncHealth");
  if (sync) bar.appendChild(sync);
  const oldBar = document.querySelector(".status-bar");
  if (oldBar) oldBar.remove();

  applyDockConfig(dock);

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
      if (!S) return { val: "…" };
      return S.covered ? { val: "✓ covered", tone: "ok" } : { val: fmtUSD(S.totalShort), tone: "bad" };
    } },
  { id: "hours", label: "IC hours", fn: (d) => {
      const S = d && planSummary(d, 0);
      if (!S) return { val: "…" };
      return S.covered ? { val: "0 h", tone: "ok" } : { val: S.hrs + " h", tone: "warn" };
    } },
  { id: "rent", label: "Rent", fn: (d) => {
      const S = d && planSummary(d, 0);
      if (!S) return { val: "…" };
      const rt = S.rentTier;
      if (!rt) return { val: "—" };
      if (rt.paid) return { val: "✓ paid", tone: "ok" };
      const short = Math.max(0, rt.amt - rt.funded);
      if (short < 0.5) return { val: "✓ ready", tone: "ok" };
      return { val: fmtUSD(short) + " short", tone: "bad" };
    } },
  { id: "spend", label: "Spend/mo", fn: (d) => ({ val: d && d.spending ? fmtUSD(d.spending.per_month) : "…" }) },
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

// ── Boot ───────────────────────────────────────────────────
Object.keys(layout).forEach((id) => makeAny(id, layout[id]));
renderLibrary();
renderIcons();
setSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
applyZoom();
drawIcons();
applyPrivacy();
updateGreeting();
updateXp();
requestAnimationFrame(reflowBelowStats);  // once the stats bar has measured, clear the top band
loadSubs().then(() => Store.refresh());  // load your decisions first, then pull data → widgets render correct on first paint
