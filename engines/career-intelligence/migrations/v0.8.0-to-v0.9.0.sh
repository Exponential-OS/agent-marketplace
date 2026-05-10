#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
mkdir -p "$CONTEXT_DIR/.career-os/scans"
echo "0.9.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.8.0 → v0.9.0 complete (4 new skills, A-MEM renamed, scan path updated)"
