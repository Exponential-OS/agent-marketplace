#!/usr/bin/env python3
"""
WATCH.py — outreach-people-file-commit evolution scanner.

Key signal: commit success rate. If WARN rate is high (commit fails after write),
it means the rule is partially working but session death is cutting commits short.
If BLOCK rate is high, callers are not supplying required fields.

Input:  $1 or stdin JSON (optional): {"log_file": "...", "min_sample": 5}
Output: JSON {verdict, signal, reason}
  verdict: "keep" | "strengthen" | "kill"
  signal:  "healthy" | "caller_gap" | "session_death_risk" | "no_data"
Exit:   0=keep  1=strengthen/kill  2=uncertain
"""
import json
import pathlib
import sys

RULE_SLUG = "outreach-people-file-commit"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"
DEFAULT_MIN_SAMPLE = 5


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
    min_sample = int(ctx.get("min_sample", DEFAULT_MIN_SAMPLE))

    if not log_file.exists():
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": "No enforcement log. Verify outreach-composer and network-intelligence call HOW.py after every confirmed send."
        }))
        return 2

    total, passes, blocks, warns = 0, 0, 0, 0
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
                if v == "PASS":
                    passes += 1
                elif v == "BLOCK":
                    blocks += 1
                elif v == "WARN":
                    warns += 1
            except Exception:
                continue

    if total == 0:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": "Log exists but no outreach-people-file-commit entries. Verify outreach-composer calls HOW.py after send confirmation."
        }))
        return 2

    if total < min_sample:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": f"Insufficient sample ({total} events, need {min_sample}). Continue monitoring."
        }))
        return 2

    warn_rate = warns / total
    block_rate = blocks / total
    pass_rate = passes / total

    # High warn rate = session death risk: files written but commits failing
    if warn_rate > 0.20:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "session_death_risk",
            "reason": (
                f"High warn rate: {warns}/{total} ({warn_rate:.0%}) outreach actions had people file updated but commit failed. "
                f"Risk: session death between write and commit leaves uncommitted state. "
                f"Consider adding a pre-session hook that checks for uncommitted people-file changes on startup."
            )
        }))
        return 1

    # High block rate = callers not supplying required fields
    if block_rate > 0.30:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "caller_gap",
            "reason": (
                f"High block rate: {blocks}/{total} ({block_rate:.0%}) outreach actions were blocked for missing fields. "
                f"Callers (outreach-composer, network-intelligence) are not supplying people_file, career_home, updates, or commit_message. "
                f"Review caller integrations."
            )
        }))
        return 1

    # Healthy: high pass rate
    print(json.dumps({
        "verdict": "keep",
        "signal": "healthy",
        "reason": (
            f"{passes}/{total} outreach actions committed successfully ({pass_rate:.0%} commit rate). "
            f"{blocks} blocked (bad input), {warns} warn (commit failed after write). Rule is healthy."
        )
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
