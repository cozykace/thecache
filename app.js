// ============================================================
//  Money — widget board + sidebar engine. Plain JS, no build.
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

// strip bank noise so labels read like a person ("Electronic Deposit John Page" → "John Page")
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
  if (/john page|jpg|music|guitar|band|gig|royalt|spotify|bandcamp|distrokid|tunecore|ascap|bmi/.test(s))
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

// per-subscription core/flex — which recurring subs are non-negotiable (local)
const SUBCORE_KEY = "money.subcore";
function subCoreMap() {
  try { return JSON.parse(localStorage.getItem(SUBCORE_KEY) || "{}"); } catch (e) { return {}; }
}
function isSubCore(key) { return subCoreMap()[key] === 1; }
function setSubCore(key, val) {
  const m = subCoreMap();
  m[key] = val ? 1 : 0;
  localStorage.setItem(SUBCORE_KEY, JSON.stringify(m));
}
// manual "paused" flag — you marking a subscription inactive so the data stays honest
const SUBPAUSE_KEY = "money.subpaused";
function subPausedMap() { try { return JSON.parse(localStorage.getItem(SUBPAUSE_KEY) || "{}"); } catch (e) { return {}; } }
function isSubPaused(key) { return subPausedMap()[key] === 1; }
function setSubPaused(key, val) {
  const m = subPausedMap(); m[key] = val ? 1 : 0;
  localStorage.setItem(SUBPAUSE_KEY, JSON.stringify(m));
}
// active = charged within ~40 days (from the ledger's last-seen date)
function subState(r) {
  if (isSubPaused(r.key)) return "paused";
  const days = r.last ? (Date.now() / 1000 - r.last) / 86400 : 999;
  return days > 40 ? "lapsed" : "active";
}
// per-subscription display alias — a label only; never changes what data it's tied to
const SUBNAMES_KEY = "money.subnames";
function subNames() {
  try { return JSON.parse(localStorage.getItem(SUBNAMES_KEY) || "{}"); } catch (e) { return {}; }
}
function subName(item) {
  if (!item) return "";
  return subNames()[item.key] || item.name || "";
}
function setSubName(key, alias) {
  const m = subNames();
  if (alias && alias.trim()) m[key] = alias.trim(); else delete m[key];
  localStorage.setItem(SUBNAMES_KEY, JSON.stringify(m));
}

