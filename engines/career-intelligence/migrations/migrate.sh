#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Career Intelligence — Sequential Version Migration Runner (P12)
#
# Usage: migrate.sh <context-dir> <current-data-version> <target-version>
# Example: migrate.sh /path/to/career 1.0.0 1.2.0
#   → runs v1.0.0-to-v1.1.0.sh, then v1.1.0-to-v1.2.0.sh
#
# Scripts are discovered by naming convention: v{from}-to-v{to}.sh
# All intermediate scripts between current and target are run sequentially.
#
# PRE-1.0 INSTALLS take a single hop. 1.0 retired the 0.x chain — 59 scripts,
# nearly all of which only stamped a version number — and replaced it with one
# baseline script, v0.0.0-to-v1.0.0.sh. Any data version below 1.0.0 routes
# straight there. See BOOTSTRAP below.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
CURRENT_VERSION="${2:-}"
TARGET_VERSION="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$CURRENT_VERSION" ] || [ -z "$TARGET_VERSION" ]; then
  echo "Usage: migrate.sh <context-dir> <current-version> <target-version>"
  exit 1
fi

if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
  echo "Already at version $TARGET_VERSION. No migration needed."
  exit 0
fi

echo "Career Intelligence Migration: v${CURRENT_VERSION} → v${TARGET_VERSION}"
echo "Context directory: ${CONTEXT_DIR}"
echo ""

