#!/usr/bin/env python3
"""
analytics-sync-watch/WATCH.py — Detects campaigns where the distribution phase
completed (any spoke/hub is live) but no analytics update has been recorded.

The flywheel learning loop has 5 phases. Phase 5 (analytics) is the only one
that closes the loop: Idea → Ship → Measure → Learn → Next Idea. Without Phase 5,
every campaign ships into a void — no signal about what worked, no improvement for
the next campaign. This WATCH surfaces campaigns in that state.

Currently, the campaign.json schema does not have a dedicated `analytics` section.
This rule's WATCH also flags that schema gap if it detects published campaigns
without any analytics data.

Input:  $1 or stdin JSON (optional):
    {
      "campaigns_dirs": ["/abs/path/to/brand-amplification/campaigns", "/abs/path/to/WIP/..."],
      "career_home": "/abs/path/...",
      "stale_days": 7
    }
Output: JSON {verdict, signal, reason, stale_campaigns, schema_gap_found}
Exit:   0=keep  1=strengthen  2=uncertain
"""

import json
import os
import pathlib
import sys
from datetime import date, timedelta

LIVE_STATUSES = {"published", "live", "sent"}
DEFAULT_STALE_DAYS = 7
CAREER_HOME_DEFAULT = os.environ.get("CAREER_HOME") or ""

# XOS-353: the scan list hardcoded a second directory named after one
# maintainer's personal folder layout, resolved against every customer's
# career_home. Harmless on their disk (it simply does not exist) but it is their
# campaigns that go unscanned when they keep campaigns anywhere else, and the
# name itself shipped to them as if it were product vocabulary.
#
# The plugin's OWN namespace is now the only default. Anything else -- including
# the original installation's WIP folder -- comes from BAE_CAMPAIGN_DIRS, a
# colon-separated list of paths, absolute or relative to career_home.
CAMPAIGN_DIRS_ENV = "BAE_CAMPAIGN_DIRS"
OWNED_CAMPAIGNS_SUBDIR = "brand-amplification/campaigns"


def default_campaign_dirs(career_home: str) -> list[str]:
    home = pathlib.Path(career_home)
    dirs = [str(home / OWNED_CAMPAIGNS_SUBDIR)]
    for extra in os.environ.get(CAMPAIGN_DIRS_ENV, "").split(":"):
        extra = extra.strip()
        if not extra:
            continue
        p = pathlib.Path(extra).expanduser()
        dirs.append(str(p if p.is_absolute() else home / p))
    return dirs

def no_data_reason(scan_dirs: list[str]) -> str:
    """Why nothing was found, and what to do -- at the moment it happens.

    XOS-353 narrowed the default scan list to the directory this plugin owns.
    That is the right default, but an upgrade makes campaigns kept elsewhere
    silently invisible, and a CHANGELOG entry is not something a cron run reads.
    So the no-data verdict names the env var rather than only the empty dirs.
    """
    configured = os.environ.get(CAMPAIGN_DIRS_ENV)
    if configured:
        return (
            f"No campaign.json files found in scan dirs: {scan_dirs} "
            f"({CAMPAIGN_DIRS_ENV}={configured!r}). Fix: check those paths exist "
            f"and contain campaign.json."
        )
    return (
        f"No campaign.json files found in scan dirs: {scan_dirs}. If you keep "
        f"campaigns somewhere else, set {CAMPAIGN_DIRS_ENV} to those roots "
        f"(colon-separated, absolute or relative to CAREER_HOME). Before "
        f"brand-amplification 0.66.0 a second directory was scanned by default; "
        f"it is configuration now, so an upgrade can make existing campaigns "
        f"invisible until you name them."
    )


def campaign_dirs_note(
    scan_dirs: list[str] | None = None, career_home: str = ""
) -> str | None:
    """Say the default narrowed, on EVERY run, not only when nothing is found.

    The first version put this on the no-data path only. A cross-family judge
    pointed out the hole: if the directory this plugin owns has ANY campaigns,
    the run looks healthy and campaigns kept elsewhere vanish from monitoring
    with no signal at all. The quiet case is the one that needed the warning.

    None once the operator has answered by setting the variable.
    """
    if os.environ.get(CAMPAIGN_DIRS_ENV):
        return None
    # A caller that passed campaigns_dirs explicitly already decided where to
    # look, and telling them "scanning only <our subdir>" while scanning their
    # roots is a false statement about the run -- worse than saying nothing.
    # Compare against the career_home ACTUALLY IN USE. The first version read
    # os.environ here while main() resolves it from ctx first, so a ctx-supplied
    # home made every scan look "explicit" and suppressed the warning outright --
    # caught by both lanes of the panel, which is the shape of bug that survives
    # a reviewer who only checks whether the comparison looks reasonable.
    if scan_dirs is not None and scan_dirs != default_campaign_dirs(career_home):
        return None
    return (
        f"Scanning only {OWNED_CAMPAIGNS_SUBDIR}. Before brand-amplification "
        f"0.66.0 a second directory was scanned by default; it is configuration "
        f"now. If you keep campaigns anywhere else, set {CAMPAIGN_DIRS_ENV} "
        f"(colon-separated, absolute or relative to CAREER_HOME) or they are not "
        f"being monitored."
    )




