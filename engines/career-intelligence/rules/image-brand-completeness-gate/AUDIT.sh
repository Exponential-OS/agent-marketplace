#!/usr/bin/env bash
# AUDIT.sh — image-brand-completeness-gate
# Scans recent enforcement log for compliance stats.
# Usage: bash AUDIT.sh [--since YYYY-MM-DD]

set -euo pipefail

LOG="$HOME/.career-os-enforcement-log.jsonl"
RULE="image-brand-completeness-gate"
SINCE="${2:-$(date -d '7 days ago' '+%Y-%m-%d' 2>/dev/null || date -v-7d '+%Y-%m-%d')}"

echo "=== AUDIT: $RULE (since $SINCE) ==="

if [[ ! -f "$LOG" ]]; then
  echo "No enforcement log found at $LOG"
  exit 0
fi

total=$(grep "\"$RULE\"" "$LOG" | python3 -c "
import sys,json
lines=[json.loads(l) for l in sys.stdin if '$SINCE' <= l[:10]]
print(len(lines))")

pass=$(grep "\"$RULE\"" "$LOG" | python3 -c "
import sys,json
lines=[json.loads(l) for l in sys.stdin if '$SINCE' <= l[:10]]
print(sum(1 for l in lines if l.get('result',{}).get('verdict')=='PASS'))")

block=$(grep "\"$RULE\"" "$LOG" | python3 -c "
import sys,json
lines=[json.loads(l) for l in sys.stdin if '$SINCE' <= l[:10]]
print(sum(1 for l in lines if l.get('result',{}).get('verdict')=='BLOCK'))")

warn=$(grep "\"$RULE\"" "$LOG" | python3 -c "
import sys,json
lines=[json.loads(l) for l in sys.stdin if '$SINCE' <= l[:10]]
print(sum(1 for l in lines if l.get('result',{}).get('verdict')=='WARN'))")

echo "Total runs : $total"
echo "PASS       : $pass"
echo "BLOCK      : $block"
echo "WARN       : $warn"

if [[ "$block" -gt 0 ]]; then
  echo ""
  echo "Recent BLOCK reasons:"
  grep "\"$RULE\"" "$LOG" | python3 -c "
import sys,json
lines=[json.loads(l) for l in sys.stdin if '$SINCE' <= l[:10]]
for l in lines:
  r=l.get('result',{})
  if r.get('verdict')=='BLOCK':
    for issue in r.get('block_issues',[]):
      print('  -', issue[:120])" 2>/dev/null || true
fi
