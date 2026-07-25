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
  var W_INTERNAL = ["money.cloud", "money.cloudKey", "money.cloudPaused", "money.deviceId", "money.__lmeta", "money.dockMobile", "money.zoom", "money.gutter", "money.sidebar", "money.sidebarWidth", "money.statsScroll", "money.icons.collapsed", "money.balExpanded", "money.settings", "money.connect", "money.wiki", "money.timerRun", "money.deckDay", "money.dms", "money.simplefin", "money.deckRev"];   // deckDay siloed per device; dms never rides the vault; simplefin = the browser bank credential (device-local bearer secret, never in the vault); deckRev RETIRED — MUST match app.js DEVICE_LOCAL_KEYS or it'd sync as a generic key and churn
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
    if (W_INTERNAL.indexOf(k) !== -1) return k === "money.dms" || k === "money.simplefin";   // internals aren't account data — except dms (messages) and simplefin (the account's BANK CREDENTIAL — out of the vault, but siloed per account + cleared on logout; MUST match app.js isAccountDataKey)
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
  async function login(email, pass) {
    var base = cloudUrl();
    var r = await realFetch(base + "/api/collections/users/auth-with-password",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: email, password: pass }) });
    var d = await r.json();
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
    var d = await r.json();
    if (r.status === 401 || r.status === 403) throw new Error("AUTH");        // token expired → re-login
    if (!r.ok) throw new Error(errMsg(d) || "couldn't reach your cloud vault");
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
  function serve(url, method) {
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
      '<div class="wc-link wc-hidden" id="wcCfBack">Back to sign in</div>' +
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
