# Paycheck runway (research trio) — next_deposit(): each income source's rhythm read
# forward, nearest upcoming wins. Rules under test (both runtimes must agree):
#   · median gap between a source's deposits (gaps of 3–45 days only)
#   · same-day / split deposits (< 3d apart) never fake a rhythm
#   · a single deposit has no rhythm → None
#   · a rhythm gone quiet (next projection > 60d out) → None
# Fixtures are placeholders only — never real bank data.
import json, os, subprocess
import store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = f = 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

NOW = 1_753_300_000
DAY = 86400
def t(id_, days_ago, amt, desc):
    return {"id": id_, "posted": NOW - days_ago * DAY, "amount": amt, "description": desc, "account": "X"}

# a biweekly payroll (14d rhythm, last 10 days ago → next in ~4d) + a monthly retainer
# (30d rhythm, last 5 days ago → next in ~25d) + noise that must not fake a rhythm
txns = [
    t("p1", 38, 900, "Payroll Co Direct Dep"), t("p2", 24, 900, "Payroll Co Direct Dep"), t("p3", 10, 905, "Payroll Co Direct Dep"),
    t("r1", 35, 400, "Retainer Client Payment Dep"), t("r2", 5, 400, "Retainer Client Payment Dep"),
    t("s1", 22, 250, "Payroll Co Direct Dep"),   # a same-cycle SPLIT deposit 2d after p2 — under the 3d floor, never fakes a rhythm
    t("x1", 12, 60, "One Time Deposit Misc"),    # single — no rhythm
    t("n1", 9, -50, "Blue Grocer"),              # spending — ignored
]
io = {"payroll co direct dep": "income", "retainer client payment dep": "income", "one time deposit misc": "income"}
store_overrides = {}

# route income_decision through explicit overrides (no ambient files)
res = store.next_deposit(txns, now=NOW) if False else None
# next_deposit loads overrides from disk — point it at a clean temp store first
import tempfile
D = tempfile.mkdtemp()
store.DATA = D
for attr in ["CATEGORIES", "INCOME", "MAPMETA", "CATMETA"]:
    if hasattr(store, attr):
        setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
store._CATMETA_CACHE = None
store._write(store.INCOME, io)

res = store.next_deposit(txns, now=NOW)
ok("a rhythm was found", res is not None)
ok("nearest source wins (the biweekly payroll)", res and "payroll" in res["key"])
ok("projected a sensible few days out", res and 1 <= res["days"] <= 14)
ok("median amount carried", res and 850 <= res["amount"] <= 950)

# a single deposit alone → no rhythm
res2 = store.next_deposit([t("x1", 12, 60, "One Time Deposit Misc")], now=NOW)
ok("one deposit is not a rhythm", res2 is None)

# a rhythm that went quiet (last deposit long ago, projection lands > 60d out) → None
old = [t("o1", 200, 500, "Payroll Co Direct Dep"), t("o2", 170, 500, "Payroll Co Direct Dep")]
ok("a long-quiet rhythm promises nothing", store.next_deposit(old, now=NOW) is None)

# ── JS parity ──
js = (
    "const M=require(%r);"
    "const P=JSON.parse(process.argv[1]);"
    "console.log(JSON.stringify(M.nextDeposit(P.txns, P.io, {}, {}, P.now)));"
) % (os.path.join(ROOT, "webmoney.js"),)
jsres = json.loads(subprocess.check_output(["node", "-e", js, json.dumps({"txns": txns, "io": io, "now": NOW})]).decode())
strip = lambda r: r and {k: r[k] for k in ("key", "next", "days", "amount", "ymd")}
ok("JS↔Python parity", strip(jsres) == strip(res))

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
