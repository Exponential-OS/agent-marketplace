#!/usr/bin/env bash
# Migration v0.76.0 -> v0.77.0
# XOS-93: advisory profile-brand alignment scoring. No data migration; version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.77.0" > "$STATE_DIR/version"
echo "[v0.76.0-to-v0.77.0] complete (profile-brand alignment scoring)." >&2
exit 0
