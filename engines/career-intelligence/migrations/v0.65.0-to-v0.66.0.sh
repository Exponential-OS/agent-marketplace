#!/usr/bin/env bash
# Migration v0.65.0 → v0.66.0
#
# Judge finding D-4: flat-workspace path migration check.
#
# This version upgrades the workspace path layout from the legacy brain/
# nested shape to the flat xOS workspace shape:
#
#   BEFORE (v0.65.0 and earlier):
#     $CAREER_HOME/brain/network/people/     → contact profiles
#     $CAREER_HOME/brain/identity/           → identity primitives
#     $CAREER_HOME/brain/projects/job-search/job-pipeline.json → pipeline
#
#   AFTER (v0.66.0+):
#     $CAREER_HOME/network/people/           → contact profiles
#     $CAREER_HOME/identity/                 → identity primitives
#     $CAREER_HOME/career-intelligence/pipeline.json → pipeline
#
# This script CHECKS whether the old brain/ shape is present and emits a
# clear error pointing to the workspace-level migration tool if so.
# It does NOT perform the migration itself — that is handled by:
#   bun run $CAREER_HOME/migrate-to-flat-workspace.ts --execute
#
# Idempotent: re-running is safe (check-only, no mutations).
#
# Usage (called by engine installer / upgrade hook):
#   bash migrations/v0.65.0-to-v0.66.0.sh
#
# Exit codes:
#   0 = workspace is already in the flat layout (no action needed)
#   1 = legacy brain/ shape detected (migration required before upgrade)

set -euo pipefail

CAREER_HOME="${CAREER_HOME:-${HOME}/career-os}"

LEGACY_BRAIN_NETWORK="${CAREER_HOME}/brain/network"
LEGACY_BRAIN_IDENTITY="${CAREER_HOME}/brain/identity"
LEGACY_BRAIN_PIPELINE="${CAREER_HOME}/brain/projects/job-search/job-pipeline.json"

FOUND_LEGACY=0

if [ -d "${LEGACY_BRAIN_NETWORK}" ]; then
  echo "[v0.65.0-to-v0.66.0] ERROR: legacy brain/network/ detected at ${LEGACY_BRAIN_NETWORK}" >&2
  FOUND_LEGACY=1
fi

if [ -d "${LEGACY_BRAIN_IDENTITY}" ]; then
  echo "[v0.65.0-to-v0.66.0] ERROR: legacy brain/identity/ detected at ${LEGACY_BRAIN_IDENTITY}" >&2
  FOUND_LEGACY=1
fi

if [ -f "${LEGACY_BRAIN_PIPELINE}" ]; then
  echo "[v0.65.0-to-v0.66.0] ERROR: legacy brain/projects/job-search/job-pipeline.json detected at ${LEGACY_BRAIN_PIPELINE}" >&2
  FOUND_LEGACY=1
fi

if [ "${FOUND_LEGACY}" -eq 1 ]; then
  echo "" >&2
  echo "[v0.65.0-to-v0.66.0] MIGRATION REQUIRED before upgrading to v0.66.0." >&2
  echo "" >&2
  echo "  Run the workspace migration tool to move files to the flat layout:" >&2
  echo "    bun run \${CAREER_HOME}/migrate-to-flat-workspace.ts --execute" >&2
  echo "" >&2
  echo "  Then re-run this migration script to confirm the new layout." >&2
  echo "" >&2
  echo "  See: https://github.com/Exponential-OS/career-intelligence-engine/blob/main/docs/flat-workspace-migration.md" >&2
  exit 1
fi

echo "[v0.65.0-to-v0.66.0] OK: workspace is in flat layout. No migration needed." >&2
exit 0
