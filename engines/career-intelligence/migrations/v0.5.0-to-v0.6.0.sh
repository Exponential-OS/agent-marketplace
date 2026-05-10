#!/usr/bin/env bash
# Migration: v0.5.0 → v0.6.0
# Description: Flag organize skill for first run.
# New in v0.6.0: organize skill, migration test coverage, P6/P9 fixes.
# This script is idempotent — safe to run multiple times.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"

# Flag that organize skill should be offered on next dashboard load.
# Mission-control reads this flag and prompts the user.
# The organize skill deletes this flag after completing.
if [ ! -f "$CONTEXT_DIR/.career-os/memory/stories/STORY_INDEX.md" ]; then
    echo "organize" > "$CONTEXT_DIR/.career-os/config/pending-organize"
fi

echo "0.6.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.5.0 → v0.6.0 complete"
