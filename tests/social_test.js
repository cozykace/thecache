// SOCIAL MESSAGES — E2E DM crypto + the new money.* keys' vault classification.
//
// Messages between two ACCOUNTS can't ride the single-owner vault, so the body is sealed
// with a per-account ECDH P-256 keypair: A seals with AES-GCM under the ECDH shared secret
// of (A.priv, B.pub); B opens with (B.priv, A.pub) — the SAME symmetric key, so both ends of
// the pair read the thread and nobody else can. If this scheme drifts by a byte, a friend's
// messages become permanently unreadable. These assertions load the REAL crypto out of app.js
// by anchor and prove the round-trip + that a third party / tamper / malformed body all fail.
//
// It also locks the localStorage classification for the three new keys, because getting it
// wrong silently loses or leaks data:
//   money.dms    — the message cache → DEVICE_LOCAL, must NEVER ride the vault.
//   money.social — your @handle      → GENERIC, rides the vault so identity follows you.
//   money.msgKey — your private key   → GENERIC, rides the (encrypted) vault across devices.
const fs = require("fs"), path = require("path");
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
}
function makeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; } }; }

// the real key classifiers (isInternalKey / isGenericKey close over the shipping key lists)
const syncCode = slice("app.js", /^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const K = Function("localStorage", syncCode + "\nreturn {isInternalKey,isGenericKey,isSpecialKey};")(makeLS());

// the real social crypto + handle helpers (_b64/_unb64 live just above the cloud block)
const b64Code = slice("app.js", /^function _b64\(buf\)/, /^async function _deriveKey/);
const socialCode = slice("app.js", /^const SOCIAL_KEY = "money\.social"/, /^\/\/ ── The Messages surface/);
const LS = makeLS();
const S = Function("localStorage", b64Code + "\n" + socialCode + "\nreturn {socialEnsureKeypair,socialMyPub,socialSeal,socialUnseal,msgKeyGet,msgKeySet,socialNormHandle,socialHandleValid};")(LS);

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const threw = async (fn) => { try { await fn(); return false; } catch (e) { return e && e.message ? e.message : true; } };

// ── vault classification ──
ok("money.dms is excluded from the vault (device-local)", K.isInternalKey("money.dms") && !K.isGenericKey("money.dms"));
ok("money.social rides the vault (generic → handle syncs)", K.isGenericKey("money.social") && !K.isInternalKey("money.social"));
ok("money.msgKey rides the vault (generic → identity syncs)", K.isGenericKey("money.msgKey") && !K.isInternalKey("money.msgKey"));

// ── handle normalization ──
ok("handle strips @ and lowercases", S.socialNormHandle("@KingCozy") === "kingcozy");
ok("handle drops illegal chars", S.socialNormHandle("cozy ace!!") === "cozyace");
ok("valid handle accepted", S.socialHandleValid("king_cozy"));
ok("too-short handle rejected", !S.socialHandleValid("ab"));
ok("too-long handle rejected", !S.socialHandleValid("x".repeat(21)));

(async () => {
  // A mints an identity + publishes a pubkey
  await S.socialEnsureKeypair();
  const aKp = S.msgKeyGet();
  const aPub = await S.socialMyPub();
  ok("socialEnsureKeypair is idempotent (same key on 2nd call)", JSON.stringify(await S.socialEnsureKeypair()) === JSON.stringify(aKp));

  // swap the keystore to a fresh identity B
  LS.removeItem("money.msgKey");
  await S.socialEnsureKeypair();
  const bKp = S.msgKeyGet();
  const bPub = await S.socialMyPub();
  ok("A and B mint DIFFERENT keypairs", JSON.stringify(aKp) !== JSON.stringify(bKp));

  // as B, seal a message to A
  const plain = "meet me at the cache 🐐 — bring snacks";
  const body = await S.socialSeal(aPub, plain);
  ok("sealed body is base64 iv:ct", /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(body));
  ok("sealed body is not the plaintext", body.indexOf("cache") === -1);

  // as A, open B's message (the ECDH round-trip)
  S.msgKeySet(aKp);
  ok("A opens B's sealed message (ECDH round-trip)", (await S.socialUnseal(bPub, body)) === plain);

  // as B, open its own sent message (shared key is symmetric)
  S.msgKeySet(bKp);
  ok("B opens its own sent message (shared key symmetric)", (await S.socialUnseal(aPub, body)) === plain);

  // a third identity C cannot read it (ECDH(C.priv, A.pub) ≠ the pair's key → GCM auth fails)
  LS.removeItem("money.msgKey");
  await S.socialEnsureKeypair();
  ok("a third party cannot decrypt (auth fails)", !!(await threw(() => S.socialUnseal(aPub, body))));

  // tamper + malformed both rejected (open as A again)
  S.msgKeySet(aKp);
  const tampered = body.split(":")[0] + ":" + Buffer.from("not the real ciphertext").toString("base64");
  ok("tampered ciphertext rejected", !!(await threw(() => S.socialUnseal(bPub, tampered))));
  ok("malformed body rejected", !!(await threw(() => S.socialUnseal(bPub, "no-colon-here"))));

  // ── account logout / switch must fully ISOLATE each account (no blend, no leak, no loss) ──
  // Logout PARKS the account (security eval T7): its whole local cache — messages AND
  // deck/tasks/journal — is siloed under cacheprof.<userId> and the LIVE slot is cleared, so a
  // shared computer shows an empty cache the moment you log out. `parked` in money.cloud tells
  // the next login "the silo already holds this account — RESTORE it, never stash the empty
  // live slot over it" (the empty-overwrite trap). A different-account login on a LIVE session
  // still goes through the classic stash-then-load swap. Device settings (zoom) + the vault key
  // are NOT siloed. This whole block goes red if account data ever blends across accounts,
  // leaks to the next person at the machine, or is lost on a logout/login round-trip.
  {
    const CLS = makeLS();
    const cloudCode = slice("app.js", /^const CLOUD_KEY = "money\.cloud"/, /^function lhash/);
    const pre =
      'var CLOUDKEY_KEY="money.cloudKey";var window={};' +
      'function cloudKeySet(b){if(b){localStorage.setItem(CLOUDKEY_KEY,b);}else{localStorage.removeItem(CLOUDKEY_KEY);}}' +
      'function cloudErr(d){return (d&&d.message)||"";}' +
      'var __L=null;var fetch=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve(__L);}});};';
    const RET = "\nreturn {cloudState,cloudSaveState,cloudLogout,cloudLogin,isAccountDataKey,__setLogin:function(v){__L=v;},wasRestored:function(){return _cloudLoginRestored;},swapLatch:function(){return window.__cacheStorageSwapped===true;}};";
    const CL = Function("localStorage", pre + "\n" + cloudCode + RET)(CLS);
    // the account-data classifier: money.* data + dms, but NOT device/cloud internals or the silo
    ok("classifier: deck is account data", CL.isAccountDataKey("money.deck"));
    ok("classifier: a generic key (note) is account data", CL.isAccountDataKey("money.note"));
    ok("classifier: dms is account data (its own messages)", CL.isAccountDataKey("money.dms"));
    ok("classifier: zoom (device ergonomics) is NOT account data", !CL.isAccountDataKey("money.zoom"));
    ok("classifier: modal geometry (money.settings.w) is device-scoped, NOT account data", !CL.isAccountDataKey("money.settings.w"));
    ok("classifier: the vault key is NOT account data", !CL.isAccountDataKey("money.cloudKey"));
    ok("classifier: the merge bookkeeping (__lmeta) is NOT account data by class", !CL.isAccountDataKey("money.__lmeta"));
    ok("classifier: the silo namespace is NOT account data", !CL.isAccountDataKey("cacheprof.USER_A"));
    // account A signed in with a WHOLE cache: messages + deck/tasks/journal, a device zoom, a
    // resized Settings modal (device geometry), and per-key merge bookkeeping (__lmeta).
    CLS.setItem("money.cloudKey", "A_VAULT_KEY");
    CLS.setItem("money.zoom", "1.25");
    CLS.setItem("money.settings.w", "640");
    CLS.setItem("money.__lmeta", JSON.stringify({ "money.note": { m: 12345, h: 7 } }));
    CLS.setItem("money.deck", JSON.stringify([{ id: "d1", q: "A's card" }]));
    CLS.setItem("money.things", JSON.stringify([{ id: "t1", title: "A's task" }]));
    CLS.setItem("money.note", "A's private note");
    CLS.setItem("money.social", JSON.stringify({ username: "kingcozy", optedIn: true }));
    CLS.setItem("money.msgKey", JSON.stringify({ priv: "A_PRIV", pub: "A_PUB" }));
    CLS.setItem("money.dms", JSON.stringify({ threads: { x: 1 }, reqs: [] }));
    CL.cloudSaveState({ url: "u", token: "TOKEN_A", userId: "USER_A", email: "a@x.co", mode: "zk", lastPush: 7 });
    ok("no login has restored anything yet (reload signal starts false)", CL.wasRestored() === false);
    const parkedA = CL.cloudLogout();
    const aOut = CL.cloudState();
    ok("logout drops the session token", !aOut.token);
    ok("logout wipes this device's vault key", CLS.getItem("money.cloudKey") === null);
    ok("logout KEEPS userId (arms the different-account swap)", aOut.userId === "USER_A");
    ok("logout keeps email for one-tap re-login", aOut.email === "a@x.co");
    // T7: logout PARKS — silo written, live slot cleared, flag set
    ok("logout parks the account (returns true + stamps parked)", parkedA === true && aOut.parked === true);
    ok("logout CLEARS the live deck (a shared computer meets an empty cache)", CLS.getItem("money.deck") === null);
    ok("logout CLEARS tasks + note from the live slot", CLS.getItem("money.things") === null && CLS.getItem("money.note") === null);
    ok("logout CLEARS the @handle, PRIVATE KEY and message cache from the live slot", CLS.getItem("money.social") === null && CLS.getItem("money.msgKey") === null && CLS.getItem("money.dms") === null);
    ok("logout CLEARS the merge bookkeeping from the live slot", CLS.getItem("money.__lmeta") === null);
    ok("logout keeps THIS DEVICE's zoom + modal geometry (device keys, not account data)", CLS.getItem("money.zoom") === "1.25" && CLS.getItem("money.settings.w") === "640");
    ok("logout sets the storage-swap latch (unload-time saveStats is muted before the reload)", CL.swapLatch());
    const siloA = JSON.parse(CLS.getItem("cacheprof.USER_A") || "null");
    ok("the silo holds the parked account's whole world (deck, dms, private key, __lmeta)", !!siloA && siloA["money.deck"] != null && siloA["money.dms"] != null && siloA["money.msgKey"] != null && siloA["money.__lmeta"] != null);
    // the empty-overwrite trap, arm 1: a SECOND logout must not re-stash the empty live slot
    CL.cloudLogout();
    ok("a double logout can't overwrite the good silo with the empty live slot", JSON.parse(CLS.getItem("cacheprof.USER_A"))["money.deck"] === JSON.stringify([{ id: "d1", q: "A's card" }]) && CL.cloudState().parked === true);
    // someone uses the logged-out (empty) cache before the next login — their scratch must not blend
    CLS.setItem("money.note", "guest scribble");
    // a DIFFERENT account signs in on this browser — the PARKED path: restore B's silo (clean
    // slate here), and crucially NO stash, so A's silo is never touched
    CL.__setLogin({ token: "TOKEN_B", record: { id: "USER_B", email: "b@x.co", verified: true } });
    await CL.cloudLogin("u", "b@x.co", "pw");
    ok("B does not inherit A's @handle", CLS.getItem("money.social") === null);
    ok("B does not inherit A's PRIVATE KEY", CLS.getItem("money.msgKey") === null);
    ok("B does not inherit A's message cache", CLS.getItem("money.dms") === null);
    ok("B does not inherit A's deck", CLS.getItem("money.deck") === null);
    ok("B does not inherit A's tasks", CLS.getItem("money.things") === null);
    ok("B does not see the logged-out guest scribble either (restore is clean, never a union)", CLS.getItem("money.note") === null);
    ok("B does not inherit A's merge bookkeeping (__lmeta siloed away)", CLS.getItem("money.__lmeta") === null);
    ok("B does not inherit A's seal mode / record pointer / sync marks", CL.cloudState().mode == null && CL.cloudState().recordId == null && CL.cloudState().lastPush == null);
    ok("B keeps THIS DEVICE's zoom (not account data)", CLS.getItem("money.zoom") === "1.25");
    ok("B keeps THIS DEVICE's modal geometry (device suffix, not siloed)", CLS.getItem("money.settings.w") === "640");
    ok("A's silo survives B's parked login UNTOUCHED (the empty-overwrite trap, arm 2)", JSON.parse(CLS.getItem("cacheprof.USER_A"))["money.note"] === "A's private note");
    ok("a parked login signals the UI to reload (board booted from the empty slot)", CL.wasRestored() === true);
    ok("login clears the parked flag (B is a live session now)", !CL.cloudState().parked);
    ok("B's session is active", CL.cloudState().token === "TOKEN_B" && CL.cloudState().userId === "USER_B");
    // switching BACK to A while B is LIVE (no logout) — the classic swap path: stash B, load A.
    // Nothing was lost, including __lmeta so A's un-pushed generic edits still win the next merge.
    CL.__setLogin({ token: "TOKEN_A2", record: { id: "USER_A", email: "a@x.co", verified: true } });
    await CL.cloudLogin("u", "a@x.co", "pw");
    ok("back on A: deck restored intact", CLS.getItem("money.deck") === JSON.stringify([{ id: "d1", q: "A's card" }]));
    ok("back on A: private note restored", CLS.getItem("money.note") === "A's private note");
    ok("back on A: tasks restored (B's empty slate didn't clobber them)", CLS.getItem("money.things") === JSON.stringify([{ id: "t1", title: "A's task" }]));
    ok("back on A: @handle + private key restored", CLS.getItem("money.social") !== null && CLS.getItem("money.msgKey") !== null);
    ok("back on A: merge bookkeeping (__lmeta) restored — un-pushed edits stay protected", CLS.getItem("money.__lmeta") === JSON.stringify({ "money.note": { m: 12345, h: 7 } }));
    // the T7 core round-trip: logout → guest scribble → re-login as the SAME account
    CL.cloudSaveState(Object.assign(CL.cloudState(), { mode: "zk" }));   // A re-learned its seal mode (a push/pull sets it)
    CL.cloudLogout();
    CLS.setItem("money.note", "another guest scribble");
    CL.__setLogin({ token: "TOKEN_A3", record: { id: "USER_A", email: "a@x.co", verified: true } });
    await CL.cloudLogin("u", "a@x.co", "pw");
    ok("logout → re-login as the SAME account restores the deck", CLS.getItem("money.deck") === JSON.stringify([{ id: "d1", q: "A's card" }]));
    ok("…and the private key + message cache come back", CLS.getItem("money.msgKey") !== null && CLS.getItem("money.dms") !== null);
    ok("…and the guest scribble did NOT blend into A's data", CLS.getItem("money.note") === "A's private note");
    ok("…and A keeps its seal-mode memory (zk downgrade guard stays armed)", CL.cloudState().mode === "zk");
    ok("…parked cleared, session live again", !CL.cloudState().parked && CL.cloudState().token === "TOKEN_A3");

    // a FAILED silo write (storage full) must NOT delete the outgoing account's live data
    const store = {};
    const QLS = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { if (String(k).indexOf("cacheprof.") === 0) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => (Object.keys(store)[i] === undefined ? null : Object.keys(store)[i]),
      get length() { return Object.keys(store).length; },
    };
    const CLq = Function("localStorage", pre + "\n" + cloudCode + RET)(QLS);
    QLS.setItem("money.deck", JSON.stringify([{ id: "keepme" }]));
    QLS.setItem("money.dms", JSON.stringify({ threads: { z: 1 } }));   // device-local, never in the vault → losing it would be permanent
    CLq.cloudSaveState({ url: "u", token: "T_A", userId: "USER_A", email: "a@x.co" });
    CLq.__setLogin({ token: "T_B", record: { id: "USER_B", email: "b@x.co" } });
    let quotaThrew = false;
    try { await CLq.cloudLogin("u", "b@x.co", "pw"); } catch (e) { quotaThrew = true; }
    ok("quota-failed switch ABORTS the login (surfaces an error)", quotaThrew);
    ok("quota-abort does NOT relabel the session to the new account", CLq.cloudState().userId === "USER_A");
    ok("quota-failed silo write does NOT delete the outgoing account's deck", QLS.getItem("money.deck") !== null);
    ok("quota-failed silo write does NOT delete the outgoing account's message cache", QLS.getItem("money.dms") !== null);
    // quota on LOGOUT: the stash fails → the data must stay LIVE (never delete what wasn't
    // saved) and the account must NOT be marked parked, so the next login treats it as a
    // live session (classic swap) instead of "restoring" a silo that was never written
    const parkedQ = CLq.cloudLogout();
    ok("quota-failed logout keeps the data live (never lose what wasn't saved)", QLS.getItem("money.deck") !== null && QLS.getItem("money.dms") !== null);
    ok("quota-failed logout does NOT park (no phantom silo to 'restore')", parkedQ === false && !CLq.cloudState().parked);
    ok("quota-failed logout still ends the session (token dropped)", !CLq.cloudState().token);

    // a restore that runs out of storage MIDWAY must abort into a clean parked state — a silent
    // partial restore would look like a working login with missing data, and the next logout
    // would stash the partial copy over the good silo, making the loss permanent
    const mkDenyLS = (denyRef) => { const st = {}; return { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { if (denyRef.on && k === denyRef.key) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } st[k] = String(v); }, removeItem: (k) => { delete st[k]; }, key: (i) => Object.keys(st)[i] ?? null, get length() { return Object.keys(st).length; } }; };
    const deny1 = { on: false, key: "money.deck" }, RLS = mkDenyLS(deny1);
    const CLr = Function("localStorage", pre + "\n" + cloudCode + RET)(RLS);
    RLS.setItem("money.deck", JSON.stringify([{ id: "r1" }]));
    RLS.setItem("money.note", "A note");
    CLr.cloudSaveState({ url: "u", token: "TR", userId: "USER_A", email: "a@x.co" });
    CLr.cloudLogout();                       // parks fine (the silo write itself is allowed)
    deny1.on = true;                         // …but now the live slot can't hold the deck any more
    CLr.__setLogin({ token: "TR2", record: { id: "USER_A", email: "a@x.co" } });
    let restoreThrew = false;
    try { await CLr.cloudLogin("u", "a@x.co", "pw"); } catch (e) { restoreThrew = true; }
    ok("a mid-restore quota failure ABORTS the login", restoreThrew);
    ok("…and leaves the state PARKED, session still logged out (retry heals)", CLr.cloudState().parked === true && !CLr.cloudState().token);
    ok("…and keeps the silo intact", JSON.parse(RLS.getItem("cacheprof.USER_A"))["money.deck"] != null);
    ok("…and leaves NO partial copy in the live slot", RLS.getItem("money.note") === null && RLS.getItem("money.deck") === null);
    deny1.on = false;                        // space freed → the retry restores cleanly
    await CLr.cloudLogin("u", "a@x.co", "pw");
    ok("…and the retry after freeing space restores everything", RLS.getItem("money.deck") === JSON.stringify([{ id: "r1" }]) && RLS.getItem("money.note") === "A note" && !CLr.cloudState().parked);

    // same failure on the SWITCH path (B live, C's restore fails): the outgoing account must
    // land safely PARKED — silo written, live slot clear — never a half-restored hybrid still
    // labeled as the old session, and the retry must heal through the parked path
    const deny2 = { on: false, key: "money.deck" }, SLS = mkDenyLS(deny2);
    const CLs = Function("localStorage", pre + "\n" + cloudCode + RET)(SLS);
    SLS.setItem("money.note", "A live note");
    SLS.setItem("cacheprof.USER_C", JSON.stringify({ "money.deck": JSON.stringify([{ id: "c1" }]) }));
    CLs.cloudSaveState({ url: "u", token: "TA", userId: "USER_A", email: "a@x.co" });
    deny2.on = true;
    CLs.__setLogin({ token: "TC", record: { id: "USER_C", email: "c@x.co" } });
    let switchThrew = false;
    try { await CLs.cloudLogin("u", "c@x.co", "pw"); } catch (e) { switchThrew = true; }
    ok("a switch whose restore fails ABORTS the login", switchThrew);
    ok("…outgoing account lands safely PARKED (silo written, session ended)", CLs.cloudState().parked === true && !CLs.cloudState().token && JSON.parse(SLS.getItem("cacheprof.USER_A"))["money.note"] === "A live note");
    ok("…the incoming account's silo is untouched", JSON.parse(SLS.getItem("cacheprof.USER_C"))["money.deck"] != null);
    ok("…and no half-restored hybrid sits in the live slot", SLS.getItem("money.note") === null && SLS.getItem("money.deck") === null);
    deny2.on = false;
    await CLs.cloudLogin("u", "c@x.co", "pw");
    ok("…the retry heals through the parked path (C restored, session relabeled)", SLS.getItem("money.deck") === JSON.stringify([{ id: "c1" }]) && CLs.cloudState().userId === "USER_C" && !CLs.cloudState().parked);
    ok("…and A's silo still holds A's world", JSON.parse(SLS.getItem("cacheprof.USER_A"))["money.note"] === "A live note");

    // the interim parked-save itself failing (money.cloud can't be written) must NOT proceed —
    // a swallowed failure would leave "live session" state over a cleared slot, and the next
    // logout would stash that emptiness over the good silo. Expect: un-stash + abort, untouched.
    const deny3 = { on: false, key: "money.cloud" }, PLS = mkDenyLS(deny3);
    const CLp = Function("localStorage", pre + "\n" + cloudCode + RET)(PLS);
    PLS.setItem("money.note", "A live note");
    CLp.cloudSaveState({ url: "u", token: "TA", userId: "USER_A", email: "a@x.co" });
    deny3.on = true;                          // the state file itself can no longer be written
    CLp.__setLogin({ token: "TD", record: { id: "USER_D", email: "d@x.co" } });
    let parkSaveThrew = false;
    try { await CLp.cloudLogin("u", "d@x.co", "pw"); } catch (e) { parkSaveThrew = true; }
    ok("a failed interim parked-save ABORTS the switch (never a live label over a cleared slot)", parkSaveThrew);
    ok("…and the live data is put back (un-stash)", PLS.getItem("money.note") === "A live note");
    ok("…and the session still belongs to A, un-parked", CLp.cloudState().userId === "USER_A" && CLp.cloudState().token === "TA" && !CLp.cloudState().parked);

    // ── app.js ↔ webcache PARITY: logout parks in ONE runtime, the WEB GATE restores in the other ──
    // On the hosted app the logout button lives in app.js but the next login happens in
    // webcache's gate — the two runtimes share one localStorage, so their classifier, silo
    // shape and parked contract must agree byte-for-byte or a web login after a desktop-side
    // logout loses (or leaks) the account. These run the REAL functions of both files over a
    // SHARED store, exactly like the browser does.
    const LS2 = makeLS();
    const A2 = Function("localStorage", pre + "\n" + cloudCode + RET)(LS2);
    const wpre =
      'var CLOUD_DEFAULT="u";var __W=null;var window={};' +
      'var realFetch=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve(__W);}});};' +
      'function keySet(b){if(b){localStorage.setItem("money.cloudKey",b);}else{localStorage.removeItem("money.cloudKey");}}';
    const webAcctCode = slice("webcache.js", /^  var W_INTERNAL = /, /^  async function signup/);
    const WRET = "\nreturn {wIsAccountData,cloudState,login,__setLogin:function(v){__W=v;},wasRestored:function(){return _wRestored;},swapLatch:function(){return window.__cacheStorageSwapped===true;}};";
    const W = Function("localStorage", wpre + "\n" + webAcctCode + WRET)(LS2);
    // classifier parity — both runtimes must agree on every class of key
    ["money.deck", "money.note", "money.dms", "money.social", "money.msgKey", "money.zoom", "money.settings.w",
     "money.cloudKey", "money.__lmeta", "money.timerRun", "money.deckDay", "cacheprof.USER_A"].forEach((k) =>
      ok("parity: both runtimes classify " + k + " identically", A2.isAccountDataKey(k) === W.wIsAccountData(k)));
    // desktop-side (app.js) logout parks A…
    LS2.setItem("money.deck", JSON.stringify([{ id: "d9", q: "A's only card" }]));
    LS2.setItem("money.msgKey", JSON.stringify({ priv: "A_PRIV", pub: "A_PUB" }));
    LS2.setItem("money.dms", JSON.stringify({ threads: { t: 1 } }));
    LS2.setItem("money.cloudKey", "A_KEY");
    A2.cloudSaveState({ url: "u", token: "TA", userId: "USER_A", email: "a@x.co", mode: "esc", recordId: "rec1" });
    A2.cloudLogout();
    ok("parity: app-side logout parked A + cleared the live slot", A2.cloudState().parked === true && LS2.getItem("money.deck") === null && LS2.getItem("money.msgKey") === null);
    // …and the WEB gate's login restores it (same account) — no re-stash, silo intact
    W.__setLogin({ token: "TA2", record: { id: "USER_A", email: "a@x.co" } });
    await W.login("a@x.co", "pw");
    ok("parity: web login restores the app-side silo (deck back)", LS2.getItem("money.deck") === JSON.stringify([{ id: "d9", q: "A's only card" }]));
    ok("parity: web login restores the private key + message cache", LS2.getItem("money.msgKey") !== null && LS2.getItem("money.dms") !== null);
    ok("parity: web login clears parked + signals the reload", !W.cloudState().parked && W.wasRestored() === true);
    ok("parity: web login sets the storage-swap latch (app.js savers muted until the reload)", W.swapLatch());
    ok("parity: same-account restore keeps the seal-mode memory (zk guard stays armed)", W.cloudState().mode === "esc" && W.cloudState().recordId === "rec1");
    ok("parity: the silo survives the same-account restore (no empty re-stash)", JSON.parse(LS2.getItem("cacheprof.USER_A"))["money.deck"] != null);
    // a DIFFERENT account through the web gate after a parked logout: clean slate, nothing inherited
    A2.cloudLogout();                                      // parks A again (it was live after the restore)
    LS2.setItem("money.note", "web guest scribble");
    W.__setLogin({ token: "TB", record: { id: "USER_B", email: "b@x.co" } });
    await W.login("b@x.co", "pw");
    ok("parity: a different account via the web gate gets a clean slate", LS2.getItem("money.deck") === null && LS2.getItem("money.msgKey") === null && LS2.getItem("money.note") === null);
    ok("parity: B inherits no seal mode / record pointer / vault key", W.cloudState().mode == null && W.cloudState().recordId == null && LS2.getItem("money.cloudKey") === null);
    ok("parity: A's silo survives B's web login untouched", JSON.parse(LS2.getItem("cacheprof.USER_A"))["money.deck"] != null);
    // a LIVE different-account switch through the web gate (no logout first) must also flag the
    // reload — an empty incoming vault used to resolve the gate over stale in-memory state,
    // letting the old account's board write itself into the new account's slot (and vault)
    const W2 = Function("localStorage", wpre + "\n" + webAcctCode + WRET)(LS2);   // fresh page: _wRestored starts false
    W2.__setLogin({ token: "TC2", record: { id: "USER_C", email: "c@x.co" } });
    await W2.login("c@x.co", "pw");
    ok("parity: a live-switch web login flags the reload too (empty vault included)", W2.wasRestored() === true);
    ok("parity: …after stashing B and giving C a clean slate", LS2.getItem("cacheprof.USER_B") != null && W2.cloudState().userId === "USER_C" && W2.cloudState().parked == null);
  }

  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
