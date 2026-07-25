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
    return { status: NEXT.status, ok: NEXT.status >= 200 && NEXT.status < 300, async json() { return (NEXT && NEXT.jsonBody) || {}; } };
  };
}
const fetch = mkFetch();       // app.js cloudRequestReset uses fetch
const realFetch = fetch;       // webcache requestReset / confirm* use realFetch
const cloudUrl = () => "https://cloud.example";
// mirror of webcache's errMsg (confirmVerification/confirmPasswordReset call it on the error path)
const errMsg = (d) => { if (!d) return ""; try { const f = Object.values(d.data || {})[0]; if (f && f.message) return f.message; } catch (e) {} return d.message || ""; };

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

  // ── 5b. post-login recovery nudge (regression: a failed/empty keybox read must NOT nag escrow) ──
  ok("nudge: zk vault, locked out → recover", resetLoginNeedsRecovery(true, false, ["pass"]) === true);
  ok("nudge: zk vault (file+code), locked out → recover", resetLoginNeedsRecovery(true, false, ["file", "code"]) === true);
  ok("nudge: escrow vault, locked out → NO nag", resetLoginNeedsRecovery(true, false, ["esc"]) === false);
  ok("nudge: escrow+pass, locked out → NO nag (a spare exists)", resetLoginNeedsRecovery(true, false, ["esc", "pass"]) === false);
  ok("nudge: ⚠ FAILED/EMPTY read ([]) → NO nag (the escrow-blip bug — must stay false)", resetLoginNeedsRecovery(true, false, []) === false);
  ok("nudge: device already holds the key → NO nag", resetLoginNeedsRecovery(true, true, ["pass"]) === false);
  ok("nudge: no vault yet → NO nag", resetLoginNeedsRecovery(false, false, ["pass"]) === false);
  ok("nudge: null/garbage methods → NO nag (never crashes)", resetLoginNeedsRecovery(true, false, null) === false && resetLoginNeedsRecovery(true, false, undefined) === false);

  // ── 6. on-brand confirm landing (webcache) — hash parser ──
  const pr = parseConfirmHashStr("#confirm-password-reset/eyJhbG.payload.sig");
  ok("hash: parses a reset link → kind + token", pr && pr.kind === "confirm-password-reset" && pr.token === "eyJhbG.payload.sig");
  const pv = parseConfirmHashStr("#confirm-verification/tok123");
  ok("hash: parses a verification link", pv && pv.kind === "confirm-verification" && pv.token === "tok123");
  ok("hash: tolerates a leading slash (#/confirm-...)", (parseConfirmHashStr("#/confirm-verification/tok") || {}).token === "tok");
  ok("hash: unsupported kind (email-change) → null, falls through to the gate", parseConfirmHashStr("#confirm-email-change/tok") === null);
  ok("hash: unknown hash → null", parseConfirmHashStr("#board") === null && parseConfirmHashStr("#") === null && parseConfirmHashStr("") === null);
  ok("hash: missing token → null (never a confirm gate with an empty token)", parseConfirmHashStr("#confirm-password-reset/") === null);
  ok("hash: no slash → null", parseConfirmHashStr("#confirm-password-reset") === null);
  ok("hash: a token can't smuggle a second kind — everything after the 1st slash is the token",
    parseConfirmHashStr("#confirm-verification/a/b").token === "a/b");

  // ── 7. confirm endpoint payloads (webcache) ──
  NEXT = { status: 204 }; LAST = null;
  ok("verify: 204 → true", (await grab(() => confirmVerification("tokV"))).ret === true);
  ok("verify: POSTs confirm-verification with exactly { token }",
    LAST.url === "https://cloud.example/api/collections/users/confirm-verification" &&
    LAST.method === "POST" && LAST.body.token === "tokV" && Object.keys(LAST.body).length === 1);
  NEXT = { status: 400, jsonBody: { data: { token: { message: "Invalid or expired token." } } } };
  ok("verify: 400 → throws the server's message", (await grab(() => confirmVerification("bad"))).err === "Invalid or expired token.");
  NEXT = { status: 400, jsonBody: {} };
  ok("verify: 400 with no body → friendly fallback", (await grab(() => confirmVerification("bad"))).err === "this link is invalid or has expired");

  NEXT = { status: 204 }; LAST = null;
  ok("reset-confirm: 204 → true", (await grab(() => confirmPasswordReset("tokR", "newpass12", "newpass12"))).ret === true);
  ok("reset-confirm: POSTs confirm-password-reset with { token, password, passwordConfirm }",
    LAST.url === "https://cloud.example/api/collections/users/confirm-password-reset" &&
    LAST.body.token === "tokR" && LAST.body.password === "newpass12" && LAST.body.passwordConfirm === "newpass12" &&
    Object.keys(LAST.body).length === 3);
  ok("reset-confirm: the new password rides the BODY, never the URL",
    LAST.url.indexOf("newpass12") < 0 && LAST.url.indexOf("tokR") < 0);
  NEXT = { status: 400, jsonBody: { data: { password: { message: "Must be at least 8 characters." } } } };
  ok("reset-confirm: 400 → surfaces the server's message", (await grab(() => confirmPasswordReset("t", "x", "x"))).err === "Must be at least 8 characters.");

  // ── 8. confirmTokenEmail (prefill only) ──
  const mkJwt = (obj) => "h." + Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + ".s";
  ok("token-email: pulls the email from a reset JWT (prefill)", confirmTokenEmail(mkJwt({ email: "jane@doe.test" })) === "jane@doe.test");
  ok("token-email: junk token → '' (never throws)", confirmTokenEmail("not-a-jwt") === "" && confirmTokenEmail("") === "" && confirmTokenEmail(null) === "");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
