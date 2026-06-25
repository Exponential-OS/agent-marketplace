#!/usr/bin/env bash
# Migration v0.73.2 → v0.73.3
# XOS-64: session-logger push resilient to non-fast-forward (shared git_sync_push
# helper + ledger merge=union scaffold). No data migration — version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.73.3" > "$STATE_DIR/version"
echo "[v0.73.2-to-v0.73.3] complete (resilient push + ledger union-merge)." >&2
exit 0
