#!/usr/bin/env bash
# Migration v0.75.0 -> v0.76.0
# XOS-87: fail-closed milestone-to-brand prompts. No data migration; version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.76.0" > "$STATE_DIR/version"
echo "[v0.75.0-to-v0.76.0] complete (fail-closed milestone-to-brand prompts)." >&2
exit 0
