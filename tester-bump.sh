#!/usr/bin/env bash
# Push a test "update bump" to ALL testers — an empty commit (no code change), so
# everyone running THE CACHE sees a preview in Menu → Update app and can exercise
# the update flow (apply or skip). Safe: applying it changes nothing.
#
#   ./tester-bump.sh "Test update — checking the update preview"
#
# NOTE: this goes to *everyone* on `main`. Targeting *select* testers needs the
# membership/community backend (see BACKLOG "Community membership & contribution
# ledger") — not possible from a public git repo alone.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MSG="${1:-Test update — verifying the in-app update flow}"
git -C "$HERE" commit --allow-empty -m "$MSG

(test bump — no code change; safe to apply or skip)"
git -C "$HERE" push origin main
echo "✓ Pushed test bump: $MSG"
echo "  Testers will see it in Menu → Update app within a minute."