// Typical Instacart busy windows (general demand patterns, not your market).
const INSTACART_WINDOWS = [
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
    INSTACART_WINDOWS.forEach((w) => {
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
const DRAG_IGNORE = ".widget-close,.widget-toggle,.widget-magnet,.sticker-close,.widget-resize,.sticker-resize";

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
      const income = (data.income && data.income.per_month) || 0;
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
      const income = (data.income && data.income.per_month) || 0;
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
      detail.innerHTML = "to make <b>" + fmtUSD(gap) + "</b> on Instacart<br>" +
        "≈ " + shifts + " shift" + (shifts > 1 ? "s" : "") + " of ~" + Math.round(hoursWk / shifts) + "h a week";
    }
    rateBtn.addEventListener("click", () => {
      const v = prompt("Your Instacart $/hour (after gas/expenses)?", String(rateOf()));
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
          row("Instacart", fmtUSD(a.instacart) + "/mo") +
          row("Subscriptions", fmtUSD(a.subscriptions) + "/mo") +
          row("Spend / day", fmtUSD(a.per_day));
      }).catch(() => { big.textContent = "—"; sub.textContent = "no data · run sync"; list.innerHTML = ""; });
    }
    Store.subscribe(el, () => load());
    load();
  },
  subscriptions(el) {
    el.classList.add("is-breakdown");
    el.innerHTML =
      '<div class="bd-head">' +
        '<div class="bd-top"><span class="fc-label">subscriptions</span><button class="sub-add" type="button" title="add a subscription by name">+ add</button></div>' +
        '<div class="big bd-avg">…</div>' +
        '<div class="fc-sub cf-sub"></div>' +
      '</div>' +
      '<div class="bd-list cf-list"></div>' +
      '<div class="sub-detected"></div>' +
      '<button class="bd-fix" type="button">⚙ fix categories</button>';
    const big = el.querySelector(".bd-avg");
    const sub = el.querySelector(".cf-sub");
    const list = el.querySelector(".cf-list");
    const detEl = el.querySelector(".sub-detected");
    let detected = [];
    function loadDetected() {
      fetch("/api/recurring?t=" + Date.now()).then((r) => r.json())
        .then((d) => { detected = d.recurring || []; render(); }).catch(() => {});
    }
    function trackKey(key) {
      fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: key, category: "subscriptions" }) })
        .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
        .then(() => { flash("✓ now tracking as a subscription"); loadDetected(); Store.refresh(); })
        .catch(() => flash("couldn't save — backend down?"));
    }
    function untrackKey(key) {
      fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: key, category: "other" }) })
        .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
        .then(() => { flash("removed from subscriptions"); loadDetected(); Store.refresh(); })
        .catch(() => flash("couldn't save — backend down?"));
    }
    // the whole widget is driven by all-time recurrence detection, so a tracked
    // item just moves up to the tracked list — it never disappears. Active/lapsed
    // is read from the ledger; you can pause one by hand to keep the data honest.
    function render() {
      const tracked = detected.filter((r) => r.tagged);
      const untracked = detected.filter((r) => !r.tagged);
      const active = tracked.filter((r) => !isSubPaused(r.key));
      if (!tracked.length) {
        big.textContent = detected.length ? "—" : "…";
        sub.textContent = untracked.length ? "tag the " + untracked.length + " detected below ↓"
          : (detected.length ? "none tracked yet" : "scanning for recurring charges…");
      } else {
        let core = 0, flex = 0, total = 0;
        active.forEach((r) => { total += r.amount; if (isSubCore(r.key)) core += r.amount; else flex += r.amount; });
        big.textContent = fmtUSD(total) + " /mo";
        const lapsed = tracked.filter((r) => subState(r) === "lapsed").length;
        sub.innerHTML = "<b style=\"color:#3f8f4e\">" + fmtUSD(core) + "</b> core · " +
          "<b style=\"color:#c9542e\">" + fmtUSD(flex) + "</b> flex" +
          (lapsed ? ' · <b style="color:#d6920f">' + lapsed + " lapsed</b>" : "");
      }
      list.innerHTML = tracked.map((r) => {
        const on = isSubCore(r.key);
        const st = subState(r);
        const nm = subName(r);
        const ago = r.last ? Math.round(Date.now() / 1000 / 86400 - r.last / 86400) : null;
        const tip = st === "paused" ? "paused — click to reactivate"
          : st === "lapsed" ? "no charge in " + ago + "d — click to pause" : "active · last charge " + ago + "d ago";
        return '<div class="cf-row sub-row ' + st + '">' +
          '<button class="sub-pip ' + st + '" data-key="' + escapeHtml(r.key) + '" title="' + tip + '"></button>' +
          '<button class="cf-cat sub-name" data-key="' + escapeHtml(r.key) +
            '" title="' + escapeHtml(nm) + ' — details">' + escapeHtml(nm) + "</button>" +
          '<span class="cf-amt">' + fmtUSD(r.amount) + "/mo</span>" +
          '<button class="cf-toggle ' + (on ? "is-core" : "is-flex") + '" data-key="' + escapeHtml(r.key) + '">' +
          (on ? "core" : "flex") + "</button>" +
          '<button class="sub-x" data-key="' + escapeHtml(r.key) + '" title="not a subscription / remove">×</button>' +
        "</div>";
      }).join("");
      list.querySelectorAll(".sub-pip").forEach((b) => b.addEventListener("click", () => {
        setSubPaused(b.dataset.key, !isSubPaused(b.dataset.key)); Store.emit();
      }));
      list.querySelectorAll(".cf-toggle").forEach((b) => b.addEventListener("click", () => {
        setSubCore(b.dataset.key, !isSubCore(b.dataset.key));
        Store.emit();  // core subs feed The Gap's need → ripple
      }));
      list.querySelectorAll(".sub-x").forEach((b) => b.addEventListener("click", () => {
        if (confirm("Remove this from your subscriptions?")) untrackKey(b.dataset.key);
      }));
      list.querySelectorAll(".sub-name").forEach((b) => b.addEventListener("click", () =>
        openSubDetail(tracked.find((x) => x.key === b.dataset.key), () => Store.emit())));
      if (!untracked.length) { detEl.innerHTML = ""; } else {
        detEl.innerHTML = '<div class="sub-det-h">detected · not tracked yet (' + untracked.length + ")</div>" +
          untracked.map((r) =>
            '<div class="cf-row sub-det-row">' +
              '<span class="cf-cat" title="' + escapeHtml((r.descriptions || [])[0] || r.name) + '">' + escapeHtml(r.name) + "</span>" +
              '<span class="cf-amt">' + fmtUSD(r.amount) + "/mo</span>" +
              '<button class="sub-track" data-key="' + escapeHtml(r.key) + '">+ track</button>' +
            "</div>").join("");
        detEl.querySelectorAll(".sub-track").forEach((b) => b.addEventListener("click", () => trackKey(b.dataset.key)));
      }
    }
    Store.subscribe(el, () => render());  // re-render on ripple (core toggles, etc.)
    el.querySelector(".bd-fix").addEventListener("click", () => openCategorizer(() => Store.refresh()));
    el.querySelector(".sub-add").addEventListener("click", () => {
      const v = prompt("Add a subscription — type the merchant as it reads on your statement (e.g. netflix, spotify). It links to any transaction containing that text.");
      if (v && v.trim()) trackKey(v.trim().toLowerCase());
    });
    loadDetected();
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
function setProfile(p) { localStorage.setItem("money.profile", JSON.stringify(p)); updateGreeting(); }
function updateGreeting() {
  const g = document.getElementById("greeting");
  if (!g) return;
  const p = getProfile();
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  g.textContent = p.name ? "good " + part + ", " + p.name : "";
  g.style.display = p.name ? "" : "none";
}
function applyPrivacy() {
  document.body.classList.toggle("privacy-on", localStorage.getItem("money.privacy") === "1");
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
      '<div class="set-sec">Money targets</div>' +
      '<label class="set-row"><span>Reserve (don’t-touch)</span><input id="setReserve" type="number" value="' + v("money.reserve") + '" placeholder="0"></label>' +
      '<label class="set-row"><span>Monthly need</span><input id="setNeed" type="number" value="' + v("money.need") + '" placeholder="auto from core"></label>' +
      '<label class="set-row"><span>Work rate $/hr</span><input id="setRate" type="number" value="' + v("money.rate") + '" placeholder="25"></label>' +
      '<div class="set-hint">these feed Safe-to-spend, The Gap and the Work planner</div>' +
      '<div class="set-sec">Display</div>' +
      '<button class="set-toggle" id="setPrivacy"><span>Privacy blur</span><span class="set-state">off</span></button>' +
      '<div class="set-hint">blurs dollar amounts until you hover — good for screen-sharing</div>' +
      '<div class="set-themes" id="setThemes"></div>' +
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
  bind("#setReserve", "money.reserve"); bind("#setNeed", "money.need"); bind("#setRate", "money.rate");

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

  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const th = modal.querySelector("#setThemes");
  th.innerHTML = THEMES.map((t) =>
    '<button class="theme-swatch' + (t.id === cur ? " active" : "") + '" data-id="' + t.id +
    '" title="' + t.label + '" style="background:' + t.bg + ';border-color:' + t.accent + '"></button>').join("");
  th.querySelectorAll(".theme-swatch").forEach((sw) => sw.addEventListener("click", () => {
    applyTheme(sw.dataset.id);
    th.querySelectorAll(".theme-swatch").forEach((s) => s.classList.toggle("active", s === sw));
  }));
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
  { type: "gap", title: "The gap", w: 300, h: 230 },
  { type: "coreflex", title: "Core vs flex", w: 300, h: 300 },
  { type: "subscriptions", title: "Subscriptions", w: 300, h: 300 },
  { type: "work", title: "Work planner", w: 300, h: 210 },
  { type: "averages", title: "Averages", w: 300, h: 260 },
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
function makeWidget(id, entry) {
  const node = document.createElement("section");
  node.className = "widget" + (entry.bare ? " bare" : "");
  node.dataset.id = id;
  node.style.left = entry.x + "px";
  node.style.top = entry.y + "px";
  node.style.width = entry.w + "px";
  node.style.height = entry.h + "px";
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
    '<button class="widget-magnet' + (entry.snap ? " on" : "") +
      '" title="Snap to grid" aria-label="Toggle snap"><i data-lucide="magnet"></i></button>' +
    '<button class="widget-toggle" title="Hide / show frame" aria-label="Toggle frame"><span class="toggle-dot"></span></button>' +
    '<button class="widget-close" aria-label="Remove">✕</button>' +
    "</span>";

  const body = document.createElement("div");
  body.className = "widget-body";

  node.appendChild(bar);
  node.appendChild(body);
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
  node.style.left = entry.x + "px";
  node.style.top = entry.y + "px";
  node.style.width = entry.w + "px";
  node.style.height = entry.h + "px";
  node.innerHTML =
    '<i data-lucide="' + entry.icon + '"></i>' +
    '<button class="sticker-close" aria-label="Remove">✕</button>' +
    '<div class="sticker-resize"></div>';
  canvas.appendChild(node);
  nodes[id] = node;
  drawIcons();

  node.querySelector(".sticker-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removeWidget(id);
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
    drag = true;
    handle.setPointerCapture(e.pointerId);
    node.style.zIndex = ++zTop;
    node.classList.add("dragging");
    sx = e.clientX; sy = e.clientY;
    ox = parseInt(node.style.left, 10); oy = parseInt(node.style.top, 10);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    let nx = ox + (e.clientX - sx) / boardZoom;
    let ny = oy + (e.clientY - sy) / boardZoom;
    nx = Math.max(0, Math.min(CANVAS_W - 40, nx));
    ny = Math.max(0, Math.min(CANVAS_H - 40, ny));
    if (layout[id] && layout[id].snap) { nx = snapTo(nx); ny = snapTo(ny); }
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
    sidebar.style.width = clamp(sw + (e.clientX - sx)) + "px";
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
  { id: "light", label: "Paper", bg: "#ece6d6", accent: "#c9542e" },
  { id: "dark", label: "Ink", bg: "#14130e", accent: "#e0734a" },
  { id: "terminal", label: "Phosphor", bg: "#0c0f0a", accent: "#8fe388" },
  { id: "blueprint", label: "Blueprint", bg: "#0e1830", accent: "#6aa6ff" },
  { id: "mist", label: "Mist", bg: "#e8ecf0", accent: "#4a6da7" },
  { id: "vapor", label: "Vapor", bg: "#1a0e2e", accent: "#ff4fd8" },
  { id: "acid", label: "Acid", bg: "#0a0a06", accent: "#aaff2b" },
  { id: "ember", label: "Ember", bg: "#1a0c08", accent: "#ff5a36" },
];
const themeBtn = document.getElementById("themeToggle");

function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = "light";
  document.documentElement.setAttribute("data-theme", id);
  localStorage.setItem(THEME_KEY, id);
  themeBtn.innerHTML = '<i data-lucide="palette"></i>';
  drawIcons();
  document.querySelectorAll(".theme-swatch").forEach((s) =>
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
  THEMES.forEach((t) => {
    const sw = document.createElement("button");
    sw.className = "theme-swatch" + (t.id === cur ? " active" : "");
    sw.dataset.id = t.id;
    sw.title = t.label;
    sw.style.background = t.bg;
    sw.innerHTML = '<span class="dot" style="background:' + t.accent + '"></span>';
    sw.addEventListener("click", () => { applyTheme(t.id); closeThemePop(); });
    pop.appendChild(sw);
  });
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
      html += '<div class="src-foot">last synced ' + when + '</div>';
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

// tidy: snap everything into a clean left-to-right grid
function tidyLayout() {
  const pad = 16, startX = 32, startY = 86;
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

// ── Bug reports (logged to data/bugs.json) ─────────────────
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
    '<div class="cat-head"><span>Bug reports</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="bug-new">' +
      '<textarea class="bug-input" placeholder="What’s broken or weird? It gets logged locally."></textarea>' +
      '<button class="bug-submit" type="button">Log it</button>' +
    "</div>" +
    '<div class="cat-list bug-list">loading…</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", closeBugReport);
  const listEl = modal.querySelector(".bug-list");
  const input = modal.querySelector(".bug-input");
  function load() {
    fetch("/api/bugs?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("stale"); return r.json(); })
      .then((d) => renderBugList(listEl, d.bugs || []))
      .catch(() => { listEl.innerHTML = '<div class="cat-empty">backend stopped or out of date — restart it (double-click <b>start.command</b>)</div>'; });
  }
  modal.querySelector(".bug-submit").addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) return;
    bugPost("/api/bug", { text })
      .then((d) => { input.value = ""; renderBugList(listEl, d.bugs); })
      .catch(() => flash("backend stopped or out of date — restart it (start.command)"));
  });
  input.focus();
  load();
}
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
  // mirror live status on the brand dot next to the SUFFERING GOAT title
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
const PERIOD_WIDGETS = new Set(["breakdown", "income", "gap", "work", "coreflex", "subscriptions"]);
let PERIOD = (function () {
  try { return JSON.parse(localStorage.getItem(PERIOD_KEY)) || { kind: "mtd" }; }
  catch (e) { return { kind: "mtd" }; }
})();
function periodQS() {
  return "kind=" + encodeURIComponent(PERIOD.kind) + (PERIOD.ym ? "&ym=" + encodeURIComponent(PERIOD.ym) : "");
}
function periodLabel() {
  if (PERIOD.kind === "30d") return "Last 30 days";
  if (PERIOD.kind === "90d") return "Last 90 days";
  if (PERIOD.kind === "all") return "All time";
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
    return fetch("/api/summary?" + periodQS() + "&t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("backend"); return r.json(); })
      .then((d) => {
        if (d.catmeta && d.catmeta.labels) CAT_LABELS = d.catmeta.labels;  // renames ripple to every widget
        this.data = d; this.ready = true; this.emit(); return d;
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
  menu.innerHTML =
    '<div class="pm-group">' +
    presets.map((o) =>
      '<button class="pm-item' + (PERIOD.kind === o.kind ? " active" : "") +
      '" data-kind="' + o.kind + '">' + o.label + "</button>").join("") +
    '</div><div class="pm-label">jump to a month</div>' +
    '<div class="pm-group pm-months">loading…</div>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.bottom = (window.innerHeight - r.top + 8) + "px";
  menu.querySelectorAll(".pm-item[data-kind]").forEach((b) =>
    b.addEventListener("click", () => { setPeriod({ kind: b.dataset.kind }); closePeriodMenu(); }));
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
(function buildDock() {
  const bar = document.createElement("div");
  bar.className = "dock-bar";
  bar.innerHTML = '<div id="dock" class="dock"><div class="dock-label">dock</div></div>';
  document.body.appendChild(bar);
  const dock = bar.querySelector("#dock");

  // date / time item
  const dt = document.createElement("button");
  dt.id = "datetimeBtn"; dt.className = "status-pill"; dt.title = "date & time";
  dt.innerHTML = '<span class="dt-time">–</span><span class="dt-date">–</span>';
  const tickDt = () => {
    const n = new Date();
    dt.querySelector(".dt-time").textContent = n.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    dt.querySelector(".dt-date").textContent = n.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  tickDt(); setInterval(tickDt, 1000);

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

// ── Boot ───────────────────────────────────────────────────
Object.keys(layout).forEach((id) => makeAny(id, layout[id]));
renderLibrary();
renderIcons();
setSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
applyZoom();
drawIcons();
applyPrivacy();
updateGreeting();
Store.refresh();  // single source of truth: one pull populates every subscribed widget
