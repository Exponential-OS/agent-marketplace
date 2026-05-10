#!/usr/bin/env bash
# capture-prompt.sh — Atomic prompt capture for Career OS
#
# Called by UserPromptSubmit hook. Captures user's prompt verbatim,
# appends to daily ledger, unified git commit on main.
#
# Both sides of the conversation are captured:
#   - This script captures the user's prompts
#   - capture-response.sh captures Claude's responses
#   - Together they form a replayable conversation ledger
#
# Architectural principles applied:
#   P2: No fallback code paths — bad input exits cleanly, no error-handling bloat
#   P3: Ride Platform Abstractions — git as the persistence layer
#   P5: Defense in Depth — every exchange persisted immediately (survives crash)
#
# v0.29.0: ledger relocated to brain/sessions/ledger/; logs to $STATE_DIR.

set -euo pipefail

PAYLOAD=$(cat)

PROMPT_TEXT=$(echo "$PAYLOAD" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    text = None
    if 'prompt' in data:
        text = data['prompt']
    elif 'message' in data and 'content' in data['message']:
        text = data['message']['content']
    elif 'content' in data:
        text = data['content']
    if text and str(text).strip() and str(text) != 'null':
        print(str(text))
    else:
        sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null || true)
# || true neutralizes set -o pipefail+errexit when the python parser exits 1
# on payloads lacking prompt/message/content. Without it, set -e fires on the
# assignment and the script exits BEFORE the empty-PROMPT_TEXT handler below
# runs. Sister fix to capture-response.sh (same class). 2026-04-27.

if [ -z "$PROMPT_TEXT" ]; then
    echo '{"decision": "approve"}'
    exit 0
fi

WORKSPACE_ROOT="$(pwd)"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
MAIN_BRANCH="main"

cd "$WORKSPACE_ROOT"

# Ledger uses calendar date (searchable across marathon sessions)
TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%H:%M:%S)
LEDGER_DIR="$WORKSPACE_ROOT/brain/sessions/ledger"
LEDGER_FILE="$LEDGER_DIR/$TODAY.md"

mkdir -p "$LEDGER_DIR"

if [ ! -f "$LEDGER_FILE" ]; then
    echo "# Session Ledger — $TODAY" > "$LEDGER_FILE"
    echo "" >> "$LEDGER_FILE"
fi

{
    echo "## $TIMESTAMP — User"
    echo ""
    echo "$PROMPT_TEXT"
    echo ""
    echo "---"
    echo ""
} >> "$LEDGER_FILE"

# Unified commit: brain/sessions/ + CLAUDE.md + handoff + output folder + WIP/
# Fix 2: error logging instead of || true. Fix 5: WIP/ added to scope.
LOG_FILE="$STATE_DIR/git-errors.log"
mkdir -p "$(dirname "$LOG_FILE")"
git add brain/sessions/ 2>> "$LOG_FILE" || echo "[$(date)] git add brain/sessions/ failed" >> "$LOG_FILE"
git add CLAUDE.md 2>/dev/null || true
git add NEXT_SESSION_HANDOFF.md 2>/dev/null || true
git add "Resumes & Cover Letters/" 2>/dev/null || true
git add WIP/ 2>> "$LOG_FILE" || echo "[$(date)] git add WIP/ failed" >> "$LOG_FILE"
git commit -q -m "session-log: prompt $TODAY $TIMESTAMP" 2>> "$LOG_FILE" || echo "[$(date)] git commit (prompt) failed" >> "$LOG_FILE"

# WO-046: Push prompt commits to remote (eliminates push asymmetry between prompt/response hooks)
if git remote get-url origin &>/dev/null; then
    git push -q origin "$MAIN_BRANCH" 2>> "$LOG_FILE" || echo "[$(date)] git push (prompt) failed" >> "$LOG_FILE"
fi

echo '{"decision": "approve"}'
