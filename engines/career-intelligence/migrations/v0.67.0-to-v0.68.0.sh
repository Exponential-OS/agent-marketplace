#!/usr/bin/env bash
# Migration v0.67.0 → v0.68.0
#
# v0.68.0 session-logger improvements:
#   - Stop-payload parser now reads transcript_path (JSONL) — response captures
#     were silently failing since Claude Code's Stop payload stopped carrying
#     inline response text (zero response commits all day, verified 2026-06-04)
#   - co-dialectic/ added to HOOK_PATHS (brain-kernel codi state auto-committed)
#   - Commit messages carry file count + path preview
#   - [DEBUG] forensic line logged per hook fire
#   - Skip commit+push when HOOK_PATHS has no changes (no empty commits)
#   - Zombie v0.29.0 career-os-plugin removed from workspace .claude/skills/
#     (was a duplicate hook source causing double-fires + index sweeps)
#
# No schema changes. Idempotent version-stamp only.
#
# Usage: bash migrations/v0.67.0-to-v0.68.0.sh <workspace_dir>
# Exit codes: 0 = success, 1 = error

set -euo pipefail

WORKSPACE_DIR="${1:-$(pwd)}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
VERSION_FILE="$STATE_DIR/version"

mkdir -p "$STATE_DIR"
echo "0.68.0" > "$VERSION_FILE"
echo "[v0.67.0-to-v0.68.0] v0.67.0 → v0.68.0 complete (session-logger improvements)." >&2
exit 0
