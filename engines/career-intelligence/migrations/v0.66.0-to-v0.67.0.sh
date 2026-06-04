#!/usr/bin/env bash
# Migration v0.66.0 → v0.67.0
#
# v0.67.0: workspace-identity gate added to init-repo.sh (sweep-all fix from
# v0.66.0 — extends the same gate to the init script). No schema changes.
# Idempotent no-op migration; just stamps the new version.
#
# Usage: bash migrations/v0.66.0-to-v0.67.0.sh <workspace_dir>
# Exit codes: 0 = success, 1 = error

set -euo pipefail

WORKSPACE_DIR="${1:-$(pwd)}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
VERSION_FILE="$STATE_DIR/version"

mkdir -p "$STATE_DIR"
echo "0.67.0" > "$VERSION_FILE"
echo "[v0.66.0-to-v0.67.0] v0.66.0 → v0.67.0 complete (no schema changes)." >&2
exit 0
