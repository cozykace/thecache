// Pre-paint theme setter — runs blocking in <head> so the saved theme/background
// is applied before first paint (no flash). External (not inline) so the page's
// Content-Security-Policy can be a strict script-src 'self' with no 'unsafe-inline'.
// The demo sets data-default-theme on <html> to commit to the brand look without
// editing this file (keeps one CSP-clean copy everywhere).
try {
  var def = document.documentElement.getAttribute("data-default-theme");
  var t = localStorage.getItem("money.theme") || def;
  if (t) document.documentElement.setAttribute("data-theme", t);
  var bg = localStorage.getItem("money.bg");
  if (bg) document.documentElement.setAttribute("data-bg", bg);
} catch (e) {}
