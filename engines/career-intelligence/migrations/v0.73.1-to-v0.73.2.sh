#!/usr/bin/env bash
# Migration v0.73.1 → v0.73.2
# XOS-61: SessionStart hooks silent on the success path (init-repo "Session logging
# active" → log file; audit-people-schema prints only when actionable). No data
# migration — version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.73.2" > "$STATE_DIR/version"
echo "[v0.73.1-to-v0.73.2] complete (SessionStart success-path silence)." >&2
exit 0
