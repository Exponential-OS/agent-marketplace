"""linkedin-groups-dedup/WATCH.py

Observes fire rate and false-negative patterns. Emits keep/strengthen/kill verdict.
Cadence auto-adjusts: 3 consecutive "keep" → halve; "strengthen" → double.

Output: JSON {"verdict": "keep|strengthen|kill", "signal": "...", "reason": "..."}
Exit:   0=always
"""
import datetime
import json
import os
import pathlib
import sys

_CAREER_HOME_RAW = os.environ.get("CAREER_HOME")
_CAREER_HOME = pathlib.Path(_CAREER_HOME_RAW).expanduser() if _CAREER_HOME_RAW else None
DEFAULT_LOG = _CAREER_HOME / "brand-amplification/groups-post-log.jsonl" if _CAREER_HOME else pathlib.Path("/nonexistent/career-home-not-set")
ENFORCEMENT_LOG = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"
WATCH_WINDOW_DAYS = 14


def main() -> int:
    ctx = {}
    if len(sys.argv) >= 2 and sys.argv[1] != "-":
        try:
            ctx = json.loads(sys.argv[1])
        except json.JSONDecodeError:
            pass

    log_path = pathlib.Path(ctx.get("log_file", str(DEFAULT_LOG)))
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=WATCH_WINDOW_DAYS)

    blocks = 0
    passes = 0
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
                if entry.get("verdict") == "BLOCK":
                    blocks += 1
                elif entry.get("verdict") == "PASS":
                    passes += 1

    total = blocks + passes

    # Zero fire rate with an active groups log = possible bypass
    log_active = log_path.exists() and log_path.stat().st_size > 0 if log_path.exists() else False

    if total == 0 and log_active:
        verdict = "strengthen"
        signal = "zero gate checks in last 14 days but groups-post-log.jsonl is non-empty"
        reason = "Gate may not be wired into distribution flow. Verify SKILL.md invokes HOW.py before group posts."
    elif total == 0:
        verdict = "keep"
        signal = "no groups posted yet"
        reason = "Rule is dormant — no group posts logged. Keep as-is until groups distribution activates."
    elif blocks == 0 and passes >= 5:
        verdict = "keep"
        signal = f"{passes} passes, 0 blocks in {WATCH_WINDOW_DAYS} days"
        reason = "Gate firing correctly with no false spikes. Cooldown window appears appropriate."
    elif blocks / total > 0.5:
        verdict = "strengthen"
        signal = f"high block rate: {blocks}/{total} checks blocked in {WATCH_WINDOW_DAYS} days"
        reason = "Over 50% block rate may indicate posting cadence is too high or cooldown is too short. Review campaign frequency."
    else:
        verdict = "keep"
        signal = f"{passes} passes, {blocks} blocks in {WATCH_WINDOW_DAYS} days"
        reason = "Gate operating within normal parameters."

    print(json.dumps({"verdict": verdict, "signal": signal, "reason": reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
