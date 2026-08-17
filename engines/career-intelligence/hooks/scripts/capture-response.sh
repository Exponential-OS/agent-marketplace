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
#
# v0.68.0 (2026-06-04): Stop-payload parser reads transcript_path (Claude Code
#   Stop payload no longer carries response text — pre-fix cost: ZERO response
#   captures, verified 2026-06-04: 30 prompt commits / 0 response commits);
#   co-dialectic/ added to HOOK_PATHS; commit messages carry file count +
#   path preview; [DEBUG] forensic line per fire; skip commit+push when no
#   HOOK_PATHS changes.

set -euo pipefail

PAYLOAD=$(cat)

RESPONSE_TEXT=$(echo "$PAYLOAD" | python3 -c "
import sys, json, os, glob

def last_assistant_text(path):
    # Parse a Claude Code session transcript (JSONL) and return the text of
    # the last main-chain assistant message. Sidechain (subagent) entries are
    # skipped — they are not the response the user saw.
    try:
        with open(path) as f:
            lines = f.readlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get('isSidechain'):
            continue
        if obj.get('type') == 'assistant' or obj.get('role') == 'assistant':
            msg = obj.get('message', obj)
            content = msg.get('content', [])
            if isinstance(content, list):
                text = '\n'.join(c.get('text', '') for c in content
                                 if isinstance(c, dict) and c.get('type') == 'text')
            else:
                text = str(content)
            if text.strip():
                return text
    return None

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

# 1. Direct text keys (legacy payload shapes / future-proofing)
for key in ('response', 'content'):
    if data.get(key) and str(data[key]).strip() and str(data[key]) != 'null':
        print(str(data[key])); sys.exit(0)
if isinstance(data.get('message'), dict) and data['message'].get('content'):
    print(str(data['message']['content'])); sys.exit(0)

# 2. Current Claude Code Stop payload: {stop_hook_active, session_id,
#    transcript_path, hook_event_name, ...} — response text lives in the
#    session transcript, not the payload. (v0.68.0 fix: pre-fix cost was
#    ZERO response captures — verified 2026-06-04, 30 prompt commits / 0
#    response commits across the full day.)
transcript_path = data.get('transcript_path') or data.get('session_transcript_path')
if not transcript_path and data.get('session_id'):
    matches = glob.glob(os.path.expanduser('~') +
                        '/.claude/projects/*/' + data['session_id'] + '.jsonl')
    if matches:
        transcript_path = matches[0]
if transcript_path and os.path.exists(transcript_path):
    text = last_assistant_text(transcript_path)
    if text:
        print(text); sys.exit(0)
sys.exit(1)
" 2>/dev/null || true)
# || true neutralizes set -o pipefail+errexit when the python parser exits 1
# (no assistant text found). Without it, set -e fires on the assignment and
# the script exits BEFORE the empty-RESPONSE_TEXT handler below runs.
# History: 2026-04-27 added || true; 2026-06-04 (v0.68.0) added the
# transcript_path parser because the Stop payload itself stopped carrying
# response text — the || true kept the failure silent for weeks.

if [ -z "$RESPONSE_TEXT" ]; then
    exit 0
fi

WORKSPACE_ROOT="$(pwd)"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
MAIN_BRANCH="main"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# WORKSPACE-IDENTITY GATE (v0.66.0)
# ─────────────────────────────────────────────────────────────────────────────
# Refuse to write ledger / commit / push if this cwd is not a Career Intelligence
# workspace. See capture-prompt.sh for full detection logic.

# WORKSPACE-BINDING GATE (XOS-39): single shared, manifest-driven gate. Sourcing it
# exit-0's HERE (silent no-op) when cwd is not a bound Career Intelligence workspace — never write
# ledger / commit / push outside it. Replaces the per-script is_career_os_workspace() copy.
source "$SCRIPT_DIR/_workspace-gate.sh"
source "$SCRIPT_DIR/_git-sync-push.sh"
source "$SCRIPT_DIR/_ledger-path.sh"

cd "$WORKSPACE_ROOT"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%H:%M:%S)
LEDGER_DIR="$WORKSPACE_ROOT/brain/sessions/ledger"

