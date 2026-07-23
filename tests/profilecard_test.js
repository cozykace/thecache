// EDIT PROFILE — money.profileCard (the editable identity card) + the public-payload floor.
//
// What this pins down:
//   1. money.profileCard is GENERIC in BOTH runtimes (app.js isGenericKey ↔ webcache wIsGeneric)
//      — so the per-key newest-wins engine handles it with zero merge-code changes, and the two
//      runtimes can't fork on its class.
//   2. It merges newest-wins across two devices; an older device can never revert a newer edit.
//   3. money.profile's EXP witness is UNCHANGED by this work: the projection is still exactly
//      {exp, clicks, expBy} and profile text (name/role/note) still never rides it — the livelock
//      class this codebase keeps rediscovering stays closed, and two converged devices hash equal.
//   4. PRIVACY FLOOR: nothing marked private (pronouns, bio, note, the local name) can EVER appear
//      in the public `profiles` payload — profilePublicPayload emits {name} alone, and only while
//      the per-field toggle is on. The sharing-tier model (Ghost/Neighbor/Beacon) is a pending
//      decision; this floor must hold until it lands.
// Fixtures are placeholders only — never real personal data.
const fs = require("fs"), path = require("path");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
const webSrc = fs.readFileSync(path.join(__dirname, "..", "webcache.js"), "utf8").split("\n");
// anchor-based extraction — immune to line drift
const mk = (src) => {
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
  return { at, block: (a, b) => src.slice(at(a), at(b)).join("\n"), line: (a) => src[at(a)] };
};
const A = mk(appSrc), W = mk(webSrc);
const SYNC_HELPERS = A.block(/^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const SYNC_MERGERS = A.block(/^function mergeProfileStrings/, /^let _pullBusy/);
const CARD_HELPERS = A.block(/^const PROFILE_CARD_KEY/, /^function openProfile\(/);
const PUB_PAYLOAD  = A.block(/^function profilePublicPayload/, /^async function socialSetPublicName/);
const SET_PUB_SRC  = A.block(/^async function socialSetPublicName/, /^async function socialRequest/);
const W_LISTS      = W.line(/^  var W_INTERNAL =/) + "\n" + W.line(/^  var W_SPECIAL =/) + "\n" + W.line(/^  function wIsGeneric\(/);

// ── mock environment (same shape as merge_test.js) ──
function makeLS() {
  const store = {};
  return {
    _s: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}
let localStorage;
let PROFILE_STATS = {};
const devId = () => "devLocal";
const updateXp = () => {};
const document = { dispatchEvent() {} };
const ckSync = () => {};

const GET_PROFILE = appSrc[A.at(/^function getProfile\(\)/)];   // profileField's legacy read-through needs it
eval(SYNC_HELPERS + "\n" + SYNC_MERGERS + "\n" + GET_PROFILE + "\n" + CARD_HELPERS + "\n" + PUB_PAYLOAD);
eval(W_LISTS);   // webcache's class lists + wIsGeneric, loaded verbatim
// the app.js lists are `const` (they don't leak out of eval) — re-extract them verbatim
const appLists = Function(
  appSrc[A.at(/^const CLOUD_INTERNAL_KEYS/)] + "\n" +
  appSrc[A.at(/^const DEVICE_LOCAL_KEYS/)] + "\n" +
  appSrc[A.at(/^const SPECIAL_MERGE_KEYS/)] + "\n" +
  "return { CLOUD_INTERNAL_KEYS, DEVICE_LOCAL_KEYS, SPECIAL_MERGE_KEYS };")();

let pass = 0, fail = 0;
function ok(name, cond) { (cond ? pass++ : fail++); console.log((cond ? "  ok  " : "FAIL  ") + name); }

function pushFrom(deviceLS, vault) {
  localStorage = deviceLS;
  mergeRemoteLocal(vault.local, vault.localMeta);   // adopt first (both-ways converge)
  stampGeneric();
  const local = snapshotLocal();
  const localMeta = buildLocalMeta(local);
  return { local, localMeta };
}
function pullInto(deviceLS, vault) { localStorage = deviceLS; return mergeRemoteLocal(vault.local, vault.localMeta); }

// ── 1. class parity: GENERIC in both runtimes, and the class lists themselves agree ──
(function () {
  localStorage = makeLS();
  ok("C1: app.js classes money.profileCard as GENERIC", isGenericKey("money.profileCard") === true);
  ok("C1: not internal in app.js", !isInternalKey("money.profileCard"));
  ok("C1: not special in app.js", !isSpecialKey("money.profileCard"));
  ok("C1: webcache classes it GENERIC too", wIsGeneric("money.profileCard") === true);
  const appInternal = appLists.CLOUD_INTERNAL_KEYS.concat(appLists.DEVICE_LOCAL_KEYS).slice().sort();
  ok("C1: app internal lists == webcache W_INTERNAL", JSON.stringify(appInternal) === JSON.stringify(W_INTERNAL.slice().sort()));
  ok("C1: app SPECIAL list == webcache W_SPECIAL", JSON.stringify(appLists.SPECIAL_MERGE_KEYS.slice().sort()) === JSON.stringify(W_SPECIAL.slice().sort()));
  ok("C1: account-scoped (silos per account, never blends)", isAccountDataKey("money.profileCard") === true);
})();

// ── 2. two devices: newest edit wins; a stale device can never revert it ──
(function () {
  const A2 = makeLS(), B2 = makeLS();
  const v0 = JSON.stringify({ pronouns: "", bio: "" });
  A2.setItem("money.profileCard", v0); B2.setItem("money.profileCard", v0);
  localStorage = A2; stampGeneric();
  localStorage = B2; stampGeneric();
  let vault = { local: { "money.profileCard": v0 }, localMeta: { "money.profileCard": 0 } };
  // A fills the card in, pushes.
  localStorage = A2;
  setProfileCard({ pronouns: "they/them", bio: "placeholder person who likes placeholder things" });
  vault = pushFrom(A2, vault);
  const aCard = A2.getItem("money.profileCard");
  ok("S2: vault carries A's fresh card", vault.local["money.profileCard"] === aCard && vault.localMeta["money.profileCard"] > 0);
  // stale B edits an UNRELATED key and pushes — must adopt A's card, not seal its stale empty one.
  localStorage = B2; B2.setItem("money.note", "unrelated");
  vault = pushFrom(B2, vault);
  ok("S2: stale B did NOT revert the card", vault.local["money.profileCard"] === aCard);
  ok("S2: B converged to A's card", B2.getItem("money.profileCard") === aCard);
  // and an OLDER vault copy can't revert B now
  pullInto(B2, { local: { "money.profileCard": v0 }, localMeta: { "money.profileCard": 0 } });
  ok("S2: an older vault can't revert the newer card", B2.getItem("money.profileCard") === aCard);
  // convergence is livelock-free: both devices' authored layers hash identical
  localStorage = A2; pullInto(A2, vault); stampGeneric(); const hA = authoredHash(snapshotLocal(), {});
  localStorage = B2; stampGeneric(); const hB = authoredHash(snapshotLocal(), {});
  ok("S2: converged devices hash EQUAL (no corrective-push livelock)", hA === hB);
})();

// ── 3. returning device keeps its OWN newer card even against an older vault ──
(function () {
  const dev = makeLS();
  dev.setItem("money.profileCard", JSON.stringify({ bio: "v1" }));
  localStorage = dev; stampGeneric();                       // seed at 0
  setProfileCard({ bio: "v2 — a real edit" }); stampGeneric();  // real edit → mtime now
  const mine = dev.getItem("money.profileCard");
  pullInto(dev, { local: { "money.profileCard": JSON.stringify({ bio: "older remote" }) }, localMeta: { "money.profileCard": 0 } });
  ok("S3: local newer edit survived an older vault pull", dev.getItem("money.profileCard") === mine);
})();

// ── 4. money.profile's EXP witness is UNCHANGED by this work ──
(function () {
  const statsA = { exp: 140, clicks: 12, expBy: { d1: 100, d2: 40 }, dev: "d1" };
  const pA = JSON.stringify({ name: "Jane Doe", role: "artist", note: "hi", stats: statsA });
  const pB = JSON.stringify({ name: "Totally Different", role: "", note: "", stats: Object.assign({}, statsA, { dev: "d2" }) });
  const projA = _authoredProject("money.profile", pA), projB = _authoredProject("money.profile", pB);
  ok("W1: profile text never rides the EXP witness (name/role/note/dev ignored)", JSON.stringify(projA) === JSON.stringify(projB));
  ok("W1: projection is EXACTLY {clicks, exp, expBy} — witness not widened", JSON.stringify(Object.keys(projA).sort()) === JSON.stringify(["clicks", "exp", "expBy"]));
  // profileCard participates as a plain generic: canonicalized (key order can't churn), real edits register
  const c1 = JSON.stringify({ pronouns: "xe/xem", bio: "b" });
  const c2 = JSON.stringify({ bio: "b", pronouns: "xe/xem" });   // same content, different key order
  const c3 = JSON.stringify({ pronouns: "xe/xem", bio: "CHANGED" });
  const h = (card) => authoredHash({ "money.profileCard": card }, {});
  ok("W2: key order can't make two converged devices differ", h(c1) === h(c2));
  ok("W2: a real card edit changes the hash (edits register)", h(c1) !== h(c3));
})();

// ── 5. PRIVACY FLOOR: private fields can never reach the public profiles payload ──
(function () {
  const card = { pronouns: "they/them", bio: "my-private-bio-text", publicName: "  Cozy Placeholder  ", shareName: 1 };
  const off = profilePublicPayload(card, 0);
  ok("P1: toggle OFF → payload retracts the name ({name:''})", JSON.stringify(off) === JSON.stringify({ name: "" }));
  const on = profilePublicPayload(card, 1);
  ok("P1: toggle ON → ONLY the display name, trimmed", JSON.stringify(Object.keys(on)) === JSON.stringify(["name"]) && on.name === "Cozy Placeholder");
  const dump = JSON.stringify(profilePublicPayload(card, 1)) + JSON.stringify(profilePublicPayload(card, 0));
  ok("P1: pronouns never leave the device", dump.indexOf("they/them") === -1);
  ok("P1: bio never leaves the device", dump.indexOf("my-private-bio") === -1);
  ok("P1: a 60-char name is capped to 40 (no oversized public blob)", profilePublicPayload({ publicName: "x".repeat(60) }, 1).name.length === 40);
  ok("P1: empty/absent card is safe", JSON.stringify(profilePublicPayload(null, 1)) === JSON.stringify({ name: "" }));
  // source-level: the publisher goes THROUGH the payload floor and names no private field
  ok("P2: socialSetPublicName publishes via profilePublicPayload only", SET_PUB_SRC.indexOf("profilePublicPayload") !== -1);
  ok("P2: publisher source never mentions bio/pronouns/note", !/bio|pronouns|\bnote\b/.test(SET_PUB_SRC));
})();

// ── 6. card helpers: forgiving round-trip ──
(function () {
  localStorage = makeLS();
  ok("H1: empty store reads as {}", JSON.stringify(getProfileCard()) === "{}");
  setProfileCard({ pronouns: "she/her" });
  setProfileCard({ bio: "kept" });
  const c = getProfileCard();
  ok("H1: patches merge, nothing dropped", c.pronouns === "she/her" && c.bio === "kept");
  localStorage.setItem("money.profileCard", "{corrupted");
  ok("H1: corrupted JSON reads as {} (never throws)", JSON.stringify(getProfileCard()) === "{}");
})();

// ── 7. name/role/note ride the CARD, never money.profile (whose text fields are
//      exp-richer-wins — a peer with more EXP would revert a fresh edit). Legacy
//      values read through until the first card edit; an explicit clear sticks. ──
(function () {
  localStorage = makeLS();
  localStorage.setItem("money.profile", JSON.stringify({ name: "Legacy Jane", role: "old role", stats: { exp: 5, clicks: 1, expBy: { d1: 5 } } }));
  ok("F1: legacy money.profile text reads through", profileField("name") === "Legacy Jane" && profileField("role") === "old role");
  ok("F1: absent everywhere reads as empty (no throw)", profileField("note") === "");
  setProfileCard({ name: "Card Jane" });
  ok("F1: a card edit wins over legacy", profileName() === "Card Jane");
  setProfileCard({ name: "" });
  ok("F1: an explicit clear is respected (legacy can't resurrect it)", profileName() === "");
  const prof = JSON.parse(localStorage.getItem("money.profile"));
  ok("F1: money.profile was NEVER written (EXP ledger untouchable from the card)", prof.name === "Legacy Jane" && prof.stats.exp === 5);
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
