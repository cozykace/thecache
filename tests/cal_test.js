// Calendar data layer (Brick 1) — calWeekdayLabels / calMonthGrid / calThingsOnDay. Loaded
// from app.js by ANCHOR (never line numbers). The DOM render (openCalendar) is eyeballed in
// the real app; this pins the pure join + grid math the whole surface hangs off. Fixtures are
// placeholders only — never real data.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re); return i; };
// engine (ymdOf / _ymd2date / routineDueOn / occurrence expansion) …
eval(src.slice(at(/^function _ymd2date/), at(/^function loadLog/)).join("\n"));
// … then the calendar helpers that hang off it.
eval(src.slice(at(/^function calWeekdayLabels/), at(/^function openCalendar/)).join("\n"));

let p = 0, f = 0; const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };

// ── weekday labels ──
ok("weekStart Sun = Sun..Sat", calWeekdayLabels(0).join(",") === "Sun,Mon,Tue,Wed,Thu,Fri,Sat");
ok("weekStart Mon = Mon..Sun", calWeekdayLabels(1).join(",") === "Mon,Tue,Wed,Thu,Fri,Sat,Sun");

// ── month grid ──
const grid = calMonthGrid("2026-07-15", 0);
ok("grid: 42 cells", grid.length === 42);
ok("grid: first cell is the weekStart weekday", _ymd2date(grid[0].ymd).getDay() === 0);
ok("grid: inMonth count = days in July (31)", grid.filter((c) => c.inMonth).length === 31);
ok("grid: the anchor day is in-month", grid.some((c) => c.ymd === "2026-07-15" && c.inMonth));
ok("grid: leading days are other-month", grid[0].inMonth === false && grid[0].ymd < "2026-07-01");
ok("grid: last cell = first + 41 days", (function () { const d0 = _ymd2date(grid[0].ymd); const dl = _ymd2date(grid[41].ymd); return Math.round((dl - d0) / 86400000) === 41; })());
// weekStart Monday shifts the alignment.
ok("grid: Monday start → first cell is Monday", _ymd2date(calMonthGrid("2026-07-15", 1)[0].ymd).getDay() === 1);
// February in a common year still yields 42 cells with 28 in-month days.
ok("grid: Feb 2026 = 28 in-month", calMonthGrid("2026-02-10", 0).filter((c) => c.inMonth).length === 28);

// ── the day join ──
const THINGS = [
  { id: "r1", type: "routine", name: "Morning", sched: { freq: "daily", every: 1 } },
  { id: "r2", type: "routine", name: "Laundry", sched: { freq: "weekly", days: [0] } },     // Sundays
  { id: "r3", type: "routine", name: "Rent", sched: { freq: "monthly", monthly: [1] } },     // the 1st
  { id: "m1", type: "task", title: "Fold shirts", routine: "r1" },                           // a routine MEMBER — never a standalone item
  { id: "t1", type: "task", title: "Dentist", due: "2026-07-15" },
  { id: "t2", type: "task", title: "Old thing", due: "2026-07-15", deleted: 1 },             // tombstoned → excluded
  { id: "e1", type: "event", title: "Call", start: "2026-07-15", end: null, allDay: 0, startTime: "14:00" },
  { id: "e2", type: "event", title: "Trip", start: "2026-07-24", end: "2026-07-26", allDay: 1 },
  { id: "e3", type: "event", title: "Standup", sched: { freq: "weekly", days: [1] } },       // recurring event, Mondays
];
const day = (ymd) => calThingsOnDay(THINGS, ymd);

// 2026-07-15 is a Wednesday.
const wed = day("2026-07-15");
ok("join: dated task lands on its due day", wed.tasks.length === 1 && wed.tasks[0].id === "t1");
ok("join: tombstoned task excluded", wed.tasks.every((t) => t.id !== "t2"));
ok("join: single-day event on its day", wed.events.some((e) => e.id === "e1"));
ok("join: daily routine is due", wed.routines.some((r) => r.id === "r1"));
ok("join: routine MEMBER is not a standalone task", wed.tasks.every((t) => t.id !== "m1") && wed.events.every((e) => e.id !== "m1"));

// a Sunday → weekly Laundry due; a Wednesday → not.
const sun = "2026-07-19", sunDow = _ymd2date(sun).getDay();
ok("fixture sanity: 2026-07-19 is Sunday", sunDow === 0);
ok("join: weekly-Sunday routine due on Sunday", day(sun).routines.some((r) => r.id === "r2"));
ok("join: weekly-Sunday routine NOT due Wednesday", !wed.routines.some((r) => r.id === "r2"));

// monthly rent on the 1st only.
ok("join: monthly routine due on the 1st", day("2026-07-01").routines.some((r) => r.id === "r3"));
ok("join: monthly routine not due on the 2nd", !day("2026-07-02").routines.some((r) => r.id === "r3"));

// multi-day event spans every covered day, inclusive; excludes the day after.
ok("join: multi-day event covers start", day("2026-07-24").events.some((e) => e.id === "e2"));
ok("join: multi-day event covers middle", day("2026-07-25").events.some((e) => e.id === "e2"));
ok("join: multi-day event covers end", day("2026-07-26").events.some((e) => e.id === "e2"));
ok("join: multi-day event excludes day after", !day("2026-07-27").events.some((e) => e.id === "e2"));

// recurring event via sched (Mondays). 2026-07-20 is a Monday.
ok("fixture sanity: 2026-07-20 is Monday", _ymd2date("2026-07-20").getDay() === 1);
ok("join: recurring event due on its weekday", day("2026-07-20").events.some((e) => e.id === "e3"));
ok("join: recurring event not due off its weekday", !wed.events.some((e) => e.id === "e3"));

