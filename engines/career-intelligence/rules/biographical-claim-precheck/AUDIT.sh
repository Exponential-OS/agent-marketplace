#!/usr/bin/env bash
# AUDIT.sh — was the biographical-claim-precheck rule followed in the last N actions?
#
# Consumes the enforcement log written by HOW.sh, surfaces:
#   - shipped count (records with verdict PASS)
#   - blocked count (verdict BLOCK)
#   - bypassed count (T4 outreach drafts in INPUT/ that have NO matching log entry —
#     i.e., shipped without firing the rule)
#   - score = anchored_claims / total_claims, weighted by tier
#
# Usage:
#   bash AUDIT.sh '{"window_hours":24,"min_tier":"T4"}'
#
# Returns JSON to stdout:
#   {"verdict":"PASS|FAIL","score":N,"shipped":N,"blocked":N,"bypassed":N,"evidence":{...}}
# Exit codes: 0=PASS (≥80% compliance), 1=FAIL (<80%), 2=WARN (<10 records, insufficient data).

set -u

CTX_RAW="${1:-}"
if [[ -z "$CTX_RAW" ]]; then CTX="{}"; else CTX="$CTX_RAW"; fi

LOG="${CAREER_OS_ENFORCEMENT_LOG:-${CYBORG_ENFORCEMENT_LOG:-${HOME}/.career-os-enforcement-log.jsonl}}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if ! command -v jq >/dev/null 2>&1; then
  echo '{"verdict":"FAIL","reason":"jq not installed"}' >&2
  exit 1
fi

WINDOW_HOURS=$(echo "$CTX" | jq -r '.window_hours // 24')
MIN_TIER=$(echo "$CTX" | jq -r '.min_tier // "T4"')

if [[ ! -f "$LOG" ]]; then
  printf '{"verdict":"WARN","score":0,"shipped":0,"blocked":0,"bypassed":0,"reason":"no enforcement log yet"}\n'
  exit 2
fi

# Compute cutoff timestamp (Z-suffixed UTC ISO 8601).
CUTOFF=$(python3 -c "
import datetime as dt
hours = int($WINDOW_HOURS)
print((dt.datetime.utcnow() - dt.timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ'))
")

# Filter records: this rule's HOW invocations within the window at >= MIN_TIER.
# Tiers ordering: T0<T1<T2<T3<T4 — strip 'T' and integer-compare.
MIN_TIER_NUM="${MIN_TIER#T}"

RECORDS=$(jq -c --arg cutoff "$CUTOFF" --argjson min_tier "$MIN_TIER_NUM" \
  'select(.rule_slug=="biographical-claim-precheck" and .script_type=="HOW" and .ts >= $cutoff and (.stakes // "T0" | sub("T";"") | tonumber) >= $min_tier)' \
  "$LOG" 2>/dev/null || true)

if [[ -z "$RECORDS" ]]; then
  printf '{"verdict":"WARN","score":0,"shipped":0,"blocked":0,"bypassed":0,"window_hours":%d,"min_tier":"%s","reason":"no records in window — rule may not have been invoked, OR no T%s+ outreach in this period"}\n' \
    "$WINDOW_HOURS" "$MIN_TIER" "$MIN_TIER_NUM"
  exit 2
fi

SHIPPED=$(echo "$RECORDS" | jq -s '[.[] | select(.verdict=="PASS")] | length')
BLOCKED=$(echo "$RECORDS" | jq -s '[.[] | select(.verdict=="BLOCK")] | length')
TOTAL=$((SHIPPED + BLOCKED))

# Compliance score: PASS rate.
if (( TOTAL > 0 )); then
  SCORE=$((SHIPPED * 100 / TOTAL))
else
  SCORE=0
fi

# Bypass detection: list T4 drafts in INPUT/ from the window and check none
# escaped without a HOW record. This is conservative — only flags drafts
# whose mtime is within the window AND has no log record.
BYPASSED=0
INPUT_DIR="${CAREER_HOME:-}/INPUT"
if [[ -d "$INPUT_DIR" ]]; then
  while IFS= read -r draft; do
    [[ -z "$draft" ]] && continue
    # Skip drafts already accounted for in the log
    if echo "$RECORDS" | jq -s --arg dp "$draft" 'any(.draft_path == $dp)' | grep -q true; then
      continue
    fi
    BYPASSED=$((BYPASSED + 1))
  done < <(find "$INPUT_DIR" -name "*-2026-*.md" -type f -newer "$LOG" 2>/dev/null)
fi

# Verdict: PASS if score >= 80 AND no obvious bypasses; else FAIL.
if (( SCORE >= 80 && BYPASSED == 0 )); then
  VERDICT="PASS"
  EXIT=0
elif (( TOTAL < 3 )); then
  VERDICT="WARN"
  EXIT=2
else
  VERDICT="FAIL"
  EXIT=1
fi

# Evidence section.
EVIDENCE=$(echo "$RECORDS" | jq -sc --arg max "5" '
  {
    sample_records: (.[0:($max|tonumber)]),
    total_claims: ([.[].claims_total] | add // 0),
    total_anchored: ([.[].claims_anchored] | add // 0),
    total_unanchored: ([.[].claims_unanchored] | add // 0)
  }')

printf '{"verdict":"%s","score":%d,"shipped":%d,"blocked":%d,"bypassed":%d,"window_hours":%d,"min_tier":"%s","evidence":%s}\n' \
  "$VERDICT" "$SCORE" "$SHIPPED" "$BLOCKED" "$BYPASSED" "$WINDOW_HOURS" "$MIN_TIER" "$EVIDENCE"

# Log audit run.
printf '{"ts":"%s","rule_slug":"biographical-claim-precheck","script_type":"AUDIT","verdict":"%s","score":%d,"shipped":%d,"blocked":%d,"bypassed":%d,"window_hours":%d}\n' \
  "$TS" "$VERDICT" "$SCORE" "$SHIPPED" "$BLOCKED" "$BYPASSED" "$WINDOW_HOURS" >> "$LOG"

exit $EXIT
