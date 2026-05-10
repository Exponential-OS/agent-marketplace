#!/usr/bin/env bash
# Migration: v0.6.0 → v0.7.0
# Description: Version stamp for new skills + enrichment features.
# New in v0.7.0: interview-prep, resume-engine, outreach-composer, network-intelligence skills;
#   enrichment flow, gap detection, branded headers, session-logger fixes.
# This script is idempotent — safe to run multiple times.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.7.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.6.0 → v0.7.0 complete"
