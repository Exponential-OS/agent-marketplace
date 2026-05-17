#!/usr/bin/env bash
# AUDIT.sh — verify x-cta-resolution-gate compliance
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="x-cta-resolution-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"PASS"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"WARN"' | wc -l | tr -d ' ')

EXTERNAL_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'external_link_in_thread_body' | grep '"BLOCK"' | wc -l | tr -d ' ')
CTA_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'cta_in_reply' | grep '"BLOCK"' | wc -l | tr -d ' ')
PLACEHOLDER_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'placeholder_check' | grep '"BLOCK"' | wc -l | tr -d ' ')
HOOK_WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'hook_strength' | grep '"WARN"' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"warns\":$WARNS,\"block_breakdown\":{\"external_link_in_thread_body\":$EXTERNAL_BLOCKS,\"cta_in_reply\":$CTA_BLOCKS,\"placeholder_check\":$PLACEHOLDER_BLOCKS},\"warn_breakdown\":{\"hook_strength\":$HOOK_WARNS}}"
