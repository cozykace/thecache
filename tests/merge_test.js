const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8").split("\n");
// anchor-based extraction — immune to line drift
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
const block = (a, b) => src.slice(at(a), at(b)).join("\n");
const SYNC_HELPERS = block(/^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const SYNC_MERGERS = block(/^function mergeProfileStrings/, /^let _pullBusy/);

// ── mock environment ──
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

eval(SYNC_HELPERS + "\n" + SYNC_MERGERS);

let pass = 0, fail = 0;
function ok(name, cond) { (cond ? pass++ : fail++); console.log((cond ? "  ok  " : "FAIL  ") + name); }

// A "push" as our engine does it: adopt vault (merge) into THIS device, then seal
// the snapshot + its per-key meta. Returns the new vault {local, localMeta}.
function pushFrom(deviceLS, vault) {
  localStorage = deviceLS;
  mergeRemoteLocal(vault.local, vault.localMeta);   // adopt first (both-ways converge)
  stampGeneric();
  const local = snapshotLocal();
  const localMeta = buildLocalMeta(local);
  return { local, localMeta };
}
function pullInto(deviceLS, vault) { localStorage = deviceLS; return mergeRemoteLocal(vault.local, vault.localMeta); }

// ── Scenario 1: stale device must NOT clobber a fresher generic edit ──
(function () {
  // Device A and B both start synced with note="old" (mtime 0 baseline).
  const A = makeLS(), B = makeLS();
  A.setItem("money.note", "old"); B.setItem("money.note", "old");
  localStorage = A; stampGeneric();       // seed A at m:0
  localStorage = B; stampGeneric();       // seed B at m:0
  let vault = { local: { "money.note": "old" }, localMeta: { "money.note": 0 } };
  // A edits the note, then pushes.
  localStorage = A; A.setItem("money.note", "A-new");
  vault = pushFrom(A, vault);
  ok("S1: vault carries A's fresh note", vault.local["money.note"] === "A-new" && vault.localMeta["money.note"] > 0);
  // B (never pulled) edits an UNRELATED key and pushes — must adopt A's note, not seal its stale 'old'.
  localStorage = B; B.setItem("money.theme", "dark");
  vault = pushFrom(B, vault);
  ok("S1: stale B did NOT revert the note", vault.local["money.note"] === "A-new");
  ok("S1: B's own new key rode along", vault.local["money.theme"] === "dark");
  ok("S1: B's localStorage now holds A's note", B.getItem("money.note") === "A-new");
})();

// ── Scenario 2: fresh device adopts EVERYTHING from an OLD-format vault (no localMeta) ──
(function () {
  const fresh = makeLS();
  const oldVault = { local: { "money.note": "hello", "money.theme": "dusk", "money.reserve": "500" } };  // no localMeta
  const changed = pullInto(fresh, oldVault);
  ok("S2: fresh device reported change", changed === true);
  ok("S2: adopted note", fresh.getItem("money.note") === "hello");
  ok("S2: adopted theme", fresh.getItem("money.theme") === "dusk");
  ok("S2: adopted reserve", fresh.getItem("money.reserve") === "500");
})();

// ── Scenario 3: returning device keeps its OWN edited key even if vault has an older one ──
(function () {
  const dev = makeLS();
  dev.setItem("money.note", "mine");
  localStorage = dev; stampGeneric();              // seed at 0
  dev.setItem("money.note", "mine-edited"); stampGeneric();  // real edit → mtime now
  const vault = { local: { "money.note": "theirs" }, localMeta: { "money.note": 0 } };  // vault older
  pullInto(dev, vault);
  ok("S3: local edit survived an older vault pull", dev.getItem("money.note") === "mine-edited");
})();

// ── Scenario 4: badges union ──
(function () {
  const dev = makeLS();
  dev.setItem("money.badges", JSON.stringify(["first-week", "night-owl"]));
  const vault = { local: { "money.badges": JSON.stringify(["night-owl", "devoted"]) }, localMeta: {} };
  pullInto(dev, vault);
  const got = JSON.parse(dev.getItem("money.badges")).sort();
  ok("S4: badges unioned (no loss, no dup)", JSON.stringify(got) === JSON.stringify(["devoted", "first-week", "night-owl"]));
})();

// ── Scenario 5: customStats marks union per id ──
(function () {
  const dev = makeLS();
  dev.setItem("money.customStats", JSON.stringify([{ id: "streak-rent", label: "Rent", kind: "streak", marks: ["2026-05", "2026-06"] }]));
  const vault = { local: { "money.customStats": JSON.stringify([
    { id: "streak-rent", label: "RENT-renamed", kind: "streak", marks: ["2026-06", "2026-07"] },
    { id: "streak-gym", label: "Gym", kind: "streak", marks: ["2026-07"] },
  ]) }, localMeta: {} };
  pullInto(dev, vault);
  const out = JSON.parse(dev.getItem("money.customStats"));
  const rent = out.find((s) => s.id === "streak-rent");
  const gym = out.find((s) => s.id === "streak-gym");
  ok("S5: rent marks unioned", JSON.stringify(rent.marks) === JSON.stringify(["2026-05", "2026-06", "2026-07"]));
  ok("S5: local rename kept", rent.label === "Rent");
  ok("S5: remote-only stat adopted", gym && gym.marks[0] === "2026-07");
})();

// ── Scenario 6: charSince = min (fresh mint can't push the founding date forward) ──
(function () {
  const dev = makeLS();
  dev.setItem("money.charSince", "1750000000000");   // a "fresh mint" far in the future-ish
  const vault = { local: { "money.charSince": "1700000000000" }, localMeta: {} };  // older, true founding
  pullInto(dev, vault);
  ok("S6: earliest founding date wins", dev.getItem("money.charSince") === "1700000000000");
})();

// ── Scenario 7: two-device round trip converges (no flip-flop) ──
(function () {
  const A = makeLS(), B = makeLS();
  A.setItem("money.note", "start"); B.setItem("money.note", "start");
  let vault = { local: {}, localMeta: {} };
  vault = pushFrom(A, vault);           // A seeds
  pullInto(B, vault);                    // B adopts A's baseline
  localStorage = A; A.setItem("money.note", "A2"); vault = pushFrom(A, vault);
  pullInto(B, vault);
  ok("S7: B converged to A's newer note", B.getItem("money.note") === "A2");
  // now B pushes without editing — must not revert A on A's next pull
  vault = pushFrom(B, vault);
  pullInto(A, vault);
  ok("S7: A still shows A2 (no stale-B revert)", A.getItem("money.note") === "A2");
})();

// ── Scenario 8: device-ergonomic keys NEVER ride the vault (pinned per device) ──
(function () {
  const dev = makeLS();
  dev.setItem("money.zoom", "1.5"); dev.setItem("money.sidebarWidth", "320"); dev.setItem("money.note", "keepme");
  let vault = { local: {}, localMeta: {} };
  vault = pushFrom(dev, vault);
  ok("S8: zoom not sealed into vault", !("money.zoom" in vault.local));
  ok("S8: sidebarWidth not sealed into vault", !("money.sidebarWidth" in vault.local));
  ok("S8: real config (note) still sealed", vault.local["money.note"] === "keepme");
  // and a vault that DOES carry an old zoom must not be adopted onto a device
  const other = makeLS(); other.setItem("money.zoom", "1.0");
  pullInto(other, { local: { "money.zoom": "9.9" }, localMeta: { "money.zoom": 9999999999999 } });
  ok("S8: incoming vault zoom is ignored", other.getItem("money.zoom") === "1.0");
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
