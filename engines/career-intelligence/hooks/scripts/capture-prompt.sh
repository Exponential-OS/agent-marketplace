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
#
# v0.66.0 (2026-05-18): WORKSPACE-IDENTITY GATE + SCOPED COMMIT
#   Two interlocking bugs caused cross-repo pollution (2026-05-17 incident):
#     1. wrong-cwd execution — the hook fired in non-Career-OS repos (e.g.
#        ~/aiprojects/agent-marketplace) and wrote ledger files + git commit +
#        push there, polluting unrelated repos with workspace ledger files.
#     2. index sweep — the hook used `git commit -m ...` without path filter,
#        so it committed the ENTIRE staged index — sweeping up any other
#        session's staged work into a "session-log:" commit.
#   Fix:
#     1. Workspace-identity gate at the top — exit silently if cwd is not a
#        Career OS workspace (no brain/identity/ AND no $CAREER_HOME match).
#     2. Scoped commit using `git commit -- <paths>` so only the files the
#        hook itself staged get committed, regardless of other agents'
#        staged work in the same index.
#
# v0.68.0 (2026-06-04): co-dialectic/ added to HOOK_PATHS (brain-kernel codi
#   state migrated into the workspace 2026-05/06 — quiets unit-of-work noise);
#   commit messages carry file count + path preview; [DEBUG] forensic line per
#   fire; skip commit+push when no HOOK_PATHS changes (no empty commits).
#   NOTE (lost-commit postmortem 2026-06-04): the "lost status: Mercury commit"
#   was NOT this script — a stale career-os v0.29.0 plugin copy in the
#   workspace's .claude/skills/ became a live second hook source when Claude
#   Code ~2.1.15x started loading skills-directory plugins; its UNSCOPED
#   `git commit` swept the agent's staged files. Zombie deleted 2026-06-04.
#   Full forensics: WIP/xHumanOS-platform/career-intelligence-product/
#   spec-session-logger-improvements-2026-06-04.md

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

# ─────────────────────────────────────────────────────────────────────────────
# WORKSPACE-IDENTITY GATE (v0.66.0)
# ─────────────────────────────────────────────────────────────────────────────
# Refuse to write ledger / commit / push if this cwd is not a Career OS
# workspace. Detection (any one is sufficient):
#   1. $CAREER_HOME env var is set and matches $WORKSPACE_ROOT
#   2. cwd contains brain/identity/ directory (workspace marker)
#   3. cwd contains .career-os-workspace sentinel file (explicit opt-in)
# If none match → exit silently with {"decision":"approve"}. The hook MUST
# never write to or commit in a non-Career-OS repo.

is_career_os_workspace() {
    # Check 1: $CAREER_HOME env var match
    if [ -n "${CAREER_HOME:-}" ] && [ "$CAREER_HOME" = "$WORKSPACE_ROOT" ]; then
        return 0
    fi
    # Check 2: brain/identity/ marker (durable workspace signature)
    if [ -d "$WORKSPACE_ROOT/brain/identity" ]; then
        return 0
    fi
    # Check 3: explicit sentinel file
    if [ -f "$WORKSPACE_ROOT/.career-os-workspace" ]; then
        return 0
    fi
    return 1
}

if ! is_career_os_workspace; then
    # Silent no-op — this is NOT a Career OS workspace. Never log here.
    echo '{"decision": "approve"}'
    exit 0
fi

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

# ─────────────────────────────────────────────────────────────────────────────
# SCOPED COMMIT (v0.66.0)
# ─────────────────────────────────────────────────────────────────────────────
# Use `git commit -- <paths>` to commit ONLY the paths the hook itself owns.
# This prevents the hook from sweeping up other agents' staged work in the
# index (2026-05-17 incident: marketplace.json + engines/co-dialectic/* were
# accidentally committed under a "session-log:" message because they were
# staged but not by this hook).
LOG_FILE="$STATE_DIR/git-errors.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Build the list of paths the hook is allowed to commit. Skip ones that don't
# exist on disk — `git commit -- path` errors on non-existent path.
HOOK_PATHS=()
[ -d "brain/sessions" ] && HOOK_PATHS+=("brain/sessions")
[ -d "co-dialectic" ] && HOOK_PATHS+=("co-dialectic")
[ -f "CLAUDE.md" ] && HOOK_PATHS+=("CLAUDE.md")
[ -f "NEXT_SESSION_HANDOFF.md" ] && HOOK_PATHS+=("NEXT_SESSION_HANDOFF.md")
[ -d "Resumes & Cover Letters" ] && HOOK_PATHS+=("Resumes & Cover Letters")
[ -d "WIP" ] && HOOK_PATHS+=("WIP")

if [ "${#HOOK_PATHS[@]}" -eq 0 ]; then
    # Nothing to commit
    echo '{"decision": "approve"}'
    exit 0
fi

# v0.68.0 debug trail: forensic line per fire so lost-commit mysteries are
# diagnoseable (branch + how much was staged before the hook touched anything).
PRE_HOOK_STAGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
echo "[DEBUG $(date)] hook=capture-prompt branch=$(git branch --show-current) pre_hook_staged=$PRE_HOOK_STAGED hook_paths=${#HOOK_PATHS[@]}" >> "$LOG_FILE"

# Stage ONLY the hook's paths (use --update to skip untracked-but-not-existing
# items, but we want new files too — so use plain add).
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
    echo '{"decision": "approve"}'
    exit 0
fi

# Commit ONLY those paths. The `-- <paths>` arg makes git commit ignore any
# OTHER staged paths in the index. This is the key isolation fix.
git commit -q -m "session-log: prompt $TODAY $TIMESTAMP — $STAGED_FILES_COUNT files ($STAGED_FILES_PREVIEW)" -- "${HOOK_PATHS[@]}" \
    2>> "$LOG_FILE" || echo "[$(date)] git commit (prompt) failed" >> "$LOG_FILE"

# WO-046: Push prompt commits to remote (eliminates push asymmetry between prompt/response hooks)
if git remote get-url origin &>/dev/null; then
    git push -q origin "$MAIN_BRANCH" 2>> "$LOG_FILE" || echo "[$(date)] git push (prompt) failed" >> "$LOG_FILE"
fi

echo '{"decision": "approve"}'
