#!/usr/bin/env python3
"""
campaign_tracker.py — per-campaign URL capture, analytics, and file structure enforcer.

Each campaign lives at:
  WIP/branding-product/articles/NN-slug-YYYY-MM-DD/

This script reads/writes campaign.json in that folder — the machine-readable
source of truth for live URLs, post status, and analytics snapshots.

Usage:
  # Initialize a new campaign.json
  python3 campaign_tracker.py init --campaign-dir /path/to/NN-slug/

  # Record a live URL after posting
  python3 campaign_tracker.py record-url --campaign-dir /path/to/ --platform linkedin_post --url https://... --post-id abc123

  # Capture an analytics snapshot (manual or scraped)
  python3 campaign_tracker.py record-analytics --campaign-dir /path/to/ --platform linkedin_post --views 1200 --likes 43 --comments 7 --shares 12

  # Validate campaign structure (all expected files present, all posted platforms have URLs)
  python3 campaign_tracker.py validate --campaign-dir /path/to/

  # Print status summary
  python3 campaign_tracker.py status --campaign-dir /path/to/

Output: JSON to stdout. Exit 0=ok, 1=fail.

Designed to migrate to xos-core/plugins/social-distribution/ when CareerOS → xOS.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

CAMPAIGN_JSON = "campaign.json"

CANONICAL_SUBDIRS = ["content", "assets", "reviews"]
CANONICAL_FILES   = ["campaign-master.md"]

PLATFORM_KEYS = [
    "substack_post", "linkedin_post", "linkedin_article",
    "x_post", "instagram_caption", "reddit_post", "facebook_post",
    "threads_post", "email_body",
]

STATUS_VALUES = ("draft", "scheduled", "live", "skipped", "parked")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load(campaign_dir: pathlib.Path) -> dict:
    path = campaign_dir / CAMPAIGN_JSON
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        _die(f"campaign.json is malformed: {e}")


def _save(campaign_dir: pathlib.Path, data: dict) -> None:
    path = campaign_dir / CAMPAIGN_JSON
    data["_updated"] = _now()
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def _die(msg: str) -> None:
    print(json.dumps({"verdict": "error", "error": msg}))
    sys.exit(1)


def _resolve(path_str: str) -> pathlib.Path:
    p = pathlib.Path(path_str).expanduser().resolve()
    if not p.is_dir():
        _die(f"Campaign directory not found: {p}")
    return p


# ── Commands ───────────────────────────────────────────────────────────────

def cmd_init(campaign_dir: pathlib.Path, slug: str, title: str) -> None:
    path = campaign_dir / CAMPAIGN_JSON
    if path.exists():
        existing = json.loads(path.read_text())
        print(json.dumps({"verdict": "warn", "message": "campaign.json already exists", "data": existing}, indent=2))
        return

    data = {
        "_schema": "campaign/v1",
        "_created": _now(),
        "_updated": _now(),
        "slug": slug or campaign_dir.name,
        "title": title or "",
        "campaign_dir": str(campaign_dir),
        "platforms": {},
    }
    _save(campaign_dir, data)
    print(json.dumps({"verdict": "pass", "message": f"Initialized {path}", "data": data}, indent=2))


def cmd_record_url(campaign_dir: pathlib.Path, platform: str, url: str, post_id: str) -> None:
    if platform not in PLATFORM_KEYS:
        _die(f"Unknown platform '{platform}'. Valid: {PLATFORM_KEYS}")
    data = _load(campaign_dir)
    if not data:
        _die("campaign.json not found. Run 'init' first.")

    platforms = data.setdefault("platforms", {})
    entry = platforms.setdefault(platform, {})
    entry["status"] = "live"
    entry["url"] = url
    entry["posted_at"] = _now()
    if post_id:
        entry["post_id"] = post_id
    entry.setdefault("analytics_snapshots", [])

    _save(campaign_dir, data)
    print(json.dumps({"verdict": "pass", "platform": platform, "url": url, "status": "live"}, indent=2))


def cmd_record_analytics(
    campaign_dir: pathlib.Path, platform: str,
    views: int, likes: int, comments: int, shares: int, reach: int,
) -> None:
    if platform not in PLATFORM_KEYS:
        _die(f"Unknown platform '{platform}'.")
    data = _load(campaign_dir)
    if not data:
        _die("campaign.json not found. Run 'init' first.")

    entry = data.setdefault("platforms", {}).setdefault(platform, {})
    snapshot = {
        "captured_at": _now(),
        "views": views,
        "likes": likes,
        "comments": comments,
        "shares": shares,
        "reach": reach,
    }
    entry.setdefault("analytics_snapshots", []).append(snapshot)

    _save(campaign_dir, data)
    print(json.dumps({"verdict": "pass", "platform": platform, "snapshot": snapshot}, indent=2))


def cmd_set_status(campaign_dir: pathlib.Path, platform: str, status: str, reason: str) -> None:
    if platform not in PLATFORM_KEYS:
        _die(f"Unknown platform '{platform}'.")
    if status not in STATUS_VALUES:
        _die(f"Invalid status '{status}'. Valid: {STATUS_VALUES}")
    data = _load(campaign_dir)
    if not data:
        _die("campaign.json not found. Run 'init' first.")

    entry = data.setdefault("platforms", {}).setdefault(platform, {})
    entry["status"] = status
    if reason:
        entry["status_reason"] = reason

    _save(campaign_dir, data)
    print(json.dumps({"verdict": "pass", "platform": platform, "status": status}, indent=2))


def cmd_validate(campaign_dir: pathlib.Path) -> None:
    violations: list[str] = []
    warnings: list[str] = []

    # File structure checks
    for subdir in CANONICAL_SUBDIRS:
        if not (campaign_dir / subdir).is_dir():
            warnings.append(f"Missing subfolder: {subdir}/")

    for fname in CANONICAL_FILES:
        matches = list(campaign_dir.glob(f"*{fname}*"))
        if not matches:
            violations.append(f"Missing file matching: {fname}")

    if not (campaign_dir / CAMPAIGN_JSON).exists():
        violations.append("campaign.json missing — run 'init' to create it")
        verdict = "fail"
        print(json.dumps({"verdict": verdict, "violations": violations, "warnings": warnings}, indent=2))
        sys.exit(1)

    # campaign.json consistency checks
    data = _load(campaign_dir)
    platforms = data.get("platforms", {})

    for platform, entry in platforms.items():
        status = entry.get("status", "draft")
        if status == "live" and not entry.get("url"):
            violations.append(f"{platform}: status=live but no URL recorded")
        if status == "live" and not entry.get("analytics_snapshots"):
            warnings.append(f"{platform}: live but no analytics snapshot captured yet")

    verdict = "fail" if violations else ("warn" if warnings else "pass")
    print(json.dumps({
        "verdict": verdict,
        "campaign_dir": str(campaign_dir),
        "violations": violations,
        "warnings": warnings,
        "platforms_tracked": list(platforms.keys()),
    }, indent=2))
    if violations:
        sys.exit(1)


def cmd_needs_sync(campaign_dir: pathlib.Path, analytics_stale_days: int) -> None:
    data = _load(campaign_dir)
    if not data:
        print(json.dumps({"verdict": "error", "error": "campaign.json not found. Run 'init' first."}))
        return

    platforms = data.get("platforms", {})
    live = {k: v for k, v in platforms.items() if v.get("status") == "live"}

    if not live:
        print(json.dumps({"verdict": "no-live-platforms", "needs_url": [], "needs_analytics": [], "in_sync": []}))
        return

    needs_url: list[str] = []
    needs_analytics: list[dict] = []
    in_sync: list[str] = []

    now = datetime.now(timezone.utc)
    stale_threshold_seconds = analytics_stale_days * 86400

    for platform, entry in live.items():
        url = entry.get("url", "")
        if not url:
            needs_url.append(platform)
            continue

        snaps = entry.get("analytics_snapshots", [])
        if not snaps:
            needs_analytics.append({"platform": platform, "url": url, "last_captured": None, "days_stale": None})
            continue

        last_ts = snaps[-1].get("captured_at", "")
        try:
            last_dt = datetime.strptime(last_ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            age_seconds = (now - last_dt).total_seconds()
            days_stale = round(age_seconds / 86400, 1)
            if age_seconds > stale_threshold_seconds:
                needs_analytics.append({"platform": platform, "url": url, "last_captured": last_ts, "days_stale": days_stale})
            else:
                in_sync.append(platform)
        except ValueError:
            needs_analytics.append({"platform": platform, "url": url, "last_captured": last_ts, "days_stale": None})

    verdict = "in-sync" if not needs_url and not needs_analytics else "needs-sync"
    print(json.dumps({
        "verdict": verdict,
        "needs_url": needs_url,
        "needs_analytics": needs_analytics,
        "in_sync": in_sync,
        "instructions": (
            "Use MCP tools to fetch live data for platforms in needs_url and needs_analytics, "
            "then call record-url / record-analytics to update campaign.json."
        ) if verdict == "needs-sync" else "All live platforms have fresh analytics.",
    }, indent=2))


def cmd_status(campaign_dir: pathlib.Path) -> None:
    data = _load(campaign_dir)
    if not data:
        _die("campaign.json not found. Run 'init' first.")

    platforms = data.get("platforms", {})
    rows = []
    for p in PLATFORM_KEYS:
        entry = platforms.get(p, {})
        if not entry:
            continue
        latest = entry.get("analytics_snapshots", [{}])[-1]
        rows.append({
            "platform": p,
            "status": entry.get("status", "draft"),
            "url": entry.get("url", ""),
            "posted_at": entry.get("posted_at", ""),
            "latest_views": latest.get("views", "—"),
            "latest_likes": latest.get("likes", "—"),
        })

    print(json.dumps({
        "slug": data.get("slug"),
        "title": data.get("title"),
        "updated": data.get("_updated"),
        "platforms": rows,
    }, indent=2))


# ── CLI ────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Campaign URL + analytics tracker.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init")
    p_init.add_argument("--campaign-dir", required=True)
    p_init.add_argument("--slug", default="")
    p_init.add_argument("--title", default="")

    p_url = sub.add_parser("record-url")
    p_url.add_argument("--campaign-dir", required=True)
    p_url.add_argument("--platform", required=True)
    p_url.add_argument("--url", required=True)
    p_url.add_argument("--post-id", default="")

    p_ana = sub.add_parser("record-analytics")
    p_ana.add_argument("--campaign-dir", required=True)
    p_ana.add_argument("--platform", required=True)
    p_ana.add_argument("--views", type=int, default=0)
    p_ana.add_argument("--likes", type=int, default=0)
    p_ana.add_argument("--comments", type=int, default=0)
    p_ana.add_argument("--shares", type=int, default=0)
    p_ana.add_argument("--reach", type=int, default=0)

    p_status = sub.add_parser("set-status")
    p_status.add_argument("--campaign-dir", required=True)
    p_status.add_argument("--platform", required=True)
    p_status.add_argument("--status", required=True, choices=STATUS_VALUES)
    p_status.add_argument("--reason", default="")

    p_val = sub.add_parser("validate")
    p_val.add_argument("--campaign-dir", required=True)

    p_st = sub.add_parser("status")
    p_st.add_argument("--campaign-dir", required=True)

    p_ns = sub.add_parser("needs-sync")
    p_ns.add_argument("--campaign-dir", required=True)
    p_ns.add_argument("--analytics-stale-days", type=int, default=7)

    args = parser.parse_args()

    if args.cmd == "init":
        cmd_init(_resolve(args.campaign_dir), args.slug, args.title)
    elif args.cmd == "record-url":
        cmd_record_url(_resolve(args.campaign_dir), args.platform, args.url, args.post_id)
    elif args.cmd == "record-analytics":
        cmd_record_analytics(
            _resolve(args.campaign_dir), args.platform,
            args.views, args.likes, args.comments, args.shares, args.reach,
        )
    elif args.cmd == "set-status":
        cmd_set_status(_resolve(args.campaign_dir), args.platform, args.status, args.reason)
    elif args.cmd == "validate":
        cmd_validate(_resolve(args.campaign_dir))
    elif args.cmd == "status":
        cmd_status(_resolve(args.campaign_dir))
    elif args.cmd == "needs-sync":
        cmd_needs_sync(_resolve(args.campaign_dir), args.analytics_stale_days)

    return 0


if __name__ == "__main__":
    sys.exit(main())
