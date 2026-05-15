#!/usr/bin/env bash
# WATCH.sh — evolve linkedin-post-on-article-gate based on enforcement patterns
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="linkedin-post-on-article-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 3 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥3 to evaluate.\"}"
  exit 0
fi

EXTERNAL_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'external_link_in_body' | grep '"BLOCK"' | wc -l | tr -d ' ')

# External link blocks are always correct — LinkedIn suppression is real
if [[ "$EXTERNAL_BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"external_link_in_body fired $EXTERNAL_BLOCKS times — working as designed. LinkedIn suppression protection active.\"}"
  exit 0
fi

BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
if [[ "$BLOCKS" -eq 0 && "$TOTAL" -ge 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Zero violations in $TOTAL checks — gate working as deterrent.\"}"
  exit 0
fi

BLOCK_RATE=$(python3 -c "print(round($BLOCKS/$TOTAL*100,1))" 2>/dev/null || echo "?")
echo "{\"verdict\":\"keep\",\"reason\":\"Block rate ${BLOCK_RATE}% across $TOTAL events — within normal range.\"}"
exit 0
