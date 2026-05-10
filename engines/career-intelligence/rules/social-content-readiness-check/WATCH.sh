#!/usr/bin/env bash
# WATCH.sh — social-content-readiness-check evolution-candidate scanner.
# Surfaces keep/kill/modify verdicts based on enforcement-log activity vs the
# experiments declared in EXPERIMENTS/ledger.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER="$SCRIPT_DIR/EXPERIMENTS/ledger.json"
LOG_FILE="${CYBORG_ENFORCEMENT_LOG:-$HOME/.career-os-enforcement-log.jsonl}"
RULE_SLUG="social-content-readiness-check"

if [[ ! -f "$LEDGER" ]]; then
  printf '%s\n' '{"verdict":"WARN","reason":"experiments ledger not found"}'
  exit 2
fi

python3 - "$LEDGER" "$LOG_FILE" "$RULE_SLUG" <<'PY'
import json, os, sys, datetime
ledger_path, log_path, slug = sys.argv[1], sys.argv[2], sys.argv[3]
with open(ledger_path) as f:
    ledger = json.load(f)
cadence = ledger.get("cadence", {})
recent_runs = 0
panel_blocks = 0
format_blocks = 0
metadata_blocks = 0
if os.path.exists(log_path):
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
    with open(log_path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("rule_slug") != slug:
                continue
            ts = rec.get("ts", "")
            try:
                t = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
            except Exception:
                continue
            if t < cutoff:
                continue
            recent_runs += 1
            if rec.get("panel_verdict") == "BLOCK":
                panel_blocks += 1
            if rec.get("format_verdict") == "BLOCK":
                format_blocks += 1
            if rec.get("metadata_verdict") == "BLOCK":
                metadata_blocks += 1

verdict = "keep"
suggestion = "no-change"
if recent_runs > 0 and panel_blocks == 0 and format_blocks == 0 and metadata_blocks == 0:
    verdict = "modify"
    suggestion = "consider-cadence-halve"
print(json.dumps({
    "verdict": verdict,
    "rule": slug,
    "recent_runs_7d": recent_runs,
    "panel_blocks_7d": panel_blocks,
    "format_blocks_7d": format_blocks,
    "metadata_blocks_7d": metadata_blocks,
    "current_cadence": cadence.get("current"),
    "next_action": suggestion,
}))
PY
