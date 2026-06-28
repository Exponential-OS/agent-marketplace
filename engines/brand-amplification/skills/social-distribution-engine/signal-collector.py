"""signal-collector.py

Phase v1.0 — Local signals only. Reads campaign analytics from the distribution
analytics engine output, maps performance metrics to the crowdsourced signal schema
(bucketed, no PII), and appends to local-signals.jsonl.

Usage:
  python3 signal-collector.py '<campaign_json>'
  python3 signal-collector.py -  (reads JSON from stdin)

Input JSON:
  campaign_file    - path to campaign JSON (required)
  signals_file     - override output file (default: $CAREER_HOME/brand-amplification/signals/local-signals.jsonl)

Invoked automatically by distribution-analytics-engine after analytics collection.
Local write only — no network calls in v1.0.
"""
import datetime
import json
import os
import pathlib
import sys
import uuid

_CAREER_HOME_RAW = os.environ.get("CAREER_HOME")
if not _CAREER_HOME_RAW:
    print(json.dumps({"verdict": "BLOCK", "reason": "CAREER_HOME env var not set. Run career-intelligence-onboarding first."}), file=sys.stderr)
    sys.exit(1)
_CAREER_HOME = pathlib.Path(_CAREER_HOME_RAW).expanduser()
if not _CAREER_HOME.is_dir():
    print(json.dumps({"verdict": "BLOCK", "reason": f"CAREER_HOME={_CAREER_HOME} does not exist or is not a directory."}), file=sys.stderr)
    sys.exit(1)
# SPEC-DRIFT-DETECTED: "brand-amplification/signals/" is NOT in owned_paths.
# The engine manifest declares owned_paths: ["performance-history.md", "campaigns/**", etc.].
# The old social-distribution-engine signals namespace predates brain-kernel.
# Migration target: brain.write("brand-amplification/performance-history.md", ...) or
# brain.write("brand-amplification/campaigns/signals/local-signals.jsonl", ...).
# This script continues to use direct FS writes as a subprocess gate — it cannot call
# brain.write() without a runtime brain instance. The signal path should be declared
# in owned_paths once the gate-script API supports brain-kernel injection.
DEFAULT_SIGNALS_FILE = _CAREER_HOME / "brand-amplification/signals/local-signals.jsonl"
SIGNAL_VERSION = "1.0"


# --- Bucket helpers ---

def _engagement_bucket(rate_pct: float | None) -> str:
    if rate_pct is None:
        return "unknown"
    if rate_pct < 1:
        return "0-1%"
    if rate_pct < 3:
        return "1-3%"
    if rate_pct < 7:
        return "3-7%"
    return "7%+"


def _impression_bucket(count: int | None) -> str:
    if count is None:
        return "unknown"
    if count < 100:
        return "0-100"
    if count < 500:
        return "100-500"
    if count < 2000:
        return "500-2000"
    if count < 10000:
        return "2000-10000"
    return "10000+"


def _comment_rate_bucket(rate_pct: float | None) -> str:
    if rate_pct is None:
        return "unknown"
    if rate_pct == 0:
        return "0%"
    if rate_pct < 0.5:
        return "0-0.5%"
    if rate_pct < 2:
        return "0.5-2%"
    return "2%+"


def _first_hour_engagement_bucket(rate_pct: float | None) -> str:
    if rate_pct is None:
        return "unknown"
    if rate_pct < 1:
        return "0-1%"
    if rate_pct < 5:
        return "1-5%"
    return "5%+"


def _char_count_bucket(count: int | None) -> str:
    if count is None:
        return "unknown"
    if count < 150:
        return "0-150"
    if count < 500:
        return "150-500"
    if count < 1500:
        return "500-1500"
    return "1500+"


def _hashtag_count_bucket(count: int | None) -> str:
    if count is None:
        return "unknown"
    if count == 0:
        return "0"
    if count <= 3:
        return "1-3"
    return "4+"


def _days_since_last_post_bucket(days: int | None) -> str:
    if days is None:
        return "unknown"
    if days <= 1:
        return "0-1"
    if days <= 7:
        return "2-7"
    if days <= 30:
        return "8-30"
    return "30+"


