#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration v0.19.1 → v0.20.0
#
# ADR-003: Dolt memory substrate lands.
# New surface: dev/memory_adapter.py + scripts/cyborg-db.py + tests/test_memory_adapter.py.
#
# Data transform: NONE in this migration. The adapter reads the same .md files
# skills already read; Dolt is a shadow/query layer loaded by a separate
# cyborg-wide migration (~/cyborg/brain-db/migrate_career_os.py) that runs
# against the cyborg_brain Docker container — NOT from per-workspace install.
#
# This shell script only:
#   1. Stamps version.
#   2. Writes default env defaults if missing (so the adapter has sane values).
#   3. Creates the logs dir for adapter-fallback tracking.
#
# Idempotent — safe to re-run.

set -euo pipefail

CONTEXT_DIR="${1:-.}"

mkdir -p "$CONTEXT_DIR/.career-os/config"
mkdir -p "$CONTEXT_DIR/.career-os/logs"

echo "0.20.0" > "$CONTEXT_DIR/.career-os/config/version"

# Seed adapter defaults (only if file doesn't already exist — never overwrite user config)
ENV_FILE="$CONTEXT_DIR/.career-os/config/memory-adapter.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# Career-OS memory adapter config (v0.20.0+)
# Adapter: dev/memory_adapter.py
# See: WIP/career-os-product/specs/ADR-003-memory-substrate-dolt.md

CYBORG_DB_HOST=127.0.0.1
CYBORG_DB_PORT=3306
CYBORG_DB_NAME=cyborg_brain
CYBORG_DB_USER=root
CYBORG_DB_PASSWORD=
CYBORG_DB_TIMEOUT=3

# auto | dolt | md
CAREER_OS_MEMORY_BACKEND=auto
EOF
  echo "✅ Seeded $ENV_FILE"
fi

echo "✅ Migration v0.19.1 → v0.20.0 complete."
echo ""
echo "Next steps (only if you want the Dolt backend active):"
echo "  1. Start Dolt:   docker run -d --name cyborg-brain-db -p 3306:3306 \\"
echo "                     -v \$HOME/cyborg/brain-db:/var/lib/dolt \\"
echo "                     dolthub/dolt-sql-server:latest"
echo "  2. Migrate data: python3 ~/cyborg/brain-db/migrate_career_os.py --all"
echo "  3. Verify:       python3 scripts/cyborg-db.py status"
echo ""
echo "If Docker / Dolt isn't running, the adapter falls back to .md silently."
