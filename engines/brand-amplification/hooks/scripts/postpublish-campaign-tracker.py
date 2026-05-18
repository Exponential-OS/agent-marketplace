#!/usr/bin/env python3
"""
PostToolUse hook: auto-records URL + post_id into campaign.json after MCP publish.

Fires after LinkedIn, Reddit, Substack MCP publish tools succeed.
Reads CURRENT_CAMPAIGN_DIR env var to know which campaign to update.

Fail-open: any exception → exit 0, warning via systemMessage. Never blocks work.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

# Maps MCP tool name → campaign platform key
_TOOL_PLATFORM: dict[str, str] = {
    "mcp__composio__LINKEDIN_CREATE_LINKED_IN_POST": "linkedin_post",
    "mcp__composio__LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE": "linkedin_article",
    "mcp__composio__REDDIT_CREATE_REDDIT_POST": "reddit_post",
}

# LinkedIn activity URN → URL template
_LI_ACTIVITY_URL = "https://www.linkedin.com/feed/update/{urn}/"

CAMPAIGN_TRACKER = pathlib.Path(__file__).parent.parent.parent / \
    "aiprojects/career-os-plugin/skills/social-distribution-engine/campaign_tracker.py"


def _warn(msg: str) -> None:
    print(json.dumps({"systemMessage": f"[campaign-tracker] ⚠ {msg}"}))


def _ok(msg: str) -> None:
    print(json.dumps({"systemMessage": f"[campaign-tracker] {msg}"}))


def _extract_url(resp: dict) -> str:
    """Try common response fields for a URL, in order of reliability."""
    for key in ("url", "shareUrl", "postUrl", "permalink"):
        val = resp.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val

    # LinkedIn URN → construct URL
    for key in ("id", "activity", "activityId"):
        val = resp.get(key, "")
        if isinstance(val, str) and "urn:li:" in val:
            return _LI_ACTIVITY_URL.format(urn=val)

    # Nested .data.url
    data = resp.get("data", {})
    if isinstance(data, dict):
        val = data.get("url", "")
        if isinstance(val, str) and val.startswith("http"):
            return val

    return ""


def _extract_post_id(resp: dict) -> str:
    for key in ("id", "postId", "activityId", "shareId"):
        val = resp.get(key)
        if isinstance(val, str) and val:
            return val
    return ""


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            return 0

        hook_ctx = json.loads(raw)
        tool_name = hook_ctx.get("tool_name", "")

        platform = _TOOL_PLATFORM.get(tool_name)
        if platform is None:
            return 0  # Not a publish tool — exit silently

        campaign_dir = os.environ.get("CURRENT_CAMPAIGN_DIR", "").strip()
        if not campaign_dir:
            _warn(
                "CURRENT_CAMPAIGN_DIR not set — post URL not recorded. "
                f"Set the env var before publishing to auto-track {tool_name}."
            )
            return 0

        resp = hook_ctx.get("tool_response", {})
        if not isinstance(resp, dict):
            try:
                resp = json.loads(resp) if isinstance(resp, str) else {}
            except Exception:
                resp = {}

        url = _extract_url(resp)
        post_id = _extract_post_id(resp)

        tracker = str(CAMPAIGN_TRACKER)
        cmd = [
            sys.executable, tracker,
            "record-url",
            "--campaign-dir", campaign_dir,
            "--platform", platform,
            "--url", url or "",
        ]
        if post_id:
            cmd += ["--post-id", post_id]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0:
            url_display = url or "(URL not found in response — update manually)"
            _ok(f"{platform} recorded → {url_display} (campaign: {campaign_dir})")
        else:
            err = result.stdout.strip() or result.stderr.strip()
            _warn(f"record-url failed: {err}")

        return 0

    except Exception as e:
        # Fail-open: never block real work
        _warn(f"hook error (non-blocking): {e}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
