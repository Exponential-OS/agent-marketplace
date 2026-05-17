#!/usr/bin/env bash
# AUDIT.sh — verify campaign-asset-matrix-gate compliance
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="campaign-asset-matrix-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"PASS"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"WARN"' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"warns\":$WARNS}"
