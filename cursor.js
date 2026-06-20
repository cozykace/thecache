// ============================================================
//  Money — designed cursor. Our cursor is the ONLY cursor
//  (native is hidden in CSS), so the look stays consistent
//  everywhere — no snapping back to the system arrow.
//
//  • dot  = precise point (no lag) so aiming stays exact
//  • ring = trails the pointer, grows on hover (feedback),
//           reacts differently to a quick click vs a hold
// ============================================================
(() => {
  const HOLD_MS = 180; // press longer than this = a "hold"
  const HOT = "a,button,input,textarea,[contenteditable],.widget-bar," +
    ".sticker,.widget-resize,.sticker-resize,.icon-cell,.lib-item,.menu-item";

  const aura = document.createElement("div");
  aura.className = "cursor-aura";
  aura.innerHTML = '<span class="cursor-ring"></span>';
  const dot = document.createElement("div");
  dot.className = "cursor-dot";
  document.body.appendChild(aura);
  document.body.appendChild(dot);

  let tx = innerWidth / 2, ty = innerHeight / 2, cx = tx, cy = ty;

  addEventListener("pointermove", (e) => {
    tx = e.clientX; ty = e.clientY;
    dot.style.left = tx + "px";
    dot.style.top = ty + "px";
    const hot = e.target && e.target.closest && e.target.closest(HOT);
    aura.classList.toggle("hot", !!hot);
  }, { passive: true });

  // ring trails the pointer with a little lag (alive feel)
  (function loop() {
    cx += (tx - cx) * 0.3;
    cy += (ty - cy) * 0.3;
    aura.style.transform = "translate(" + cx + "px," + cy + "px)";
    requestAnimationFrame(loop);
  })();

  function ripple(x, y, kind) {
    const r = document.createElement("div");
    r.className = "cursor-ripple " + kind;
    r.style.left = x + "px";
    r.style.top = y + "px";
    document.body.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
  }

  let downAt = 0, holdTimer = null;
  addEventListener("pointerdown", () => {
    downAt = performance.now();
    aura.classList.add("down");
    holdTimer = setTimeout(() => aura.classList.add("holding"), HOLD_MS);
  });
  addEventListener("pointerup", (e) => {
    clearTimeout(holdTimer);
    const held = performance.now() - downAt >= HOLD_MS;
    aura.classList.remove("down", "holding");
    ripple(e.clientX, e.clientY, held ? "hold" : "click");
  });
  addEventListener("pointercancel", () => {
    clearTimeout(holdTimer);
    aura.classList.remove("down", "holding");
  });
})();
