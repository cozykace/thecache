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

const fmtUSD = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// soft, pleasing palette assigned per-account
const ACCT_COLORS = ["#c9542e", "#2e7dc9", "#3f8f4e", "#6a4bc4", "#d6920f", "#1fa6a6", "#bf6ba5", "#8a8f2e"];
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// spending category labels + colors
const CAT_META = {
  housing: { label: "Housing", color: "#c9542e" },
  groceries: { label: "Groceries", color: "#3f8f4e" },
  dining: { label: "Dining", color: "#d6920f" },
  transport: { label: "Transport", color: "#2e7dc9" },
  shopping: { label: "Shopping", color: "#bf6ba5" },
  subscriptions: { label: "Subscriptions", color: "#6a4bc4" },
  bills: { label: "Bills", color: "#1fa6a6" },
  health: { label: "Health", color: "#4ec9a5" },
  entertainment: { label: "Fun", color: "#e0734a" },
  music_art: { label: "Music & Art", color: "#bf2e86" },
  fees: { label: "Fees", color: "#9a5b3a" },
  transfer: { label: "Transfers", color: "#8a8f73" },
  other: { label: "Other", color: "#8c8470" },
};
const DRAG_IGNORE = ".widget-close,.widget-toggle,.sticker-close,.widget-resize,.sticker-resize";

