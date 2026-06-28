#!/usr/bin/env bash
# init-repo.sh — Session start initialization for Career OS
#
# Called by SessionStart hook. Handles:
#   0. VERSION CHECK + MIGRATION (P6) — runs BEFORE anything else
#   1. First-run detection and brain/sessions/ scaffolding
#   2. Ensure we're on main and write session start marker to ledger
#
# Direct-to-main: all commits go to main. No session branches.
# Git's built-in rebase/squash handles history compression.
#
# Architectural principles applied:
#   P2: No fallback code paths — git is required, no graceful degradation without it
#   P3: Ride Platform Abstractions — GitHub + Actions as infrastructure
#   P5: Defense in Depth — session markers persist state that survives crashes
#   P6: Zero-Data-Loss Upgrades — version check + migration chain runs first
#
# v0.29.0: All hook runtime state moved out of <workspace>/.career-os/.
#   - Plugin internal state (version, logs) → $STATE_DIR
#   - User-facing data (ledger) → <workspace>/brain/sessions/ledger/
#   - First-run detection keys off $STATE_DIR/version (not workspace artifacts)

set -euo pipefail

WORKSPACE_ROOT="$(pwd)"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"
MAIN_BRANCH="main"
LOG_FILE="$STATE_DIR/git-errors.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

mkdir -p "$STATE_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# WORKSPACE-IDENTITY GATE (v0.67.0)
# ─────────────────────────────────────────────────────────────────────────────
# career-intelligence@xos is installed at USER scope, so SessionStart fires in
# WHATEVER cwd Claude Code opens. Without a gate, init-repo.sh scaffolds
# brain/sessions/ledger/, writes a CLAUDE.md template, creates "Resumes & Cover
# Letters/", writes session-start markers, and git-commits+pushes the result —
# in ANY cwd, including AI Fund Work Product repos that must stay IP-firewalled
# from cyborg/codi context (per Adapt.ai handoff §4.2 EIR).
#
# v0.66 added this gate to capture-prompt.sh + capture-response.sh but MISSED
# init-repo.sh — the third sister script in the same family. Single-slot
# learning failure (see memory: feedback_single_slot_learning_structural).
#
# Detection (any one sufficient):
#   1. $CAREER_HOME env var matches $WORKSPACE_ROOT
#   2. brain/identity/ dir exists in cwd (durable workspace signature)
#   3. .career-os-workspace sentinel file exists
# If none match → silent no-op exit 0. The hook MUST never scaffold or
# write to a non-Career-OS workspace.
#
# Carve-out: the STATE_DIR creation above is plugin-state (global), not
# workspace state. Safe to leave it before the gate.

# WORKSPACE-BINDING GATE (XOS-39): single shared, manifest-driven gate. Sourcing
# _workspace-gate.sh exit-0's HERE (silent no-op) when cwd is not a bound Career OS
# workspace — never scaffold brain/, write CLAUDE.md, create Resumes/, write ledger
# markers, or git add/commit/push outside it. Replaces the per-script
# is_career_os_workspace() copy that was forgotten in THIS file in v0.66.
source "$SCRIPT_DIR/_workspace-gate.sh"
source "$SCRIPT_DIR/_git-sync-push.sh"

# --- Version check + migration (P6: Zero-Data-Loss Upgrades) ---
# Must run BEFORE any other logic. Migration scripts know old file locations.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PLUGIN_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null | head -1 | grep -o '[0-9][0-9.]*' || echo "0.4.0")
VERSION_FILE="$STATE_DIR/version"
LEGACY_VERSION_FILE="$WORKSPACE_ROOT/.career-os/config/version"
MIGRATIONS_DIR="$PLUGIN_ROOT/migrations"

if [ -f "$VERSION_FILE" ]; then
    DATA_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
    if [ "$DATA_VERSION" != "$PLUGIN_VERSION" ] && [ -f "$MIGRATIONS_DIR/migrate.sh" ]; then
        echo "Career OS: Version mismatch detected (data: v${DATA_VERSION}, plugin: v${PLUGIN_VERSION})"
        echo "Running migration chain..."
        # FAIL-HARD INVARIANT: capture exit code; abort install if migration chain fails.
        # Pre-2026-04-27 this was a fire-and-forget invocation — soft failure when a
        # migration script was missing (v0.24.0 incident: stuck install on v0.23.0).
        if ! bash "$MIGRATIONS_DIR/migrate.sh" "$WORKSPACE_ROOT" "$DATA_VERSION" "$PLUGIN_VERSION"; then
            echo "❌ Career OS: migration chain failed. Install aborted." >&2
            echo "   Fix: ship the missing migrations/v<from>-to-v<to>.sh script and retry." >&2
            exit 1
        fi
        echo "MIGRATION_COMPLETED=true" >> "$STATE_DIR/.career-os-state"
    fi
