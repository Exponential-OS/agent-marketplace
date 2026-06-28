#!/usr/bin/env python3
"""
surface-coverage-check/HOW.py — Verifies campaign surface coverage matrix was
built from identity/handles.md (not from memory).

Ground Zero CAMPAIGN-COMPLETENESS INVARIANT: before any multi-surface campaign ships,
enumerate the complete surface set against handles.md. Every omitted surface must
have an explicit documented reason; silent omission is a Ground Zero violation.

This gate:
1. Reads handles.md to derive the canonical distribution surface set.
2. Checks campaign.json: for each handle-derived platform, either a spoke exists
   OR an explicit skip reason is documented in campaign.json meta or the spoke.
3. BLOCKs if handles.md surfaces are not accounted for (neither present nor skipped).
4. WARNs if the skip reason field exists but is empty.

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json",
      "handles_file": "/abs/path/to/identity/handles.md"
    }

    handles_file defaults to $CAREER_HOME/identity/handles.md

Exit:
    0 = PASS  (all surfaces accounted for — either present or skip-reasoned)
    1 = BLOCK (one or more surfaces silently omitted)
    2 = WARN  (handles file missing, or skips with no reason)

Stdout: JSON {"status": "pass|block|warn", "missing_surfaces": [...], "skipped": [...], "message": str}
"""

import json
import os
import pathlib
import re
import sys

# Platforms extractable from handles.md Primary table — maps handles.md platform name → normalized key
HANDLES_PLATFORM_MAP = {
    "linkedin": "linkedin",
    "substack": "substack",
    "x / twitter": "x",
    "x": "x",
    "twitter": "x",
    "instagram": "instagram",
    "facebook": "facebook",
    # GitHub and Website are not distribution surfaces for campaigns
}

# Platforms that are always part of the Estate Model distribution
DISTRIBUTION_SURFACES = {"substack", "linkedin", "x", "instagram", "facebook"}


def parse_handles_platforms(md_text):
    """Parse the Primary table from handles.md, return set of platform slugs."""
    platforms = set()
    in_primary = False
    for line in md_text.splitlines():
        if "## Primary" in line:
            in_primary = True
            continue
        if in_primary and line.startswith("##"):
            break
        if in_primary and "|" in line:
            cols = [c.strip().lower() for c in line.split("|") if c.strip()]
            if cols and cols[0] not in ("platform", "---", ":---:", "---:"):
                raw = cols[0].strip("* `")
                for key, slug in HANDLES_PLATFORM_MAP.items():
                    if key in raw:
                        platforms.add(slug)
                        break
    return platforms & DISTRIBUTION_SURFACES


def out(code, status, missing, skipped, message):
    print(json.dumps({
        "status": status,
        "missing_surfaces": missing,
        "skipped": skipped,
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

    handles_file = ctx.get("handles_file", "")
    if not handles_file:
        career_home_raw = os.environ.get("CAREER_HOME")
        if not career_home_raw:
            out(2, "warn", [], [], "handles_file not provided and CAREER_HOME env var not set.")
        handles_file = str(pathlib.Path(career_home_raw).expanduser() / "identity/handles.md")

    handles_path = pathlib.Path(handles_file)
    if not handles_path.exists():
        out(2, "warn", [], [], f"handles.md not found: {handles_file}")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", [], [], f"campaign.json not found: {campaign_file}")

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", [], [], f"Cannot parse campaign.json: {e}")

    try:
        handles_md = handles_path.read_text(encoding="utf-8")
    except OSError as e:
        out(2, "warn", [], [], f"Cannot read handles.md: {e}")

    canonical_surfaces = parse_handles_platforms(handles_md)

    # Build set of platforms covered by campaign (source + hub + spokes)
    covered_platforms = set()
    source = campaign.get("source", {})
    if source.get("platform"):
        covered_platforms.add(source["platform"].lower())

    hub = campaign.get("hub", {})
    if hub.get("platform"):
        covered_platforms.add(hub["platform"].lower())

    for spoke in campaign.get("spokes", []):
        if spoke.get("platform"):
            covered_platforms.add(spoke["platform"].lower())

    # Check for explicit skip reasons in campaign meta
    # Convention: campaign.meta.skip_surfaces = {"reddit": "no image asset ready", ...}
    meta = campaign.get("meta", {})
    skip_surfaces = {}
    if isinstance(meta.get("skip_surfaces"), dict):
        skip_surfaces = {k.lower(): v for k, v in meta["skip_surfaces"].items()}

    # Check coverage
    missing_surfaces = []
    skipped_with_reason = []
    skipped_no_reason = []

    for surface in sorted(canonical_surfaces):
        if surface in covered_platforms:
            continue
        # Not covered — check for skip reason
        if surface in skip_surfaces:
            reason = skip_surfaces[surface]
            if reason:
                skipped_with_reason.append({"platform": surface, "reason": reason})
            else:
                skipped_no_reason.append(surface)
        else:
            # Neither covered nor documented — silent omission
            missing_surfaces.append(surface)

    if missing_surfaces:
        out(1, "block", missing_surfaces, skipped_with_reason,
            f"BLOCK — {len(missing_surfaces)} surface(s) silently omitted from campaign: {missing_surfaces}. "
            f"Add spokes OR document skip reason in meta.skip_surfaces.")

    if skipped_no_reason:
        out(2, "warn", [], skipped_with_reason,
            f"WARN — {len(skipped_no_reason)} surface(s) in meta.skip_surfaces with no reason: {skipped_no_reason}. "
            f"Add a reason for each skipped surface.")

    all_skipped = skipped_with_reason
    out(0, "pass", [], all_skipped,
        f"PASS — All {len(canonical_surfaces)} handles.md surfaces accounted for. "
        f"{len(covered_platforms)} covered, {len(all_skipped)} explicitly skipped with reasons.")


if __name__ == "__main__":
    main()
