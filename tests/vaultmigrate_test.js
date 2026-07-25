// v1 → v2 VAULT AUTO-MIGRATION — the recovery net for legacy passphrase-only vaults.
//
// A v1 vault IS its passphrase: the data key lives nowhere, so a forgotten passphrase =
// permanent, total loss. This upgrades a v1 vault to the keybox scheme + issues a recovery
// file the moment it's opened with the passphrase. Getting it wrong here is a DATA-LOSS or
// a PRIVACY-DOWNGRADE bug on real money, so every invariant from the brief is pinned here,
// loading the REAL cloudMigrateV1IfNeeded + crypto out of app.js and the READER out of
// webcache.js by anchor (never line numbers). A fake PocketBase vault stands in for the
// server so the two-phase write is exercised end to end, including its failure modes:
//   1. a v1 blob still opens with the passphrase (until migrated) on BOTH runtimes;
//   2. opening a v1 vault migrates it: v2 blob, keybox has pass + file wraps and NO esc
//      wrap, and BOTH the passphrase AND the recovery file open it;
//   3. a FAILED migration (missing keybox field, or a network drop mid-flip) leaves the v1
//      vault openable with the passphrase — no brick, no half-write;
//   4. an already-v2 vault never re-triggers migration (zero writes);
//   5. a half-finished migration RESUMES with the SAME key (never forks a second one);
//   6. a WRONG passphrase never migrates (no writes at all);
//   7. app.js ⇄ webcache: a migrated vault opens byte-identically on both runtimes.
const fs = require("fs"), path = require("path");
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
}
function makeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, key: (i) => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; } }; }

// app.js crypto block (_b64 … downloadEncryptedBackup) + the migration function itself.
const cryptoCode = slice("app.js", /^function _b64\(buf\)/, /^async function downloadEncryptedBackup/);
const migCode = slice("app.js", /^async function cloudMigrateV1IfNeeded/, /^async function cloudPull\(passphrase\)/);
// webcache.js reader block (_b64 … wMergeProfile) — the OTHER runtime that must open the result.
const webCode = slice("webcache.js", /function _b64\(buf\)/, /function wMergeProfile/);

// a pure crypto helper (no server) for building v1/v2 fixtures and re-opening keyboxes
const C = Function("localStorage", cryptoCode + "\nreturn {encryptJSON,decryptJSON,keyboxOpen,keyboxBuild,keyboxWraps,keyboxHasEsc,keyboxMethods,keyboxMode,cloudGenKey,cloudSeal};")(makeLS());

