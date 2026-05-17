#!/usr/bin/env bash
# AUDIT.sh — verify image-overflow-detection-gate compliance
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="image-overflow-detection-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"PASS"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"WARN"' | wc -l | tr -d ' ')
CHROME_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'chrome_headless' | grep '"BLOCK"' | wc -l | tr -d ' ')
STATIC_WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'static_analysis' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"warns\":$WARNS,\"chrome_overflow_blocks\":$CHROME_BLOCKS,\"static_analysis_warns\":$STATIC_WARNS}"
