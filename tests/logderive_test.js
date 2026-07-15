// Thing EVENTS → the check-in log (§4): the completion writer + the derive helpers.
// Loads the REAL functions out of app.js by ANCHOR. What these pin down:
//   · monotonic `at` per itemId — two toggles of one item in one ms both survive
//   · "done today" is DERIVED latest-wins (done → undone → done reads as done)
//   · an amount habit's day value is the LATEST reading, never a sum (no double-count)
//   · the activity trail is a flat root== filter that survives interior deletion
//   · `root` is denormalized correctly by walking parent → routine
//   · field values are editable (latest per day) and deletable (fielddel tombstone)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re); return i; };
const code = src.slice(at(/^\/\/ ── Thing EVENTS → the check-in log/), at(/^function loadLog/)).join("\n");

// in-memory stubs for the log storage the writer touches
let LOG = [], THINGS = [];
function loadLog(){ return LOG; }
function saveLog(l){ LOG = l; return true; }
function loadThings(){ return THINGS; }
function todayKey(){ return "2026-07-14"; }
function ckPush(){}
const document = { dispatchEvent(){} };
eval(code);

let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};

// ── 1. monotonic `at` per itemId ──
{
  LOG = [];
  THINGS = [{id:"t1",type:"task"}];
  const a = logThingEvent("t1","done");
  const b = logThingEvent("t1","undone");   // same ms very likely → must bump
  const c = logThingEvent("t1","done");
  ok("monotonic at: strictly increasing per item", b.at > a.at && c.at > b.at);
  ok("all three toggles survive in the log (audit trail)", LOG.filter(e=>e.itemId==="t1").length === 3);
}

// ── 2. derived done-today is LATEST-WINS ──
{
  ok("done → undone → done reads as DONE (latest wins)", thingDoneOn(LOG,"t1","2026-07-14") === true);
  // now flip it off last
  logThingEvent("t1","undone");
  ok("...and a final undone reads as NOT done", thingDoneOn(LOG,"t1","2026-07-14") === false);
  ok("a day with no entry is not done", thingDoneOn(LOG,"t1","2026-07-13") === false);
}

// ── 3. amount habit: day value is the LATEST reading, not a SUM ──
{
  LOG = [];
  THINGS = [{id:"h1",type:"habit",track:"amount"}];
  logThingEvent("h1","habit",{value:{done:1,qty:20}});
  logThingEvent("h1","habit",{value:{done:1,qty:30}});   // corrected the reading
  const v = thingAmountOn(LOG,"h1","2026-07-14");
  ok("amount habit: latest reading wins (30, not summed 50)", v && v.qty === 30);
}

// ── 4. root denormalization: walk parent → routine to the top ──
{
  const items = [
    {id:"task",type:"task"},
    {id:"s1",type:"subtask",parent:"task"},
    {id:"s1a",type:"subtask",parent:"s1"},
    {id:"rt",type:"routine"},
    {id:"m1",type:"habit",routine:"rt"},
  ];
  ok("root of a deep subtask is the top-level task", thingRoot(items,"s1a") === "task");
  ok("root of a routine member is the routine", thingRoot(items,"m1") === "rt");
  ok("root of a top-level item is itself", thingRoot(items,"task") === "task");
  ok("root of a dangling ref is the deepest resolvable id", thingRoot([{id:"x",parent:"ghost"}],"x") === "x");
}

// ── 5. activity trail survives an interior subtask being deleted (flat root== filter) ──
{
  LOG = [];
  THINGS = [{id:"task",type:"task"},{id:"s1",type:"subtask",parent:"task"}];
  logThingEvent("task","done");
  logThingEvent("s1","done");
  // now the subtask is gone from THINGS entirely (deleted + GC'd), but its logged event stays
  THINGS = [{id:"task",type:"task"}];
  const trail = thingTrail(LOG,"task");
  ok("trail includes the deleted subtask's event (root denormalized at write)", trail.length === 2);
  ok("trail is time-ordered", trail[0].at <= trail[1].at);
}

// ── 6. field values: editable (latest per day) + deletable (fielddel) ──
{
  LOG = [];
  THINGS = [{id:"fld",type:"field"}];
  logThingEvent("fld","fieldval",{field:"fld",value:150,ts:"2026-07-12"});
  logThingEvent("fld","fieldval",{field:"fld",value:170,ts:"2026-07-13"});
  logThingEvent("fld","fieldval",{field:"fld",value:999,ts:"2026-07-13"});   // corrected same day
  let vals = fieldValues(LOG,"fld");
  ok("field values: one per day, latest wins (170→999)", vals.length === 2 && vals[1].value === 999);
  ok("field values: oldest → newest", vals[0].ts < vals[1].ts);
  logThingEvent("fld","fielddel",{field:"fld",ts:"2026-07-13"});   // delete that day's reading
  vals = fieldValues(LOG,"fld");
  ok("field values: a fielddel removes that day", vals.length === 1 && vals[0].ts === "2026-07-12");
}

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
