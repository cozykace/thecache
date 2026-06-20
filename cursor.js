// ============================================================
//  Money — designed cursor: a 3D jelly ball.
//  One black sphere is the only cursor (native is hidden in CSS).
//  It trails with a little lag, stretches in its direction of
//  motion, squishes when pressed, and dents buttons inward like
//  jelly when it pushes on them.
// ============================================================
(() => {
  const PRESSABLE = "button";

  const ball = document.createElement("div");
  ball.className = "cursor-ball";
  document.body.appendChild(ball);

  let px = innerWidth / 2, py = innerHeight / 2;   // raw pointer
  let cx = px, cy = py, lastX = px, lastY = py;    // ball position (eased)
  let sx = 1, sy = 1;                              // squish (eased)
  let pressed = false, hoverEl = null, pressEl = null;

  addEventListener("pointermove", (e) => {
    px = e.clientX; py = e.clientY;
    const hov = e.target && e.target.closest ? e.target.closest(PRESSABLE) : null;
    if (hov !== hoverEl) {
      if (hoverEl) hoverEl.classList.remove("jelly-hover");
      if (hov) hov.classList.add("jelly-hover");
      hoverEl = hov;
    }
  }, { passive: true });

  (function loop() {
    cx += (px - cx) * 0.22;
    cy += (py - cy) * 0.22;
    const dx = cx - lastX, dy = cy - lastY;
    lastX = cx; lastY = cy;
    const speed = Math.min(Math.hypot(dx, dy), 36);
    const k = speed / 36;
    const angle = (dx || dy) ? Math.atan2(dy, dx) * 180 / Math.PI : 0;
    // pressed → gentle squish; moving → subtle stretch along travel
    const tsx = pressed ? 1.12 : 1 + k * 0.18;
    const tsy = pressed ? 0.9 : 1 - k * 0.12;
    sx += (tsx - sx) * 0.3;
    sy += (tsy - sy) * 0.3;
    ball.style.transform =
      "translate(" + cx + "px," + cy + "px) rotate(" + (pressed ? 0 : angle) +
      "deg) scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")";
    requestAnimationFrame(loop);
  })();

  addEventListener("pointerdown", (e) => {
    pressed = true;
    ball.classList.add("press");
    pressEl = e.target && e.target.closest ? e.target.closest(PRESSABLE) : null;
    if (pressEl) pressEl.classList.add("jelly-down");
  });
  const release = () => {
    pressed = false;
    ball.classList.remove("press");
    if (pressEl) { pressEl.classList.remove("jelly-down"); pressEl = null; }
  };
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
})();
