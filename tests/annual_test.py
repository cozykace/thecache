# Annual predictions (Money Truth arc, Brick 5a) — yearly charges forecast forward so the
# anniversary stops ambushing Safe-to-spend. Rules under test (both runtimes must agree):
#   · gaps all ~a year (330–430d)          → "yearly" (proven pattern), next = last + median gap
#   · one charge 270–430 days old, ≥ $15   → "maybe" (might renew)
#   · any gap under 200 days               → monthly territory — never predicted here
#   · a proven-yearly whose last charge is recent rolls FORWARD to the next anniversary
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

txns = [
    # a PROVEN yearly: charged ~365d apart for two years, last one 340 days ago → due in ~25d
    t("y1", 340 + 365, -95, "Summit Card Annual Fee"),
    t("y2", 340, -95, "Summit Card Annual Fee"),
    # a MAYBE: one charge 300 days ago, $49 → might renew in ~65d
    t("m1", 300, -49, "Domain Registry Renewal"),
    # a MONTHLY sub: must be EXCLUDED (gaps ≪ 200d — the regular radar's job)
    t("s1", 10, -11.99, "Streamco"), t("s2", 40, -11.99, "Streamco"), t("s3", 70, -11.99, "Streamco"),
    # a single RECENT one-off: too young to predict (age < 270d)
    t("r1", 30, -200, "One Time Purchase Co"),
    # a single tiny old charge: under the $15 maybe-floor
    t("tiny", 320, -6, "Small Thing Once"),
    # a proven yearly whose last charge was RECENT — must roll forward ~a year, not "due now"
    t("f1", 20 + 365, -139, "Cloud Backup Yearly"), t("f2", 20, -139, "Cloud Backup Yearly"),
]

res = store.annual_predictions(txns, now=NOW)
keys = {r["key"]: r for r in res}
ok("proven yearly predicted", "summit annual fee" in " ".join(keys) or any("summit" in k for k in keys))
summit = next((r for r in res if "summit" in r["key"]), None)
ok("…confidence 'yearly'", summit and summit["confidence"] == "yearly")
ok("…due ~25 days out", summit and 20 <= summit["days"] <= 30)
ok("…amount carried (95)", summit and summit["amount"] == 95.0)
maybe = next((r for r in res if "domain" in r["key"]), None)
ok("single year-old charge → 'maybe'", maybe and maybe["confidence"] == "maybe")
ok("monthly sub excluded", not any("streamco" in r["key"] for r in res))
ok("recent one-off excluded", not any("one time" in r["key"] for r in res))
ok("tiny old charge excluded ($15 floor)", not any("small thing" in r["key"] for r in res))
roll = next((r for r in res if "cloud backup" in r["key"]), None)
ok("recent-last yearly ROLLS FORWARD (~345d out, never 'overdue')", roll and 330 <= roll["days"] <= 400)
ok("sorted nearest-first", all(res[i]["days"] <= res[i + 1]["days"] for i in range(len(res) - 1)))

# ── JS parity — webmoney.annualPredictions must produce the same predictions ──
js = (
    "const M=require(%r);"
    "const P=JSON.parse(process.argv[1]);"
    "console.log(JSON.stringify(M.annualPredictions(P.txns, P.now)));"
) % (os.path.join(ROOT, "webmoney.js"),)
jsres = json.loads(subprocess.check_output(["node", "-e", js, json.dumps({"txns": txns, "now": NOW})]).decode())
strip = lambda rows: [{k: r[k] for k in ("key", "amount", "days", "confidence", "next")} for r in rows]
ok("JS↔Python parity (keys, amounts, dates, confidence)", strip(jsres) == strip(res))

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
