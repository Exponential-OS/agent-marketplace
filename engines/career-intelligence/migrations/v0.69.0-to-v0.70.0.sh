#!/usr/bin/env bash
# Migration v0.69.0 → v0.70.0
# XOS-26: flat-path sweep completion. Unified all skill/script references onto the
# canonical job-search data location career-intelligence/projects/job-search/
# {job-pipeline.json, job-pipeline-match-tracker.json} — where the live data already
# sits (zero data migration). Fixes C-1 (scorer wrote a phantom flat path → scores
# invisible), H-1 (legacy brain/ readers), M-1 (apply-tracker dual-write). Plus the
# flags-gate FAIL-HARD safety fix (H-3). No data migration — version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.70.0" > "$STATE_DIR/version"
echo "[v0.69.0-to-v0.70.0] complete (flat-path sweep + flags-gate safety)." >&2
exit 0
