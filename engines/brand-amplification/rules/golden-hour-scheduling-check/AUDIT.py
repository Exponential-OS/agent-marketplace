#!/usr/bin/env python3
"""
AUDIT.py — golden-hour-scheduling-check compliance audit.
Reports on how often campaigns are scheduled outside golden windows.

Input:  $1 JSON (optional): {"log_file": "...", "days": 30}
Exit:   0=PASS  1=BLOCK  2=WARN (no data)
"""
import json
import pathlib
import sys
from datetime import datetime, timezone, timedelta

RULE_SLUG = "golden-hour-scheduling-check"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"
WARN_RATE_THRESHOLD = 0.6   # >60% warn rate → gate may need tighter windows


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
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "warns": 0, "passes": 0,
                          "reasons": ["No enforcement log found."]}))
        return 2

    warns, passes = [], []
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
                (warns if r.get("verdict") in ("WARN", "warn") else passes).append(r)
            except Exception:
                continue

    total = len(warns) + len(passes)
    if total == 0:
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "warns": 0, "passes": 0,
                          "reasons": [f"No {RULE_SLUG} entries in log (last {days} days)."]}))
        return 2

    warn_rate = len(warns) / total
    if warn_rate > WARN_RATE_THRESHOLD:
        print(json.dumps({
            "verdict": "WARN",
            "status": "HIGH_WARN_RATE",
            "warns": len(warns),
            "passes": len(passes),
            "warn_rate": round(warn_rate, 2),
            "reasons": [
                f"{warn_rate:.0%} of campaigns in last {days} days triggered golden-hour warnings. "
                "Consider auditing typical posting times and updating the schedule template."
            ],
        }))
        return 2

    print(json.dumps({
        "verdict": "PASS",
        "status": "COMPLIANT",
        "warns": len(warns),
        "passes": len(passes),
        "warn_rate": round(warn_rate, 2),
        "reasons": [f"{warn_rate:.0%} warn rate over last {days} days — within acceptable range."],
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
