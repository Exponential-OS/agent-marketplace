#!/usr/bin/env python3
"""
AUDIT.py — channel-status-check compliance audit.

Detects any past distribution attempts to banned channels.

Input:  $1 or stdin JSON (optional): {"log_file": "..."}
Output: JSON {verdict, status, blocks, passes, reasons}
Exit:   0=PASS  1=BLOCK  2=WARN (no data)
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

    if not log_file.exists():
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "blocks": 0, "passes": 0,
                          "reasons": ["No enforcement log found."]}))
        return 2

    blocks, passes, warns = [], [], []
    with open(log_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("rule_slug") != RULE_SLUG:
                    continue
                v = r.get("verdict", "")
                if v == "BLOCK":
                    blocks.append(r)
                elif v == "PASS":
                    passes.append(r)
                elif v == "WARN":
                    warns.append(r)
            except Exception:
                continue

    total = len(blocks) + len(passes) + len(warns)
    if total == 0:
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "blocks": 0, "passes": 0,
                          "reasons": ["No channel-status-check entries in log."]}))
        return 2

    if blocks:
        print(json.dumps({
            "verdict": "BLOCK",
            "status": "BANNED_CHANNEL_ATTEMPTS",
            "blocks": len(blocks),
            "passes": len(passes),
            "reasons": [f"{len(blocks)} attempt(s) to distribute to banned channels were blocked."]
        }))
        return 1

    print(json.dumps({
        "verdict": "PASS",
        "status": "COMPLIANT",
        "blocks": 0,
        "passes": len(passes),
        "reasons": [f"No banned-channel violations in {len(passes) + len(warns)} checks."]
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
