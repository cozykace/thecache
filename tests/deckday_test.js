// The deck's per-device viewed day — deckViewDay / setDeckViewDay. money.deckDay is
// DEVICE_LOCAL (siloed per device, never synced). Loaded by ANCHOR from app.js. Pins:
// default-to-today when unset, restore the EXACT last day, validation on read + write, and
// that a change fires cache:deckday (the signal the deck body + task/habit renderer listen for).
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re); return i; };

// stubs the helpers touch
function makeLS() { const s = {}; return { _s: s, getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; }
let localStorage = makeLS();
let dispatched = [];
const document = { dispatchEvent(e) { dispatched.push(e); } };
function CustomEvent(type, opts) { return { type: type, detail: opts && opts.detail }; }
function todayKey() { return "2026-07-15"; }   // fixed so the test is deterministic

eval(src.slice(at(/^const DECKDAY_KEY/), at(/^function renderDeckDayWheel/)).join("\n"));

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const TODAY = todayKey();

ok("default = today when unset", deckViewDay() === TODAY);
setDeckViewDay("2026-07-10");
ok("persists + restores the EXACT last day", deckViewDay() === "2026-07-10");
ok("a change fires cache:deckday with the ymd", dispatched.some((e) => e.type === "cache:deckday" && e.detail && e.detail.ymd === "2026-07-10"));
setDeckViewDay("not-a-date");
ok("invalid write falls back to today", deckViewDay() === TODAY);
setDeckViewDay("");
ok("empty write falls back to today", deckViewDay() === TODAY);
localStorage.setItem("money.deckDay", "xyz");   // corrupt value in storage
ok("garbage in storage reads as today (validated on read)", deckViewDay() === TODAY);
localStorage.setItem("money.deckDay", "2026-02-30");   // syntactically valid YYYY-MM-DD (leniently accepted)
ok("a well-formed ymd is restored verbatim", deckViewDay() === "2026-02-30");

console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
