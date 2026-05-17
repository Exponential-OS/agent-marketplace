#!/usr/bin/env python3
"""
visual-asset-review-check/HOW.py — Gate that blocks distribution if any
image-bearing spoke lacks a completed visual review.

Ground Zero VISUAL-ASSET REVIEW INVARIANT: no image ships unreviewed. Every spoke
with an `asset` (non-null) must have campaign.review.assets_reviewed=true before
ready_to_publish is set. This gate is the machine enforcement of that invariant.

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json"
    }

Exit:
    0 = PASS  (no image-bearing spokes, OR assets_reviewed=true)
    1 = BLOCK (image-bearing spokes present AND assets_reviewed=false/missing)
    2 = WARN  (campaign.json missing or malformed)

Stdout: JSON {"status": "pass|block|warn", "image_bearing_spokes": [...], "assets_reviewed": bool, "message": str}
"""

import json
import pathlib
import sys


def out(code, status, image_bearing_spokes, assets_reviewed, message):
    print(json.dumps({
        "status": status,
        "image_bearing_spokes": image_bearing_spokes,
        "assets_reviewed": assets_reviewed,
        "message": message
    }))
    sys.exit(code)


def main():
    if len(sys.argv) < 2:
        out(2, "warn", [], None, "No input provided.")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(1, "block", [], None, f"Invalid JSON: {e}")

    campaign_file = ctx.get("campaign_file", "")
    if not campaign_file:
        out(2, "warn", [], None, "campaign_file is required.")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", [], None, f"campaign.json not found: {campaign_file}")

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", [], None, f"Cannot parse campaign.json: {e}")

    # Find all image-bearing components
    image_bearing = []

    source = campaign.get("source", {})
    if source.get("asset") and source["asset"].get("file"):
        image_bearing.append({"id": "source", "platform": source.get("platform", "substack"),
                               "asset": source["asset"]["file"]})

    hub = campaign.get("hub", {})
    if hub.get("asset") and hub["asset"].get("file"):
        image_bearing.append({"id": "hub", "platform": hub.get("platform", "linkedin"),
                               "type": hub.get("type", "article"),
                               "asset": hub["asset"]["file"]})

    for spoke in campaign.get("spokes", []):
        if spoke.get("asset") and spoke["asset"].get("file"):
            image_bearing.append({
                "id": spoke.get("id", "unknown"),
                "platform": spoke.get("platform", "unknown"),
                "asset": spoke["asset"]["file"]
            })

    if not image_bearing:
        out(0, "pass", [], None,
            "PASS — No image-bearing components in campaign. Visual review not required.")

    # Check review status
    review = campaign.get("review", {})
    assets_reviewed = review.get("assets_reviewed", False)

    if not assets_reviewed:
        spoke_ids = [c["id"] for c in image_bearing]
        out(1, "block", image_bearing, False,
            f"BLOCK — {len(image_bearing)} image-bearing component(s) found but assets_reviewed=false. "
            f"A vision-capable reviewer must inspect each asset at full resolution before ship. "
            f"Components: {spoke_ids}. "
            f"After review: set campaign.review.assets_reviewed=true.")

    out(0, "pass", image_bearing, True,
        f"PASS — {len(image_bearing)} image-bearing component(s) verified (assets_reviewed=true).")


if __name__ == "__main__":
    main()
