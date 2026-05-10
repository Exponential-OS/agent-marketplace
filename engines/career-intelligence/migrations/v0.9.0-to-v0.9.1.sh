#!/usr/bin/env bash
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.9.1" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.9.0 → v0.9.1 complete (dev CI pipeline, directory guards)"
