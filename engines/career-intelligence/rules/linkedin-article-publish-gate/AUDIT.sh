#!/usr/bin/env bash
# AUDIT.sh — verify linkedin-article-publish-gate compliance
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="linkedin-article-publish-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"PASS"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"WARN"' | wc -l | tr -d ' ')

PLACEHOLDER_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'placeholder_block' | grep '"BLOCK"' | wc -l | tr -d ' ')
BACKLINK_WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'backlink_check' | grep '"WARN"' | wc -l | tr -d ' ')
CTA_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'cta_check' | grep '"BLOCK"' | wc -l | tr -d ' ')
QUALITY_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'quality' | grep '"BLOCK"' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"warns\":$WARNS,\"block_breakdown\":{\"placeholder_block\":$PLACEHOLDER_BLOCKS,\"cta_check\":$CTA_BLOCKS,\"quality\":$QUALITY_BLOCKS},\"warn_breakdown\":{\"backlink_check\":$BACKLINK_WARNS}}"
