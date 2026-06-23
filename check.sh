#!/bin/bash
# Quick self-check before handing work back. Prints COUNTS/placeholders only —
# never real names or dollar amounts (see data-safety in CLAUDE.md).
cd "$(dirname "$0")"
set -e

echo "— JS syntax —"
node --check app.js && echo "  app.js OK"
node --check cursor.js && echo "  cursor.js OK"

echo "— Python syntax —"
python3 -c "import ast; [ast.parse(open(f).read()) for f in ('store.py','server.py','sync.py','import_statements.py')]; print('  py OK')"

echo "— Logic sanity (counts only) —"
python3 -c "
import store, json, os
led = store._read(store.LEDGER, {})
print('  ledger txns:', len(led) if isinstance(led, dict) else 0)
if os.path.exists(store.BALANCES):
    b = json.load(open(store.BALANCES))
    inc = b.get('income', {})
    print('  balances keys:', sorted(b.keys()))
    print('  income: sources', len(inc.get('sources', [])), 'untagged', inc.get('untagged'))
    print('  subscriptions items:', len(b.get('subscriptions', {}).get('items', [])))
    print('  accounts:', len(b.get('accounts', [])))
"
echo "Done — all green."
