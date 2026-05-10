#!/usr/bin/env bash
# campaign-preflight/AUDIT.sh
# Verifies this rule is being followed: checks enforcement log for pre-flight coverage
# of recent campaign creations.
# Usage: bash AUDIT.sh [--days N]   (default: last 7 days)
# Exit: 0=compliant, 1=violations found, 2=no data

set -euo pipefail

DAYS="${1:-7}"
LOG="$HOME/.career-os-enforcement-log.jsonl"
CAREER_OS_HOME="${CAREER_OS_HOME:-$HOME/anand-career-os}"
CAMPAIGNS_DIR="$CAREER_OS_HOME/brain/social-distribution-engine/campaigns"

if [[ ! -f "$LOG" ]]; then
  echo "WARN — no enforcement log found at $LOG (no runs recorded)"
  exit 2
fi

# Cut-off timestamp (DAYS ago, ISO format)
SINCE=$(python3 -c "
from datetime import datetime, timezone, timedelta
dt = datetime.now(timezone.utc) - timedelta(days=$DAYS)
print(dt.strftime('%Y-%m-%dT%H:%M:%SZ'))
")

# Count preflight runs in window
PREFLIGHT_RUNS=$(python3 - <<PYEOF
import json, sys
count = 0
with open('$LOG') as f:
    for line in f:
        try:
            e = json.loads(line.strip())
            if e.get('rule') == 'campaign-preflight' and e.get('ts','') >= '$SINCE':
                count += 1
        except Exception:
            pass
print(count)
PYEOF
)

# Count campaign dirs created in window
RECENT_CAMPAIGNS=0
if [[ -d "$CAMPAIGNS_DIR" ]]; then
  RECENT_CAMPAIGNS=$(find "$CAMPAIGNS_DIR" -name "campaign.json" -newer <(python3 -c "
import os, time, datetime, tempfile
dt = datetime.datetime.now() - datetime.timedelta(days=$DAYS)
with tempfile.NamedTemporaryFile(delete=False) as f:
    os.utime(f.name, (dt.timestamp(), dt.timestamp()))
    print(f.name)
" 2>/dev/null) 2>/dev/null | wc -l | tr -d ' ')
fi

echo ""
echo "=== campaign-preflight AUDIT (last $DAYS days) ==="
echo "  Pre-flight runs logged:  $PREFLIGHT_RUNS"
echo "  Campaign dirs detected:  $RECENT_CAMPAIGNS"
echo ""

if [[ "$RECENT_CAMPAIGNS" -gt 0 && "$PREFLIGHT_RUNS" -eq 0 ]]; then
  echo "VIOLATION — $RECENT_CAMPAIGNS campaign(s) created but 0 pre-flight runs logged."
  echo "  → Agents drafted campaigns without running campaign-preflight/HOW.sh first."
  echo "  → Remediation: run HOW.sh before any new campaign. Add to agent session-start."
  exit 1
elif [[ "$PREFLIGHT_RUNS" -eq 0 ]]; then
  echo "WARN — no pre-flight runs in last $DAYS days (no campaigns detected either)."
  exit 2
else
  echo "PASS — $PREFLIGHT_RUNS pre-flight gate(s) ran in last $DAYS days."
  exit 0
fi
