#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration v0.26.0 → v0.27.0
#
# `interviewer-research` skill added — auto-fires on apply-tracker's
# Screen → Interview / Panel Scheduled transitions; spawns parallel
# research sub-agents per interviewer; outputs an aggregated dossier
# at INPUT/[company-slug]-[date]-prep-dossier.md plus a kind:prep
# GitHub Issue.
#
# The parallelization win: N interviewers = N parallel sub-agent research
# tasks. Per-interviewer mechanism: live web research via Perplexity MCP,
# LinkedIn structured profile fetch (when URL known), story-to-question
# mapping from the user's STORY_INDEX, watch-outs synthesis.
#
# apply-tracker integration: the Screen → Interview transition trigger now
# invokes this skill. Existing per-round kind:prep GitHub Issues remain
# (talking-points generation stays with the `interview-prep` skill).
#
# This migration is a version stamp + advisory only — there are NO data
# transformations to perform on the user's workspace. Existing canonical
# files at <workspace>/brain/identity/ and <workspace>/brain/stories/
# are read-only inputs.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.27.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.26.0 → v0.27.0 complete (interviewer-research skill added)."
echo ""
echo "What changed in v0.27.0:"
echo "  • NEW SKILL: interviewer-research — auto-fires on apply-tracker"
echo "    Screen → Interview / Panel Scheduled transitions; spawns N parallel"
echo "    research sub-agents (one per interviewer); aggregates dossier."
echo "  • Output: INPUT/[company-slug]-[date]-prep-dossier.md + kind:prep"
echo "    GitHub Issue at thewhyman/anand-career-os."
echo "  • Per-interviewer mechanism: Perplexity MCP (research) + LinkedIn MCP"
echo "    (profile fetch) + canonical experience-history.md + STORY_INDEX"
echo "    competency clusters."
echo "  • apply-tracker SKILL.md: added trigger block in the Screen → Interview"
echo "    transition section (existing per-round kind:prep issues remain)."
echo ""
echo "Origin: 2026-04-27 panel-prep automation gap — user advanced to a"
echo "2-interviewer panel and faced 30+ min of manual research per panel"
echo "without automation. Ship-tonight target for next-day conference demo."
echo ""
echo "Read-only on brain layer. P15 multi-agent safe by construction."
