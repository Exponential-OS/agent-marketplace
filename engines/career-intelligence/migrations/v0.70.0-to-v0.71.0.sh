#!/usr/bin/env bash
# Migration v0.70.0 → v0.71.0
# XOS-34/XOS-35: claim-grounding gate + off-rubric risk scan (shipped by a parallel
# thread without its migration script — backfilled here under XOS-32 to close the
# P9 chain gap that left the coherence test red on main). No data migration — version
# stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.71.0" > "$STATE_DIR/version"
echo "[v0.70.0-to-v0.71.0] complete (claim-grounding gate + off-rubric risk scan; chain backfill)." >&2
exit 0
