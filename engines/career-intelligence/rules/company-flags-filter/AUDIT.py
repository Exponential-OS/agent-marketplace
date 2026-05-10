#!/usr/bin/env python3
"""
AUDIT.py — company-flags-filter compliance audit.

Answers: did any action item for a flagged/deprioritized company slip through
to the enforcement log without being blocked?

Input:  $1 or stdin JSON (optional): {"log_file": "/abs/path/to/.cyborg-enforcement-log.jsonl"}
Output: JSON {verdict, status, recent_blocks, recent_passes, bypass_warnings, reasons}
Exit:   0=PASS (compliant — all flagged companies were blocked)
        1=BLOCK (bypass detected — a flagged company got a PASS when it should have blocked)
        2=WARN (no data yet)
"""
import json
import pathlib
import sys

RULE_SLUG = "company-flags-filter"
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
        print(json.dumps({
            "verdict": "WARN",
            "status": "NO_DATA",
            "recent_blocks": 0,
            "recent_passes": 0,
            "bypass_warnings": [],
            "reasons": ["No enforcement log found. Rule has not fired yet."]
        }))
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
                verdict = r.get("verdict", "")
                if verdict == "BLOCK":
                    blocks.append(r)
                elif verdict == "PASS":
                    passes.append(r)
                elif verdict == "WARN":
                    warns.append(r)
            except Exception:
                continue

    total = len(blocks) + len(passes) + len(warns)
    if total == 0:
        print(json.dumps({
            "verdict": "WARN",
            "status": "NO_DATA",
            "recent_blocks": 0,
            "recent_passes": 0,
            "bypass_warnings": [],
            "reasons": ["Log exists but no company-flags-filter entries found."]
        }))
        return 2

    # Detect suspicious PASSes: a company that appeared in both BLOCK and PASS
    # in the log suggests a bypass (flag was present when blocked, then removed or missed)
    blocked_companies = {r.get("company", "").lower() for r in blocks if r.get("company")}
    passed_companies = [(r.get("company", ""), r.get("ts", "unknown")) for r in passes if r.get("company")]
    bypass_warnings = [
        f"{co} passed at {ts} but also appears in BLOCK history"
        for co, ts in passed_companies
        if co.lower() in blocked_companies
    ]

    if bypass_warnings:
        print(json.dumps({
            "verdict": "BLOCK",
            "status": "BYPASS_DETECTED",
            "recent_blocks": len(blocks),
            "recent_passes": len(passes),
            "bypass_warnings": bypass_warnings,
            "reasons": bypass_warnings
        }))
        return 1

    print(json.dumps({
        "verdict": "PASS",
        "status": "COMPLIANT",
        "recent_blocks": len(blocks),
        "recent_passes": len(passes),
        "bypass_warnings": [],
        "reasons": [
            f"{len(blocks)} companies blocked, {len(passes)} passed, {len(warns)} referral-warnings in {total} total checks."
        ]
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