def is_published(campaign):
    """Return True if any component is live/published."""
    if campaign.get("source", {}).get("status", "").lower() in LIVE_STATUSES:
        return True
    if campaign.get("hub", {}).get("status", "").lower() in LIVE_STATUSES:
        return True
    for spoke in campaign.get("spokes", []):
        if spoke.get("status", "").lower() in LIVE_STATUSES:
            return True
    return False


def has_analytics(campaign):
    """Return True if campaign has an analytics section with any non-null data."""
    analytics = campaign.get("analytics")
    if not analytics:
        return False
    if isinstance(analytics, dict):
        return any(v is not None for v in analytics.values())
    return False


def get_ship_date(campaign):
    """Return ship_date from meta as date object, or None."""
    ship_date_str = campaign.get("meta", {}).get("ship_date", "")
    if not ship_date_str:
        return None
    try:
        return date.fromisoformat(str(ship_date_str))
    except (ValueError, TypeError):
        return None


def find_campaign_files(dirs):
    """Recursively find campaign.json files in the given directories."""
    files = []
    for d in dirs:
        dp = pathlib.Path(d)
        if not dp.exists():
            continue
        for f in dp.rglob("campaign.json"):
            files.append(f)
    return files


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]

    try:
        ctx = json.loads(raw) if raw.strip() else {}
    except Exception:
        ctx = {}

    career_home = ctx.get("career_home", os.environ.get("CAREER_HOME", CAREER_HOME_DEFAULT))
    stale_days = int(ctx.get("stale_days", DEFAULT_STALE_DAYS))
    today = date.today()

    scan_dirs = ctx.get("campaigns_dirs", default_campaign_dirs(career_home))

    dirs_note = campaign_dirs_note(scan_dirs, career_home)
    campaign_files = find_campaign_files(scan_dirs)
    if not campaign_files:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": no_data_reason(scan_dirs),
            "stale_campaigns": [],
            "schema_gap_found": False,
            **({"campaign_dirs_note": dirs_note} if dirs_note else {}),
        }))
        return 2

    stale_campaigns = []
    schema_gap_found = False
    published_count = 0

    for cf in campaign_files:
        try:
            campaign = json.loads(cf.read_text(encoding="utf-8"))
        except Exception:
            continue

        if not is_published(campaign):
            continue

        published_count += 1

        # Check for analytics schema gap
        if "analytics" not in campaign:
            schema_gap_found = True

        # Check if analytics data is stale/missing
        if not has_analytics(campaign):
            ship_date = get_ship_date(campaign)
            campaign_id = campaign.get("meta", {}).get("id") or cf.parent.name
            if ship_date and (today - ship_date).days >= stale_days:
                stale_campaigns.append({
                    "campaign_id": campaign_id,
                    "ship_date": str(ship_date),
                    "days_since_ship": (today - ship_date).days,
                    "path": str(cf)
                })
            elif not ship_date:
                # Published but no ship_date — flag it
                stale_campaigns.append({
                    "campaign_id": campaign_id,
                    "ship_date": None,
                    "days_since_ship": None,
                    "path": str(cf)
                })

    if not published_count:
        print(json.dumps({
            "verdict": "keep",
            "signal": "no_data",
            "reason": "No published campaigns found. Analytics monitoring starts after first campaign ships.",
            "stale_campaigns": [],
            "schema_gap_found": schema_gap_found,
            **({"campaign_dirs_note": dirs_note} if dirs_note else {}),
        }))
        return 2

    reason_parts = []

    if schema_gap_found:
        reason_parts.append(
            "Schema gap detected: published campaigns have no 'analytics' section in campaign.json. "
            "Add 'analytics': {'impressions': null, 'reactions': null, 'comments': null, 'shares': null, 'profile_views_delta': null, 'updated': null} "
            "to the campaign schema (campaign.schema.json) and set values after each campaign's 7-day window."
        )

    stale_rate = len(stale_campaigns) / published_count if published_count else 0

    if stale_campaigns:
        stale_ids = [s["campaign_id"] for s in stale_campaigns]
        reason_parts.append(
            f"{len(stale_campaigns)}/{published_count} published campaign(s) have no analytics data "
            f"after {stale_days}+ days: {stale_ids}. "
            f"Add analytics data or this WATCH will keep firing."
        )

    if stale_campaigns or schema_gap_found:
        print(json.dumps({
            "verdict": "strengthen",
            "signal": "analytics_gap" if not schema_gap_found else "schema_and_analytics_gap",
            "reason": " | ".join(reason_parts),
            "stale_campaigns": stale_campaigns,
            "schema_gap_found": schema_gap_found,
            **({"campaign_dirs_note": dirs_note} if dirs_note else {}),
        }))
        return 1

    print(json.dumps({
        "verdict": "keep",
        "signal": "healthy",
        "reason": f"All {published_count} published campaign(s) have analytics data. Learning loop is closed.",
        "stale_campaigns": [],
        "schema_gap_found": False,
        **({"campaign_dirs_note": dirs_note} if dirs_note else {}),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
