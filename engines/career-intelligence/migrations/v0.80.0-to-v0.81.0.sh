#!/usr/bin/env bash
# Migration v0.80.0 -> v0.81.0
# XOS-215: atomic ledger appends. No data migration — existing ledgers stay
# valid, the entry format is byte-identical, and only the write path changed.
# Version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"

# Clear any append lock left behind by a pre-0.81.0 process. Harmless if absent;
# without this a stale directory from before stale-breaking existed would tax
# every append until it aged out.
rm -rf "$STATE_DIR"/.ledger-rotate.*.lock.append.dir 2>/dev/null || true

echo "0.81.0" > "$STATE_DIR/version"
echo "[v0.80.0-to-v0.81.0] complete (atomic ledger appends)." >&2
exit 0
