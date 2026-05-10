#!/usr/bin/env bash
# AUDIT.sh — verify comment-hijack-gate compliance from enforcement log
# Exit 0=compliant, 1=violations found

LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"NO_DATA","message":"No enforcement log found — rule has never fired."}'
  exit 0
fi

RECENT_BLOCKS=$(grep '"rule":"comment-hijack-gate"' "$LOG_FILE" | grep '"BLOCK"' | tail -20)
RECENT_PASSES=$(grep '"rule":"comment-hijack-gate"' "$LOG_FILE" | grep '"PASS"' | tail -20)

BLOCK_COUNT=$(echo "$RECENT_BLOCKS" | grep -c '"BLOCK"' 2>/dev/null || echo 0)
PASS_COUNT=$(echo "$RECENT_PASSES" | grep -c '"PASS"' 2>/dev/null || echo 0)

# Surface which gates are firing most
HUB_BLOCKS=$(echo "$RECENT_BLOCKS" | grep -c 'hub_url' 2>/dev/null || echo 0)
FRESHNESS_BLOCKS=$(echo "$RECENT_BLOCKS" | grep -c 'freshness' 2>/dev/null || echo 0)
VALUE_BLOCKS=$(echo "$RECENT_BLOCKS" | grep -c 'standalone_value' 2>/dev/null || echo 0)

if [[ "$BLOCK_COUNT" -gt 0 ]]; then
  echo "{\"status\":\"VIOLATIONS_FOUND\",\"recent_blocks\":$BLOCK_COUNT,\"recent_passes\":$PASS_COUNT,\"breakdown\":{\"hub_url_missing\":$HUB_BLOCKS,\"freshness\":$FRESHNESS_BLOCKS,\"standalone_value\":$VALUE_BLOCKS}}"
  exit 1
fi

echo "{\"status\":\"COMPLIANT\",\"recent_passes\":$PASS_COUNT}"
exit 0