def _normalize_platform(raw: str) -> str:
    mapping = {
        "linkedin": "linkedin_post",
        "linkedin_post": "linkedin_post",
        "linkedin_article": "linkedin_article",
        "x": "x",
        "twitter": "x",
        "substack": "substack",
        "reddit": "reddit",
        "instagram": "instagram",
    }
    return mapping.get(raw.lower().strip(), raw.lower().strip())


def build_signal(campaign: dict, analytics: dict) -> dict:
    """Map campaign + analytics fields to the signal schema."""
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Extract posted_at from hub or first spoke
    hub = campaign.get("hub", {})
    posted_at_str = hub.get("posted_at") or hub.get("published_at") or ""
    posted_dt = None
    if posted_at_str:
        try:
            posted_dt = datetime.datetime.fromisoformat(posted_at_str.replace("Z", "+00:00"))
        except ValueError:
            pass

    platform = _normalize_platform(campaign.get("platform", hub.get("platform", "")))
    post_type = campaign.get("post_type", hub.get("type", "text_only"))
    content_category = campaign.get("content_category", "other")

    impressions = analytics.get("impressions")
    engagements = analytics.get("engagements")
    comments = analytics.get("comments")
    char_count = campaign.get("char_count") or len(hub.get("copy", ""))
    hashtag_count = campaign.get("hashtag_count")
    has_external_link = campaign.get("has_external_link", False)
    has_image = bool(campaign.get("image") or hub.get("image"))
    days_since_last = analytics.get("days_since_last_post")
    first_hour_engagement_rate = analytics.get("first_hour_engagement_rate_pct")

    engagement_rate = None
    if impressions and engagements:
        engagement_rate = round(engagements / impressions * 100, 2)

    comment_rate = None
    if impressions and comments is not None:
        comment_rate = round(comments / impressions * 100, 2)

    return {
        "signal_version": SIGNAL_VERSION,
        "platform": platform,
        "post_type": post_type,
        "content_category": content_category,
        "posted_at_hour_local": posted_dt.hour if posted_dt else None,
        "posted_at_day_of_week": posted_dt.strftime("%A").lower() if posted_dt else None,
        "character_count_bucket": _char_count_bucket(char_count or None),
        "hashtag_count_bucket": _hashtag_count_bucket(hashtag_count),
        "has_external_link": has_external_link,
        "has_image": has_image,
        "days_since_last_post_on_platform_bucket": _days_since_last_post_bucket(days_since_last),
        "engagement_rate_bucket": _engagement_bucket(engagement_rate),
        "impression_count_bucket": _impression_bucket(impressions),
        "comment_rate_bucket": _comment_rate_bucket(comment_rate),
        "first_hour_engagement_rate_bucket": _first_hour_engagement_bucket(first_hour_engagement_rate),
        "collected_at": now,
    }


def collect(campaign_file: str, signals_file: pathlib.Path) -> dict:
    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        return {"status": "skip", "reason": f"campaign file not found: {campaign_file}"}

    with campaign_path.open() as f:
        campaign = json.load(f)

    analytics = campaign.get("analytics", {})
    if not analytics:
        return {"status": "skip", "reason": "no analytics data in campaign — run distribution-analytics-engine first"}

    signal = build_signal(campaign, analytics)

    signals_file.parent.mkdir(parents=True, exist_ok=True)
    with signals_file.open("a") as f:
        f.write(json.dumps(signal) + "\n")

    return {"status": "collected", "signal": signal, "signals_file": str(signals_file)}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]

    try:
        ctx = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"status": "error", "reason": f"Invalid JSON: {e}"}))
        return 1

    campaign_file = ctx.get("campaign_file", "")
    if not campaign_file:
        print(json.dumps({"status": "error", "reason": "campaign_file is required"}))
        return 1

    signals_path = pathlib.Path(ctx["signals_file"]) if ctx.get("signals_file") else DEFAULT_SIGNALS_FILE
    result = collect(campaign_file, signals_path)
    print(json.dumps(result))
    return 0 if result["status"] in ("collected", "skip") else 1


if __name__ == "__main__":
    sys.exit(main())
