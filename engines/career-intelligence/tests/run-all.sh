#!/usr/bin/env bash
# run-all.sh — Standard CI entry point for career-intelligence-engine
# Exit: 0 = all suites pass (within baseline), 1 = hard failure
#
# Suite 1 (hooks): baseline comparison — ~13 known pre-existing failures tolerated
# Suite 1c (bun unit tests): HARD FAIL — TypeScript unit tests must pass
# Suite 2 (outreach-dedup): HARD FAIL — 16/16 must pass
# Suite 3 (mission-control): HARD FAIL — full suite must pass, no regressions

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# XOS-33: count the true `=== Results: N failed` number, not a raw `grep -c FAIL`
# (which counted assertion-detail lines — 138 for ~68 real fails — masking the
# real count and letting the gate be bypassed for two releases). Current 12
# known failures = 12 deeper multi-step harness-debt (migrate-chain version
# propagation + integration/upgrade capture setup) under XOS-33 follow-on.
# XOS-31 fixed 4× C1 schema-coherence failures (17→12). XOS-30 (social-
# distribution-engine phantom dir) was previously in the count but cleared
# before this baseline. Drive to 0 via XOS-33 harness-debt; lower as each lands.
HOOKS_BASELINE=12
PASS=0
FAIL=1

echo "━━━ career-intelligence-engine CI ━━━"
echo ""

# ── Suite 1: hooks (structural, baseline-gated) ──────────────────────────────
echo "Suite 1: hooks..."
# test-hooks.sh exits 1 whenever it has ANY failure; under set -e that aborted
# run-all here before the baseline check ever ran (the real bypass mechanism).
# || true lets us read the output and apply the baseline gate ourselves.
HOOKS_OUTPUT=$(bash "$REPO_DIR/tests/test-hooks.sh" 2>&1 || true)
# Parse the authoritative summary line ("=== Results: N passed, M failed ===")
# rather than counting every line containing FAIL.
HOOKS_FAILURES=$(echo "$HOOKS_OUTPUT" | sed -nE 's/.*Results: [0-9]+ passed, ([0-9]+) failed.*/\1/p' | tail -1)
HOOKS_FAILURES=${HOOKS_FAILURES:-999}
echo "$HOOKS_OUTPUT" | tail -2

if [ "$HOOKS_FAILURES" -le "$HOOKS_BASELINE" ]; then
  echo "  → hooks: $HOOKS_FAILURES failures (baseline $HOOKS_BASELINE) ✓"
  SUITE1_STATUS="PASS ($HOOKS_FAILURES at baseline)"
else
  echo "  → hooks: $HOOKS_FAILURES failures — EXCEEDS baseline $HOOKS_BASELINE ✗"
  echo "  New failures detected. Fix before shipping."
  exit $FAIL
fi
echo ""

# ── Suite 1b: canonical-path guard (XOS-26 — hard fail) ───────────────────────
# Locks the v0.66 flat-path sweep: no skill/script may reference the phantom flat
# names or the dead brain/ path. Canonical = career-intelligence/projects/job-search/.
echo "Suite 1b: canonical job-search paths..."
# Forbidden flat/legacy refs (disk-verified canonical, v0.70.0 XOS-26):
#   brain/projects/job-search/ → career-intelligence/projects/job-search/   (C-1 pipeline)
#   brain/scans/               → career-intelligence/projects/job-search/scans/   (F2)
#   brain/network/people       → network/people   (kernel-relative; 238 live files at bare path)
# NOT yet swept (ambiguous/tangled, tracked as follow-on): brain/config/, brain/stories/,
#   brain/reference/jd-samples/. brain/identity/ is INTENTIONALLY kept (live data lives there).
PATH_VIOLATIONS=$(grep -rn -E "career-intelligence/match-tracker\.json|career-intelligence/pipeline\.json|brain/projects/job-search/|brain/scans/|brain/network/people" "$REPO_DIR/skills" "$REPO_DIR/scripts" 2>/dev/null || true)
if [ -z "$PATH_VIOLATIONS" ]; then
  echo "  → canonical paths: clean ✓"
  SUITE1B_STATUS="PASS"
else
  echo "  → canonical paths: VIOLATIONS ✗ (job-search→career-intelligence/projects/job-search/; people→network/people)"
  echo "$PATH_VIOLATIONS"
  exit $FAIL
fi
echo ""

# ── Suite 1c: bun unit tests (hard fail) ──────────────────────────────────────
echo "Suite 1c: bun unit tests..."
if bun test "$REPO_DIR/tests/" 2>&1; then
  echo "  → bun unit tests: PASS ✓"
  SUITE1C_STATUS="PASS"
else
  echo "  → bun unit tests: FAIL ✗  (hard fail — fix before shipping)"
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

# ── Suite 4: migration graph (hard fail) ──────────────────────────────────────
# A broken chain aborts init-repo.sh entirely, so every other hook silently
# stops running too. Two mislabelled scripts made every install between 0.73.5
# and 0.78.0 unupgradable and went unnoticed until a user reported the banner.
echo "Suite 4: migration graph..."
if bash "$REPO_DIR/tests/test_migration_chain.sh" 2>&1; then
  echo "  → migration graph: PASS ✓"
  SUITE4_STATUS="PASS"
else
  echo "  → migration graph: FAIL ✗  (hard fail — the upgrade path is broken)"
  exit $FAIL
fi
echo ""

echo "━━━ CI PASSED ━━━"
echo "  hooks:          $SUITE1_STATUS"
echo "  bun unit tests: $SUITE1C_STATUS"
echo "  outreach-dedup: $SUITE2_STATUS"
echo "  mission-control: $SUITE3_STATUS"
echo "  migration graph: $SUITE4_STATUS"
exit $PASS
