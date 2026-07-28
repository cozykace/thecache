// THE CACHE — browser money engine (webmoney.js) unit tests.
//
// The JS↔Python parity that proves the compute matches the desktop lives in
// tests/webmoney_parity.py. THIS file covers the browser-only behaviour that has no Python
// counterpart to compare against: merge_ledger dedupe + TOMBSTONE survival, the CSV parser's
// edge cases (quoted commas, parenthesized/negative amounts, date formats, debit/credit
// columns, last-4 account matching), the content-key dedupe that stops re-import
// double-counting, and pyRound's banker's rounding. Fixtures are placeholders only.
const M = require("../webmoney.js");
let p = 0, f = 0;
const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── pyRound (banker's rounding, matched to Python round() in the parity test) ──
ok("pyRound 2.5 → 2 (half to even)", M.pyRound(2.5) === 2);
ok("pyRound 3.5 → 4 (half to even)", M.pyRound(3.5) === 4);
ok("pyRound 0.125,2 → 0.12", M.pyRound(0.125, 2) === 0.12);
ok("pyRound 2.675,2 → 2.67 (not 2.68 — float truth)", M.pyRound(2.675, 2) === 2.67);
ok("pyRound -2.5 → -2", M.pyRound(-2.5) === -2);
ok("pyRound 12.345,2 → 12.35", M.pyRound(12.345, 2) === 12.35);

// ── merge_ledger: dedupe by key ──────────────────────────────────────────────
(function () {
  const led0 = {};
  const a = { id: "t1", posted: 1000, amount: -5, description: "A" };
  const b = { id: "t2", posted: 2000, amount: -6, description: "B" };
  let led = M.mergeLedger(led0, [a, b], {});
  ok("merge: two new txns land", Object.keys(led).length === 2);
  // re-merge the SAME txns → no growth (deduped by key)
  led = M.mergeLedger(led, [a, b], {});
  ok("merge: identical re-merge does not double-count", Object.keys(led).length === 2);
  // a keyless txn dedupes on content key (posted|amount|desc)
  const c = { posted: 3000, amount: -7, description: "no id here" };
  led = M.mergeLedger(led, [c], {});
  led = M.mergeLedger(led, [c], {});
  ok("merge: keyless txn dedupes on content key", Object.keys(led).length === 3);
})();

// ── merge_ledger: TOMBSTONE survival (a deleted txn can never be resurrected) ──
(function () {
  const t = { id: "gone", posted: 1000, amount: -50, description: "DELETED CHARGE" };
  const tomb = { gone: { deleted: 1, at: 123, txn: t } };
  let led = M.mergeLedger({}, [t], tomb);
  ok("merge: tombstoned txn is refused entry", Object.keys(led).length === 0);
  // an un-delete (deleted:0) lets it back in
  const tomb2 = { gone: { deleted: 0, at: 200, txn: t } };
  led = M.mergeLedger({}, [t], tomb2);
  ok("merge: un-deleted (deleted:0) txn lands", Object.keys(led).length === 1);
  // isDeleted helper
  ok("isDeleted true for a live tombstone", M.isDeleted("gone", tomb) === true);
  ok("isDeleted false for an un-delete", M.isDeleted("gone", tomb2) === false);
})();

// ── merge_ledger: shrink guard ───────────────────────────────────────────────
(function () {
  let threw = false;
  // mergeLedger can't shrink on its own (it only adds); prove the guard exists by
  // simulating a bad state is impossible — instead assert a normal merge never loses rows
  const led = M.mergeLedger({ a: { id: "a", posted: 1, amount: -1, description: "x" } },
    [{ id: "b", posted: 2, amount: -2, description: "y" }], {});
  ok("merge: never loses an existing row while adding", led.a && Object.keys(led).length === 2);
})();

// ── ledgerKey ────────────────────────────────────────────────────────────────
ok("ledgerKey uses the bank id when present", M.ledgerKey({ id: "abc", posted: 1, amount: -2, description: "x" }) === "abc");
ok("ledgerKey falls back to a content key", M.ledgerKey({ posted: 1000, amount: -2.5, description: "coffee" }) === "1000|-2.5|coffee");

// ── CSV parse: quoted commas + a standard amount column ──────────────────────
(function () {
  const csv = 'Date,Description,Amount\n' +
    '01/15/2026,"BODEGA, CORNER LLC",-12.50\n' +
    '01/16/2026,PAYROLL DEPOSIT,2000.00\n';
  const r = M.parseCsv(csv, "chase1234.csv", {});
  ok("csv: no error on a clean file", r.error === null && r.txns.length === 2);
  ok("csv: quoted comma kept inside the description", r.txns[0].description === "BODEGA, CORNER LLC");
  ok("csv: negative amount parsed", r.txns[0].amount === -12.5);
  ok("csv: positive amount parsed", r.txns[1].amount === 2000);
})();

// ── CSV parse: parenthesized negatives + $ + thousands separators ────────────
(function () {
  const csv = 'Posted Date,Payee,Amount\n' +
    '2026-01-10,BIG PURCHASE,"($1,234.56)"\n' +
    '2026-01-11,REFUND,"$1,000.00"\n';
  const r = M.parseCsv(csv, "amex.csv", {});
  ok("csv: ($1,234.56) → -1234.56", r.txns[0].amount === -1234.56);
  ok("csv: $1,000.00 → 1000", r.txns[1].amount === 1000);
})();

// ── CSV parse: separate debit / credit columns ───────────────────────────────
(function () {
  const csv = 'Transaction Date,Description,Debit,Credit\n' +
    '01/05/2026,GROCERY RUN,45.20,\n' +
    '01/06/2026,PAYCHECK,,1500.00\n';
  const r = M.parseCsv(csv, "bank.csv", {});
  ok("csv: debit column → negative", r.txns[0].amount === -45.2);
  ok("csv: credit column → positive", r.txns[1].amount === 1500);
})();

// ── CSV parse: multiple date formats ─────────────────────────────────────────
(function () {
  const fmts = [
    ["01/15/2026", "Jan 15 2026 mdy slash"],
    ["2026-01-15", "iso"],
    ["01-15-2026", "mdy dash"],
    ["2026/01/15", "ymd slash"],
    ['"Jan 15, 2026"', "month name (quoted — the comma is inside the field)"],
  ];
  let allSame = true;
  const base = M.parseCsv("Date,Description,Amount\n01/15/2026,X,-1.00\n", "f.csv", {}).txns[0].posted;
  fmts.forEach(([d]) => {
    const r = M.parseCsv("Date,Description,Amount\n" + d + ",X,-1.00\n", "f.csv", {});
    if (!(r.txns.length === 1 && r.txns[0].posted === base)) allSame = false;
  });
  ok("csv: all supported date formats parse to the same day", allSame);
  // a day/month ambiguous value that only fits %d/%m/%Y (month>12) still parses
  const r = M.parseCsv("Date,Description,Amount\n15/01/2026,X,-1.00\n", "f.csv", {});
  ok("csv: 15/01/2026 falls through to d/m/Y", r.txns.length === 1 && r.txns[0].posted === base);
})();

// ── CSV parse: last-4 account matching against the existing ledger ───────────
(function () {
  // NOTE: use a "Card Number" header (not "Account Number") — a header containing the word
  // "account" is picked up as the ACCOUNT-NAME column by _find's substring match (faithful
  // to import_statements.py), which would short-circuit the last-4 path.
  const led = { x: { id: "x", posted: 1, amount: -1, description: "y", account: "Everyday Checking 4821" } };
  const csv = 'Date,Description,Amount,Card Number\n' +
    '01/15/2026,COFFEE,-4.00,****4821\n';
  const r = M.parseCsv(csv, "unknown.csv", led);
  ok("csv: row's last-4 merges into the matching ledger account", r.txns[0].account === "Everyday Checking 4821");
})();

// ── CSV parse: missing required columns → friendly error, no throw ───────────
(function () {
  const r = M.parseCsv("Foo,Bar\n1,2\n", "weird.csv", {});
  ok("csv: missing date/amount columns → error string, empty txns", !!r.error && r.txns.length === 0);
})();

// ── importTxns: content-key dedupe stops re-import double-counting ────────────
(function () {
  const csv = 'Date,Description,Amount\n' +
    '01/15/2026,STARBUCKS,-5.00\n' +
    '01/15/2026,STARBUCKS,-5.00\n' +   // a genuine SECOND identical purchase same day
    '01/16/2026,TRADER JOES,-40.00\n';
  const files = {}; // empty vault
  const parsed = M.parseCsv(csv, "c.csv", {});
  ok("import: both same-day identical purchases survive first import", parsed.txns.length === 3);
  let res = M.importTxns(files, parsed.txns, { now: Math.floor(Date.parse("2026-01-20") / 1000) });
  const led1 = M.parseJsonl(res.files["ledger.jsonl"]);
  ok("import: first import lands all 3 (2 identical kept via id suffix)", Object.keys(led1).length === 3 && res.added === 3);
  // re-import the SAME csv → zero new (content-key multiset dedupe)
  const parsed2 = M.parseCsv(csv, "c.csv", {});
  res = M.importTxns(res.files, parsed2.txns, { now: Math.floor(Date.parse("2026-01-20") / 1000) });
  const led2 = M.parseJsonl(res.files["ledger.jsonl"]);
  ok("import: re-importing the overlapping CSV adds nothing (dedupe)", Object.keys(led2).length === 3 && res.added === 0 && res.dup === 3);
})();

// ── importTxns: a tombstoned txn is not re-added by an import ─────────────────
(function () {
  const t = { id: "csv:dead", posted: Math.floor(Date.parse("2026-01-15") / 1000), amount: -20, description: "DELETED", account: "Checking" };
  const files = { "deleted.json": JSON.stringify({ "csv:dead": { deleted: 1, at: 1, txn: t } }) };
  const res = M.importTxns(files, [t], { now: Math.floor(Date.parse("2026-01-20") / 1000) });
  const led = M.parseJsonl(res.files["ledger.jsonl"]);
  ok("import: honors tombstones — deleted txn stays out", !led["csv:dead"] && res.added === 0);
})();

// ── periodSummary: transfers excluded, reported as a footnote ─────────────────
(function () {
  const now = Math.floor(Date.parse("2026-01-20") / 1000);
  const day = 86400;
  const txns = [
    { id: "1", posted: now - 1 * day, amount: -30, description: "GROCERY", account: "C" },
    { id: "2", posted: now - 2 * day, amount: -100, description: "TRANSFER TO SAVINGS", account: "C" },
    { id: "3", posted: now - 3 * day, amount: 500, description: "GUSTO PAYROLL", account: "C" },
  ];
  const s = M.periodSummary(txns, { kind: "30d", now: now }, {});
  ok("periodSummary: transfer excluded from spending total", s.spending.total === 30);
  ok("periodSummary: transfer surfaced in spending.transfers", s.spending.transfers === 100);
  ok("periodSummary: income counted", s.income.total === 500);
})();

// ── prototype-key safety: a user-derived key equal to an Object.prototype member must
//    aggregate normally, never read an inherited value (Python dicts have no such trap).
//    "constructor" is the one all-lowercase member that survives _clean / _incomeKey. ──
(function () {
  const now = Math.floor(Date.parse("2026-01-20") / 1000), day = 86400;
  let threw = false, rows;
  try { rows = M.subscriptionItems([{ id: "c1", posted: now - day, amount: -9.99, description: "CONSTRUCTOR", account: "C" }], { "constructor": "subscriptions" }, {}); }
  catch (e) { threw = true; }
  ok("proto: subscriptionItems on a 'constructor' merchant does not crash", !threw);
  ok("proto: 'constructor' subscription aggregates to a number", rows && rows.length === 1 && rows[0].amount === 9.99);
  const s = M.periodSummary([{ id: "i1", posted: now - day, amount: 100, description: "CONSTRUCTOR", account: "C" }], { kind: "30d", now: now }, {});
  ok("proto: 'constructor' income is keyed + counted (not swallowed)", s.income.total === 100 && s.income.sources.length === 1 && s.income.sources[0].key === "constructor");
  const sp = M.periodSummary([{ id: "x", posted: now - day, amount: -20, description: "WEIRDMART", account: "C" }], { kind: "30d", now: now }, { overrides: { "weirdmart": "constructor" } });
  const cc = sp.spending.categories.find((c) => c.key === "constructor");
  ok("proto: 'constructor' category amount is a real number (not a fn-string)", cc && cc.amount === 20);
})();

// ── _num: accept what Python float() accepts (sci-notation, trailing/leading dot); drop non-finite ──
(function () {
  const csv = "Date,Description,Amount\n" +
    "01/15/2026,SCI,1e3\n01/16/2026,TRAILDOT,5.\n01/17/2026,LEADDOT,.75\n" +
    "01/18/2026,NEG,-40\n01/19/2026,INFROW,inf\n01/20/2026,NANROW,nan\n";
  const byDesc = {}; M.parseCsv(csv, "s.csv", {}).txns.forEach((t) => { byDesc[t.description] = t.amount; });
  ok("_num: '1e3' → 1000", byDesc["SCI"] === 1000);
  ok("_num: '5.' → 5", byDesc["TRAILDOT"] === 5);
  ok("_num: '.75' → 0.75", byDesc["LEADDOT"] === 0.75);
  ok("_num: 'inf' row dropped (non-finite rejected)", !("INFROW" in byDesc));
  ok("_num: 'nan' row dropped (non-finite rejected)", !("NANROW" in byDesc));
})();

// ── _acctFromName: mixed-case filename → label matches Python str.title() (lowercase the rest) ──
(function () {
  const r = M.parseCsv("Date,Description,Amount\n01/15/2026,COFFEE,-5\n", "myCard.csv", {});
  ok("_acctFromName: 'myCard.csv' → 'Mycard' (not 'MyCard')", r.txns[0].account === "Mycard");
})();

// ── parseDate %y pivot: 2-digit years follow C89/Python strptime (69-99→19xx, 00-68→20xx) ──
(function () {
  const y99 = M.parseCsv("Date,Description,Amount\n01/15/99,X,-1\n", "s.csv", {}).txns[0];
  const y68 = M.parseCsv("Date,Description,Amount\n01/15/68,Y,-1\n", "s.csv", {}).txns[0];
  ok("parseDate: '99' → 1999", new Date(y99.posted * 1000).getFullYear() === 1999);
  ok("parseDate: '68' → 2068", new Date(y68.posted * 1000).getFullYear() === 2068);
})();

// ── importTxns mintSuffix:false — the vault-fold path never re-suffixes an already-final id ──
(function () {
  const now = Math.floor(Date.parse("2026-01-20") / 1000);
  const t = { id: "csv:abc", posted: now - 86400, amount: -5, description: "COFFEE", account: "C" };
  const first = M.importTxns({}, [t, Object.assign({}, t)], { now: now });   // genuine same-day dup
  const keys = Object.keys(M.parseJsonl(first.files["ledger.jsonl"])).sort();
  ok("importTxns: same-day dup gets a '-2' suffix (fresh CSV)", keys.length === 2 && keys.some((k) => k.endsWith("-2")));
  const pending = keys.map((k) => M.parseJsonl(first.files["ledger.jsonl"])[k]);
  const folded = M.importTxns({}, pending, { now: now, mintSuffix: false });
  const fk = Object.keys(M.parseJsonl(folded.files["ledger.jsonl"])).sort();
  ok("importTxns mintSuffix:false — final ids preserved (no 'csv:abc-2-2')", JSON.stringify(fk) === JSON.stringify(keys) && !fk.some((k) => /-2-2$/.test(k)));
  const again = M.importTxns(folded.files, pending, { now: now, mintSuffix: false });
  ok("importTxns mintSuffix:false — re-fold is idempotent (no growth)", Object.keys(M.parseJsonl(again.files["ledger.jsonl"])).length === 2);
})();

// ── periodSummary 'days' uses banker's rounding (pyRound), matching store.py round() ──
(function () {
  const now = 1000000 * 86400 + 12345;
  const earliest = now - Math.floor(14.5 * 86400);   // an exact 14.5-day 'all' span
  const s = M.periodSummary([
    { id: "a", posted: earliest, amount: -10, description: "OLD", account: "C" },
    { id: "b", posted: now - 86400, amount: -20, description: "NEW", account: "C" },
  ], { kind: "all", now: now }, {});
  ok("periodSummary: 14.5-day span → days=14 (banker's round, not Math.round's 15)", s.spending.window_days === 14);
})();

// ── resolvePeriod custom range: string YYYY-MM-DD bounds (what webcache passes) work ──
(function () {
  const p = M.resolvePeriod("custom", null, Math.floor(Date.parse("2026-06-01") / 1000), "2026-01-01", "2026-01-31");
  ok("resolvePeriod: custom string bounds produce a Jan window (not the current month)",
     p.label.indexOf("Jan") !== -1 && (p.end - p.start) > 29 * 86400);
})();

// ── SimpleFIN, in the browser (sfDecodeToken / sfAccountsRequest / extractErrors / sfApply) ──
// The credential-safety guarantees are the ballgame here: a bank secret must never reach a URL,
// and a partial/failed pull must never zero good data.
const b64 = (s) => Buffer.from(s, "binary").toString("base64");

// setup-token decode
ok("sfDecodeToken: valid beta-host token decodes to its claim URL",
   M.sfDecodeToken(b64("https://beta-bridge.simplefin.org/simplefin/claim/abc")) === "https://beta-bridge.simplefin.org/simplefin/claim/abc");
ok("sfDecodeToken: surrounding whitespace/newlines are stripped",
   M.sfDecodeToken("  " + b64("https://beta-bridge.simplefin.org/x") + "\n ") === "https://beta-bridge.simplefin.org/x");
ok("sfDecodeToken: the LEGACY host is rewritten to beta (it 302s dropping the path, no CORS)",
   M.sfDecodeToken(b64("https://bridge.simplefin.org/simplefin/claim/xyz")) === "https://beta-bridge.simplefin.org/simplefin/claim/xyz");
ok("sfDecodeToken: non-base64 junk → a clean thrown error, never a crash",
   (() => { try { M.sfDecodeToken("!!!! not base64 !!!!"); return false; } catch (e) { return /valid setup token/i.test(e.message); } })());
ok("sfDecodeToken: a non-https link is refused",
   (() => { try { M.sfDecodeToken(b64("http://beta-bridge.simplefin.org/x")); return false; } catch (e) { return /secure|https/i.test(e.message); } })());
ok("sfDecodeToken: a link to ANY other host is refused (SSRF guard)",
   (() => { try { M.sfDecodeToken(b64("https://evil.example.com/steal")); return false; } catch (e) { return /recognize|SimpleFIN/i.test(e.message); } })());
ok("sfDecodeToken: empty token → refused",
   (() => { try { M.sfDecodeToken("   "); return false; } catch (e) { return /paste/i.test(e.message); } })());

// Access URL → the /accounts request (the credential MUST leave the URL)
(function () {
  const req = M.sfAccountsRequest("https://usr%40n:p%40ss@beta-bridge.simplefin.org/simplefin", 1000000);
  ok("sfAccountsRequest: the rebuilt URL contains NO '@' and NO credentials", req.url.indexOf("@") === -1 && req.url.indexOf("p%40ss") === -1);
  ok("sfAccountsRequest: it targets /accounts with the start-date", req.url === "https://beta-bridge.simplefin.org/simplefin/accounts?start-date=1000000");
  ok("sfAccountsRequest: credentials go in a Basic auth header (percent-encoding preserved for parity)",
     req.auth === "Basic " + b64("usr%40n:p%40ss"));
  const withPort = M.sfAccountsRequest("https://u:p@beta-bridge.simplefin.org:8443/sf", null);
  ok("sfAccountsRequest: a self-hosted port survives", withPort.url === "https://beta-bridge.simplefin.org:8443/sf/accounts");
})();

// extract_errors (mirrors store.extract_errors — tested value-for-value in webmoney_parity.py too)
ok("extractErrors: v2 errlist msg + code, control chars sanitized, order-preserving dedupe",
   eq(M.extractErrors({ errlist: [{ msg: "bad\nlogin" }, { code: "E1" }], errors: ["old", "bad login"] }),
      ["bad login", "E1", "old"]));
ok("extractErrors: a 200 with no errors → empty list", eq(M.extractErrors({ accounts: [] }), []));
ok("extractErrors: a >200-char message is capped", M.extractErrors({ errlist: [{ msg: "x".repeat(500) }] })[0].length === 200);

// sfApply — the compute + the zero-wipe guard (the data-loss backstop)
(function () {
  const now = 1721000000;
  const files = { "ledger.jsonl": "", "balances.json": "{}", "categories.json": "{}", "income.json": "{}" };
  const data = { accounts: [
    { id: "a1", name: "Checking", org: { name: "Placeholder Bank" }, balance: "1000.00", currency: "USD",
      transactions: [{ id: "t1", posted: now - 86400, amount: "-10.00", description: "COFFEE" }] },
    { id: "a2", name: "Savings", org: { name: "Placeholder Bank" }, balance: "500.00", currency: "USD", transactions: [] } ] };
  const r = M.sfApply(files, data, { now });
  const bal = JSON.parse(r.files["balances.json"]);
  ok("sfApply: real bank balances land (total/cash from the snapshot, not the ledger)", bal.total === 1500 && bal.cash === 1500 && bal.accounts.length === 2);
  ok("sfApply: `updated` is set — a real bank pull is the one browser event that moves it", !!bal.updated);
  ok("sfApply: one txn added", r.added === 1);
  const r2 = M.sfApply(r.files, data, { now });   // re-pull identical data
  ok("sfApply: re-pulling the SAME data adds nothing (id-keyed dedupe, not content-order)", r2.added === 0);
  // v2 connection org resolution flows through
  const v2 = M.sfApply(files, { accounts: [{ id: "a3", conn_id: "c9", balance: "1.00", transactions: [] }], connections: [{ conn_id: "c9", org_name: "V2 Bank" }] }, { now });
  ok("sfApply: v2 Connection org name resolves (was v1-only before)", JSON.parse(v2.files["balances.json"]).accounts[0].org === "V2 Bank");
  // the zero-wipe guard: errors + zero accounts must THROW and write nothing
  let threw = false, msg = "";
  try { M.sfApply(files, { accounts: [], errlist: [{ msg: "login expired" }] }, { now }); } catch (e) { threw = true; msg = e.message; }
  ok("sfApply: errors + NO accounts → throws (never overwrites good data with zeros)", threw && /couldn't get your data/i.test(msg));
  // an EMPTY-but-error-free 200 must ALSO refuse to write (it would silently zero balances)
  let threw2 = false, msg2 = "";
  try { M.sfApply(files, { accounts: [] }, { now }); } catch (e) { threw2 = true; msg2 = e.message; }
  ok("sfApply: no accounts + NO errors → also throws (empty-200 zero-wipe blocked)", threw2 && /no accounts/i.test(msg2));
  // but errors ALONGSIDE real accounts is a partial success — it writes and reports
  const partial = M.sfApply(files, { accounts: data.accounts, errlist: [{ msg: "one account is slow" }] }, { now });
  ok("sfApply: errors WITH accounts → writes the good data and surfaces the message", partial.added === 1 && partial.errors.length === 1);
})();

// ── categorizer views (web categorize/income — mirror store.top_merchants /
//    other_merchants / deposit_sources; drives the web tagger UIs) ───────────
(function () {
  const now = 1700000000;
  const txns = [
    { id: "m1", posted: now - 86400, amount: -20, description: "Blue Grocer 123" },
    { id: "m2", posted: now - 2 * 86400, amount: -30, description: "Blue Grocer 456" },   // same cleaned merchant
    { id: "m3", posted: now - 3 * 86400, amount: -5, description: "Mystery Vendor Z" },   // lands in "other"
    { id: "d1", posted: now - 86400, amount: 900, description: "Payroll Co Direct Dep" },
    { id: "d2", posted: now - 2 * 86400, amount: 50, description: "Aunt Jane Zelle Payment" },
  ];
  const ov = { "blue grocer": "groceries" };
  const tm = M.topMerchants(txns, ov, {});
  ok("topMerchants: same cleaned merchant aggregates (2 txns → 1 row of 50)",
    tm.length >= 1 && tm[0].amount === 50 && tm[0].count === 2);
  ok("topMerchants: carries the CURRENT category from overrides", tm[0].category === "groceries");
  ok("topMerchants: biggest first", tm.every((r, i) => i === 0 || tm[i - 1].amount >= r.amount));
  ok("topMerchants: first/last posted tracked", tm[0].first < tm[0].last);
  const om = M.otherMerchants(txns, ov, {});
  ok("otherMerchants: only 'other' spends (mystery vendor, not the categorized grocer)",
    om.length === 1 && om[0].amount === 5 && /mystery/i.test(om[0].merchant));
  const ds = M.depositSources(txns, {}, ov, {});
  ok("depositSources: every incoming source listed", ds.length === 2);
  ok("depositSources: payroll auto-reads as income, untagged", ds[0].status === "income" && ds[0].tagged === false);
  const ds2 = M.depositSources(txns, { [ds[1].key]: "ignore" }, ov, {});
  const tagged = ds2.find((r) => r.key === ds[1].key);
  ok("depositSources: a user tag pins status + reads tagged", tagged && tagged.status === "ignore" && tagged.tagged === true);
})();

console.log("\n" + p + " passed, " + f + " failed");
process.exit(f ? 1 : 0);
