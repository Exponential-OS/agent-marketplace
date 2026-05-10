#!/usr/bin/env bash
# Career OS — Sequential Version Migration Runner (P12)
#
# Usage: migrate.sh <context-dir> <current-data-version> <target-version>
# Example: migrate.sh /path/to/career 0.3.0 0.5.0
#   → runs v0.3.0-to-v0.4.0.sh, then v0.4.0-to-v0.5.0.sh
#
# Scripts are discovered by naming convention: v{from}-to-v{to}.sh
# All intermediate scripts between current and target are run sequentially.

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

echo "Career OS Migration: v${CURRENT_VERSION} → v${TARGET_VERSION}"
echo "Context directory: ${CONTEXT_DIR}"
echo ""

# Collect all migration scripts in order
# Sort by version number (lexicographic works for semver with consistent formatting)
SCRIPTS=()
for script in "$SCRIPT_DIR"/v*-to-v*.sh; do
  [ -f "$script" ] || continue
  base="$(basename "$script")"
  # Extract from-version from filename: v{from}-to-v{to}.sh
  from_ver="${base#v}"
  from_ver="${from_ver%-to-v*}"
  SCRIPTS+=("$from_ver:$script")
done

# Sort scripts by from-version
IFS=$'\n' SORTED=($(printf '%s\n' "${SCRIPTS[@]}" | sort -t: -k1 -V)); unset IFS

# Find the chain: all scripts where from_ver >= current AND to_ver <= target
CHAIN=()
stepping_ver="$CURRENT_VERSION"

for entry in "${SORTED[@]}"; do
  from_ver="${entry%%:*}"
  script="${entry#*:}"
  base="$(basename "$script")"
  to_ver="${base%.sh}"
  to_ver="${to_ver##*-to-v}"

  if [ "$from_ver" = "$stepping_ver" ]; then
    CHAIN+=("$script")
    stepping_ver="$to_ver"
    if [ "$to_ver" = "$TARGET_VERSION" ]; then
      break
    fi
  fi
done

if [ ${#CHAIN[@]} -eq 0 ]; then
  echo "ERROR: No migration path found from v${CURRENT_VERSION} to v${TARGET_VERSION}"
  echo "Available scripts:"
  ls "$SCRIPT_DIR"/v*-to-v*.sh 2>/dev/null || echo "  (none)"
  exit 1
fi

if [ "$stepping_ver" != "$TARGET_VERSION" ]; then
  echo "ERROR: Incomplete migration path. Reached v${stepping_ver} but target is v${TARGET_VERSION}"
  echo "Missing migration script for v${stepping_ver} → ?"
  exit 1
fi

echo "Migration chain (${#CHAIN[@]} step(s)):"
for script in "${CHAIN[@]}"; do
  echo "  → $(basename "$script")"
done
echo ""

# Execute chain
for script in "${CHAIN[@]}"; do
  echo "Running: $(basename "$script")"
  bash "$script" "$CONTEXT_DIR"
  echo ""
done

echo "✅ Migration complete: v${CURRENT_VERSION} → v${TARGET_VERSION}"
