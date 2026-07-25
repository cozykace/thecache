// MULTI-WRAP KEYBOX — one vault key K, several independent wrappings, any one opens.
//
// This is the "can a person open their own vault" guarantee, regression-locked. Get it
// wrong and someone's whole financial history becomes permanently unreadable — there is
// no undo, no support ticket, no backup we can reach. So every invariant from the
// keybox-multi-wrapping brief is pinned here, loading the REAL crypto out of app.js and
// webcache.js by anchor (never line numbers):
//   1. legacy m:"esc" and m:"zk" boxes still open on BOTH runtimes (migrate-on-read);
//   2. a multi-wrap box opens with EACH method independently (pass, file, code, escrow);
//   3. adding a wrap leaves the others byte-intact; removing escrow drops ONLY the raw key;
//   4. the downgrade guard refuses a box whose escrow-ness increased (both runtimes);
//   5. app.js ⇄ webcache parity — a box built by one opens in the other, same shapes;
//   6. a wrong secret is refused (AES-GCM authenticity), never a silent wrong key.
const fs = require("fs"), path = require("path");
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
}
function makeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; } }; }
const LS = makeLS();

// app.js crypto block: _b64 … keyboxOpen (build/open/mutate + helpers).  The slice
// already declares CLOUDKEY_KEY, so don't re-inject it.  We also pull in _keyboxForPush
// (which lives further down in the cloud section, but is pure) so the FIRST-keybox
// shaping — the actual ZK-by-default decision — is exercised end to end.
const appCode = slice("app.js", /^function _b64\(buf\)/, /^async function downloadEncryptedBackup/);
const firstPush = slice("app.js", /^async function _keyboxForPush/, /^\/\/ ── Manage the keybox/);
const APP = Function("localStorage", appCode + "\n" + firstPush +
  "\nreturn {cloudGenKey,keyboxMake,keyboxBuild,keyboxOpen,keyboxAddWrap,keyboxRemoveType,keyboxWraps,keyboxHasEsc,keyboxMode,keyboxMethods,keyboxEscKey,_keyboxWrap,_keyboxForPush," +
  "recoveryFileSecret,recoveryCode,recoveryCodeNormalize,recoveryFilePayload,parseRecoveryFile};")(LS);
// webcache.js crypto block: _b64 … openVault (reader side).
const webCode = slice("webcache.js", /function _b64\(buf\)/, /function wMergeProfile/);
const WEB = Function("localStorage", webCode + "\nreturn {keyboxOpen,keyboxWraps,keyboxHasEsc,keyboxMode};")(LS);

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const threwAsync = async (fn) => { try { await fn(); return false; } catch (e) { return e && e.message ? e.message : true; } };

// a stand-in for cloudState().mode that the guard reads — both runtimes call
// cloudState().mode, but the crypto slices don't include cloudState, so the guard
// (keyboxGuard / the inline webcache check) lives OUTSIDE the slice. We test the guard's
// KERNEL directly: mode === "zk" && keyboxHasEsc(box) must be true for a box we'd refuse.
function guardWouldRefuse(runtime, mode, box) { return mode === "zk" && runtime.keyboxHasEsc(box); }

