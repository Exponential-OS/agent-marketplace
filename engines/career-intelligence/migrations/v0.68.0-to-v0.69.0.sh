#!/usr/bin/env bash
# Migration v0.68.0 → v0.69.0
#
# v0.69.0: init-repo.sh SessionStart commit is now SCOPED (git commit -- <paths>)
#   — back-ports the v0.66 sister-script isolation fix to the third sister, so a
#   concurrent agent's staged work is never swept into the session-start commit
#   (XOS-28). Also: test-hooks harness repaired to honor the v0.67 workspace-
#   identity gate (XOS-33) — restores the CI safety net red+bypassed since v0.67.
#
# No schema changes. Idempotent version-stamp only.
#
# Usage: bash migrations/v0.68.0-to-v0.69.0.sh <workspace_dir>
# Exit codes: 0 = success, 1 = error

set -euo pipefail

WORKSPACE_DIR="${1:-$(pwd)}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
VERSION_FILE="$STATE_DIR/version"

mkdir -p "$STATE_DIR"
echo "0.69.0" > "$VERSION_FILE"
echo "[v0.68.0-to-v0.69.0] v0.68.0 → v0.69.0 complete (init-repo scoped commit + CI harness repair)." >&2
exit 0
