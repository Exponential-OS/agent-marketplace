#!/usr/bin/env bash
# AUDIT.sh — social-content-readiness-check compliance audit.
# Reads ~/.career-os-enforcement-log.jsonl and surfaces a verdict mix over the
# last 7 days for the social-content-readiness-check rule. Intended for the
# orchestrator to call on a regular cadence.
set -euo pipefail

LOG_FILE="${CYBORG_ENFORCEMENT_LOG:-$HOME/.career-os-enforcement-log.jsonl}"
RULE_SLUG="social-content-readiness-check"

if [[ ! -f "$LOG_FILE" ]]; then
  printf '%s\n' '{"verdict":"WARN","reason":"enforcement log not found","rule":"social-content-readiness-check"}'
  exit 2
fi

python3 - "$LOG_FILE" "$RULE_SLUG" <<'PY'
import json, sys, datetime
log_path, slug = sys.argv[1], sys.argv[2]
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
totals = {"PASS": 0, "WARN": 0, "BLOCK": 0}
panel_block_runs = 0
total = 0
with open(log_path) as f:
    for line in f:
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get("rule_slug") != slug:
            continue
        ts_raw = rec.get("ts", "")
        try:
            t = datetime.datetime.strptime(ts_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        except Exception:
            continue
        if t < cutoff:
            continue
        total += 1
        v = rec.get("verdict")
        if v in totals:
            totals[v] += 1
        if rec.get("panel_verdict") == "BLOCK":
            panel_block_runs += 1
verdict = "PASS" if totals["BLOCK"] == 0 else "WARN"
print(json.dumps({
    "verdict": verdict,
    "rule": slug,
    "window_days": 7,
    "total_runs": total,
    "verdict_mix": totals,
    "panel_block_runs": panel_block_runs,
}))
PY
