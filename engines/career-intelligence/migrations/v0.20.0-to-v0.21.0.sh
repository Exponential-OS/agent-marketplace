#!/usr/bin/env bash
# Migration v0.20.0 → v0.21.0
#
# Dolt-canonical cutover (Phase 3 of ADR-003). No data transforms in the
# workspace — the Dolt brain's own schema + data migrations run separately
# from ~/cyborg/brain-db/migrate_career_os.py.
#
# This script only:
#   1. Stamps version.
#   2. Warns if the cyborg-brain-db container is not running, since
#      v0.21.0 no longer falls back to .md — skills will fail hard on
#      DB-down.
#
# Idempotent — safe to re-run.

set -euo pipefail

CONTEXT_DIR="${1:-.}"

mkdir -p "$CONTEXT_DIR/.career-os/config"
mkdir -p "$CONTEXT_DIR/.career-os/logs"

echo "0.21.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.20.0 → v0.21.0 complete."
echo ""
echo "⚠️  Heads up: Dolt is now REQUIRED. The .md fallback was removed."
echo ""
echo "Check Dolt is up:"
echo "  docker ps --filter 'name=cyborg-brain-db'"
echo ""
echo "If not running, start it:"
echo "  docker start cyborg-brain-db"
echo ""
echo "Validate from this workspace:"
echo "  python3 ~/aiprojects/career-os-plugin/scripts/cyborg-db.py status"
