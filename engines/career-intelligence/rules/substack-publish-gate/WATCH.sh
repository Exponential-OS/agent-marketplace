#!/usr/bin/env bash
# WATCH.sh — evolve substack-publish-gate based on enforcement patterns
# Exit 0=keep, 1=kill, 2=modify

LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
RESEND_BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep 'resend_block' | grep '"BLOCK"' | wc -l | tr -d ' ')
QUALITY_BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep 'quality' | grep '"BLOCK"' | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 3 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥3 to evaluate.\"}"
  exit 0
fi

# Resend blocks are always correct — never modify this gate
if [[ "$RESEND_BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"resend_block fired $RESEND_BLOCKS times — exactly what it's designed to do. One-way door gate is working.\"}"
  exit 0
fi

# High quality block rate = PROMPT.md may be too strict
if [[ "$TOTAL" -ge 5 && "$QUALITY_BLOCKS" -gt 0 ]]; then
  QUALITY_RATE=$(python3 -c "print(round($QUALITY_BLOCKS/$TOTAL*100,1))")
  if python3 -c "exit(0 if $QUALITY_BLOCKS/$TOTAL > 0.5 else 1)"; then
    echo "{\"verdict\":\"modify\",\"reason\":\"quality gate blocking ${QUALITY_RATE}% of publishes — PROMPT.md criteria may be too strict for Substack's informal tone. Review blocked posts that were eventually published and performed well.\"}"
    exit 2
  fi
fi

if [[ "$BLOCKS" -eq 0 && "$TOTAL" -ge 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Zero violations in $TOTAL checks — gate working as deterrent.\"}"
  exit 0
fi

BLOCK_RATE=$(python3 -c "print(round($BLOCKS/$TOTAL*100,1))")
echo "{\"verdict\":\"keep\",\"reason\":\"Block rate $BLOCK_RATE% across $TOTAL events — within normal range.\"}"
exit 0
