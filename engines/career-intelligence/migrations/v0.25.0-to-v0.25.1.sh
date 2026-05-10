#!/usr/bin/env bash
# Migration v0.25.0 → v0.25.1
#
# Patch: fix(hooks): `|| true` on python pipeline so `set -e` doesn't kill
# the PostToolUse hook handler before the empty-case branch can run.
#
# Symptom without the fix: a PostToolUse hook on a tool that returns no
# output would cause the shell to exit non-zero under `set -euo pipefail`,
# silently killing the hook process and logging nothing.
#
# No data transformations on the user's .career-os/ workspace — this is a
# version stamp only. Code-only fix; existing data structures unchanged.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.25.1" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.25.0 → v0.25.1 complete (hooks patch — no data changes)."
echo ""
echo "What changed in v0.25.1:"
echo "  • HOOKS FIX: PostToolUse python pipeline now uses '|| true' guard so"
echo "    set -e doesn't kill the hook before the empty-case handler runs."
echo "  • No changes to .career-os/ data layout or task substrate."
echo ""
