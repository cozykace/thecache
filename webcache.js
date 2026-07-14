// THE CACHE — web runtime (the hosted, browser-only app).
//
// Turns the same app.js into a no-backend web app:
//   1. Gate on a cloud login (PocketBase). v2 vaults are sealed with a data key
//      that rides the vault record in a "keybox" — escrow mode opens with just
//      the login (and unlocks SILENTLY on a returning device); zero-knowledge
//      mode asks for the passphrase once per device, then goes silent too.
//   2. Pull the encrypted vault, decrypt it HERE in the browser, hydrate an
//      in-memory store of the data files + the precomputed dashboard views.
//   3. Intercept every data/*.json + /api/* call app.js makes and answer it from
//      that store — the server only ever holds ciphertext.
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

  // ── crypto (must match app.js envelopes exactly: v1 passphrase, v2 data key) ──
  function _b64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
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
  function keyGet() { try { return localStorage.getItem("money.cloudKey") || ""; } catch (e) { return ""; } }
  function keySet(b64) { try { if (b64) localStorage.setItem("money.cloudKey", b64); else localStorage.removeItem("money.cloudKey"); } catch (e) {} }
  function _importK(b64) { return crypto.subtle.importKey("raw", _unb64(b64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
  async function keyboxOpen(boxStr, pass) {
    var box = JSON.parse(boxStr);
    if (box.m === "esc") return box.k;                       // escrow: the account is the key
    if (!pass) throw new Error("ZK");                        // zero-knowledge: passphrase needed once on this device
    var kek = await _deriveKey(pass, _unb64(box.salt));
    var raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(box.iv) }, kek, _unb64(box.ct));
    return _b64(raw);
  }
  async function openVault(envStr, pass) {
    var env = JSON.parse(envStr);
    if ((env.v || 1) >= 2) {
      var kb = keyGet();
      if (!kb) throw new Error("ZK");
      var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(env.iv) }, await _importK(kb), _unb64(env.ct));
      return JSON.parse(new TextDecoder().decode(pt));
    }
    if (!pass) throw new Error("ZK");                        // v1 legacy vault always needs the passphrase
    return decryptJSON(envStr, pass);
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
    var prev = cloudState();
    // a different account on this browser → drop the old account's device key + mode
    if (prev.userId && d.record && d.record.id !== prev.userId) { keySet(""); prev.recordId = null; prev.mode = null; }
    cloudSave({ url: base, token: d.token, email: (d.record && d.record.email) || email, userId: d.record && d.record.id, recordId: prev.recordId, mode: prev.mode || null });
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
    // v2: adopt the data key from the keybox if this device doesn't hold it yet
    if (rec.keybox) {
      var box = JSON.parse(rec.keybox);
      // a zero-knowledge account must never silently accept an escrow keybox —
      // that shape change is what a tampering server would send
      if (cloudState().mode === "zk" && box.m === "esc") throw new Error("your vault's key seal changed unexpectedly — open the app on your computer to re-seal it");
      if (!keyGet()) {
        try { keySet(await keyboxOpen(rec.keybox, pass || "")); }
        catch (e) { if ((e && e.message) === "ZK") throw e; throw new Error("wrong passphrase — try again"); }
      }
      try { cloudSave(Object.assign(cloudState(), { mode: box.m === "zk" ? "zk" : "esc" })); } catch (e) {}
    } else if (!keyGet()) {
      // v2 blob but no keybox anywhere → the server schema is missing the keybox
      // field; a passphrase prompt would be a lie (there is nothing it can unwrap)
      var v = 1; try { v = JSON.parse(rec.blob).v || 1; } catch (e) {}
      if (v >= 2) throw new Error("this vault's key isn't on the server yet — open the app on your computer once (it will add it), then reload here");
    }
    var obj;
    try { obj = await openVault(rec.blob, pass || ""); }
    catch (e) { if ((e && e.message) === "ZK") throw e; throw new Error("wrong passphrase or corrupt vault"); }
    FILES = (obj && obj.files) || {};
    API = (obj && obj.api) || {};
    // restore the user's setup (deck, base, config) so it appears on this device too —
    // EXCEPT the check-in log + offline queue, which merge by union so an answer
    // logged on this phone before this pull can never be erased by it
    try {
      const lo = obj && obj.local;
      if (lo && typeof lo === "object") {
        Object.keys(lo).forEach((k) => { if (k.indexOf("money.") === 0 && k !== "money.cloud" && k !== "money.cloudKey" && k !== "money.cloudPaused" && k !== "money.log" && k !== "money.logPending") { try { localStorage.setItem(k, lo[k]); } catch (e) {} } });
        ["money.log", "money.logPending"].forEach(function (key) {
          try {
            var rem = JSON.parse(lo[key] || "[]"); if (!Array.isArray(rem) || !rem.length) return;
            var loc = JSON.parse(localStorage.getItem(key) || "[]");
            var seen = {}; loc.forEach(function (e) { seen[(e.at || 0) + "|" + (e.itemId || "")] = 1; });
            var add = rem.filter(function (e) { return e && !seen[(e.at || 0) + "|" + (e.itemId || "")]; });
            if (add.length) localStorage.setItem(key, JSON.stringify(loc.concat(add)));
          } catch (e) {}
        });
      }
    } catch (e) {}
    try { cloudSave(Object.assign(cloudState(), { lastSeenVault: rec.updated || "" })); } catch (e) {}
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
      // "connected" tells the truth: this cache HAS bank data (synced by the
      // desktop engine) — this device just reads it. An empty vault reads false,
      // which correctly lets the setup wizard greet a brand-new account.
      if (key === "connect-status") return J({ connected: Object.keys(FILES).length > 0, web: true, readonly: true });
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
  var _expiredMsg = "";   // set when an expired session rebuilds the gate as a sign-in
  function buildGate() {
    var st = document.createElement("style");
    st.textContent =
      ".wc-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
      "background:var(--paper,#fff);padding:24px;box-sizing:border-box;transition:opacity .5s ease}" +
      ".wc-card{width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px}" +
      ".wc-brand{font-family:var(--font-mono,ui-monospace,monospace);letter-spacing:.22em;font-size:13px;color:var(--ink,#111);opacity:.7;text-transform:uppercase;text-align:center;margin-bottom:2px}" +
      ".wc-logo{display:block;height:30px;max-width:240px;object-fit:contain;margin:0 auto 4px}" +
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
      ".wc-link{font-size:12px;color:rgba(var(--ink-rgb,17,17,17),.55);text-align:center;cursor:pointer;text-decoration:underline}" +
      ".wc-paths{display:flex;justify-content:center;align-items:center;gap:4px;margin-top:10px;flex-wrap:wrap}" +
      ".wc-paths a{font-size:11.5px;color:rgba(var(--ink-rgb,17,17,17),.55);text-decoration:none;padding:10px 6px}" +
      ".wc-paths a:hover{color:var(--accent,#FFD409);text-decoration:underline}" +
      ".wc-paths span{color:rgba(var(--ink-rgb,17,17,17),.3)}" +
      ".wc-hidden{display:none !important}";
    document.head.appendChild(st);

    var g = document.createElement("div");
    g.className = "wc-gate";
    var s = cloudState();
    var returning = !!(s.token && s.email);
    // the real logo, picked to match the theme: light ink = dark background = white mark
    var ink = 20;
    try { ink = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--ink-rgb")) || 20; } catch (e) {}
    var logo = ink > 127 ? "av%20assets/THECACHE_LOGO_WHITE.png" : "av%20assets/THECACHE_LOGO_BLACK.png";
    g.innerHTML =
      '<div class="wc-card">' +
      '<img class="wc-logo" src="' + logo + '" alt="THE CACHE">' +
      '<h1 class="wc-h">' + (returning ? "Welcome back" : "Open your cache") + '</h1>' +
      '<div class="wc-sub">' + (returning
        ? ("Signed in as " + esc(s.email) + ".")
        : "Encrypted in your browser before it ever leaves. Sign in and your cache follows you.") + '</div>' +
      '<div class="wc-field wc-acct" ' + (returning ? 'style="display:none"' : '') + '><label>Email</label><input id="wcEmail" type="email" autocomplete="username" value="' + esc(s.email || "") + '" placeholder="you@email.com"></div>' +
      '<div class="wc-field wc-acct" ' + (returning ? 'style="display:none"' : '') + '><label>Account password</label><input id="wcPass" type="password" autocomplete="current-password" placeholder="your account password"></div>' +
      '<div class="wc-field wc-phrase wc-hidden"><label>Passphrase (zero-knowledge mode only)</label><input id="wcPhrase" type="password" autocomplete="off" placeholder="only if you set one"></div>' +
      '<div class="wc-row">' +
        (returning
          ? '<button class="wc-btn primary" id="wcUnlock">Unlock my cache</button>'
          : '<button class="wc-btn primary" id="wcLogin">Log in</button><button class="wc-btn" id="wcSignup">Create account</button>') +
      '</div>' +
      '<div class="wc-msg" id="wcMsg"></div>' +
      (returning ? '<div class="wc-link" id="wcSwitch">Use a different account</div>' : '') +
      // paths for the curious — the front door welcomes strangers too
      '<div class="wc-paths">' +
        '<a href="/demo/">try the demo</a><span>·</span>' +
        '<a href="/roadmap/">roadmap</a><span>·</span>' +
        '<a href="https://cozyace.com/the-cache-app" target="_blank" rel="noreferrer">about the artist</a>' +
      '</div>' +
      '</div>';
    document.body.appendChild(g);

    var msg = g.querySelector("#wcMsg");
    function say(t, kind) { msg.textContent = t; msg.className = "wc-msg" + (kind ? " " + kind : ""); }
    function val(id) { var e = g.querySelector(id); return e ? e.value.trim() : ""; }
    function showPhrase() { var p = g.querySelector(".wc-phrase"); if (p) p.classList.remove("wc-hidden"); }

    async function enter(phrase) {
      var res = await pullVault(phrase);
      READY = true; resolveGate();
      if (res.empty) say("✓ Logged in. This account has no synced cache yet — it fills up as you use the app.", "ok");
      g.style.opacity = "0";
      setTimeout(function () { g.remove(); if (window.lucide && window.lucide.createIcons) try { window.lucide.createIcons(); } catch (e) {} }, 520);
    }
    function fail(e) {
      var m = e && e.message;
      if (m === "AUTH") {
        // the returning gate has no Log in button — rebuild as a fresh sign-in
        // gate (email kept) instead of stranding the user on a dead Unlock
        try { cloudSave(Object.assign(cloudState(), { token: "" })); } catch (err) {}
        g.remove();
        _expiredMsg = "Session expired — enter your password to sign back in.";
        buildGate();
        return;
      }
      if (m === "ZK") { showPhrase(); say("This vault is in zero-knowledge mode — enter your passphrase once on this device.", "err"); return; }
      say(m || "Something went wrong.", "err");
    }
    function reveal() {
      var acct = g.querySelectorAll(".wc-acct"); for (var i = 0; i < acct.length; i++) acct[i].style.display = "";
    }

    var unlockBtn = g.querySelector("#wcUnlock");
    if (unlockBtn) unlockBtn.addEventListener("click", async function () {
      say("Unlocking…");
      try { await enter(val("#wcPhrase")); } catch (e) { fail(e); }
    });
    var switchLink = g.querySelector("#wcSwitch");
    if (switchLink) switchLink.addEventListener("click", function () { reveal(); showPhrase(); switchLink.style.display = "none"; say(""); });

    var loginBtn = g.querySelector("#wcLogin");
    if (loginBtn) loginBtn.addEventListener("click", async function () {
      var email = val("#wcEmail"), pass = val("#wcPass");
      if (!email || !pass) { say("Enter your email and account password.", "err"); return; }
      say("Logging in…");
      try { await login(email, pass); await enter(val("#wcPhrase")); } catch (e) { fail(e); }
    });
    var signupBtn = g.querySelector("#wcSignup");
    if (signupBtn) signupBtn.addEventListener("click", async function () {
      var email = val("#wcEmail"), pass = val("#wcPass");
      if (!email || !pass) { say("Pick an email and a password to create your account.", "err"); return; }
      say("Creating your account…");
      try { await signup(email, pass); await enter(val("#wcPhrase")); } catch (e) { fail(e); }
    });

    if (_expiredMsg) { say(_expiredMsg, "err"); _expiredMsg = ""; }
    // returning device: try the silent unlock — escrow vaults (and any device that
    // already holds the data key) open with no typing at all. Zero-knowledge vaults
    // fall through to the passphrase prompt, once per device.
    if (returning) {
      say("Opening your cache…");
      enter("").catch(function (e) { say(""); fail(e); });
    }
  }
  function esc(s) { return (s + "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  if (document.body) buildGate();
  else document.addEventListener("DOMContentLoaded", buildGate);
})();
