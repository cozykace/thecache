import os, json, tempfile
import store
def use(d):
    store.CATEGORIES=os.path.join(d,"categories.json"); store.INCOME=os.path.join(d,"income.json")
    store.SUBS=os.path.join(d,"subs.json"); store.INCOME_LINKS=os.path.join(d,"income_links.json")
    store.MAPMETA=os.path.join(d,"_mapmeta.json")
    store.MERGE_MAPS={"categories.json":store.CATEGORIES,"income.json":store.INCOME,"subs.json":store.SUBS,"income_links.json":store.INCOME_LINKS}
A,B=tempfile.mkdtemp(),tempfile.mkdtemp()
vault={"files":{},"filesMeta":{}}
def push(d):
    use(d); store.merge_maps(vault["files"],vault["filesMeta"])
    for n,p in store.MERGE_MAPS.items(): vault["files"][n]=json.dumps(store._read(p,{}))
    vault["filesMeta"]=store.load_mapmeta()
def pull(d):
    use(d); store.merge_maps(vault["files"],vault["filesMeta"])
p=f=0
def ok(n,c):
    global p,f; p+=c; f+=(not c); print(("  ok  " if c else "FAIL  ")+n)

# LEGACY m:0 conflict: both devices have 'coffee' mapped differently, UNSTAMPED (m:0)
use(A); store._write(store.CATEGORIES,{"coffee":"food"})            # A, no mapmeta stamp
use(B); store._write(store.CATEGORIES,{"coffee":"drinks"})          # B, no mapmeta stamp
# A pushes its unstamped map
push(A)
# B pulls+pushes; must converge to the SAME deterministic winner, not ping-pong
pull(B); push(B); pull(A)
a=store._read(os.path.join(A,"categories.json"),{}).get("coffee")
use(B); b=store._read(os.path.join(B,"categories.json"),{}).get("coffee")
ok("map tie: both desktops converge to SAME value", a==b)
ok("map tie: winner is deterministic (_map_val_wins)", a==("food" if store._map_val_wins("food","drinks") else "drinks"))
# and it STABILIZES: another pull round makes no change (no livelock)
use(A); r1=store.merge_maps(vault["files"],vault["filesMeta"])
use(B); r2=store.merge_maps(vault["files"],vault["filesMeta"])
ok("map tie: converged pull is a no-op both sides (no livelock)", r1["changed"] is False and r2["changed"] is False)

# subs.json (OBJECT values) tie also converges
use(A); store._write(store.SUBS,{"netflix":{"core":True}}); use(B); store._write(store.SUBS,{"netflix":{"core":False}})
vault={"files":{},"filesMeta":{}}
push(A); pull(B); push(B); pull(A)
sa=store._read(os.path.join(A,"subs.json"),{}).get("netflix")
use(B); sb=store._read(os.path.join(B,"subs.json"),{}).get("netflix")
ok("map tie: object-valued subs converge too", sa==sb)
print(f"\n{p} passed, {f} failed"); raise SystemExit(1 if f else 0)
