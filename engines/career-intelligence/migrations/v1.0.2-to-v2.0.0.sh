#!/usr/bin/env bash
# Migration v1.0.2 -> v2.0.0 — verify workspace-relative data; no relocation.
# One successor per version. Idempotent; runtime state stays plugin-owned.
set -euo pipefail

WORKSPACE_ROOT="${1:-$PWD}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"

if [ ! -d "$WORKSPACE_ROOT/career-intelligence/projects/job-search" ]; then
  echo "ERROR: missing $WORKSPACE_ROOT/career-intelligence/projects/job-search/. Fix: run from your workspace root or restore career-intelligence/projects/job-search/ there before upgrading." >&2
  exit 1
fi
if [ -n "${CAREER_HOME:-}" ] || [ -n "${CAREER_OS_HOME:-}" ]; then
  echo "WARNING: CAREER_HOME / CAREER_OS_HOME are ignored by the scanner; remove these legacy settings and run at workspace root." >&2
fi
mkdir -p "$STATE_DIR"
echo "2.0.0" > "$STATE_DIR/version"
echo "[v1.0.2-to-v2.0.0] complete — paths verified; no data moved; version stamped 2.0.0." >&2
exit 0
