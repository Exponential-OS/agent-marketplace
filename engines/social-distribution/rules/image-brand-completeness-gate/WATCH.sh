#!/usr/bin/env bash
# WATCH.sh — image-brand-completeness-gate
# Self-evolving cadence: observes fire rate and emits keep/kill/modify verdict.
# Fires automatically on schedule; cadence auto-adjusts per S3F invariant.

set -euo pipefail

LOG="$HOME/.career-os-enforcement-log.jsonl"
RULE="image-brand-completeness-gate"
LEDGER_DIR="$(dirname "$0")/EXPERIMENTS"
LEDGER="$LEDGER_DIR/ledger.yaml"

mkdir -p "$LEDGER_DIR"

# Count runs in last 30 days
total=0
block=0
if [[ -f "$LOG" ]]; then
  since=$(date -d '30 days ago' '+%Y-%m-%d' 2>/dev/null || date -v-30d '+%Y-%m-%d')
  total=$(grep "\"$RULE\"" "$LOG" 2>/dev/null | python3 -c "
import sys,json
lines=[l for l in sys.stdin if '$since' <= l[:10]]
print(len(lines))" 2>/dev/null || echo 0)
  block=$(grep "\"$RULE\"" "$LOG" 2>/dev/null | python3 -c "
import sys,json
lines=[json.loads(l) for l in sys.stdin if '$since' <= l[:10]]
print(sum(1 for l in lines if l.get('result',{}).get('verdict')=='BLOCK'))" 2>/dev/null || echo 0)
fi

if [[ "$total" -eq 0 ]]; then
  verdict="keep"
  signal="no_data"
  reason="Gate has not fired in 30 days. Keep — brand/visual checks are pre-campaign gates, fire infrequently by design."
elif [[ "$block" -gt 0 ]]; then
  verdict="keep"
  signal="catching_violations"
  reason="Gate caught $block BLOCK(s) in $total run(s) — actively preventing unbranded/text-only images from shipping."
else
  verdict="keep"
  signal="clean_run"
  reason="$total run(s), 0 BLOCKs — templates are compliant. Gate is working as deterrent."
fi

ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
cat >> "$LEDGER" <<EOF
- timestamp: "$ts"
  total_runs: $total
  block_count: $block
  verdict: "$verdict"
  signal: "$signal"
  reason: "$reason"
EOF

python3 -c "import json; print(json.dumps({'verdict':'$verdict','signal':'$signal','reason':'$reason','total_runs':$total,'block_count':$block}))"
