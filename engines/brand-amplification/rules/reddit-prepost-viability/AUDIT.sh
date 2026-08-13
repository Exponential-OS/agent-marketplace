#!/usr/bin/env bash
# AUDIT.sh — verify reddit-prepost-viability compliance
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="reddit-prepost-viability"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"status":"no_data","message":"No enforcement log found. Gate has not fired yet."}'
  exit 0
fi

TOTAL=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')
BLOCKS=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"result": {"verdict": "BLOCK"\|"result":{"verdict":"BLOCK"' | wc -l | tr -d ' ')
PASSES=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"result": {"verdict": "PASS"\|"result":{"verdict":"PASS"' | wc -l | tr -d ' ')
WARNS=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"result": {"verdict": "WARN"\|"result":{"verdict":"WARN"' | wc -l | tr -d ' ')

HISTORY_BLOCKS=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"gate": "surface_history", "verdict": "BLOCK"\|"gate":"surface_history","verdict":"BLOCK"' | wc -l | tr -d ' ')
TOP50_BLOCKS=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"gate": "top50_citation_index", "verdict": "BLOCK"\|"gate":"top50_citation_index","verdict":"BLOCK"' | wc -l | tr -d ' ')
FORMAT_WARNS=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"gate": "format_class", "verdict": "WARN"\|"gate":"format_class","verdict":"WARN"' | wc -l | tr -d ' ')
DASH_BLOCKS=$(grep "\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"gate": "em_dash", "verdict": "BLOCK"\|"gate":"em_dash","verdict":"BLOCK"' | wc -l | tr -d ' ')

echo "{\"total\":$TOTAL,\"passes\":$PASSES,\"blocks\":$BLOCKS,\"warns\":$WARNS,\"block_breakdown\":{\"surface_history\":$HISTORY_BLOCKS,\"top50_citation_index\":$TOP50_BLOCKS,\"em_dash\":$DASH_BLOCKS},\"warn_breakdown\":{\"format_class\":$FORMAT_WARNS}}"
