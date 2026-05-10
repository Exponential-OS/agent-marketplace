#!/usr/bin/env bash
# capture-response.sh — Captures Claude's response to complete the exchange
#
# Called by Stop hook. Appends Claude's response to daily ledger,
# unified git commit on main.
#
# Both sides of the conversation are captured:
#   - capture-prompt.sh captures the user's prompts
#   - This script captures Claude's responses
#   - Together they form a replayable conversation ledger
#
# v0.29.0:
#   - ledger relocated to brain/sessions/ledger/; logs to $STATE_DIR
#   - LLM judge invoked after ledger append (advisory, non-blocking)

set -euo pipefail

PAYLOAD=$(cat)

RESPONSE_TEXT=$(echo "$PAYLOAD" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    text = None
    if 'response' in data:
        text = data['response']
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
# on Stop-hook payloads lacking response/message/content (real shape is
# {stop_hook_active, session_id, hook_event_name}). Without it, set -e fires
# on the assignment and the script exits BEFORE the empty-RESPONSE_TEXT
# handler below runs. Pre-fix cost: ZERO session-log:response commits ever
# landed (verified 2026-04-27 across full git history).

if [ -z "$RESPONSE_TEXT" ]; then
    exit 0
fi

WORKSPACE_ROOT="$(pwd)"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
MAIN_BRANCH="main"

cd "$WORKSPACE_ROOT"

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
    echo "## $TIMESTAMP — Claude"
    echo ""
    echo "$RESPONSE_TEXT"
    echo ""
    echo "---"
    echo ""
} >> "$LEDGER_FILE"

# v0.29.0: invoke LLM judge for risk classification.
# Advisory only — failures are logged but never block session capture.
LOG_FILE="$STATE_DIR/git-errors.log"
mkdir -p "$(dirname "$LOG_FILE")"

JUDGE_SCRIPT="$(dirname "$0")/judge-session.py"
if [ -f "$JUDGE_SCRIPT" ] && command -v python3 &>/dev/null; then
    echo "$RESPONSE_TEXT" | python3 "$JUDGE_SCRIPT" \
        --date "$TODAY" \
        --workspace "$WORKSPACE_ROOT" \
        2>> "$LOG_FILE" || true  # judge failures are non-blocking
fi

# Unified commit: brain/sessions/ + CLAUDE.md + handoff + output folder + WIP/
# Fix 2: error logging instead of || true. Fix 5: WIP/ added to scope.
git add brain/sessions/ 2>> "$LOG_FILE" || echo "[$(date)] git add brain/sessions/ failed" >> "$LOG_FILE"
git add CLAUDE.md 2>/dev/null || true
git add NEXT_SESSION_HANDOFF.md 2>/dev/null || true
git add "Resumes & Cover Letters/" 2>/dev/null || true
git add WIP/ 2>> "$LOG_FILE" || echo "[$(date)] git add WIP/ failed" >> "$LOG_FILE"
git commit -q -m "session-log: response $TODAY $TIMESTAMP" 2>> "$LOG_FILE" || echo "[$(date)] git commit (response) failed" >> "$LOG_FILE"

# Serial push (Fix 4: blocking push replaces fire-and-forget background push)
if git remote get-url origin &>/dev/null; then
    git push -q origin "$MAIN_BRANCH" 2>> "$LOG_FILE" || echo "[$(date)] git push failed" >> "$LOG_FILE"
fi
