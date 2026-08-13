#!/usr/bin/env bash
# Migration v0.79.0 -> v0.80.0
# XOS-211: session-ledger day-file rotation. No data migration; version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.80.0" > "$STATE_DIR/version"
echo "[v0.79.0-to-v0.80.0] complete (ledger rotation)." >&2
exit 0
