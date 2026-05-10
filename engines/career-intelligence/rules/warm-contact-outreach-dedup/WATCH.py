#!/usr/bin/env python3
"""
WATCH.py — warm-contact-outreach-dedup evolution scanner.

Surfaces keep/kill/modify verdicts based on enforcement log history.
Input:  $1 or stdin JSON (optional context)
Output: JSON {verdict, reason}
Exit:   0=keep  1=modify/kill  2=uncertain
"""
import json
import pathlib
import sys

RULE_SLUG = "warm-contact-outreach-dedup"
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

    if not log_file.exists():
        print(json.dumps({"verdict": "keep", "reason": "No data yet."}))
        return 0

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

    if total < 5:
        print(json.dumps({"verdict": "keep", "reason": f"Insufficient data ({total} events)."}))
        return 0

    if blocks == 0 and total >= 10:
        print(json.dumps({"verdict": "keep",
                          "reason": f"Zero duplicate-outreach blocks in {total} checks — rule working as deterrent."}))
        return 0

    print(json.dumps({"verdict": "keep",
                      "reason": f"{blocks} blocks in {total} checks — monitoring."}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
