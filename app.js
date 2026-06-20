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
const MIN_W = 90, MIN_H = 70;
const DRAG_IGNORE = ".widget-close,.widget-toggle,.sticker-close,.widget-resize,.sticker-resize";

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
