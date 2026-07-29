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
  var _pendingRecovery = null;   // set by pullVault when this account still needs a recovery FILE; runPendingRecovery issues it AFTER the app is revealed (never on the unlock's critical path)
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
  // ── Multi-wrap keybox (v2) — the READER side. Must stay byte-identical to app.js's
  // keyboxWraps/keyboxHasEsc/keyboxMode/keyboxOpen or the phone and desktop pick
  // different unlock methods (or the guard fires on one runtime and not the other).
  // Both v1 shapes ({m:"esc"}, {m:"zk"}) still open FOREVER via keyboxWraps' migrate.
  async function _keyboxUnwrap(wrap, secret) {
    var kek = await _deriveKey(secret, _unb64(wrap.salt));
    var raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(wrap.iv) }, kek, _unb64(wrap.ct));
    return _b64(raw);
  }
  function _keyboxParse(box) { return typeof box === "string" ? JSON.parse(box) : box; }
  function keyboxWraps(box) {
    box = _keyboxParse(box);
    if (Array.isArray(box.wraps)) return box.wraps;
    if (box.m === "esc") return [{ t: "esc", k: box.k }];
    if (box.m === "zk") return [{ t: "pass", kdf: box.kdf, iter: box.iter, salt: box.salt, iv: box.iv, ct: box.ct }];
    return [];
  }
  function keyboxHasEsc(box) { return keyboxWraps(box).some(function (w) { return w.t === "esc"; }); }
  function keyboxMode(box) { return keyboxHasEsc(box) ? "esc" : "zk"; }
  // Open ANY keybox → the raw vault key. `opts` is a bare passphrase string
  // (back-compat) OR {passphrase, fileKey, code}. Escrow unlocks silently; a "pass"
  // wrap with no secret in hand throws "ZK" so the caller prompts for the passphrase.
  async function keyboxOpen(boxStr, opts) {
    var box = JSON.parse(boxStr);
    var o = (opts && typeof opts === "object") ? opts : { passphrase: opts || "" };
    var wraps = keyboxWraps(box);
    var find = function (t) { return wraps.find(function (w) { return w.t === t; }); };
    if (o.code && find("code")) return _keyboxUnwrap(find("code"), o.code);
    if (o.fileKey && find("file")) return _keyboxUnwrap(find("file"), o.fileKey);
    if (o.passphrase && find("pass")) return _keyboxUnwrap(find("pass"), o.passphrase);
    var esc = find("esc"); if (esc) return esc.k;              // escrow: the account is the key
    throw new Error("ZK");                                     // no silent method — a secret is needed once on this device
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

  // ── EXP-ledger merge (must match app.js mergeProfileStrings/mergeCharLogStrings) ─
  function wMergeProfile(aStr, bStr) {
    var parse = function (s) { try { return JSON.parse(s || "{}") || {}; } catch (e) { return {}; } };
    var a = parse(aStr), b = parse(bStr);
    var sa = a.stats || {}, sb = b.stats || {};
    var claim = function (s) {
      var by = (s.expBy && typeof s.expBy === "object") ? Object.assign({}, s.expBy) : {};
      var banked = 0; Object.keys(by).forEach(function (k) { banked += (+by[k] || 0); });
      var rest = Math.max(0, (+s.exp || 0) - banked);
      if (rest > 0) { var slot = s.dev || "legacy"; by[slot] = (+by[slot] || 0) + rest; }
      return by;
    };
    var A = claim(sa), B = claim(sb), by = {};
    Object.keys(A).concat(Object.keys(B)).forEach(function (k) { by[k] = Math.max(+A[k] || 0, +B[k] || 0); });
    var total = 0; Object.keys(by).forEach(function (k) { total += by[k]; });
    var bRicher = (+sb.exp || 0) > (+sa.exp || 0);
    var out = Object.assign({}, bRicher ? b : a);
    out.stats = Object.assign({}, bRicher ? sb : sa, { expBy: by, exp: total, clicks: Math.max(+sa.clicks || 0, +sb.clicks || 0) });
    return JSON.stringify(out);
  }
  function wMergeCharLog(aStr, bStr) {
    var parse = function (s) { try { var v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    var a = parse(aStr), b = parse(bStr);
    var seen = {}; a.forEach(function (e) { seen[(e.t || 0) + "|" + (e.k || "") + "|" + (e.d || "")] = 1; });
    var add = b.filter(function (e) { return e && !seen[(e.t || 0) + "|" + (e.k || "") + "|" + (e.d || "")]; });
    if (!add.length) return JSON.stringify(a.slice(-800));
    return JSON.stringify(a.concat(add).sort(function (x, y) { return (x.t || 0) - (y.t || 0); }).slice(-800));
  }
  // accumulators (mirror app.js): badges union, custom-stat marks union, charSince min
  function wMergeBadges(remStr) {
    try {
      var rem = JSON.parse(remStr || "[]"); if (!Array.isArray(rem)) return false;
      var loc = JSON.parse(localStorage.getItem("money.badges") || "[]"); if (!Array.isArray(loc)) loc = [];
      var arr = loc.slice(), set = {}; arr.forEach(function (b) { set[b] = 1; });
      var add = false; rem.forEach(function (b) { if (b != null && !set[b]) { set[b] = 1; arr.push(b); add = true; } });
      if (add) localStorage.setItem("money.badges", JSON.stringify(arr));
      return add;
    } catch (e) { return false; }
  }
  function wMergeCustomStats(remStr) {
    var rem; try { rem = JSON.parse(remStr || "null"); } catch (e) { return false; }
    if (!Array.isArray(rem)) return false;
    var loc; try { loc = JSON.parse(localStorage.getItem("money.customStats") || "null"); } catch (e) { loc = null; }
    if (!Array.isArray(loc)) loc = [];
    var remById = {}; rem.forEach(function (s) { if (s && s.id) remById[s.id] = s; });
    var seen = {};
    var merged = loc.map(function (s) {
      if (!s || !s.id) return s;
      seen[s.id] = 1; var r = remById[s.id]; if (!r) return s;
      var mset = {}; (s.marks || []).concat(r.marks || []).forEach(function (m) { mset[m] = 1; });
      return Object.assign({}, s, { marks: Object.keys(mset).sort() });
    });
    rem.forEach(function (s) { if (s && s.id && !seen[s.id]) merged.push(s); });
    var after = JSON.stringify(merged);
    if (after !== JSON.stringify(loc)) { localStorage.setItem("money.customStats", after); return true; }
    return false;
  }
  // notification read state — per-id newest-wins by `at`, exact tie → UNREAD wins
  // (must match app.js mergeNotifsStr exactly, or phone/desktop settle on different
  // read marks: a union of read ids could never express "mark unread again")
  function wMergeNotifs(remStr) {
    var rem; try { rem = JSON.parse(remStr || "null"); } catch (e) { return false; }
    if (!rem || typeof rem !== "object" || Array.isArray(rem)) return false;
    var loc; try { loc = JSON.parse(localStorage.getItem("money.notifs") || "null"); } catch (e) { loc = null; }
    if (!loc || typeof loc !== "object" || Array.isArray(loc)) loc = {};
    var changed = false;
    Object.keys(rem).forEach(function (id) {
      var r = rem[id]; if (!r || typeof r !== "object") return;
      var ra = +r.at || 0, rr = r.read ? 1 : 0, l = loc[id];
      var la = (l && typeof l === "object") ? (+l.at || 0) : -1;   // never seen here → adopt
      var lr = (l && typeof l === "object") ? (l.read ? 1 : 0) : 1;
      if (ra > la || (ra === la && rr < lr)) { loc[id] = { read: rr, at: ra }; changed = true; }
    });
    if (changed) { try { localStorage.setItem("money.notifs", JSON.stringify(loc)); } catch (e) {} }
    return changed;
  }
  // bug credits: union by report id, keep-local on an id both hold — MUST match
  // app.js mergeBugCreditsStr or the two runtimes fork on what's been claimed
  function wMergeBugCredits(remStr) {
    try {
      var rem = JSON.parse(remStr || "[]"); if (!Array.isArray(rem)) return false;
      var loc = JSON.parse(localStorage.getItem("money.bugCredits") || "[]"); if (!Array.isArray(loc)) loc = [];
      var arr = loc.slice(), seen = {};
      arr.forEach(function (c) { if (c && c.id) seen[c.id] = 1; });
      var add = false;
      rem.forEach(function (c) { if (c && c.id && !seen[c.id]) { seen[c.id] = 1; arr.push({ id: c.id, at: c.at || "", exp: +c.exp || 0 }); add = true; } });
      if (add) localStorage.setItem("money.bugCredits", JSON.stringify(arr));
      return add;
    } catch (e) { return false; }
  }
  function wMergeCharSince(remStr) {
    var rem = parseInt(remStr); if (!rem) return false;
    var loc = parseInt(localStorage.getItem("money.charSince") || "0");
    if (!loc || rem < loc) { localStorage.setItem("money.charSince", String(rem)); return true; }
    return false;
  }
  // ── per-key mtime bookkeeping (must match app.js: same djb2, same key classes) ──
  function wLhash(s) { var h = 5381; s = s || ""; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }
  function _wValWins(a, b) { var ha = wLhash(a), hb = wLhash(b); return ha > hb || (ha === hb && a > b); }   // matches app.js _valWins
  function wLmetaGet() { try { return JSON.parse(localStorage.getItem("money.__lmeta") || "{}") || {}; } catch (e) { return {}; } }
  function wLmetaSet(m) { try { localStorage.setItem("money.__lmeta", JSON.stringify(m)); } catch (e) {} }
  // cloud/identity internals + device-ergonomic geometry (never synced — keeps the
  // phone from snapping to desktop-pixel zoom / sidebar / modal layout on unlock)
  var W_INTERNAL = ["money.cloud", "money.cloudKey", "money.cloudPaused", "money.deviceId", "money.__lmeta", "money.dockMobile", "money.zoom", "money.gutter", "money.sidebar", "money.sidebarWidth", "money.statsScroll", "money.icons.collapsed", "money.balExpanded", "money.settings", "money.connect", "money.wiki", "money.timerRun", "money.deckDay", "money.dms", "money.simplefin", "money.sessionRun", "money.justReset", "money.waterfx", "money.deckRev"];   // deckDay siloed per device; dms never rides the vault; simplefin = the browser bank credential (device-local bearer secret, never in the vault); deckRev RETIRED — MUST match app.js DEVICE_LOCAL_KEYS or it'd sync as a generic key and churn
  var W_SPECIAL = ["money.log", "money.logPending", "money.deck", "money.things", "money.forms", "money.formData", "money.charLog", "money.profile", "money.badges", "money.customStats", "money.charSince", "money.notifs", "money.bugCredits"];   // + forms/formData (reuse wMergeThings) + notifs (per-id newest-wins) + bugCredits (union by report id) — MUST match app.js SPECIAL_MERGE_KEYS
  // ── deck per-item merge — MUST stay byte-identical to app.js mergeDecks/deckCanon/
  //    deckCap, or the phone and desktop settle on different decks. Same rules:
  //    newer `updated` wins · exact tie → tombstone wins · still tied → canonical
  //    content compare (a STRING compare, never a hash — a djb2 would have to agree
  //    across three runtimes' integer math) · position merges on its own `ordAt` clock.
  var W_DECK_LIVE_CAP = 60, W_DECK_TOMB_CAP = 60;
  function wDeckCanon(it) {
    var skip = { updated: 1, ord: 1, ordAt: 1 };
    var walk = function (v) {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") { var o = {}; Object.keys(v).sort().forEach(function (k) { if (!skip[k]) o[k] = walk(v[k]); }); return o; }
      return v;
    };
    try { return JSON.stringify(walk(it || {})); } catch (e) { return ""; }
  }
  function wDeckCap(items) {
    var live = items.filter(function (i) { return !i.deleted; }).slice(0, W_DECK_LIVE_CAP);
    var tomb = items.filter(function (i) { return i.deleted; })
      .sort(function (a, b) { return (+b.updated || 0) - (+a.updated || 0); }).slice(0, W_DECK_TOMB_CAP);
    return live.concat(tomb);
  }
  function wMergeDecks(a, b) {
    var out = {};
    var take = function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (raw) {
        if (!raw || !raw.id) return;
        var it = Object.assign({}, raw), cur = out[it.id];
        if (!cur) { out[it.id] = it; return; }
        var cu = +cur.updated || 0, iu = +it.updated || 0, win = cur;
        if (iu > cu) win = it;
        else if (iu === cu) {
          var cd = !!cur.deleted, idl = !!it.deleted;
          if (idl !== cd) win = idl ? it : cur;
          else if (wDeckCanon(it) > wDeckCanon(cur)) win = it;
        }
        var lose = win === cur ? it : cur, merged = Object.assign({}, win);
        if ((+lose.ordAt || 0) > (+win.ordAt || 0)) { merged.ord = lose.ord; merged.ordAt = lose.ordAt; }
        out[it.id] = merged;
      });
    };
    take(a); take(b);
    var items = Object.keys(out).map(function (k) { return out[k]; });
    items.sort(function (x, y) {
      var dx = +x.ord || 0, dy = +y.ord || 0;
      return dx !== dy ? dx - dy : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });
    return wDeckCap(items);
  }
  // ── money.things per-item merge — MUST stay byte-identical to app.js mergeThings/
  //    thingCanon, or the phone and desktop settle on different Things. Same rules as the
  //    deck (newer `updated` · tombstone wins a tie · canonical STRING compare) with the
  //    two spec changes: a SYMMETRIC ord tie-break and NO live cap (live structure is
  //    durable; tombstones GC'd by age only). VAULT-ONLY, JS-merged — never in store.py.
  function wThingCanon(it) {
    var skip = { updated: 1, ord: 1, ordAt: 1 };
    var walk = function (v) {
      if (v === true) return 1; if (v === false) return 0;
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") { var o = {}; Object.keys(v).sort().forEach(function (k) { if (!skip[k]) o[k] = walk(v[k]); }); return o; }
      return v;
    };
    try { return JSON.stringify(walk(it || {})); } catch (e) { return ""; }
  }
  function wMergeThings(a, b) {
    var out = {};
    var take = function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (raw) {
        if (!raw || !raw.id) return;
        var it = Object.assign({}, raw), cur = out[it.id];
        if (!cur) { out[it.id] = it; return; }
        var cu = +cur.updated || 0, iu = +it.updated || 0, win = cur;
        if (iu > cu) win = it;
        else if (iu === cu) {
          var cd = !!cur.deleted, idl = !!it.deleted;
          if (idl !== cd) win = idl ? it : cur;
          else if (wThingCanon(it) > wThingCanon(cur)) win = it;
        }
        var lose = win === cur ? it : cur, merged = Object.assign({}, win);
        var lo = +lose.ordAt || 0, wo = +win.ordAt || 0;
        if (lo > wo || (lo === wo && (+lose.ord || 0) < (+win.ord || 0))) { merged.ord = lose.ord; merged.ordAt = lose.ordAt; }
        out[it.id] = merged;
      });
    };
    take(a); take(b);
    var items = Object.keys(out).map(function (k) { return out[k]; });
    items.sort(function (x, y) {
      var dx = +x.ord || 0, dy = +y.ord || 0;
      return dx !== dy ? dx - dy : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });
    return items;   // NO cap — live structure durable; tombstones uncapped in v1
  }
  function wIsGeneric(k) { return k.indexOf("money.") === 0 && W_INTERNAL.indexOf(k) === -1 && W_SPECIAL.indexOf(k) === -1; }
  // ── per-account local isolation (mirror of app.js switchAccountData) ─────────
  // On a different-account login the outgoing account's whole local cache is siloed
  // under its userId (outside the money.* namespace, so sync never sees it) and the
  // incoming account's silo is loaded — clean slate if new. Uses the SAME W_INTERNAL
  // classification as app.js so both runtimes agree on what counts as account data.
  var W_PROFILE_PREFIX = "cacheprof.", W_LMETA_KEY = "money.__lmeta";
  function wIsAccountData(k) {
    if (typeof k !== "string" || k.indexOf("money.") !== 0) return false;
    if (W_INTERNAL.indexOf(k) !== -1) return k === "money.dms" || k === "money.simplefin" || k === "money.sessionRun";   // internals aren't account data — except dms (messages), simplefin (BANK CREDENTIAL), and sessionRun (points at this account's session); MUST match app.js isAccountDataKey
    for (var i = 0; i < W_INTERNAL.length; i++) { if (k.indexOf(W_INTERNAL[i] + ".") === 0) return false; }   // a suffixed device key stays device-scoped (money.settings.w modal geometry)
    return true;
  }
  // saves account data + money.__lmeta to the silo, THEN clears the active slot; returns false
  // WITHOUT deleting anything if the silo write fails (quota) so a failed write never loses data.
  function wStashAccount(uid) {
    if (!uid) return false;
    var keys = [], snap = {}, i, k;
    for (i = 0; i < localStorage.length; i++) { k = localStorage.key(i); if (wIsAccountData(k)) keys.push(k); }
    keys.forEach(function (kk) { snap[kk] = localStorage.getItem(kk); });
    var lm = localStorage.getItem(W_LMETA_KEY); if (lm != null) snap[W_LMETA_KEY] = lm;
    var ok = false;
    try { localStorage.setItem(W_PROFILE_PREFIX + uid, JSON.stringify(snap)); ok = true; } catch (e) {}
    if (!ok) return false;
    keys.forEach(function (kk) { try { localStorage.removeItem(kk); } catch (e) {} });
    try { localStorage.removeItem(W_LMETA_KEY); } catch (e) {}
    return true;
  }
  // returns false if any key FAILED to restore (quota) — a silent partial restore would get
  // stashed over the good silo on the next logout; callers abort into a clean parked state
  function wLoadAccount(uid) {
    if (!uid) return true;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(W_PROFILE_PREFIX + uid) || "null"); } catch (e) {}
    if (!saved || typeof saved !== "object") return true;   // new on this device → clean slate
    var ok = true;
    Object.keys(saved).forEach(function (kk) { if (wIsAccountData(kk) || kk === W_LMETA_KEY) { try { localStorage.setItem(kk, saved[kk]); } catch (e) { ok = false; } } });
    return ok;
  }
  // wipe the live account-data slot (incl. __lmeta) without touching device keys or silos —
  // the parked-restore login path clears before loading so nothing scribbled into the empty
  // slot while logged out can blend into the restored account (mirror of app.js clearAccountData)
  function wClearAccount() {
    var i, k, del = [];
    for (i = 0; i < localStorage.length; i++) { k = localStorage.key(i); if (wIsAccountData(k)) del.push(k); }
    del.forEach(function (kk) { try { localStorage.removeItem(kk); } catch (e) {} });
    try { localStorage.removeItem(W_LMETA_KEY); } catch (e) {}
  }
  // set when login() restored a parked silo — the app booted (under the gate) from the empty
  // live slot, so enter() must reload instead of resolving the gate over stale in-memory state
  var _wRestored = false;
  function wStampGeneric(lm) {
    lm = lm || wLmetaGet();
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || !wIsGeneric(k)) continue;
        var v = localStorage.getItem(k), h = wLhash(v), cur = lm[k];
        if (!cur) lm[k] = { m: 0, h: h };
        else if (cur.h !== h) lm[k] = { m: Date.now(), h: h };
      }
    } catch (e) {}
    wLmetaSet(lm);
    return lm;
  }

  // ── cloud account (shares the money.cloud key so app.js Settings shows it too) ─
  function cloudState() { try { return JSON.parse(localStorage.getItem("money.cloud") || "{}") || {}; } catch (e) { return {}; } }
  function cloudSave(s) { localStorage.setItem("money.cloud", JSON.stringify(s)); }
  function cloudUrl() { return ((cloudState().url || CLOUD_DEFAULT) + "").replace(/\/+$/, ""); }
  function errMsg(d) { if (!d) return ""; try { var f = Object.values(d.data || {})[0]; if (f && f.message) return f.message; } catch (e) {} return d.message || ""; }
  // Read a JSON body DEFENSIVELY. A hibernating / suspended PocketHost instance answers with a
  // NON-JSON body (e.g. HTTP 500 "Error: Instances will not run until you upgrade"), and a bare
  // r.json() turns that into a cryptic "Unexpected token … is not valid JSON" that looks like an
  // app bug and blocks login. Returning null lets callers show an honest "cloud is down" message.
  async function readJson(r) { try { return await r.json(); } catch (e) { return null; } }
  var CLOUD_DOWN = "The Cache cloud isn’t responding right now — the sync server may be down or waking up. Nothing is lost; your data is safe. Try again in a minute.";
  async function login(email, pass) {
    var base = cloudUrl();
    var r = await realFetch(base + "/api/collections/users/auth-with-password",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: email, password: pass }) });
    var d = await readJson(r);
    if (!d) throw new Error(CLOUD_DOWN);
    if (!r.ok || !d.token) throw new Error(errMsg(d) || "login failed");
    var prev = cloudState();
    var newUid = d.record && d.record.id;
    if (prev.parked && newUid) {
      // logout PARKED the previous account (app.js cloudLogout siloed its data and cleared the
      // live slot) → RESTORE the incoming account's silo, clean slate if it's new here. Never
      // stash first: the live slot is empty, and stashing it would overwrite the parked
      // account's good silo with nothing. Clear before loading so pre-login scraps can't blend.
      wClearAccount();
      try { window.__cacheStorageSwapped = true; } catch (e) {}   // mute app.js's unload-time savers — their in-memory state predates this swap
      if (!wLoadAccount(newUid)) {
        // restore ran out of storage midway — wipe the partial copy and ABORT; the state is
        // still parked and the silo untouched, so the next login retries a clean restore
        wClearAccount();
        throw new Error("Not enough storage to restore this account safely — free up space and try again. Your data is safe.");
      }
      _wRestored = true;
      if (newUid !== prev.userId) { keySet(""); prev.recordId = null; prev.mode = null; }   // a different account inherits nothing
    } else if (prev.userId && newUid && newUid !== prev.userId) {
      // a different account on a LIVE session → silo its whole local cache FIRST so this account
      // starts clean (nothing blended, nothing lost); if it can't be safely siloed (storage
      // full), ABORT before relabeling the session — otherwise a later backup could seal one
      // account into another's vault.
      if (!wStashAccount(prev.userId)) throw new Error("Not enough storage to switch accounts safely — free up space and try again. Your data is untouched.");
      // the outgoing account is now safely parked — record that BEFORE the restore, so a failed
      // restore aborts into a clean parked state (both silos intact) that self-heals on retry.
      // VERIFY the write landed (a swallowed failure = "live session" over a cleared slot, and
      // the next logout stashes that emptiness over the good silo): if not, un-stash and abort.
      try { cloudSave(Object.assign({}, prev, { token: "", parked: true })); } catch (e) {}
      if (cloudState().parked !== true) { wLoadAccount(prev.userId); throw new Error("Not enough storage to switch accounts safely — free up space and try again. Your data is untouched."); }
      try { window.__cacheStorageSwapped = true; } catch (e) {}
      if (!wLoadAccount(newUid)) { wClearAccount(); throw new Error("Not enough storage to restore this account safely — free up space and try again. Your data is safe."); }
      _wRestored = true;   // live-switch swaps storage too — enter() must reload, even when the incoming vault is empty
      keySet(""); prev.recordId = null; prev.mode = null;
    }
    // `parked` deliberately not carried forward — a successful login always un-parks
    cloudSave({ url: base, token: d.token, email: (d.record && d.record.email) || email, userId: newUid, recordId: prev.recordId, mode: prev.mode || null });
  }
  async function signup(email, pass) {
    var base = cloudUrl();
    var r = await realFetch(base + "/api/collections/users/records",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, password: pass, passwordConfirm: pass }) });
    var d = await r.json();
    if (!r.ok) throw new Error(errMsg(d) || "couldn't create account");
    return login(email, pass);
  }
  // Forgot the ACCOUNT password — PocketBase mails a reset link (public endpoint).
  // Mirror of app.js cloudRequestReset: ⚠️ ENUMERATION-SAFE — never branches on whether
  // the account exists (PocketBase 204s either way, and we fold every 4xx into the same
  // success). Only TRANSPORT problems (offline / rate-limited / server error) differ,
  // and none of those reveal existence. This fn never touches the reset TOKEN — that
  // arrives later in the email link and is handled by the on-brand confirm page below.
  async function requestReset(email) {
    var base = cloudUrl(), r;
    try {
      r = await realFetch(base + "/api/collections/users/request-password-reset",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email }) });
    } catch (e) { throw new Error("offline"); }
    if (r.status === 429) throw new Error("rate");
    if (r.status >= 500) throw new Error("server");
    return true;   // 204 OR any 4xx → same calm answer
  }
  // ── On-brand confirm landing (email verification + password reset) ───────────
  // The PocketBase mail templates point their Action URL at THIS app instead of
  // PocketBase's own admin page: https://thecache.app/#confirm-verification/{TOKEN}
  // and .../#confirm-password-reset/{TOKEN}. We put the token in the URL HASH, never
  // a query string, so it never rides to the server in an access log or a Referer
  // header — and buildConfirmGate strips it from the address bar the instant it reads
  // it. The token is used ONLY in the POST body to PocketBase; it is never stored,
  // never logged.
  var CONFIRM_KINDS = { "confirm-verification": 1, "confirm-password-reset": 1 };
  // Pure parser (unit-tested): "#confirm-password-reset/eyJ..." → {kind, token}.
  // Returns null for anything that isn't one of our known confirm links, so a normal
  // hash (or none) falls straight through to the login gate.
  function parseConfirmHashStr(hash) {
    var h = (hash || "").replace(/^#\/?/, "");     // drop the leading # and an optional /
    var slash = h.indexOf("/");
    if (slash < 0) return null;
    var kind = h.slice(0, slash), token = h.slice(slash + 1);
    if (!token || !CONFIRM_KINDS[kind]) return null;
    try { token = decodeURIComponent(token); } catch (e) {}   // JWTs are URL-safe already; harmless
    return { kind: kind, token: token };
  }
  function parseConfirmHash() { try { return parseConfirmHashStr(location.hash); } catch (e) { return null; } }
  async function confirmVerification(token) {
    var r = await realFetch(cloudUrl() + "/api/collections/users/confirm-verification",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token }) });
    if (r.ok || r.status === 204) return true;
    var d = null; try { d = await r.json(); } catch (e) {}
    throw new Error(errMsg(d) || "this link is invalid or has expired");
  }
  async function confirmPasswordReset(token, password, passwordConfirm) {
    var r = await realFetch(cloudUrl() + "/api/collections/users/confirm-password-reset",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token, password: password, passwordConfirm: passwordConfirm }) });
    if (r.ok || r.status === 204) return true;
    var d = null; try { d = await r.json(); } catch (e) {}
    throw new Error(errMsg(d) || "this link is invalid or has expired");
  }
  // Best-effort email out of the reset token's JWT payload — ONLY to prefill the
  // sign-in email after a reset (a convenience, not a secret). Never throws.
  function confirmTokenEmail(token) {
    try {
      var p = (token || "").split(".")[1] || "";
      var json = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
      return (JSON.parse(json).email || "") + "";
    } catch (e) { return ""; }
  }
  async function pullVault(pass) {
    var s = cloudState();
    if (!s.token) throw new Error("not logged in");
    // The sort must MATCH app.js's VAULT_Q — if the account ever holds two vault records,
    // phone and desktop have to latch the SAME one or they read different vaults.
    // ⚠️ Sort by `id`, NEVER `created`/`updated`: those are autodate fields our collection
    // doesn't define, and PocketBase 400s the whole request when you sort on a field it
    // lacks — which is what locked this gate ("Something went wrong while processing your
    // request." on a dead Unlock button). `id` always exists and is the same on every device.
    var r = await realFetch(cloudUrl() + "/api/collections/vaults/records?perPage=1&sort=id&filter=" +
      encodeURIComponent("owner='" + s.userId + "'"), { headers: { Authorization: s.token } });
    var d = await readJson(r);
    if (r.status === 401 || r.status === 403) throw new Error("AUTH");        // token expired → re-login
    if (!r.ok || !d) throw new Error((d && errMsg(d)) || CLOUD_DOWN);        // suspended/hibernating PocketHost answers with a non-JSON body — say so honestly, don't crash on JSON.parse
    var rec = d.items && d.items[0];
    if (!rec || !rec.blob) { FILES = {}; API = {}; return { empty: true }; }   // account exists, nothing synced yet
    // v2: adopt the data key from the keybox if this device doesn't hold it yet
    if (rec.keybox) {
      var box = JSON.parse(rec.keybox);
      // a zero-knowledge account must never silently accept a keybox whose escrow-ness
      // INCREASED — an esc wrap appearing (v1 {m:"esc"} OR a v2 box now carrying a
      // t:"esc" wrap) is what a tampering server sends to gain read access. keyboxHasEsc
      // sees both shapes, so this is stronger than the old box.m === "esc" check.
      if (cloudState().mode === "zk" && keyboxHasEsc(box)) throw new Error("your vault's key seal changed unexpectedly — open the app on your computer to re-seal it");
      if (!keyGet()) {
        try { keySet(await keyboxOpen(rec.keybox, pass || "")); }
        catch (e) { if ((e && e.message) === "ZK") throw e; throw new Error("wrong passphrase — try again"); }
      }
      try { cloudSave(Object.assign(cloudState(), { mode: keyboxMode(box) })); } catch (e) {}
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
    try { _applyManualOverlay(); } catch (e) {}   // typed-in accounts join Total no matter which device sealed this blob
    // ── Recovery net (DECIDE here, ISSUE later) ─────────────────────────────────────────
    // The vault just OPENED (passphrase/key proven correct). Issuing a recovery file used to
    // only happen from the desktop "Restore from cloud" button, so web-first users had NO net —
    // a forgotten passphrase meant total, permanent loss. We fix that on the web too, BUT the
    // issuing (network PATCHes) must NEVER sit on the unlock's critical path: a cold/slow server
    // would stall login for exactly the legacy accounts this protects. So here we only make a
    // cheap, no-network DECISION and stash it; enter() runs runPendingRecovery() AFTER the app
    // is revealed, so a hang can't block the unlock. One-shot: only when the account has no
    // recovery file yet, so it never nags on later logins.
    _pendingRecovery = null;
    try {
      var bvr = 1; try { bvr = JSON.parse(rec.blob).v || 1; } catch (e) {}
      if (bvr < 2) {
        // LEGACY v1 vault (the passphrase IS the key; no keybox; no recovery possible) →
        // upgrade it to the keybox scheme + mint a recovery file (app.js's tested migration).
        if (pass) _pendingRecovery = { kind: "v1", rec: rec, obj: obj, pass: pass };
      } else if (rec.keybox && keyGet()) {
        var wraps = []; try { wraps = keyboxWraps(rec.keybox); } catch (e) {}
        var hasFile = wraps.some(function (w) { return w.t === "file"; });
        var hasEsc = wraps.some(function (w) { return w.t === "esc"; });
        // ZERO-KNOWLEDGE vaults only. An escrow vault already has a server-held way back in, so
        // the recovery-FILE net (and its "only you can open this" heads-up) simply doesn't apply
        // — issuing one there would also make the modal's copy untrue. Skip it.
        if (!hasFile && !hasEsc) _pendingRecovery = { kind: "v2" };
      }
    } catch (e) { _pendingRecovery = null; }
    // restore the user's setup (deck, base, config) so it appears on this device too —
    // with the SAME per-key merge rules app.js uses, so nothing edited on the phone is
    // ever erased by a stale desktop push adopted on the next unlock:
    //   money.profile → EXP LEDGER: per-device slots, slot-wise max, total = sum
    //   money.charLog → union · money.log/logPending → union, deduped
    //   money.deck → newest revision wins (NOT blind-adopted — that reverted edits)
    //   money.badges → union · money.customStats → union marks · money.charSince → min
    //   everything else → per-key newest-wins by the vault's localMeta mtimes
    //     (a fresh device, which holds no keys, still adopts the whole vault)
    var changed = 0;
    try {
      const lo = obj && obj.local;
      const meta = (obj && obj.localMeta) || {};
      if (lo && typeof lo === "object") {
        // deck: PER-ITEM merge — must be byte-identical to app.js's mergeDecks or the
        // phone and desktop converge on different decks. Written verbatim (an adoption
        // never restamps what it adopts).
        try {
          if (lo["money.deck"] != null) {
            var rem = JSON.parse(lo["money.deck"] || "[]");
            if (Array.isArray(rem)) {
              var curRaw = localStorage.getItem("money.deck") || "[]";
              var loc = []; try { loc = JSON.parse(curRaw) || []; } catch (e) {}
              var mg = JSON.stringify(wMergeDecks(loc, rem));
              if (mg !== curRaw) { localStorage.setItem("money.deck", mg); changed++; }
            }
          }
          localStorage.removeItem("money.deckRev");   // retired — per-item `updated` replaced it
        } catch (e) {}
        try {
          // money.things: PER-ITEM merge — must be byte-identical to app.js's mergeThings
          // or the phone and desktop converge on different Things. Written verbatim.
          if (lo["money.things"] != null) {
            var remT = JSON.parse(lo["money.things"] || "[]");
            if (Array.isArray(remT)) {
              var curRawT = localStorage.getItem("money.things") || "[]";
              var locT = []; try { locT = JSON.parse(curRawT) || []; } catch (e) {}
              var mgT = JSON.stringify(wMergeThings(locT, remT));
              if (mgT !== curRawT) { localStorage.setItem("money.things", mgT); changed++; }
            }
          }
        } catch (e) {}
        // money.forms (templates) + money.formData (submissions): PER-ITEM merge, reusing
        // wMergeThings (byte-identical to app.js mergeThings) so phone + desktop never fork.
        // Written verbatim (an adoption never restamps what it adopts).
        ["money.forms", "money.formData"].forEach(function (key) {
          try {
            if (lo[key] != null) {
              var remF = JSON.parse(lo[key] || "[]");
              if (Array.isArray(remF)) {
                var curRawF = localStorage.getItem(key) || "[]";
                var locF = []; try { locF = JSON.parse(curRawF) || []; } catch (e) {}
                var mgF = JSON.stringify(wMergeThings(locF, remF));
                if (mgF !== curRawF) { localStorage.setItem(key, mgF); changed++; }
              }
            }
          } catch (e) {}
        });
        try {
          if (lo["money.profile"] != null) {
            var curP = localStorage.getItem("money.profile") || "";
            var mergedP = wMergeProfile(curP, lo["money.profile"]);
            if (mergedP !== curP) { localStorage.setItem("money.profile", mergedP); changed++; }
          }
        } catch (e) {}
        try {
          if (lo["money.charLog"] != null) {
            var curC = localStorage.getItem("money.charLog") || "[]";
            var mergedC = wMergeCharLog(curC, lo["money.charLog"]);
            if (mergedC !== curC) { localStorage.setItem("money.charLog", mergedC); changed++; }
          }
        } catch (e) {}
        ["money.log", "money.logPending"].forEach(function (key) {
          try {
            var rem = JSON.parse(lo[key] || "[]"); if (!Array.isArray(rem) || !rem.length) return;
            var loc = JSON.parse(localStorage.getItem(key) || "[]");
            var seen = {}; loc.forEach(function (e) { seen[(e.at || 0) + "|" + (e.itemId || "")] = 1; });
            var add = rem.filter(function (e) { return e && !seen[(e.at || 0) + "|" + (e.itemId || "")]; });
            if (add.length) { localStorage.setItem(key, JSON.stringify(loc.concat(add))); changed++; }
          } catch (e) {}
        });
        try { if (lo["money.badges"] != null && wMergeBadges(lo["money.badges"])) changed++; } catch (e) {}
        try { if (lo["money.customStats"] != null && wMergeCustomStats(lo["money.customStats"])) changed++; } catch (e) {}
        try { if (lo["money.bugCredits"] != null && wMergeBugCredits(lo["money.bugCredits"])) changed++; } catch (e) {}
        try { if (lo["money.charSince"] != null && wMergeCharSince(lo["money.charSince"])) changed++; } catch (e) {}
        try { if (lo["money.notifs"] != null && wMergeNotifs(lo["money.notifs"])) changed++; } catch (e) {}   // notification read state (per-id newest-wins)
        // everything else → per-key newest-wins (was: blind adopt on every unlock,
        // which reverted phone-local note / theme / layout / config edits every visit)
        try {
          var lm = wStampGeneric();
          Object.keys(lo).forEach(function (k) {
            if (!wIsGeneric(k)) return;
            var vm = (+meta[k]) || 0;
            var has = localStorage.getItem(k) !== null;
            var localM = has ? ((lm[k] && +lm[k].m) || 0) : -1;
            var cur = has ? localStorage.getItem(k) : null;
            // strict-newer wins; exact-mtime tie broken by the same deterministic total
            // order as app.js (_valWins) so phone + desktop converge, never flip-flop
            var adopt = vm > localM || (vm === localM && has && cur !== lo[k] && _wValWins(lo[k], cur));
            if (adopt) {
              try {
                if (cur !== lo[k]) { localStorage.setItem(k, lo[k]); changed++; }
                lm[k] = { m: vm, h: wLhash(lo[k]) };
              } catch (e) {}
            }
          });
          wLmetaSet(lm);
        } catch (e) {}
      }
    } catch (e) {}
    try { cloudSave(Object.assign(cloudState(), { lastSeenVault: rec.updated || "" })); } catch (e) {}
    // the app booted from the OLD storage before this pull landed (its in-memory
    // EXP/layout/theme would clobber the restore on the next save) — one clean
    // reload boots it from the synced truth. Guarded so it can never loop.
    if (changed) {
      var last = 0; try { last = parseInt(sessionStorage.getItem("wcReloaded")) || 0; } catch (e) {}
      if (Date.now() - last > 30000) {
        try { sessionStorage.setItem("wcReloaded", String(Date.now())); } catch (e) {}
        try { window.__cacheStorageSwapped = true; } catch (e) {}   // the merge changed storage under the booted app — mute its unload-time savers so they can't stomp it during this reload
        location.reload();
        return { empty: false, reloading: true };
      }
      // reload suppressed — re-seat app.js's live stats so its next save can't
      // stomp the just-merged profile (the hook may not exist yet on the very
      // first unlock, in which case the app boots from merged storage anyway)
      try { if (window.__cacheRehydrateStats) window.__cacheRehydrateStats(); } catch (e) {}
    }
    return { empty: false, count: Object.keys(FILES).length };
  }

  // Issue the pending recovery file AFTER the app is revealed — decidedly OFF the unlock's
  // critical path (called fire-and-forget from enter(), never awaited before resolveGate).
  // Reuses app.js's tested crypto (window globals; app.js is a classic deferred script, fully
  // loaded by the time any unlock completes). Stashes the file secret for the calm one-shot
  // modal (maybeRecoveryHeadsUp in app.js) and triggers it. NEVER blocks and never nags: a
  // slow/failed issue just means no file THIS session — the next unlock retries (the account
  // still has no file wrap), and Settings → Cache cloud → Recovery file is the manual fallback.
  async function runPendingRecovery() {
    var pend = _pendingRecovery; _pendingRecovery = null;
    if (!pend) return;
    try {
      var recSecret = "";
      if (pend.kind === "v1" && pend.pass && typeof window.cloudMigrateV1IfNeeded === "function") {
        var mig = await window.cloudMigrateV1IfNeeded(pend.rec, pend.obj, pend.pass);
        if (mig && mig.ok && mig.fileSecret) recSecret = mig.fileSecret;
      } else if (pend.kind === "v2" && typeof window.cloudAddRecoveryFile === "function") {
        var sec = await window.cloudAddRecoveryFile();   // adds only a file wrap — the blob is never touched
        if (sec) recSecret = sec;
      }
      if (recSecret) {
        // no worse an exposure than money.cloudKey (already in localStorage); the modal clears
        // it the instant it hands the file over. Presence of the secret IS the "show me" signal.
        try { sessionStorage.setItem("cache.recoverySecret", recSecret); } catch (e) {}
        setTimeout(function () { try { if (window.__cacheRecoveryHeadsUp) window.__cacheRecoveryHeadsUp(); } catch (e) {} }, 420);
      }
    } catch (e) { /* issue failed — vault untouched, app usable; retry next unlock or via Settings */ }
  }

  // ── browser CSV-import bridge ────────────────────────────────────────────────
  // The web money engine (webmoney.js) reads/writes the decrypted money files THROUGH here,
  // so it never sees the crypto and webcache never sees the compute. MONEY_LIVE flips true
  // once an import has written money this session → /api/summary is then computed live from
  // the ledger (so the imported data shows AND period-switching works). A desktop-synced
  // cache with a precomputed API.summary and no web import is served UNCHANGED.
  var MONEY_LIVE = false;
  window.__cacheWebMoney = {
    getFiles: function () { return FILES; },
    // replace the money files and flip live-compute on. The stale precomputed summary (if
    // any) is dropped so serve() computes /api/summary live from the new ledger.
    commit: function (newFiles) {
      if (newFiles) Object.keys(newFiles).forEach(function (n) { FILES[n] = newFiles[n]; });
      delete API.summary;
      MONEY_LIVE = true;
    },
  };
  function _qsParams(url) {
    var out = {}, q = url.split("?")[1] || "";
    q.split("&").forEach(function (p) { if (!p) return; var kv = p.split("="); out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ""); });
    return out;
  }
  // ── web categorize / income tagging ──────────────────────────────────────────
  // The categorizer views (merchants / deposits / other-merchants) compute LIVE from the
  // vault's own files, and POST /api/categorize + /api/income WRITE here in the browser:
  // update the served map, recompute the money blocks (webmoney), and queue the edit as a
  // PENDING map edit that the next cloud push folds onto the vault's FRESHEST copy with a
  // per-key filesMeta stamp (merge_maps newest-per-key semantics) — so a concurrent tag
  // made on the desktop is never clobbered, and every device converges. Before this, a
  // web-only user could SEE money but never categorize it ("no data — sync first" ×3 in
  // the beta inbox).
  var PENDING_MAP_EDITS = [];
  function _moneyCtx() {
    var ov = {}, io = {}, cm = {};
    try { ov = JSON.parse(FILES["categories.json"] || "{}") || {}; } catch (e) {}
    try { io = JSON.parse(FILES["income.json"] || "{}") || {}; } catch (e) {}
    try { cm = JSON.parse(FILES["catmeta.json"] || "{}") || {}; } catch (e) {}
    return { overrides: ov, incomeOverrides: io, remap: cm.remap || {}, catmetaLabels: cm.labels || {} };
  }
  function _windowTxns() {
    // the desktop views read transactions.json (the recent window) — mirror that; a
    // CSV-only cache may lack it, so fall back to the full ledger
    try { var tj = JSON.parse(FILES["transactions.json"] || "{}"); if (tj && tj.transactions && tj.transactions.length) return tj.transactions; } catch (e) {}
    try {
      var led = window.CacheMoney.parseJsonl(FILES["ledger.jsonl"] || "");
      return Object.keys(led).map(function (k) { return led[k]; });
    } catch (e) { return []; }
  }
  function _applyMapEdit(file, key, value) {
    key = (key || "").trim();
    // merchant-key files use lowercased substring keys; ID-keyed files (account roles,
    // manual accounts) must keep their exact case or web and desktop key different rows
    if (file !== "account_roles.json" && file !== "manual_accounts.json") key = key.toLowerCase();
    if (!key) return false;
    var m = {}; try { m = JSON.parse(FILES[file] || "{}") || {}; } catch (e) {}
    if (value === null) delete m[key]; else m[key] = value;
    FILES[file] = JSON.stringify(m, null, 2);
    PENDING_MAP_EDITS.push({ file: file, key: key, value: value, at: Date.now() });
    return true;
  }
  function _recomputeMoney() {
    // rebuildFromLedger mirrors recompute_spending + recompute_income (it reads the maps
    // straight from the files — including the edit we just wrote — and PRESERVES the
    // balances header: total/cash/accounts/updated survive untouched)
    if (FILES["ledger.jsonl"] == null) return;   // no money to recompute (and never wipe a header with zeros)
    var out = window.CacheMoney.rebuildFromLedger(FILES, {});
    if (window.__cacheWebMoney) window.__cacheWebMoney.commit(out);
    else Object.keys(out || {}).forEach(function (n) { FILES[n] = out[n]; });
  }
  // overlay the manual accounts onto the served balances (mirror store.recompute_manual):
  // strip prior manual rows, re-append the live ones, re-derive total/cash. Runs after any
  // manual edit AND after every vault pull — so totals are honest no matter which device
  // (or which app version) sealed the blob.
  function _applyManualOverlay() {
    var man = {}; try { man = JSON.parse(FILES["manual_accounts.json"] || "{}") || {}; } catch (e) { return; }
    var bal; try { bal = JSON.parse(FILES["balances.json"] || "{}") || {}; } catch (e) { return; }
    if (!Object.keys(man).length && !(bal.accounts || []).some(function (a) { return a && a.manual; })) return;   // nothing to do
    var synced = (bal.accounts || []).filter(function (a) { return !(a && a.manual); });
    var ids = Object.keys(man).sort();
    ids.forEach(function (k) {
      var v = man[k];
      if (!v || typeof v !== "object" || v.removed) return;
      synced.push({ id: "manual:" + k, name: v.name || "Manual account", org: "manual",
        balance: Math.round((parseFloat(v.balance) || 0) * 100) / 100, currency: "USD",
        manual: true, as_of: v.as_of || "", apr: v.apr != null ? v.apr : null });
    });
    var total = 0, cash = 0;
    synced.forEach(function (a) { var b = parseFloat(a.balance) || 0; total += b; if (b > 0) cash += b; });
    bal.accounts = synced;
    bal.total = Math.round(total * 100) / 100;
    bal.cash = Math.round(cash * 100) / 100;
    bal.rev = (parseInt(bal.rev, 10) || 0) + 1;   // widgets key re-pulls on rev — Total must move NOW
    FILES["balances.json"] = JSON.stringify(bal, null, 2);
  }
  window.__cacheManualOverlay = _applyManualOverlay;   // pullVault re-runs it after adopting a fresh blob
  window.__cacheMapEdits = {
    pending: function () { return PENDING_MAP_EDITS.slice(); },
    // fold the pending edits onto the vault's freshest files, newest-per-key: if another
    // device stamped this exact key LATER than our edit, theirs wins and ours retires.
    applyToVault: function (files, filesMeta) {
      if (!PENDING_MAP_EDITS.length) return null;
      var applied = [];
      PENDING_MAP_EDITS.forEach(function (e) {
        var fm = filesMeta[e.file] = filesMeta[e.file] || {};
        if ((+fm[e.key] || 0) > e.at) { applied.push(e); return; }   // superseded — retire without writing
        var m = {}; try { m = JSON.parse(files[e.file] || "{}") || {}; } catch (er) {}
        if (e.value === null) delete m[e.key]; else m[e.key] = e.value;
        files[e.file] = JSON.stringify(m, null, 2);
        fm[e.key] = e.at;
        applied.push(e);
      });
      return applied;
    },
    // confirmed only after the sealed upload lands — a failed push keeps edits retryable
    confirmSealed: function (applied) {
      var ids = {}; (applied || []).forEach(function (e) { ids[e.file + " " + e.key + " " + e.at] = 1; });
      PENDING_MAP_EDITS = PENDING_MAP_EDITS.filter(function (e) { return !ids[e.file + " " + e.key + " " + e.at]; });
    },
  };
  function _liveSummary(url) {
    var p = _qsParams(url);
    var led = window.CacheMoney.parseJsonl(FILES["ledger.jsonl"] || "");
    var txns = Object.keys(led).map(function (k) { return led[k]; });
    var bal; try { bal = JSON.parse(FILES["balances.json"] || "{}"); } catch (e) { bal = {}; }
    var cm; try { cm = JSON.parse(FILES["catmeta.json"] || "{}"); } catch (e) { cm = {}; }
    var ov; try { ov = JSON.parse(FILES["categories.json"] || "{}"); } catch (e) { ov = {}; }
    var io; try { io = JSON.parse(FILES["income.json"] || "{}"); } catch (e) { io = {}; }
    return window.CacheMoney.periodSummary(txns,
      // start/end are YYYY-MM-DD STRINGS (periodQS emits them so; resolvePeriod splits on "-").
      // Coercing with +p.start gave NaN → the custom branch was skipped and a custom range
      // silently fell back to the current calendar month. Pass the raw strings through.
      { kind: p.kind || "mtd", ym: p.ym || null, start: p.start || null, end: p.end || null },
      { balances: bal, overrides: ov, incomeOverrides: io, remap: cm.remap || {}, catmetaLabels: cm.labels || {} });
  }

  // ── serve app data from the decrypted store ──────────────────────────────────
  function J(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } }); }
  function serve(url, method, body) {
    var M = (method || "GET").toUpperCase();
    var dm = url.match(/data\/([\w.-]+\.json)/);
    if (dm) { var nm = dm[1]; return FILES[nm] != null ? new Response(FILES[nm], { status: 200, headers: { "Content-Type": "application/json" } }) : J({}); }
    if (url.indexOf("/api/") !== -1) {
      var key = url.split("/api/")[1].split("?")[0].replace(/\/+$/, "");
      if (key === "ping") return J({ ok: true, founder: false, web: true });
      // "connected" tells the truth: this cache HAS bank data (synced by the desktop engine
      // OR imported here from a CSV) — an empty vault reads false, which correctly lets the
      // setup wizard greet a brand-new account. `readonly` stays true: everything BUT CSV
      // import is still desktop-only (categorize / tag / delete route through the gate).
      if (key === "connect-status") return J({ connected: Object.keys(FILES).length > 0 || MONEY_LIVE, web: true, readonly: true });
      if (key === "update-check") return J({ ok: true, available: false, current: "web" });
      if (key === "export-data") return J({ ok: true, files: FILES, api: API, exported: 0, count: Object.keys(FILES).length });
      if (key === "webdav-config") return J({ ok: true, configured: false, url: "", user: "" });
      // the dashboard's single feed: after a web import (or when the vault has a ledger but
      // no precomputed summary) compute it live from the ledger, so imported money shows and
      // the period selector works. Otherwise serve the desktop-precomputed one, unchanged.
      if (M === "GET" && key === "summary" && window.CacheMoney) {
        if (MONEY_LIVE || (API.summary == null && FILES["ledger.jsonl"] != null)) {
          try { return J(_liveSummary(url)); } catch (e) {}
        }
      }
      // categorizer views — LIVE from the vault's own files whenever it holds transactions,
      // so a web-only bank/CSV cache gets real lists (and a local tag reflects instantly);
      // an empty vault falls through to the desktop-precomputed bundle / the ok-stub.
      if (M === "GET" && window.CacheMoney && (key === "merchants" || key === "other-merchants" || key === "deposits")) {
        var wtx = _windowTxns();
        if (wtx.length) {
          var cx = _moneyCtx();
          try {
            if (key === "merchants") return J({ merchants: window.CacheMoney.topMerchants(wtx, cx.overrides, cx.remap) });
            if (key === "other-merchants") return J({ merchants: window.CacheMoney.otherMerchants(wtx, cx.overrides, cx.remap) });
            return J({ deposits: window.CacheMoney.depositSources(wtx, cx.incomeOverrides, cx.overrides, cx.remap) });
          } catch (e) {}
        }
      }
      // annual predictions read the FULL ledger (a year of history), not the 30d window
      if (M === "GET" && key === "annuals" && window.CacheMoney) {
        try {
          var led2 = window.CacheMoney.parseJsonl(FILES["ledger.jsonl"] || "");
          var all2 = Object.keys(led2).map(function (k) { return led2[k]; });
          return J({ annuals: window.CacheMoney.annualPredictions(all2) });
        } catch (e) {}
      }
      // the paycheck-runway anchor — income rhythm read live from the ledger
      if (M === "GET" && key === "runway" && window.CacheMoney) {
        try {
          var led3 = window.CacheMoney.parseJsonl(FILES["ledger.jsonl"] || "");
          var all3 = Object.keys(led3).map(function (k) { return led3[k]; });
          var cx3 = _moneyCtx();
          return J({ next_deposit: window.CacheMoney.nextDeposit(all3, cx3.incomeOverrides, cx3.overrides, cx3.remap) });
        } catch (e) {}
      }
      // subs decisions live in the vault's own file — serve THAT (the API bundle can lag it,
      // and a web-only cache has no bundle at all; without this, every boot forgot your tags)
      if (M === "GET" && key === "subs" && FILES["subs.json"] != null) {
        try { return J({ ok: true, subs: JSON.parse(FILES["subs.json"]) || {} }); } catch (e) {}
      }
      if (M === "GET" && API[key] != null) return J(API[key]);
      if (M === "GET") return J({ ok: true });
      // subs WRITE (the Finances portal's status/order edits + the Money Map's toggles):
      // the client posts the WHOLE map — diff it against the served copy so only the keys
      // that actually changed queue as pending per-key edits (newest-per-key at push time)
      if (M === "POST" && key === "subs") {
        var sdata = {}; try { sdata = JSON.parse(body || "{}") || {}; } catch (e) {}
        var next = (sdata && typeof sdata.subs === "object" && sdata.subs) || {};
        var prev = {}; try { prev = JSON.parse(FILES["subs.json"] || "{}") || {}; } catch (e) {}
        Object.keys(next).forEach(function (k) {
          if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) _applyMapEdit("subs.json", k, next[k]);
        });
        Object.keys(prev).forEach(function (k) {
          if (next[k] === undefined) _applyMapEdit("subs.json", k, null);   // untracked → key removed
        });
        return J({ ok: true, subs: next });
      }
      // categorize + income tags WRITE here in the browser (see the pending-edits block above)
      if (M === "POST" && (key === "categorize" || key === "income") && window.CacheMoney) {
        var data = {}; try { data = JSON.parse(body || "{}") || {}; } catch (e) {}
        try {
          var okw;
          if (key === "categorize") okw = _applyMapEdit("categories.json", data.merchant, data.category || "other");
          else {
            var st = data.status;
            okw = _applyMapEdit("income.json", data.source, (st === "income" || st === "ignore") ? st : null);
          }
          if (!okw) return J({ ok: false, error: "bad request" });
          _recomputeMoney();
          var nb = {}; try { nb = JSON.parse(FILES["balances.json"] || "{}") || {}; } catch (e) {}
          return J(key === "categorize" ? { ok: true, spending: nb.spending || {} } : { ok: true, income: nb.income || {} });
        } catch (e) {
          return J({ ok: false, error: "couldn't save that tag — " + ((e && e.message) || "unknown error") });
        }
      }
      // account roles — classify what an account IS; a per-key synced map edit like the rest
      if (M === "POST" && key === "account-role") {
        var rdata = {}; try { rdata = JSON.parse(body || "{}") || {}; } catch (e) {}
        var rid = (rdata.id || "").trim();
        if (!rid) return J({ ok: false, error: "bad request" });
        var ROLE_SET = { liquid: 1, short: 1, long: 1, untouchable: 1 };
        _applyMapEdit("account_roles.json", rid, ROLE_SET[rdata.role] ? rdata.role : null);
        var rmap = {}; try { rmap = JSON.parse(FILES["account_roles.json"] || "{}") || {}; } catch (e) {}
        return J({ ok: true, roles: rmap });
      }
      // manual accounts (Money Truth Brick 4) — typed balances WRITE here too: the map file
      // updates + queues as a pending edit (newest-per-key on the account id), and the served
      // balances re-overlay so Total moves NOW. _applyManualOverlay re-runs after every pull,
      // so a vault sealed by a device that hasn't recomputed still serves honest totals.
      if (M === "POST" && key === "manual-account") {
        var mdata = {}; try { mdata = JSON.parse(body || "{}") || {}; } catch (e) {}
        var mid = (mdata.id || "").trim();
        if (!mid) return J({ ok: false, error: "bad request" });
        var cur = {}; try { cur = (JSON.parse(FILES["manual_accounts.json"] || "{}") || {})[mid] || {}; } catch (e) {}
        var val;
        if (mdata.remove) val = { name: cur.name || "", removed: 1 };
        else {
          var apr = null;
          if (mdata.apr != null && mdata.apr !== "") { apr = Math.round(parseFloat(mdata.apr) * 100) / 100; if (!isFinite(apr)) apr = null; }
          val = { name: String(mdata.name || cur.name || "Manual account").slice(0, 60),
                  balance: Math.round((parseFloat(mdata.balance != null ? mdata.balance : cur.balance) || 0) * 100) / 100,
                  apr: apr, as_of: new Date().toISOString().slice(0, 10) };
        }
        _applyMapEdit("manual_accounts.json", mid, val);
        _applyManualOverlay();
        var nb2 = {}; try { nb2 = JSON.parse(FILES["balances.json"] || "{}") || {}; } catch (e) {}
        return J({ ok: true, accounts: nb2.accounts || [], total: nb2.total, cash: nb2.cash });
      }
      // other writes aren't supported on the web yet — desktop-only for now
      return J({ ok: false, web: true, error: "Editing from the web is coming soon — for now, changes are made in the desktop app and synced here." });
    }
    return J({ ok: true });
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var isApp = !/^https?:\/\//i.test(url) && (url.indexOf("/api/") !== -1 || url.indexOf("data/") !== -1);
    if (isApp) {
      var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
      var body = (init && init.body) || null;   // POST categorize/income read their JSON body
      return READY ? Promise.resolve(serve(url, method, body)) : gate.then(function () { return serve(url, method, body); });
    }
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error("offline"));
  };

  // ── the login / unlock gate ──────────────────────────────────────────────────
  var _expiredMsg = "";   // set when an expired session rebuilds the gate as a sign-in
  var _gateStylesInjected = false;
  function ensureGateStyles() {
    if (_gateStylesInjected) return;
    _gateStylesInjected = true;
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
      ".wc-forgot{text-align:center;margin-top:2px}" +
      ".wc-forgot-panel{display:flex;flex-direction:column;gap:8px;margin-top:8px;text-align:left;padding-top:10px;border-top:1px solid var(--edge,#ddd)}" +
      ".wc-forgot-panel .wc-sub{text-align:left;margin:0}" +
      "#wcForgotSend:disabled{opacity:.55;cursor:default}" +
      // on-brand confirm page (email verification / password reset landing)
      ".wc-confirm-mark{font-size:34px;text-align:center;line-height:1;margin-bottom:2px}" +
      ".wc-confirm-actions{display:flex;flex-direction:column;gap:8px;margin-top:4px}" +
      ".wc-btn:disabled{opacity:.55;cursor:default}" +
      ".wc-hidden{display:none !important}";
    document.head.appendChild(st);
  }
  function buildGate() {
    ensureGateStyles();

    var g = document.createElement("div");
    g.className = "wc-gate";
    var s = cloudState();
    var returning = !!(s.token && s.email);
    // "Use a different account…" left a one-shot flag before its logout reload: show the
    // sign-in with a BLANK email so it's obvious any account can enter (it normally
    // prefills the previous account's address, which read as "only I can log in here")
    var switching = false;
    try { if (sessionStorage.getItem("cache.switchAcct") === "1") { switching = true; sessionStorage.removeItem("cache.switchAcct"); } } catch (e) {}
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
        : "Your cache is encrypted on this device before it syncs, and follows you when you sign in. Set a passphrase for zero-knowledge mode, where only you can open it.") + '</div>' +
      '<div class="wc-field wc-acct" ' + (returning ? 'style="display:none"' : '') + '><label>Email</label><input id="wcEmail" type="email" autocomplete="username" value="' + (switching ? "" : esc(s.email || "")) + '" placeholder="you@email.com"></div>' +
      '<div class="wc-field wc-acct" ' + (returning ? 'style="display:none"' : '') + '><label>Account password</label><input id="wcPass" type="password" autocomplete="current-password" placeholder="your account password"></div>' +
      '<div class="wc-field wc-phrase wc-hidden"><label>Passphrase (zero-knowledge mode only)</label><input id="wcPhrase" type="password" autocomplete="off" placeholder="only if you set one"></div>' +
      '<div class="wc-row">' +
        (returning ? '<button class="wc-btn primary" id="wcUnlock">Unlock my cache</button>' : '') +
        // Always RENDERED (just hidden while the silent unlock is expected to work). A
        // returning gate that renders no sign-in button at all is a dead end: any failure
        // strands the user on "Unlock my cache" with nothing else to click and no way to
        // type their key. fail() and the switch link reveal these.
        '<button class="wc-btn primary wc-acct" id="wcLogin"' + (returning ? ' style="display:none"' : '') + '>Log in</button>' +
        '<button class="wc-btn wc-acct" id="wcSignup"' + (returning ? ' style="display:none"' : '') + '>Create account</button>' +
      '</div>' +
      '<div class="wc-msg" id="wcMsg"></div>' +
      // Forgot your ACCOUNT password? Rides with the .wc-acct group (hidden on the returning
      // gate until "Use a different account" reveals the sign-in fields). Honest about the
      // two secrets: a reset gets you into the account, not into a passphrase-sealed vault.
      '<div class="wc-forgot wc-acct"' + (returning ? ' style="display:none"' : '') + '>' +
        '<div class="wc-link" id="wcForgot">Forgot password?</div>' +
        '<div class="wc-forgot-panel wc-hidden" id="wcForgotPanel">' +
          '<div class="wc-sub">We’ll email you a link to set a new password. A reset gets you back into your <b>account</b> — if you sealed your cache with a <b>passphrase</b> (zero-knowledge), you’ll still need your <b>recovery file or code</b> to open your data.</div>' +
          '<div class="wc-field"><label>Email</label><input id="wcForgotEmail" type="email" autocomplete="off" placeholder="you@email.com"></div>' +
          '<button class="wc-btn" id="wcForgotSend">Send reset link</button>' +
          '<div class="wc-msg" id="wcForgotMsg"></div>' +
        '</div>' +
      '</div>' +
      (returning ? '<div class="wc-link" id="wcSwitch">Use a different account</div>' : '') +
      // paths for the curious — the front door welcomes strangers too
      '<div class="wc-paths">' +
        '<a href="/demo/">try the demo</a><span>·</span>' +
        '<a href="/roadmap/">roadmap</a><span>·</span>' +
        '<a href="/status/">status</a><span>·</span>' +
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
      if (res && res.reloading) return;   // pullVault is already rebooting from the merged storage
      if (_wRestored) {
        // this login restored a parked silo AFTER the app booted from the empty live slot —
        // reload so the board comes up as the restored account, never the stale empty state
        // (pullVault has already persisted the vault key, so the reload unlocks silently)
        say("✓ Logged in — loading your cache…", "ok");
        location.reload();
        return;
      }
      READY = true; resolveGate();
      // Now that the app is REVEALED, issue any pending recovery file off the critical path
      // (fire-and-forget — never awaited, so a slow server can't stall the unlock). It stashes
      // the file secret and pops the calm one-shot modal. Also nudge the modal directly in case
      // a secret is already stashed from a prior session (issued, then reloaded before shown);
      // both paths are idempotent — the modal consumes the secret and guards on its own id.
      try { runPendingRecovery(); } catch (e) {}
      try { if (window.__cacheRecoveryHeadsUp) setTimeout(window.__cacheRecoveryHeadsUp, 480); } catch (e) {}
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
      // ANY other failure (server hiccup, offline, a query the server rejects) used to
      // just print the message and stop — on the returning gate that left a dead Unlock
      // button, a hidden passphrase field and no sign-in form. The user could not get in
      // at all. Never strand: always open the manual doors so there IS a way through.
      say(m || "Something went wrong.", "err");
      if (returning) { showPhrase(); reveal(); }
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
    // a real account switch: reveal the email/password/passphrase fields AND the Log in
    // button that actually uses them. (It used to reveal the fields but leave only
    // "Unlock my cache", which ignores them — so switching accounts was impossible.)
    if (switchLink) switchLink.addEventListener("click", function () {
      reveal(); showPhrase();
      switchLink.style.display = "none";
      if (unlockBtn) unlockBtn.style.display = "none";   // unlocking the OLD session is not what "different account" means
      say("");
    });

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

    // ── Forgot the account password ──────────────────────────────────────────
    var forgot = g.querySelector("#wcForgot"), forgotPanel = g.querySelector("#wcForgotPanel"),
        forgotEmail = g.querySelector("#wcForgotEmail"), forgotSend = g.querySelector("#wcForgotSend"),
        forgotMsg = g.querySelector("#wcForgotMsg");
    function fSay(t, kind) { if (!forgotMsg) return; forgotMsg.textContent = t; forgotMsg.className = "wc-msg" + (kind ? " " + kind : ""); }
    var _fLeft = 0, _fTimer = null;
    function fCooldown(secs) {
      _fLeft = secs; if (_fTimer) clearInterval(_fTimer);
      function tick() {
        if (!forgotSend) return;
        if (_fLeft <= 0) { clearInterval(_fTimer); _fTimer = null; forgotSend.disabled = false; forgotSend.textContent = "Send reset link"; return; }
        forgotSend.disabled = true; forgotSend.textContent = "Resend in " + _fLeft + "s"; _fLeft--;
      }
      tick(); _fTimer = setInterval(tick, 1000);
    }
    if (forgot) forgot.addEventListener("click", function () {
      if (!forgotPanel) return;
      var open = !forgotPanel.classList.contains("wc-hidden");
      forgotPanel.classList.toggle("wc-hidden", open);
      if (!open && forgotEmail) { forgotEmail.value = val("#wcEmail"); fSay(""); try { forgotEmail.focus(); } catch (e) {} }
    });
    if (forgotSend) forgotSend.addEventListener("click", async function () {
      if (forgotSend.disabled) return;   // mid-cooldown — debounced
      var em = forgotEmail ? forgotEmail.value.trim() : "";
      if (!em || em.indexOf("@") < 0) { fSay("Enter the email for your account.", "err"); return; }
      forgotSend.disabled = true;   // in-flight: block a double-click firing a second request (and the user's own 429)
      fSay("Sending…");
      try {
        await requestReset(em);
        fSay("If that email has an account, a reset link is on its way. Open it, set a new password, then come back and log in.", "ok");
        fCooldown(45);   // keeps it disabled + counts down a resend cooldown
      } catch (e) {
        forgotSend.disabled = false;   // a transport error — let them retry
        var m = e && e.message;
        if (m === "rate") fSay("Hold on a moment before requesting another reset link.", "err");
        else if (m === "offline") fSay("Couldn’t reach the cloud — check your connection and try again.", "err");
        else fSay("The cloud had a hiccup — try again in a moment.", "err");
      }
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
  function esc(s) { return (s + "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }   // escapes ' too (single-quoted attrs) — lockstep with app.js escapeHtml

  // The on-brand confirm landing — shown INSTEAD of the login gate when the URL carries a
  // confirm hash. Takes precedence over any returning session, so a reset link always lets
  // you set a new password even if a stale token is cached on this device.
  function buildConfirmGate(kind, token) {
    ensureGateStyles();
    // Strip the token from the address bar immediately — a reset token is as sensitive as a
    // password and must not linger in the URL, browser history, or a bookmark. (It was in the
    // HASH, so it never reached a server log or Referer in the first place; this clears the bar.)
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}

    var ink = 20;
    try { ink = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--ink-rgb")) || 20; } catch (e) {}
    var logo = ink > 127 ? "av%20assets/THECACHE_LOGO_WHITE.png" : "av%20assets/THECACHE_LOGO_BLACK.png";
    var isReset = kind === "confirm-password-reset";

    var g = document.createElement("div");
    g.className = "wc-gate";
    g.innerHTML =
      '<div class="wc-card">' +
      '<img class="wc-logo" src="' + logo + '" alt="THE CACHE">' +
      '<h1 class="wc-h" id="wcCfH">' + (isReset ? "Set a new password" : "Verifying your email…") + '</h1>' +
      '<div class="wc-sub" id="wcCfSub">' + (isReset
        ? "Choose a new password for your Cache account. This doesn’t change how your data is sealed — if your cache is zero-knowledge, you still open it with your passphrase, recovery file, or code."
        : "One moment while we confirm your email address.") + '</div>' +
      (isReset
        ? '<div class="wc-field"><label>New password</label><input id="wcCfPass" type="password" autocomplete="new-password" placeholder="at least 8 characters"></div>' +
          '<div class="wc-field"><label>Confirm new password</label><input id="wcCfPass2" type="password" autocomplete="new-password" placeholder="type it again"></div>'
        : '') +
      '<div class="wc-confirm-actions" id="wcCfActions">' +
        (isReset ? '<button class="wc-btn primary" id="wcCfSubmit">Update password</button>' : '') +
      '</div>' +
      '<div class="wc-msg" id="wcCfMsg"></div>' +
      '<div class="wc-link' + (isReset ? '' : ' wc-hidden') + '" id="wcCfBack">Back to sign in</div>' +   // reset: always show an exit (no dead-end if you change your mind); verification auto-resolves so it stays hidden until its outcome
      '</div>';
    document.body.appendChild(g);

    var msg = g.querySelector("#wcCfMsg");
    function say(t, k) { msg.textContent = t; msg.className = "wc-msg" + (k ? " " + k : ""); }
    function showBack() { var b = g.querySelector("#wcCfBack"); if (b) b.classList.remove("wc-hidden"); }
    function toGate(prefillEmail) {
      g.remove();
      buildGate();
      if (prefillEmail) { var e = document.querySelector("#wcEmail"); if (e && !e.value) e.value = prefillEmail; }
    }
    g.querySelector("#wcCfBack").addEventListener("click", function () { toGate(""); });

    if (isReset) {
      var submit = g.querySelector("#wcCfSubmit");
      submit.addEventListener("click", async function () {
        if (submit.disabled) return;
        var p1 = g.querySelector("#wcCfPass").value || "", p2 = g.querySelector("#wcCfPass2").value || "";
        if (p1.length < 8) { say("Use at least 8 characters.", "err"); return; }
        if (p1 !== p2) { say("Those two passwords don’t match.", "err"); return; }
        submit.disabled = true; say("Updating your password…");
        try {
          await confirmPasswordReset(token, p1, p2);
          g.querySelector("#wcCfPass").value = ""; g.querySelector("#wcCfPass2").value = "";   // don't leave the new password in a field
          // the reset rotates the account's auth key → any cached session for THIS account is
          // now dead. If it's the account signed in on this browser, drop its token so the next
          // screen is a clean sign-in. Never touch a DIFFERENT account logged in here.
          try { var em = confirmTokenEmail(token), cs = cloudState(); if (em && cs.email && em.toLowerCase() === cs.email.toLowerCase()) cloudSave(Object.assign({}, cs, { token: "" })); } catch (e) {}
          g.querySelector("#wcCfH").textContent = "Password updated";
          g.querySelector("#wcCfSub").textContent = "You can sign in with your new password now.";
          var acts = g.querySelector("#wcCfActions"); acts.innerHTML = '<button class="wc-btn primary" id="wcCfGo">Sign in</button>';
          say("✓ Done.", "ok");
          acts.querySelector("#wcCfGo").addEventListener("click", function () { toGate(confirmTokenEmail(token)); });
        } catch (e) {
          submit.disabled = false;
          say((e && e.message) || "That didn’t work — the link may have expired.", "err");
          showBack();
        }
      });
      try { g.querySelector("#wcCfPass").focus(); } catch (e) {}
    } else {
      // verification: nothing to type — confirm the moment the page loads
      (async function () {
        try {
          await confirmVerification(token);
          g.querySelector("#wcCfH").textContent = "You’re verified";
          g.querySelector("#wcCfSub").textContent = "Your email address is confirmed — you’re all set.";
          say("✓ Email verified.", "ok");
          var acts = g.querySelector("#wcCfActions"); acts.innerHTML = '<button class="wc-btn primary" id="wcCfGo">Continue</button>';
          acts.querySelector("#wcCfGo").addEventListener("click", function () { toGate(""); });
        } catch (e) {
          g.querySelector("#wcCfH").textContent = "Couldn’t verify that link";
          g.querySelector("#wcCfSub").textContent = "The link may have expired or already been used. You can request a new one after signing in.";
          say((e && e.message) || "This link is invalid or has expired.", "err");
          showBack();
        }
      })();
    }
  }

  function bootGate() {
    var c = parseConfirmHash();
    if (c) buildConfirmGate(c.kind, c.token);   // on-brand verify / reset landing
    else buildGate();                           // normal login / unlock
  }
  if (document.body) bootGate();
  else document.addEventListener("DOMContentLoaded", bootGate);
})();
