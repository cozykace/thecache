// ============================================================
//  THE CACHE — designed cursor: a 3D jelly ball.
//  One black sphere is the only cursor (native is hidden in CSS).
//  It trails with a little lag, stretches in its direction of
//  motion, squishes when pressed, and dents buttons inward like
//  jelly when it pushes on them.
//  Mouse-only: on touch the ball would just haunt the last tap, so
//  it exists only while a fine pointer (a real mouse/trackpad) does —
//  and it comes and goes live as one connects or disconnects.
// ============================================================
(() => {
  const PRESSABLE = "button";
  const fine = matchMedia("(hover: hover) and (pointer: fine)");

  let ball = null, raf = 0;
  let px = 0, py = 0, cx = 0, cy = 0, lastX = 0, lastY = 0;
  let sx = 1, sy = 1;
  let pressed = false, hoverEl = null, pressEl = null;

  const onMove = (e) => {
    px = e.clientX; py = e.clientY;
    const hov = e.target && e.target.closest ? e.target.closest(PRESSABLE) : null;
    if (hov !== hoverEl) {
      if (hoverEl) hoverEl.classList.remove("jelly-hover");
      if (hov) hov.classList.add("jelly-hover");
      hoverEl = hov;
    }
  };
  const onDown = (e) => {
    pressed = true;
    if (ball) ball.classList.add("press");
    pressEl = e.target && e.target.closest ? e.target.closest(PRESSABLE) : null;
    if (pressEl) pressEl.classList.add("jelly-down");
  };
  const release = () => {
    pressed = false;
    if (ball) ball.classList.remove("press");
    if (pressEl) { pressEl.classList.remove("jelly-down"); pressEl = null; }
  };

  function loop() {
    cx += (px - cx) * 0.8;
    cy += (py - cy) * 0.8;
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
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (ball) return;
    ball = document.createElement("div");
    ball.className = "cursor-ball";
    document.body.appendChild(ball);
    px = cx = lastX = innerWidth / 2;
    py = cy = lastY = innerHeight / 2;
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown);
    addEventListener("pointerup", release);
    addEventListener("pointercancel", release);
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (!ball) return;
    cancelAnimationFrame(raf);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerdown", onDown);
    removeEventListener("pointerup", release);
    removeEventListener("pointercancel", release);
    release();
    if (hoverEl) { hoverEl.classList.remove("jelly-hover"); hoverEl = null; }
    ball.remove(); ball = null;
  }

  if (fine.matches) start();
  try { fine.addEventListener("change", (e) => (e.matches ? start() : stop())); }
  catch (e) { try { fine.addListener((m) => (m.matches ? start() : stop())); } catch (e2) {} }
})();
