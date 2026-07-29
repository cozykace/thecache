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

# ── non-finite poison (a malformed bridge amount) never rides ──
# float("NaN") raises nothing, NaN <= 0 is False — without explicit guards a poisoned row
# would enter the median, emit invalid JSON (bare NaN) from /api/runway, and fork web/desktop.
poison = txns + [t("bad1", 7, float("nan"), "Payroll Co Direct Dep")]
resp = store.next_deposit(poison, now=NOW)
ok("a NaN deposit is ignored, the real rhythm stands", resp is not None and resp["amount"] == res["amount"])
snapP, _ = store.build_snapshot([{ "id": "a1", "name": "X", "balance": 100.0, "currency": "USD",
                                   "transactions": [{"id": "n1", "posted": NOW - DAY, "amount": "NaN", "description": "Broken Bridge Row"},
                                                    {"id": "n2", "posted": NOW - DAY, "amount": -10.0, "description": "Real Charge"}] }],
                              window_days=30, now=NOW)
ok("build_snapshot refuses a non-finite amount at the door", snapP["spending"]["total"] == 10.0)
ok("…and the snapshot serializes to VALID json (no bare NaN)", "NaN" not in json.dumps(snapP))

# ── income_rhythms: EVERY visible rhythm, not just the nearest ──
# The calendar's week view paints each payday in the week, so it needs the whole beat of
# every source — `last` (the newest real deposit) + `gap_days` (the step) — not one anchor.
rh = store.income_rhythms(txns, now=NOW)
ok("both fixture sources have a rhythm", len(rh) == 2)
ok("nearest-next first", len(rh) == 2 and rh[0]["next"] <= rh[1]["next"])
ok("the head IS next_deposit", rh and rh[0]["key"] == res["key"] and rh[0]["next"] == res["next"])
byk = {r["key"]: r for r in rh}
pay = next((v for k, v in byk.items() if "payroll" in k), None)
ret = next((v for k, v in byk.items() if "retainer" in k), None)
ok("the biweekly source reads a 14-day gap", pay is not None and pay["gap_days"] == 14)
ok("the monthly source reads a 30-day gap", ret is not None and ret["gap_days"] == 30)
ok("last = the newest real deposit (never a projection)", pay is not None and pay["last"] == NOW - 10 * DAY)
ok("every rhythm carries a positive gap (the client divides by it)",
   all(isinstance(r["gap_days"], int) and r["gap_days"] > 0 for r in rh))
# the same exclusions the anchor enforces apply to the whole list — a dead rhythm is dead
# for the calendar too, or the week view would paint paydays that stopped coming.
ok("a long-quiet rhythm is in NO rhythm list", store.income_rhythms(old, now=NOW) == [])
ok("one deposit is not a rhythm", store.income_rhythms([t("x1", 12, 60, "One Time Deposit Misc")], now=NOW) == [])

# next_deposit's shape must stay byte-identical across the refactor — the runway sentence,
# the sealed API bundle, and the JS mirror all read these exact keys in this exact order.
ok("next_deposit shape unchanged", list(res.keys()) == ["key", "source", "next", "ymd", "days", "amount"])
ok("…and carries no projection-only fields", "last" not in res and "gap_days" not in res)

# /api/runway's body: both fields, computed from ONE ledger walk
pay_load = store.runway_payload(txns, now=NOW)
ok("runway payload carries the anchor", pay_load["next_deposit"] == res)
ok("runway payload carries the rhythms", pay_load["rhythms"] == rh)

# ── JS parity ──
JSF = os.path.join(ROOT, "webmoney.js")
def js_call(expr, payload=None):
    if payload is None:
        payload = {"txns": txns, "io": io, "now": NOW}
    js = ("const M=require(%r);const P=JSON.parse(process.argv[1]);console.log(JSON.stringify(%s));") % (JSF, expr)
    return json.loads(subprocess.check_output(["node", "-e", js, json.dumps(payload)]).decode())

jsres = js_call("M.nextDeposit(P.txns, P.io, {}, {}, P.now)")
strip = lambda r: r and {k: r[k] for k in ("key", "next", "days", "amount", "ymd")}
ok("JS↔Python parity", strip(jsres) == strip(res))
# the sealed vault bundle carries next_deposit as JSON — its KEY ORDER must match across
# runtimes too (webcache seals the web-computed head), so pin JS's order, not just Python's.
ok("JS next_deposit key order matches Python", list(jsres.keys()) == list(res.keys()))

# the rhythms list must agree source-for-source (the DISPLAYED source too, via prettify_merchant)
# AND in the same order — the desktop seals this into the vault bundle and the web computes it
# live; a fork means two devices paint different paydays onto the same week.
jsrh = js_call("M.incomeRhythms(P.txns, P.io, {}, {}, P.now)")
striprh = lambda L: [{k: r[k] for k in ("key", "source", "last", "gap_days", "next", "days", "amount", "ymd")} for r in L]
ok("JS↔Python parity: incomeRhythms (incl. source)", striprh(jsrh) == striprh(rh))
ok("JS↔Python parity: same order", [r["key"] for r in jsrh] == [r["key"] for r in rh])
ok("JS nextDeposit is the head of JS incomeRhythms", jsrh and strip(jsres) == strip(jsrh[0]))

# ── the TIE-BREAK (equal `next`): two sources whose next projected deposit lands on the SAME
# day. The ORIGINAL next_deposit picked "first encountered" (dict/txn-iteration order, which
# can differ JS↔Python); the refactor sorts by (next, key) so the tiebreak is DETERMINISTIC and
# identical across runtimes — else the runway anchor (its source/amount) could fork per device. ──
tie_io = {"alpha payroll dep": "income", "bravo payroll dep": "income"}
tie_txns = [
    t("ta1", 30, 500, "Alpha Payroll Dep"), t("ta2", 16, 500, "Alpha Payroll Dep"),   # gap 14d, same schedule
    t("tb1", 30, 700, "Bravo Payroll Dep"), t("tb2", 16, 700, "Bravo Payroll Dep"),   # gap 14d, IDENTICAL next
]
store._write(store.INCOME, dict(io, **tie_io))   # income_rhythms reads overrides from disk; JS takes them as a param
tie_py = store.income_rhythms(tie_txns, now=NOW)
tie_js = js_call("M.incomeRhythms(P.txns, P.io, {}, {}, P.now)", {"txns": tie_txns, "io": tie_io, "now": NOW})
ok("tie: both sources share an identical next", len(tie_py) == 2 and tie_py[0]["next"] == tie_py[1]["next"])
ok("tie: Python orders the tie by key (deterministic)", [r["key"] for r in tie_py] == sorted(r["key"] for r in tie_py))
ok("tie: JS and Python break the tie identically", [r["key"] for r in tie_js] == [r["key"] for r in tie_py])
ok("tie: JS and Python pick the SAME head (next_deposit anchor)", bool(tie_js) and bool(tie_py) and tie_js[0]["key"] == tie_py[0]["key"])

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