elif [ -f "$LEGACY_VERSION_FILE" ]; then
    # Pre-v0.29.0 install: version file lives in workspace .career-os/config/version.
    # Run migration chain from that version up to current (the v0.28.0→v0.29.0
    # migration relocates the version file into $STATE_DIR).
    DATA_VERSION=$(cat "$LEGACY_VERSION_FILE" | tr -d '[:space:]')
    if [ "$DATA_VERSION" != "$PLUGIN_VERSION" ] && [ -f "$MIGRATIONS_DIR/migrate.sh" ]; then
        echo "Career OS: Pre-v0.29.0 install detected (data: v${DATA_VERSION}, plugin: v${PLUGIN_VERSION})"
        echo "Running migration chain..."
        if ! bash "$MIGRATIONS_DIR/migrate.sh" "$WORKSPACE_ROOT" "$DATA_VERSION" "$PLUGIN_VERSION"; then
            echo "❌ Career OS: migration chain failed. Install aborted." >&2
            echo "   Fix: ship the missing migrations/v<from>-to-v<to>.sh script and retry." >&2
            exit 1
        fi
        echo "MIGRATION_COMPLETED=true" >> "$STATE_DIR/.career-os-state"
    fi
elif [ -d "$WORKSPACE_ROOT/.career-os" ]; then
    # .career-os exists but no version file in either location — legacy install
    # before versioning was added. Assume v0.3.0 and migrate.
    echo "Career OS: Legacy install detected (no version file). Assuming v0.3.0."
    if [ -f "$MIGRATIONS_DIR/migrate.sh" ]; then
        # FAIL-HARD INVARIANT: same as above — capture exit code.
        if ! bash "$MIGRATIONS_DIR/migrate.sh" "$WORKSPACE_ROOT" "0.3.0" "$PLUGIN_VERSION"; then
            echo "❌ Career OS: legacy migration chain failed. Install aborted." >&2
            echo "   Fix: ship the missing migrations/v<from>-to-v<to>.sh script and retry." >&2
            exit 1
        fi
        echo "MIGRATION_COMPLETED=true" >> "$STATE_DIR/.career-os-state"
    else
        # No migration runner — just set the version
        echo "$PLUGIN_VERSION" > "$VERSION_FILE"
    fi
fi

# Git's built-in union merge driver makes concurrent session ledger appends
# auto-resolve during the push rebase path.
GITATTRIBUTES_FILE="$WORKSPACE_ROOT/.gitattributes"
LEDGER_UNION_ATTR='brain/sessions/ledger/** merge=union'
if [ ! -f "$GITATTRIBUTES_FILE" ]; then
    printf '%s\n' "$LEDGER_UNION_ATTR" > "$GITATTRIBUTES_FILE"
elif ! grep -Fqx "$LEDGER_UNION_ATTR" "$GITATTRIBUTES_FILE" 2>/dev/null; then
    if [ -s "$GITATTRIBUTES_FILE" ] && [ -n "$(tail -c 1 "$GITATTRIBUTES_FILE" 2>/dev/null || true)" ]; then
        printf '\n' >> "$GITATTRIBUTES_FILE"
    fi
    printf '%s\n' "$LEDGER_UNION_ATTR" >> "$GITATTRIBUTES_FILE"
fi

# --- First-run detection (v0.29.0) ---
# Gate on $STATE_DIR/version absence. Plugin owns its own first-run signal,
# independent of workspace artifacts. Deleting brain/ does NOT re-trigger
# onboarding; only deleting $STATE_DIR/version does.
if [ ! -f "$VERSION_FILE" ]; then
    # Scaffold brain/sessions/ directories
    mkdir -p "$WORKSPACE_ROOT/brain/sessions/ledger"
    mkdir -p "$WORKSPACE_ROOT/brain/sessions/judgments"

    # Create starter CLAUDE.md if none exists
    if [ ! -f "$WORKSPACE_ROOT/CLAUDE.md" ]; then
        cat > "$WORKSPACE_ROOT/CLAUDE.md" << 'CLAUDEMD'
# Career OS — Your Career Brain

Welcome to Career OS. This file is your rules engine — edit it to customize how Claude works with your career data.

## About You
<!-- Fill in during onboarding -->

## Preferences
- Be direct, no fluff
- Always update career data after conversations

## Memory
<!-- Hot cache: top contacts, terms, active pipeline -->
<!-- Full data lives in brain/ -->

