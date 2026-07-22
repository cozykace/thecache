// money.things — the per-item merge engine for routines / tasks / subtasks / habits /
// fields (the deck, fully realized). Loads the REAL functions out of app.js AND
// webcache.js by ANCHOR so it can't rot on line drift. Fixtures are placeholders only.
//
// What these assertions pin down (each was a real trap in the deck's design history):
//   · concurrent edits to DIFFERENT children both survive (no whole-document clobber)
//   · a stale editor keystroke does NOT revert a remote edit or resurrect a remote delete
//   · cascade delete tombstones every descendant, and a peer can't resurrect them
//   · a dangling reference is HIDDEN at read time, never resurrected
//   · the ord tie-break is SYMMETRIC (both devices converge, no reorder ping-pong)
//   · live user-authored structure is NEVER capped
//   · webcache's wMergeThings is byte-identical to app.js's mergeThings
const fs = require("fs"), path = require("path");
const grab = (file, aRe, bRe) => {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
};
// stub the browser globals the app.js block touches
function makeLS(){const s={};return{_s:s,getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]},key:i=>Object.keys(s)[i]??null,get length(){return Object.keys(s).length}};}
let localStorage = makeLS();
const document = { dispatchEvent(){}, addEventListener(){} };
function devId(){ return "devA"; }
function autoPushSoon(){}
// app.js money.things block: [const THINGS_KEY … function loadLog)
eval(grab("app.js", /^const THINGS_KEY = "money\.things"/, /^function loadLog/));
// webcache.js parity: pull wThingCanon+wMergeThings, alias so we can call them here
const W = grab("webcache.js", /function wThingCanon/, /function wIsGeneric/);
eval(W);

let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};
const idsOf = (arr) => thingsLive(arr).map(x=>x.id).sort().join(",");
const visIds = (arr) => thingsVisible(arr).map(x=>x.id).sort().join(",");

// ── 1. id minting: stable format, 4-char dev fp, 6-char entropy, unique ──
{
  const a = thingId(), b = thingId();
  ok("thingId format t<time>-<dev4>-<rand6>", /^t[a-z0-9]+-.{4}-.{6}$/.test(a));
  ok("thingId embeds the 4-char device fingerprint", a.split("-")[1] === "devA");
  ok("thingId entropy slice is exactly 6 chars", a.split("-")[2].length === 6);
  ok("thingId is unique across calls", a !== b);
}

// ── 2. concurrent edits to DIFFERENT children both survive (the headline nesting bug) ──
{
  const base = [
    {id:"task",type:"task",title:"T",updated:100,ord:0,ordAt:0},
    {id:"s1",type:"subtask",parent:"task",title:"one",updated:100,ord:0,ordAt:0},
    {id:"s2",type:"subtask",parent:"task",title:"two",updated:100,ord:1,ordAt:0},
  ];
  const phone = JSON.parse(JSON.stringify(base)); phone[1].title="ONE-edited"; phone[1].updated=200;   // phone edits s1
  const desk  = JSON.parse(JSON.stringify(base)); desk[2].title="TWO-edited"; desk[2].updated=200;     // desktop edits s2
  const m = mergeThings(phone, desk);
  ok("concurrent child edits BOTH survive (s1)", m.find(x=>x.id==="s1").title === "ONE-edited");
  ok("concurrent child edits BOTH survive (s2)", m.find(x=>x.id==="s2").title === "TWO-edited");
}

// ── 3. stale editor keystroke does NOT revert a remote edit / resurrect a remote delete ──
{
  const A = [{id:"a",type:"task",title:"orig",updated:100,ord:0,ordAt:0},{id:"b",type:"task",title:"B",updated:100,ord:1,ordAt:0}];
  const stale = JSON.parse(JSON.stringify(A));
  const remote = [{id:"a",type:"task",title:"A-EDITED",updated:200,ord:0,ordAt:0},{id:"b",type:"task",title:"B",updated:100,ord:1,ordAt:0}];
  const stored = mergeThings(A, remote);
  stale[1].title = "B-typed"; stale[1].updated = 300;                 // user types in the OTHER item
  const saved = mergeThings(stored, stale);
  ok("stale keystroke does NOT revert a remote edit", saved.find(x=>x.id==="a").title === "A-EDITED");
  ok("...and the user's own edit is kept", saved.find(x=>x.id==="b").title === "B-typed");
}

