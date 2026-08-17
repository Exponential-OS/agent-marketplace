#!/usr/bin/env bash
# _ledger-path.sh — shared session-ledger shard resolver.
#
# Sourced by hook scripts. Exposes:
#   resolve_active_ledger <ledger-dir> <yyyy-mm-dd>
#   ledger_day_files <ledger-dir> <yyyy-mm-dd>
#   cat_ledger_day <ledger-dir> <yyyy-mm-dd>

set -euo pipefail

__ledger_abs_dir() {
    case "${1:-}" in
        /*) printf '%s\n' "$1" ;;
        *) printf '%s/%s\n' "$(pwd -P 2>/dev/null || pwd)" "$1" ;;
    esac
}

__ledger_base_path() {
    local ledger_dir="$1"
    local ledger_date="$2"
    local abs_dir
    abs_dir="$(__ledger_abs_dir "$ledger_dir")" || abs_dir="$ledger_dir"
    printf '%s/%s.md\n' "$abs_dir" "$ledger_date"
}

__ledger_file_size() {
    local path="$1"
    local size=""

    size="$(stat -f%z "$path" 2>/dev/null || true)"
    if [ -z "$size" ]; then
        size="$(stat -c%s "$path" 2>/dev/null || true)"
    fi
    if [ -z "$size" ]; then
        size="$(wc -c < "$path" 2>/dev/null | tr -d '[:space:]' || true)"
    fi

    case "$size" in
        ''|*[!0-9]*) return 1 ;;
        *) printf '%s\n' "$size" ;;
    esac
}

__ledger_threshold() {
    local threshold="${CAREER_OS_LEDGER_MAX_BYTES:-41943040}"
    case "$threshold" in
        ''|*[!0-9]*) threshold=41943040 ;;
    esac
    if [ "$threshold" -le 0 ]; then
        threshold=41943040
    fi
    printf '%s\n' "$threshold"
}

__ledger_shard_path() {
    local abs_dir="$1"
    local ledger_date="$2"
    local shard_num="$3"

    if [ "$shard_num" -le 1 ]; then
        printf '%s/%s.md\n' "$abs_dir" "$ledger_date"
    else
        printf '%s/%s.%02d.md\n' "$abs_dir" "$ledger_date" "$shard_num"
    fi
}

__ledger_max_existing_shard() {
    local abs_dir="$1"
    local ledger_date="$2"
    local max_num=0
    local max_path=""
    local base_path="$abs_dir/$ledger_date.md"
    local path
    local name
    local suffix
    local shard_num

    if [ -f "$base_path" ]; then
        max_num=1
        max_path="$base_path"
    fi

    for path in "$abs_dir/$ledger_date".[0-9][0-9].md; do
        [ -f "$path" ] || continue
        name="$(basename "$path")"
        suffix="${name#$ledger_date.}"
        suffix="${suffix%.md}"
        case "$suffix" in
            ''|*[!0-9]*) continue ;;
        esac
        shard_num=$((10#$suffix))
        [ "$shard_num" -ge 2 ] || continue
        if [ "$shard_num" -gt "$max_num" ]; then
            max_num="$shard_num"
            max_path="$path"
        fi
    done

    printf '%s\n%s\n' "$max_num" "$max_path"
}

__ledger_resolve_active_no_lock() {
    local abs_dir="$1"
    local ledger_date="$2"
    local base_path="$abs_dir/$ledger_date.md"
    local max_info
    local max_num
    local max_path
    local size
    local threshold
    local next_num

    if [ ! -d "$abs_dir" ]; then
        printf '%s\n' "$base_path"
        return 0
    fi

    max_info="$(__ledger_max_existing_shard "$abs_dir" "$ledger_date")" || return 1
    max_num="$(printf '%s\n' "$max_info" | sed -n '1p')"
    max_path="$(printf '%s\n' "$max_info" | sed -n '2p')"

    if [ "${max_num:-0}" -eq 0 ] || [ -z "${max_path:-}" ]; then
        printf '%s\n' "$base_path"
        return 0
    fi

    size="$(__ledger_file_size "$max_path")" || return 1
    threshold="$(__ledger_threshold)"

    if [ "$size" -lt "$threshold" ]; then
        printf '%s\n' "$max_path"
        return 0
    fi

    if [ "$max_num" -ge 99 ]; then
        __ledger_shard_path "$abs_dir" "$ledger_date" 99
        return 0
    fi

    next_num=$((max_num + 1))
    __ledger_shard_path "$abs_dir" "$ledger_date" "$next_num"
}

__ledger_hash() {
    local value="$1"
    local hash=""

    if command -v shasum >/dev/null 2>&1; then
        hash="$(printf '%s\n' "$value" | shasum 2>/dev/null | cut -c1-12 || true)"
    fi
    if [ -z "$hash" ]; then
        hash="$(printf '%s\n' "$value" | cksum 2>/dev/null | cut -d' ' -f1 | cut -c1-12 || true)"
    fi
    if [ -z "$hash" ]; then
        hash="fallback"
    fi
    printf '%s\n' "$hash"
}

# ledger_lock_file <ledger_dir>
#
# The single lock that guards a ledger directory. XOS-215: the APPEND must take
# the SAME lock as shard resolution, or the two serialize against each other's
# nothing — a second, differently-named mutex excludes no one. Prints the path,
# or returns non-zero when no usable state dir exists (callers fail open).
ledger_lock_file() {
    local ledger_dir="${1:-}"
    local state_home
    local state_dir

    [ -n "$ledger_dir" ] || return 1
    state_home="${HOME:-}"
    [ -n "$state_home" ] || return 1
    state_dir="${STATE_DIR:-$state_home/.career-os-state}"
    mkdir -p "$state_dir" 2>/dev/null || return 1
    printf '%s\n' "$state_dir/.ledger-rotate.$(__ledger_hash "$ledger_dir").lock"
}

resolve_active_ledger() {
    local ledger_dir="${1:-}"
    local ledger_date="${2:-}"
    local abs_dir
    local base_path
    local state_home
    local state_dir
    local hash
    local lock_file
    local lock_dir
    local resolved

    base_path="$(__ledger_base_path "$ledger_dir" "$ledger_date")"
    abs_dir="$(dirname "$base_path")"

    if [ -z "$ledger_dir" ] || [ -z "$ledger_date" ]; then
        printf '%s\n' "$base_path"
        return 0
    fi

    state_home="${HOME:-}"
    if [ -z "$state_home" ]; then
        printf '%s\n' "$base_path"
        return 0
    fi

    # Single source for the lock path — shared with ledger_append (XOS-215).
    if ! lock_file="$(ledger_lock_file "$ledger_dir")" || [ -z "$lock_file" ]; then
        printf '%s\n' "$base_path"
        return 0
    fi
    : >> "$lock_file" 2>/dev/null || {
        printf '%s\n' "$base_path"
        return 0
    }

    if command -v flock >/dev/null 2>&1; then
        if resolved="$( (
            flock -w 2 9 || exit 1
            __ledger_resolve_active_no_lock "$abs_dir" "$ledger_date"
        ) 9>"$lock_file" 2>/dev/null )"; then
            if [ -n "$resolved" ]; then
                printf '%s\n' "$resolved"
                return 0
            fi
        fi
        printf '%s\n' "$base_path"
        return 0
    fi

    lock_dir="$lock_file.dir"
    if resolved="$( (
        attempts=0
        acquired=0
        while [ "$attempts" -lt 20 ]; do
            if mkdir "$lock_dir" 2>/dev/null; then
                acquired=1
                break
            fi
            attempts=$((attempts + 1))
            sleep 0.1 2>/dev/null || sleep 1
        done
        [ "$acquired" -eq 1 ] || exit 1
        trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT
        __ledger_resolve_active_no_lock "$abs_dir" "$ledger_date"
    ) 2>/dev/null )"; then
        if [ -n "$resolved" ]; then
            printf '%s\n' "$resolved"
            return 0
        fi
    fi

    printf '%s\n' "$base_path"
    return 0
}

ledger_day_files() {
    local ledger_dir="${1:-}"
    local ledger_date="${2:-}"
    local abs_dir
    local base_path
    local max_info
    local max_num
    local shard_num
    local shard_path

    base_path="$(__ledger_base_path "$ledger_dir" "$ledger_date")"
    abs_dir="$(dirname "$base_path")"

    [ -n "$ledger_dir" ] && [ -n "$ledger_date" ] || return 0
    [ -d "$abs_dir" ] || return 0

    if [ -f "$base_path" ]; then
        printf '%s\n' "$base_path"
    fi

    max_info="$(__ledger_max_existing_shard "$abs_dir" "$ledger_date")" || return 0
    max_num="$(printf '%s\n' "$max_info" | sed -n '1p')"
    [ "${max_num:-0}" -ge 2 ] || return 0

    shard_num=2
    while [ "$shard_num" -le "$max_num" ]; do
        shard_path="$(__ledger_shard_path "$abs_dir" "$ledger_date" "$shard_num")"
        if [ -f "$shard_path" ]; then
            printf '%s\n' "$shard_path"
        fi
        shard_num=$((shard_num + 1))
    done
}

cat_ledger_day() {
    local ledger_dir="${1:-}"
    local ledger_date="${2:-}"
    local shard_path

    ledger_day_files "$ledger_dir" "$ledger_date" | while IFS= read -r shard_path; do
        [ -f "$shard_path" ] || continue
        cat "$shard_path" 2>/dev/null || true
    done
}
