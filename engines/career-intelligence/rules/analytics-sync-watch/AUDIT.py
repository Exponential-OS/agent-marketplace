#!/usr/bin/env python3
"""
AUDIT.py — analytics-sync-watch compliance audit.
Surfaces all published campaigns without analytics data, regardless of age.

Input:  $1 or stdin JSON (optional): {"career_os_home": "...", "campaigns_dirs": [...]}
Output: JSON {verdict, status, published_without_analytics, schema_gap_found, reasons}
Exit:   0=PASS  1=BLOCK (published campaigns missing analytics)  2=WARN (no data)
"""
import json
import os
import pathlib
import sys
from datetime import date

LIVE_STATUSES = {"published", "live", "sent"}
CAREER_OS_HOME_DEFAULT = str(pathlib.Path.home() / "anand-career-os")


def is_published(campaign):
    if campaign.get("source", {}).get("status", "").lower() in LIVE_STATUSES:
        return True
    if campaign.get("hub", {}).get("status", "").lower() in LIVE_STATUSES:
        return True
    return any(s.get("status", "").lower() in LIVE_STATUSES for s in campaign.get("spokes", []))


def has_analytics(campaign):
    a = campaign.get("analytics")
    if not a:
        return False
    return isinstance(a, dict) and any(v is not None for v in a.values())


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]
    try:
        ctx = json.loads(raw) if raw.strip() else {}
    except Exception:
        ctx = {}

    career_os_home = ctx.get("career_os_home", os.environ.get("CAREER_OS_HOME", CAREER_OS_HOME_DEFAULT))
    default_dirs = [
        str(pathlib.Path(career_os_home) / "brain/social-distribution-engine/campaigns"),
        str(pathlib.Path(career_os_home) / "WIP/branding-product/articles"),
    ]
    scan_dirs = ctx.get("campaigns_dirs", default_dirs)

    all_campaigns = []
    for d in scan_dirs:
        dp = pathlib.Path(d)
        if dp.exists():
            all_campaigns.extend(dp.rglob("campaign.json"))

    if not all_campaigns:
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA",
                          "published_without_analytics": [], "schema_gap_found": False,
                          "reasons": ["No campaign.json files found in scan dirs."]}))
        return 2

    missing = []
    schema_gap = False
    for cf in all_campaigns:
        try:
            campaign = json.loads(cf.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not is_published(campaign):
            continue
        if "analytics" not in campaign:
            schema_gap = True
        if not has_analytics(campaign):
            missing.append({
                "campaign_id": campaign.get("meta", {}).get("id") or cf.parent.name,
                "path": str(cf)
            })

    if missing:
        print(json.dumps({
            "verdict": "BLOCK",
            "status": "ANALYTICS_MISSING",
            "published_without_analytics": missing,
            "schema_gap_found": schema_gap,
            "reasons": [
                f"{len(missing)} published campaign(s) have no analytics data.",
                *(["Analytics schema field missing from campaign.json — add 'analytics' section to schema."] if schema_gap else [])
            ]
        }))
        return 1

    print(json.dumps({"verdict": "PASS", "status": "COMPLIANT",
                      "published_without_analytics": [], "schema_gap_found": False,
                      "reasons": ["All published campaigns have analytics data."]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
