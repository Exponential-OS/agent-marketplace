#!/usr/bin/env bash
set -euo pipefail

# XOS-89 weekly inbound insight card. No data migration; version stamp only.
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
mkdir -p "$STATE_DIR"
echo "0.73.7" > "$STATE_DIR/version"