// ── week days (Brick 4) ──
const wkd = calWeekDays("2026-07-15", 0);
ok("weekDays: 7 aligned days", wkd.length === 7 && _ymd2date(wkd[0]).getDay() === 0);
ok("weekDays: contains the anchor day", wkd.indexOf("2026-07-15") !== -1);
ok("weekDays: contiguous", (function () { const a = _ymd2date(wkd[0]), b = _ymd2date(wkd[6]); return Math.round((b - a) / 86400000) === 6; })());
ok("weekDays: Monday start aligns to Monday", _ymd2date(calWeekDays("2026-07-15", 1)[0]).getDay() === 1);

// a recurring event with an Until date (sched.end) stops after it — inclusive on the last day.
const e4 = [{ id: "e4", type: "event", title: "Standup", sched: { freq: "weekly", days: [1], end: "2026-07-20" } }];
ok("join: recurring event honors Until (on the last day)", calThingsOnDay(e4, "2026-07-20").events.some((e) => e.id === "e4"));
ok("join: recurring event honors Until (gone after)", !calThingsOnDay(e4, "2026-07-27").events.some((e) => e.id === "e4"));

// ── HABITS v2: a habit with an EXPLICIT sched spreads via the same engine; a plain daily
//    habit stays OFF the calendar (it lives in the deck — else every habit paints every day);
//    a routine-member habit is carried by its routine, never doubled. ──
const HAB = [
  { id: "h1", type: "habit", title: "Gym", track: "check", sched: { freq: "weekly", days: [1, 3] } },   // Mon + Wed
  { id: "h2", type: "habit", title: "Journal", track: "note" },                                         // no sched → deck-only
  { id: "h3", type: "habit", title: "Stretch", track: "check", sched: { freq: "daily" }, routine: "r1" }, // member → routine carries it
  { id: "r1", type: "routine", name: "Morning", sched: { freq: "daily" } },
];
ok("join: scheduled habit lands on its weekday (Wed)", calThingsOnDay(HAB, "2026-07-15").habits.some((h) => h.id === "h1"));
ok("join: scheduled habit absent off its weekday (Sun)", !calThingsOnDay(HAB, "2026-07-19").habits.some((h) => h.id === "h1"));
ok("join: an UNscheduled (daily) habit stays off the calendar", !calThingsOnDay(HAB, "2026-07-15").habits.some((h) => h.id === "h2"));
ok("join: a routine-member habit is never doubled", !calThingsOnDay(HAB, "2026-07-15").habits.some((h) => h.id === "h3"));
ok("join: a paused habit sched is silent", !calThingsOnDay([{ id: "h4", type: "habit", title: "X", sched: { freq: "daily", paused: 1 } }], "2026-07-15").habits.length);
ok("join: a tombstoned habit is excluded", !calThingsOnDay([{ id: "h5", type: "habit", title: "X", sched: { freq: "daily" }, deleted: 1 }], "2026-07-15").habits.length);
ok("join: habits bucket always present (renderers iterate it)", Array.isArray(calThingsOnDay([], "2026-07-15").habits));

// ── the $ layer's INCOME projection (calIncomeOccursOn) — a payday rhythm stepped forward
//    from its LAST real deposit by its median gap in DAYS. Gap-based on purpose: a biweekly
//    paycheck doesn't land on a calendar-month rule. The week view's green +$ badge is a sum
//    of these, so an off-by-one here paints money on the wrong day.
const LAST = Math.floor(Date.parse("2026-07-01T12:00:00") / 1000);   // local noon — TZ/DST-safe anchor
ok("income: biweekly lands one gap out", calIncomeOccursOn(LAST, 14, "2026-07-15"));
ok("income: biweekly lands two gaps out", calIncomeOccursOn(LAST, 14, "2026-07-29"));
ok("income: biweekly is silent mid-cycle", !calIncomeOccursOn(LAST, 14, "2026-07-08"));
ok("income: never on the last real deposit's own day", !calIncomeOccursOn(LAST, 14, "2026-07-01"));
ok("income: never before it (history is already banked)", !calIncomeOccursOn(LAST, 14, "2026-06-17"));
ok("income: a 30-day rhythm steps 30 days, not a calendar month", calIncomeOccursOn(LAST, 30, "2026-07-31") && !calIncomeOccursOn(LAST, 30, "2026-08-01"));
ok("income: a weekly rhythm crosses a DST boundary cleanly", calIncomeOccursOn(Math.floor(Date.parse("2026-10-25T12:00:00") / 1000), 7, "2026-11-08"));
ok("income: inside the 370-day horizon", calIncomeOccursOn(LAST, 14, "2027-06-30"));      // 364d = 26 gaps
ok("income: past the horizon promises nothing", !calIncomeOccursOn(LAST, 14, "2027-07-14"));  // 378d — a real multiple, still too far
// an older sealed vault bundle has no gap_days — the layer stays quiet instead of guessing
ok("income: a missing gap projects nothing", !calIncomeOccursOn(LAST, undefined, "2026-07-15"));
ok("income: a zero gap projects nothing (never divides by 0)", !calIncomeOccursOn(LAST, 0, "2026-07-15"));
ok("income: junk gap projects nothing", !calIncomeOccursOn(LAST, "abc", "2026-07-15"));
ok("income: a missing last projects nothing", !calIncomeOccursOn(0, 14, "2026-07-15"));
ok("income: a junk ymd projects nothing", !calIncomeOccursOn(LAST, 14, "nope"));

console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
