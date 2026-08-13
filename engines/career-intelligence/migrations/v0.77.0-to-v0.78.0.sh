#!/usr/bin/env bash
# Migration v0.77.0 -> v0.78.0
# XOS-96: onboarding identity-file bootstrap. No data migration; version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.78.0" > "$STATE_DIR/version"
echo "[v0.77.0-to-v0.78.0] complete (identity file bootstrap)." >&2
exit 0
