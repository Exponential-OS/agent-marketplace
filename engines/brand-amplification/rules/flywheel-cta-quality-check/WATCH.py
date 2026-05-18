#!/usr/bin/env python3
"""
WATCH.py — flywheel-cta-quality-check evolution scanner.

Observes block/warn/pass rates over the last 30 days and emits
keep/strengthen/kill verdict with reasoning.

Exit: 0=keep  1=strengthen  2=kill (rare — would mean 0 fires in 30 days)
"""
import datetime
import json
import pathlib
import sys

RULE_SLUG = "flywheel-cta-quality-check"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".career-os-enforcement-log.jsonl"
WINDOW_DAYS = 30


def main() -> int:
    log_file = pathlib.Path(LOG_FILE_DEFAULT)
    if not log_file.exists():
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": "No enforcement log yet — gate is new. Keep and accumulate signal.",
            "stats": {}
        }))
        return 0

    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=WINDOW_DAYS)
    blocks, passes, warns, skipped = 0, 0, 0, 0

    with open(log_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("rule_slug") != RULE_SLUG:
                    continue
                ts_str = r.get("ts", "")
                if ts_str:
                    ts = datetime.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts < cutoff:
                        continue
                v = r.get("verdict", "")
                if v == "block":
                    blocks += 1
                elif v == "pass":
                    passes += 1
                elif v == "warn":
                    warns += 1
                else:
                    skipped += 1
            except Exception:
                continue

    total = blocks + passes + warns
    stats = {"total": total, "blocks": blocks, "warns": warns, "passes": passes,
             "window_days": WINDOW_DAYS}

    if total == 0:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_recent_fires",
            "reason": "No fires in last 30 days. Gate may not be wired into workflow yet — keep.",
            "stats": stats
        }))
        return 0

    block_rate = blocks / total
    warn_rate = warns / total

    if block_rate > 0.40:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "high_block_rate",
            "reason": (
                f"Block rate {block_rate:.0%} ({blocks}/{total}) — CTA violations are frequent. "
                "Likely cause: agents are not loading CTA best practices before drafting. "
                "Suggest: add CTA requirements checklist to campaign-scaffolding-template or SKILL.md Step 0."
            ),
            "suggestion": "Add per-platform CTA requirements checklist to campaign scaffold template.",
            "stats": stats
        }))
        return 1

    if warn_rate > 0.50:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "high_warn_rate",
            "reason": (
                f"Warn rate {warn_rate:.0%} ({warns}/{total}) — advisory CTA issues are common. "
                "Review PROMPT.md: are warn patterns that consistently appear actually blocks? "
                "Consider promoting recurring warn patterns to block severity."
            ),
            "suggestion": "Audit recurring warn patterns — promote systemic CTA misses to block severity.",
            "stats": stats
        }))
        return 1

    if block_rate == 0 and total >= 5:
        print(json.dumps({
            "verdict": "keep",
            "signal": "deterrent",
            "reason": (
                f"Zero blocks in {total} fires over {WINDOW_DAYS} days. "
                "Gate may be deterring weak CTAs pre-authoring or CTA discipline is well-internalized. "
                "Keep — zero-block is the goal."
            ),
            "stats": stats
        }))
        return 0

    print(json.dumps({
        "verdict": "keep",
        "signal": "healthy",
        "reason": (
            f"Block rate {block_rate:.0%}, warn rate {warn_rate:.0%} across {total} fires. "
            "Normal enforcement cadence. Keep."
        ),
        "stats": stats
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
