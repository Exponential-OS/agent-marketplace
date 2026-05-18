#!/usr/bin/env bash
# WATCH.sh — evolve linkedin-article-publish-gate based on enforcement patterns
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="linkedin-article-publish-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 3 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥3 to evaluate.\"}"
  exit 0
fi

QUALITY_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'quality' | grep '"BLOCK"' | wc -l | tr -d ' ')
PLACEHOLDER_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'placeholder_block' | grep '"BLOCK"' | wc -l | tr -d ' ')

# Placeholder blocks are always correct — tokens should never ship
if [[ "$PLACEHOLDER_BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"placeholder_block fired $PLACEHOLDER_BLOCKS times — working as designed. Unresolved tokens caught before publish.\"}"
  exit 0
fi

# High quality block rate = PROMPT.md may be too strict for LinkedIn's professional tone
if [[ "$TOTAL" -ge 5 && "$QUALITY_BLOCKS" -gt 0 ]]; then
  if python3 -c "exit(0 if $QUALITY_BLOCKS/$TOTAL > 0.5 else 1)" 2>/dev/null; then
    RATE=$(python3 -c "print(round($QUALITY_BLOCKS/$TOTAL*100,1))" 2>/dev/null || echo "?")
    echo "{\"verdict\":\"modify\",\"reason\":\"quality gate blocking ${RATE}% of articles — PROMPT.md criteria may be too strict for LinkedIn long-form. Review blocked articles that were eventually published and performed well.\"}"
    exit 2
  fi
fi

BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
if [[ "$BLOCKS" -eq 0 && "$TOTAL" -ge 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Zero violations in $TOTAL checks — gate working as deterrent.\"}"
  exit 0
fi

BLOCK_RATE=$(python3 -c "print(round($BLOCKS/$TOTAL*100,1))" 2>/dev/null || echo "?")
echo "{\"verdict\":\"keep\",\"reason\":\"Block rate ${BLOCK_RATE}% across $TOTAL events — within normal range.\"}"
exit 0
