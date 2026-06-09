#!/usr/bin/env bash
# Migration v0.71.0 → v0.72.0
# XOS-29 pt2: warm-contact-outreach-dedup gate made format-aware — it globbed *.md only
# while live people files are 100% .json, so it found zero candidates and silently never
# blocked (double-outreach guard defeated). Plus XOS-32 doc hygiene (dead career-os-plugin
# install slug → career-intelligence@xos; job-search routing repo-relative; description
# version sync) and the v0.70→0.71 migration chain backfill. No data migration — version
# stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.72.0" > "$STATE_DIR/version"
echo "[v0.71.0-to-v0.72.0] complete (dedup gate JSON-aware + doc hygiene)." >&2
exit 0
