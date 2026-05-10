#!/usr/bin/env bash
# WATCH.sh — evolve linkedin-mention-gate based on violation patterns
# Emits keep/kill/modify verdicts based on enforcement log
# Exit 0=keep, 1=kill, 2=modify

LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep '"rule":"linkedin-mention-gate"' "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep '"rule":"linkedin-mention-gate"' "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥5 to evaluate.\"}"
  exit 0
fi

BLOCK_RATE=$(python3 -c "print(round($BLOCKS/$TOTAL*100,1))")

# High block rate = rule is catching real violations, consider strengthening
if python3 -c "exit(0 if $BLOCKS/$TOTAL > 0.3 else 1)"; then
  echo "{\"verdict\":\"modify\",\"reason\":\"High violation rate ($BLOCK_RATE%) — consider adding people-file pre-check at campaign planning stage (not just at post time).\"}"
  exit 2
fi

# Zero violations across many checks = rule working as deterrent
if [[ "$BLOCKS" -eq 0 && "$TOTAL" -ge 10 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Zero violations in $TOTAL checks — rule is working. Keep.\"}"
  exit 0
fi

echo "{\"verdict\":\"keep\",\"reason\":\"Block rate $BLOCK_RATE% across $TOTAL events — within normal range.\"}"
exit 0
