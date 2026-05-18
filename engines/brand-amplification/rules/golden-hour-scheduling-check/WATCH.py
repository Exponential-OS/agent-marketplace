#!/usr/bin/env python3
"""
WATCH.py — golden-hour-scheduling-check evolution scanner.

Observes gate fire patterns and emits a keep/strengthen/kill verdict.

Verdicts:
  keep       — gate is firing correctly; no change needed
  strengthen — high warn rate suggests golden windows need tightening
               OR campaigns are consistently outside windows (user education needed)
  kill       — gate never fires (no campaigns with scheduled_at) — may be irrelevant

Input:  $1 JSON (optional): {"log_file": "...", "days": 30}
Output: {"verdict": "keep|strengthen|kill", "signal": "...", "reason": "..."}
Exit:   0 always
"""
import json
import pathlib
import sys
from datetime import datetime, timezone, timedelta

RULE_SLUG = "golden-hour-scheduling-check"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"

STRENGTHEN_WARN_RATE = 0.5   # >50% warns → strengthen
KILL_MIN_FIRES = 5            # fewer than 5 total fires → insufficient signal


def main() -> int:
    raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
    try:
        ctx = json.loads(raw)
    except Exception:
        ctx = {}

    log_file = pathlib.Path(ctx.get("log_file", str(LOG_FILE_DEFAULT)))
    days = int(ctx.get("days", 30))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    if not log_file.exists():
        print(json.dumps({
            "verdict": "keep",
            "signal": "NO_DATA",
            "reason": "No enforcement log yet — gate is newly deployed; keep and observe.",
        }))
        return 0

    fires = []
    with open(log_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("rule_slug") != RULE_SLUG:
                    continue
                ts = r.get("timestamp")
                if ts:
                    try:
                        if datetime.fromisoformat(ts) < cutoff:
                            continue
                    except ValueError:
                        pass
                fires.append(r)
            except Exception:
                continue

    if len(fires) < KILL_MIN_FIRES:
        print(json.dumps({
            "verdict": "keep",
            "signal": "INSUFFICIENT_SIGNAL",
            "reason": (
                f"Only {len(fires)} fire(s) in last {days} days (need {KILL_MIN_FIRES}). "
                "Consider adding scheduled_at fields to campaign.json to activate the gate."
            ),
        }))
        return 0

    warns = [r for r in fires if r.get("verdict") in ("WARN", "warn")]
    warn_rate = len(warns) / len(fires)

    if warn_rate > STRENGTHEN_WARN_RATE:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "HIGH_WARN_RATE",
            "reason": (
                f"{warn_rate:.0%} of campaigns triggered golden-hour warnings in last {days} days. "
                "Either tighten the schedule template to enforce golden windows by default, "
                "or narrow the windows if current ones are too broad."
            ),
        }))
        return 0

    if warn_rate == 0.0:
        print(json.dumps({
            "verdict": "keep",
            "signal": "DETERRENT_WORKING",
            "reason": (
                f"0% warn rate over {len(fires)} fires — campaigns are being scheduled in golden windows. "
                "Gate is working as deterrent; keep current windows."
            ),
        }))
        return 0

    print(json.dumps({
        "verdict": "keep",
        "signal": "NOMINAL",
        "reason": (
            f"{warn_rate:.0%} warn rate over {len(fires)} fires in last {days} days — "
            "within acceptable range. Keep current golden window definitions."
        ),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