# ── BOOTSTRAP: anything pre-1.0 takes one hop to the 1.0 baseline ────────────
# Deliberately not a walk. A single edge into 1.0.0 cannot fork, which is the
# entire failure mode that made every install between 0.73.5 and 0.78.0
# unupgradable. The baseline script does its own fail-hard check for workspaces
# that never made the v0.29.0 state relocation.
BOOTSTRAP="$SCRIPT_DIR/v0.0.0-to-v1.0.0.sh"
case "$CURRENT_VERSION" in
  0.*)
    if [ ! -f "$BOOTSTRAP" ]; then
      echo "ERROR: pre-1.0 install (v${CURRENT_VERSION}) but $BOOTSTRAP is missing." >&2
      exit 1
    fi
    echo "Pre-1.0 install — routing to the 1.0 baseline."
    echo "  → $(basename "$BOOTSTRAP")"
    echo ""
    if [ "${MIGRATE_DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN — chain resolves, nothing executed."
      exit 0
    fi
    bash "$BOOTSTRAP" "$CONTEXT_DIR" || exit 1
    # Anything after 1.0.0 continues through the ordinary chain below.
    CURRENT_VERSION="1.0.0"
    if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
      echo "✅ Migration complete: → v${TARGET_VERSION}"
      exit 0
    fi
    ;;
esac

# Collect all migration scripts in order
# Sort by version number (lexicographic works for semver with consistent formatting)
# Entries are "from:to:path" — both versions parsed ONCE, here. Re-deriving
# to_ver with basename inside the chain walk forked a process per candidate per
# step; on the longest chain that was ~8 seconds of pure fork overhead, paid on
# every session start by exactly the oldest installs that can least afford it.
SCRIPTS=()
for script in "$SCRIPT_DIR"/v*-to-v*.sh; do
  [ -f "$script" ] || continue
  base="${script##*/}"
  # Filename is the contract: v{from}-to-v{to}.sh
  from_ver="${base#v}"; from_ver="${from_ver%-to-v*}"
  to_ver="${base%.sh}";  to_ver="${to_ver##*-to-v}"
  SCRIPTS+=("$from_ver:$to_ver:$script")
done

# Sort scripts by from-version
IFS=$'\n' SORTED=($(printf '%s\n' "${SCRIPTS[@]}" | sort -t: -k1 -V)); unset IFS

# AMBIGUITY GUARD: two scripts sharing a from-version make the chain
# non-deterministic — the runner would silently pick one and the other becomes
# unreachable. That is exactly how v0.77.0 acquired two successors
# (-to-v0.78.0 and -to-v0.79.0): the second was mislabelled, the runner took the
# first, and every install sitting on 0.77.0 dead-ended at 0.78.0. Fail loudly
# and name both files rather than guess.
DUPES="$(printf '%s\n' "${SORTED[@]}" | cut -d: -f1 | uniq -d)"
if [ -n "$DUPES" ]; then
  echo "ERROR: ambiguous migration graph — a version has more than one successor." >&2
  for dv in $DUPES; do
    echo "  v${dv} ->" >&2
    printf '%s\n' "${SORTED[@]}" | awk -F: -v v="$dv" '$1==v {print "       " $3}' >&2
  done
  echo "  Fix: rename the mislabelled script so each version has exactly one successor." >&2
  exit 1
fi

# Build the chain by EXACT from-version match, one step at a time.
#
# Note for anyone tempted by "gap tolerance" (stepping to the next script at or
# above the current version, so releases that shipped without a migration are
# skipped): it was tried and reverted. It does make 0.30.0–0.64.x resolve, but
# the 0.29.0 dead end is deliberate, not an oversight — tests/test-hooks.sh
# [B3] asserts that a legacy install fails hard rather than stamping a version,
# and skipping forward makes ~26 old data-touching migrations execute against a
# legacy workspace that was explicitly never signed up for them.
#
# The bug that prompted this file's rewrite was never the gaps. It was two
# MISLABELLED scripts creating forks, which is fixed at the source.

# Pure-bash semver compare: echoes -1, 0 or 1. Deliberately not `sort -V` — this
# runs inside a nested walk over ~60 scripts, and one subshell per comparison
# turned a chain resolution into hundreds of thousands of forks (the test suite
# hit a two-minute timeout before a single assertion finished).
# Sets VER_CMP to -1, 0 or 1. Returns via a global rather than echoing, because
# $(ver_cmp ...) would fork — the very cost this rewrite exists to remove.
VER_CMP=0
ver_cmp() {
  local ai bi i
  local -a A B
  IFS='.' read -r -a A <<< "$1"
  IFS='.' read -r -a B <<< "$2"
  for ((i = 0; i < 4; i++)); do
    ai=$((10#${A[i]:-0})); bi=$((10#${B[i]:-0}))
    ((ai < bi)) && { VER_CMP=-1; return; }
    ((ai > bi)) && { VER_CMP=1; return; }
  done
  VER_CMP=0
}

CHAIN=()
stepping_ver="$CURRENT_VERSION"

while [ "$stepping_ver" != "$TARGET_VERSION" ]; do
  next_script=""
  next_to=""
  for entry in "${SORTED[@]}"; do
    from_ver="${entry%%:*}"
    rest="${entry#*:}"
    to_ver="${rest%%:*}"
    script="${rest#*:}"

    # exact match only — see the note above on why this is not >=
    [ "$from_ver" = "$stepping_ver" ] || continue
    # never step past the target
    ver_cmp "$to_ver" "$TARGET_VERSION"; [ "$VER_CMP" = "1" ] && continue

    next_script="$script"
    next_to="$to_ver"
    break   # SORTED is version-ordered, so the first match is the nearest step
  done

  [ -z "$next_script" ] && break
  CHAIN+=("$next_script")
  stepping_ver="$next_to"
done

if [ ${#CHAIN[@]} -eq 0 ]; then
  echo "ERROR: No migration path found from v${CURRENT_VERSION} to v${TARGET_VERSION}"
  echo "Available scripts:"
  ls "$SCRIPT_DIR"/v*-to-v*.sh 2>/dev/null || echo "  (none)"
  exit 1
fi

if [ "$stepping_ver" != "$TARGET_VERSION" ]; then
  echo "ERROR: Incomplete migration path. Reached v${stepping_ver} but target is v${TARGET_VERSION}"
  echo "Missing migration script for v${stepping_ver} → v${TARGET_VERSION}"
  exit 1
fi

echo "Migration chain (${#CHAIN[@]} step(s)):"
for script in "${CHAIN[@]}"; do
  echo "  → $(basename "$script")"
done
echo ""

# MIGRATE_DRY_RUN=1 resolves and prints the chain without running anything.
# Chain RESOLUTION and chain EXECUTION are separate failure modes and were easy
# to confuse while debugging this: a v0.65.0 script legitimately refuses to run
# until a legacy brain/ layout is migrated by hand, which looks identical to a
# broken graph if you only watch the exit code. Tests assert resolution; they
# must not execute real migrations against a real workspace.
if [ "${MIGRATE_DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN — chain resolves, nothing executed."
  exit 0
fi

# Execute chain
for script in "${CHAIN[@]}"; do
  echo "Running: $(basename "$script")"
  bash "$script" "$CONTEXT_DIR"
  echo ""
done

echo "✅ Migration complete: v${CURRENT_VERSION} → v${TARGET_VERSION}"
