#!/usr/bin/env python3
"""
WATCH.py — company-flags-filter evolution scanner.

Surfaces keep/strengthen/kill verdict based on enforcement log history.
Key signal: block rate. If the rule never fires (0 blocks in many checks),
it may be working as a deterrent, or it may not be wired into callers.

Input:  $1 or stdin JSON (optional): {"log_file": "...", "min_sample": 10}
Output: JSON {verdict, signal, reason}
  verdict: "keep" | "strengthen" | "kill"
  signal:  "deterrent" | "active_enforcement" | "possible_bypass" | "no_data" | "not_wired"
Exit:   0=keep  1=strengthen/kill  2=uncertain (no data)
"""
import json
import pathlib
import sys

RULE_SLUG = "company-flags-filter"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"
DEFAULT_MIN_SAMPLE = 10


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
            "reason": "No enforcement log. Rule exists but has not fired. Verify callers invoke HOW.py."
        }))
        return 2

    total, blocks, passes, warns = 0, 0, 0, 0
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
                elif v == "WARN":
                    warns += 1
            except Exception:
                continue

    if total == 0:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": "Log exists but no company-flags-filter entries. Verify callers invoke HOW.py before surfacing job actions."
        }))
        return 2

    if total < min_sample:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": f"Insufficient sample ({total} events, need {min_sample}). Continue monitoring."
        }))
        return 2

    block_rate = blocks / total

    # If many passes and zero blocks with decent volume: either rule is working as
    # deterrent (callers don't surface flagged companies because they know this runs)
    # OR the rule is not actually being called for flagged companies.
    if blocks == 0 and total >= min_sample:
        print(json.dumps({
            "verdict": "keep",
            "signal": "deterrent",
            "reason": (
                f"Zero blocks in {total} checks. Rule may be working as deterrent "
                f"(callers screen before calling) or flagged companies are rare in pipeline. "
                f"Verify by checking if any flagged company appeared in job actions this period."
            )
        }))
        return 0

    # Healthy: rule fires regularly (10-40% block rate = active enforcement)
    if 0.10 <= block_rate <= 0.40:
        print(json.dumps({
            "verdict": "keep",
            "signal": "active_enforcement",
            "reason": f"{blocks} blocks in {total} checks ({block_rate:.0%} block rate). Rule is active and calibrated."
        }))
        return 0

    # High block rate (>40%) could mean flags.json is too aggressive or pipeline is flooded
    if block_rate > 0.40:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "possible_bypass",
            "reason": (
                f"High block rate: {blocks}/{total} ({block_rate:.0%}). "
                f"Either the flags list has grown large (review for stale entries) "
                f"or callers are surfacing too many flagged companies. "
                f"Consider adding re_evaluate_if dates to age out stale flags."
            )
        }))
        return 1

    # Low but nonzero block rate (< 10%)
    print(json.dumps({
        "verdict": "keep",
        "signal": "active_enforcement",
        "reason": f"{blocks} blocks in {total} checks ({block_rate:.0%} block rate). Normal enforcement."
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
