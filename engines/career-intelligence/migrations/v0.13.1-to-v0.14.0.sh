#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
mkdir -p "$CONTEXT_DIR/.career-os/scripts"
echo "0.14.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.13.1 → v0.14.0 complete (4 new skills, apply dashboard system)"
