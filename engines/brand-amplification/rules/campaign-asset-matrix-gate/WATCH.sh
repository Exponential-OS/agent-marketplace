#!/usr/bin/env bash
# WATCH.sh — evolve campaign-asset-matrix-gate based on enforcement patterns
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="campaign-asset-matrix-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 3 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥3 to evaluate.\"}"
  exit 0
fi

BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"WARN"' | wc -l | tr -d ' ')

if [[ "$BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Gate blocked $BLOCKS campaigns with missing required assets — working as designed.\"}"
  exit 0
fi

if [[ "$WARNS" -gt 0 && "$TOTAL" -ge 5 ]]; then
  if python3 -c "exit(0 if $WARNS/$TOTAL > 0.8 else 1)" 2>/dev/null; then
    echo "{\"verdict\":\"modify\",\"reason\":\"Over 80% of campaigns warn on LinkedIn/X missing images. Consider upgrading linkedin_hub to BLOCK if images are consistently being generated anyway.\"}"
    exit 2
  fi
fi

echo "{\"verdict\":\"keep\",\"reason\":\"Gate active. $TOTAL checks, $BLOCKS blocks, $WARNS warns.\"}"
exit 0
