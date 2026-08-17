#!/usr/bin/env bash
# Migration v0.0.0 -> v1.0.0 — the 1.0 baseline.
#
# 1.0 is a clean cut. The 0.x per-release migration scripts are gone; this one
# script takes ANY pre-1.0 install to the 1.0 baseline, and versions from here
# resume the ordinary v{from}-to-v{to}.sh chain.
#
# Why the 0.x chain was retired rather than repaired: 59 scripts, of which all
# but a handful did nothing but stamp a version number. The value was near zero
# and the failure surface was real — two mislabelled filenames gave a version
# two successors, the runner silently took the wrong branch, and every install
# between 0.73.5 and 0.78.0 became unupgradable. One edge into 1.0.0 cannot
# fork.
#
# THE ONE THING THIS STILL GUARDS. Pre-v0.29.0 installs kept runtime state in a
# `.career-os/` directory inside the workspace; v0.29.0 relocated it to
# $CLAUDE_PLUGIN_DATA. If that directory is still present, the workspace never
# made that move, and stamping 1.0.0 would claim a migration that never ran —
# exactly the false-current-version failure tests/test-hooks.sh [B3] exists to
# prevent. So: fail hard, say what to do, change nothing.
#
# Idempotent: re-running is safe. Check, then stamp.

set -euo pipefail

WORKSPACE_ROOT="${1:-$PWD}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"

if [ -d "$WORKSPACE_ROOT/.career-os" ]; then
  echo "[v0.0.0-to-v1.0.0] ERROR: pre-v0.29.0 workspace layout detected." >&2
  echo "  Found: $WORKSPACE_ROOT/.career-os/" >&2
  echo "" >&2
  echo "  Runtime state moved out of the workspace in v0.29.0. This install" >&2
  echo "  predates that move, so it cannot jump to the 1.0 baseline directly —" >&2
  echo "  stamping 1.0.0 would record a migration that never ran." >&2
  echo "" >&2
  echo "  Fix: move any data you still need out of .career-os/, remove the" >&2
  echo "  directory, then start a new session to re-run this migration." >&2
  echo "    - memory/, tasks/  -> superseded by brain/ and the GitHub issue" >&2
  echo "                          surface; copy anything you want to keep" >&2
  echo "    - config/version   -> superseded by \$CLAUDE_PLUGIN_DATA/version" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
echo "1.0.0" > "$STATE_DIR/version"
echo "[v0.0.0-to-v1.0.0] complete — Career Intelligence is at the 1.0 baseline." >&2
exit 0
