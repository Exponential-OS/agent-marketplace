#!/usr/bin/env bash
# Migration v0.25.1 → v0.26.0
#
# `outreach-fact-check` skill added — read-only T4 pre-flight verifier for
# biographical claims, with folded pre-send-check mode (PreToolUse hook on
# outgoing-message tools blocks `mismatch` verdicts at ship time).
#
# Two modes (one verification engine):
#   - Mode 1 (on-demand): explicit `verify claim: <text>` OR Protocol 8 dispatch.
#   - Mode 2 (pre-send-check): PreToolUse hook on Gmail draft / LinkedIn DM
#     auto-fires on every outgoing message; BLOCKS on mismatch.
#
# 10 claim classes covered: tenure · title · scope · compensation · recognition
#   · education · speaking · identity · metric · comparative.
#
# Output schema includes `blast_radius_note` field (required for mismatch
# verdicts) — names other artifact paths/classes presumed to carry the same
# error class, so a single mismatch fires the multi-dim sweep that catches
# cancer cells single-slot fixes leave behind.
#
# This skill is the dispatch target for co-dialectic v4.1 Protocol 8
# (Auto-Verify) when an artifact contains biographical claims at T3+ stakes.
# The Mode 2 wiring (PreToolUse hook) is the FAIL-HARD enforcement primitive
# that converts the verifier from advisory to mechanical at ship time.
#
# This migration is a version stamp + advisory only — there are NO data
# transformations to perform on the user's workspace. Existing canonical
# files at <workspace>/brain/identity/ are read-only inputs.

set -euo pipefail

CONTEXT_DIR="${1:-.}"

echo "✅ Migration v0.25.1 → v0.26.0 complete (outreach-fact-check skill added)."
echo ""
echo "What changed in v0.26.0:"
echo "  • NEW SKILL: outreach-fact-check — T4 pre-flight verifier with two"
echo "    modes (on-demand verify + pre-send-check enforcement hook)."
echo "  • 10 claim classes: tenure, title, scope, compensation, recognition,"
echo "    education, speaking, identity, metric, comparative."
echo "  • Canonical sources read (active incarnation's brain layer):"
echo "      <workspace>/brain/identity/experience-history.md"
echo "      <workspace>/brain/identity/identity.md"
echo "      <workspace>/brain/identity/awards-education-speaking.md"
echo "  • Output schema: verdict + canonical_source (tilde-prefixed) +"
echo "    canonical_excerpt + diff + confidence + remediation + (for"
echo "    mismatch verdicts) blast_radius_note for multi-dim sweep."
echo "  • Dispatch target for co-dialectic v4.1 Protocol 8 (Auto-Verify)."
echo ""
echo "  📌 Mode 2 wiring (optional): to enable pre-send-check enforcement,"
echo "      add a PreToolUse hook in ~/.claude/settings.json:"
echo ""
echo '      "PreToolUse": [{"matcher": "mcp__claude_ai_Gmail__create_draft",'
echo '        "hooks": [{"type": "command",'
echo '          "command": "<plugin-path>/skills/outreach-fact-check/preflight.sh"}]}]'
echo ""
echo "      Without the hook, Mode 1 (on-demand) is fully functional but"
echo "      bypassable. With the hook, every outgoing draft is checked"
echo "      automatically and BLOCKS on mismatch."
echo ""
echo "Origin (2026-04-26 outreach near-miss): an agent inherited a draft"
echo "with multiple unanchored biographical claims; canonical sources"
echo "contradicted three of them. T4 outreach to a real human in PANIC-mode"
echo "warm-path. User caught pre-send. This skill closes that immunity gap."
