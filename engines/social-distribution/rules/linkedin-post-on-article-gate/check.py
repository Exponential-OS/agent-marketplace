#!/usr/bin/env python3
"""
check.py — linkedin-post-on-article-gate enforcement logic.

LinkedIn hub posts sharing an Article must:
  - Be a reshare of the LinkedIn Article (not a standalone UGC post)
  - Have NO external links in the post body (algorithm penalty)
  - Reference the Article via a within-platform URL (linkedin.com/pulse/)
  - Have no placeholder tokens
  - Have a visible hook in the first line

Input JSON (via sys.argv[1]):
{
  "platform": "linkedin_post",
  "post_body": "...",
  "is_reshare": true,                                     // REQUIRED — BLOCK if false or absent
  "article_url": "https://www.linkedin.com/pulse/...",   // required when is_reshare=true
  "first_comment": "..."                                  // optional, for context
}

Exits: 0=PASS, 1=BLOCK, 2=WARN

Gates (in order):
  0. is_reshare             — must be true = BLOCK if false/absent (hub post must reshare the article)
  1. external_link_in_body  — any non-linkedin.com URL in body = BLOCK
  2. article_url_format     — article_url must be linkedin.com/pulse/ if provided = BLOCK
  3. placeholder_in_post    — REPLACE_ tokens in body = BLOCK
  4. hook_visibility        — first line < 10 chars = WARN
"""
import json
import re
import sys

URL_RE = re.compile(r"https?://[^\s\)\"']+")
LINKEDIN_RE = re.compile(r"https?://(www\.)?linkedin\.com")
LNKD_RE = re.compile(r"https?://lnkd\.in")
PULSE_RE = re.compile(r"https?://(www\.)?linkedin\.com/pulse/")
PLACEHOLDER_RE = re.compile(r"REPLACE_WITH_\w+")


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    post_body = ctx.get("post_body", "")
    article_url = ctx.get("article_url", "")
    is_reshare = ctx.get("is_reshare", None)

    # ── Gate 0: is_reshare — BLOCK if false or absent ─────────────────────────
    if is_reshare is not True:
        msg = (
            "Hub posts must be reshares of the LinkedIn Article, not standalone UGC posts. "
            "A standalone post gets no Article engagement credit and breaks the hub-spoke model."
        )
        if is_reshare is None:
            msg = "Missing required field 'is_reshare'. " + msg
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "is_reshare",
            "reason": msg,
            "remediation": (
                "On LinkedIn, open the published Article → click 'Repost' → add commentary in the repost box. "
                "Do NOT create a new post — it must be a reshare of the Article so engagement rolls up. "
                "Pass \"is_reshare\": true in the gate payload once you have used the Repost flow."
            ),
        }))
        return 1

    # ── Gate 1: external_link_in_body ─────────────────────────────────────────
    urls_in_body = URL_RE.findall(post_body)
    external_urls = [
        u for u in urls_in_body
        if not LINKEDIN_RE.match(u) and not LNKD_RE.match(u)
    ]
    if external_urls:
        offender = external_urls[0]
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "external_link_in_body",
            "reason": f"External link found in post body: '{offender}'. LinkedIn suppresses posts with external URLs.",
            "remediation": f"Move '{offender}' (and all other external links) to the first comment. Post body must contain only linkedin.com or lnkd.in URLs.",
        }))
        return 1

    # ── Gate 2: article_url_format ────────────────────────────────────────────
    if article_url and not PULSE_RE.match(article_url):
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "article_url_format",
            "reason": f"article_url '{article_url}' is not a within-platform LinkedIn Article URL. Hub posts must link to LinkedIn Articles (linkedin.com/pulse/), not external URLs.",
            "remediation": "Publish the article on LinkedIn first, then use the resulting linkedin.com/pulse/ URL here. LinkedIn Articles can embed links in body — external platforms cannot.",
        }))
        return 1

    # ── Gate 3: placeholder_in_post ───────────────────────────────────────────
    match = PLACEHOLDER_RE.search(post_body)
    if match:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "placeholder_in_post",
            "reason": f"Unresolved placeholder '{match.group()}' found in post body.",
            "remediation": f"Replace '{match.group()}' with the real URL or text. Search the full post body for any remaining REPLACE_ tokens.",
        }))
        return 1

    # ── Gate 4: hook_visibility — WARN not BLOCK ──────────────────────────────
    first_line = post_body.strip().split("\n")[0].strip() if post_body.strip() else ""
    if len(first_line) < 10:
        print(json.dumps({
            "verdict": "WARN",
            "gate": "hook_visibility",
            "reason": f"First line is only {len(first_line)} characters. LinkedIn shows the first ~2 lines before 'see more' — a weak first line loses readers before they click.",
            "remediation": "Start with a strong hook of at least 10 characters. Lead with the tension or the specific claim.",
        }))
        return 2

    print(json.dumps({
        "verdict": "PASS",
        "platform": "linkedin_post",
        "external_links_in_body": 0,
        "article_url_valid": bool(article_url),
        "placeholder_clean": True,
        "hook_visible": True,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
