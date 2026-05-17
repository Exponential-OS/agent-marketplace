#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.13.1" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.13.0 → v0.13.1 complete"
