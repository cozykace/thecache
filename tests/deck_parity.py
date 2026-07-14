import json, subprocess, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import store

# a fixture set that exercises the tie-break + ord merge + tombstones
CASES = [
    ([{"id":"x","prompt":"aaa","updated":5,"ord":0,"ordAt":0}],
     [{"id":"x","prompt":"bbb","updated":5,"ord":0,"ordAt":0}]),
    ([{"id":"x","prompt":"p","updated":1,"ord":0,"ordAt":0}],
     [{"id":"x","prompt":"p","updated":1,"ord":0,"ordAt":0,"deleted":1}]),
    ([{"id":"a","prompt":"A","updated":100,"ord":0,"ordAt":0},{"id":"b","prompt":"B","updated":100,"ord":1,"ordAt":0}],
     [{"id":"b","prompt":"B2","updated":200,"ord":1,"ordAt":0},{"id":"c","prompt":"C","updated":50,"ord":2,"ordAt":300}]),
    ([{"id":"z","emoji":"🍳","prompt":"unicode ✨","updated":7,"ord":0,"ordAt":0,"options":[["a","b"],["c","d"]]}],
     [{"id":"z","emoji":"🍳","prompt":"unicode ✨","updated":7,"ord":0,"ordAt":0,"options":[["a","b"],["c","e"]]}]),
]
py_out = [store.merge_decks(a, b) for a, b in CASES]

# run the SAME fixtures through app.js's mergeDecks
js = r'''
const fs=require("fs");const src=fs.readFileSync(process.argv[3]+"/app.js","utf8").split("\n");
const at=(re)=>src.findIndex(l=>re.test(l));
const code=src.slice(at(/^const DECK_KEY = "money\.deck"/), at(/^function loadLog/)).join("\n");
let localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{},key:()=>null,length:0};
const document={dispatchEvent(){}};function ckPushDeckSoon(){}function devId(){return "d";}
eval(code);
const CASES=JSON.parse(process.argv[2]);
console.log(JSON.stringify(CASES.map(([a,b])=>mergeDecks(a,b))));
'''
open("/tmp/_dp.js","w").write(js)
js_out = json.loads(subprocess.check_output(["node","/tmp/_dp.js", json.dumps(CASES), ROOT]).decode())

# and through webcache's wMergeDecks
jw = r'''
const fs=require("fs");const src=fs.readFileSync(process.argv[3]+"/webcache.js","utf8").split("\n");
const at=(re)=>src.findIndex(l=>re.test(l));
const code=src.slice(at(/var W_DECK_LIVE_CAP/), at(/function wStampGeneric/)).join("\n");
eval(code);
const CASES=JSON.parse(process.argv[2]);
console.log(JSON.stringify(CASES.map(([a,b])=>wMergeDecks(a,b))));
'''
open("/tmp/_dw.js","w").write(jw)
w_out = json.loads(subprocess.check_output(["node","/tmp/_dw.js", json.dumps(CASES), ROOT]).decode())

p=f=0
def ok(n,c):
    global p,f; p+=c; f+=(not c); print(("  ok  " if c else "FAIL  ")+n)

for i,(py,js_,w) in enumerate(zip(py_out, js_out, w_out)):
    ok("case %d: Python == app.js" % i, json.loads(json.dumps(py)) == js_)
    ok("case %d: app.js == webcache" % i, js_ == w)
print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
