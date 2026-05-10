"""linkedin-groups-dedup/HOW.py

Gate: before posting to any LinkedIn Group, check groups-post-log.jsonl for a post
to the same group within the last 7 days (configurable).

Input JSON via $1:
  group_url      - LinkedIn group URL (required)
  log_file       - absolute path to groups-post-log.jsonl
                   (default: $CAREER_HOME/brain/social-distribution-engine/groups-post-log.jsonl)
  lookback_days  - cooldown window in days (default: 7)

Output: JSON {"verdict": "PASS"} or {"verdict": "BLOCK", "reason": "...", "last_posted": "...", "next_available": "..."}
Exit:   0=PASS  1=BLOCK
"""
import datetime
import json
import os
import pathlib
import sys

RULE_SLUG = "linkedin-groups-dedup"
LOG_FILE = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"

_CAREER_HOME = pathlib.Path(
    os.environ.get("CAREER_HOME", os.environ.get("CAREER_OS_HOME", str(pathlib.Path.home() / "anand-career-os")))
)
DEFAULT_LOG = _CAREER_HOME / "brain/social-distribution-engine/groups-post-log.jsonl"
DEFAULT_LOOKBACK_DAYS = 7


def _log(verdict: str) -> None:
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    record = {"ts": ts, "rule_slug": RULE_SLUG, "script_type": "HOW", "verdict": verdict}
    try:
        with LOG_FILE.open("a") as f:
            f.write(json.dumps(record) + "\n")
    except OSError:
        pass


def _normalize_url(url: str) -> str:
    """Strip trailing slashes for stable comparison."""
    return url.rstrip("/").lower()


def check(group_url: str, log_file: pathlib.Path, lookback_days: int) -> dict:
    norm_url = _normalize_url(group_url)
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=lookback_days)

    if not log_file.exists():
        return {"verdict": "PASS"}

    most_recent = None
    try:
        with log_file.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if _normalize_url(entry.get("group_url", "")) != norm_url:
                    continue
                posted_str = entry.get("posted_at", "")
                try:
                    posted_dt = datetime.datetime.fromisoformat(
                        posted_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    continue
                if posted_dt > cutoff:
                    if most_recent is None or posted_dt > most_recent:
                        most_recent = posted_dt
    except OSError:
        return {"verdict": "PASS"}

    if most_recent is None:
        return {"verdict": "PASS"}

    next_available = most_recent + datetime.timedelta(days=lookback_days)
    days_remaining = (next_available - now).days + 1
    return {
        "verdict": "BLOCK",
        "reason": (
            f"Posted to this group {(now - most_recent).days} day(s) ago "
            f"(cooldown: {lookback_days} days). "
            f"Next available: {next_available.strftime('%Y-%m-%d')} "
            f"({days_remaining} day(s) from now)."
        ),
        "last_posted": most_recent.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "next_available": next_available.strftime("%Y-%m-%d"),
    }


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]

    try:
        ctx = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        result = {"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}
        print(json.dumps(result))
        return 1

    group_url = ctx.get("group_url", "").strip()
    if not group_url:
        result = {"verdict": "BLOCK", "reason": "group_url is required."}
        print(json.dumps(result))
        return 1

    log_path = pathlib.Path(ctx["log_file"]) if ctx.get("log_file") else DEFAULT_LOG
    lookback = int(ctx.get("lookback_days", DEFAULT_LOOKBACK_DAYS))

    result = check(group_url, log_path, lookback)
    print(json.dumps(result))

    if result["verdict"] == "BLOCK":
        _log("BLOCK")
        return 1
    _log("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
