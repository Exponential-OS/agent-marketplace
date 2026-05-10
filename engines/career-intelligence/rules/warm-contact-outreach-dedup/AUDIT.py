#!/usr/bin/env python3
"""
AUDIT.py — warm-contact-outreach-dedup compliance audit.

Answers: how many times did the rule fire (BLOCK vs PASS)?
Input:  $1 or stdin JSON (optional): {"window_hours": 168}
Output: JSON {verdict, status, recent_blocks, recent_passes, reasons}
Exit:   0=PASS  1=BLOCK  2=WARN (no data)
"""
import datetime
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
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA",
                          "recent_blocks": 0, "recent_passes": 0,
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
                if r.get("verdict") == "BLOCK":
                    blocks.append(r)
                elif r.get("verdict") == "PASS":
                    passes.append(r)
            except Exception:
                continue

    if blocks:
        print(json.dumps({"verdict": "BLOCK", "status": "VIOLATIONS_FOUND",
                          "recent_blocks": len(blocks[-20:]),
                          "recent_passes": len(passes),
                          "reasons": [f"{len(blocks)} total duplicate-outreach blocks"]}))
        return 1

    print(json.dumps({"verdict": "PASS", "status": "COMPLIANT",
                      "recent_blocks": 0, "recent_passes": len(passes),
                      "reasons": [f"No violations in {len(passes)} checks."]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
