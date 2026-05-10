#!/usr/bin/env bash
# Migration v0.27.0 → v0.28.0
#
# Brain-layer canonicalization: all Career OS data files now live under
# brain/ as the single source of truth. .career-os/memory/ no longer holds
# data files — only plugin-managed metadata (ledger/, config/, logs/,
# scripts/, memory/stories/.schema-version).
#
# What this migration does:
#   1. Moves any remaining data files from .career-os/memory/ → brain/
#      (idempotent: skips if already moved)
#   2. Removes any .career-os/memory/ symlinks from previous migration
#      attempts
#   3. Stamps the new version
#
# No schema changes to data files themselves — pure relocation.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
MEM="$CONTEXT_DIR/.career-os/memory"
BRAIN="$CONTEXT_DIR/brain"

move_if_exists() {
  local src="$1" dst="$2"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    mv "$src" "$dst"
    echo "  moved: $src → $dst"
  elif [ -f "$src" ] && [ -f "$dst" ]; then
    echo "  skip (already at dst): $dst"
    rm "$src"
  fi
}

remove_symlink() {
  local path="$1"
  if [ -L "$path" ]; then
    rm "$path"
    echo "  removed symlink: $path"
  fi
}

echo "→ v0.27.0 → v0.28.0: brain-layer canonicalization"

# 1. Move remaining data files (idempotent)
move_if_exists "$MEM/identity.md"                   "$BRAIN/identity/identity.md"
move_if_exists "$MEM/glossary.md"                   "$BRAIN/identity/glossary.md"
move_if_exists "$MEM/skills-matrix.md"              "$BRAIN/identity/skills-matrix.md"
move_if_exists "$MEM/career-strategy.md"            "$BRAIN/identity/career-strategy.md"
move_if_exists "$MEM/job-pipeline.md"               "$BRAIN/projects/job-search/job-pipeline.md"
move_if_exists "$MEM/job-pipeline-match-tracker.md" "$BRAIN/projects/job-search/job-pipeline-match-tracker.md"
move_if_exists "$MEM/jd-alignment-framework.md"     "$BRAIN/projects/jd-alignment-framework.md"
move_if_exists "$MEM/resume-generation-guide.md"    "$BRAIN/projects/resume-generation-guide.md"
move_if_exists "$MEM/ats-platform-rules.md"         "$BRAIN/projects/ats-platform-rules.md"
move_if_exists "$MEM/social-channel-directory.md"   "$BRAIN/distribution/social-channel-directory.md"
move_if_exists "$MEM/recommendations-referrals.md"  "$BRAIN/network/recommendations-referrals.md"
move_if_exists "$MEM/companies.md"                  "$BRAIN/network/companies.md"

# Move people/ files if any remain
if [ -d "$MEM/people" ] && [ ! -L "$MEM/people" ]; then
  for f in "$MEM/people"/*.md; do
    [ -f "$f" ] || continue
    fname="$(basename "$f")"
    move_if_exists "$f" "$BRAIN/network/people/$fname"
  done
fi

# Move stories/ files if any remain (excluding plugin metadata)
if [ -d "$MEM/stories" ] && [ ! -L "$MEM/stories" ]; then
  find "$MEM/stories" -name "*.md" | while read -r f; do
    rel="${f#$MEM/stories/}"
    move_if_exists "$f" "$BRAIN/stories/$rel"
  done
fi

# 2. Remove any lingering symlinks from previous migration attempts
remove_symlink "$MEM/stories"
remove_symlink "$MEM/people"
remove_symlink "$MEM/identity.md"
remove_symlink "$MEM/glossary.md"
remove_symlink "$MEM/skills-matrix.md"
remove_symlink "$MEM/career-strategy.md"
remove_symlink "$MEM/job-pipeline.md"
remove_symlink "$MEM/job-pipeline-match-tracker.md"

# Remove nested symlink in stories/ if it got created
remove_symlink "$MEM/stories/stories"

# 3. Stamp version
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.28.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.27.0 → v0.28.0 complete."
echo ""
echo "What changed in v0.28.0:"
echo "  • BRAIN LAYER: all data files now live in brain/ (no more .career-os/memory/ data)"
echo "  • SKILL PATHS: all 21 skill SKILL.md files updated to reference brain/ directly"
echo "  • NO SYMLINKS: .career-os/memory/ is now metadata-only (ledger, config, logs)"
echo "  • DATA: no content changes — pure relocation"
echo ""
