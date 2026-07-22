// ── Bug credits: the fixed-report feedback loop ──────────────────────────────
// money.bugCredits is a SPECIAL union-by-report-id set (like money.badges), and the
// EXP grant banks into a DETERMINISTIC ledger slot (expBy["bug:<id>"]) so two devices
// that both see the same fixed report converge on ONE grant. These assertions pin:
//   · exactly-once claim per device, and exactly-once ACROSS devices after merge
//   · union converges (both orders), keep-local `at` never livelocks the witness
//   · app.js ↔ webcache.js parity (same merge class, byte-identical merge output)
//   · the derived contributor stat counts/sums from the set (never a second counter)
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const appSrc = read("app.js").split("\n");
const webSrc = read("webcache.js").split("\n");
const at = (lines, re) => { const i = lines.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
const block = (lines, a, b) => lines.slice(at(lines, a), at(lines, b)).join("\n");

const CREDIT_ENGINE = block(appSrc, /^const BUG_CREDITS_KEY/, /^\/\/ ── Trust badge/);
const SYNC_HELPERS = block(appSrc, /^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const SYNC_MERGERS = block(appSrc, /^function mergeProfileStrings/, /^let _pullBusy/);
const W_MERGER = block(webSrc, /^  function wMergeBugCredits/, /^  function wMergeCharSince/);
const W_SPECIAL_LINE = webSrc[at(webSrc, /^  var W_SPECIAL = \[/)];

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
let _statsTimer = null;
const saveStats = () => {};
const updateXp = () => {};
const devId = () => "devLocal";
const document = { dispatchEvent() {} };
const ckSync = () => {};
let charLogged = [];
const logChar = (k, d, t) => { charLogged.push({ k, d, t }); };

// function declarations leak out of a direct eval; const/var bindings don't — return them
const G = eval(CREDIT_ENGINE + "\n" + SYNC_HELPERS + "\n" + SYNC_MERGERS + "\n" + W_MERGER + "\n" + W_SPECIAL_LINE +
  "\n;({ BUG_FIX_EXP: BUG_FIX_EXP, SPECIAL_MERGE_KEYS: SPECIAL_MERGE_KEYS, W_SPECIAL: W_SPECIAL });");
const A_BUG_FIX_EXP = G.BUG_FIX_EXP, A_SPECIAL = G.SPECIAL_MERGE_KEYS, WEB_SPECIAL = G.W_SPECIAL;

let pass = 0, fail = 0;
function ok(name, cond) { (cond ? pass++ : fail++); console.log((cond ? "  ok  " : "FAIL  ") + name); }

// ── 1. exactly-once on ONE device ──
(function () {
  localStorage = makeLS();
  PROFILE_STATS = { exp: 100, clicks: 100, dev: "devA", expBy: { devA: 100 } };
  ok("claim: a new id grants", bugCreditClaim("r1", "2026-07-20 10:00:00.000Z") === true);
  ok("claim: EXP granted once", PROFILE_STATS.exp === 100 + A_BUG_FIX_EXP);
  ok("claim: banked in the report's OWN slot, not the device slot",
     PROFILE_STATS.expBy["bug:r1"] === A_BUG_FIX_EXP && PROFILE_STATS.expBy.devA === 100);
  ok("claim: re-claiming the same id is a no-op", bugCreditClaim("r1", "later") === false);
  ok("claim: no double EXP on re-claim", PROFILE_STATS.exp === 100 + A_BUG_FIX_EXP);
  ok("claim: credits set holds ONE entry", bugCredits().length === 1);
  ok("claim: journey entry uses the deterministic server time",
     charLogged.length === 1 && charLogged[0].t === Date.parse("2026-07-20 10:00:00.000Z"));
})();

// ── 2. the double-sighting: BOTH devices poll the same fixed report before syncing —
//      the merged EXP ledger must count it ONCE ──
(function () {
  const A = makeLS(), B = makeLS();
  localStorage = A; PROFILE_STATS = { exp: 100, clicks: 100, dev: "devA", expBy: { devA: 100 } };
  bugCreditClaim("r1", "t1");
  const profA = JSON.stringify({ name: "Jane", stats: PROFILE_STATS });
  localStorage = B; PROFILE_STATS = { exp: 40, clicks: 40, dev: "devB", expBy: { devB: 40 } };
  bugCreditClaim("r1", "t2");   // B saw it too (its own poll, different clock)
  const profB = JSON.stringify({ name: "Jane", stats: PROFILE_STATS });
  const merged = JSON.parse(mergeProfileStrings(profA, profB)).stats;
  ok("2-device: merged EXP counts the grant ONCE (100+40+25)", merged.exp === 165);
  ok("2-device: the bug slot collapsed by slot-wise max", merged.expBy["bug:r1"] === A_BUG_FIX_EXP);
  ok("2-device: both device slots intact", merged.expBy.devA === 100 && merged.expBy.devB === 40);
  // and the credits union converges to one entry from either direction
  localStorage = A; mergeBugCreditsStr(B.getItem("money.bugCredits"));
  localStorage = B; mergeBugCreditsStr(A.getItem("money.bugCredits"));
  ok("2-device: credits union holds ONE entry on A", JSON.parse(A.getItem("money.bugCredits")).length === 1);
  ok("2-device: credits union holds ONE entry on B", JSON.parse(B.getItem("money.bugCredits")).length === 1);
})();

// ── 3. union across DIFFERENT reports + adoption never re-grants ──
(function () {
  const A = makeLS(), B = makeLS();
  localStorage = A; PROFILE_STATS = { exp: 0, clicks: 0, dev: "devA", expBy: { devA: 0 } };
  bugCreditClaim("r1", "a1"); bugCreditClaim("r2", "a2");
  localStorage = B; PROFILE_STATS = { exp: 0, clicks: 0, dev: "devB", expBy: { devB: 0 } };
  bugCreditClaim("r2", "b2"); bugCreditClaim("r3", "b3");
  const expB = PROFILE_STATS.exp;
  // B adopts A's set via the vault merge — ids arrive, EXP does NOT re-grant here
  // (the grant travels inside money.profile's ledger slots)
  localStorage = B;
  ok("union: merge reports change", mergeBugCreditsStr(A.getItem("money.bugCredits")) === true);
  const idsB = JSON.parse(B.getItem("money.bugCredits")).map((c) => c.id).sort();
  ok("union: B holds all three ids", JSON.stringify(idsB) === '["r1","r2","r3"]');
  ok("union: adopting a credit never re-grants EXP", PROFILE_STATS.exp === expB);
  const keptAt = JSON.parse(B.getItem("money.bugCredits")).find((c) => c.id === "r2").at;
  ok("union: an id both hold keeps the LOCAL entry", keptAt === "b2");
  localStorage = A; mergeBugCreditsStr(B.getItem("money.bugCredits"));
  const idsA = JSON.parse(A.getItem("money.bugCredits")).map((c) => c.id).sort();
  ok("union: A converges to the same set", JSON.stringify(idsA) === JSON.stringify(idsB));
  ok("union: idempotent (second merge = no change)", mergeBugCreditsStr(B.getItem("money.bugCredits")) === false);

  // ── 4. witness: the converged devices (different order, different kept-local `at`)
  //      must hash IDENTICALLY — a snapshotted-but-unprojected key is a livelock ──
  ok("witness: converged A/B hash identically (no livelock)",
     authoredHash({ "money.bugCredits": A.getItem("money.bugCredits") }, {}) ===
     authoredHash({ "money.bugCredits": B.getItem("money.bugCredits") }, {}));
  ok("witness: a genuinely missing credit still differs (honest)",
     authoredHash({ "money.bugCredits": A.getItem("money.bugCredits") }, {}) !==
     authoredHash({ "money.bugCredits": JSON.stringify(JSON.parse(A.getItem("money.bugCredits")).slice(0, 2)) }, {}));
  // and the key actually rides the vault as a SPECIAL (not generic, not internal)
  ok("class: SPECIAL in app.js", A_SPECIAL.indexOf("money.bugCredits") !== -1);
  ok("class: not generic / not internal", !isGenericKey("money.bugCredits") && !isInternalKey("money.bugCredits"));
  localStorage = A;
  ok("class: snapshotLocal seals it", snapshotLocal()["money.bugCredits"] === A.getItem("money.bugCredits"));
})();

// ── 5. app.js ↔ webcache.js parity ──
(function () {
  ok("parity: WEB_SPECIAL lists money.bugCredits", WEB_SPECIAL.indexOf("money.bugCredits") !== -1);
  ok("parity: SPECIAL key lists are identical across runtimes",
     JSON.stringify(A_SPECIAL.slice().sort()) === JSON.stringify(WEB_SPECIAL.slice().sort()));
  // byte-identical merge output on the same fixtures
  const localFix = JSON.stringify([{ id: "r1", at: "a1", exp: 25 }, { id: "r2", at: "a2", exp: 25 }]);
  const remoteFix = JSON.stringify([{ id: "r2", at: "b2", exp: 25 }, { id: "r3", at: "b3", exp: 25 }]);
  const A = makeLS(); A.setItem("money.bugCredits", localFix);
  const W = makeLS(); W.setItem("money.bugCredits", localFix);
  localStorage = A; mergeBugCreditsStr(remoteFix);
  localStorage = W; wMergeBugCredits(remoteFix);
  ok("parity: app and web mergers produce byte-identical results",
     A.getItem("money.bugCredits") === W.getItem("money.bugCredits"));
  // both no-op identically on garbage
  localStorage = A; const rA = mergeBugCreditsStr("not json");
  localStorage = W; const rW = wMergeBugCredits("not json");
  ok("parity: garbage input no-ops in both", rA === false && rW === false && A.getItem("money.bugCredits") === W.getItem("money.bugCredits"));
})();

// ── 6. the derived stat ──
(function () {
  localStorage = makeLS();
  const empty = bugCreditStat();
  ok("stat: zero state derives {0, 0}", empty.count === 0 && empty.exp === 0);
  localStorage.setItem("money.bugCredits", JSON.stringify([
    { id: "r1", at: "a1", exp: 25 }, { id: "r2", at: "a2", exp: 25 }, { id: "r3", at: "a3", exp: 25 },
    { id: null, at: "junk" },   // a malformed row must not count
  ]));
  const st = bugCreditStat();
  ok("stat: counts fixed reports from the set", st.count === 3);
  ok("stat: sums the EXP earned from them", st.exp === 75);
  ok("stat: garbage storage derives {0, 0}", (localStorage.setItem("money.bugCredits", "not json"), bugCreditStat().count === 0));
})();

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