// ── How each widget type renders ───────────────────────────
const RENDERERS = {
  balance(el) {
    el.classList.add("is-balance");
    el.innerHTML =
      '<div class="bal-head">' +
        '<div class="big">…</div>' +
        '<div class="sub">syncing…</div>' +
        '<button class="bal-skull" aria-label="Show accounts"><i data-lucide="skull"></i></button>' +
      '</div>' +
      '<div class="bal-accounts"><div class="bal-accounts-inner"></div></div>';
    drawIcons();
    const head = el.querySelector(".bal-head");
    const big = el.querySelector(".big");
    const sub = el.querySelector(".sub");
    const list = el.querySelector(".bal-accounts-inner");
    const toggle = () => el.classList.toggle("expanded");
    head.addEventListener("click", toggle);
    el.querySelector(".bal-skull").addEventListener("click", (e) => { e.stopPropagation(); toggle(); });

    // read the local file written by sync.py (cache-busted so refresh is instant)
    fetch("data/balances.json?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then((d) => {
        big.textContent = fmtUSD(d.total || 0);
        const when = d.updated ? new Date(d.updated) : null;
        const stamp = when
          ? "as of " + when.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
            " " + when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "synced";
        sub.textContent = stamp;
        list.innerHTML = (d.accounts || [])
          .map((a, i) =>
            '<div class="acct" style="--i:' + i + '">' +
              '<span class="acct-dot" style="background:' + ACCT_COLORS[i % ACCT_COLORS.length] + '"></span>' +
              '<span class="acct-name">' + escapeHtml(a.name || "Account") + '</span>' +
              '<span class="acct-bal">' + fmtUSD(a.balance || 0) + '</span>' +
            '</div>'
          )
          .join("");
      })
      .catch(() => {
        big.textContent = "—";
        sub.textContent = "no data · run sync";
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

    fetch("data/balances.json?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then((d) => { data = d; draw(); })
      .catch(() => { big.textContent = "—"; runwayEl.textContent = "no data · run sync"; });
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

    function load() {
      fetch("data/balances.json?t=" + Date.now())
        .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
        .then((d) => {
          const sp = d.spending;
          if (!sp || !sp.categories || !sp.categories.length) {
            avg.textContent = "—"; sub.textContent = "not enough spending history"; list.innerHTML = ""; return;
          }
          avg.textContent = fmtUSD(sp.per_month) + " /mo";
          sub.textContent = "last " + sp.window_days + " days · " + fmtUSD(sp.per_day) + "/day";
          if (sp.trend_pct !== null && sp.trend_pct !== undefined) {
            const up = sp.trend_pct > 0;
            trendEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(sp.trend_pct) + "% vs prior";
            trendEl.style.color = up ? "#c9542e" : "#3f8f4e";
          } else { trendEl.textContent = ""; }
          const rows = sp.categories.slice(0, 7);
          const max = rows[0].amount || 1;
          list.innerHTML = rows.map((c) => {
            const m = CAT_META[c.key] || CAT_META.other;
            return '<div class="bd-row">' +
              '<span class="bd-cat">' + m.label + '</span>' +
              '<span class="bd-track"><span class="bd-fill" style="background:' + m.color + ';width:0"></span></span>' +
              '<span class="bd-amt">' + fmtUSD(c.amount) + '</span>' +
            '</div>';
          }).join("");
          const fills = list.querySelectorAll(".bd-fill");
          requestAnimationFrame(() =>
            fills.forEach((f, i) => { f.style.width = Math.max(4, (rows[i].amount / max) * 100) + "%"; }));
        })
        .catch(() => { avg.textContent = "—"; sub.textContent = "no data · run sync"; });
    }

    el.querySelector(".bd-fix").addEventListener("click", () => openCategorizer(load));
    load();
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
function openCategorizer(onDone) {
  closeCategorizer();
  const back = document.createElement("div");
  back.className = "cat-backdrop";
  back.id = "catBackdrop";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closeCategorizer(onDone); });

  const modal = document.createElement("div");
  modal.className = "cat-modal";
  modal.innerHTML =
    '<div class="cat-head"><span>Fix categories</span><button class="cat-close" aria-label="Close">✕</button></div>' +
    '<div class="cat-hint">your biggest uncategorized charges — pick a category and it sticks</div>' +
    '<div class="cat-list">loading…</div>';
  document.body.appendChild(back);
  document.body.appendChild(modal);
  modal.querySelector(".cat-close").addEventListener("click", () => closeCategorizer(onDone));

  const listEl = modal.querySelector(".cat-list");
  const opts = Object.keys(CAT_META)
    .filter((k) => k !== "other" && k !== "transfer")
    .map((k) => '<option value="' + k + '">' + CAT_META[k].label + '</option>')
    .join("");

  fetch("/api/other-merchants")
    .then((r) => r.json())
    .then((d) => {
      const ms = d.merchants || [];
      if (!ms.length) { listEl.innerHTML = '<div class="cat-empty">nothing left uncategorized 🎉</div>'; return; }
      listEl.innerHTML = ms.map((m) =>
        '<div class="cat-row">' +
          '<span class="cat-merch" title="' + escapeHtml(m.merchant) + '">' + escapeHtml(m.merchant) + '</span>' +
          '<span class="cat-amt">' + fmtUSD(m.amount) + '</span>' +
          '<select class="cat-select"><option value="">—</option>' + opts + '</select>' +
        '</div>').join("");
      listEl.querySelectorAll(".cat-row").forEach((row, i) => {
        row.querySelector(".cat-select").addEventListener("change", (e) => {
          if (!e.target.value) return;
          fetch("/api/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ merchant: ms[i].key, category: e.target.value }),
          }).then(() => row.classList.add("done"));
        });
      });
    })
    .catch(() => {
      listEl.innerHTML = '<div class="cat-empty">backend not running — start it with <b>python3 server.py</b></div>';
    });
}

// ── Single-instance widgets (the Widget Library) ───────────
const LIBRARY = [
  { type: "balance", title: "Total balance", w: 320, h: 190 },
  { type: "safe", title: "Safe to spend", w: 300, h: 220 },
  { type: "breakdown", title: "Where it’s going", w: 300, h: 280 },
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
const board = document.getElementById("board");
let layout = loadLayout();
const nodes = {};
let zTop = 10;
let stickerSeq = 0;

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

  const bar = document.createElement("header");
  bar.className = "widget-bar";
  bar.innerHTML =
    '<span class="bar-left">' +
    '<span class="bar-ico">' + (entry.barIcon ? '<i data-lucide="' + entry.barIcon + '"></i>' : "") + "</span>" +
    '<span class="widget-title">' + titleFor(entry) + "</span>" +
    "</span>" +
    '<span class="bar-right">' +
    '<button class="widget-toggle" title="Hide / show frame" aria-label="Toggle frame"><span class="toggle-dot"></span></button>' +
    '<button class="widget-close" aria-label="Remove">✕</button>' +
    "</span>";

  const body = document.createElement("div");
  body.className = "widget-body";
  const grip = document.createElement("div");
  grip.className = "widget-resize";

  node.appendChild(bar);
  node.appendChild(body);
  node.appendChild(grip);
  board.appendChild(node);
  nodes[id] = node;

  RENDERERS[entry.type](body, entry);
  drawIcons();
  bar.querySelector(".widget-close").addEventListener("click", () => removeWidget(id));
  bar.querySelector(".widget-toggle").addEventListener("click", () => {
    entry.bare = !entry.bare;
    node.classList.toggle("bare", entry.bare);
    saveLayout();
  });
  makeDraggable(node, bar, id);
  makeResizable(node, grip, id);
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
  board.appendChild(node);
  nodes[id] = node;
  drawIcons();

  node.querySelector(".sticker-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removeWidget(id);
  });
  makeDraggable(node, node, id);
  makeResizable(node, node.querySelector(".sticker-resize"), id);
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
  layout[type] = { type, x: 90 + n * 26, y: 90 + n * 26, w: def.w, h: def.h };
  makeWidget(type, layout[type]);
  saveLayout();
  renderLibrary();
}
function placeSticker(name, x, y) {
  const id = "sticker-" + name + "-" + stickerSeq++;
  layout[id] = { type: "sticker", icon: name, x: Math.round(x), y: Math.round(y), w: 110, h: 110 };
  makeSticker(id, layout[id]);
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
    let nx = Math.max(60 - node.offsetWidth, Math.min(window.innerWidth - 60, ox + e.clientX - sx));
    let ny = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
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
function makeResizable(node, grip, id) {
  let sx = 0, sy = 0, sw = 0, sh = 0, sizing = false;
  grip.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    sizing = true;
    grip.setPointerCapture(e.pointerId);
    node.style.zIndex = ++zTop;
    sx = e.clientX; sy = e.clientY;
    sw = node.offsetWidth; sh = node.offsetHeight;
  });
  grip.addEventListener("pointermove", (e) => {
    if (!sizing) return;
    node.style.width = Math.max(MIN_W, sw + e.clientX - sx) + "px";
    node.style.height = Math.max(MIN_H, sh + e.clientY - sy) + "px";
  });
  const end = () => {
    if (!sizing) return;
    sizing = false;
    layout[id].w = node.offsetWidth;
    layout[id].h = node.offsetHeight;
    saveLayout();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
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
      // a plain click → drop a sticker in the middle
      placeSticker(name, window.innerWidth / 2 - 55, window.innerHeight / 2 - 55);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.closest(".sidebar")) return; // dropped back on the panel → cancel
    const widget = el ? el.closest(".widget") : null;
    if (widget) showDropMenu(e.clientX, e.clientY, name, widget.dataset.id);
    else placeSticker(name, e.clientX - 55, e.clientY - 55);
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
  sticker.addEventListener("click", () => { placeSticker(name, x - 55, y - 55); closeDropMenu(); });

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

