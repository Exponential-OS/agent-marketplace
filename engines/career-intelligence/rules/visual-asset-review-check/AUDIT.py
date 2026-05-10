#!/usr/bin/env python3
"""
AUDIT.py — visual-asset-review-check compliance audit.
Detects past BLOCK events (image-bearing campaigns distributed without visual review).

Input:  $1 or stdin JSON (optional): {"log_file": "..."}
Exit:   0=PASS  1=BLOCK  2=WARN (no data)
"""
import json
import pathlib
import sys

RULE_SLUG = "visual-asset-review-check"
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
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "blocks": 0, "passes": 0,
                          "reasons": ["No enforcement log found."]}))
        return 2

    blocks, passes = [], []
    with open(log_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("rule_slug") != RULE_SLUG:
                    continue
                (blocks if r.get("verdict") == "BLOCK" else passes).append(r)
            except Exception:
                continue

    total = len(blocks) + len(passes)
    if total == 0:
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "blocks": 0, "passes": 0,
                          "reasons": ["No visual-asset-review-check entries in log."]}))
        return 2

    if blocks:
        print(json.dumps({"verdict": "BLOCK", "status": "UNREVIEWED_ASSETS",
                          "blocks": len(blocks), "passes": len(passes),
                          "reasons": [f"{len(blocks)} campaign(s) attempted distribution with unreviewed visual assets."]}))
        return 1

    print(json.dumps({"verdict": "PASS", "status": "COMPLIANT",
                      "blocks": 0, "passes": len(passes),
                      "reasons": [f"No unreviewed-asset violations in {len(passes)} campaign checks."]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
