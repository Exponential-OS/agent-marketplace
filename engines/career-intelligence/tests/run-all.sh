#!/usr/bin/env bash
# run-all.sh — Standard CI entry point for career-intelligence-engine
# Exit: 0 = all suites pass (within baseline), 1 = hard failure
#
# Suite 1 (hooks): baseline comparison — ~13 known pre-existing failures tolerated
# Suite 2 (outreach-dedup): HARD FAIL — 16/16 must pass
# Suite 3 (mission-control): HARD FAIL — full suite must pass, no regressions

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_BASELINE=13
PASS=0
FAIL=1

echo "━━━ career-intelligence-engine CI ━━━"
echo ""

# ── Suite 1: hooks (structural, baseline-gated) ──────────────────────────────
echo "Suite 1: hooks..."
HOOKS_OUTPUT=$(bash "$REPO_DIR/tests/test-hooks.sh" 2>&1)
HOOKS_FAILURES=$(echo "$HOOKS_OUTPUT" | grep -c "FAIL" || true)
echo "$HOOKS_OUTPUT" | tail -5

if [ "$HOOKS_FAILURES" -le "$HOOKS_BASELINE" ]; then
  echo "  → hooks: $HOOKS_FAILURES failures (baseline $HOOKS_BASELINE) ✓"
  SUITE1_STATUS="PASS ($HOOKS_FAILURES at baseline)"
else
  echo "  → hooks: $HOOKS_FAILURES failures — EXCEEDS baseline $HOOKS_BASELINE ✗"
  echo "  New failures detected. Fix before shipping."
  exit $FAIL
fi
echo ""

# ── Suite 2: outreach-dedup (pytest, hard fail) ───────────────────────────────
echo "Suite 2: outreach-dedup (pytest)..."
if pytest "$REPO_DIR/tests/test_outreach_dedup.py" -v 2>&1; then
  echo "  → outreach-dedup: PASS ✓"
  SUITE2_STATUS="PASS"
else
  echo "  → outreach-dedup: FAIL ✗  (hard fail — fix before shipping)"
  exit $FAIL
fi
echo ""

# ── Suite 3: mission-control (hard fail) ──────────────────────────────────────
echo "Suite 3: mission-control..."
if bash "$REPO_DIR/tests/test-mission-control.sh" 2>&1; then
  echo "  → mission-control: PASS ✓"
  SUITE3_STATUS="PASS"
else
  echo "  → mission-control: FAIL ✗  (hard fail — fix before shipping)"
  exit $FAIL
fi
echo ""

echo "━━━ CI PASSED ━━━"
echo "  hooks:          $SUITE1_STATUS"
echo "  outreach-dedup: $SUITE2_STATUS"
echo "  mission-control: $SUITE3_STATUS"
exit $PASS
