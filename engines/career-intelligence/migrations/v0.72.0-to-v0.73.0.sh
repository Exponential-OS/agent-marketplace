#!/usr/bin/env bash
# Migration v0.72.0 → v0.73.0
# XOS-39: workspace-binding primitive. The per-script is_career_os_workspace() cwd-guard
# (duplicated across init-repo.sh / capture-prompt.sh / capture-response.sh, forgotten in
# one in v0.66) is replaced by a single shared hooks/scripts/_workspace-gate.sh, sourced by
# every mutating hook and driven by a `workspace_binding` field in plugin.json. A CI audit
# (tests/test_workspace_gate.py) fails the build if any mutating hook skips the gate.
# No data migration — version stamp only.
set -euo pipefail
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"; mkdir -p "$STATE_DIR"
echo "0.73.0" > "$STATE_DIR/version"
echo "[v0.72.0-to-v0.73.0] complete (workspace-binding gate primitive)." >&2
exit 0
