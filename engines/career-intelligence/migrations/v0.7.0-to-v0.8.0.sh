#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.8.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.7.0 → v0.8.0 complete (shorthand aliases added to all skills)"
