#!/usr/bin/env bash
# Migration v0.74.0 -> v0.75.0
# XOS-88: brand inbound pipeline tracker. No data migration; version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.75.0" > "$STATE_DIR/version"
echo "[v0.74.0-to-v0.75.0] complete (brand inbound pipeline tracker)." >&2
exit 0
