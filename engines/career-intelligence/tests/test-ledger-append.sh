#!/usr/bin/env bash
# test-ledger-append.sh — XOS-215.
#
# A concurrency test that certifies a fix is worthless unless it can DETECT the
# bug. So this runs the OLD six-echo append and the NEW ledger_append under
# identical concurrency and asserts:
#
#   OLD  -> interleaving is observed          (the detector works)
#   NEW  -> zero interleaving                 (the fix works)
#
# If the OLD case ever stops interleaving on some machine, the detector has gone
# blind and the NEW result proves nothing — so that is reported as a FAIL rather
# than quietly passing.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
HOOKS="$SCRIPT_DIR/../hooks/scripts"

pass=0
fail=0
check() {
    if [ "$2" = "1" ]; then pass=$((pass+1)); echo "  ok   $1"
    else fail=$((fail+1)); echo "  FAIL $1${3:+ — $3}"; fi
}

WRITERS=8
BODY_LINES=120

# Body unique per writer: every line carries the writer id, so a mixed entry is
# detectable by finding two ids between one '## ' and its '---'.
make_body() {
    local id="$1" i=1
    while [ "$i" -le "$BODY_LINES" ]; do
        printf 'W%s-line-%s\n' "$id" "$i"
        i=$((i+1))
    done
}

# Count entries whose body contains more than one writer id.
count_mixed_entries() {
    awk '
        /^## / { inentry=1; delete seen; n=0; next }
        /^---$/ {
            if (inentry) { if (n > 1) mixed++ ; inentry=0 }
            next
        }
        inentry && /^W[0-9]+-line-/ {
            split($0, a, "-"); id=a[1]
            if (!(id in seen)) { seen[id]=1; n++ }
        }
        END { print mixed+0 }
    ' "$1"
}

count_entries() { grep -c '^## ' "$1" 2>/dev/null || echo 0; }

# ── OLD behaviour: six echoes through one redirect ─────────────────────────────
old_append() {
    local file="$1" hdr="$2" body="$3"
    {
        echo "## $hdr"
        echo ""
        echo "$body"
        echo ""
        echo "---"
        echo ""
    } >> "$file"
}

echo ""
echo "XOS-215 — ledger append atomicity"
echo ""

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- 1. the detector must catch the OLD bug ---------------------------------
OLD_FILE="$TMP/old.md"
: > "$OLD_FILE"
for i in $(seq 1 $WRITERS); do
    ( old_append "$OLD_FILE" "12:00:00 — W$i" "$(make_body "$i")" ) &
done
wait
OLD_MIXED="$(count_mixed_entries "$OLD_FILE")"
OLD_ENTRIES="$(count_entries "$OLD_FILE")"
check "OLD six-echo append interleaves under $WRITERS writers (detector works)" \
      "$([ "$OLD_MIXED" -gt 0 ] && echo 1 || echo 0)" \
      "mixed=$OLD_MIXED entries=$OLD_ENTRIES — if 0, this test can no longer detect the bug it certifies"

# ---- 2. the fix must eliminate it -------------------------------------------
# shellcheck source=../hooks/scripts/_ledger-path.sh
. "$HOOKS/_ledger-path.sh"
# shellcheck source=../hooks/scripts/_ledger-append.sh
. "$HOOKS/_ledger-append.sh"

export STATE_DIR="$TMP/state"
NEW_DIR="$TMP/ledger"
mkdir -p "$NEW_DIR" "$STATE_DIR"
NEW_FILE="$NEW_DIR/2026-08-16.md"

for i in $(seq 1 $WRITERS); do
    ( ledger_append "$NEW_FILE" "12:00:00 — W$i" "$(make_body "$i")" ) &
done
wait
NEW_MIXED="$(count_mixed_entries "$NEW_FILE")"
NEW_ENTRIES="$(count_entries "$NEW_FILE")"

check "NEW ledger_append produces ZERO interleaved entries" \
      "$([ "$NEW_MIXED" -eq 0 ] && echo 1 || echo 0)" "mixed=$NEW_MIXED"
check "NEW ledger_append keeps every entry ($WRITERS expected)" \
      "$([ "$NEW_ENTRIES" -eq "$WRITERS" ] && echo 1 || echo 0)" "entries=$NEW_ENTRIES"

# ---- 3. header written exactly once ------------------------------------------
HDRS="$(grep -c '^# Session Ledger' "$NEW_FILE" 2>/dev/null || echo 0)"
check "daily header written exactly once under concurrency" \
      "$([ "$HDRS" -eq 1 ] && echo 1 || echo 0)" "headers=$HDRS"

# ---- 4. body content survives intact -----------------------------------------
INTACT=1
for i in $(seq 1 $WRITERS); do
    n="$(grep -c "^W$i-line-" "$NEW_FILE" 2>/dev/null || echo 0)"
    [ "$n" -eq "$BODY_LINES" ] || { INTACT=0; break; }
done
check "every writer's body survives complete ($BODY_LINES lines each)" "$INTACT"

# ---- 5. fail-open: no usable state dir must still append ---------------------
NOLOCK_DIR="$TMP/nolock"; mkdir -p "$NOLOCK_DIR"
NOLOCK_FILE="$NOLOCK_DIR/2026-08-16.md"
( HOME="" STATE_DIR="" ledger_append "$NOLOCK_FILE" "12:00:00 — solo" "body-here" ) >/dev/null 2>&1
check "appends even when no lock is obtainable (fail-open)" \
      "$([ -s "$NOLOCK_FILE" ] && echo 1 || echo 0)"

# ---- 6. the shared-lock contract ---------------------------------------------
L1="$(ledger_lock_file "$NEW_DIR")"
check "ledger_lock_file returns a path for a real dir" \
      "$([ -n "$L1" ] && echo 1 || echo 0)" "got '$L1'"
L2="$(ledger_lock_file "$NEW_DIR")"
check "lock path is stable for the same dir (append and resolver share it)" \
      "$([ "$L1" = "$L2" ] && echo 1 || echo 0)"
L3="$(ledger_lock_file "$TMP/other-dir")"
check "different ledger dirs get different locks" \
      "$([ "$L1" != "$L3" ] && echo 1 || echo 0)"

# ---- 7. a stale lock must not tax every future append forever ---------------
STALE_DIR="$TMP/stale"; mkdir -p "$STALE_DIR"
STALE_FILE="$STALE_DIR/2026-08-16.md"
STALE_LOCK="$(ledger_lock_file "$STALE_DIR").append.dir"
mkdir -p "$STALE_LOCK"
# Backdate it well past the stale window (simulates a process killed mid-append).
touch -t 202001010000 "$STALE_LOCK" 2>/dev/null || true
START=$(date +%s)
LEDGER_APPEND_LOCK_STALE_SECS=5 ledger_append "$STALE_FILE" "12:00:00 — after-crash" "body"
ELAPSED=$(( $(date +%s) - START ))
check "stale lock is broken, not waited out (elapsed ${ELAPSED}s)" \
      "$([ "$ELAPSED" -lt 2 ] && echo 1 || echo 0)" "took ${ELAPSED}s"
check "entry still written after breaking a stale lock" \
      "$([ -s "$STALE_FILE" ] && echo 1 || echo 0)"

echo ""
echo "$pass passed, $fail failed"
echo ""
[ "$fail" -eq 0 ]
