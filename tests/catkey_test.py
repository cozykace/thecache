# Categorize keys survive the bank changing formats (Money Truth arc, Brick 2).
#
# The bug this pins down (Life Pilot, real data): an override key saved from one bank
# format ("zelle to jane doe wfct123456" → rent) stopped matching when the bank switched
# to a masked description mid-year — the txn silently fell to the AUTO rules (zelle →
# transfer), and post-Brick-1 that means it vanished from spending: a whole month showed
# no rent at all. The fix is a READ-TIME normalized fallback pass: when the raw substring
# match misses, compare refcode-stripped, cleaned KEY words against the refcode-stripped,
# cleaned DESCRIPTION — merchant words survive any format the bank invents. The stored
# key is never rewritten (migrate-on-read, old vaults/maps merge unchanged), and pass 1
# is untouched so every legacy key that matched before still matches byte-for-byte.
# BOTH runtimes (store.py + webmoney.js) must pick identical categories or web and
# desktop disagree in one vault. Fixtures are placeholders only — never real bank data.
import json, os, subprocess, sys, tempfile
import store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = tempfile.mkdtemp()
store.DATA = D
for attr in ["CATEGORIES", "INCOME", "SUBS", "INCOME_LINKS", "MAPMETA", "BALANCES",
             "TRANSACTIONS", "LEDGER", "LEDGER_OLD", "MONTHLY", "COVERAGE", "CATMETA", "HISTORY"]:
    if hasattr(store, attr):
        setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
store._CATMETA_CACHE = None

p = f = 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

# the override as a user actually saved it — carrying a per-format reference suffix
OV = {"zelle to jane doe wfct123456": "rent", "netflix": "subscriptions"}

# the SAME counterparty through three bank formats
RAW        = "Zelle To Jane Doe WFCT123456"                # the format the key was born in
MASKED     = "Zelle Payment Conf# 998877 JANE DOE"         # masked mid-year format
REFORMATTED = "JANE DOE ZELLE 0012 ELECTRONIC PMT"         # yet another shuffle
STRANGER   = "Zelle To Bob Smith QRZT445566"               # a DIFFERENT counterparty

ok("raw format still matches via the legacy pass", store.categorize(RAW, OV, {}) == "rent")
ok("masked format lands in the category (normalized pass)", store.categorize(MASKED, OV, {}) == "rent")
ok("reformatted variant lands too", store.categorize(REFORMATTED, OV, {}) == "rent")
ok("a different counterparty does NOT inherit the tag", store.categorize(STRANGER, OV, {}) != "rent")
ok("…and still auto-detects as transfer (zelle rule)", store.categorize(STRANGER, OV, {}) == "transfer")
ok("plain legacy key untouched (netflix)", store.categorize("NETFLIX.COM 555777", OV, {}) == "subscriptions")
ok("no override → auto rules unchanged", store.categorize("Blue Grocer 42", {}, {}) == "other")
ok("the stored keys were never rewritten", list(OV.keys())[0] == "zelle to jane doe wfct123456")

# a key that is ALL reference-code (normalizes to nothing) must never match everything
OV2 = {"wfct123456 998877": "rent"}
ok("an all-refcode key can't wildcard-match", store.categorize("Any Merchant At All", OV2, {}) == "other")

# ── JS parity: webmoney.categorize must pick the SAME category for every variant ──
js = (
    "const M=require(%r);"
    "const P=JSON.parse(process.argv[1]);"
    "console.log(JSON.stringify(P.descs.map(d=>M.categorize(d, P.ov, {}))));"
) % (os.path.join(ROOT, "webmoney.js"),)
descs = [RAW, MASKED, REFORMATTED, STRANGER, "NETFLIX.COM 555777"]
out = json.loads(subprocess.check_output(["node", "-e", js, json.dumps({"descs": descs, "ov": OV})]).decode())
expect = [store.categorize(d, OV, {}) for d in descs]
ok("JS↔Python parity across all variants (%s)" % ",".join(expect), out == expect)

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
