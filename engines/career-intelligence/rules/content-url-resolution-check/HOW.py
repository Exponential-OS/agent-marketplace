#!/usr/bin/env python3
"""
content-url-resolution-check/HOW.py — Gate that blocks distribution if any
content file in a campaign contains unresolved URL placeholder tokens.

Tokens are patterns like [PART-3-URL], [ARTICLE-URL], [HUB-URL], [PASTE-URL-HERE],
[INSERT-LINK], or any bracketed ALL-CAPS phrase containing "URL", "LINK", or "HREF".

Called by validate-campaign.py and the SDE distribute-campaign flow before any
distribution action is taken. A campaign with unresolved tokens will publish broken
content — the gate must BLOCK, not warn.

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json",
      "career_os_home": "/abs/path/to/anand-career-os"
    }

Exit:
    0 = PASS  (no unresolved tokens in any content file)
    1 = BLOCK (one or more content files contain unresolved tokens)
    2 = WARN  (campaign file or content files missing — cannot verify)

Stdout: JSON {"status": "pass|block|warn", "unresolved": [...], "message": str}
"""

import json
import pathlib
import re
import sys

# Patterns that indicate an unresolved URL/link placeholder
TOKEN_PATTERNS = [
    re.compile(r'\[([A-Z0-9][A-Z0-9_-]*(?:URL|LINK|HREF|PART|ARTICLE|HUB|PASTE)[A-Z0-9_-]*)\]'),
    re.compile(r'\[PASTE [A-Z].*?\]'),
    re.compile(r'\[INSERT [A-Z].*?\]'),
    re.compile(r'\[ADD [A-Z].*? HERE\]'),
]


def find_tokens(text):
    found = []
    for pat in TOKEN_PATTERNS:
        found.extend(pat.findall(text))
    return list(dict.fromkeys(found))  # deduplicate, preserve order


def out(code, status, unresolved, message):
    print(json.dumps({"status": status, "unresolved": unresolved, "message": message}))
    sys.exit(code)


def main():
    if len(sys.argv) < 2:
        out(2, "warn", [], "No input provided.")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(1, "block", [], f"Invalid JSON: {e}")

    campaign_file = ctx.get("campaign_file", "")
    career_os_home = ctx.get("career_os_home", "")

    if not campaign_file:
        out(2, "warn", [], "campaign_file is required.")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", [], f"campaign.json not found: {campaign_file}")

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", [], f"Cannot parse campaign.json: {e}")

    campaign_dir = campaign_path.parent
    if career_os_home:
        base = pathlib.Path(career_os_home)
    else:
        base = campaign_dir

    # Collect all content_file references from the campaign
    content_files = []
    source = campaign.get("source", {})
    if source.get("content_file"):
        content_files.append(source["content_file"])

    hub = campaign.get("hub", {})
    if hub.get("content_file"):
        content_files.append(hub["content_file"])

    for spoke in campaign.get("spokes", []):
        if spoke.get("content_file"):
            content_files.append(spoke["content_file"])

    comment_cascade = campaign.get("comment_cascade", {})
    if comment_cascade.get("content_file"):
        content_files.append(comment_cascade["content_file"])

    if not content_files:
        out(2, "warn", [], "No content_file references found in campaign.json.")

    # Check each content file for unresolved tokens
    violations = []
    missing_files = []

    for rel_path in content_files:
        # Content files are relative to campaign directory
        abs_path = campaign_dir / rel_path
        if not abs_path.exists():
            missing_files.append(rel_path)
            continue

        try:
            text = abs_path.read_text(encoding="utf-8")
        except OSError:
            missing_files.append(rel_path)
            continue

        tokens = find_tokens(text)
        if tokens:
            violations.append({
                "file": rel_path,
                "tokens": tokens
            })

    if violations:
        token_summary = "; ".join(
            f"{v['file']}: {', '.join(v['tokens'])}" for v in violations
        )
        out(1, "block", violations,
            f"BLOCK — {len(violations)} content file(s) contain unresolved URL tokens. "
            f"Resolve before distributing. {token_summary}")

    if missing_files:
        out(2, "warn", [], f"WARN — {len(missing_files)} content file(s) referenced in campaign.json not found on disk: {', '.join(missing_files)}")

    out(0, "pass", [],
        f"PASS — All {len(content_files)} content files scanned. No unresolved tokens found.")


if __name__ == "__main__":
    main()
