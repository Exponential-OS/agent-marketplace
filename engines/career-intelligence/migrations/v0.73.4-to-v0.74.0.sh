#!/usr/bin/env bash
set -euo pipefail

# XOS-133 local beta metrics dashboard. No data migration; version stamp only.
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
mkdir -p "$STATE_DIR"
echo "0.74.0" > "$STATE_DIR/version"
