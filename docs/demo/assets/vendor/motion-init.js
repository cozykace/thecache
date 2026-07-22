// Vendored Motion One loader — exposes window.Motion for app.js's springIn().
// External module (not inline) so the page's Content-Security-Policy can be strict
// script-src 'self' with no 'unsafe-inline'. app.js degrades gracefully if this
// fails, so a load error is harmless. Pinned copy in ./motion.js (no CDN at runtime).
import * as m from "./motion.js";
window.Motion = m;
