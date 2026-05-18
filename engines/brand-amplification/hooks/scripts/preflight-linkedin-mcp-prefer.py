#!/usr/bin/env python3
"""
preflight-linkedin-mcp-prefer.py

PreToolUse hook for mcp__chrome-devtools-mcp__navigate_page and new_page.
When the target URL is a LinkedIn page that has a linkedin-community MCP
equivalent, emit a routing hint via systemMessage (does NOT block).
Chrome MCP remains the ONLY path for People tab + connection-degree scraping.

Routing table:
  /company/{slug}/about    → get_company_profile(company_name)
  /company/{slug}/posts    → get_company_profile(company_name, sections="posts")
  /company/{slug}/jobs     → get_company_profile(company_name, sections="jobs")
  /jobs/view/{id}/         → get_job_details(url)
  /in/{profile-slug}/      → get_person_profile(profile_url)
  /search/results/people   → search_people(keywords)
  /search/results/jobs     → search_jobs(keywords)
  /company/{slug}/people/  → NO equivalent; Chrome is required (allow silently)
  /messaging/              → send_message / get_inbox / get_conversation

Original .sh used `exit 2` to surface a hint. In Claude Code,
`exit 2` triggers "hook error: No stderr output" — so we use
`exit 0 + {"systemMessage": "..."}` JSON instead.
"""

from __future__ import annotations

import json
import re
import sys


IN_RE = re.compile(r"/in/[a-zA-Z0-9_-]+")
COMPANY_RE = re.compile(r"/company/([a-zA-Z0-9_-]+)")


def build_hint(url: str):
    """Return hint string or None for no hint."""
    if "linkedin.com" not in url:
        return None

    # People tab — Chrome is the ONLY path; pass silently.
    if "/people/" in url:
        return None

    if "/jobs/view/" in url:
        return (
            f'LinkedIn tool hint: get_job_details(url="{url}") via '
            "linkedin-community MCP returns structured JD data faster. "
            "Chrome MCP proceeding as fallback."
        )

    if "/search/results/jobs" in url:
        return (
            'LinkedIn tool hint: search_jobs(keywords="...") via '
            "linkedin-community MCP is cheaper. Chrome MCP proceeding as fallback."
        )

    if "/search/results/people" in url:
        return (
            'LinkedIn tool hint: search_people(keywords="...") via '
            "linkedin-community MCP is cheaper. Chrome MCP proceeding as fallback."
        )

    if IN_RE.search(url):
        return (
            f'LinkedIn tool hint: get_person_profile(profile_url="{url}") via '
            "linkedin-community MCP returns structured profile data. "
            "Chrome MCP proceeding as fallback."
        )

    company_match = COMPANY_RE.search(url)
    if company_match and "/people/" not in url:
        slug = company_match.group(1)
        if "/posts" in url:
            return (
                f'LinkedIn tool hint: get_company_profile(company_name="{slug}", '
                'sections="posts") via linkedin-community MCP. '
                "Chrome MCP proceeding as fallback."
            )
        if "/jobs" in url:
            return (
                f'LinkedIn tool hint: get_company_profile(company_name="{slug}", '
                'sections="jobs") via linkedin-community MCP. '
                "Chrome MCP proceeding as fallback."
            )
        return (
            f'LinkedIn tool hint: get_company_profile(company_name="{slug}") via '
            "linkedin-community MCP returns structured data. "
            "Chrome MCP proceeding as fallback."
        )

    if "/messaging/" in url:
        return (
            "LinkedIn tool hint: get_inbox() / get_conversation() / send_message() "
            "via linkedin-community MCP handles messaging natively. "
            "Chrome MCP proceeding as fallback."
        )

    return None


def main() -> int:
    raw = sys.stdin.read()
    if not raw:
        return 0

    try:
        payload = json.loads(raw)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0
    url = tool_input.get("url", "") or ""
    if not url:
        return 0

    hint = build_hint(url)
    if hint:
        print(json.dumps({"systemMessage": hint}))

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Fail-open: hook crash MUST NOT block real work.
        sys.exit(0)
