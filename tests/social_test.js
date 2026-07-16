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

  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
