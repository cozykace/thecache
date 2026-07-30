// THE CACHE — Brand Kit (founder-only) merge + crypto regression suite.
//
// The Brand Kit is CROSS-ACCOUNT shared state on top of a per-account ZK vault: the single
// source of truth is a "company cache" account's vault, its data-key wrapped to each founder
// via an ECDH keybox wrap. This suite pins the parts that MUST be correct — get the merge
// wrong and two founders editing at once eat each other's work; get the crypto wrong and a
// founder can't open the kit (or the server can). Loads the REAL functions out of app.js by
// ANCHOR (never line numbers) so it can't rot on drift. Fixtures are placeholders only.
//
// What these assertions pin down:
//   · hexToRgb parses #rgb/#rrggbb and rejects junk (the --ink-rgb live-theming path)
//   · per-item merge: concurrent edits to DIFFERENT items both survive (no clobber)
//   · a stale edit does NOT revert a fresher one; a TOMBSTONE wins an exact-updated tie
//   · a deleted item can't be resurrected by a peer that still holds it (tombstone, not absence)
//   · the activity log is an append-only UNION by id — dedups, never loses, never resurrects
//   · notes/tokens are LWW by their own *At stamp (a fresh empty default can't beat an edit)
//   · ECDH wrap → unwrap round-trips; a DIFFERENT founder's key can't open the wrap
//   · keyboxOpenEcdh tries every ecdh wrap and returns the one that opens (multi-founder box)
//   · app.js ⇄ webcache.js key-class PARITY for the two new DEVICE_LOCAL keys
const fs = require("fs"), path = require("path");
const crypto = globalThis.crypto || require("crypto").webcrypto;
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
}
function makeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; } }; }
const LS = makeLS();

// app.js crypto + keybox helpers (_b64/_unb64/_importK/keyboxWraps/keyboxBuild…),
// the PURE brand-kit merge block (hexToRgb … brandkitEmpty), and the ECDH wrap block.
const appCrypto = slice("app.js", /^function _b64\(buf\)/, /^async function downloadEncryptedBackup/);
const pureBk = slice("app.js", /^const BRANDKIT_KEY = /, /^\/\/ ── ECDH keybox wrap/);
const ecdhBk = slice("app.js", /^async function _keyboxEcdhWrap/, /^\/\/ ── device mirror/);
const APP = Function("localStorage", appCrypto + "\n" + pureBk + "\n" + ecdhBk +
  "\nreturn {hexToRgb,brandkitCanon,brandkitMergeItems,brandkitMergeLog,brandkitMerge,brandkitEmpty,brandkitStateStr," +
  "_keyboxEcdhWrap,_keyboxEcdhUnwrap,keyboxOpenEcdh,keyboxWraps,keyboxBuild,cloudGenKey,_b64,_unb64};")(LS);

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const item = (o) => Object.assign({ id: "x", updated: 1, ord: 0, ordAt: 0 }, o);

