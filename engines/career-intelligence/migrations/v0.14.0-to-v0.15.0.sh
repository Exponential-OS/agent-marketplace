#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
set -euo pipefail
CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.15.0" > "$CONTEXT_DIR/.career-os/config/version"
echo "✅ Migration v0.14.0 → v0.15.0 complete (MC v2 dispatcher, JD fetch gate)"
