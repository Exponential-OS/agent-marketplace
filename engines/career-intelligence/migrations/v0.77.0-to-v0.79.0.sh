#!/usr/bin/env bash
# Migration v0.77.0 -> v0.79.0
# XOS-100: advisory audience preview before publishing. No data migration; version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.79.0" > "$STATE_DIR/version"
echo "[v0.77.0-to-v0.79.0] complete (audience preview)." >&2
exit 0
