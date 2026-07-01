#!/usr/bin/env bash
set -euo pipefail

# XOS-101 conversation→post-worthy prompt. No data migration; version stamp only.
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
mkdir -p "$STATE_DIR"
echo "0.73.6" > "$STATE_DIR/version"