// ── 4. adoption is VERBATIM — no stamp escalation ping-pong ──
{
  let A = [{id:"a",type:"task",title:"x",updated:100,ord:0,ordAt:0}], B = [];
  B = mergeThings(B, A); A = mergeThings(A, B); B = mergeThings(B, A);
  ok("adoption preserves `updated` verbatim", B.find(x=>x.id==="a").updated === 100);
  ok("converged Things are byte-identical either order", JSON.stringify(mergeThings(A,B)) === JSON.stringify(mergeThings(B,A)));
}

// ── 5. CASCADE DELETE — deleting a task tombstones every descendant; a peer can't resurrect ──
{
  const tree = [
    {id:"task",type:"task",title:"T",updated:100,ord:0,ordAt:0},
    {id:"s1",type:"subtask",parent:"task",title:"one",updated:100,ord:0,ordAt:0},
    {id:"s1a",type:"subtask",parent:"s1",title:"one-a",updated:100,ord:0,ordAt:0},   // infinite depth
    {id:"other",type:"task",title:"keep me",updated:100,ord:1,ordAt:0},
  ];
  const after = thingsCascadeDelete(tree, "task", 500);
  ok("cascade: container tombstoned", !!after.find(x=>x.id==="task").deleted);
  ok("cascade: nested descendant tombstoned (self-contained)", !!after.find(x=>x.id==="s1a").deleted);
  ok("cascade: an unrelated task is untouched", !after.find(x=>x.id==="other").deleted);
  ok("cascade: every tombstone carries the delete-time stamp", after.find(x=>x.id==="s1").updated === 500);
  // a peer still holding the whole subtree LIVE, at an older stamp, must not resurrect it
  const peer = JSON.parse(JSON.stringify(tree));
  const m = mergeThings(after, peer);
  ok("cascade: a peer's older live copy does NOT resurrect the subtree", visIds(m) === "other");
}

// ── 6. residual dangling ref is HIDDEN at read time, never resurrected ──
{
  // s-orphan references a parent this device never received (peer added it concurrent w/ delete)
  const items = [
    {id:"orphan",type:"subtask",parent:"ghost",title:"orphan",updated:100,ord:0,ordAt:0},
    {id:"live",type:"task",title:"live",updated:100,ord:1,ordAt:0},
  ];
  ok("dangling ref (absent parent) is hidden", visIds(items) === "live");
  ok("...but it is NOT mutated/resurrected in storage", items.find(x=>x.id==="orphan") && !items.find(x=>x.id==="orphan").deleted);
  // a child whose parent is a live-but-tombstoned container is hidden too
  const items2 = [
    {id:"dead",type:"task",title:"dead",updated:200,ord:0,ordAt:0,deleted:1},
    {id:"kid",type:"subtask",parent:"dead",title:"kid",updated:100,ord:0,ordAt:0},   // survived a partial delete
  ];
  ok("child of a tombstoned parent is hidden", visIds(items2) === "");
}

// ── 7. SYMMETRIC ord tie-break — two devices reorder the same item, converge on smaller ord ──
{
  const a = [{id:"x",type:"task",title:"x",updated:5,ord:3,ordAt:900}];
  const b = [{id:"x",type:"task",title:"x",updated:5,ord:1,ordAt:900}];   // same ordAt, smaller ord
  const ab = mergeThings(a,b), ba = mergeThings(b,a);
  ok("equal ordAt → smaller ord wins", ab.find(x=>x.id==="x").ord === 1);
  ok("...and it is order-independent (symmetric)", JSON.stringify(ab) === JSON.stringify(ba));
  // a genuinely newer position still wins over the smaller-ord rule
  const c = [{id:"x",type:"task",title:"x",updated:5,ord:9,ordAt:1000}];
  ok("newer ordAt beats the smaller-ord tie rule", mergeThings(b,c).find(x=>x.id==="x").ord === 9);
}

