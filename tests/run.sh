#!/bin/bash
# THE CACHE — sync-engine regression suite.
#
# Plain node + python stdlib. No deps, no framework, no build step (house rules).
# Every harness loads the REAL functions out of app.js / webcache.js / store.py by
# ANCHOR (a function-name regex), never by line number — so they don't rot when the
# files shift. Fixtures are placeholders only; never put real bank data in here.
#
# RUN THIS BEFORE AND AFTER ANY CHANGE TO THE SYNC ENGINE.
# It is the only thing standing between a subtle merge bug and silently eating a
# user's data. Adversarial review found a livelock or a data-loss bug in EVERY
# draft of this engine; these assertions are what pinned them down.
#
#   ./tests/run.sh
set -u
cd "$(dirname "$0")/.."

echo "── compile ──"
node --check app.js      || exit 1
node --check webcache.js || exit 1
python3 -m py_compile store.py server.py || exit 1
echo "   ok"

TOTAL=0; FAILED=0
run() { # run <cmd...>
  local name="$1"; shift
  local out; out=$("$@" 2>&1); local rc=$?
  local line; line=$(echo "$out" | tail -1)
  printf "  %-16s %s\n" "$name" "$line"
  if [ $rc -ne 0 ]; then FAILED=$((FAILED+1)); echo "$out" | grep -E "^FAIL|Error" | head -5; fi
  local n; n=$(echo "$line" | grep -oE '^[0-9]+' || echo 0)
  TOTAL=$((TOTAL+n))
}

echo "── JS (client merge engine) ──"
for t in merge_test authored_test livelock_test profile_test timer_test deck_test things_test logderive_test crypto_interop_test; do
  run "$t" node "tests/$t.js"
done

echo "── Python (backend merge engine) ──"
for t in map_test roundtrip_test maptie_test restore_test rev_test catmeta_test tomb_test deck_parity checkinlog_test; do
  run "$t" env PYTHONPATH="$PWD" python3 "tests/$t.py"
done

echo
if [ $FAILED -eq 0 ]; then
  echo "✓ $TOTAL assertions green"
else
  echo "✗ $FAILED harness(es) FAILED — do not ship"; exit 1
fi
