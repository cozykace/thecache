// ============================================================
//  Money — designed cursor (nourishing edition).
//  Our cursor is the ONLY cursor (native hidden in CSS).
//
//  • dot   = precise point, softly squishes on press
//  • ring  = trails the pointer, breathes when idle, and
//            gently leans toward whatever you hover (soft magnet)
//  • glow  = a warm, blurred afterglow that lags further behind
//  • click = a soft warm bloom; hold-release gathers inward
// ============================================================
(() => {
  const HOLD_MS = 180;
  const HOT = "a,button,input,textarea,[contenteditable],.widget-bar," +
    ".sticker,.widget-resize,.sticker-resize,.icon-cell,.lib-item,.menu-item";

  const aura = document.createElement("div");
  aura.className = "cursor-aura";
  aura.innerHTML = '<span class="cursor-ring"></span>';
  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  const dot = document.createElement("div");
  dot.className = "cursor-dot";
  document.body.appendChild(glow);
  document.body.appendChild(aura);
  document.body.appendChild(dot);

  let px = innerWidth / 2, py = innerHeight / 2;   // raw pointer
  let cx = px, cy = py;                            // ring (eased + magnet)
  let gx = px, gy = py;                            // glow (slower)
  let hotEl = null;

  addEventListener("pointermove", (e) => {
    px = e.clientX; py = e.clientY;
    dot.style.left = px + "px";
    dot.style.top = py + "px";
    hotEl = e.target && e.target.closest ? e.target.closest(HOT) : null;
    aura.classList.toggle("hot", !!hotEl);
  }, { passive: true });

  (function loop() {
    // soft magnet: lean the ring's target toward a hovered element's center
    let txp = px, typ = py;
    if (hotEl && hotEl.isConnected) {
      const r = hotEl.getBoundingClientRect();
      txp = px + (r.left + r.width / 2 - px) * 0.22;
      typ = py + (r.top + r.height / 2 - py) * 0.22;
    }
    cx += (txp - cx) * 0.2;
    cy += (typ - cy) * 0.2;
    gx += (px - gx) * 0.1;
    gy += (py - gy) * 0.1;
    aura.style.transform = "translate(" + cx + "px," + cy + "px)";
    glow.style.transform = "translate(" + gx + "px," + gy + "px)";
    requestAnimationFrame(loop);
  })();

  function bloom(x, y, kind) {
    const b = document.createElement("div");
    b.className = "cursor-ripple " + kind;
    b.style.left = x + "px";
    b.style.top = y + "px";
    document.body.appendChild(b);
    b.addEventListener("animationend", () => b.remove());
  }

  let downAt = 0, holdTimer = null;
  addEventListener("pointerdown", () => {
    downAt = performance.now();
    dot.classList.add("press");
    aura.classList.add("down");
    holdTimer = setTimeout(() => aura.classList.add("holding"), HOLD_MS);
  });
  addEventListener("pointerup", (e) => {
    clearTimeout(holdTimer);
    const held = performance.now() - downAt >= HOLD_MS;
    dot.classList.remove("press");
    aura.classList.remove("down", "holding");
    bloom(e.clientX, e.clientY, held ? "hold" : "click");
  });
  addEventListener("pointercancel", () => {
    clearTimeout(holdTimer);
    dot.classList.remove("press");
    aura.classList.remove("down", "holding");
  });
})();
