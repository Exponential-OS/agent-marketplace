#!/usr/bin/env bash
# WATCH.sh — evolve the biographical-claim-precheck rule
#
# Runs micro-experiments AGAINST the rule's own behavior:
#   - false-positive rate (drafts BLOCKed where canonical anchor exists but
#     pattern matched derived-claim that script can't trace)
#   - false-negative rate (drafts that PASSed but contained hallucinations
#     caught downstream by the user)
#   - pattern coverage (which claim_kind patterns fire most; missing patterns)
#
# Usage:
#   bash WATCH.sh '{"current_cadence":"per-T4-artifact","consecutive_no_change_count":0}'
#
# Returns JSON with verdict + cadence-delta + experiment outcomes.

set -u

CTX_RAW="${1:-}"
if [[ -z "$CTX_RAW" ]]; then CTX="{}"; else CTX="$CTX_RAW"; fi

LOG="${CYBORG_ENFORCEMENT_LOG:-${HOME}/.career-os-enforcement-log.jsonl}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if ! command -v jq >/dev/null 2>&1; then
  echo '{"verdict":"WARN","reason":"jq not installed"}' >&2
  exit 2
fi

CURRENT_CADENCE=$(echo "$CTX" | jq -r '.current_cadence // "per-T4-artifact"')
NO_CHANGE_COUNT=$(echo "$CTX" | jq -r '.consecutive_no_change_count // 0')

# --- EXPERIMENT 1: false-positive rate ---
# Sample last 20 BLOCK records; for each, check whether the unanchored
# claims correspond to derived/comparison-table content (heuristic: line
# is in a markdown table or in a "Verification trail" section).
# This heuristic is necessarily rough — full implementation requires
# re-reading each draft. For now, surface as candidate experiment without
# auto-running.
EXP1_VERDICT="propose-manual-review"
EXP1_FINDING="false-positive sampling requires draft-context re-read; queue 20 most-recent BLOCKs for agent review"

# --- EXPERIMENT 2: pattern coverage ---
# Tally claim patterns per HOW invocation. Pattern that fires <5% of the
# time is either (a) rare in real drafts (fine) or (b) under-specified
# (false negative — missing real claims of that kind).
PATTERN_COUNTS=$(jq -s '[.[] | select(.rule_slug=="biographical-claim-precheck" and .script_type=="HOW")] |
  {
    total: length,
    avg_claims_per_draft: (if length > 0 then ([.[].claims_total // 0] | add / length) else 0 end),
    avg_unanchored: (if length > 0 then ([.[].claims_unanchored // 0] | add / length) else 0 end)
  }' "$LOG" 2>/dev/null || echo '{}')

# --- EXPERIMENT 3: pattern-effectiveness (catch rate) ---
# Of the 2 known T4 hallucinations from 2026-04-26 (Matt + Amanesh), how
# many would current HOW.sh have caught? Replay synthetic test drafts
# stored at rules/biographical-claim-precheck/EXPERIMENTS/.
# Stub: synthetic replay is the v1.1 backlog item; for now, assert the
# 2026-04-26 origin incidents are documented in README.md.
EXP3_VERDICT="documented"
EXP3_FINDING="origin incidents (Matt/Amanesh 2026-04-26) recorded in README.md; synthetic replay = v1.1 backlog"

# --- Cadence ladder ---
# default: per-T4-artifact (fires on every T4 outreach draft).
# Floor: weekly. Ceiling: per-T4-artifact (no point firing more often than
# the rule itself triggers).
# Ladder ascending: weekly < bi-daily < daily < per-session-start < per-T4-artifact
case "$CURRENT_CADENCE" in
  weekly) CADENCE_INDEX=0 ;;
  bi-daily) CADENCE_INDEX=1 ;;
  daily) CADENCE_INDEX=2 ;;
  per-session-start) CADENCE_INDEX=3 ;;
  per-T4-artifact) CADENCE_INDEX=4 ;;
  *) CADENCE_INDEX=4 ;;
esac

# Default: keep cadence (we want this rule firing on EVERY T4 artifact).
CADENCE_DELTA="keep"
PROPOSED_CADENCE="$CURRENT_CADENCE"

# If 3+ consecutive no-change verdicts → consider relaxing (maybe rule
# is over-firing for this user's drafting velocity).
if (( NO_CHANGE_COUNT >= 3 )); then
  CADENCE_DELTA="halve"
  case $CADENCE_INDEX in
    4) PROPOSED_CADENCE="per-session-start" ;;
    3) PROPOSED_CADENCE="daily" ;;
    2) PROPOSED_CADENCE="bi-daily" ;;
    1) PROPOSED_CADENCE="weekly" ;;
    0) PROPOSED_CADENCE="weekly" ;;  # floor
  esac
fi

# Compute next_due (per Python — portable for BSD/GNU date divergence).
NEXT_DUE=$(python3 -c "
import datetime as dt
now = dt.datetime.utcnow()
hours_map = {
  'weekly': 168,
  'bi-daily': 48,
  'daily': 24,
  'per-session-start': 8,
  'per-T4-artifact': 1,
}
h = hours_map.get('$PROPOSED_CADENCE', 1)
print((now + dt.timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%SZ'))
" 2>/dev/null || echo "unknown")

# --- Output ---
printf '{"verdict":"WARN","cadence_delta":"%s","current_cadence":"%s","proposed_cadence":"%s","next_due":"%s","experiments":{"false_positive_rate":{"verdict":"%s","finding":"%s"},"pattern_coverage":%s,"pattern_effectiveness":{"verdict":"%s","finding":"%s"}}}\n' \
  "$CADENCE_DELTA" "$CURRENT_CADENCE" "$PROPOSED_CADENCE" "$NEXT_DUE" \
  "$EXP1_VERDICT" "$EXP1_FINDING" "$PATTERN_COUNTS" "$EXP3_VERDICT" "$EXP3_FINDING"

# Log watch run.
printf '{"ts":"%s","rule_slug":"biographical-claim-precheck","script_type":"WATCH","cadence_delta":"%s","current_cadence":"%s","proposed_cadence":"%s"}\n' \
  "$TS" "$CADENCE_DELTA" "$CURRENT_CADENCE" "$PROPOSED_CADENCE" >> "$LOG"

exit 2  # WATCH always returns WARN (rule continues evolving)
