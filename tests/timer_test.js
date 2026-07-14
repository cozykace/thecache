const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor: " + re); return i; };
// the timer persistence layer: from the TIMER_KEY decl through timerSave
const code = src.slice(at(/^const TIMER_KEY = "money\.timer"/), at(/^function timerPreset/)).join("\n");
function makeLS(){const s={};return{_s:s,getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]},key:i=>Object.keys(s)[i]??null,get length(){return Object.keys(s).length}};}
let localStorage = makeLS();
const timerSt = eval(code + "\n;timerSt");   // functions leak from sloppy eval; the const does not
let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};

// MIGRATION: a legacy combined blob must split cleanly on first save
localStorage = makeLS();
localStorage.setItem("money.timer", JSON.stringify({work:50,rest:10,longRest:20,longEvery:3,sound:false,phase:"rest",cycle:4,endsAt:1234567890,pausedLeft:null}));
timerLoad();
ok("migration: presets read from the legacy blob", timerSt.work===50 && timerSt.longEvery===3 && timerSt.sound===false);
ok("migration: runtime read from the legacy blob", timerSt.phase==="rest" && timerSt.cycle===4 && timerSt.endsAt===1234567890);
timerSave();
const pre = JSON.parse(localStorage.getItem("money.timer"));
const run = JSON.parse(localStorage.getItem("money.timerRun"));
ok("split: money.timer holds ONLY presets", Object.keys(pre).sort().join()==="longEvery,longRest,rest,sound,work");
ok("split: money.timerRun holds ONLY runtime", Object.keys(run).sort().join()==="cycle,endsAt,pausedLeft,phase");
ok("split: no countdown left in the synced key", !("endsAt" in pre) && !("phase" in pre));

// A PEER'S BLOB (even a legacy one carrying a running countdown) must not move our timer
localStorage = makeLS(); timerLoad();
timerSt.phase="work"; timerSt.cycle=1; timerSt.endsAt=null;
timerAdopt(JSON.stringify({work:45,sound:false,phase:"long",cycle:9,endsAt:999999999999}));  // vault blob from another device
ok("adopt: peer's PRESETS applied", timerSt.work===45 && timerSt.sound===false);
ok("adopt: peer's countdown REJECTED (no hijack)", timerSt.phase==="work" && timerSt.cycle===1 && timerSt.endsAt===null);

// same-device cross-tab: runtime DOES travel between tabs
timerAdoptRun(JSON.stringify({phase:"rest",cycle:3,endsAt:555,pausedLeft:null}));
ok("cross-tab: runtime adopted from the other tab", timerSt.phase==="rest" && timerSt.cycle===3 && timerSt.endsAt===555);
ok("cross-tab: presets untouched by a runtime adopt", timerSt.work===45);

// corrupt values can't wedge it
timerAdoptRun('{"phase":"garbage","cycle":-5,"endsAt":"nope"}');
ok("corrupt runtime coerced safely", timerSt.phase==="work" && timerSt.cycle===1 && timerSt.endsAt===null);

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
