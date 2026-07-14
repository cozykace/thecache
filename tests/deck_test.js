const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re); return i; };
const code = src.slice(at(/^const DECK_KEY = "money\.deck"/), at(/^function loadLog/)).join("\n");
function makeLS(){const s={};return{_s:s,getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]},key:i=>Object.keys(s)[i]??null,get length(){return Object.keys(s).length}};}
let localStorage = makeLS();
const document = { dispatchEvent(){}, addEventListener(){}, removeEventListener(){} };
function ckPushDeckSoon(){}
function devId(){ return "devA"; }
const DEFAULT_DECK = eval(code + "\n;DEFAULT_DECK");
let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};
const ids = (d) => deckLive(d).map(x=>x.id).join(",");

// ── 1. THE HEADLINE BUG: editor holds a stale array; a remote EDIT lands; one keystroke
//    must NOT revert it (my original design failed exactly here)
{
  const A = [{id:"a",prompt:"orig",updated:100,ord:0,ordAt:0},{id:"b",prompt:"B",updated:100,ord:1,ordAt:0}];
  const stale = JSON.parse(JSON.stringify(A));               // editor opened at t0
  const remote = [{id:"a",prompt:"A-EDITED",updated:200,ord:0,ordAt:0},{id:"b",prompt:"B",updated:100,ord:1,ordAt:0}];
  const stored = mergeDecks(A, remote);                       // a pull landed
  stale[1].prompt = "B-typed"; stale[1].updated = 300;        // user types in the OTHER item — stamped at point of edit
  const saved = mergeDecks(stored, stale);
  ok("stale editor keystroke does NOT revert a remote EDIT", saved.find(x=>x.id==="a").prompt === "A-EDITED");
  ok("...and the user's own edit is kept", saved.find(x=>x.id==="b").prompt === "B-typed");
}

// ── 2. remote DELETE must not be resurrected by a stale editor
{
  const stale = [{id:"a",prompt:"a",updated:100,ord:0,ordAt:0}];        // editor still shows it live
  const remote = [{id:"a",prompt:"a",updated:200,ord:0,ordAt:0,deleted:1}]; // deleted elsewhere
  const stored = mergeDecks([], remote);
  stale.push({id:"z",prompt:"new",updated:300,ord:1,ordAt:0});          // user adds an unrelated card
  const saved = mergeDecks(stored, stale);
  ok("stale editor does NOT resurrect a remote DELETE", !!saved.find(x=>x.id==="a").deleted);
  ok("...and the user's new card lands", !!deckLive(saved).find(x=>x.id==="z"));
}

// ── 3. ADOPTION IS VERBATIM — no stamp escalation ping-pong between devices
{
  let A = [{id:"a",prompt:"x",updated:100,ord:0,ordAt:0}];
  let B = [];
  B = mergeDecks(B, A);   // B adopts
  A = mergeDecks(A, B);   // A pulls back
  B = mergeDecks(B, A);
  ok("adoption preserves `updated` verbatim (no escalation)", B.find(x=>x.id==="a").updated === 100);
  ok("converged decks are byte-identical", JSON.stringify(mergeDecks(A,B)) === JSON.stringify(mergeDecks(B,A)));
}

// ── 4. REORDER on A must not steamroll a concurrent TEXT EDIT on B
{
  const base = [{id:"a",prompt:"a",updated:100,ord:0,ordAt:0},{id:"b",prompt:"b",updated:100,ord:1,ordAt:0},{id:"c",prompt:"c",updated:100,ord:2,ordAt:0}];
  const B = JSON.parse(JSON.stringify(base)); B[0].prompt="B-EDIT"; B[0].updated=200;   // B edits item a's text
  const A = JSON.parse(JSON.stringify(base)); A[2].ord=-1; A[2].ordAt=300;              // A drags c to the front (one item only)
  const m = mergeDecks(A,B);
  ok("reorder does NOT revert a concurrent text edit", m.find(x=>x.id==="a").prompt === "B-EDIT");
  ok("...and the reorder still applies", ids(m) === "c,a,b");
}

// ── 5. FRESH DEVICE's default deck must not steamroll a customized one, nor resurrect deletes
{
  const fresh = loadDeck();   // no localStorage → defaults at updated:0
  ok("fresh-device defaults stamp updated:0", fresh.every(x=>x.updated===0));
  const custom = [{id:"energy",prompt:"MY energy",updated:500,ord:0,ordAt:0},
                  {id:"meals",deleted:1,updated:500,ord:1,ordAt:0}];   // customized + deleted a default
  const m = mergeDecks(custom, fresh);
  ok("fresh defaults do NOT steamroll a customization", m.find(x=>x.id==="energy").prompt === "MY energy");
  ok("fresh defaults do NOT resurrect a deleted card", !!m.find(x=>x.id==="meals").deleted);
  ok("...but a default the user never had IS added", !!deckLive(m).find(x=>x.id==="spend"));
}

// ── 6. MIGRATION: pre-existing deletion (expressed by ABSENCE) becomes a tombstone
{
  const old = [{id:"energy",emoji:"⚡",prompt:"custom!",input:"scale"}];   // no stamps; 'meals'+'spend' were deleted
  const mig = deckMigrate(old);
  ok("migration: customization stamps 1 (beats an untouched default at 0)", mig.find(x=>x.id==="energy").updated === 1);
  ok("migration: an absent default becomes a TOMBSTONE", !!mig.find(x=>x.id==="meals" && x.deleted));
  const peer = loadDeck();   // a peer that still has all 3 defaults at 0
  const m = mergeDecks(mig, peer);
  ok("migration: the pre-existing delete is NOT resurrected by a peer", !deckLive(m).find(x=>x.id==="meals"));
}

// ── 7. exact-tie → TOMBSTONE WINS (migration puts many items at 0/1, so ties are common)
{
  const m = mergeDecks([{id:"x",prompt:"live",updated:1,ord:0,ordAt:0}],
                       [{id:"x",prompt:"live",updated:1,ord:0,ordAt:0,deleted:1}]);
  ok("exact tie: the tombstone wins (a killed card must not come back)", !!m.find(x=>x.id==="x").deleted);
}

// ── 8. tie-break is deterministic + symmetric (both devices pick the SAME winner)
{
  const a=[{id:"x",prompt:"aaa",updated:5,ord:0,ordAt:0}], b=[{id:"x",prompt:"bbb",updated:5,ord:0,ordAt:0}];
  ok("content tie-break is order-independent", JSON.stringify(mergeDecks(a,b))===JSON.stringify(mergeDecks(b,a)));
}

// ── 9. caps: live and tombstones bounded SEPARATELY (a single slice would drop real cards)
{
  const many = [];
  for (let i=0;i<80;i++) many.push({id:"L"+i,prompt:"p",updated:1,ord:i,ordAt:0});
  for (let i=0;i<80;i++) many.push({id:"T"+i,prompt:"p",updated:i,ord:100+i,ordAt:0,deleted:1});
  const c = deckCap(many);
  ok("cap: live items bounded to 60", c.filter(x=>!x.deleted).length === 60);
  ok("cap: tombstones bounded separately (newest kept)", c.filter(x=>x.deleted).length === 60);
  ok("cap: capping does not drop live cards to make room for tombstones", deckLive(c).length === 60);
}

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
