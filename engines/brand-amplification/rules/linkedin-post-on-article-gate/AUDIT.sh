#!/usr/bin/env bash
# AUDIT.sh — verify linkedin-post-on-article-gate compliance
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="linkedin-post-on-article-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"PASS"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"WARN"' | wc -l | tr -d ' ')

EXTERNAL_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'external_link_in_body' | grep '"BLOCK"' | wc -l | tr -d ' ')
URL_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'article_url_format' | grep '"BLOCK"' | wc -l | tr -d ' ')
PLACEHOLDER_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'placeholder_in_post' | grep '"BLOCK"' | wc -l | tr -d ' ')
HOOK_WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'hook_visibility' | grep '"WARN"' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"warns\":$WARNS,\"block_breakdown\":{\"external_link_in_body\":$EXTERNAL_BLOCKS,\"article_url_format\":$URL_BLOCKS,\"placeholder_in_post\":$PLACEHOLDER_BLOCKS},\"warn_breakdown\":{\"hook_visibility\":$HOOK_WARNS}}"
