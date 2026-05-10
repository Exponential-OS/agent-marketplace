#!/usr/bin/env bash
# ci-local.sh — Local CI runner for the Career OS plugin (v0.24.0+ file-only).
#
# Substrate rollback 2026-04-26 retired the Dolt + migrate + pytest loop.
# This runner is now pytest-only — no Docker, no migration step, no DB.
#
# Usage (from plugin repo root):
#   bash dev/ci-local.sh                  # run all non-archived tests
#   bash dev/ci-local.sh --hooks          # also run shell hook smoke tests
#   bash dev/ci-local.sh --help
#
# Archived (Dolt-era) runner: migrations/_archive/ci-local-dolt-2026-04-25.sh
#
# Exit codes:
#   0 all green · 1 test failure · 2 bad flags

set -uo pipefail

RUN_HOOKS=0

while (( $# )); do
  case "$1" in
    --hooks) RUN_HOOKS=1 ;;
    --help|-h)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $1" >&2
      exit 2
      ;;
  esac
  shift
done

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PLUGIN_ROOT"

PYTHON="${PYTHON:-python3}"

echo "━━━ Career-OS local CI (v0.24.0+ file-only) ━━━"
echo "Plugin root: $PLUGIN_ROOT"
echo "Python:      $($PYTHON --version 2>&1)"
echo

# Shell hook smoke tests (always run — no Python deps).
ANY_RAN=0
if [[ -x tests/test-hooks.sh ]]; then
  echo "▶ tests/test-hooks.sh"
  if ! bash tests/test-hooks.sh; then
    echo "FAIL: test-hooks.sh" >&2
    exit 1
  fi
  ANY_RAN=1
fi
if [[ -x tests/test-mission-control.sh ]]; then
  echo "▶ tests/test-mission-control.sh"
  if ! bash tests/test-mission-control.sh; then
    echo "FAIL: test-mission-control.sh" >&2
    exit 1
  fi
  ANY_RAN=1
fi

# Pytest — only if pytest is installed AND active test files exist.
# v0.24.0 archived the Dolt-era tests; until file-only tests land, pytest
# step is opportunistic.
ACTIVE_PY_TESTS=$(find tests -maxdepth 2 -name "test_*.py" -not -path "*/_archive/*" 2>/dev/null | wc -l | tr -d ' ')
if (( ACTIVE_PY_TESTS > 0 )); then
  if "$PYTHON" -c "import pytest" 2>/dev/null; then
    echo
    echo "▶ pytest (excluding tests/_archive/)"
    if ! "$PYTHON" -m pytest tests/ --ignore=tests/_archive -q; then
      echo "FAIL: pytest" >&2
      exit 1
    fi
    ANY_RAN=1
  else
    echo "skip: pytest not installed in $($PYTHON --version 2>&1)"
  fi
else
  echo "skip: no active python tests (only archived Dolt-era — see tests/_archive/)"
fi

echo
if (( ANY_RAN == 1 )); then
  echo "✅ all green"
else
  echo "⚠️  no tests ran — file-only test suite is v0.25.0 backlog"
fi
exit 0
