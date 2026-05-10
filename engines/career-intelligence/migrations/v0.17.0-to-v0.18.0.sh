#!/usr/bin/env bash
# Migration v0.17.0 → v0.18.0
#
# This release bundles:
#   - WO-043: Greenhouse portal verification (REQ-001)
#   - WO-044: Cover letter DOCX/PDF + opt-in gate (REQ-002)
#   - WO-045: SSOT skill read paths (REQ-003)
#   - WO-046: Session-logger ledger push fix (GAP-002)
#   - WO-047: Rename scorer → job-match-scorer (P9)
#   - WO-048: pipeline-query.py 10-col tracker schema fix
#   - WO-049: mission-control recursive story count
#   - WO-051: Schema Evolution Protocol enforcement (ADR-002 Accepted)
#   - WO-052: SessionStart first-run gate fix (.career-os/ not .git/)
#   - WO-053: Backfill schema version headers (this script)
#   - ADR-001 SSOT write-path rules across owner skills
#
# WO-053 data transforms (idempotent — safe to re-run):
#   - Add <!-- schema: vX.Y --> header to line 1 of shared-structure files
#     if not already present. See schemas/shared-structures.md for the
#     registry and current version numbers.
#   - Drop .schema-version marker files into stories/ and people/ dirs.
#
# All adds are non-destructive: if a header already exists or if the file
# is missing, the migration is a no-op for that structure.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
CAREER_OS="$CONTEXT_DIR/.career-os"

mkdir -p "$CAREER_OS/config"

# --- WO-053: Schema version header backfill ---

# Helper: prepend a header to a file IF the file exists AND doesn't already
# have a `<!-- schema:` marker anywhere in its first 3 lines.
prepend_schema_header() {
    local file="$1"
    local version="$2"
    if [ ! -f "$file" ]; then
        return 0  # file doesn't exist — skip silently
    fi
    if head -n 3 "$file" 2>/dev/null | grep -q "<!-- schema:"; then
        return 0  # already has a header — idempotent no-op
    fi
    # Prepend header + blank line
    local tmp
    tmp=$(mktemp)
    {
        echo "<!-- schema: v${version} -->"
        cat "$file"
    } > "$tmp"
    mv "$tmp" "$file"
    echo "  → added schema header v${version} to $(basename "$file")"
}

# Helper: write a .schema-version marker file inside a directory.
write_dir_schema_version() {
    local dir="$1"
    local version="$2"
    if [ ! -d "$dir" ]; then
        return 0  # directory doesn't exist — skip silently
    fi
    local marker="$dir/.schema-version"
    if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null | tr -d '[:space:]')" = "$version" ]; then
        return 0  # already at the right version — idempotent
    fi
    echo "$version" > "$marker"
    echo "  → wrote schema version v${version} to $(basename "$dir")/.schema-version"
}

echo "WO-053: Backfilling schema version headers..."

# Markdown files (header comment on line 1)
prepend_schema_header "$CAREER_OS/memory/job-pipeline-match-tracker.md" "2.0"
prepend_schema_header "$CAREER_OS/memory/job-pipeline.md"               "1.0"
prepend_schema_header "$CAREER_OS/memory/skills-matrix.md"              "1.0"
prepend_schema_header "$CAREER_OS/tasks/Tasks.md"                       "1.0"

# Directory layouts (.schema-version marker file)
write_dir_schema_version "$CAREER_OS/memory/stories" "2.0"
write_dir_schema_version "$CAREER_OS/memory/people"  "1.0"

# Bump the plugin data version
echo "0.18.0" > "$CAREER_OS/config/version"

echo "✅ Migration v0.17.0 → v0.18.0 complete"
echo "   Release notes: WO-043 Greenhouse, WO-044 cover letter DOCX/PDF, WO-047 scorer rename,"
echo "                  WO-048 tracker 10-col fix, WO-049 recursive stories, WO-051 ADR-002 protocol,"
echo "                  WO-052 first-run gate, WO-053 schema header backfill."
