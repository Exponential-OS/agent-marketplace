#!/usr/bin/env bash
# Migration v1.0.0 -> v1.0.1 — version stamp only.
#
# 1.0.1 is a content-only release: shipped documentation, skill text and rule
# prose changed; no runtime data format, no state layout, no file moved. There
# is nothing in a v1.0.0 install to transform.
#
# This script exists because migrate.sh resolves an explicit chain and aborts
# with "No migration path found" when a hop is missing. That is what shipped in
# v1.0.1: the plugin version advanced past the newest migration target, so every
# existing install hit that abort. A stamp-only script is the hop. See XOS-359.
#
# One successor per version, deliberately: the retired 0.x chain broke because
# two mislabelled filenames gave one version two successors and the runner
# silently took the wrong branch.
#
# Idempotent: re-running only rewrites the same version string.

set -euo pipefail

WORKSPACE_ROOT="${1:-$PWD}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"

mkdir -p "$STATE_DIR"
echo "1.0.1" > "$STATE_DIR/version"
echo "[v1.0.0-to-v1.0.1] complete — no data changes; version stamped 1.0.1." >&2
exit 0