// ── 8. LIVE structure is never capped (durable records, not ephemeral cards) ──
{
  const many = [];
  for (let i=0;i<200;i++) many.push({id:"L"+i,type:"task",title:"t",updated:1,ord:i,ordAt:0});
  const m = mergeThings(many, []);
  ok("200 live Things all survive the merge (no live cap)", thingsLive(m).length === 200);
}

// ── 9. exact-tie → tombstone wins ──
{
  const m = mergeThings([{id:"x",type:"task",title:"live",updated:1,ord:0,ordAt:0}],
                        [{id:"x",type:"task",title:"live",updated:1,ord:0,ordAt:0,deleted:1}]);
  ok("exact tie: the tombstone wins", !!m.find(x=>x.id==="x").deleted);
}

// ── 10. boolean normalization: true/false and 1/0 canonicalize identically ──
{
  ok("thingCanon normalizes true→1 / false→0",
     thingCanon({id:"x",done:true,active:false}) === thingCanon({id:"x",done:1,active:0}));
}

// ── 11. PARITY: webcache wMergeThings === app.js mergeThings on shared fixtures ──
{
  const fixtures = [
    [ [{id:"a",updated:2,ord:0,ordAt:0,title:"A"}], [{id:"a",updated:1,ord:0,ordAt:0,title:"old"},{id:"b",updated:1,ord:1,ordAt:0}] ],
    [ [{id:"x",updated:5,ord:3,ordAt:900}], [{id:"x",updated:5,ord:1,ordAt:900}] ],
    [ [{id:"t",updated:1,ord:0,ordAt:0,deleted:1}], [{id:"t",updated:1,ord:0,ordAt:0}] ],
    [ [{id:"e",updated:1,ord:0,ordAt:0,emoji:"⚡"}], [{id:"e",updated:1,ord:0,ordAt:0,emoji:"🔥"}] ],
    [ [{id:"ev",updated:5,ord:0,ordAt:900,type:"event",start:"2026-07-15",startTime:"09:00"}], [{id:"ev",updated:5,ord:0,ordAt:900,type:"event",start:"2026-07-15",startTime:"10:00"}] ],
  ];
  let allEq = true;
  fixtures.forEach(([a,b]) => { if (JSON.stringify(mergeThings(a,b)) !== JSON.stringify(wMergeThings(a,b))) allEq = false; });
  ok("wMergeThings byte-identical to mergeThings (incl. emoji tie-break)", allEq);
}

// ── 12. UPGRADE a task → habit is an EDIT (same id), not delete+create; newer wins, no dup ──
{
  const task = {id:"u1",type:"task",title:"practice guitar",done:0,updated:100,ord:0,ordAt:0};
  const habit = Object.assign({}, task, {type:"habit",track:"check",updated:200});   // device A upgrades in place
  const m = mergeThings([task], [habit]);   // device B still holds the old task copy
  ok("upgrade: one item, not two (id is stable across the edit)", m.filter(x=>x.id==="u1").length === 1);
  ok("upgrade: the newer habit wins over the stale task copy", m.find(x=>x.id==="u1").type === "habit");
  ok("upgrade: never resurrects as a delete (still live)", !m.find(x=>x.id==="u1").deleted);
  // and a concurrent subtask edit on the OTHER device still survives the upgrade merge
  const sub = {id:"u1s",type:"subtask",parent:"u1",title:"scales",done:0,updated:300,ord:0,ordAt:0};
  const m2 = mergeThings([task, sub], [habit]);
  ok("upgrade: a concurrent subtask edit survives", !!m2.find(x=>x.id==="u1s") && m2.find(x=>x.id==="u1").type === "habit");
}

