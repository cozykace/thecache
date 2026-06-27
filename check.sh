#!/bin/bash
# Full systems check for THE CACHE. One command, compact output.
# Prints COUNTS/placeholders only — never real names or dollar amounts
# (see data-safety in CLAUDE.md). Safe to paste anywhere.
#
#   ./check.sh          # everything (static + data + demo drift + live + git)
#   ./check.sh --quick  # skip the live-endpoint probe (no server needed)
cd "$(dirname "$0")"
PORT=5173
QUICK=0; [ "$1" = "--quick" ] && QUICK=1
fail=0

echo "— JS syntax —"
node --check app.js    && echo "  app.js OK"    || fail=1
node --check cursor.js && echo "  cursor.js OK" || fail=1

echo "— Python syntax —"
python3 -c "import ast; [ast.parse(open(f).read()) for f in ('store.py','server.py','sync.py','import_statements.py')]; print('  py OK')" || fail=1

echo "— JSON validity (data/) —"
python3 -c "
import json, glob
ok=bad=0
for f in sorted(glob.glob('data/*.json')):
    try: json.load(open(f)); ok+=1
    except Exception as e: bad+=1; print('  INVALID', f.split('/')[-1], '-', type(e).__name__)
print(f'  valid {ok}  invalid {bad}')
import sys; sys.exit(1 if bad else 0)
" || fail=1

echo "— Logic sanity (counts only) —"
python3 -c "
import store, json, os
led = store.load_ledger()
print('  ledger txns:', len(led))
if os.path.exists(store.BALANCES):
    b = json.load(open(store.BALANCES))
    inc = b.get('income', {})
    print('  balances keys:', sorted(b.keys()))
    print('  income: sources', len(inc.get('sources', [])), 'untagged', inc.get('untagged'))
    print('  subscriptions items:', len(b.get('subscriptions', {}).get('items', [])))
    print('  accounts:', len(b.get('accounts', [])))
" || fail=1

echo "— Demo drift (docs/demo vs root) —"
drift=0
for f in app.js styles.css cursor.js; do
  if [ -f "docs/demo/$f" ]; then
    cmp -s "$f" "docs/demo/$f" || { echo "  STALE: $f (run ./build-demo.sh)"; drift=1; }
  else
    echo "  MISSING: docs/demo/$f"; drift=1
  fi
done
[ $drift -eq 0 ] && echo "  demo in sync"

echo "— Live API ($PORT) —"
if [ $QUICK -eq 1 ]; then
  echo "  skipped (--quick)"
elif [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/ping 2>/dev/null)" = "200" ]; then
  for ep in summary categories subs integrity issues; do
    code=$(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/$ep" 2>/dev/null)
    printf "  /api/%-10s %s\n" "$ep" "$code"
    [ "$code" = "200" ] || fail=1
  done
else
  echo "  server not running (start: python3 server.py) — skipping"
fi

echo "— Git —"
echo "  branch: $(git branch --show-current 2>/dev/null)  uncommitted: $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

echo
[ $fail -eq 0 ] && echo "ALL GREEN ✓" || { echo "ISSUES FOUND ✗"; exit 1; }
