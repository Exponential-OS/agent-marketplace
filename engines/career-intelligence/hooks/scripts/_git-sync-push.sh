#!/usr/bin/env bash
# _git-sync-push.sh — shared resilient push helper for session logger hooks.
#
# Sourced by hook scripts. Exposes:
#   git_sync_push <repo_dir> <branch> <log_file>

set -euo pipefail

git_sync_push() {
    local repo_dir="$1"
    local branch="$2"
    local log_file="$3"

    mkdir -p "$(dirname "$log_file")" 2>/dev/null || true

    if ! git -C "$repo_dir" remote get-url origin >/dev/null 2>&1; then
        echo "[$(date)] git push skipped; no origin remote" >> "$log_file"
        return 1
    fi

    if git -C "$repo_dir" push -q origin "$branch" 2>> "$log_file"; then
        return 0
    fi

    echo "[$(date)] push rejected; attempting rebase reconcile" >> "$log_file"

    if ! git -C "$repo_dir" fetch -q origin "$branch" 2>> "$log_file"; then
        echo "[$(date)] fetch for rebase reconcile failed" >> "$log_file"
        return 1
    fi

    if git -C "$repo_dir" rebase --autostash -q "origin/$branch" 2>> "$log_file"; then
        if git -C "$repo_dir" push -q origin "$branch" 2>> "$log_file"; then
            echo "[$(date)] push succeeded after rebase reconcile" >> "$log_file"
            return 0
        fi

        echo "[$(date)] push failed after rebase reconcile" >> "$log_file"
        return 1
    fi

    git -C "$repo_dir" rebase --abort 2>> "$log_file" || true
    echo "[$(date)] auto-rebase hit a content conflict (beyond ledger); local commits left intact + unpushed — manual reconcile needed" >> "$log_file"
    return 1
}
