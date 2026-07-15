const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8").split("\n");
// anchor-based extraction — immune to line drift
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
const block = (a, b) => src.slice(at(a), at(b)).join("\n");
const SYNC_HELPERS = block(/^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const SYNC_MERGERS = block(/^function mergeProfileStrings/, /^let _pullBusy/);
eval(SYNC_HELPERS);
let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};

// 1. Canonicalization: same data, DIFFERENT key order → SAME hash (no ping-pong)
const localA = { "money.note": "hi", "money.reserve": "500", "money.profile": '{"exp":10,"dev":"a","expBy":{"a":10}}' };
const localB = { "money.reserve": "500", "money.profile": '{"expBy":{"a":10},"dev":"a","exp":10}', "money.note": "hi" };  // reordered top-level AND inside profile JSON
ok("canon: reordered keys/JSON hash identical", authoredHash(localA, {}) === authoredHash(localB, {}));

// 2. A genuine authored difference IS detected
const localC = Object.assign({}, localA, { "money.note": "changed" });
ok("detect: a changed value differs", authoredHash(localA, {}) !== authoredHash(localC, {}));

// 3. Engine files + api are IGNORED (only the 4 maps count)
const files1 = { "categories.json": '{"x":"food"}', "balances.json": '{"total":100}', "transactions.json": "[]" };
const files2 = { "categories.json": '{"x":"food"}', "balances.json": '{"total":999999}', "transactions.json": "[1,2,3]" };
ok("scope: engine files ignored (balances/txns differ, hash same)", authoredHash(localA, files1) === authoredHash(localA, files2));

// 4. A map difference IS detected
const files3 = { "categories.json": '{"x":"gas"}' };
ok("detect: a map value differs", authoredHash(localA, files1) !== authoredHash(localA, files3));

// 5. map JSON internal order canonicalized
const m1 = { "categories.json": '{"a":"1","b":"2"}' };
const m2 = { "categories.json": '{"b":"2","a":"1"}' };
ok("canon: map internal key order ignored", authoredHash(localA, m1) === authoredHash(localA, m2));

// 6. SUPERSET semantics: vault=subset, ours=superset → DIFFER (we're ahead → push)
const vaultLocal = { "money.note": "hi" };
const ourLocal = { "money.note": "hi", "money.log": '[{"at":1,"itemId":"q"}]' };  // we have a check-in the vault lacks
ok("superset: extra authored key => ahead (differs)", authoredHash(vaultLocal, {}) !== authoredHash(ourLocal, {}));

// 7. EQUAL when vault already holds everything we have (converged)
ok("converged: identical authored => equal", authoredHash(ourLocal, files1) === authoredHash(ourLocal, files1));

// 8. plain non-JSON string values compared as-is (note text)
ok("plain string compare", authoredHash({"money.note":"abc"}, {}) !== authoredHash({"money.note":"abd"}, {}));

// 9. money.calview (calendar prefs) is a SYNCED generic key — included in the authored hash so an
// edit arms a push (were it internal/device-local it would be ignored and these would be EQUAL).
ok("calview: an edit is detected → it follows you across devices",
   authoredHash({"money.calview":'{"view":"month","weekStart":0}'}, {}) !== authoredHash({"money.calview":'{"view":"week","weekStart":1}'}, {}));

// 10. money.deckDay (the deck's per-device viewed day) is DEVICE_LOCAL + SILOED — it must NOT
// affect the authored hash (each device keeps its own place), and must be mirrored device-local
// in webcache's W_INTERNAL or the two runtimes fork (one syncs it, one doesn't).
ok("deckDay: classified device-local (internal)", isInternalKey("money.deckDay"));
ok("deckDay: siloed — a change does NOT arm a push (inverse of calview)",
   authoredHash({"money.deckDay":"2026-07-15"}, {}) === authoredHash({"money.deckDay":"2026-07-01"}, {}));
ok("deckDay: mirrored device-local in webcache W_INTERNAL",
   /W_INTERNAL[\s\S]*?money\.deckDay/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "webcache.js"), "utf8")));

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
