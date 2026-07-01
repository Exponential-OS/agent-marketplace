#!/usr/bin/env bash
set -euo pipefail

# XOS-90 unified career + brand health dashboard. No data migration; version stamp only.
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
mkdir -p "$STATE_DIR"
echo "0.73.9" > "$STATE_DIR/version"
