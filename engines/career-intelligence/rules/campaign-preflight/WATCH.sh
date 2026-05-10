#!/usr/bin/env bash
# campaign-preflight/WATCH.sh
# Observes fire rate and false-negative patterns. Emits keep/strengthen/kill verdict.
# Usage: bash WATCH.sh
# Exit: 0=keep, 1=strengthen, 2=kill
# Logs verdict to: ~/.career-os-enforcement-log.jsonl

set -euo pipefail

LOG="$HOME/.career-os-enforcement-log.jsonl"
EXPERIMENTS_DIR="$(dirname "$0")/EXPERIMENTS"
LEDGER="$EXPERIMENTS_DIR/ledger.json"

mkdir -p "$EXPERIMENTS_DIR"

# ── Gather metrics ──────────────────────────────────────────────────────────
WINDOW_DAYS=14

RUNS=$(python3 - <<PYEOF 2>/dev/null || echo "0"
import json
count = 0
from datetime import datetime, timezone, timedelta
since = (datetime.now(timezone.utc) - timedelta(days=$WINDOW_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ')
try:
    with open('$LOG') as f:
        for line in f:
            try:
                e = json.loads(line.strip())
                if e.get('rule') == 'campaign-preflight' and e.get('ts','') >= since:
                    count += 1
            except Exception:
                pass
except FileNotFoundError:
    pass
print(count)
PYEOF
)

BLOCKS=$(python3 - <<PYEOF 2>/dev/null || echo "0"
import json
count = 0
from datetime import datetime, timezone, timedelta
since = (datetime.now(timezone.utc) - timedelta(days=$WINDOW_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ')
try:
    with open('$LOG') as f:
        for line in f:
            try:
                e = json.loads(line.strip())
                if e.get('rule') == 'campaign-preflight' and e.get('exit') == 1 and e.get('ts','') >= since:
                    count += 1
            except Exception:
                pass
except FileNotFoundError:
    pass
print(count)
PYEOF
)

# ── Read prior cadence from ledger ──────────────────────────────────────────
PRIOR_VERDICT="keep"
CONSECUTIVE_KEEPS=0

if [[ -f "$LEDGER" ]]; then
  PRIOR_VERDICT=$(python3 -c "
import json
try:
    d = json.load(open('$LEDGER'))
    entries = d.get('entries', [])
    if entries:
        print(entries[-1].get('verdict', 'keep'))
    else:
        print('keep')
except Exception:
    print('keep')
" 2>/dev/null || echo "keep")

  CONSECUTIVE_KEEPS=$(python3 -c "
import json
try:
    d = json.load(open('$LEDGER'))
    entries = d.get('entries', [])
    count = 0
    for e in reversed(entries):
        if e.get('verdict') == 'keep':
            count += 1
        else:
            break
    print(count)
except Exception:
    print(0)
" 2>/dev/null || echo "0")
fi

# ── Determine verdict ───────────────────────────────────────────────────────
VERDICT="keep"
SIGNAL=""
REASON=""

if [[ "$RUNS" -eq 0 ]]; then
  VERDICT="keep"
  SIGNAL="dormant"
  REASON="No fire events in ${WINDOW_DAYS}d. Rule is present but not being invoked — cadence OK; watch for false negatives if campaigns are being created."
elif [[ "$BLOCKS" -gt 0 ]]; then
  VERDICT="strengthen"
  SIGNAL="blocking"
  REASON="${BLOCKS} BLOCK(s) in ${WINDOW_DAYS}d out of ${RUNS} run(s). Rule is catching violations — consider adding AUDIT.sh campaign-count cross-check for stronger coverage."
else
  VERDICT="keep"
  SIGNAL="passing"
  REASON="${RUNS} run(s) in ${WINDOW_DAYS}d, 0 blocks. Gate is firing and passing — healthy."
fi

# Cadence auto-adjustment: 3 consecutive keeps → halve interval; strengthen → double
if [[ "$CONSECUTIVE_KEEPS" -ge 3 ]]; then
  CADENCE_NOTE="cadence: 3 consecutive keeps — recommend halving watch interval"
elif [[ "$VERDICT" == "strengthen" ]]; then
  CADENCE_NOTE="cadence: strengthen signal — recommend doubling watch interval for closer monitoring"
else
  CADENCE_NOTE="cadence: nominal"
fi

# ── Write ledger entry ──────────────────────────────────────────────────────
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 - <<PYEOF
import json, os

ledger_path = '$LEDGER'
try:
    with open(ledger_path) as f:
        data = json.load(f)
except Exception:
    data = {"rule": "campaign-preflight", "entries": []}

data["entries"].append({
    "ts": "$TS",
    "verdict": "$VERDICT",
    "signal": "$SIGNAL",
    "reason": "$REASON",
    "runs_in_window": $RUNS,
    "blocks_in_window": $BLOCKS,
    "window_days": $WINDOW_DAYS
})

os.makedirs(os.path.dirname(ledger_path), exist_ok=True)
with open(ledger_path, 'w') as f:
    json.dump(data, f, indent=2)
PYEOF

# ── Emit result ─────────────────────────────────────────────────────────────
echo ""
echo "=== campaign-preflight WATCH (${WINDOW_DAYS}d window) ==="
echo "  Runs:    $RUNS"
echo "  Blocks:  $BLOCKS"
echo "  Verdict: $VERDICT"
echo "  Signal:  $SIGNAL"
echo "  Reason:  $REASON"
echo "  $CADENCE_NOTE"
echo ""

case "$VERDICT" in
  keep)      exit 0 ;;
  strengthen) exit 1 ;;
  kill)      exit 2 ;;
esac
