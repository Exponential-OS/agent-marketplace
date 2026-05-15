#!/usr/bin/env python3
"""
check.py — campaign-asset-matrix-gate enforcement logic.

Reads campaign.json. For each spoke/hub/source on an image-bearing platform,
checks that asset.file is specified AND that the file exists on disk.

Input JSON (via sys.argv[1]):
{
  "campaign_file": "/abs/path/to/campaign.json"
}

Exits: 0=PASS, 1=BLOCK, 2=WARN

Gates (in order):
  1. instagram_asset_required  — any instagram spoke without asset.file = BLOCK
  2. substack_asset_required   — source on substack without asset.file = BLOCK
  3. linkedin_hub_asset        — hub on linkedin without asset.file = WARN
  4. asset_file_exists         — any specified asset.file not on disk = BLOCK
"""
import json
import pathlib
import sys

# Platforms where images are required (BLOCK if missing)
REQUIRED_ASSET_PLATFORMS = {"instagram"}
# Platforms where images are recommended (WARN if missing)
WARN_ASSET_PLATFORMS = {"linkedin", "x", "substack"}


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    campaign_file = ctx.get("campaign_file", "")
    if not campaign_file:
        print(json.dumps({"verdict": "BLOCK", "reason": "campaign_file is required."}))
        return 1

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        print(json.dumps({"verdict": "WARN",
                          "reason": f"campaign.json not found: {campaign_file}"}))
        return 2

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(json.dumps({"verdict": "WARN", "reason": f"Cannot parse campaign.json: {e}"}))
        return 2

    campaign_dir = campaign_path.parent
    blocks = []
    warns = []
    passed = []

    def _check_component(comp: dict, label: str) -> None:
        platform = comp.get("platform", "").lower()
        asset = comp.get("asset")
        asset_file = asset.get("file") if asset else None

        if platform in REQUIRED_ASSET_PLATFORMS:
            if not asset_file:
                blocks.append({
                    "component": label,
                    "platform": platform,
                    "issue": "asset.file is missing",
                    "remediation": f"Generate an image for {label} ({platform}) and set asset.file in campaign.json.",
                })
                return
        elif platform in WARN_ASSET_PLATFORMS:
            if not asset_file:
                warns.append({
                    "component": label,
                    "platform": platform,
                    "issue": "asset.file is not set — image recommended for this platform",
                    "remediation": f"Consider generating an image for {label} ({platform}) to improve engagement.",
                })
                return

        if asset_file:
            # Resolve relative to campaign dir
            resolved = campaign_dir / asset_file if not pathlib.Path(asset_file).is_absolute() else pathlib.Path(asset_file)
            if not resolved.exists():
                blocks.append({
                    "component": label,
                    "platform": platform,
                    "issue": f"asset.file '{asset_file}' specified but file not found on disk at {resolved}",
                    "remediation": f"Generate the image and save it to {resolved}, or update asset.file in campaign.json.",
                })
                return
            passed.append({"component": label, "platform": platform, "asset": asset_file})

    # Check source
    source = campaign.get("source")
    if source:
        _check_component(source, "source")

    # Check hub
    hub = campaign.get("hub")
    if hub:
        _check_component(hub, "hub")

    # Check all spokes
    for spoke in campaign.get("spokes", []):
        label = f"spoke:{spoke.get('id', 'unknown')}"
        _check_component(spoke, label)

    if blocks:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "campaign_asset_matrix",
            "reason": f"{len(blocks)} required image slot(s) missing or file not on disk.",
            "blocks": blocks,
            "warns": warns,
            "passed": passed,
            "remediation": "Generate the missing images and update campaign.json asset.file fields before distributing.",
        }))
        return 1

    if warns:
        print(json.dumps({
            "verdict": "WARN",
            "gate": "campaign_asset_matrix",
            "reason": f"{len(warns)} image slot(s) missing on recommended platforms.",
            "warns": warns,
            "passed": passed,
            "remediation": "Consider generating images for the warned platforms — visual content significantly improves reach.",
        }))
        return 2

    print(json.dumps({
        "verdict": "PASS",
        "gate": "campaign_asset_matrix",
        "components_checked": len(passed),
        "all_assets_present": True,
        "assets": [p["asset"] for p in passed],
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
