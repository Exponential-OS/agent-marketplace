#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration: v0.11.0 → v0.12.0
#
# Changes:
# - Shorthand aliases added to 7 skills (no data migration needed)
# - LinkedIn discovery, warm-path detection in job-search-scheduler (no data migration)
# - Stale pipeline self-evolution config file (pipeline-health.json)
# - Typed work item schema in cruise-control, apply-tracker, pipeline-sync
# - Boundary rules expanded in CLAUDE.md template (agent-writable paths)
# - New directories: interview-prep/, experiments/, reference/jd-samples/
#
# Data migration: scaffold new directories, version stamp only.
# SKILL.md changes are automatic (plugin update delivers new specs).

set -euo pipefail

CONTEXT_DIR="${1:-.}"

# Scaffold new directories for v0.12.0 features
mkdir -p "$CONTEXT_DIR/.career-os/interview-prep"
mkdir -p "$CONTEXT_DIR/.career-os/memory/experiments"
mkdir -p "$CONTEXT_DIR/.career-os/reference/jd-samples"
mkdir -p "$CONTEXT_DIR/.career-os/scans"

# Update version
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.12.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.11.0 → v0.12.0 complete"
echo "   - Scaffolded: interview-prep/, experiments/, reference/jd-samples/, scans/"
echo "   - New features: shorthand aliases, LinkedIn discovery, typed work items, stale pipeline P14"
