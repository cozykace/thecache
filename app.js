// ============================================================
//  Money — widget board engine. Plain JS, no build step.
//
//  A widget is an entry in WIDGETS below. The board draws each
//  one and lets you drag it by its title bar. Where you drop it
//  is saved in your browser, so the layout sticks after reload.
//
//  TO ADD A WIDGET: add an entry to WIDGETS with an id, title,
//  a default size, and a render(el) function that fills its body.
// ============================================================

const STORE_KEY = "money.layout.v1";

// ── Widget catalog ─────────────────────────────────────────
const WIDGETS = [
  {
    id: "balance",
    title: "Total balance",
    w: 340,
    h: 200,
    render(el) {
      el.innerHTML =
        '<div>' +
        '<div class="big">—</div>' +
        '<div class="sub">no data yet · next brick connects it</div>' +
        '</div>';
    },
  },
  {
    id: "clock",
    title: "Local time",
    w: 280,
    h: 160,
    render(el) {
      const tick = () => {
        const now = new Date();
        el.innerHTML =
          '<div>' +
          '<div class="big">' +
          now.toLocaleTimeString("en-US", { hour12: false }) +
          '</div>' +
          '<div class="sub">' +
          now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          }) +
          '</div>' +
          '</div>';
      };
      tick();
      setInterval(tick, 1000);
    },
  },
];

// ── Layout: where each widget sits (persisted) ─────────────
function defaultLayout() {
  // first-run: center the cluster, side by side
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return {
    balance: { x: Math.round(cx - 354), y: Math.round(cy - 100), w: 340, h: 200 },
    clock: { x: Math.round(cx + 14), y: Math.round(cy - 80), w: 280, h: 160 },
  };
}

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return Object.assign(defaultLayout(), saved);
  } catch (e) {
    return defaultLayout();
  }
}

function saveLayout() {
  localStorage.setItem(STORE_KEY, JSON.stringify(layout));
}

// ── Render ─────────────────────────────────────────────────
const board = document.getElementById("board");
const layout = loadLayout();
let zTop = 10;

function makeWidget(def) {
  const pos = layout[def.id] || { x: 40, y: 40, w: def.w, h: def.h };

  const node = document.createElement("section");
  node.className = "widget";
  node.style.left = pos.x + "px";
  node.style.top = pos.y + "px";
  node.style.width = (pos.w || def.w) + "px";
  node.style.height = (pos.h || def.h) + "px";

  const bar = document.createElement("header");
  bar.className = "widget-bar";
  bar.innerHTML =
    '<span class="widget-title">' + def.title + '</span><span class="grip">⠿</span>';

  const body = document.createElement("div");
  body.className = "widget-body";

  node.appendChild(bar);
  node.appendChild(body);
  board.appendChild(node);

  def.render(body);
  makeDraggable(node, bar, def.id);
}

// ── Drag to place ──────────────────────────────────────────
function makeDraggable(node, handle, id) {
  let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;

  handle.addEventListener("pointerdown", (e) => {
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
    // keep at least a sliver on screen
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

// ── Boot ───────────────────────────────────────────────────
WIDGETS.forEach(makeWidget);
