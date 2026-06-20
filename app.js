// ============================================================
//  Money — widget board + sidebar engine. Plain JS, no build.
//
//  • RENDERERS = how each widget TYPE draws itself
//  • LIBRARY   = single-instance widgets you toggle on/off
//  • ICONS     = icon library (Lucide) → click spawns an icon widget
//  • layout    = which widgets are on the board + where/how big (saved)
//
//  Widgets are resizable (drag the bottom-right corner) and their
//  contents scale via CSS container queries.
// ============================================================

const LAYOUT_KEY = "money.layout.v2";
const SIDEBAR_KEY = "money.sidebar";
const NOTE_KEY = "money.note";
const MIN_W = 120, MIN_H = 90;

// ── How each widget type renders ───────────────────────────
const RENDERERS = {
  balance(el) {
    el.innerHTML = '<div><div class="big">—</div><div class="sub">no data yet</div></div>';
  },
  clock(el) {
    const tick = () => {
      const now = new Date();
      el.innerHTML =
        '<div><div class="big">' +
        now.toLocaleTimeString("en-US", { hour12: false }) +
        '</div><div class="sub">' +
        now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) +
        '</div></div>';
    };
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
  icon(el, entry) {
    el.classList.add("is-icon");
    el.innerHTML = '<i data-lucide="' + entry.icon + '"></i>';
    drawIcons();
  },
};

// ── Single-instance widgets (the Widget Library) ───────────
const LIBRARY = [
  { type: "balance", title: "Total balance", w: 320, h: 190 },
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
    // migrate older entries that predate `type`
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

function titleFor(entry) {
  if (entry.type === "icon") return entry.icon;
  return libByType[entry.type] ? libByType[entry.type].title : entry.type;
}

// ── Build a widget on the board ────────────────────────────
function makeWidget(id, entry) {
  const node = document.createElement("section");
  node.className = "widget";
  node.style.left = entry.x + "px";
  node.style.top = entry.y + "px";
  node.style.width = entry.w + "px";
  node.style.height = entry.h + "px";

  const bar = document.createElement("header");
  bar.className = "widget-bar";
  bar.innerHTML =
    '<span class="widget-title">' + titleFor(entry) +
    '</span><button class="widget-close" aria-label="Remove">✕</button>';

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
  bar.querySelector(".widget-close").addEventListener("click", () => removeWidget(id));
  makeDraggable(node, bar, id);
  makeResizable(node, grip, id);
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
function spawnIcon(name) {
  const id = "icon-" + name + "-" + Date.now().toString(36);
  const n = Object.keys(layout).length;
  layout[id] = { type: "icon", icon: name, x: 110 + (n % 8) * 28, y: 110 + (n % 8) * 28, w: 150, h: 150 };
  makeWidget(id, layout[id]);
  saveLayout();
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
    if (e.target.closest(".widget-close")) return;
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

// ── Lucide helper ──────────────────────────────────────────
function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
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
      '</span><span class="lib-state">' + (on ? "on" : "add") + '</span>';
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
    cell.addEventListener("click", () => spawnIcon(name));
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

// ── Sidebar: open / close ──────────────────────────────────
function setSidebar(open) {
  document.body.classList.toggle("sidebar-open", open);
  localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
}
document.getElementById("sidebarToggle").addEventListener("click", () => setSidebar(true));
document.getElementById("sidebarClose").addEventListener("click", () => setSidebar(false));

// ── Menu: reset ────────────────────────────────────────────
document.getElementById("resetLayout").addEventListener("click", () => {
  localStorage.removeItem(LAYOUT_KEY);
  location.reload();
});

// ── Boot ───────────────────────────────────────────────────
Object.keys(layout).forEach((id) => {
  if (RENDERERS[layout[id].type]) makeWidget(id, layout[id]);
});
renderLibrary();
renderIcons();
setSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
drawIcons();