// ── 13. EVENTS (type:"event") ride the SAME per-item merge — start/end/time all participate ──
{
  const base = {id:"ev1",type:"event",title:"Call",start:"2026-07-15",end:null,allDay:0,startTime:"14:00",endTime:null,notes:"",area:null,sched:null,updated:100,ord:0,ordAt:0,deleted:0};
  // two devices edit DIFFERENT fields; the newer edit wins, still one item (never delete+create)
  const phone = Object.assign({}, base, {startTime:"15:00", updated:200});   // phone moves the time (newer)
  const desk  = Object.assign({}, base, {notes:"bring notes", updated:150}); // desk adds a note (older)
  const m = mergeThings([desk],[phone]);
  ok("event: the newer field-edit wins (time)", m.find(x=>x.id==="ev1").startTime === "15:00");
  ok("event: one item, never delete+create", m.filter(x=>x.id==="ev1").length === 1);
  // a RESCHEDULE (change the date) is an EDIT — id stable, newer wins over a stale copy, not a resurrection
  const moved = Object.assign({}, base, {start:"2026-07-20", updated:300});
  const m2 = mergeThings([base],[moved]);
  ok("event: reschedule is an edit (newer date wins, still live)", m2.find(x=>x.id==="ev1").start === "2026-07-20" && !m2.find(x=>x.id==="ev1").deleted);
  // a CANCEL is a TOMBSTONE; a peer's older LIVE copy cannot resurrect it
  const cancelled = thingsCascadeDelete([base], "ev1", 500);
  ok("event: cancel tombstones the event", !!cancelled.find(x=>x.id==="ev1").deleted);
  ok("event: a peer's older live copy can't resurrect a cancelled event", visIds(mergeThings(cancelled,[base])) === "");
  // a multi-day span survives a merge with every field intact
  const span = {id:"ev2",type:"event",title:"Trip",start:"2026-07-24",end:"2026-07-26",allDay:1,startTime:null,endTime:null,updated:1,ord:1,ordAt:0};
  const r = mergeThings([span],[]).find(x=>x.id==="ev2");
  ok("event: multi-day span survives the merge intact", r.start==="2026-07-24" && r.end==="2026-07-26" && r.allDay===1);
}

// ── 14. HABITS v2: the 4 track modes + a habit's OWN sched ride the same per-item merge ──
{
  // a habit's sched (nested object) round-trips the merge byte-intact — deep fields included
  const h = {id:"h9",type:"habit",title:"Stretch",track:"scale",sched:{freq:"weekly",days:[1,3,5],every:2,start:"2026-07-01",paused:0},done:0,updated:100,ord:0,ordAt:0,deleted:0};
  const rt = mergeThings([h],[]).find(x=>x.id==="h9");
  ok("habit: sched round-trips the merge deep-intact", JSON.stringify(rt.sched) === JSON.stringify(h.sched) && rt.track === "scale");
  // a NEWER sched edit beats a stale copy (an edit, never delete+create)
  const resched = Object.assign({}, h, {sched:{freq:"monthly",monthly:[1,15]}, updated:200});
  const m = mergeThings([h],[resched]);
  ok("habit: newer sched edit wins, one item", m.filter(x=>x.id==="h9").length === 1 && m.find(x=>x.id==="h9").sched.freq === "monthly");
  // sched-edit vs DELETE race: the newer stamp wins each way (tombstone on exact tie is §6)
  const dead = Object.assign({}, h, {deleted:1, updated:300});
  ok("habit: newer delete beats an older sched edit", !!mergeThings([resched],[dead]).find(x=>x.id==="h9").deleted);
  const revived = Object.assign({}, h, {sched:{freq:"daily",every:1}, deleted:0, updated:400});
  ok("habit: a NEWER edit outranks an older tombstone (explicit un-delete)", !mergeThings([dead],[revived]).find(x=>x.id==="h9").deleted);
  // the new track values are plain content — canon is deterministic on them (order-insensitive)
  const n1 = {id:"h10",type:"habit",title:"Mood",track:"note",updated:50,ord:1,ordAt:0,deleted:0};
  ok("habit: canon equal regardless of key insertion order",
     thingCanon({track:"note",id:"h10",title:"Mood",type:"habit"}) === thingCanon({id:"h10",type:"habit",title:"Mood",track:"note"}));
  // webcache parity on the NEW fields — both runtimes must pick byte-identical winners
  const jsWin = JSON.stringify(mergeThings([h,n1],[resched,dead]));
  const wWin  = JSON.stringify(wMergeThings([h,n1],[resched,dead]));
  ok("habit: app.js ↔ webcache.js pick byte-identical winners on track+sched", jsWin === wWin);
}

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
