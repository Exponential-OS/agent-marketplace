#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration v0.18.0 → v0.18.1
#
# Release-prep patch. No data transforms — documentation coherence only.
# Version-stamp-only migration per release-plugin/SKILL.md Step 6.2.
#
# Scope of v0.18.1 release:
#   - xOS architecture context added (WIP/xOS-product/ARCHITECTURE-TAXONOMY.md)
#   - Session-logger hook orphan fix deferred to end-of-session runbook
#   - Unified ci.sh spec referenced (WIP/xOS-product/UNIFIED-CI-SPEC.md)
#   - CLAUDE.md version + skill-count drift corrected
#   - CHANGELOG.md introduced
#
# Idempotent — safe to re-run.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.18.1" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.18.0 → v0.18.1 complete (version stamp only)"
