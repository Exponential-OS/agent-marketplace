#!/usr/bin/env bash
# AUDIT.sh — verify content-format-check rule is being followed
# Scans ~/.cyborg-enforcement-log.jsonl for recent violations

set -euo pipefail

LOG_FILE="$HOME/.cyborg-enforcement-log.jsonl"
SINCE_DAYS="${1:-7}"

echo "=== content-format-check AUDIT (last ${SINCE_DAYS} days) ==="

if [[ ! -f "$LOG_FILE" ]]; then
  echo "No enforcement log found at $LOG_FILE — rule has never fired."
  exit 0
fi

CUTOFF=$(date -v-${SINCE_DAYS}d -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
         date -d "${SINCE_DAYS} days ago" -u +"%Y-%m-%dT%H:%M:%SZ")

TOTAL=0
BLOCKS=0
WARNS=0
PASSES=0

while IFS= read -r line; do
  ts=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('timestamp',''))" 2>/dev/null)
  [[ -z "$ts" ]] && continue
  [[ "$ts" < "$CUTOFF" ]] && continue

  rule=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('rule',''))" 2>/dev/null)
  [[ "$rule" != "content-format-check" ]] && continue

  verdict=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d['result']['verdict'])" 2>/dev/null)
  ((TOTAL++))
  case "$verdict" in
    BLOCK) ((BLOCKS++)) ;;
    WARN)  ((WARNS++)) ;;
    PASS)  ((PASSES++)) ;;
  esac
done < "$LOG_FILE"

echo "Period : last $SINCE_DAYS days"
echo "Total  : $TOTAL checks"
echo "PASS   : $PASSES"
echo "WARN   : $WARNS"
echo "BLOCK  : $BLOCKS"

if [[ $TOTAL -eq 0 ]]; then
  echo "STATUS : No checks recorded — rule not being invoked before publishing."
  exit 2
elif [[ $BLOCKS -gt 0 ]]; then
  BLOCK_RATE=$(python3 -c "print(f'{$BLOCKS/$TOTAL*100:.0f}%')")
  echo "STATUS : ${BLOCK_RATE} block rate — content format violations being caught."
  exit 0
else
  echo "STATUS : HEALTHY — no blocks in period."
  exit 0
fi
