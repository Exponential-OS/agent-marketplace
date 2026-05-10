#!/usr/bin/env python3
"""
channel-status-check/HOW.py — Blocks distribution to BANNED or Low ROI channels.

Reads brain/social-distribution-engine/social-channel-directory.md (the Global
Channel Value Directory) and checks every spoke in campaign.json against it.

A spoke targeting a BANNED subreddit, community, or group → BLOCK.
A spoke targeting a Low ROI channel → WARN.
All channels not in the directory → PASS (unknown = allowed).

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json",
      "channel_dir_file": "/abs/path/to/brain/social-distribution-engine/social-channel-directory.md"
    }

    channel_dir_file defaults to $CAREER_HOME/brain/social-distribution-engine/social-channel-directory.md
    CAREER_HOME defaults to ~/anand-career-os

Exit:
    0 = PASS  (no banned or low ROI channels targeted)
    1 = BLOCK (one or more spokes target BANNED channels)
    2 = WARN  (one or more spokes target Low ROI channels; none banned)

Stdout: JSON {"status": "pass|block|warn", "banned": [...], "low_roi": [...], "message": str}
"""

import json
import os
import pathlib
import re
import sys


def parse_channel_directory(md_text):
    """
    Parse the Global Channel Value Directory markdown table.
    Returns two sets: banned_channels (lowercase), low_roi_channels (lowercase).
    Handles subreddits as 'r/name' and raw names.
    """
    banned = set()
    low_roi = set()

    for line in md_text.splitlines():
        # Match table rows: | channel_name | ... | Trust Status | ...
        # Trust Status column contains "⚠️ BANNED" or "Low ROI"
        if "|" not in line:
            continue
        cols = [c.strip() for c in line.split("|") if c.strip()]
        if len(cols) < 4:
            continue

        channel_col = cols[0].lower()
        # Find the trust status column — look for "BANNED" or "Low ROI" in any column
        row_text = line.lower()
        is_banned = "banned" in row_text
        is_low_roi = "low roi" in row_text or "low-roi" in row_text

        if not (is_banned or is_low_roi):
            continue

        # Normalize channel name: strip r/ prefix for subreddits
        # Use removeprefix (not lstrip) — lstrip strips individual chars, not the substring
        name = channel_col.removeprefix("r/").strip()

        if is_banned:
            banned.add(name)
            banned.add(f"r/{name}")
        if is_low_roi:
            low_roi.add(name)
            low_roi.add(f"r/{name}")

    return banned, low_roi


def out(code, status, banned, low_roi, message):
    print(json.dumps({
        "status": status,
        "banned": banned,
        "low_roi": low_roi,
        "message": message
    }))
    sys.exit(code)


def main():
    if len(sys.argv) < 2:
        out(2, "warn", [], [], "No input provided.")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(1, "block", [], [], f"Invalid JSON: {e}")

    campaign_file = ctx.get("campaign_file", "")
    if not campaign_file:
        out(2, "warn", [], [], "campaign_file is required.")

    # Resolve channel directory path
    channel_dir_file = ctx.get("channel_dir_file", "")
    if not channel_dir_file:
        career_home = os.environ.get("CAREER_HOME", os.environ.get("CAREER_OS_HOME",
                                         str(pathlib.Path.home() / "anand-career-os")))
        channel_dir_file = str(pathlib.Path(career_home) /
                                "brain/social-distribution-engine/social-channel-directory.md")

    channel_dir_path = pathlib.Path(channel_dir_file)
    if not channel_dir_path.exists():
        out(2, "warn", [], [], f"Channel directory not found: {channel_dir_file}")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", [], [], f"campaign.json not found: {campaign_file}")

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", [], [], f"Cannot parse campaign.json: {e}")

    try:
        channel_md = channel_dir_path.read_text(encoding="utf-8")
    except OSError as e:
        out(2, "warn", [], [], f"Cannot read channel directory: {e}")

    banned_channels, low_roi_channels = parse_channel_directory(channel_md)

    # Check all spokes for channel violations
    banned_hits = []
    low_roi_hits = []

    for spoke in campaign.get("spokes", []):
        spoke_id = spoke.get("id", "unknown")
        platform = spoke.get("platform", "").lower()

        # Check subreddits list
        for subreddit in spoke.get("subreddits", []):
            name = subreddit.lower().removeprefix("r/")
            if name in banned_channels or f"r/{name}" in banned_channels:
                banned_hits.append({
                    "spoke_id": spoke_id,
                    "channel": subreddit,
                    "type": "subreddit",
                    "reason": f"r/{subreddit} is BANNED in channel directory"
                })
            elif name in low_roi_channels or f"r/{name}" in low_roi_channels:
                low_roi_hits.append({
                    "spoke_id": spoke_id,
                    "channel": subreddit,
                    "type": "subreddit",
                    "reason": f"r/{subreddit} is marked Low ROI in channel directory"
                })

    if banned_hits:
        out(1, "block", banned_hits, low_roi_hits,
            f"BLOCK — {len(banned_hits)} spoke(s) target BANNED channel(s). "
            f"Remove or replace before distributing.")

    if low_roi_hits:
        channels = [h["channel"] for h in low_roi_hits]
        out(2, "warn", [], low_roi_hits,
            f"WARN — {len(low_roi_hits)} spoke(s) target Low ROI channel(s): {channels}. "
            f"Review before distributing.")

    out(0, "pass", [], [],
        f"PASS — No banned or low ROI channels targeted in {len(campaign.get('spokes', []))} spokes.")


if __name__ == "__main__":
    main()
