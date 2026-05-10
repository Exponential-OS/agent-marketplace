#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.13.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.12.1 → v0.13.0 complete"
