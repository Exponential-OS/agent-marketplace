#!/usr/bin/env bash
# Migration v0.19.0 → v0.19.1
#
# Doc-coherence patch for v0.19.0. No data transforms.
# Version-stamp-only migration per release-plugin/SKILL.md Step 6.2.
#
# Scope of v0.19.1 release:
#   - schemas/shared-structures.md: add interview-prep/ + pipeline-snapshots/
#     directory layouts to registry per ADR-002 (v0.19.0 introduced them
#     but missed the registry entries themselves — this patch closes the gap)
#   - tests/test-hooks.sh: 2 new [C3] assertions guarding registry drift
#
# Idempotent — safe to re-run.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.19.1" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.19.0 → v0.19.1 complete (version stamp only)"
