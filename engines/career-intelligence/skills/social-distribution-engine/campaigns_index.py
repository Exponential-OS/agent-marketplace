#!/usr/bin/env python3
"""
campaigns_index.py — master index of all campaigns under an articles root.

Scans every NN-slug-YYYY-MM-DD/ subfolder, reads its campaign.json (if present),
and emits a unified cross-linked summary. Useful for cross-campaign analysis:
which platforms are covered, which articles are live, total analytics roll-up.

Usage:
  python3 campaigns_index.py --articles-dir /path/to/articles/
  python3 campaigns_index.py --articles-dir /path/to/articles/ --format table

Output: JSON (default) or ASCII table to stdout.

Designed to migrate to xos-core/plugins/social-distribution/ when CareerOS → xOS.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any

CAMPAIGN_JSON = "campaign.json"

# Matches NN-slug-YYYY-MM-DD (optional trailing non-word chars tolerated)
_CAMPAIGN_DIR_RE = re.compile(r"^\d{2}-.*-\d{4}-\d{2}-\d{2}$")


def _is_campaign_dir(p: pathlib.Path) -> bool:
    return p.is_dir() and _CAMPAIGN_DIR_RE.match(p.name) is not None


def _load_campaign(campaign_dir: pathlib.Path) -> dict:
    path = campaign_dir / CAMPAIGN_JSON
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def _platform_summary(data: dict) -> list[dict]:
    rows = []
    for platform, entry in data.get("platforms", {}).items():
        snaps = entry.get("analytics_snapshots", [])
        latest = snaps[-1] if snaps else {}
        rows.append({
            "platform": platform,
            "status": entry.get("status", "draft"),
            "url": entry.get("url", ""),
            "posted_at": entry.get("posted_at", ""),
            "latest_views": latest.get("views"),
            "latest_likes": latest.get("likes"),
            "snapshots": len(snaps),
        })
    return rows


def build_index(articles_dir: pathlib.Path) -> dict[str, Any]:
    campaigns = []
    for entry in sorted(articles_dir.iterdir()):
        if not _is_campaign_dir(entry):
            continue
        data = _load_campaign(entry)
        platforms = _platform_summary(data)
        live_count = sum(1 for p in platforms if p["status"] == "live")
        campaigns.append({
            "dir": entry.name,
            "path": str(entry),
            "slug": data.get("slug") or entry.name,
            "title": data.get("title", ""),
            "updated": data.get("_updated", ""),
            "has_campaign_json": bool(data),
            "platform_count": len(platforms),
            "live_count": live_count,
            "platforms": platforms,
        })

    total_live = sum(c["live_count"] for c in campaigns)
    total_platforms = sum(c["platform_count"] for c in campaigns)

    return {
        "articles_dir": str(articles_dir),
        "campaign_count": len(campaigns),
        "total_live_posts": total_live,
        "total_platform_entries": total_platforms,
        "campaigns": campaigns,
    }


def _render_table(index: dict) -> str:
    lines = [
        f"Articles: {index['articles_dir']}",
        f"Campaigns: {index['campaign_count']}  |  Live posts: {index['total_live_posts']}",
        "",
        f"{'#':<4} {'Slug':<40} {'JSON':<5} {'Platforms':<10} {'Live':<5} {'Updated':<22}",
        "-" * 90,
    ]
    for i, c in enumerate(index["campaigns"], 1):
        lines.append(
            f"{i:<4} {c['slug'][:39]:<40} {'✓' if c['has_campaign_json'] else '✗':<5} "
            f"{c['platform_count']:<10} {c['live_count']:<5} {c['updated'][:22]:<22}"
        )
    lines.append("")

    # Per-campaign platform breakdown
    for c in index["campaigns"]:
        if not c["platforms"]:
            continue
        lines.append(f"  {c['slug']}")
        for p in c["platforms"]:
            url = f"  → {p['url']}" if p["url"] else ""
            views = f"  {p['latest_views']}v" if p["latest_views"] is not None else ""
            lines.append(f"    {p['platform']:<25} {p['status']:<10}{url}{views}")
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Master index of all campaigns.")
    parser.add_argument("--articles-dir", required=True, help="Path to articles root (e.g. WIP/branding-product/articles/)")
    parser.add_argument("--format", choices=["json", "table"], default="json")
    args = parser.parse_args()

    articles_dir = pathlib.Path(args.articles_dir).expanduser().resolve()
    if not articles_dir.is_dir():
        print(json.dumps({"verdict": "error", "error": f"Not a directory: {articles_dir}"}))
        return 1

    index = build_index(articles_dir)

    if args.format == "table":
        print(_render_table(index))
    else:
        print(json.dumps(index, indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
