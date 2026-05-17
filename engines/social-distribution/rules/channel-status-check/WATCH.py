#!/usr/bin/env python3
"""
WATCH.py — channel-status-check evolution scanner.

High block rate = campaigns regularly include banned channels (stale campaign templates).
Zero blocks = gate working as deterrent.

Input:  $1 or stdin JSON (optional): {"log_file": "...", "min_sample": 5}
Output: JSON {verdict, signal, reason}
Exit:   0=keep  1=strengthen  2=uncertain
"""
import json
import pathlib
import sys

RULE_SLUG = "channel-status-check"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]

    try:
        ctx = json.loads(raw) if raw.strip() else {}
    except Exception:
        ctx = {}

    log_file = pathlib.Path(ctx.get("log_file", str(LOG_FILE_DEFAULT)))
    min_sample = int(ctx.get("min_sample", 5))

    if not log_file.exists():
        print(json.dumps({"verdict": "keep", "signal": "no_data",
                          "reason": "No log. Rule not yet exercised."}))
        return 2

    total, blocks = 0, 0
    with open(log_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("rule_slug") != RULE_SLUG:
                    continue
                total += 1
                if r.get("verdict") == "BLOCK":
                    blocks += 1
            except Exception:
                continue

    if total < min_sample:
        print(json.dumps({"verdict": "keep", "signal": "no_data",
                          "reason": f"Insufficient sample ({total}/{min_sample})."}))
        return 2

    block_rate = blocks / total

    if block_rate > 0.20:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "stale_templates",
            "reason": (
                f"High block rate: {blocks}/{total} ({block_rate:.0%}). "
                f"Campaigns are being created with banned subreddits in templates. "
                f"Update campaign-creation templates to exclude banned channels by default."
            )
        }))
        return 1

    msg = (f"Zero banned-channel violations in {total} checks." if blocks == 0
           else f"{blocks}/{total} ({block_rate:.0%}) blocked. Normal enforcement.")
    print(json.dumps({"verdict": "keep", "signal": "active", "reason": msg}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
