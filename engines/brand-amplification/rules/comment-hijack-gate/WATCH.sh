#!/usr/bin/env bash
# WATCH.sh — evolve comment-hijack-gate based on enforcement patterns
# Exit 0=keep, 1=kill, 2=modify

LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep '"rule":"comment-hijack-gate"' "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep '"rule":"comment-hijack-gate"' "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
VALUE_BLOCKS=$(grep '"rule":"comment-hijack-gate"' "$LOG_FILE" | grep 'standalone_value' | grep '"BLOCK"' | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥5 to evaluate.\"}"
  exit 0
fi

BLOCK_RATE=$(python3 -c "print(round($BLOCKS/$TOTAL*100,1))")

# High standalone_value block rate = PROMPT.md may be too strict
if [[ "$VALUE_BLOCKS" -gt 0 ]]; then
  VALUE_RATE=$(python3 -c "print(round($VALUE_BLOCKS/$TOTAL*100,1))")
  if python3 -c "exit(0 if $VALUE_BLOCKS/$TOTAL > 0.4 else 1)"; then
    echo "{\"verdict\":\"modify\",\"reason\":\"standalone_value blocking ${VALUE_RATE}% of comments — PROMPT.md criteria may be too strict. Review false positives against shipped comments that performed well.\"}"
    exit 2
  fi
fi

if [[ "$BLOCKS" -eq 0 && "$TOTAL" -ge 10 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Zero violations in $TOTAL checks — gate working as deterrent.\"}"
  exit 0
fi

echo "{\"verdict\":\"keep\",\"reason\":\"Block rate $BLOCK_RATE% across $TOTAL events — within normal range.\"}"
exit 0
