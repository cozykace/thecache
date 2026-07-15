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

// ── Brick 0: calendar occurrence expansion (ymdOf / calDaysInRange / calOccurrencesInRange) ──
// ymdOf round-trips a local Date to YYYY-MM-DD (zero-padded).
ok("ymdOf pads month/day", ymdOf(new Date(2026, 0, 5)) === "2026-01-05");
ok("ymdOf mid-year", ymdOf(new Date(2026, 6, 15)) === "2026-07-15");

// calDaysInRange — contiguous local days, inclusive, capped.
const wk = calDaysInRange("2026-07-13", "2026-07-19");
ok("range: 7 inclusive days", wk.length === 7 && wk[0] === "2026-07-13" && wk[6] === "2026-07-19");
ok("range: single day", calDaysInRange("2026-07-15", "2026-07-15").length === 1);
ok("range: reversed → empty", calDaysInRange("2026-07-19", "2026-07-13").length === 0);
ok("range: cap respected", calDaysInRange("2026-01-01", "2026-12-31", 10).length === 10);
// DST must NOT drop a day — we advance by calendar date, not by 86.4M ms (US spring-forward 2026-03-08).
ok("range: DST month = 31 days", calDaysInRange("2026-03-01", "2026-03-31").length === 31);
ok("range: crosses year boundary", (function () { const r = calDaysInRange("2026-12-30", "2027-01-02"); return r.length === 4 && r[3] === "2027-01-02"; })());

// calOccurrencesInRange — drive routineDueOn across the window.
ok("occ: daily = every day", calOccurrencesInRange({ freq: "daily" }, "2026-07-13", "2026-07-19").length === 7);
ok("occ: daily every 2 from start (13,15,17,19)", calOccurrencesInRange({ freq: "daily", every: 2, start: "2026-07-13" }, "2026-07-13", "2026-07-19").length === 4);
// weekly on a computed weekday: every occurrence really is that weekday, and there are 4-5 in a month.
const monOcc = calOccurrencesInRange({ freq: "weekly", days: [1] }, "2026-07-01", "2026-07-31");
ok("occ: weekly Monday = all Mondays", monOcc.length >= 4 && monOcc.every((d) => _ymd2date(d).getDay() === 1));
// monthly by day-of-month across 3 months → one per month, each the 15th.
const m15 = calOccurrencesInRange({ freq: "monthly", monthly: [15] }, "2026-01-01", "2026-03-31");
ok("occ: monthly 15th = 3 (Jan-Mar)", m15.length === 3 && m15.every((d) => _ymd2date(d).getDate() === 15));
// short month: the 31st simply never fires in February (no clamp).
ok("occ: monthly 31 skips Feb", calOccurrencesInRange({ freq: "monthly", monthly: [31] }, "2026-02-01", "2026-02-28").length === 0);
// nth-weekday and LAST-weekday, one per month over a 3-month span.
ok("occ: 2nd Tuesday = 3", calOccurrencesInRange({ freq: "monthly", monthly: { nth: 2, weekday: 2 } }, "2026-01-01", "2026-03-31").length === 3);
const lastFri = calOccurrencesInRange({ freq: "monthly", monthly: { nth: -1, weekday: 5 } }, "2026-01-01", "2026-03-31");
ok("occ: last Friday = 3, all Fridays", lastFri.length === 3 && lastFri.every((d) => _ymd2date(d).getDay() === 5));
// yearly across a 2-year span — needs an explicit cap; the default 400 would truncate 730 days.
ok("occ: yearly Jul 15 across 2 years = 2", calOccurrencesInRange({ freq: "yearly", yearly: { month: 7, day: 15 } }, "2025-01-01", "2026-12-31", 800).length === 2);
// the default cap DOES truncate a multi-year range — intentional guard against a runaway window.
ok("occ: default cap truncates 2-year range", calOccurrencesInRange({ freq: "yearly", yearly: { month: 7, day: 15 } }, "2025-01-01", "2026-12-31").length === 1);
// start/end clip to the schedule's own bounds even inside a wider window.
ok("occ: end clips the window", calOccurrencesInRange({ freq: "daily", end: "2026-07-15" }, "2026-07-13", "2026-07-19").length === 3);
ok("occ: paused = none", calOccurrencesInRange({ freq: "daily", paused: 1 }, "2026-07-13", "2026-07-19").length === 0);
// a null sched (a plain always-available routine) is due every day in the window.
ok("occ: null sched = every day", calOccurrencesInRange(null, "2026-07-13", "2026-07-19").length === 7);

console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
