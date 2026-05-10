#!/usr/bin/env bash
# AUDIT.sh — verify linkedin-mention-gate compliance from enforcement log
# Exit 0=compliant, 1=violations found

LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"NO_DATA","message":"No enforcement log found — rule has never fired."}'
  exit 0
fi

RECENT_BLOCKS=$(grep '"rule":"linkedin-mention-gate"' "$LOG_FILE" | grep '"BLOCK"' | tail -20)
RECENT_PASSES=$(grep '"rule":"linkedin-mention-gate"' "$LOG_FILE" | grep '"PASS"' | tail -20)

BLOCK_COUNT=$(echo "$RECENT_BLOCKS" | grep -c '"BLOCK"' 2>/dev/null || echo 0)
PASS_COUNT=$(echo "$RECENT_PASSES" | grep -c '"PASS"' 2>/dev/null || echo 0)

if [[ "$BLOCK_COUNT" -gt 0 ]]; then
  echo "{\"status\":\"VIOLATIONS_FOUND\",\"recent_blocks\":$BLOCK_COUNT,\"recent_passes\":$PASS_COUNT}"
  echo "$RECENT_BLOCKS" | tail -5
  exit 1
fi

echo "{\"status\":\"COMPLIANT\",\"recent_passes\":$PASS_COUNT}"
exit 0
