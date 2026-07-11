// THE CACHE — web runtime (the hosted, browser-only app).
//
// Turns the same app.js into a no-backend web app:
//   1. Gate on a cloud login (PocketBase) + the user's encryption passphrase.
//   2. Pull the E2E-encrypted vault, decrypt it HERE in the browser, hydrate an
//      in-memory store of the data files + the precomputed dashboard views.
//   3. Intercept every data/*.json + /api/* call app.js makes and answer it from
//      that store — so the server never sees plaintext (true zero-knowledge).
//
// The desktop app is the "sync engine": it pulls the bank, computes everything,
// and pushes the sealed bundle (store.export_data → cloudPush). The web app reads.
// Editing from the web is a later brick — writes return a friendly "use desktop".
(function () {
  if (window.__CACHE_DEMO__) return;            // the demo has its own fake layer
  window.__CACHE_WEB__ = true;

  var CLOUD_DEFAULT = "https://thecache.pockethost.io";
  var FILES = {}, API = {}, READY = false, resolveGate;
  var gate = new Promise(function (r) { resolveGate = r; });
  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  // ── crypto (must match app.js encryptJSON envelope exactly) ──────────────────
  function _unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  async function _deriveKey(pass, salt) {
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 210000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function decryptJSON(envStr, pass) {
    var env = JSON.parse(envStr);
    var key = await _deriveKey(pass, _unb64(env.salt));
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(env.iv) }, key, _unb64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ── cloud account (shares the money.cloud key so app.js Settings shows it too) ─
  function cloudState() { try { return JSON.parse(localStorage.getItem("money.cloud") || "{}") || {}; } catch (e) { return {}; } }
  function cloudSave(s) { localStorage.setItem("money.cloud", JSON.stringify(s)); }
  function cloudUrl() { return ((cloudState().url || CLOUD_DEFAULT) + "").replace(/\/+$/, ""); }
  function errMsg(d) { if (!d) return ""; try { var f = Object.values(d.data || {})[0]; if (f && f.message) return f.message; } catch (e) {} return d.message || ""; }
  async function login(email, pass) {
    var base = cloudUrl();
    var r = await realFetch(base + "/api/collections/users/auth-with-password",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: email, password: pass }) });
    var d = await r.json();
    if (!r.ok || !d.token) throw new Error(errMsg(d) || "login failed");
    cloudSave({ url: base, token: d.token, email: (d.record && d.record.email) || email, userId: d.record && d.record.id, recordId: cloudState().recordId });
  }
  async function signup(email, pass) {
    var base = cloudUrl();
    var r = await realFetch(base + "/api/collections/users/records",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, password: pass, passwordConfirm: pass }) });
    var d = await r.json();
    if (!r.ok) throw new Error(errMsg(d) || "couldn't create account");
    return login(email, pass);
  }
  async function pullVault(pass) {
    var s = cloudState();
    if (!s.token) throw new Error("not logged in");
    var r = await realFetch(cloudUrl() + "/api/collections/vaults/records?perPage=1&filter=" +
      encodeURIComponent("owner='" + s.userId + "'"), { headers: { Authorization: s.token } });
    var d = await r.json();
    if (r.status === 401 || r.status === 403) throw new Error("AUTH");        // token expired → re-login
    if (!r.ok) throw new Error(errMsg(d) || "couldn't reach your cloud vault");
    var rec = d.items && d.items[0];
    if (!rec || !rec.blob) { FILES = {}; API = {}; return { empty: true }; }   // account exists, nothing synced yet
    var obj;
    try { obj = await decryptJSON(rec.blob, pass); } catch (e) { throw new Error("wrong passphrase or corrupt vault"); }
    FILES = (obj && obj.files) || {};
    API = (obj && obj.api) || {};
    // restore the user's setup (deck, daily log, base, config) so it appears on this device too
    try { const lo = obj && obj.local; if (lo && typeof lo === "object") Object.keys(lo).forEach((k) => { if (k.indexOf("money.") === 0 && k !== "money.cloud") { try { localStorage.setItem(k, lo[k]); } catch (e) {} } }); } catch (e) {}
    return { empty: false, count: Object.keys(FILES).length };
  }

  // ── serve app data from the decrypted store ──────────────────────────────────
  function J(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } }); }
  function serve(url, method) {
    var M = (method || "GET").toUpperCase();
    var dm = url.match(/data\/([\w.-]+\.json)/);
    if (dm) { var nm = dm[1]; return FILES[nm] != null ? new Response(FILES[nm], { status: 200, headers: { "Content-Type": "application/json" } }) : J({}); }
    if (url.indexOf("/api/") !== -1) {
      var key = url.split("/api/")[1].split("?")[0].replace(/\/+$/, "");
      if (key === "ping") return J({ ok: true, founder: false, web: true });
      if (key === "connect-status") return J({ connected: false, web: true });
      if (key === "update-check") return J({ ok: true, available: false, current: "web" });
      if (key === "export-data") return J({ ok: true, files: FILES, api: API, exported: 0, count: Object.keys(FILES).length });
      if (key === "webdav-config") return J({ ok: true, configured: false, url: "", user: "" });
      if (M === "GET" && API[key] != null) return J(API[key]);
      if (M === "GET") return J({ ok: true });
      // writes aren't supported on the web yet — read-only mirror of your desktop cache
      return J({ ok: false, web: true, error: "Editing from the web is coming soon — for now, changes are made in the desktop app and synced here." });
    }
    return J({ ok: true });
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var isApp = !/^https?:\/\//i.test(url) && (url.indexOf("/api/") !== -1 || url.indexOf("data/") !== -1);
    if (isApp) {
      var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
      return READY ? Promise.resolve(serve(url, method)) : gate.then(function () { return serve(url, method); });
    }
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error("offline"));
  };

  // ── the login / unlock gate ──────────────────────────────────────────────────
  function buildGate() {
    var st = document.createElement("style");
    st.textContent =
      ".wc-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
      "background:var(--paper,#fff);padding:24px;box-sizing:border-box;transition:opacity .5s ease}" +
      ".wc-card{width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px}" +
      ".wc-brand{font-family:var(--font-mono,ui-monospace,monospace);letter-spacing:.22em;font-size:13px;color:var(--ink,#111);opacity:.7;text-transform:uppercase;text-align:center;margin-bottom:2px}" +
      ".wc-h{font-size:21px;font-weight:500;color:var(--ink,#111);text-align:center;margin:0}" +
      ".wc-sub{font-size:12.5px;color:rgba(var(--ink-rgb,17,17,17),.6);text-align:center;line-height:1.5;margin:-4px 0 6px}" +
      ".wc-field{display:flex;flex-direction:column;gap:4px}" +
      ".wc-field label{font-size:11px;color:rgba(var(--ink-rgb,17,17,17),.6)}" +
      ".wc-gate input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--edge,#ddd);border-radius:10px;" +
      "background:var(--panel,#f7f7f5);color:var(--ink,#111);font-family:inherit;font-size:14px}" +
      ".wc-gate input:focus{outline:none;border-color:var(--accent,#FFD409)}" +
      ".wc-row{display:flex;gap:8px}" +
      ".wc-btn{flex:1;padding:12px;border-radius:10px;border:1px solid var(--edge,#ddd);background:var(--panel,#f7f7f5);" +
      "color:var(--ink,#111);font-family:inherit;font-size:14px;cursor:pointer;transition:border-color .12s,background .12s}" +
      ".wc-btn:hover{border-color:var(--accent,#FFD409)}" +
      ".wc-btn.primary{background:var(--ink,#111);color:var(--paper,#fff);border-color:var(--ink,#111)}" +
      ".wc-msg{font-size:12px;min-height:16px;text-align:center;color:rgba(var(--ink-rgb,17,17,17),.6)}" +
      ".wc-msg.err{color:#e0533d}.wc-msg.ok{color:#2ec16b}" +
      ".wc-link{font-size:12px;color:rgba(var(--ink-rgb,17,17,17),.55);text-align:center;cursor:pointer;text-decoration:underline}";
    document.head.appendChild(st);

    var g = document.createElement("div");
    g.className = "wc-gate";
    var s = cloudState();
    var returning = !!(s.token && s.email);
    g.innerHTML =
      '<div class="wc-card">' +
      '<div class="wc-brand">The Cache</div>' +
      '<h1 class="wc-h">' + (returning ? "Welcome back" : "Open your cache") + '</h1>' +
      '<div class="wc-sub">' + (returning
        ? ("Signed in as " + esc(s.email) + ". Enter your passphrase to unlock — it decrypts your cache right here in your browser.")
        : "Your cache is end-to-end encrypted. Sign in and unlock it with your passphrase — only you can read it.") + '</div>' +
      '<div class="wc-field wc-acct" ' + (returning ? 'style="display:none"' : '') + '><label>Email</label><input id="wcEmail" type="email" autocomplete="username" value="' + esc(s.email || "") + '" placeholder="you@email.com"></div>' +
      '<div class="wc-field wc-acct" ' + (returning ? 'style="display:none"' : '') + '><label>Account password</label><input id="wcPass" type="password" autocomplete="current-password" placeholder="your account password"></div>' +
      '<div class="wc-field"><label>Encryption passphrase</label><input id="wcPhrase" type="password" autocomplete="off" placeholder="the secret that decrypts your cache"></div>' +
      '<div class="wc-row">' +
        (returning
          ? '<button class="wc-btn primary" id="wcUnlock">Unlock my cache</button>'
          : '<button class="wc-btn primary" id="wcLogin">Log in</button><button class="wc-btn" id="wcSignup">Create account</button>') +
      '</div>' +
      '<div class="wc-msg" id="wcMsg"></div>' +
      (returning ? '<div class="wc-link" id="wcSwitch">Use a different account</div>' : '') +
      '</div>';
    document.body.appendChild(g);

    var msg = g.querySelector("#wcMsg");
    function say(t, kind) { msg.textContent = t; msg.className = "wc-msg" + (kind ? " " + kind : ""); }
    function val(id) { var e = g.querySelector(id); return e ? e.value.trim() : ""; }

    async function enter(phrase) {
      var res = await pullVault(phrase);
      READY = true; resolveGate();
      if (res.empty) say("✓ Logged in. This account has no synced cache yet — sync from the desktop app to fill it.", "ok");
      g.style.opacity = "0";
      setTimeout(function () { g.remove(); if (window.lucide && window.lucide.createIcons) try { window.lucide.createIcons(); } catch (e) {} }, 520);
    }
    function fail(e) {
      if ((e && e.message) === "AUTH") { say("Session expired — please sign in again.", "err"); reveal(); return; }
      say((e && e.message) || "Something went wrong.", "err");
    }
    function reveal() {
      var acct = g.querySelectorAll(".wc-acct"); for (var i = 0; i < acct.length; i++) acct[i].style.display = "";
    }

    var unlockBtn = g.querySelector("#wcUnlock");
    if (unlockBtn) unlockBtn.addEventListener("click", async function () {
      var phrase = val("#wcPhrase");
      if (phrase.length < 6) { say("Enter your passphrase (6+ characters).", "err"); return; }
      say("Unlocking…");
      try { await enter(phrase); } catch (e) { fail(e); }
    });
    var switchLink = g.querySelector("#wcSwitch");
    if (switchLink) switchLink.addEventListener("click", function () { reveal(); switchLink.style.display = "none"; say(""); });

    var loginBtn = g.querySelector("#wcLogin");
    if (loginBtn) loginBtn.addEventListener("click", async function () {
      var email = val("#wcEmail"), pass = val("#wcPass"), phrase = val("#wcPhrase");
      if (!email || !pass) { say("Enter your email and account password.", "err"); return; }
      if (phrase.length < 6) { say("Enter your encryption passphrase (6+ characters).", "err"); return; }
      say("Logging in…");
      try { await login(email, pass); await enter(phrase); } catch (e) { fail(e); }
    });
    var signupBtn = g.querySelector("#wcSignup");
    if (signupBtn) signupBtn.addEventListener("click", async function () {
      var email = val("#wcEmail"), pass = val("#wcPass"), phrase = val("#wcPhrase");
      if (!email || !pass) { say("Pick an email and a password to create your account.", "err"); return; }
      if (phrase.length < 6) { say("Choose an encryption passphrase (6+ characters) — write it down, it can't be recovered.", "err"); return; }
      say("Creating your account…");
      try { await signup(email, pass); await enter(phrase); } catch (e) { fail(e); }
    });
  }
  function esc(s) { return (s + "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  if (document.body) buildGate();
  else document.addEventListener("DOMContentLoaded", buildGate);
})();
