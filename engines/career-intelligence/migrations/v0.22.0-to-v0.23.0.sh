#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration v0.22.0 → v0.23.0
#
# Indexed temporal queries (Gemini v0.21.0 finding #5 fix). Adds parallel
# DATE columns alongside existing VARCHAR date columns on the high-value
# query targets. Strangler-fig — old VARCHAR columns stay.
#
# Live Dolt schema changes already shipped during the v0.23.0 development
# loop (dolt_commit 5fttmml944du). Migration script (~/cyborg/brain-db/
# migrate_career_os.py) updated to populate _dt columns during ingest.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.23.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.22.0 → v0.23.0 complete (version stamp)."
echo ""
echo "Backward-compatible additions:"
echo "  • 7 parallel DATE columns (roles / applications / events / stories / people)"
echo "  • 7 indexes on the new _dt columns"
echo "  • Adapter: list_roles(batch_after=, batch_before=)"
echo "             list_recent_stories(since=)"
echo "             list_people(last_contact_before=, last_contact_after=)"
echo ""
echo "If you want _dt columns populated for existing rows:"
echo "  python3 ~/cyborg/brain-db/migrate_career_os.py --all"
