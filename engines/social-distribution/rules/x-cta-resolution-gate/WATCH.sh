#!/usr/bin/env bash
# WATCH.sh — evolve x-cta-resolution-gate based on enforcement patterns
LOG_FILE="$HOME/.career-os-enforcement-log.jsonl"
SLUG="x-cta-resolution-gate"

if [[ ! -f "$LOG_FILE" ]]; then
  echo '{"verdict":"keep","reason":"No data yet — rule too new to evaluate."}'
  exit 0
fi

TOTAL=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | wc -l | tr -d ' ')

if [[ "$TOTAL" -lt 3 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Insufficient data ($TOTAL events). Need ≥3 to evaluate.\"}"
  exit 0
fi

EXTERNAL_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'external_link_in_thread_body' | grep '"BLOCK"' | wc -l | tr -d ' ')
PLACEHOLDER_BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'placeholder_check' | grep '"BLOCK"' | wc -l | tr -d ' ')

if [[ "$EXTERNAL_BLOCKS" -gt 0 || "$PLACEHOLDER_BLOCKS" -gt 0 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Hard gates fired (external_link:$EXTERNAL_BLOCKS, placeholder:$PLACEHOLDER_BLOCKS) — gate working as designed. X reach protection active.\"}"
  exit 0
fi

BLOCKS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep '"BLOCK"' | wc -l | tr -d ' ')
if [[ "$BLOCKS" -eq 0 && "$TOTAL" -ge 5 ]]; then
  echo "{\"verdict\":\"keep\",\"reason\":\"Zero violations in $TOTAL checks — gate working as deterrent.\"}"
  exit 0
fi

HOOK_WARNS=$(grep "\"rule\":\"$SLUG\"" "$LOG_FILE" | grep 'hook_strength' | grep '"WARN"' | wc -l | tr -d ' ')
if [[ "$TOTAL" -ge 10 && "$HOOK_WARNS" -gt 0 ]]; then
  if python3 -c "exit(0 if $HOOK_WARNS/$TOTAL > 0.6 else 1)" 2>/dev/null; then
    echo "{\"verdict\":\"modify\",\"reason\":\"hook_strength warns on >60% of threads — 50-char threshold may be too strict for punchy hook-style tweets. Consider lowering to 30 chars.\"}"
    exit 2
  fi
fi

BLOCK_RATE=$(python3 -c "print(round($BLOCKS/$TOTAL*100,1))" 2>/dev/null || echo "?")
echo "{\"verdict\":\"keep\",\"reason\":\"Block rate ${BLOCK_RATE}% across $TOTAL events — within normal range.\"}"
exit 0
