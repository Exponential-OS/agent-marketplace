#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.11.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.10.0 → v0.11.0 complete"