// ── Sidebar open / close ───────────────────────────────────
function setSidebar(open) {
  document.body.classList.toggle("sidebar-open", open);
  localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
}
document.getElementById("sidebarToggle").addEventListener("click", () => setSidebar(true));
document.getElementById("sidebarClose").addEventListener("click", () => setSidebar(false));

// ── Theme (color profiles) ─────────────────────────────────
const THEME_KEY = "money.theme";
const THEMES = [
  { id: "light", label: "Paper", bg: "#ece6d6", accent: "#c9542e" },
  { id: "dark", label: "Ink", bg: "#14130e", accent: "#e0734a" },
  { id: "terminal", label: "Phosphor", bg: "#0c0f0a", accent: "#8fe388" },
  { id: "blueprint", label: "Blueprint", bg: "#0e1830", accent: "#6aa6ff" },
  { id: "mist", label: "Mist", bg: "#e8ecf0", accent: "#4a6da7" },
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

// ── Menu: reset ────────────────────────────────────────────
document.getElementById("resetLayout").addEventListener("click", () => {
  localStorage.removeItem(LAYOUT_KEY);
  location.reload();
});

// ── Boot ───────────────────────────────────────────────────
Object.keys(layout).forEach((id) => makeAny(id, layout[id]));
renderLibrary();
renderIcons();
setSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
drawIcons();
