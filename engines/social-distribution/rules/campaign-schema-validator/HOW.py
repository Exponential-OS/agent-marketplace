#!/usr/bin/env python3
"""
campaign-schema-validator/HOW.py — Validates campaign.json required fields
and verifies all referenced files exist on disk.

This is a machine-actionable structural gate (exit codes + JSON output)
for use by the meta-harness validate-campaign.py. Complements the human-readable
comprehensive validate-campaign.py in campaign-schema/.

Checks:
  - Required top-level fields: meta, source, hub, spokes, assets, review
  - Required meta fields: id, title, ship_date, folder, status
  - Required review fields: content_reviewed, assets_reviewed, etc.
  - All content_file paths referenced in campaign exist on disk
  - All asset file paths referenced in campaign exist on disk (if status != "pending")

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json"
    }

Exit:
    0 = PASS  (all required fields present; all referenced files exist)
    1 = BLOCK (required fields missing OR referenced files not found)
    2 = WARN  (campaign file unreadable or malformed JSON)

Stdout: JSON {"status": "pass|block|warn", "errors": [...], "warnings": [...], "message": str}
"""

import json
import pathlib
import sys

REQUIRED_TOP = ["meta", "source", "hub", "spokes", "assets", "comment_cascade", "review"]
REQUIRED_META = ["id", "title", "ship_date", "folder", "status"]
REQUIRED_REVIEW = [
    "content_reviewed", "assets_reviewed", "hashtags_reviewed",
    "formatting_reviewed", "name_tags_verified", "ready_to_publish"
]


def out(code, status, errors, warnings, message):
    print(json.dumps({
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "message": message
    }))
    sys.exit(code)


def collect_file_refs(campaign):
    """Return list of (label, path) for all file references in campaign."""
    refs = []
    campaign_dir_str = campaign.get("_campaign_dir", "")
    campaign_dir = pathlib.Path(campaign_dir_str) if campaign_dir_str else None

    def resolve(rel_path):
        if campaign_dir:
            return campaign_dir / rel_path
        return pathlib.Path(rel_path)

    source = campaign.get("source", {})
    if source.get("content_file"):
        refs.append(("source.content_file", resolve(source["content_file"])))

    hub = campaign.get("hub", {})
    if hub.get("content_file"):
        refs.append(("hub.content_file", resolve(hub["content_file"])))
    if hub.get("asset", {}).get("file"):
        refs.append(("hub.asset.file", resolve(hub["asset"]["file"])))

    for i, spoke in enumerate(campaign.get("spokes", [])):
        sid = spoke.get("id", f"spoke[{i}]")
        if spoke.get("content_file"):
            refs.append((f"{sid}.content_file", resolve(spoke["content_file"])))
        if spoke.get("asset") and spoke["asset"].get("file"):
            refs.append((f"{sid}.asset.file", resolve(spoke["asset"]["file"])))

    cc = campaign.get("comment_cascade", {})
    if cc.get("content_file"):
        refs.append(("comment_cascade.content_file", resolve(cc["content_file"])))

    for key, asset_obj in campaign.get("assets", {}).items():
        if isinstance(asset_obj, dict) and asset_obj.get("file"):
            # Only check existence if status is not "pending"
            if asset_obj.get("status", "pending") != "pending":
                refs.append((f"assets.{key}.file", resolve(asset_obj["file"])))

    return refs


def main():
    if len(sys.argv) < 2:
        out(2, "warn", [], [], "No input provided.")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(2, "warn", [], [], f"Invalid JSON input: {e}")

    campaign_file = ctx.get("campaign_file", "")
    if not campaign_file:
        out(2, "warn", [], [], "campaign_file is required.")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", [], [], f"campaign.json not found: {campaign_file}")

    try:
        text = campaign_path.read_text(encoding="utf-8")
        campaign = json.loads(text)
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", [], [], f"Cannot parse campaign.json: {e}")

    # Inject campaign dir for path resolution
    campaign["_campaign_dir"] = str(campaign_path.parent)

    errors = []
    warnings = []

    # Check required top-level fields
    for field in REQUIRED_TOP:
        if field not in campaign:
            errors.append(f"Missing required top-level field: '{field}'")

    # Check required meta fields
    meta = campaign.get("meta", {})
    for field in REQUIRED_META:
        if field not in meta:
            errors.append(f"Missing required meta.{field}")

    # Check required review fields
    review = campaign.get("review", {})
    for field in REQUIRED_REVIEW:
        if field not in review:
            errors.append(f"Missing required review.{field}")

    # Check all file references exist
    file_refs = collect_file_refs(campaign)
    missing_files = []
    for label, path in file_refs:
        if not path.exists():
            missing_files.append(f"{label}: {path}")

    if missing_files:
        for f in missing_files:
            errors.append(f"Referenced file not found: {f}")

    # Warn if ship_date is in meta.status = ready_to_publish but review fields are false
    if review.get("ready_to_publish") is True:
        unreviewed = [f for f in ["content_reviewed", "assets_reviewed", "hashtags_reviewed",
                                   "formatting_reviewed", "name_tags_verified"]
                      if review.get(f) is False]
        if unreviewed:
            warnings.append(
                f"ready_to_publish=true but review fields are false: {unreviewed}. "
                f"Possible data inconsistency."
            )

    if errors:
        out(1, "block", errors, warnings,
            f"BLOCK — {len(errors)} schema/file error(s). Fix before distributing.")

    if warnings:
        out(2, "warn", errors, warnings,
            f"WARN — {len(warnings)} warning(s). Review before distributing.")

    out(0, "pass", [], [],
        f"PASS — campaign.json valid. {len(file_refs)} file reference(s) verified.")


if __name__ == "__main__":
    main()
