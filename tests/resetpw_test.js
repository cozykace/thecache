// ── Forgot-password reset: request shaping · enumeration safety · vault routing ──
// The password-reset feature touches AUTH, so these assertions pin the properties that
// are easy to get subtly wrong and impossible to eyeball on a live server:
//   · the request POSTs the RIGHT endpoint + body shape (both runtimes, byte-parity)
//   · ENUMERATION SAFETY: the request fn returns the SAME result whether the account
//     exists (204) or not (400/404) — it only distinguishes transport (offline/429/5xx),
//     never existence. (The UI shows one calm string for that result → "same text both ways".)
//   · the TWO-SECRETS router: escrow → "open" (a reset is enough); zero-knowledge → "recover"
//     (the data still needs the passphrase / recovery file / code).
// The real functions are loaded by ANCHOR out of app.js + webcache.js (no line numbers),
// and fetch is mocked — no live server, no tokens, nothing sensitive.
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const appSrc = read("app.js").split("\n");
const webSrc = read("webcache.js").split("\n");
const at = (lines, re) => { const i = lines.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
const block = (lines, a, b) => lines.slice(at(lines, a), at(lines, b)).join("\n");

// app.js: cloudRequestReset + resetRouteForMethods (everything up to cloudLogout)
const APP_BLOCK = block(appSrc, /^async function cloudRequestReset/, /^function cloudLogout/);
// webcache.js: requestReset (up to pullVault)
const WEB_BLOCK = block(webSrc, /^  async function requestReset/, /^  async function pullVault/);

// ── mock transport ──
// NEXT controls the next fetch: {status} to answer, or "throw" to simulate offline.
let NEXT = { status: 204 };
let LAST = null;   // the last request captured
function mkFetch() {
  return async (url, opts) => {
    LAST = { url, opts, body: JSON.parse((opts && opts.body) || "null"), ct: opts && opts.headers && opts.headers["Content-Type"], method: opts && opts.method };
    if (NEXT === "throw") throw new Error("network down");
    return { status: NEXT.status, ok: NEXT.status >= 200 && NEXT.status < 300, async json() { return {}; } };
  };
}
const fetch = mkFetch();       // app.js cloudRequestReset uses fetch
const realFetch = fetch;       // webcache requestReset uses realFetch
const cloudUrl = () => "https://cloud.example";

// function declarations leak out of a direct eval into this scope — so after eval we can
// call cloudRequestReset / resetRouteForMethods / requestReset directly (no re-declaration).
eval(APP_BLOCK + "\n" + WEB_BLOCK);

let pass = 0, fail = 0;
function ok(name, cond) { (cond ? pass++ : fail++); console.log((cond ? "  ok  " : "FAIL  ") + name); }
async function grab(fn) { try { return { ret: await fn() }; } catch (e) { return { err: e && e.message }; } }

(async function () {
  // ── 1. request payload shape (app.js) ──
  NEXT = { status: 204 }; LAST = null;
  let r = await grab(() => cloudRequestReset("jane@doe.test"));
  ok("app: resolves (no throw) on 204", r.ret === true && !r.err);
  ok("app: POSTs the request-password-reset endpoint", LAST.url === "https://cloud.example/api/collections/users/request-password-reset");
  ok("app: method is POST", LAST.method === "POST");
  ok("app: Content-Type application/json (forces preflight, no enumeration via CORS)", LAST.ct === "application/json");
  ok("app: body is exactly { email }", LAST.body && LAST.body.email === "jane@doe.test" && Object.keys(LAST.body).length === 1);
  ok("app: never carries a token/password in the body", !("token" in LAST.body) && !("password" in LAST.body));
  // an explicit url (self-hosted cloud) is honored + trailing slashes normalized
  LAST = null; await cloudRequestReset("a@b.co", "https://my.host///");
  ok("app: explicit url is used + normalized", LAST.url === "https://my.host/api/collections/users/request-password-reset");

  // ── 2. ENUMERATION SAFETY — same result whether or not the account exists ──
  const results = {};
  for (const st of [204, 400, 404]) { NEXT = { status: st }; const g = await grab(() => cloudRequestReset("x@y.z")); results[st] = g.ret; }
  ok("app: 204 (sent) → true", results[204] === true);
  ok("app: 400 (would-be 'bad email') → same true, never a distinct signal", results[400] === true);
  ok("app: 404 (would-be 'no account') → same true, never a distinct signal", results[404] === true);
  ok("app: existence never leaks — 204 / 400 / 404 all identical", results[204] === results[400] && results[400] === results[404]);

  // ── 3. transport problems ARE surfaced (they never reveal existence) ──
  NEXT = { status: 429 }; ok("app: 429 → 'rate' (cooldown, applies to everyone)", (await grab(() => cloudRequestReset("x@y.z"))).err === "rate");
  NEXT = { status: 500 }; ok("app: 500 → 'server' (a hiccup, not 'no account')", (await grab(() => cloudRequestReset("x@y.z"))).err === "server");
  NEXT = { status: 503 }; ok("app: 503 → 'server'", (await grab(() => cloudRequestReset("x@y.z"))).err === "server");
  NEXT = "throw"; ok("app: fetch rejects → 'offline'", (await grab(() => cloudRequestReset("x@y.z"))).err === "offline");

  // ── 4. webcache parity — same endpoint + same body, byte for byte ──
  NEXT = { status: 204 }; LAST = null;
  let w = await grab(() => requestReset("jane@doe.test"));
  ok("web: resolves on 204", w.ret === true);
  ok("web: SAME endpoint as app.js", LAST.url === "https://cloud.example/api/collections/users/request-password-reset");
  ok("web: SAME body shape { email }", LAST.body.email === "jane@doe.test" && Object.keys(LAST.body).length === 1);
  ok("web: SAME Content-Type", LAST.ct === "application/json");
  const web = {};
  for (const st of [204, 400, 404]) { NEXT = { status: st }; web[st] = (await grab(() => requestReset("x@y.z"))).ret; }
  ok("web: enumeration-safe too — 204 / 400 / 404 all identical", web[204] === web[400] && web[400] === web[404] && web[204] === true);
  NEXT = { status: 429 }; ok("web: 429 → 'rate'", (await grab(() => requestReset("x@y.z"))).err === "rate");
  NEXT = { status: 500 }; ok("web: 500 → 'server'", (await grab(() => requestReset("x@y.z"))).err === "server");
  NEXT = "throw"; ok("web: offline → 'offline'", (await grab(() => requestReset("x@y.z"))).err === "offline");

  // ── 5. the TWO-SECRETS router (escrow opens · zero-knowledge needs recovery) ──
  ok("route: escrow alone → open (reset is enough)", resetRouteForMethods(["esc"]) === "open");
  ok("route: escrow + passphrase → open (a spare exists)", resetRouteForMethods(["esc", "pass"]) === "open");
  ok("route: passphrase only → recover (data still sealed)", resetRouteForMethods(["pass"]) === "recover");
  ok("route: recovery file + code, no escrow → recover", resetRouteForMethods(["file", "code"]) === "recover");
  ok("route: no keybox methods ([]) → open (login path catches v1 separately)", resetRouteForMethods([]) === "open");
  ok("route: null/garbage → open (never crashes the login handler)", resetRouteForMethods(null) === "open" && resetRouteForMethods(undefined) === "open");
  ok("route: order-independent", resetRouteForMethods(["pass", "esc"]) === "open" && resetRouteForMethods(["code", "file", "pass"]) === "recover");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
