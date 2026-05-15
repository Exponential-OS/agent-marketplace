#!/usr/bin/env bash
# WATCH.sh — evolve image-overflow-detection-gate based on enforcement patterns
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="image-overflow-detection-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 3 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥3 to evaluate.\"}"
  exit 0
fi

STATIC_WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'static_analysis' | wc -l | tr -d ' ')
if [[ "$TOTAL" -ge 5 ]]; then
  if python3 -c "exit(0 if $STATIC_WARNS/$TOTAL > 0.7 else 1)" 2>/dev/null; then
    echo "{\"verdict\":\"modify\",\"reason\":\"Over 70% of checks falling back to static analysis — Chrome is not available in the environment. Consider making Chrome installation a hard requirement or adding Playwright as an alternative.\"}"
    exit 2
  fi
fi

CHROME_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'chrome_headless' | grep '"BLOCK"' | wc -l | tr -d ' ')
if [[ "$CHROME_BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Chrome overflow detection fired $CHROME_BLOCKS times — catching real overflow bugs before PNG generation. Gate working correctly.\"}"
  exit 0
fi

echo "{\"verdict\":\"keep\",\"reason\":\"Gate active. $TOTAL checks run, $CHROME_BLOCKS overflows caught.\"}"
exit 0
