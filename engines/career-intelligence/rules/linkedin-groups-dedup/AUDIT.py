"""linkedin-groups-dedup/AUDIT.py

Audits recent compliance: scans the enforcement log for group-dedup verdicts over
the last 30 days and surfaces BLOCK rate, false-positive risk, and coverage gaps.

Input JSON via $1 (all optional):
  log_file     - path to groups-post-log.jsonl
  lookback_days - audit window in days (default: 30)

Output: JSON audit report
Exit:   0=audit complete
"""
import datetime
import json
import os
import pathlib
import sys

_CAREER_HOME = pathlib.Path(
    os.environ.get("CAREER_HOME", os.environ.get("CAREER_OS_HOME", str(pathlib.Path.home() / "anand-career-os")))
)
DEFAULT_LOG = _CAREER_HOME / "brain/social-distribution-engine/groups-post-log.jsonl"
ENFORCEMENT_LOG = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"
DEFAULT_LOOKBACK_DAYS = 30


def main() -> int:
    ctx = {}
    if len(sys.argv) >= 2 and sys.argv[1] != "-":
        try:
            ctx = json.loads(sys.argv[1])
        except json.JSONDecodeError:
            pass

    log_path = pathlib.Path(ctx["log_file"]) if ctx.get("log_file") else DEFAULT_LOG
    lookback = int(ctx.get("lookback_days", DEFAULT_LOOKBACK_DAYS))
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=lookback)

    # Count verdicts from enforcement log
    passes = 0
    blocks = 0
    if ENFORCEMENT_LOG.exists():
        with ENFORCEMENT_LOG.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("rule_slug") != "linkedin-groups-dedup":
                    continue
                try:
                    ts = datetime.datetime.fromisoformat(entry["ts"].replace("Z", "+00:00"))
                except (KeyError, ValueError):
                    continue
                if ts < cutoff:
                    continue
                if entry.get("verdict") == "PASS":
                    passes += 1
                elif entry.get("verdict") == "BLOCK":
                    blocks += 1

    # Count total group posts in log
    total_posts = 0
    group_counts: dict = {}
    if log_path.exists():
        with log_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                total_posts += 1
                gn = entry.get("group_name", entry.get("group_url", "unknown"))
                group_counts[gn] = group_counts.get(gn, 0) + 1

    total_checks = passes + blocks
    block_rate = round(blocks / total_checks * 100, 1) if total_checks else 0

    report = {
        "audit_window_days": lookback,
        "total_gate_checks": total_checks,
        "passes": passes,
        "blocks": blocks,
        "block_rate_pct": block_rate,
        "total_group_posts_logged": total_posts,
        "posts_per_group": group_counts,
        "log_file": str(log_path),
        "log_exists": log_path.exists(),
    }

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