(async () => {
  // ── 1. hexToRgb (the live-theming --ink-rgb path) ──────────────────────────────
  ok("hexToRgb #rrggbb", APP.hexToRgb("#1c1c1a") === "28, 28, 26");
  ok("hexToRgb #rgb expands", APP.hexToRgb("#abc") === "170, 187, 204");
  ok("hexToRgb tolerates no #", APP.hexToRgb("ffffff") === "255, 255, 255");
  ok("hexToRgb rejects junk → null", APP.hexToRgb("nope") === null);
  ok("hexToRgb rejects non-string → null", APP.hexToRgb(123) === null);

  // ── 2. per-item merge (palette/type/logos) ─────────────────────────────────────
  {
    // concurrent edits to DIFFERENT items both survive
    const a = [item({ id: "p1", name: "Ink", updated: 5 })];
    const b = [item({ id: "p2", name: "Accent", updated: 5 })];
    const m = APP.brandkitMergeItems(a, b);
    ok("concurrent edits to different items both survive", m.length === 2 && m.some((x) => x.id === "p1") && m.some((x) => x.id === "p2"));
  }
  {
    // newer `updated` wins; a stale copy never reverts it
    const fresh = [item({ id: "p1", name: "Blue", updated: 20 })];
    const stale = [item({ id: "p1", name: "Red", updated: 10 })];
    ok("newer updated wins (fresh∪stale)", APP.brandkitMergeItems(fresh, stale)[0].name === "Blue");
    ok("newer updated wins (stale∪fresh, order-independent)", APP.brandkitMergeItems(stale, fresh)[0].name === "Blue");
  }
  {
    // a TOMBSTONE wins an exact-updated tie, and a peer can't resurrect it
    const live = [item({ id: "p1", name: "Ink", updated: 7 })];
    const dead = [item({ id: "p1", name: "Ink", updated: 7, deleted: 1 })];
    const m1 = APP.brandkitMergeItems(live, dead);
    ok("tombstone wins an exact-updated tie", m1[0].deleted === 1);
    // the merged array keeps the tombstone (as a tombstone), so a later union with a device
    // that STILL holds the live copy stays deleted — no resurrection
    const m2 = APP.brandkitMergeItems(m1, live);
    ok("a deleted item is not resurrected by a peer holding the old live copy", m2[0].deleted === 1);
  }
  {
    // an UNDELETE (higher updated) beats an older tombstone
    const dead = [item({ id: "p1", name: "Ink", updated: 7, deleted: 1 })];
    const undel = [item({ id: "p1", name: "Ink v2", updated: 9 })];
    ok("a fresher undelete beats an older tombstone", !APP.brandkitMergeItems(dead, undel)[0].deleted);
  }
  {
    // live items and tombstones are visible/hidden by the `deleted` flag; merge keeps both
    const arr = APP.brandkitMergeItems([item({ id: "a", updated: 1 }), item({ id: "b", updated: 1, deleted: 1 })], []);
    ok("merge retains both live + tombstone entries", arr.length === 2);
    ok("live filter drops the tombstone", arr.filter((x) => !x.deleted).length === 1);
  }

  // ── 3. activity log (append-only union by id) ──────────────────────────────────
  {
    const a = [{ id: "e1", at: 1, byName: "Cozy", action: "added a colour" }];
    const b = [{ id: "e2", at: 2, byName: "Spencer", action: "edited notes" }, { id: "e1", at: 1, byName: "Cozy", action: "added a colour" }];
    const m = APP.brandkitMergeLog(a, b);
    ok("log union dedups by id", m.length === 2);
    ok("log is sorted oldest→newest by at", m[0].id === "e1" && m[1].id === "e2");
    ok("log preserves attribution (byName snapshot)", m[1].byName === "Spencer");
    // union never loses a local-only entry the remote hasn't seen
    ok("log keeps a local-only entry", APP.brandkitMergeLog([{ id: "solo", at: 3 }], []).some((e) => e.id === "solo"));
  }

  // ── 4. whole-STATE merge: notes/tokens LWW, items per-item, log union ───────────
  {
    const A = Object.assign(APP.brandkitEmpty(), { notes: "old", notesAt: 10, tokens: { accent: "#111" }, tokensAt: 10, palette: [item({ id: "p1", updated: 5, name: "A" })], log: [{ id: "l1", at: 1 }] });
    const B = Object.assign(APP.brandkitEmpty(), { notes: "new", notesAt: 20, tokens: { accent: "#222" }, tokensAt: 20, palette: [item({ id: "p2", updated: 5, name: "B" })], log: [{ id: "l2", at: 2 }] });
    const m = APP.brandkitMerge(A, B);
    ok("notes LWW picks the newer notesAt", m.notes === "new");
    ok("tokens LWW picks the newer tokensAt", m.tokens.accent === "#222");
    ok("state merge unions both palettes", m.palette.length === 2);
    ok("state merge unions the log", m.log.length === 2);
  }
  {
    // a fresh device (empty default, *At=0) can NEVER overwrite a real edit
    const edited = Object.assign(APP.brandkitEmpty(), { notes: "real", notesAt: 99 });
    const fresh = APP.brandkitEmpty();
    ok("a fresh empty default can't beat a real notes edit (fresh∪edited)", APP.brandkitMerge(fresh, edited).notes === "real");
    ok("a fresh empty default can't beat a real notes edit (edited∪fresh)", APP.brandkitMerge(edited, fresh).notes === "real");
  }

  // ── 4b. canonical state compare (the anti-churn / no-livelock guarantee) ───────
  {
    // key order must NOT matter — else a pull would re-push a no-op every poll forever
    const s1 = Object.assign(APP.brandkitEmpty(), { tokens: { ink: "#111", accent: "#222" }, tokensAt: 5 });
    const s2 = Object.assign(APP.brandkitEmpty(), { tokensAt: 5, tokens: { accent: "#222", ink: "#111" } });
    ok("brandkitStateStr is key-order-insensitive", APP.brandkitStateStr(s1) === APP.brandkitStateStr(s2));
    // a converged pair short-circuits: merge(remote, subset-of-remote) canonical-equals remote
    const remote = Object.assign(APP.brandkitEmpty(), { notes: "hi", notesAt: 9, palette: [item({ id: "p1", updated: 3 })], log: [{ id: "l1", at: 1 }] });
    const localSub = APP.brandkitEmpty();   // a device that has only received
    ok("merge(remote, empty) canonical-equals remote (push short-circuits)", APP.brandkitStateStr(APP.brandkitMerge(remote, localSub)) === APP.brandkitStateStr(remote));
    ok("merge is idempotent on an already-merged state", APP.brandkitStateStr(APP.brandkitMerge(remote, remote)) === APP.brandkitStateStr(remote));
  }

  // ── 5. ECDH keybox wrap — the founder-sharing crypto ───────────────────────────
  const genFounder = async () => {
    const g = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    return { priv: await crypto.subtle.exportKey("jwk", g.privateKey), pub: APP._b64(await crypto.subtle.exportKey("raw", g.publicKey)) };
  };
  {
    const K = await APP.cloudGenKey();          // the company data-key
    const cozy = await genFounder(), spen = await genFounder(), stranger = await genFounder();
    const wCozy = await APP._keyboxEcdhWrap(K, cozy.pub, "uidCozy");
    ok("ecdh wrap round-trips (Cozy opens K)", (await APP._keyboxEcdhUnwrap(wCozy, cozy.priv)) === K);
    ok("ecdh wrap tags the recipient uid", wCozy.uid === "uidCozy" && wCozy.t === "ecdh");
    let denied = false; try { await APP._keyboxEcdhUnwrap(wCozy, stranger.priv); } catch (e) { denied = true; }
    ok("a different account's key can't open the wrap", denied);
    // a multi-founder company keybox: keyboxOpenEcdh tries every ecdh wrap
    const wSpen = await APP._keyboxEcdhWrap(K, spen.pub, "uidSpen");
    const box = JSON.stringify({ v: 2, wraps: [wCozy, wSpen] });
    ok("keyboxOpenEcdh opens for founder Cozy", (await APP.keyboxOpenEcdh(box, cozy.priv)) === K);
    ok("keyboxOpenEcdh opens for founder Spencer", (await APP.keyboxOpenEcdh(box, spen.priv)) === K);
    let strDenied = false; try { await APP.keyboxOpenEcdh(box, stranger.priv); } catch (e) { strDenied = true; }
    ok("keyboxOpenEcdh refuses a non-founder", strDenied);
    // ecdh wraps compose with the normal keybox: a box with a passphrase wrap + ecdh wraps
    const withPass = await APP.keyboxBuild(K, { passphrase: "correct horse battery" });
    const composed = JSON.stringify({ v: 2, wraps: APP.keyboxWraps(withPass).concat([wCozy]) });
    ok("ecdh + passphrase coexist in one keybox", (await APP.keyboxOpenEcdh(composed, cozy.priv)) === K);
  }

  // ── 6. app.js ⇄ webcache.js key-class PARITY (the two new DEVICE_LOCAL keys) ────
  {
    const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    const webSrc = fs.readFileSync(path.join(__dirname, "..", "webcache.js"), "utf8");
    const appDL = (appSrc.match(/const DEVICE_LOCAL_KEYS = \[[^\]]*\]/) || [""])[0];
    const webIN = (webSrc.match(/var W_INTERNAL = \[[^\]]*\]/) || [""])[0];
    // brandkit's own keys PLUS main's device-local keys — pin BOTH runtimes so a future
    // merge can't symmetrically drop them from both lists and still pass green (the exact
    // gap that let justReset/sessionRun silently ride the vault if a resolve slipped).
    ["money.brandkit", "money.brandkitApply", "money.sessionRun", "money.justReset", "money.waterfx"].forEach((k) => {
      ok("app.js DEVICE_LOCAL_KEYS has " + k, appDL.indexOf('"' + k + '"') !== -1);
      ok("webcache.js W_INTERNAL has " + k + " (parity)", webIN.indexOf('"' + k + '"') !== -1);
    });
  }

  console.log((f ? "FAIL " : "") + p + " passed, " + f + " failed");
  process.exit(f ? 1 : 0);
})();
