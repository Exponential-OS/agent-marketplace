#!/usr/bin/env python3
"""
analytics-sync-watch/HOW.py — Gate that warns if a campaign is 7+ days post-ship
with no analytics data recorded.

This is a WARN gate (exit 2), not a BLOCK. Publishing is not blocked by missing
analytics — but the distribution orchestration warns the human to record metrics
before the engagement window closes (typically 7-14 days post-publish).

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json",
      "stale_days": 7
    }

Exit:
    0 = PASS  (campaign not yet at stale threshold, or analytics already present)
    2 = WARN  (campaign is stale — analytics window is closing or closed)

Stdout: JSON {"status": "pass|warn", "days_since_ship": int|null, "has_analytics": bool, "message": str}
"""

import json
import pathlib
import sys
from datetime import date

LIVE_STATUSES = {"published", "live", "sent"}
DEFAULT_STALE_DAYS = 7


def out(code, status, days_since_ship, has_analytics, message):
    print(json.dumps({
        "status": status,
        "days_since_ship": days_since_ship,
        "has_analytics": has_analytics,
        "message": message
    }))
    sys.exit(code)


def is_published(campaign):
    if campaign.get("source", {}).get("status", "").lower() in LIVE_STATUSES:
        return True
    if campaign.get("hub", {}).get("status", "").lower() in LIVE_STATUSES:
        return True
    for spoke in campaign.get("spokes", []):
        if spoke.get("status", "").lower() in LIVE_STATUSES:
            return True
    return False


def has_analytics(campaign):
    analytics = campaign.get("analytics")
    if not analytics:
        return False
    if isinstance(analytics, dict):
        return any(v is not None for v in analytics.values())
    return False


def main():
    if len(sys.argv) < 2:
        out(0, "pass", None, False, "No input. Defaulting to pass.")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(0, "pass", None, False, f"Invalid JSON: {e}")

    campaign_file = ctx.get("campaign_file", "")
    stale_days = int(ctx.get("stale_days", DEFAULT_STALE_DAYS))

    if not campaign_file:
        out(0, "pass", None, False, "No campaign_file. Defaulting to pass.")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(0, "pass", None, False, f"campaign.json not found: {campaign_file}")

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(0, "pass", None, False, f"Cannot parse campaign.json: {e}")

    if not is_published(campaign):
        out(0, "pass", None, False,
            "PASS — Campaign not yet published. Analytics monitoring starts after ship.")

    analytics_present = has_analytics(campaign)
    if analytics_present:
        out(0, "pass", None, True,
            "PASS — Campaign published and analytics data present.")

    ship_date_str = campaign.get("meta", {}).get("ship_date")
    today = date.today()
    days_since_ship = None

    if ship_date_str:
        try:
            ship_date = date.fromisoformat(str(ship_date_str))
            days_since_ship = (today - ship_date).days
        except (ValueError, TypeError):
            pass

    if days_since_ship is not None and days_since_ship >= stale_days:
        campaign_id = campaign.get("meta", {}).get("id", campaign_path.parent.name)
        out(2, "warn", days_since_ship, False,
            f"WARN — '{campaign_id}' published {days_since_ship} days ago but has no analytics data. "
            f"Record impressions/reactions/comments/shares in campaign.analytics before the engagement window closes.")

    out(0, "pass", days_since_ship, False,
        f"PASS — Campaign published {days_since_ship or 0} days ago. Analytics window still open ({stale_days - (days_since_ship or 0)} days remaining).")


if __name__ == "__main__":
    main()
