#!/usr/bin/env bash
# AUDIT.sh — verify substack-publish-gate compliance
# Reports BLOCK breakdown by gate type from enforcement log

LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep '"PASS"' | wc -l | tr -d ' ')

RESEND_BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep 'resend_block' | grep '"BLOCK"' | wc -l | tr -d ' ')
EMAIL_BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep 'email_send_gate' | grep '"BLOCK"' | wc -l | tr -d ' ')
COMPLETE_BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep 'completeness' | grep '"BLOCK"' | wc -l | tr -d ' ')
QUALITY_BLOCKS=$(grep '"rule":"substack-publish-gate"' "$LOG_FILE" | grep 'quality' | grep '"BLOCK"' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"block_breakdown\":{\"resend_block\":$RESEND_BLOCKS,\"email_send_gate\":$EMAIL_BLOCKS,\"completeness\":$COMPLETE_BLOCKS,\"quality\":$QUALITY_BLOCKS}}"