(async () => {
  const PASS = "correct horse battery staple";
  const FILE = "Zm9vYmFyLXJlY292ZXJ5LWZpbGUtc2VjcmV0LTEyMzQ1Ng";   // stand-in high-entropy file secret
  const CODE = "ABCDE-FGHIJ-KLMNP-QRSTU";                          // stand-in recovery code

  // ── 1. LEGACY shapes still open on both runtimes (migrate-on-read) ──────────────
  const kEsc = await APP.cloudGenKey();
  const legacyEsc = await APP.keyboxMake(kEsc, "");
  ok("legacy esc is still {m:'esc'}", JSON.parse(legacyEsc).m === "esc");
  ok("legacy esc opens on app (no secret)", (await APP.keyboxOpen(legacyEsc, "")) === kEsc);
  ok("legacy esc opens on web (no secret)", (await WEB.keyboxOpen(legacyEsc, "")) === kEsc);
  const kZk = await APP.cloudGenKey();
  const legacyZk = await APP.keyboxMake(kZk, PASS);
  ok("legacy zk is still {m:'zk'}", JSON.parse(legacyZk).m === "zk");
  ok("legacy zk opens on app with passphrase", (await APP.keyboxOpen(legacyZk, PASS)) === kZk);
  ok("legacy zk opens on web with passphrase", (await WEB.keyboxOpen(legacyZk, PASS)) === kZk);
  ok("legacy zk rejects wrong passphrase (app)", !!(await threwAsync(() => APP.keyboxOpen(legacyZk, "nope"))));
  ok("legacy zk with no passphrase throws ZK (web)", (await threwAsync(() => WEB.keyboxOpen(legacyZk, ""))) === "ZK");
  // helpers read legacy shapes without rewriting them
  ok("keyboxHasEsc true for legacy esc, false for legacy zk", APP.keyboxHasEsc(legacyEsc) && !APP.keyboxHasEsc(legacyZk));
  ok("keyboxMode maps legacy esc→esc, zk→zk", APP.keyboxMode(legacyEsc) === "esc" && APP.keyboxMode(legacyZk) === "zk");

  // ── 2. MULTI-WRAP box opens with EACH method independently ──────────────────────
  const K = await APP.cloudGenKey();
  const box = await APP.keyboxBuild(K, { passphrase: PASS, fileKey: FILE, code: CODE, escrow: true });
  const parsed = JSON.parse(box);
  ok("multi-wrap box is v2 with 4 wraps", parsed.v === 2 && parsed.wraps.length === 4);
  ok("multi-wrap carries pass+file+code+esc", JSON.stringify(APP.keyboxMethods(box).sort()) === JSON.stringify(["code", "esc", "file", "pass"]));
  ok("opens with the PASSPHRASE", (await APP.keyboxOpen(box, { passphrase: PASS })) === K);
  ok("opens with the recovery FILE", (await APP.keyboxOpen(box, { fileKey: FILE })) === K);
  ok("opens with the recovery CODE", (await APP.keyboxOpen(box, { code: CODE })) === K);
  ok("opens with ESCROW silently (no secret)", (await APP.keyboxOpen(box, "")) === K);
  ok("a bare passphrase string still works (back-compat arg)", (await APP.keyboxOpen(box, PASS)) === K);
  ok("wrong passphrase is refused even when other wraps exist", !!(await threwAsync(() => APP.keyboxOpen(box, { passphrase: "wrong" }))));
  ok("wrong file secret is refused", !!(await threwAsync(() => APP.keyboxOpen(box, { fileKey: "AAAA" }))));

  // a ZK box (no escrow) — every method but escrow, and NO silent unlock
  const zkBox = await APP.keyboxBuild(K, { passphrase: PASS, fileKey: FILE, code: CODE });
  ok("zk multi-wrap has no escrow wrap", !APP.keyboxHasEsc(zkBox) && APP.keyboxMode(zkBox) === "zk");
  ok("zk multi-wrap opens with passphrase / file / code", (await APP.keyboxOpen(zkBox, { passphrase: PASS })) === K && (await APP.keyboxOpen(zkBox, { fileKey: FILE })) === K && (await APP.keyboxOpen(zkBox, { code: CODE })) === K);
  ok("zk multi-wrap has NO silent unlock (throws, never escrows)", !!(await threwAsync(() => APP.keyboxOpen(zkBox, ""))));

  // ── 3. ADD a wrap keeps the others; REMOVE escrow drops ONLY the raw key ─────────
  // start from {pass, file}; add a code wrap — the ORIGINAL pass+file wrap bytes must
  // be carried over verbatim (adding a method never re-seals or drops what you had).
  const base = await APP.keyboxBuild(K, { passphrase: PASS, fileKey: FILE });
  const baseWraps = JSON.parse(base).wraps;
  const codeWrap = await APP._keyboxWrap("code", K, CODE);
  const added = APP.keyboxAddWrap(base, codeWrap);
  const addedWraps = JSON.parse(added).wraps;
  const passBefore = baseWraps.find((w) => w.t === "pass"), passAfter = addedWraps.find((w) => w.t === "pass");
  const fileBefore = baseWraps.find((w) => w.t === "file"), fileAfter = addedWraps.find((w) => w.t === "file");
  ok("adding a wrap leaves the pass wrap byte-identical", JSON.stringify(passBefore) === JSON.stringify(passAfter));
  ok("adding a wrap leaves the file wrap byte-identical", JSON.stringify(fileBefore) === JSON.stringify(fileAfter));
  ok("after add: pass + file + code all still open", (await APP.keyboxOpen(added, { passphrase: PASS })) === K && (await APP.keyboxOpen(added, { fileKey: FILE })) === K && (await APP.keyboxOpen(added, { code: CODE })) === K);

  // now remove escrow from the full 4-wrap box: raw key GONE, the other three intact
  const removed = APP.keyboxRemoveType(box, "esc");
  ok("removing escrow drops the esc wrap (raw key gone server-side)", !APP.keyboxHasEsc(removed) && APP.keyboxEscKey(removed) === null);
  ok("removing escrow keeps pass + file + code opening", (await APP.keyboxOpen(removed, { passphrase: PASS })) === K && (await APP.keyboxOpen(removed, { fileKey: FILE })) === K && (await APP.keyboxOpen(removed, { code: CODE })) === K);
  ok("removing escrow leaves NO silent unlock", !!(await threwAsync(() => APP.keyboxOpen(removed, ""))));
  ok("the non-escrow wraps survive removal byte-identical", (() => {
    const b = JSON.parse(box).wraps.filter((w) => w.t !== "esc");
    const a = JSON.parse(removed).wraps;
    return JSON.stringify(a) === JSON.stringify(b);
  })());
  // removing the passphrase (a non-escrow method) leaves file + escrow working
  const noPass = APP.keyboxRemoveType(box, "pass");
  ok("removing the passphrase keeps file + escrow", (await APP.keyboxOpen(noPass, { fileKey: FILE })) === K && (await APP.keyboxOpen(noPass, "")) === K && APP.keyboxMethods(noPass).indexOf("pass") < 0);
  // THE BRICK GUARD: removing escrow from an escrow-ONLY box would EMPTY the keybox —
  // cloudSetEscrow(false) must refuse this (the floor lives there). Prove the danger + the
  // predicate the floor uses (is there any non-escrow wrap left?).
  const escOnly = await APP.keyboxBuild(K, { escrow: true });
  ok("escrow-only box: removing esc would leave ZERO wraps (unopenable — why the floor exists)", JSON.parse(APP.keyboxRemoveType(escOnly, "esc")).wraps.length === 0 && !!(await threwAsync(() => APP.keyboxOpen(APP.keyboxRemoveType(escOnly, "esc"), ""))));
  ok("floor predicate: escrow-only has no non-escrow wrap; {esc,file} does", !APP.keyboxWraps(escOnly).some((w) => w.t !== "esc") && APP.keyboxWraps(box).some((w) => w.t !== "esc"));

  // ── 4. DOWNGRADE guard: a zk-mode device refuses a box whose escrow-ness increased ─
  // the box the server tries to slip in has an escrow wrap; our remembered mode is "zk".
  ok("guard refuses a v2 escrow box in zk mode (app)", guardWouldRefuse(APP, "zk", box));
  ok("guard refuses a v2 escrow box in zk mode (web)", guardWouldRefuse(WEB, "zk", box));
  ok("guard refuses even a LEGACY esc box in zk mode (app)", guardWouldRefuse(APP, "zk", JSON.parse(legacyEsc)));
  ok("guard ALLOWS a zk box in zk mode (no false positive, app)", !guardWouldRefuse(APP, "zk", zkBox));
  ok("guard ALLOWS a zk box in zk mode (web)", !guardWouldRefuse(WEB, "zk", zkBox));
  ok("guard does not fire in esc mode (escrow user, app)", !guardWouldRefuse(APP, "esc", box));
  // the strengthening: the OLD guard only checked box.m === "esc" and would MISS a v2
  // escrow box entirely. Prove the v2 escrow box has no top-level m field.
  ok("v2 escrow box has no legacy .m field (old guard would have missed it)", JSON.parse(box).m === undefined);

  // ── 5. app.js ⇄ webcache PARITY: a box built by app opens byte-identically on web ─
  ok("app-built multi-wrap opens on WEB with passphrase", (await WEB.keyboxOpen(box, { passphrase: PASS })) === K);
  ok("app-built multi-wrap opens on WEB with file", (await WEB.keyboxOpen(box, { fileKey: FILE })) === K);
  ok("app-built multi-wrap opens on WEB with code", (await WEB.keyboxOpen(box, { code: CODE })) === K);
  ok("app-built multi-wrap opens on WEB via escrow (silent)", (await WEB.keyboxOpen(box, "")) === K);
  ok("app-built ZK box on WEB throws ZK with no secret (prompts, never escrows)", (await threwAsync(() => WEB.keyboxOpen(zkBox, ""))) === "ZK");
  ok("both runtimes agree keyboxHasEsc on the same box", APP.keyboxHasEsc(box) === WEB.keyboxHasEsc(box) && APP.keyboxHasEsc(zkBox) === WEB.keyboxHasEsc(zkBox));
  ok("both runtimes agree keyboxMode on the same box", APP.keyboxMode(box) === WEB.keyboxMode(box) && APP.keyboxMode(removed) === WEB.keyboxMode(removed));

  // ── 6. a wrap normalized from a legacy zk box still opens via the v2 path ────────
  ok("legacy zk box, opened via {passphrase} object arg", (await APP.keyboxOpen(legacyZk, { passphrase: PASS })) === kZk);
  ok("keyboxWraps normalizes a legacy zk box to a single pass wrap", (() => { const w = APP.keyboxWraps(legacyZk); return w.length === 1 && w[0].t === "pass"; })());
  ok("keyboxWraps normalizes a legacy esc box to a single esc wrap", (() => { const w = APP.keyboxWraps(legacyEsc); return w.length === 1 && w[0].t === "esc" && w[0].k === kEsc; })());

  // ── 7. RECOVERY secrets: high-entropy, unambiguous, and they actually open a box ─
  const s1 = APP.recoveryFileSecret(), s2 = APP.recoveryFileSecret();
  ok("recovery file secret is high-entropy + unique", s1 !== s2 && s1.length >= 40 && /^[A-Za-z0-9_-]+$/.test(s1));
  const c1 = APP.recoveryCode(), c2 = APP.recoveryCode();
  ok("recovery code is grouped base32 and unique", c1 !== c2 && /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(c1));
  ok("recovery code has no ambiguous I L O U characters", !/[ILOU]/.test(c1.replace(/-/g, "")));
  ok("normalize strips dashes/spaces and maps look-alikes (O→0, I/L→1)", APP.recoveryCodeNormalize("o1il o-ab cde") === "0111" + "0ABCDE");
  ok("normalize is idempotent on a freshly-minted code (no O/I/L in it)", APP.recoveryCodeNormalize(c1) === c1.replace(/-/g, ""));
  // a code opens a box only through its NORMALIZED form — mint the wrap from the same
  // normalization the recovery flow will apply, then open with a messily-typed version.
  const codeNorm = APP.recoveryCodeNormalize(c1);
  const codeBox = await APP.keyboxBuild(K, { code: codeNorm });
  ok("a box built from a normalized code opens with the code typed with dashes+spaces", (await APP.keyboxOpen(codeBox, { code: APP.recoveryCodeNormalize(c1.replace(/-/g, " ").toLowerCase()) })) === K);
  // recovery FILE round-trip: payload → download text → parse → open the vault
  const secret = APP.recoveryFileSecret();
  const fileBox = await APP.keyboxBuild(K, { fileKey: secret });
  const fileText = JSON.stringify(APP.recoveryFilePayload(secret), null, 2);
  ok("recovery file payload is a labelled .cachekey", (() => { const o = JSON.parse(fileText); return o.app === "thecache" && o.kind === "recovery-file" && o.secret === secret; })());
  ok("parseRecoveryFile pulls the secret back out and it opens the vault", (await APP.keyboxOpen(fileBox, { fileKey: APP.parseRecoveryFile(fileText) })) === K);
  ok("parseRecoveryFile rejects a non-recovery file", APP.parseRecoveryFile('{"app":"thecache","kind":"backup"}') === null && APP.parseRecoveryFile("not json") === null);

  // ── 8. FIRST-keybox shaping — the actual ZK-by-default decision at signup ────────
  // "Just me" (passphrase, no escrow) → a zero-knowledge box the server can't read.
  const justMe = await APP._keyboxForPush(K, PASS, true, { escrow: false });
  ok("'Just me' + passphrase → zk box (no escrow), opens with passphrase", !APP.keyboxHasEsc(justMe) && APP.keyboxMode(justMe) === "zk" && (await APP.keyboxOpen(justMe, PASS)) === K);
  ok("'Just me' box has NO silent unlock (server can't open it)", !!(await threwAsync(() => APP.keyboxOpen(justMe, ""))));
  // "Keep a spare" (escrow, no passphrase) → the server holds a raw key, silent unlock.
  const spare = await APP._keyboxForPush(K, "", false, { escrow: true });
  ok("'Keep a spare' → escrow box, opens silently, mode esc", APP.keyboxHasEsc(spare) && APP.keyboxMode(spare) === "esc" && (await APP.keyboxOpen(spare, "")) === K);
  // "Keep a spare" + a passphrase → v2 {esc, pass}: both a silent unlock AND a passphrase.
  const sparePlus = await APP._keyboxForPush(K, PASS, true, { escrow: true });
  ok("'Keep a spare' + passphrase → v2 {esc,pass}, opens both ways, mode esc", JSON.parse(sparePlus).v === 2 && APP.keyboxHasEsc(sparePlus) && (await APP.keyboxOpen(sparePlus, "")) === K && (await APP.keyboxOpen(sparePlus, PASS)) === K);
  // no explicit choice (bare manual push / legacy flow) → today's escrow default, unchanged.
  const legacyDefault = await APP._keyboxForPush(K, "", false, {});
  ok("no choice → legacy escrow default (unchanged behavior)", JSON.parse(legacyDefault).m === "esc" && (await APP.keyboxOpen(legacyDefault, "")) === K);

  console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness threw: " + (e && e.stack || e)); console.log("\n0 passed, 1 failed"); process.exit(1); });
