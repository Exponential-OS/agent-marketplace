#!/usr/bin/env bash
# Migration v0.21.0 → v0.22.0
#
# Campaign-ready release. No data transforms in the workspace.
# Two surfaces touched (both backward-compatible):
#   1. Live Dolt: ALTER TABLE roles ADD COLUMN decision_tier VARCHAR(32)
#                 + INDEX idx_roles_decision_tier; back-populate from
#                 decision column. Already shipped during the v0.22.0
#                 development loop (dolt_commit la7mvc97qk9b).
#   2. Plugin file system: dev/ci-local.sh + docs/MEMORY-ACCESS.md
#                 added; CLAUDE.md + README.md updated. No state to
#                 migrate per workspace.
#
# This script only:
#   1. Stamps version.
#   2. Optionally re-runs migrate_career_os.py to ensure decision_tier
#      is populated for all roles in this workspace's Dolt.
#
# Idempotent — safe to re-run.

set -euo pipefail

CONTEXT_DIR="${1:-.}"

mkdir -p "$CONTEXT_DIR/.career-os/config"
mkdir -p "$CONTEXT_DIR/.career-os/logs"

echo "0.22.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.21.0 → v0.22.0 complete (version stamp)."
echo ""
echo "Two backward-compatible additions:"
echo "  1. dev/ci-local.sh — single-command Dolt+migrate+pytest"
echo "  2. docs/MEMORY-ACCESS.md — read/write pattern reference"
echo ""
echo "If you want decision_tier populated on existing roles in your Dolt:"
echo "  python3 ~/cyborg/brain-db/migrate_career_os.py roles"
echo ""
echo "Or run the full re-ingest:"
echo "  bash dev/ci-local.sh"
