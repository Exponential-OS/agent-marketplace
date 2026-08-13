#!/usr/bin/env bash
# WATCH.sh — evolve reddit-prepost-viability based on enforcement patterns
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="reddit-prepost-viability"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

MATCH="\"rule\": \"$SLUG\"\|\"rule\":\"$SLUG\""
TOTAL=$(grep "$MATCH" "$LOG_FILE" | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥5 to evaluate.\"}"
  exit 0
fi

HISTORY_BLOCKS=$(grep "$MATCH" "$LOG_FILE" | grep '"gate": "surface_history", "verdict": "BLOCK"\|"gate":"surface_history","verdict":"BLOCK"' | wc -l | tr -d ' ')
TOP50_BLOCKS=$(grep "$MATCH" "$LOG_FILE" | grep '"gate": "top50_citation_index", "verdict": "BLOCK"\|"gate":"top50_citation_index","verdict":"BLOCK"' | wc -l | tr -d ' ')
DASH_BLOCKS=$(grep "$MATCH" "$LOG_FILE" | grep '"gate": "em_dash", "verdict": "BLOCK"\|"gate":"em_dash","verdict":"BLOCK"' | wc -l | tr -d ' ')
FORMAT_WARNS=$(grep "$MATCH" "$LOG_FILE" | grep '"gate": "format_class", "verdict": "WARN"\|"gate":"format_class","verdict":"WARN"' | wc -l | tr -d ' ')

if [[ "$HISTORY_BLOCKS" -gt 0 || "$TOP50_BLOCKS" -gt 0 || "$DASH_BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Hard gates fired (history:$HISTORY_BLOCKS, top50:$TOP50_BLOCKS, em_dash:$DASH_BLOCKS) — gate is preventing known Reddit failure modes.\"}"
  exit 0
fi

if [[ "$TOTAL" -ge 10 && "$FORMAT_WARNS" -gt 0 ]]; then
  if python3 -c "exit(0 if $FORMAT_WARNS/$TOTAL > 0.6 else 1)" 2>/dev/null; then
    echo "{\"verdict\":\"modify\",\"reason\":\"format_class warns on >60% of checks — review matched signals against moderation outcomes before tuning weights.\"}"
    exit 2
  fi
fi

echo "{\"verdict\":\"keep\",\"reason\":\"No hard-gate events across $TOTAL checks; retain as a pre-post deterrent and continue collecting outcomes.\"}"
exit 0
