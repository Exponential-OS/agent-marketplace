#!/usr/bin/env python3
"""
AUDIT.py — surface-coverage-check compliance audit.
Detects past BLOCK events (silent surface omissions at distribution time).

Input:  $1 or stdin JSON (optional): {"log_file": "..."}
Exit:   0=PASS  1=BLOCK  2=WARN (no data)
"""
import json
import pathlib
import sys

RULE_SLUG = "surface-coverage-check"
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
                          "reasons": ["No surface-coverage-check entries in log."]}))
        return 2

    if blocks:
        print(json.dumps({"verdict": "BLOCK", "status": "SURFACE_OMISSIONS",
                          "blocks": len(blocks), "passes": len(passes),
                          "reasons": [f"{len(blocks)} campaign(s) had silently omitted surfaces at distribution time."]}))
        return 1

    print(json.dumps({"verdict": "PASS", "status": "COMPLIANT",
                      "blocks": 0, "passes": len(passes),
                      "reasons": [f"No surface omissions in {len(passes)} campaign checks."]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
