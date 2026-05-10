#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.10.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.9.1 → v0.10.0 complete (stale pipeline detection, mission-control eval suite)"
