// CROSS-RUNTIME CRYPTO INTEROP — the vault is sealed by ONE runtime (app.js cloudSeal, the
// push side) and opened by ANOTHER (webcache.js openVault, the web pull side). If their
// AES-GCM envelope or their keybox format drift by one byte, a user seals data on one device
// that NO device can ever open — and for a phone-only ESCROW user (no passphrase) that is a
// PERMANENT lockout. These assertions load the REAL crypto out of both files by anchor and
// prove: app seals → webcache opens; the escrow key adopts SILENTLY (no passphrase); the
// zero-knowledge keybox round-trips and rejects a wrong passphrase; tamper + wrong-key fail.
//
// This is the "can Spencer log in and will the key work" guarantee, regression-locked.
const fs = require("fs"), path = require("path");
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
}
function makeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; } }; }
const LS = makeLS();   // SHARED between the two runtimes — app writes money.cloudKey, webcache reads it (mirrors reality)

// app.js crypto block: _b64 … keyboxOpen (push/seal side + keybox make/open)
const appCode = slice("app.js", /^function _b64\(buf\)/, /^async function downloadEncryptedBackup/);
// the slice already declares `const CLOUDKEY_KEY = "money.cloudKey"`, so don't also inject it
const APP = Function("localStorage", appCode + "\nreturn {cloudGenKey,cloudSeal,cloudOpen,keyboxMake,keyboxOpen,cloudKeyGet,cloudKeySet};")(LS);
// webcache.js crypto block: _b64 … openVault (web pull/open side + keybox open)
const webCode = slice("webcache.js", /function _b64\(buf\)/, /function wMergeProfile/);
const WEB = Function("localStorage", webCode + "\nreturn {keyboxOpen,openVault,keyGet,keySet,decryptJSON};")(LS);

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const threwAsync = async (fn) => { try { await fn(); return false; } catch (e) { return e && e.message ? e.message : true; } };

(async () => {
  // ── 1. ENVELOPE parity: app.js seals (the push), webcache opens (the pull) ──
  const kv = await APP.cloudGenKey();
  APP.cloudKeySet(kv);                                   // both runtimes read LS money.cloudKey
  const vault = { files: { "balances.json": '{"total":123}' }, local: { "money.deck": "[]" }, n: 42, s: "unicode ✓ 🐐" };
  const env = await APP.cloudSeal(vault);
  ok("app.js seal is a v2 envelope", JSON.parse(env).v === 2 && JSON.parse(env).app === "thecache");
  ok("app.js seal → webcache OPEN round-trips (envelope parity)", eq(await WEB.openVault(env, ""), vault));
  ok("app.js can open its own seal", eq(await APP.cloudOpen(env, ""), vault));

  // ── 2. ESCROW keybox: adopted with NO passphrase — the phone-only silent unlock ──
  const kEsc = await APP.cloudGenKey();
  const escBox = await APP.keyboxMake(kEsc, "");
  ok("escrow keybox is {m:'esc'} and carries the key", JSON.parse(escBox).m === "esc" && JSON.parse(escBox).k === kEsc);
  ok("webcache opens escrow keybox → exact key (no passphrase)", (await WEB.keyboxOpen(escBox, "")) === kEsc);
  ok("app opens escrow keybox → exact key", (await APP.keyboxOpen(escBox, "")) === kEsc);

  // ── 3. END-TO-END SILENT UNLOCK — the exact Spencer scenario ──
  // Device A (desktop/app) mints a key, seals the vault, writes an escrow keybox to the server.
  // Device B (fresh phone/webcache) holds NO key, adopts it from the keybox with NO passphrase,
  // and opens the vault. This is precisely "sign in on the phone and it just works."
  const kA = await APP.cloudGenKey();
  APP.cloudKeySet(kA);
  const vaultA = { files: { "x.json": "1" }, note: "spencer's cache" };
  const envA = await APP.cloudSeal(vaultA);
  const boxA = await APP.keyboxMake(kA, "");
  WEB.keySet("");                                        // fresh device B: no key on hand
  ok("fresh device B holds no key", WEB.keyGet() === "");
  const adopted = await WEB.keyboxOpen(boxA, "");        // silent adoption
  WEB.keySet(adopted);
  ok("SILENT UNLOCK: fresh web device adopts the escrow key + opens the vault", eq(await WEB.openVault(envA, ""), vaultA));

  // ── 4. ZERO-KNOWLEDGE keybox: passphrase-wrapped, round-trips + rejects wrong pass ──
  const kZk = await APP.cloudGenKey();
  const PASS = "correct horse battery staple";
  const zkBox = await APP.keyboxMake(kZk, PASS);
  const zkParsed = JSON.parse(zkBox);
  ok("zk keybox is {m:'zk'} with 210000 PBKDF2 iters", zkParsed.m === "zk" && zkParsed.iter === 210000);
  ok("zk keybox carries NO plaintext key", zkParsed.k === undefined);
  ok("webcache opens zk keybox with the right passphrase → exact key", (await WEB.keyboxOpen(zkBox, PASS)) === kZk);
  ok("app opens its own zk keybox with the right passphrase", (await APP.keyboxOpen(zkBox, PASS)) === kZk);
  ok("zk keybox REJECTS a wrong passphrase", !!(await threwAsync(() => WEB.keyboxOpen(zkBox, "wrong pass"))));
  ok("zk keybox with NO passphrase throws ZK (prompts once, never silently escrows)", (await threwAsync(() => WEB.keyboxOpen(zkBox, ""))) === "ZK");

  // ── 5. TAMPER + WRONG-KEY: a corrupted or foreign vault is refused (AES-GCM authenticity) ──
  APP.cloudKeySet(await APP.cloudGenKey());
  const env2 = await APP.cloudSeal({ a: 1, b: "two" });
  const bad = JSON.parse(env2);
  bad.ct = (bad.ct[0] === "A" ? "B" : "A") + bad.ct.slice(1);   // flip one ciphertext byte, keep valid base64
  WEB.keySet(APP.cloudKeyGet());                                // same key — so a failure is the TAMPER, not the key
  ok("tampered ciphertext is rejected (GCM auth tag)", !!(await threwAsync(() => WEB.openVault(JSON.stringify(bad), ""))));
  WEB.keySet(await APP.cloudGenKey());                          // a DIFFERENT (wrong) key
  ok("a device holding the WRONG key cannot open the vault", !!(await threwAsync(() => WEB.openVault(env2, ""))));

  console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness threw: " + (e && e.stack || e)); console.log("\n0 passed, 1 failed"); process.exit(1); });
