const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8").split("\n");
// anchor-based extraction — immune to line drift
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
const block = (a, b) => src.slice(at(a), at(b)).join("\n");
const SYNC_HELPERS = block(/^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const SYNC_MERGERS = block(/^function mergeProfileStrings/, /^let _pullBusy/);
eval(SYNC_HELPERS);
let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};

// ── LIVELOCK 1: union arrays same SET, different ORDER → witness MUST see equal ──
const e0={at:1,itemId:"q0",v:3}, eA={at:2,itemId:"qA",v:4}, eB={at:3,itemId:"qB",v:5};
const A_log = JSON.stringify([e0,eA,eB]);      // device A order
const B_log = JSON.stringify([e0,eB,eA]);      // device B order (same set)
ok("L1 money.log: same set diff order → equal hash (no livelock)",
   authoredHash({"money.log":A_log},{}) === authoredHash({"money.log":B_log},{}));
// a GENUINELY missing entry still differs (honesty preserved)
ok("L1 money.log: a dropped entry still differs (honest)",
   authoredHash({"money.log":A_log},{}) !== authoredHash({"money.log":JSON.stringify([e0,eA])},{}));

// badges same set diff order
ok("L1 badges: set-equal regardless of order",
   authoredHash({"money.badges":'["a","b","c"]'},{}) === authoredHash({"money.badges":'["c","a","b"]'},{}));

// charLog same set diff order (equal-t entries)
const cA=JSON.stringify([{t:5,k:"x",d:"1"},{t:5,k:"y",d:"2"}]);
const cB=JSON.stringify([{t:5,k:"y",d:"2"},{t:5,k:"x",d:"1"}]);
ok("L1 charLog: equal-t entries order-independent", authoredHash({"money.charLog":cA},{})===authoredHash({"money.charLog":cB},{}));

// customStats: same stats diff order + kept-local LABEL must NOT cause a diff (only id+marks converge)
const sA=JSON.stringify([{id:"r",label:"Rent",marks:["m1","m2"]},{id:"g",label:"Gym",marks:["m3"]}]);
const sB=JSON.stringify([{id:"g",label:"GYM-renamed",marks:["m3"]},{id:"r",label:"RENT",marks:["m2","m1"]}]);
ok("L1 customStats: order+label ignored, id+marks converge",
   authoredHash({"money.customStats":sA},{}) === authoredHash({"money.customStats":sB},{}));
// but an added mark IS detected
const sC=JSON.stringify([{id:"r",label:"Rent",marks:["m1","m2","m9"]},{id:"g",label:"Gym",marks:["m3"]}]);
ok("L1 customStats: an added mark still differs (honest)",
   authoredHash({"money.customStats":sA},{}) !== authoredHash({"money.customStats":sC},{}));

// deck is now a PER-ITEM merge: position lives in the `ord` FIELD, not in array order.
// The witness must therefore be array-order-INsensitive (else two converged devices read
// as forever "ahead") but still catch a real reorder (a changed `ord`) and any content change.
const dA = JSON.stringify([{id:"c1",prompt:"one",ord:0,updated:5},{id:"c2",prompt:"two",ord:1,updated:5}]);
const dB = JSON.stringify([{id:"c2",prompt:"two",ord:1,updated:5},{id:"c1",prompt:"one",ord:0,updated:5}]); // same items, array reversed
const dC = JSON.stringify([{id:"c1",prompt:"one",ord:9,updated:5},{id:"c2",prompt:"two",ord:1,updated:5}]); // c1 genuinely reordered
const dD = JSON.stringify([{id:"c1",prompt:"CHANGED",ord:0,updated:9},{id:"c2",prompt:"two",ord:1,updated:5}]);
ok("L1 deck: array order ignored (no livelock between converged devices)",
   authoredHash({"money.deck":dA},{}) === authoredHash({"money.deck":dB},{}));
ok("L1 deck: a real reorder (changed ord) IS detected",
   authoredHash({"money.deck":dA},{}) !== authoredHash({"money.deck":dC},{}));
ok("L1 deck: a content edit IS detected",
   authoredHash({"money.deck":dA},{}) !== authoredHash({"money.deck":dD},{}));

// money.things is a PER-ITEM merge exactly like the deck — the witness must be
// array-order-INsensitive (else two converged devices read as forever "ahead" → the
// infinite corrective-push livelock) but still catch a real reorder (a changed `ord`)
// and any content change. Without an id-sorted _authoredProject branch it would fall
// through to the order-sensitive canonicalizer and ping-pong forever.
const tA = JSON.stringify([{id:"t1",type:"task",title:"one",ord:0,updated:5},{id:"t2",type:"subtask",parent:"t1",title:"two",ord:1,updated:5}]);
const tB = JSON.stringify([{id:"t2",type:"subtask",parent:"t1",title:"two",ord:1,updated:5},{id:"t1",type:"task",title:"one",ord:0,updated:5}]); // reversed
const tC = JSON.stringify([{id:"t1",type:"task",title:"one",ord:9,updated:5},{id:"t2",type:"subtask",parent:"t1",title:"two",ord:1,updated:5}]); // t1 reordered
const tD = JSON.stringify([{id:"t1",type:"task",title:"CHANGED",ord:0,updated:9},{id:"t2",type:"subtask",parent:"t1",title:"two",ord:1,updated:5}]); // content edit
ok("L1 things: array order ignored (no livelock between converged devices)",
   authoredHash({"money.things":tA},{}) === authoredHash({"money.things":tB},{}));
ok("L1 things: a real reorder (changed ord) IS detected",
   authoredHash({"money.things":tA},{}) !== authoredHash({"money.things":tC},{}));
ok("L1 things: a content edit IS detected",
   authoredHash({"money.things":tA},{}) !== authoredHash({"money.things":tD},{}));

// ── LIVELOCK 2: generic mtime tie tie-break is a symmetric total order ──
// _valWins(a,b) XOR _valWins(b,a) for a!==b, and both devices pick the SAME winner
function pickWinner(a,b){ // device with local=a adopts b iff _valWins(b,a); device with local=b adopts a iff _valWins(a,b)
  const aAdoptsB = _valWins(b,a);   // local a, remote b
  const bAdoptsA = _valWins(a,b);   // local b, remote a
  const aFinal = aAdoptsB ? b : a;
  const bFinal = bAdoptsA ? a : b;
  return {aFinal,bFinal,exclusive: aAdoptsB !== bAdoptsA};
}
let allConverge=true, allExclusive=true;
const vals=["dark","light","500","520","","note text","{\"x\":1}","zzz","aaa","dusk"];
for(const a of vals) for(const b of vals) if(a!==b){ const r=pickWinner(a,b); if(r.aFinal!==r.bFinal) allConverge=false; if(!r.exclusive) allExclusive=false; }
ok("L2 tie-break: strictly asymmetric (exactly one adopts)", allExclusive);
ok("L2 tie-break: both devices converge to same value", allConverge);
ok("L2 tie-break: _valWins(a,a) is false (no self-adopt churn)", _valWins("x","x")===false);

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
