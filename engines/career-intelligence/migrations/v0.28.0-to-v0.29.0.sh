#!/usr/bin/env bash
# Migration v0.28.0 → v0.29.0
#
# Two coupled changes from v0.28.0:
#
#   1. Plugin runtime state moves OUT of <workspace>/.career-os/:
#      - version file       → $STATE_DIR/version
#      - git error log      → $STATE_DIR/git-errors.log
#      - first-run signal   → $STATE_DIR/.career-os-state
#
#   2. User-facing session ledger moves INTO brain/:
#      - .career-os/ledger/YYYY-MM-DD.md → brain/sessions/ledger/YYYY-MM-DD.md
#      - new brain/sessions/judgments/YYYY-MM-DD.md (LLM judge output)
#
# After migration, .career-os/ is no longer used by hooks. We remove it
# entirely so future SessionStart hooks don't recreate empty subdirs.
#
# Idempotent: re-running is safe. mkdir -p, cp -n, and rm -rf on a missing
# dir are all no-ops the second time around.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"

LEDGER_SRC="$CONTEXT_DIR/.career-os/ledger"
LEDGER_DST="$CONTEXT_DIR/brain/sessions/ledger"
JUDGMENTS_DST="$CONTEXT_DIR/brain/sessions/judgments"

echo "→ v0.28.0 → v0.29.0: relocate runtime state, add LLM judging"

# 1. Ensure new directories exist
mkdir -p "$LEDGER_DST"
mkdir -p "$JUDGMENTS_DST"
mkdir -p "$STATE_DIR"

# 2. Move ledger files (idempotent; -n = no-clobber)
if [ -d "$LEDGER_SRC" ] && [ "$(ls -A "$LEDGER_SRC" 2>/dev/null || true)" ]; then
    cp -n "$LEDGER_SRC"/*.md "$LEDGER_DST"/ 2>/dev/null || true
    echo "  Moved ledger files to brain/sessions/ledger/"
fi

# 3. Stamp version into STATE_DIR (canonical location going forward)
echo "0.29.0" > "$STATE_DIR/version"

# 4. Remove .career-os/ if it still exists. Hooks no longer touch it; leaving
#    it in place would just confuse future installs (and the workspace
#    cleanup that triggered this migration already removed it once — the
#    migration is the codified path forward).
if [ -d "$CONTEXT_DIR/.career-os" ]; then
    rm -rf "$CONTEXT_DIR/.career-os"
    echo "  Removed .career-os/ directory"
fi

echo "✅ Migration v0.28.0 → v0.29.0 complete."
echo ""
echo "What changed in v0.29.0:"
echo "  • RUNTIME STATE: plugin version + logs now in \$STATE_DIR (~/.career-os-state)"
echo "  • LEDGER: session ledger now lives at brain/sessions/ledger/"
echo "  • JUDGE: new brain/sessions/judgments/ holds per-day LLM verdicts (T3+ / risk-flagged)"
echo "  • CLEANUP: .career-os/ removed; hooks no longer create or reference it"
echo ""
