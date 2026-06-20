// ============================================================
//  Money — widget board + sidebar engine. Plain JS, no build.
//
//  • WIDGETS  = the catalog (what can go on the board)
//  • layout   = which widgets are ON the board + where (saved)
//  • Sidebar  = library (add/remove widgets) + menu
//
//  TO ADD A WIDGET TYPE: add an entry to WIDGETS with an id,
//  title, default size, and render(el) that fills its body.
// ============================================================

const LAYOUT_KEY = "money.layout.v2";
const SIDEBAR_KEY = "money.sidebar";
const NOTE_KEY = "money.note";

// ── Widget catalog ─────────────────────────────────────────
const WIDGETS = [
  {
    id: "balance",
    title: "Total balance",
    w: 320,
    h: 190,
    render(el) {
      el.innerHTML =
        '<div><div class="big">—</div>' +
        '<div class="sub">no data yet</div></div>';
    },
  },
  {
    id: "clock",
    title: "Local time",
    w: 260,
    h: 160,
    render(el) {
      const tick = () => {
        const now = new Date();
        el.innerHTML =
          '<div><div class="big">' +
          now.toLocaleTimeString("en-US", { hour12: false }) +
          '</div><div class="sub">' +
          now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          }) +
          '</div></div>';
      };
      tick();
      setInterval(tick, 1000);
    },
  },
  {
    id: "date",
    title: "Today",
    w: 240,
    h: 150,
    render(el) {
      const now = new Date();
      el.innerHTML =
        '<div><div class="big">' +
        now.getDate() +
        '</div><div class="sub">' +
        now.toLocaleDateString("en-US", { month: "long" }) +
        '</div></div>';
    },
  },
  {
    id: "note",
    title: "Note",
    w: 280,
    h: 200,
    render(el) {
      const note = document.createElement("div");
      note.className = "note-edit";
      note.contentEditable = "true";
      note.textContent = localStorage.getItem(NOTE_KEY) || "";
      note.addEventListener("input", () => {
        localStorage.setItem(NOTE_KEY, note.textContent);
      });
      el.style.placeItems = "stretch";
      el.appendChild(note);
    },
  },
];

const catalog = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

// ── Layout (presence + positions, persisted) ───────────────
function defaultLayout() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return {
    balance: { x: Math.round(cx - 334), y: Math.round(cy - 95), w: 320, h: 190 },
    clock: { x: Math.round(cx + 14), y: Math.round(cy - 80), w: 260, h: 160 },
  };
}
function loadLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    return saved ? JSON.parse(saved) : defaultLayout();
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
const nodes = {}; // id -> DOM node
let zTop = 10;

// ── Build one widget on the board ──────────────────────────
function makeWidget(def, pos) {
  const node = document.createElement("section");
  node.className = "widget";
  node.style.left = pos.x + "px";
  node.style.top = pos.y + "px";
  node.style.width = (pos.w || def.w) + "px";
  node.style.height = (pos.h || def.h) + "px";

  const bar = document.createElement("header");
  bar.className = "widget-bar";
  bar.innerHTML =
    '<span class="widget-title">' +
    def.title +
    '</span><button class="widget-close" aria-label="Remove">✕</button>';

  const body = document.createElement("div");
  body.className = "widget-body";

  node.appendChild(bar);
  node.appendChild(body);
  board.appendChild(node);
  nodes[def.id] = node;

  def.render(body);
  bar.querySelector(".widget-close").addEventListener("click", () =>
    removeWidget(def.id)
  );
  makeDraggable(node, bar, def.id);
}

// ── Add / remove from the board ────────────────────────────
function addWidget(id) {
  if (layout[id]) {
    // already on board — bring it to front
    if (nodes[id]) nodes[id].style.zIndex = ++zTop;
    return;
  }
  const def = catalog[id];
  const n = Object.keys(layout).length;
  layout[id] = {
    x: 90 + n * 26,
    y: 90 + n * 26,
    w: def.w,
    h: def.h,
  };
  makeWidget(def, layout[id]);
  saveLayout();
  renderLibrary();
}
function removeWidget(id) {
  if (nodes[id]) {
    nodes[id].remove();
    delete nodes[id];
  }
  delete layout[id];
  saveLayout();
  renderLibrary();
}

// ── Drag to place ──────────────────────────────────────────
function makeDraggable(node, handle, id) {
  let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;

  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".widget-close")) return; // let the ✕ do its job
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    node.style.zIndex = ++zTop;
    node.classList.add("dragging");
    startX = e.clientX;
    startY = e.clientY;
    originX = parseInt(node.style.left, 10);
    originY = parseInt(node.style.top, 10);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    let nx = originX + (e.clientX - startX);
    let ny = originY + (e.clientY - startY);
    nx = Math.max(60 - node.offsetWidth, Math.min(window.innerWidth - 60, nx));
    ny = Math.max(0, Math.min(window.innerHeight - 40, ny));
    node.style.left = nx + "px";
    node.style.top = ny + "px";
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    node.classList.remove("dragging");
    layout[id] = {
      x: parseInt(node.style.left, 10),
      y: parseInt(node.style.top, 10),
      w: node.offsetWidth,
      h: node.offsetHeight,
    };
    saveLayout();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ── Sidebar: widget library ────────────────────────────────
const library = document.getElementById("library");
function renderLibrary() {
  library.innerHTML = "";
  WIDGETS.forEach((def) => {
    const on = !!layout[def.id];
    const item = document.createElement("button");
    item.className = "lib-item" + (on ? " active" : "");
    item.innerHTML =
      '<span class="lib-dot"></span>' +
      '<span class="lib-label">' + def.title + '</span>' +
      '<span class="lib-state">' + (on ? "on" : "add") + '</span>';
    item.addEventListener("click", () =>
      on ? removeWidget(def.id) : addWidget(def.id)
    );
    library.appendChild(item);
  });
}

// ── Sidebar: open / close ──────────────────────────────────
const toggle = document.getElementById("sidebarToggle");
const closeBtn = document.getElementById("sidebarClose");
function setSidebar(open) {
  document.body.classList.toggle("sidebar-open", open);
  localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
}
toggle.addEventListener("click", () => setSidebar(true));
closeBtn.addEventListener("click", () => setSidebar(false));

// ── Menu: reset layout ─────────────────────────────────────
document.getElementById("resetLayout").addEventListener("click", () => {
  localStorage.removeItem(LAYOUT_KEY);
  location.reload();
});

// ── Boot ───────────────────────────────────────────────────
Object.keys(layout).forEach((id) => {
  if (catalog[id]) makeWidget(catalog[id], layout[id]);
});
renderLibrary();
setSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
