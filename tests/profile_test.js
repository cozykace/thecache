const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8").split("\n");
// anchor-based extraction — immune to line drift
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor not found: " + re); return i; };
const block = (a, b) => src.slice(at(a), at(b)).join("\n");
const SYNC_HELPERS = block(/^const CLOUD_INTERNAL_KEYS/, /^async function cloudPush/);
const SYNC_MERGERS = block(/^function mergeProfileStrings/, /^let _pullBusy/);
eval(SYNC_HELPERS);
let p=0,f=0;const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};
// two converged devices differ ONLY in stats.dev (+ name) → witness MUST be equal now
const A=JSON.stringify({name:"Player A",stats:{dev:"devA",exp:100,clicks:50,expBy:{devA:100,devB:0}}});
const B=JSON.stringify({name:"Player B",stats:{dev:"devB",exp:100,clicks:50,expBy:{devB:0,devA:100}}});
ok("profile: converged devices (diff dev+name) hash EQUAL (livelock closed)",
   authoredHash({"money.profile":A},{})===authoredHash({"money.profile":B},{}));
// a genuinely richer device (more exp) MUST differ (honesty preserved)
const C=JSON.stringify({name:"Player A",stats:{dev:"devA",exp:150,clicks:50,expBy:{devA:150,devB:0}}});
ok("profile: richer exp still differs (honest)",
   authoredHash({"money.profile":A},{})!==authoredHash({"money.profile":C},{}));
// a new expBy slot (another device earned) differs
const D=JSON.stringify({stats:{dev:"devA",exp:100,clicks:50,expBy:{devA:100,devB:0,devC:5}}});
ok("profile: new expBy slot differs (honest)",
   authoredHash({"money.profile":A},{})!==authoredHash({"money.profile":D},{}));
// higher clicks differs
const E=JSON.stringify({stats:{dev:"devA",exp:100,clicks:77,expBy:{devA:100,devB:0}}});
ok("profile: clicks change differs (honest)",
   authoredHash({"money.profile":A},{})!==authoredHash({"money.profile":E},{}));
console.log(`\n${p} passed, ${f} failed`);process.exit(f?1:0);
