// Routine recurrence engine — routineDueOn(sched, ymd). Pure date logic, loaded from app.js
// by anchor. Covers daily (every N), weekly (days-of-week), monthly (day-of-month + nth-
// weekday), yearly, start/end bounds, and pause. This is the core of the routines engine —
// everything else (which members show today) hangs off "is this routine due today".
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re); return i; };
eval(src.slice(at(/^function _ymd2date/), at(/^function loadLog/)).join("\n"));

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };
const DAY = "2026-07-15";
const dow = new Date(2026, 6, 15).getDay();   // whatever weekday 2026-07-15 is — computed, not assumed

// ── daily ──
ok("daily: due every day", routineDueOn({ freq: "daily" }, DAY));
ok("daily every 2 from a +2 start: due", routineDueOn({ freq: "daily", every: 2, start: "2026-07-13" }, DAY));
ok("daily every 2: OFF on the +1 day", !routineDueOn({ freq: "daily", every: 2, start: "2026-07-13" }, "2026-07-14"));

// ── weekly ──
ok("weekly on this weekday: due", routineDueOn({ freq: "weekly", days: [dow] }, DAY));
ok("weekly on a DIFFERENT weekday: not due", !routineDueOn({ freq: "weekly", days: [(dow + 1) % 7] }, DAY));
ok("weekly multi-day incl. today: due", routineDueOn({ freq: "weekly", days: [dow, (dow + 2) % 7] }, DAY));

// ── monthly ──
ok("monthly on the 15th: due", routineDueOn({ freq: "monthly", monthly: [15] }, DAY));
ok("monthly on the 1st: not due on the 15th", !routineDueOn({ freq: "monthly", monthly: [1] }, DAY));
ok("monthly nth-weekday (the actual nth): due", routineDueOn({ freq: "monthly", monthly: { nth: Math.floor((15 - 1) / 7) + 1, weekday: dow } }, DAY));

// ── yearly ──
ok("yearly Jul 15: due", routineDueOn({ freq: "yearly", yearly: { month: 7, day: 15 } }, DAY));
ok("yearly Jul 16: not due on the 15th", !routineDueOn({ freq: "yearly", yearly: { month: 7, day: 16 } }, DAY));

// ── bounds + pause + null ──
ok("paused: never due", !routineDueOn({ freq: "daily", paused: 1 }, DAY));
ok("before start: not due", !routineDueOn({ freq: "daily", start: "2026-07-20" }, DAY));
ok("after end: not due", !routineDueOn({ freq: "daily", end: "2026-07-10" }, DAY));
ok("no schedule at all: always available", routineDueOn(null, DAY));

console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
