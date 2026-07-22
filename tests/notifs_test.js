// NOTIFICATION CENTER — money.notifs (read state for the Cache's own news).
//
// The key is SPECIAL: per-id NEWEST-WINS by `at` — NOT a union of read ids, because a
// union can't express "mark unread again" (un-reading would silently revert on the next
// merge). Stamps are deterministic (seed/detect stamp the RELEASE DATE, a real user
// action stamps Date.now()), and an exact-`at` tie lets UNREAD win, so a fresh device
// seeding history as read can never swallow another device's unread notification.
//
// These assertions load the REAL functions out of app.js AND webcache.js by anchor and
// prove: (1) the merge semantics above, in both directions; (2) byte-identical behavior
// across the two runtimes + matching key-class lists (a mismatch forks phone/desktop);
// (3) the authored-hash witness sees two converged devices as EQUAL (no corrective-push
// livelock) while still catching a real difference; (4) first-run seeding creates ZERO
// unread notifications from a full release-notes file, and detection is deterministic.
const fs = require("fs"), path = require("path");
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
}
function makeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; } }; }
let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };

// ── the real app.js pieces ──
const helpersCode = slice("app.js", /^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const K = Function("localStorage", helpersCode + "\nreturn {isInternalKey,isSpecialKey,isGenericKey,authoredHash,CLOUD_INTERNAL_KEYS,DEVICE_LOCAL_KEYS,SPECIAL_MERGE_KEYS};")(makeLS());
const mergersCode = slice("app.js", /^function mergeProfileStrings/, /^let _pullBusy/);
const mkAppMerge = (ls) => Function("localStorage", mergersCode + "\nreturn mergeNotifsStr;")(ls);
const notifsCode = slice("app.js", /^const NOTIFS_KEY = "money\.notifs"/, /^\/\/ ── The Messages surface/);
const mkNotifs = (ls) => Function("localStorage", "socialUpdateBadge", "document",
  notifsCode + "\nreturn {notifsGet,notifsSet,notifDateMs,notifsSeed,notifsUnread,notifsMark};")(ls, () => {}, { dispatchEvent: () => {} });

// ── the real webcache.js pieces ──
const wListsCode = slice("webcache.js", /^\s*var W_INTERNAL = /, /^\s*var W_DECK_LIVE_CAP/);
const W = Function(wListsCode + "\nreturn {W_INTERNAL, W_SPECIAL};")();
const wMergeCode = slice("webcache.js", /^\s*function wMergeNotifs/, /^\s*function wMergeCharSince/);
const mkWebMerge = (ls) => Function("localStorage", wMergeCode + "\nreturn wMergeNotifs;")(ls);

// ── 1. key classification + two-runtime class parity ──
ok("money.notifs is SPECIAL in app.js", K.isSpecialKey("money.notifs") && !K.isGenericKey("money.notifs") && !K.isInternalKey("money.notifs"));
ok("money.notifs is SPECIAL in webcache.js", W.W_SPECIAL.indexOf("money.notifs") !== -1 && W.W_INTERNAL.indexOf("money.notifs") === -1);
const setEq = (a, b) => a.length === b.length && a.slice().sort().join("|") === b.slice().sort().join("|");
ok("SPECIAL lists match across runtimes (app.js ⇄ webcache.js)", setEq(K.SPECIAL_MERGE_KEYS, W.W_SPECIAL));
ok("INTERNAL lists match across runtimes (app.js ⇄ webcache.js)", setEq(K.CLOUD_INTERNAL_KEYS.concat(K.DEVICE_LOCAL_KEYS), W.W_INTERNAL));

// ── 2. merge semantics (both runtimes, byte-identical results) ──
const D = Date.parse("2026-07-20T00:00:00Z");   // a release-date stamp
const runBoth = (localMap, remoteMap) => {
  const lsA = makeLS(), lsW = makeLS();
  if (localMap !== undefined) { lsA.setItem("money.notifs", JSON.stringify(localMap)); lsW.setItem("money.notifs", JSON.stringify(localMap)); }
  const chA = mkAppMerge(lsA)(JSON.stringify(remoteMap));
  const chW = mkWebMerge(lsW)(JSON.stringify(remoteMap));
  return { chA, chW, outA: lsA.getItem("money.notifs"), outW: lsW.getItem("money.notifs") };
};

// newest-wins: A read early, B marked unread LATER → the later unread wins
let r = runBoth({ n1: { read: 1, at: 1000 } }, { n1: { read: 0, at: 2000 } });
ok("later unread beats earlier read", r.chA && JSON.parse(r.outA).n1.read === 0 && JSON.parse(r.outA).n1.at === 2000);
ok("  …webcache agrees byte-for-byte", r.chW && r.outW === r.outA);
// and the mirror: an OLDER read can never revert a NEWER unread
r = runBoth({ n1: { read: 0, at: 2000 } }, { n1: { read: 1, at: 1000 } });
ok("older read never reverts newer unread (no change)", !r.chA && JSON.parse(r.outA).n1.read === 0);
ok("  …webcache agrees (no change either)", !r.chW && r.outW === r.outA);
// newest-wins the other way too: a later READ beats an earlier unread
r = runBoth({ n1: { read: 0, at: 1000 } }, { n1: { read: 1, at: 2000 } });
ok("later read beats earlier unread", r.chA && JSON.parse(r.outA).n1.read === 1 && r.outW === r.outA);

// the seed-vs-detect race: EXACT-at tie (both stamped the release date) → UNREAD wins,
// in BOTH directions, so a fresh device's read-seed can't swallow an unread note
r = runBoth({ n1: { read: 1, at: D } }, { n1: { read: 0, at: D } });
ok("tie: remote unread beats local seed-read", r.chA && JSON.parse(r.outA).n1.read === 0);
r = runBoth({ n1: { read: 0, at: D } }, { n1: { read: 1, at: D } });
ok("tie: local unread survives a remote seed-read", !r.chA && JSON.parse(r.outA).n1.read === 0);
ok("  …webcache agrees on both tie directions", !r.chW && r.outW === r.outA);

// an id never seen here is adopted; identical maps produce zero churn
r = runBoth({ n1: { read: 1, at: 1000 } }, { n1: { read: 1, at: 1000 }, n2: { read: 0, at: D } });
ok("an unseen id is adopted", r.chA && JSON.parse(r.outA).n2.read === 0 && r.outW === r.outA);
r = runBoth({ n1: { read: 1, at: 1000 } }, { n1: { read: 1, at: 1000 } });
ok("identical maps → no write, no churn", !r.chA && !r.chW);
// malformed remote is rejected without touching local state
r = runBoth({ n1: { read: 1, at: 1000 } }, ["not", "a", "map"]);
ok("a malformed remote (array) is rejected", !r.chA && !r.chW && JSON.parse(r.outA).n1.read === 1);

// full two-device convergence: A merges B's map, B merges A's map → identical winners
const mapA = { n1: { read: 1, at: 5000 }, n2: { read: 0, at: D }, n3: { read: 1, at: D } };
const mapB = { n1: { read: 0, at: 6000 }, n2: { read: 1, at: D }, n4: { read: 0, at: D } };
const lsA2 = makeLS(); lsA2.setItem("money.notifs", JSON.stringify(mapA)); mkAppMerge(lsA2)(JSON.stringify(mapB));
const lsB2 = makeLS(); lsB2.setItem("money.notifs", JSON.stringify(mapB)); mkWebMerge(lsB2)(JSON.stringify(mapA));
const canon = (s) => { const v = JSON.parse(s), o = {}; Object.keys(v).sort().forEach((k) => { o[k] = { at: +v[k].at || 0, read: v[k].read ? 1 : 0 }; }); return JSON.stringify(o); };
ok("two devices merging opposite directions converge (app ⇄ webcache)", canon(lsA2.getItem("money.notifs")) === canon(lsB2.getItem("money.notifs")));
ok("  …and every winner is right (n1 newer-unread · n2 tie→unread · n3 local-only · n4 adopted)",
   (() => { const v = JSON.parse(canon(lsA2.getItem("money.notifs"))); return v.n1.read === 0 && v.n2.read === 0 && v.n3.read === 1 && v.n4.read === 0; })());

// ── 3. the authored-hash witness: converged ⇒ equal, different ⇒ different ──
const h = (s) => K.authoredHash({ "money.notifs": s }, {});
ok("witness: key order ignored (no livelock)",
   h('{"a":{"read":1,"at":5},"b":{"read":0,"at":9}}') === h('{"b":{"read":0,"at":9},"a":{"read":1,"at":5}}'));
ok("witness: read:true ≡ read:1, stray field ignored (writer-shape drift can't churn)",
   h('{"a":{"read":true,"at":5,"x":"junk"}}') === h('{"a":{"read":1,"at":5}}'));
ok("witness: a flipped read flag IS detected (honest)",
   h('{"a":{"read":1,"at":5}}') !== h('{"a":{"read":0,"at":5}}'));
ok("witness: an extra id IS detected (honest)",
   h('{"a":{"read":1,"at":5}}') !== h('{"a":{"read":1,"at":5},"b":{"read":1,"at":5}}'));

// ── 4. first-run seeding + deterministic detection ──
const NOTES = [
  { id: "r3", date: "2026-07-20", title: "Three", body: "…" },
  { id: "r2", date: "2026-07-10", title: "Two", body: "…" },
  { id: "r1", date: "2026-07-01", title: "One", body: "…" },
];
const lsN = makeLS(); const N = mkNotifs(lsN);
ok("fresh install: seeding a FULL release file creates ZERO unread", (N.notifsSeed(NOTES), N.notifsUnread() === 0));
const seeded = N.notifsGet();
ok("  …every entry seeded read, stamped at its release date (not the clock)",
   Object.keys(seeded).length === 3 && NOTES.every((e) => seeded[e.id].read === 1 && seeded[e.id].at === Date.parse(e.date + "T00:00:00Z")));
// a NEW entry lands after arrival → exactly one unread, stamped deterministically
const NOTES2 = [{ id: "r4", date: "2026-07-22", title: "Four", body: "…" }].concat(NOTES);
ok("a post-arrival entry becomes the ONE unread", (N.notifsSeed(NOTES2), N.notifsUnread() === 1 && N.notifsGet().r4.read === 0));
ok("  …stamped at its release date (deterministic across devices)", N.notifsGet().r4.at === Date.parse("2026-07-22T00:00:00Z"));
// determinism: a second device walking the same history mints a byte-identical map
const lsM = makeLS(); const M = mkNotifs(lsM);
M.notifsSeed(NOTES); M.notifsSeed(NOTES2);
ok("two devices, same history → identical maps (no clock in any stamp)",
   canon(JSON.stringify(M.notifsGet())) === canon(JSON.stringify(N.notifsGet())));
// seeding an empty file writes nothing (a later first release is genuinely post-arrival)
const lsE = makeLS(); const E = mkNotifs(lsE);
ok("empty release file: nothing written, nothing fabricated", (E.notifsSeed([]), lsE.getItem("money.notifs") === null && E.notifsUnread() === 0));
// a user action outranks everything: mark-unread stamps NOW, which beats any release date
N.notifsMark("r1", 0);
ok("mark-unread works after seeding (reversible read state)", N.notifsUnread() === 2 && N.notifsGet().r1.read === 0 && N.notifsGet().r1.at > D);

console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
