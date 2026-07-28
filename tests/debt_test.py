# Debt cost (Money Truth arc, Brick 3) — the per-month interest + card-payment numbers
# the Debt widget reads. monthly_history must carry `interest` (what carrying debt cost)
# and `ccpay` (card payments made) per month, from deterministic description detectors:
#   is_interest_txn      — outgoing txns containing "interest" (a savings account's
#                          "interest paid TO you" is positive → never counted)
#   is_card_payment_txn  — outgoing txns matching the phrases banks actually print
# Fixtures are placeholders only — never real bank data.
import os, tempfile, time
import store

D = tempfile.mkdtemp()
store.DATA = D
for attr in ["CATEGORIES", "INCOME", "SUBS", "INCOME_LINKS", "MAPMETA", "BALANCES",
             "TRANSACTIONS", "LEDGER", "LEDGER_OLD", "MONTHLY", "COVERAGE", "CATMETA", "HISTORY"]:
    if hasattr(store, attr):
        setattr(store, attr, os.path.join(D, os.path.basename(getattr(store, attr))))
store.MERGE_MAPS = {"categories.json": store.CATEGORIES, "income.json": store.INCOME,
                    "subs.json": store.SUBS, "income_links.json": store.INCOME_LINKS}
store.BACKUPS = os.path.join(D, "backups")
store._CATMETA_CACHE = None

p = f = 0
def ok(n, c):
    global p, f
    p += c; f += (not c)
    print(("  ok  " if c else "FAIL  ") + n)

# ── the detectors ──
ok("interest charge (outgoing) detected", store.is_interest_txn("PURCHASE INTEREST CHARGE", -12.4))
ok("savings interest PAID TO YOU (incoming) never counts", not store.is_interest_txn("Interest Paid", 0.42))
ok("plain purchase is not interest", not store.is_interest_txn("Blue Grocer 42", -30))
ok("card autopay detected", store.is_card_payment_txn("SUMMIT CARD CRD AUTOPAY 991", -80))
ok("'payment thank you' detected", store.is_card_payment_txn("PAYMENT THANK YOU", -100))
ok("a grocery run is not a card payment", not store.is_card_payment_txn("Blue Grocer 42", -30))
ok("an incoming refund is not a card payment", not store.is_card_payment_txn("CARD PAYMENT REFUND", 25))

# ── monthly_history carries the fields ──
now = int(time.time()); day = 86400
txns = [
    {"id": "a1", "posted": now - 3 * day, "amount": -12.40, "description": "Purchase Interest Charge", "account": "Card"},
    {"id": "a2", "posted": now - 4 * day, "amount": -80.00, "description": "Summit Card CRD AUTOPAY", "account": "Checking"},
    {"id": "a3", "posted": now - 5 * day, "amount": -30.00, "description": "Blue Grocer 42", "account": "Checking"},
    {"id": "a4", "posted": now - 6 * day, "amount": 0.42, "description": "Interest Paid", "account": "Savings"},
]
store.merge_ledger(txns)
months = store.monthly_history(limit=3)
tot_int = round(sum(m.get("interest", 0) for m in months), 2)
tot_pay = round(sum(m.get("ccpay", 0) for m in months), 2)
ok("monthly interest summed (12.40)", tot_int == 12.40)
ok("monthly card payments summed (80.00)", tot_pay == 80.00)
# the card payment auto-categorizes as transfer → must NOT count as spending
tot_spend = round(sum(m["spending"] for m in months), 2)
ok("card payment excluded from spending; interest (a real cost) stays in (30+12.40)", tot_spend == 42.40)

print("%d passed, %d failed" % (p, f))
raise SystemExit(1 if f else 0)
