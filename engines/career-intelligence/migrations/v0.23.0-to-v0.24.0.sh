#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration v0.23.0 → v0.24.0
#
# Substrate rollback. The Dolt + Neo4j + Redis substrate decision (v0.20.0
# → v0.23.0) was rolled back on 2026-04-26 — the brain layer is FILE-ONLY
# again. The Dolt SQL adapter (scripts/cyborg-db.py + dev/memory_adapter.py)
# is deprecated and will raise AdapterDeprecated when invoked.
#
# Also lands: biographical-claim-precheck wired into outreach-composer
# + resume-engine SKILL.md (mandatory pre-write canonical-trace gate);
# co-dialectic mode toggle codified as session-scoped + codi demo preset;
# judge-panel API fallback gated to CLI-not-installed-only.
#
# This migration is a version stamp + advisory — there are NO data
# transformations to perform on the user's .career-os/ workspace. Direct
# markdown reads still work; existing brain files are unchanged.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.24.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.23.0 → v0.24.0 complete (substrate rollback + biographical-claim-precheck wiring)."
echo ""
echo "What changed in v0.24.0:"
echo "  • SUBSTRATE: Dolt / Neo4j / Redis → file-only. No DB. No container."
echo "  • Skills now wire biographical-claim-precheck on T4 outreach drafts."
echo "  • co-dialectic mode toggle is session-scoped + new 'codi demo' preset."
echo "  • judge-panel API fallback only fires when OAuth CLI is not installed."
echo ""

# Advisory: warn if user has Dolt-era artifacts that the plugin no longer uses.
if [[ -d "$CONTEXT_DIR/.career-os/cyborg-db" ]]; then
  echo "⚠️  Detected legacy directory: .career-os/cyborg-db/"
  echo "   This was the Dolt runtime cache (v0.20.0 – v0.23.0). It is no"
  echo "   longer used. You can safely remove it:"
  echo "     rm -rf .career-os/cyborg-db/"
  echo "   (Plugin does not auto-delete to respect your data sovereignty.)"
  echo ""
fi

if command -v docker >/dev/null 2>&1; then
  if docker ps -a --filter "name=cyborg-brain-db" --format "{{.Names}}" 2>/dev/null | grep -q cyborg-brain-db; then
    echo "⚠️  Detected legacy Docker container: cyborg-brain-db"
    echo "   The Dolt SQL substrate is no longer used in v0.24.0+. To stop +"
    echo "   remove it:"
    echo "     docker stop cyborg-brain-db && docker rm cyborg-brain-db"
    echo ""
  fi
fi

echo "Memory access patterns (v0.24.0+):"
echo "  • Bash:   grep -lE '^tier: FULL_INVEST' ~/anand-career-os/brain/projects/job-search/roles/*.md"
echo "  • Python: pyyaml + pathlib (see docs/MEMORY-ACCESS.md for examples)"
echo ""
echo "Marketplace:"
echo "  • Canonical install: /plugin marketplace add Exponential-OS/agent-marketplace"
echo "                        /plugin install career-os@thewhyman"
