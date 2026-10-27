#!/usr/bin/env python3
"""
AUDIT.py — analytics-sync-watch compliance audit.
Surfaces all published campaigns without analytics data, regardless of age.

Input:  $1 or stdin JSON (optional): {"career_home": "...", "campaigns_dirs": [...]}
Output: JSON {verdict, status, published_without_analytics, schema_gap_found, reasons}
Exit:   0=PASS  1=BLOCK (published campaigns missing analytics)  2=WARN (no data)
"""
import json
import os
import pathlib
import sys
from datetime import date

LIVE_STATUSES = {"published", "live", "sent"}
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

    career_home = ctx.get("career_home", os.environ.get("CAREER_HOME", CAREER_HOME_DEFAULT))
    scan_dirs = ctx.get("campaigns_dirs", default_campaign_dirs(career_home))
    dirs_note = campaign_dirs_note(scan_dirs, career_home)

    all_campaigns = []
    for d in scan_dirs:
        dp = pathlib.Path(d)
        if dp.exists():
            all_campaigns.extend(dp.rglob("campaign.json"))

    if not all_campaigns:
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA",
                          "published_without_analytics": [], "schema_gap_found": False,
                          "reasons": [no_data_reason(scan_dirs)],
                          **({"campaign_dirs_note": dirs_note} if dirs_note else {})}))
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
            ],
            **({"campaign_dirs_note": dirs_note} if dirs_note else {}),
        }))
        return 1

    print(json.dumps({"verdict": "PASS", "status": "COMPLIANT",
                      "published_without_analytics": [], "schema_gap_found": False,
                      "reasons": ["All published campaigns have analytics data."],
                      **({"campaign_dirs_note": dirs_note} if dirs_note else {})}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