// A fake PocketBase vault record + its REST surface, with switchable failure modes:
//   keyboxFieldMissing — the collection lacks its 'keybox' text field (PocketBase 200s but
//                        silently drops the field — the classic brick trap);
//   failPhaseA         — the keybox PATCH errors (HTTP 500);
//   failPhaseB         — the blob PATCH throws (a network drop mid-flip).
function makeServer(rec, opts) {
  opts = opts || {};
  let bump = 0;
  const server = {
    record: Object.assign({}, rec),
    downloaded: [],
    patches: [],
    async fetch(url, init) {
      const method = (init && init.method) || "GET";
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (method !== "PATCH") return { ok: true, status: 200, json: async () => Object.assign({}, server.record) };
      server.patches.push(body);
      if (opts.failPhaseA && ("keybox" in body)) return { ok: false, status: 500, json: async () => ({ message: "phase A boom" }) };
      if (opts.failPhaseB && ("blob" in body)) throw new Error("network down");            // network error mid-flip
      if ("keybox" in body && !opts.keyboxFieldMissing) server.record.keybox = body.keybox; // field-missing → dropped
      if ("blob" in body) server.record.blob = body.blob;
      server.record.updated = "2026-07-25T10:00:0" + (++bump) + "Z";
      return { ok: true, status: 200, json: async () => Object.assign({}, server.record) };
    },
  };
  return server;
}
// Build an app.js runtime (with the migration) + a webcache.js runtime SHARING one
// localStorage, so a key the migration plants is visible to the web reader (parity).
function scenario(server, downloadOk) {
  const LS = makeLS();
  const state = { token: "tok", userId: "u1", mode: null };
  const env = {
    localStorage: LS,
    cloudState: () => state,
    cloudSaveState: (patch) => Object.assign(state, patch),
    cloudUrl: () => "https://pb.test",
    cloudErr: (d) => (d && d.message) || "",
    fetch: (u, i) => server.fetch(u, i),
    downloadRecoveryFile: (secret) => { server.downloaded.push(secret); return downloadOk !== false; },
  };
  const an = Object.keys(env);
  const app = Function(...an, cryptoCode + "\n" + migCode +
    "\nreturn {cloudMigrateV1IfNeeded,cloudSeal,cloudOpen,encryptJSON,decryptJSON,keyboxBuild,keyboxOpen,keyboxWraps,keyboxHasEsc,keyboxMode,keyboxMethods,cloudGenKey,cloudKeyGet,cloudKeySet,recoveryFileSecret};")(...an.map((n) => env[n]));
  const web = Function("localStorage", webCode + "\nreturn {keyboxOpen,keyboxWraps,keyboxHasEsc,keyboxMode,openVault,keyGet};")(LS);
  return { LS, state, app, web };
}

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const threwAsync = async (fn) => { try { await fn(); return false; } catch (e) { return e && e.message ? e.message : true; } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const PASS = "correct horse battery staple";
  const OBJ = { files: { "balances.json": '{"total":0}', "categories.json": "{}" }, api: {}, filesMeta: {}, local: { "money.note": "hi" }, localMeta: {}, exported: "2026-07-25" };
  const v1blob = await C.encryptJSON(OBJ, PASS);
  ok("fixture v1 blob is a v1 envelope (v<2)", (JSON.parse(v1blob).v || 1) < 2);

  // ── 1. a v1 blob still opens with the passphrase on BOTH runtimes (until migrated) ──
  ok("v1 blob opens with the passphrase (app decryptJSON)", eq(await C.decryptJSON(v1blob, PASS), OBJ));
  {
    const sc = scenario(makeServer({ id: "x" }), true);
    // webcache.openVault on a v1 blob uses the passphrase directly (no held key)
    ok("v1 blob opens with the passphrase (web openVault)", eq(await sc.web.openVault(v1blob, PASS), OBJ));
    ok("v1 blob with NO passphrase throws ZK on web (needs the passphrase)", (await threwAsync(() => sc.web.openVault(v1blob, ""))) === "ZK");
  }

  // ── 2. HAPPY PATH: opening a v1 vault migrates it (zk keybox pass+file, no esc) ──────
  {
    const server = makeServer({ id: "v1", blob: v1blob, updated: "old" });
    const sc = scenario(server, true);
    const rec = { id: "v1", blob: v1blob, updated: "old" };
    const res = await sc.app.cloudMigrateV1IfNeeded(rec, OBJ, PASS);
    ok("migration reports ok + the recovery file was delivered", res.ok === true && res.fileDelivered === true);
    const box = server.record.keybox, parsed = JSON.parse(box);
    ok("the migrated keybox is v2", parsed.v === 2);
    ok("keybox has exactly a pass wrap + a file wrap", eq(sc.app.keyboxMethods(box).sort(), ["file", "pass"]));
    ok("keybox has NO escrow wrap (zero-knowledge preserved — the server can't read it)", !sc.app.keyboxHasEsc(box));
    ok("the blob is now v2 (sealed under the random key)", (JSON.parse(server.record.blob).v || 1) >= 2);
    const secret = server.downloaded[server.downloaded.length - 1];
    const kFromPass = await sc.app.keyboxOpen(box, { passphrase: PASS });
    const kFromFile = await sc.app.keyboxOpen(box, { fileKey: secret });
    ok("BOTH the passphrase AND the recovery file open the keybox → the SAME key", kFromPass === kFromFile);
    ok("the wrong passphrase does NOT open the migrated keybox", !!(await threwAsync(() => sc.app.keyboxOpen(box, { passphrase: "nope" }))));
    ok("the recovered key decrypts the v2 blob back to the original data (app)", eq(await sc.app.cloudOpen(server.record.blob, ""), OBJ));
    ok("migration remembered zero-knowledge mode (arms the downgrade guard)", sc.state.mode === "zk");
    ok("the in-hand record was advanced to v2 (blob + keybox) for the rest of the restore", rec.blob === server.record.blob && rec.keybox === box);
    // ── 7. app.js ⇄ webcache PARITY: the migrated vault opens byte-identically on web ──
    ok("web reader opens the migrated keybox with the passphrase → same key", (await sc.web.keyboxOpen(box, { passphrase: PASS })) === kFromPass);
    ok("web reader opens the migrated keybox with the recovery file → same key", (await sc.web.keyboxOpen(box, { fileKey: secret })) === kFromPass);
    ok("web reader agrees the migrated box is zero-knowledge (no esc)", !sc.web.keyboxHasEsc(box) && sc.web.keyboxMode(box) === "zk");
    ok("web reader decrypts the migrated v2 blob to the SAME data (held key from shared LS)", eq(await sc.web.openVault(server.record.blob, ""), OBJ));
  }

  // ── 3a. FAILED PHASE A (collection missing its 'keybox' field) — v1 vault untouched ──
  {
    const server = makeServer({ id: "v1", blob: v1blob, updated: "old" }, { keyboxFieldMissing: true });
    const sc = scenario(server, true);
    const rec = { id: "v1", blob: v1blob, updated: "old" };
    const msg = await threwAsync(() => sc.app.cloudMigrateV1IfNeeded(rec, OBJ, PASS));
    ok("phase-A failure throws a clear 'missing keybox field' error", typeof msg === "string" && /keybox/i.test(msg));
    ok("the blob is STILL v1 (never flipped) — no brick", server.record.blob === v1blob && (JSON.parse(server.record.blob).v || 1) < 2);
    ok("the v1 blob still opens with the passphrase after the failed migration", eq(await C.decryptJSON(server.record.blob, PASS), OBJ));
    ok("no vault key was adopted on this device (nothing half-committed)", sc.LS.getItem("money.cloudKey") === null);
    ok("no recovery file was claimed to the user on a failed migration", server.downloaded.length === 0);
  }

  // ── 3b/5. FAILED PHASE B (network drop mid-flip) — v1 openable, then RESUME finishes ─
  {
    const server = makeServer({ id: "v1", blob: v1blob, updated: "old" }, { failPhaseB: true });
    const sc1 = scenario(server, true);
    const rec1 = { id: "v1", blob: v1blob, updated: "old" };
    const msg = await threwAsync(() => sc1.app.cloudMigrateV1IfNeeded(rec1, OBJ, PASS));
    ok("phase-B network drop throws", typeof msg === "string");
    ok("the blob is STILL v1 after the phase-B drop (passphrase still opens it)", server.record.blob === v1blob && eq(await C.decryptJSON(server.record.blob, PASS), OBJ));
    ok("phase-A's keybox DID land (a resumable half-migration, not a brick)", !!server.record.keybox && eq(C.keyboxMethods(server.record.keybox).sort(), ["file", "pass"]));
    ok("no key adopted on the failed device (phase B never confirmed)", sc1.LS.getItem("money.cloudKey") === null);
    const kbAfterA = server.record.keybox;
    const kBeforeResume = await C.keyboxOpen(kbAfterA, { passphrase: PASS });   // the key phase A committed
    // RESUME: the next Restore sees a v1 blob that already carries a keybox → reuse its key.
    const server2 = makeServer(server.record, {});           // same record, now with a healthy network
    const sc2 = scenario(server2, true);
    const rec2 = Object.assign({}, server.record);
    const res2 = await sc2.app.cloudMigrateV1IfNeeded(rec2, OBJ, PASS);
    ok("resume completes the migration (ok + file delivered)", res2.ok === true && res2.fileDelivered === true);
    ok("resume flipped the blob to v2", (JSON.parse(server2.record.blob).v || 1) >= 2);
    const kAfterResume = await C.keyboxOpen(server2.record.keybox, { passphrase: PASS });
    ok("resume REUSED the same vault key (never forked a second one)", kAfterResume === kBeforeResume);
    const secret2 = server2.downloaded[server2.downloaded.length - 1];
    ok("resume's re-issued recovery file opens the vault to the same key", (await C.keyboxOpen(server2.record.keybox, { fileKey: secret2 })) === kBeforeResume);
    ok("resumed v2 blob decrypts back to the original data on web too (parity)", eq(await sc2.web.openVault(server2.record.blob, ""), OBJ));
  }

  // ── 4. ALREADY-V2 vault never re-triggers migration (idempotent, zero writes) ────────
  {
    const K = await C.cloudGenKey();
    const v2blob = await C.cloudSeal(OBJ, K);
    const v2box = await C.keyboxBuild(K, { passphrase: PASS, fileKey: "Zm9vYmFyLXNlY3JldA" });
    const server = makeServer({ id: "v2", blob: v2blob, keybox: v2box, updated: "old" });
    const sc = scenario(server, true);
    const rec = { id: "v2", blob: v2blob, keybox: v2box, updated: "old" };
    const res = await sc.app.cloudMigrateV1IfNeeded(rec, OBJ, PASS);
    ok("already-v2 → migration is a no-op ({ok:false})", res.ok === false);
    ok("already-v2 → NOT A SINGLE write hit the server (no re-migration, no fork)", server.patches.length === 0);
  }

  // ── 6. a WRONG passphrase never migrates (self-safe, independent of the caller) ──────
  {
    const server = makeServer({ id: "v1", blob: v1blob, updated: "old" });
    const sc = scenario(server, true);
    const rec = { id: "v1", blob: v1blob, updated: "old" };
    const res = await sc.app.cloudMigrateV1IfNeeded(rec, OBJ, "the WRONG passphrase");
    ok("wrong passphrase → no migration ({ok:false})", res.ok === false);
    ok("wrong passphrase → zero writes (never wraps the key under a wrong secret)", server.patches.length === 0);
    ok("wrong passphrase → the v1 blob is untouched", server.record.blob === v1blob);
    ok("wrong passphrase → no recovery file downloaded", server.downloaded.length === 0);
  }

  // ── 2b. DOWNLOAD FAILURE is reported honestly (ok, but fileDelivered:false) ──────────
  {
    const server = makeServer({ id: "v1", blob: v1blob, updated: "old" });
    const sc = scenario(server, false);   // the download does NOT land
    const rec = { id: "v1", blob: v1blob, updated: "old" };
    const res = await sc.app.cloudMigrateV1IfNeeded(rec, OBJ, PASS);
    ok("migration still upgrades the vault even when the file download fails", res.ok === true && (JSON.parse(server.record.blob).v || 1) >= 2);
    ok("a failed download is reported as fileDelivered:false (never a false success)", res.fileDelivered === false);
    ok("the passphrase still opens the upgraded vault (the file failure isn't a brick)", (await sc.app.keyboxOpen(server.record.keybox, { passphrase: PASS })) === sc.app.cloudKeyGet());
  }

  // ── 8. CONVERGENCE: the migration key is DETERMINISTIC (passphrase + vault id), so two
  //    devices upgrading the SAME vault concurrently can only converge, never fork/brick ──
  {
    const serverA = makeServer({ id: "vRACE", blob: v1blob, updated: "old" });
    const serverB = makeServer({ id: "vRACE", blob: v1blob, updated: "old" });
    const scA = scenario(serverA, true), scB = scenario(serverB, true);
    await scA.app.cloudMigrateV1IfNeeded({ id: "vRACE", blob: v1blob }, OBJ, PASS);
    await scB.app.cloudMigrateV1IfNeeded({ id: "vRACE", blob: v1blob }, OBJ, PASS);
    const kA = await C.keyboxOpen(serverA.record.keybox, { passphrase: PASS });
    const kB = await C.keyboxOpen(serverB.record.keybox, { passphrase: PASS });
    ok("two independent migrations of the SAME vault derive the SAME key (convergent, never forks)", kA === kB);
    // the property that makes ANY interleaving of the two-phase writes safe: device A's
    // keybox key decrypts device B's re-sealed blob (they used the identical key).
    scB.app.cloudKeySet(kA);
    ok("device A's key decrypts device B's re-sealed blob (a split keybox/blob stays consistent)", eq(await scB.app.cloudOpen(serverB.record.blob, ""), OBJ));
    // and a DIFFERENT vault id yields a DIFFERENT key — the salt is per-vault
    const serverC = makeServer({ id: "vOTHER", blob: v1blob, updated: "old" });
    const scC = scenario(serverC, true);
    await scC.app.cloudMigrateV1IfNeeded({ id: "vOTHER", blob: v1blob }, OBJ, PASS);
    const kC = await C.keyboxOpen(serverC.record.keybox, { passphrase: PASS });
    ok("a different vault id derives a different key (per-vault salt, no cross-vault reuse)", kC !== kA);
  }

  console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness threw: " + (e && e.stack || e)); console.log("\n0 passed, 1 failed"); process.exit(1); });
