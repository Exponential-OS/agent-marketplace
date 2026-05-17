#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration v0.18.1 → v0.19.0
#
# Interview-prep filename convention normalization + legacy ingest.
# See WO-053 for full rationale.
#
# Changes:
#   1. Rename legacy interview-prep files to canonical prep-{slug}.md convention
#   2. Move insider-intel docs to intel-{slug}.md prefix
#   3. Move archived preps to _archive/ subdir
#   4. Ingest 3 loose WIP root files into plugin memory
#   5. Scaffold _archive/ + pipeline-snapshots/ dirs
#
# Idempotent — safe to re-run. Every rename checks target-doesn't-exist before moving.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
INTERVIEW_PREP_DIR="$CONTEXT_DIR/.career-os/interview-prep"
WIP_DIR="$CONTEXT_DIR/WIP"

mkdir -p "$INTERVIEW_PREP_DIR"
mkdir -p "$INTERVIEW_PREP_DIR/_archive"
mkdir -p "$CONTEXT_DIR/.career-os/memory/pipeline-snapshots"
mkdir -p "$CONTEXT_DIR/.career-os/config"

# Helper: idempotent rename. Skip if src missing OR dest already exists.
rename_if_needed() {
    local src="$1"
    local dest="$2"
    local label="$3"
    if [ -f "$src" ] && [ ! -f "$dest" ]; then
        mv "$src" "$dest"
        echo "  ✓ $label: $(basename "$src") → $(basename "$dest")"
    elif [ -f "$src" ] && [ -f "$dest" ]; then
        echo "  ⚠ $label: both $(basename "$src") AND $(basename "$dest") exist — manual resolution needed"
    fi
}

echo "── Migration v0.18.1 → v0.19.0 ──"
echo ""
echo "Normalizing interview-prep filename convention..."

# ── Change 1: Rename legacy prep files to prep-{slug}.md ──

rename_if_needed \
    "$INTERVIEW_PREP_DIR/affirm-recruiter-screen-prep.md" \
    "$INTERVIEW_PREP_DIR/prep-affirm.md" \
    "rename"

rename_if_needed \
    "$INTERVIEW_PREP_DIR/amazon-aws-core-networking-hm-prep.md" \
    "$INTERVIEW_PREP_DIR/prep-amazon-aws-core-networking.md" \
    "rename"

rename_if_needed \
    "$INTERVIEW_PREP_DIR/reid-gustin-openai-coffee-chat-prep.md" \
    "$INTERVIEW_PREP_DIR/prep-reid-gustin-openai.md" \
    "rename"

rename_if_needed \
    "$INTERVIEW_PREP_DIR/scale-ai-mihir-screen-prep.md" \
    "$INTERVIEW_PREP_DIR/prep-scale-ai-mihir.md" \
    "rename"

rename_if_needed \
    "$INTERVIEW_PREP_DIR/scale-ai-next-round-prep.md" \
    "$INTERVIEW_PREP_DIR/prep-scale-ai-next-round.md" \
    "rename"

# ── Change 2: insider-intel → intel-{slug}.md prefix ──

rename_if_needed \
    "$INTERVIEW_PREP_DIR/openai-insider-intel.md" \
    "$INTERVIEW_PREP_DIR/intel-openai.md" \
    "reclassify"

# ── Change 3: Archive stale preps ──

rename_if_needed \
    "$INTERVIEW_PREP_DIR/scale-ai-mihir-screen-ARCHIVED.md" \
    "$INTERVIEW_PREP_DIR/_archive/prep-scale-ai-mihir-ARCHIVED.md" \
    "archive"

# ── Change 4: Ingest loose WIP root files ──

if [ -d "$WIP_DIR" ]; then
    rename_if_needed \
        "$WIP_DIR/amazon-sdm-interview-prep.md" \
        "$INTERVIEW_PREP_DIR/prep-amazon-sdm-sagemaker-catalog.md" \
        "ingest"

    rename_if_needed \
        "$WIP_DIR/amazon-sdm-interview-prep-apr20.md" \
        "$INTERVIEW_PREP_DIR/prep-amazon-sdm-apr20.md" \
        "ingest"

    rename_if_needed \
        "$WIP_DIR/handshake-recruiter-screen-prep.md" \
        "$INTERVIEW_PREP_DIR/prep-handshake-senior-em.md" \
        "ingest"
fi

# ── Version stamp ──

echo "0.19.0" > "$CONTEXT_DIR/.career-os/config/version"

echo ""
echo "✅ Migration v0.18.1 → v0.19.0 complete"
echo "   - Interview-prep filenames normalized to prep-{slug}.md / intel-{slug}.md"
echo "   - Archived preps moved to _archive/"
echo "   - 3 loose WIP root files ingested (if present)"
echo "   - Scaffolded: .career-os/memory/pipeline-snapshots/"
