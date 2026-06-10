#!/usr/bin/env bash
# Migration v0.73.0 → v0.73.1
# XOS-31: schema registry rebuild (shared-structures.md → JSON shapes + real writers) + C1
# coherence test fix (markdown fixture at retired path → JSON at canonical path) +
# pipeline-query.py fallback path correction. No data migration — version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.73.1" > "$STATE_DIR/version"
echo "[v0.73.0-to-v0.73.1] complete (schema registry + coherence test fix)." >&2
exit 0