mkdir -p "$LEDGER_DIR"
LEDGER_FILE="$(resolve_active_ledger "$LEDGER_DIR" "$TODAY")"

# XOS-215: this was a brace group of six echoes through one >> redirect. Each
# write is atomic on its own, but nothing held the six together, so a concurrent
# writer (capture-prompt in the same turn, or another session in this workspace)
# could interleave mid-entry. ledger_append takes the SAME lock the shard
# resolver uses and emits the entry in one write. Fails open.
# shellcheck source=./_ledger-append.sh
. "$SCRIPT_DIR/_ledger-append.sh"
ledger_append "$LEDGER_FILE" "$TIMESTAMP — Claude" "$RESPONSE_TEXT"

# v0.29.0: invoke LLM judge for risk classification.
# Advisory only — failures are logged but never block session capture.
LOG_FILE="$STATE_DIR/git-errors.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Gate matches isXos98TelemetryEnabled (src/telemetry/events.ts): only 1|true|yes|on.
# XOS_98_TELEMETRY=0/false/off (or unset) → OFF: no Bun spawn, no git-errors.log noise.
case "$(printf '%s' "${XOS_98_TELEMETRY:-}" | tr '[:upper:]' '[:lower:]')" in 1|true|yes|on) XOS98_ON=1 ;; *) XOS98_ON= ;; esac
if [ -n "${XOS98_ON}" ] && command -v bun >/dev/null 2>&1; then
    bun "$PLUGIN_ROOT/src/telemetry/nsm.ts" session-stop '{}' >> "$LOG_FILE" 2>&1 \
        || echo "[$(date)] XOS-98 active_user_time emission failed" >> "$LOG_FILE"
fi

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
[ -d "co-dialectic" ] && HOOK_PATHS+=("co-dialectic")
[ -f "CLAUDE.md" ] && HOOK_PATHS+=("CLAUDE.md")
[ -f "NEXT_SESSION_HANDOFF.md" ] && HOOK_PATHS+=("NEXT_SESSION_HANDOFF.md")
[ -d "Resumes & Cover Letters" ] && HOOK_PATHS+=("Resumes & Cover Letters")
[ -d "WIP" ] && HOOK_PATHS+=("WIP")

if [ "${#HOOK_PATHS[@]}" -eq 0 ]; then
    exit 0
fi

# v0.68.0 debug trail: forensic line per fire so lost-commit mysteries are
# diagnoseable (branch + how much was staged before the hook touched anything).
PRE_HOOK_STAGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
echo "[DEBUG $(date)] hook=capture-response branch=$(git branch --show-current) pre_hook_staged=$PRE_HOOK_STAGED hook_paths=${#HOOK_PATHS[@]}" >> "$LOG_FILE"

for p in "${HOOK_PATHS[@]}"; do
    git add -- "$p" 2>> "$LOG_FILE" || echo "[$(date)] git add -- \"$p\" failed" >> "$LOG_FILE"
done

# Commit-message file summary — scoped to HOOK_PATHS so the message matches
# what the partial commit actually contains (NOT the whole staged index).
STAGED_FILES_COUNT=$(git diff --cached --name-only -- "${HOOK_PATHS[@]}" | wc -l | tr -d ' ')
STAGED_FILES_PREVIEW=$(git diff --cached --name-only -- "${HOOK_PATHS[@]}" | head -3 | tr '\n' ',' | sed 's/,$//' | cut -c1-80)

if [ "$STAGED_FILES_COUNT" -eq 0 ]; then
    # Nothing the hook owns changed — skip commit AND push (no empty commits,
    # no error-log noise from git commit failing on an empty set).
    exit 0
fi

git commit -q -m "session-log: response $TODAY $TIMESTAMP — $STAGED_FILES_COUNT files ($STAGED_FILES_PREVIEW)" -- "${HOOK_PATHS[@]}" \
    2>> "$LOG_FILE" || echo "[$(date)] git commit (response) failed" >> "$LOG_FILE"

# Serial push (Fix 4: blocking push replaces fire-and-forget background push)
if git remote get-url origin &>/dev/null; then
    git_sync_push "$WORKSPACE_ROOT" "$MAIN_BRANCH" "$LOG_FILE" || echo "[$(date)] git push failed" >> "$LOG_FILE"
fi
