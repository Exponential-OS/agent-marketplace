#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration: v0.4.0 → v0.5.0
# Description: Clean up session-branch artifacts, adopt direct-to-main strategy
# This script is idempotent — safe to run multiple times.
#
# What changed in v0.5.0:
# - Session branches removed — all commits go direct to main
# - squash-sessions.sh removed — git rebase/squash used instead
# - NEXT_SESSION_HANDOFF.md added to commit tracking
# - Background push added to capture-response.sh
# - Version check + migration runner added to init-repo.sh
# - Plugin metadata (.claude-plugin/plugin.json) added
# - CI workflows added (.github/workflows/)
# - Test suite added (tests/)
#
# Data migration:
# - Merge any orphaned session branches back to main
# - Remove .current-session state file
# - Set version to 0.5.0

set -euo pipefail

CONTEXT_DIR="${1:-.}"
cd "$CONTEXT_DIR"

echo "Migration v0.4.0 → v0.5.0: Adopting direct-to-main strategy"

STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.career-os-state}"

# --- Merge orphaned session branches ---
# v0.4.0 used session-YYYY-MM-DD-HHMMSS branches. Any unmerged ones
# contain captured data that must not be lost.
if git rev-parse --git-dir &>/dev/null; then
    for branch in $(git branch --list 'session-*' 2>/dev/null | sed 's/^[ *]*//'); do
        # Check if branch has commits not in main
        ahead=$(git rev-list --count main.."$branch" 2>/dev/null || echo "0")
        if [ "$ahead" -gt 0 ]; then
            echo "  Merging orphaned session branch: $branch ($ahead commits ahead)"
            git merge -q --no-edit "$branch" 2>/dev/null || {
                echo "  WARNING: Could not auto-merge $branch. Manual merge required."
                echo "  Skipping — branch preserved for manual resolution."
                continue
            }
        fi
        # Delete the session branch (merged or already behind main)
        git branch -d "$branch" 2>/dev/null || true
    done
fi

# --- Clean up state file ---
# v0.4.0 wrote .current-session to track active session branch
if [ -f "$STATE_DIR/.current-session" ]; then
    rm -f "$STATE_DIR/.current-session"
    echo "  Removed .current-session state file"
fi

# --- Ensure config directory exists ---
mkdir -p .career-os/config

# --- Set version ---
echo "0.5.0" > .career-os/config/version

echo "✅ Migration v0.4.0 → v0.5.0 complete"
