#!/usr/bin/env python3
"""
AUDIT.py — outreach-people-file-commit compliance audit.

Answers: did any outreach action complete without a corresponding HOW.py commit?
Uses the enforcement log to check for successful commits (exit 0) vs failures (exit 1/2).

A WARNING pattern (exit 1 = commit failed but file was updated) indicates potential
session death between write and commit — the worst-case state: file updated, not committed.

Input:  $1 or stdin JSON (optional): {"log_file": "..."}
Output: JSON {verdict, status, committed, failed_commits, warn_entries, reasons}
Exit:   0=PASS (all logged outreach actions committed successfully)
        1=BLOCK (uncommitted-write violations found)
        2=WARN (no data)
"""
import json
import pathlib
import sys

RULE_SLUG = "outreach-people-file-commit"
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
            "committed": 0,
            "failed_commits": 0,
            "warn_entries": [],
            "reasons": ["No enforcement log found. Rule has not fired yet."]
        }))
        return 2

    committed, failed, warned = [], [], []
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
                if verdict == "PASS":
                    committed.append(r)
                elif verdict == "BLOCK":
                    failed.append(r)
                elif verdict == "WARN":
                    warned.append(r)
            except Exception:
                continue

    total = len(committed) + len(failed) + len(warned)
    if total == 0:
        print(json.dumps({
            "verdict": "WARN",
            "status": "NO_DATA",
            "committed": 0,
            "failed_commits": 0,
            "warn_entries": [],
            "reasons": ["Log exists but no outreach-people-file-commit entries found."]
        }))
        return 2

    # WARN entries = "file updated but commit failed" — worst case, surfaces as BLOCK
    if warned:
        warn_summaries = [
            r.get("message", r.get("people_file", "unknown")) for r in warned[-5:]
        ]
        print(json.dumps({
            "verdict": "BLOCK",
            "status": "UNCOMMITTED_WRITES",
            "committed": len(committed),
            "failed_commits": len(failed) + len(warned),
            "warn_entries": warn_summaries,
            "reasons": [
                f"{len(warned)} outreach actions updated people files but git commit failed.",
                "These changes may be uncommitted. Run: git -C ~/anand-career-os status to verify.",
                "Commit manually: git -C ~/anand-career-os add brain/network/people/ && git -C ~/anand-career-os commit -m 'fix: recover uncommitted outreach state'"
            ]
        }))
        return 1

    if failed:
        print(json.dumps({
            "verdict": "BLOCK",
            "status": "VALIDATION_FAILURES",
            "committed": len(committed),
            "failed_commits": len(failed),
            "warn_entries": [],
            "reasons": [
                f"{len(failed)} outreach actions blocked (missing required fields — people_file, career_home, updates, or commit_message).",
                "These were not written to disk. Review caller to ensure all fields are supplied."
            ]
        }))
        return 1

    print(json.dumps({
        "verdict": "PASS",
        "status": "COMPLIANT",
        "committed": len(committed),
        "failed_commits": 0,
        "warn_entries": [],
        "reasons": [f"All {len(committed)} logged outreach actions committed successfully."]
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
