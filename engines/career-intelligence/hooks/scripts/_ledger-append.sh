#!/usr/bin/env bash
# _ledger-append.sh — serialized, single-write ledger appends.
#
# XOS-215. Both capture-prompt.sh and capture-response.sh appended with a brace
# group:
#
#     { echo "## $TS — Claude"; echo ""; echo "$BODY"; echo ""; echo "---"; echo ""; } >> "$LEDGER"
#
# That is SIX separate write() calls through one redirect. O_APPEND makes each
# individual write atomic, but nothing holds the six together — capture-prompt
# and capture-response run in the same turn against the same file, and two
# sessions can share a workspace. Interleaving corrupts entry boundaries.
#
# TWO THINGS THIS DOES
#   1. Takes the SAME lock resolve_active_ledger() uses (ledger_lock_file), so
#      shard selection and the append are serialized together. A second,
#      differently-named mutex would exclude no one — that is the whole point of
#      reusing the existing lock rather than inventing one.
#   2. Emits the entry in ONE write. This matters independently of the lock:
#      when the lock cannot be acquired we still fail open, and a single write
#      collapses the interleaving window from six chances to one.
#
# WHY NOT flock ALONE, WHICH THE TICKET PROPOSED
# flock(1) is util-linux and is NOT present on macOS, where these hooks actually
# run (verified 2026-08-16: `command -v flock` finds nothing). _ledger-path.sh
# already handles this by falling back to a mkdir mutex; this mirrors that
# strategy exactly rather than inventing a third one.
#
# FAIL-OPEN, ALWAYS
# A session must never hang or lose its ledger entry because a lock is busy or a
# process died holding it. Every failure path falls through to the append.
#
# Sourced by hook scripts. Exposes:
#   ledger_append <ledger-file> <header-line> <body-text>

set -euo pipefail

# ledger_append <ledger_file> <header_line> <body_text>
# Creates the daily header if absent and appends one complete entry.
ledger_append() {
    local ledger_file="$1"
    local header_line="$2"
    local body="$3"
    local ledger_dir
    local lock_file=""
    local lock_dir
    local day

    ledger_dir="$(dirname "$ledger_file")"
    day="$(basename "$ledger_file" .md)"
    mkdir -p "$ledger_dir" 2>/dev/null || true

    # __ledger_hash / ledger_lock_file come from _ledger-path.sh, which both
    # callers already source. If it is absent we simply run unlocked.
    if command -v ledger_lock_file >/dev/null 2>&1; then
        lock_file="$(ledger_lock_file "$ledger_dir" 2>/dev/null || true)"
    fi

    if [ -n "$lock_file" ] && command -v flock >/dev/null 2>&1; then
        (
            flock -w 2 9 2>/dev/null || true   # timeout -> proceed unlocked
            __ledger_write_entry "$ledger_file" "$day" "$header_line" "$body"
        ) 9>>"$lock_file" 2>/dev/null && return 0
        # Subshell failed for a reason unrelated to the write; do not lose the entry.
        __ledger_write_entry "$ledger_file" "$day" "$header_line" "$body"
        return 0
    fi

    if [ -n "$lock_file" ]; then
        lock_dir="$lock_file.append.dir"
        local attempts=0
        local acquired=0
        while [ "$attempts" -lt 20 ]; do
            if mkdir "$lock_dir" 2>/dev/null; then
                acquired=1
                break
            fi
            # A process killed mid-append leaves this directory behind forever.
            # Without stale-breaking, every subsequent append pays the full
            # 2-second wait for the rest of the machine's life — a permanent tax
            # on every prompt and response. Break locks older than the window.
            if [ "$(__ledger_lock_age_secs "$lock_dir")" -gt "${LEDGER_APPEND_LOCK_STALE_SECS:-30}" ]; then
                rmdir "$lock_dir" 2>/dev/null || true
                continue
            fi
            attempts=$((attempts + 1))
            sleep 0.1 2>/dev/null || sleep 1
        done
        __ledger_write_entry "$ledger_file" "$day" "$header_line" "$body"
        # Explicit if/fi, not `[ ] && rmdir`: under `set -e` a false test in a
        # trailing && list aborts the hook, which would drop the session's entry.
        if [ "$acquired" -eq 1 ]; then
            rmdir "$lock_dir" 2>/dev/null || true
        fi
        return 0
    fi

    __ledger_write_entry "$ledger_file" "$day" "$header_line" "$body"
    return 0
}

# Age of a lock directory in seconds. stat is BSD on macOS and GNU on Linux;
# if neither answers, report 0 so an unreadable lock is treated as FRESH and we
# wait rather than stealing a lock that may be live.
__ledger_lock_age_secs() {
    local dir="$1"
    local now
    local mtime
    now="$(date +%s)"
    mtime="$(stat -f %m "$dir" 2>/dev/null || stat -c %Y "$dir" 2>/dev/null || echo "$now")"
    echo $(( now - mtime ))
}

# Header creation stays inside the caller's lock. `set -C` (noclobber) keeps it
# correct even unlocked: only one writer can create the file.
__ledger_write_entry() {
    local ledger_file="$1"
    local day="$2"
    local header_line="$3"
    local body="$4"

    if [ ! -f "$ledger_file" ]; then
        (
            set -C
            printf '# Session Ledger — %s\n\n' "$day" > "$ledger_file"
        ) 2>/dev/null || true
    fi

    printf '## %s\n\n%s\n\n---\n\n' "$header_line" "$body" >> "$ledger_file"
}