## Plugin Boundary Rules

Career OS is managed by a plugin. The plugin owns its own runtime state in
`$CLAUDE_PLUGIN_DATA` (default `~/.career-os-state/`). Workspace files are
yours; plugin-state files are the plugin's.

### Workspace data — owned by you (and Career OS skills)

| Path | Owner | Notes |
|------|-------|-------|
| `brain/sessions/ledger/` | session-logger hooks | Append-only conversation ledger. |
| `brain/sessions/judgments/` | LLM judge | Per-day quality verdicts. Notable responses only. |
| `brain/identity/`, `brain/network/`, `brain/projects/`, ... | skills | User data. Skills own paths within. |

### Plugin runtime state — owned by the plugin (DO NOT MODIFY)

Lives in `$CLAUDE_PLUGIN_DATA` (default `~/.career-os-state/`).

| Path | Owner | Why |
|------|-------|-----|
| `$STATE_DIR/version` | plugin migrations | Version tracking. |
| `$STATE_DIR/git-errors.log` | hooks | Error logging. |
| `$STATE_DIR/.career-os-state` | hooks | First-run + migration markers. |

### Skills live in the plugin — not here

Do NOT create skill files, kernel files, or hook scripts in this workspace.
All skills are defined in the plugin repo and versioned through its CI pipeline.

If you find a bug or want to change skill behavior:
1. Write a spec or bug report to the relevant WIP folder (e.g., `WIP/career-os-product/`)
2. NEVER modify plugin source from this workspace
3. Implementation happens in the plugin repo, not here
CLAUDEMD
    fi

    # Create output folder
    mkdir -p "$WORKSPACE_ROOT/Resumes & Cover Letters"

    # Set initial version (P6) — in STATE_DIR, not workspace
    echo "$PLUGIN_VERSION" > "$VERSION_FILE"

    # Mark first run state
    echo "FIRST_RUN=true" > "$STATE_DIR/.career-os-state"
    echo "Career OS: First run detected (v${PLUGIN_VERSION}). The mission-control skill will guide you through onboarding."
    exit 0
fi

# --- Stale lock cleanup (Fix 3) ---
LOCK_FILE="$WORKSPACE_ROOT/.git/index.lock"
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "0") ))
    if [ "$LOCK_AGE" -gt 60 ]; then
        rm -f "$LOCK_FILE" 2>/dev/null || {
            mkdir -p "$(dirname "$LOG_FILE")"
            echo "[$(date)] Cannot remove stale index.lock (age: ${LOCK_AGE}s)" >> "$LOG_FILE"
        }
    fi
fi

# --- Ensure we're on main ---
CURRENT=$(git branch --show-current 2>/dev/null || echo "")
if [ "$CURRENT" != "$MAIN_BRANCH" ]; then
    git checkout -q "$MAIN_BRANCH" 2>/dev/null || true
fi

# --- Health check: warn if last commit was >24h ago (Fix 6) ---
LAST_COMMIT_TIME=$(git log -1 --format=%ct 2>/dev/null || echo "0")
NOW=$(date +%s)
HOURS_SINCE=$(( (NOW - LAST_COMMIT_TIME) / 3600 ))
if [ "$HOURS_SINCE" -gt 24 ]; then
    echo "⚠️ Career OS WARNING: Last git commit was ${HOURS_SINCE} hours ago. Data may not be backed up."
fi

# --- WO-046: Ledger backup health check ---
# Detect unpushed session commits and attempt catch-up push.
if git remote get-url origin &>/dev/null; then
    UNPUSHED=$(git log "origin/$MAIN_BRANCH..$MAIN_BRANCH" --oneline 2>/dev/null | wc -l | tr -d ' ')
    if [ "$UNPUSHED" -gt 0 ]; then
        echo "⚠️ Career OS: ${UNPUSHED} session commits not pushed to remote. Running catch-up push..."
        mkdir -p "$(dirname "$LOG_FILE")"
        if git_sync_push "$WORKSPACE_ROOT" "$MAIN_BRANCH" "$LOG_FILE"; then
            echo "✅ Career OS: Catch-up push complete (${UNPUSHED} commits)."
        else
            echo "[$(date)] catch-up push failed" >> "$LOG_FILE"
            echo "⚠️ Career OS: Remote backup degraded. Check $LOG_FILE"
        fi
    fi
fi

