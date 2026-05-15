#!/usr/bin/env python3
"""
check.py — image-brand-completeness-gate logic.

Two checks:
  1. BRAND SIGNATURE — required handles must appear in HTML source.
     BLOCK if any required_in_all handle is missing.
     WARN if any required_in_cta or required_in_company_context handle is missing.

  2. VISUAL CONTENT — image must contain substantive SVG (not just text on dark bg).
     BLOCK if no <svg> element OR svg has fewer than MIN_SVG_CHILDREN child elements.

Reads brand tokens from brand-spec.json (co-located in the skills directory, or
passed via brand_spec field in context JSON).

Exit codes: 0=PASS, 1=BLOCK, 2=WARN
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Optional

# Minimum number of child elements inside <svg> to count as "substantive visual"
MIN_SVG_CHILDREN = 5

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent

# Default brand-spec search path (relative to this gate, then SDE skills directory)
DEFAULT_BRAND_SPEC_PATHS = [
    SCRIPT_DIR.parent.parent / "skills" / "social-distribution-engine" / "brand-spec.json",
    SCRIPT_DIR / "brand-spec.json",
]


def _load_brand_spec(override: Optional[str]) -> dict:
    if override:
        p = pathlib.Path(override)
        if p.exists():
            return json.loads(p.read_text())
        return {}
    for p in DEFAULT_BRAND_SPEC_PATHS:
        if p.exists():
            return json.loads(p.read_text())
    return {}


def _check_brand_handles(html_source: str, brand_spec: dict) -> tuple[list[str], list[str]]:
    """Returns (block_missing, warn_missing) handle lists."""
    handles = brand_spec.get("handles", {})
    image_req = brand_spec.get("image_requirements", {})

    required_block = image_req.get("required_in_all", [])
    required_warn_cta = image_req.get("required_in_cta", [])
    required_warn_company = image_req.get("required_in_company_context", [])
    required_warn = required_warn_cta + required_warn_company

    block_missing = [tok for tok in required_block if tok not in html_source]
    warn_missing = [tok for tok in required_warn if tok not in html_source]

    return block_missing, warn_missing


def _count_svg_children(html_source: str) -> int:
    """Count direct child elements inside first <svg>...</svg> block."""
    svg_match = re.search(r'<svg\b[^>]*>(.*?)</svg>', html_source, re.DOTALL | re.IGNORECASE)
    if not svg_match:
        return 0
    svg_inner = svg_match.group(1)
    # Count opening tags (circle, line, rect, path, text, ellipse, polygon, polyline, g, etc.)
    children = re.findall(r'<(circle|line|rect|path|text|ellipse|polygon|polyline|g|use)\b', svg_inner, re.IGNORECASE)
    return len(children)


def _collect_html_paths_from_campaign(campaign_file: str) -> list[pathlib.Path]:
    """Read campaign.json, find all asset.file PNG references, derive .html counterparts."""
    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        return []
    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    seen: set[str] = set()
    html_paths: list[pathlib.Path] = []

    def _collect(node: object) -> None:
        if isinstance(node, dict):
            asset = node.get("asset") or {}
            if isinstance(asset, dict):
                file_val = asset.get("file", "")
            else:
                file_val = str(asset) if asset else ""
            if file_val and file_val not in seen:
                seen.add(file_val)
                # Resolve relative to campaign directory
                abs_png = campaign_path.parent / file_val
                abs_html = abs_png.with_suffix(".html")
                if abs_html.exists():
                    html_paths.append(abs_html)
            for v in node.values():
                _collect(v)
        elif isinstance(node, list):
            for item in node:
                _collect(item)

    _collect(campaign)
    return html_paths


def _check_single_file(
    html_path: pathlib.Path,
    brand_spec: dict,
) -> tuple[str, list[str], list[str], int]:
    """Returns (file_name, block_issues, warn_issues, svg_child_count)."""
    html_source = html_path.read_text(encoding="utf-8")
    issues_block: list[str] = []
    issues_warn: list[str] = []

    if brand_spec:
        block_missing, warn_missing = _check_brand_handles(html_source, brand_spec)
        for tok in block_missing:
            issues_block.append(
                f"Missing required brand token '{tok}'. "
                f"Add it to the image's signature/bottom bar."
            )
        for tok in warn_missing:
            issues_warn.append(
                f"Missing recommended brand token '{tok}'. "
                f"Consider adding to signature for full contact card."
            )
    else:
        issues_warn.append(
            "brand-spec.json not found — brand handle check skipped."
        )

    svg_child_count = _count_svg_children(html_source)
    if svg_child_count == 0:
        issues_block.append(
            "No <svg> element found. Images must contain a substantive visual. "
            "Add an SVG graphic — network diagram, chart, icon composition, or illustration."
        )
    elif svg_child_count < MIN_SVG_CHILDREN:
        issues_block.append(
            f"SVG has only {svg_child_count} child element(s) — minimum {MIN_SVG_CHILDREN} required. "
            f"A decorative glow or single circle does not count as a visual."
        )

    return html_path.name, issues_block, issues_warn, svg_child_count


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"verdict": "BLOCK", "reason": "No context JSON passed."}))
        return 1

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON: {e}"}))
        return 1

    brand_spec = _load_brand_spec(ctx.get("brand_spec"))

    # --- Mode 1: campaign_file → find all HTML assets automatically ---
    campaign_file = ctx.get("campaign_file")
    if campaign_file:
        html_paths = _collect_html_paths_from_campaign(campaign_file)
        if not html_paths:
            print(json.dumps({
                "verdict": "WARN",
                "reason": "No HTML image templates found for this campaign (no .html counterpart for any asset.file PNG). "
                          "If the campaign has image assets, ensure .html source files exist alongside the PNGs.",
                "campaign_file": campaign_file,
            }))
            return 2

        all_blocks: list[dict] = []
        all_warns: list[dict] = []
        passed: list[str] = []

        for hp in html_paths:
            fname, blk, wrn, svg_n = _check_single_file(hp, brand_spec)
            if blk:
                all_blocks.append({"file": fname, "svg_child_count": svg_n, "issues": blk})
            elif wrn:
                all_warns.append({"file": fname, "issues": wrn})
            else:
                passed.append(fname)

        if all_blocks:
            print(json.dumps({
                "verdict": "BLOCK",
                "files_checked": len(html_paths),
                "blocked": all_blocks,
                "warned": all_warns,
                "passed": passed,
                "remediation": (
                    "Fix all BLOCK issues before this campaign ships. "
                    "Every image needs: (1) full brand signature (@thewhyman + thewhyman.com), "
                    "(2) substantive SVG visual (≥5 elements)."
                ),
            }, indent=2))
            return 1

        if all_warns:
            print(json.dumps({
                "verdict": "WARN",
                "files_checked": len(html_paths),
                "warned": all_warns,
                "passed": passed,
            }, indent=2))
            return 2

        print(json.dumps({
            "verdict": "PASS",
            "files_checked": len(html_paths),
            "passed": passed,
        }, indent=2))
        return 0

    # --- Mode 2: html_file → check a single file ---
    html_file = ctx.get("html_file")
    if not html_file:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": "Provide either html_file (single template) or campaign_file (all templates).",
        }))
        return 1

    html_path = pathlib.Path(html_file)
    if not html_path.exists():
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": f"File not found: {html_file}",
            "remediation": "Verify the path exists before running the gate.",
        }))
        return 1

    fname, issues_block, issues_warn, svg_child_count = _check_single_file(html_path, brand_spec)

    if issues_block:
        print(json.dumps({
            "verdict": "BLOCK",
            "file": fname,
            "svg_child_count": svg_child_count,
            "block_issues": issues_block,
            "warn_issues": issues_warn,
            "remediation": (
                "Fix all BLOCK issues before this template can be used in a campaign. "
                "Every image needs: (1) full brand signature, (2) substantive SVG visual."
            ),
        }, indent=2))
        return 1

    if issues_warn:
        print(json.dumps({
            "verdict": "WARN",
            "file": fname,
            "svg_child_count": svg_child_count,
            "warn_issues": issues_warn,
        }, indent=2))
        return 2

    print(json.dumps({
        "verdict": "PASS",
        "file": fname,
        "svg_child_count": svg_child_count,
        "brand_tokens_verified": True,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
