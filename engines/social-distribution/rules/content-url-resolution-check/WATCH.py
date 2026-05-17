#!/usr/bin/env python3
"""
WATCH.py — content-url-resolution-check evolution scanner.

If block rate is high, it means content is regularly being attempted for
distribution before URLs are resolved — the workflow needs improvement.
If block rate is zero with good volume, the rule is working as a deterrent.

Input:  $1 or stdin JSON (optional): {"log_file": "...", "min_sample": 5}
Output: JSON {verdict, signal, reason}
Exit:   0=keep  1=strengthen  2=uncertain
"""
import json
import pathlib
import sys

RULE_SLUG = "content-url-resolution-check"
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

    total, blocks, passes = 0, 0, 0
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
                v = r.get("verdict", "")
                if v == "BLOCK":
                    blocks += 1
                elif v == "PASS":
                    passes += 1
            except Exception:
                continue

    if total < min_sample:
        print(json.dumps({"verdict": "keep", "signal": "no_data",
                          "reason": f"Insufficient sample ({total}/{min_sample}). Continue monitoring."}))
        return 2

    block_rate = blocks / total

    if block_rate > 0.30:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "workflow_gap",
            "reason": (
                f"High block rate: {blocks}/{total} ({block_rate:.0%}) campaigns had unresolved tokens at distribution time. "
                f"Consider adding a campaign-creation gate that inserts real URLs before content files are drafted, "
                f"or a reminder workflow at the publish step."
            )
        }))
        return 1

    if blocks == 0 and total >= min_sample:
        print(json.dumps({"verdict": "keep", "signal": "deterrent",
                          "reason": f"Zero blocks in {total} checks. Gate is working — no unresolved tokens reaching distribution."}))
        return 0

    print(json.dumps({"verdict": "keep", "signal": "active",
                      "reason": f"{blocks} blocks in {total} checks ({block_rate:.0%}). Normal enforcement."}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