# --- WO-046: Ledger format validation (yesterday's file only — light check) ---
# Validates ledger format hasn't been corrupted. Warn only — git history has the clean version.
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d 2>/dev/null || echo "")
if [ -n "$YESTERDAY" ]; then
    YESTERDAY_LEDGER="$WORKSPACE_ROOT/brain/sessions/ledger/$YESTERDAY.md"
    if [ -f "$YESTERDAY_LEDGER" ]; then
        FIRST_LINE=$(head -n 1 "$YESTERDAY_LEDGER" 2>/dev/null || echo "")
        if [[ "$FIRST_LINE" != "# Session Ledger"* ]]; then
            echo "⚠️ Career OS: Yesterday's ledger has unexpected format. Check $YESTERDAY_LEDGER"
        fi
    fi
fi

# --- Write session start marker to ledger ---
mkdir -p "$WORKSPACE_ROOT/brain/sessions/ledger"

TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%H:%M:%S)
LEDGER_FILE="$WORKSPACE_ROOT/brain/sessions/ledger/$TODAY.md"

if [ ! -f "$LEDGER_FILE" ]; then
    echo "# Session Ledger — $TODAY" > "$LEDGER_FILE"
    echo "" >> "$LEDGER_FILE"
fi

{
    echo "## $TIMESTAMP — Session Start"
    echo ""
    echo "---"
    echo ""
} >> "$LEDGER_FILE"

# Gate matches isXos98TelemetryEnabled (src/telemetry/events.ts): only 1|true|yes|on.
# XOS_98_TELEMETRY=0/false/off (or unset) → OFF: no Bun spawn, no git-errors.log noise.
case "$(printf '%s' "${XOS_98_TELEMETRY:-}" | tr '[:upper:]' '[:lower:]')" in 1|true|yes|on) XOS98_ON=1 ;; *) XOS98_ON= ;; esac
if [ -n "${XOS98_ON}" ] && command -v bun >/dev/null 2>&1; then
    D7_PAYLOAD=$(LEDGER_DIR="$LEDGER_DIR" python3 -c 'import json, os; print(json.dumps({"ledgerDir": os.environ["LEDGER_DIR"]}))' 2>/dev/null || echo '{}')
    bun "$PLUGIN_ROOT/src/telemetry/beta-funnel.ts" d7-return "$D7_PAYLOAD" >> "$LOG_FILE" 2>&1 \
        || echo "[$(date)] XOS-98 d7_return emission failed" >> "$LOG_FILE"
    bun "$PLUGIN_ROOT/src/telemetry/nsm.ts" session-start '{}' >> "$LOG_FILE" 2>&1 \
        || echo "[$(date)] XOS-98 session-start marker failed" >> "$LOG_FILE"
fi

# Commit session start marker (Fix 2: error logging, Fix 5: WIP/ scope)
# XOS-28 (2026-06-06): SCOPED COMMIT — back-port the v0.66 sister-script fix that
# was missed on this third sister twice. Build a pathspec of only paths that
# exist, then `git commit -- <paths>` so a concurrent agent's staged work is
# NEVER swept into the session-start commit (the 2026-06-04 lost-commit class).
mkdir -p "$(dirname "$LOG_FILE")"
COMMIT_PATHS=()
[ -d "brain/sessions" ] && COMMIT_PATHS+=("brain/sessions")
[ -f "CLAUDE.md" ] && COMMIT_PATHS+=("CLAUDE.md")
[ -f ".gitattributes" ] && COMMIT_PATHS+=(".gitattributes")
[ -f "NEXT_SESSION_HANDOFF.md" ] && COMMIT_PATHS+=("NEXT_SESSION_HANDOFF.md")
[ -d "Resumes & Cover Letters" ] && COMMIT_PATHS+=("Resumes & Cover Letters")
[ -d "WIP" ] && COMMIT_PATHS+=("WIP")
if [ "${#COMMIT_PATHS[@]}" -gt 0 ]; then
    for p in "${COMMIT_PATHS[@]}"; do
        git add -- "$p" 2>> "$LOG_FILE" || echo "[$(date)] git add -- \"$p\" failed" >> "$LOG_FILE"
    done
    git commit -q -m "session-start: $TODAY $TIMESTAMP" -- "${COMMIT_PATHS[@]}" \
        2>> "$LOG_FILE" || echo "[$(date)] git commit (session-start) failed" >> "$LOG_FILE"
fi

# Serial push (Fix 4: blocking push replaces fire-and-forget background push)
if git remote get-url origin &>/dev/null; then
    git_sync_push "$WORKSPACE_ROOT" "$MAIN_BRANCH" "$LOG_FILE" || echo "[$(date)] git push failed" >> "$LOG_FILE"
fi

echo "Session logging active. New session: $TODAY $TIMESTAMP" >> "$LOG_FILE"
