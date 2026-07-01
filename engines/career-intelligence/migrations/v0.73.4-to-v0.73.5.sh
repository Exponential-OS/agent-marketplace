#!/usr/bin/env bash
set -euo pipefail

# XOS-102 content-to-DM attribution tracker. No data migration; version stamp only.
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
mkdir -p "$STATE_DIR"
echo "0.73.5" > "$STATE_DIR/version"
