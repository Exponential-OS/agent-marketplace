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
#
# v0.66.0 (2026-05-18): WORKSPACE-IDENTITY GATE + SCOPED COMMIT
#   See capture-prompt.sh header for full rationale. Same two bugs fixed here:
#     1. Wrong-cwd execution → workspace-identity gate prevents pollution
#     2. Index sweep → scoped `git commit -- <paths>` prevents sweeping up
#        other agents' staged work.

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

# ─────────────────────────────────────────────────────────────────────────────
# WORKSPACE-IDENTITY GATE (v0.66.0)
# ─────────────────────────────────────────────────────────────────────────────
# Refuse to write ledger / commit / push if this cwd is not a Career OS
# workspace. See capture-prompt.sh for full detection logic.

is_career_os_workspace() {
    if [ -n "${CAREER_HOME:-}" ] && [ "$CAREER_HOME" = "$WORKSPACE_ROOT" ]; then
        return 0
    fi
    if [ -d "$WORKSPACE_ROOT/brain/identity" ]; then
        return 0
    fi
    if [ -f "$WORKSPACE_ROOT/.career-os-workspace" ]; then
        return 0
    fi
    return 1
}

if ! is_career_os_workspace; then
    # Silent no-op — this is NOT a Career OS workspace. Never log here.
    exit 0
fi

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

# ─────────────────────────────────────────────────────────────────────────────
# SCOPED COMMIT (v0.66.0)
# ─────────────────────────────────────────────────────────────────────────────
# Use `git commit -- <paths>` so only the paths the hook owns get committed,
# regardless of what's in the staged index.
HOOK_PATHS=()
[ -d "brain/sessions" ] && HOOK_PATHS+=("brain/sessions")
[ -f "CLAUDE.md" ] && HOOK_PATHS+=("CLAUDE.md")
[ -f "NEXT_SESSION_HANDOFF.md" ] && HOOK_PATHS+=("NEXT_SESSION_HANDOFF.md")
[ -d "Resumes & Cover Letters" ] && HOOK_PATHS+=("Resumes & Cover Letters")
[ -d "WIP" ] && HOOK_PATHS+=("WIP")

if [ "${#HOOK_PATHS[@]}" -eq 0 ]; then
    exit 0
fi

for p in "${HOOK_PATHS[@]}"; do
    git add -- "$p" 2>> "$LOG_FILE" || echo "[$(date)] git add -- \"$p\" failed" >> "$LOG_FILE"
done

git commit -q -m "session-log: response $TODAY $TIMESTAMP" -- "${HOOK_PATHS[@]}" \
    2>> "$LOG_FILE" || echo "[$(date)] git commit (response) failed" >> "$LOG_FILE"

# Serial push (Fix 4: blocking push replaces fire-and-forget background push)
if git remote get-url origin &>/dev/null; then
    git push -q origin "$MAIN_BRANCH" 2>> "$LOG_FILE" || echo "[$(date)] git push failed" >> "$LOG_FILE"
fi
