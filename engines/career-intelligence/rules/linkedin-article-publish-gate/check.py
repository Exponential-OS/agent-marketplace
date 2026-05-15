#!/usr/bin/env python3
"""
check.py — linkedin-article-publish-gate enforcement logic.

LinkedIn Articles are within-platform (linkedin.com/pulse/) and allow links in body.
This gate fires BEFORE publishing to verify the article is complete and correct.

Input JSON (via sys.argv[1]):
{
  "platform": "linkedin_article",
  "article_title": "...",
  "article_content": "...",     // full article text
  "article_excerpt": "...",     // first ~500 chars for LLM judge (falls back to first 500 of content)
  "char_count": 5000
}

Exits: 0=PASS, 1=BLOCK, 2=WARN

Gates (in order):
  1. placeholder_block  — any REPLACE_ token or unresolved (coming soon)/(#) link = BLOCK
  2. backlink_check     — no linkedin.com/pulse/ or linkedin.com/posts/ in body = WARN
  3. cta_check          — no Substack URL or Co-Dialectic GitHub link = BLOCK
  4. quality            — LLM judge via PROMPT.md + claude -p on article_excerpt
"""
import json
import os
import pathlib
import re
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROMPT_PATH = SCRIPT_DIR / "PROMPT.md"

PLACEHOLDER_PATTERNS = [
    r"REPLACE_WITH_\w+",
    r"\[Part\s+\d[^\]]*\]\(#\)",       # [Part N →](#) — unresolved anchor
    r"\[Part\s+\d[^\]]*\]\(\s*\)",     # [Part N →]() — empty href
    r"\(coming\s+soon\)",              # (coming soon) in part nav
]

BACKLINK_PATTERNS = [
    r"linkedin\.com/pulse/",
    r"linkedin\.com/posts/",
]

CTA_PATTERNS = [
    r"substack\.com",
    r"thewhyman\.blog",
    r"github\.com/Exponential-OS",
]


def run_llm_judge(excerpt: str) -> dict:
    if os.environ.get("SKIP_LLM_JUDGES") == "1":
        return {"verdict": "PASS", "reason": "SKIP_LLM_JUDGES=1 — judge bypassed for CI"}

    if not PROMPT_PATH.exists():
        return {"verdict": "BLOCK", "reason": f"PROMPT.md not found at {PROMPT_PATH}",
                "fix": f"Ensure {PROMPT_PATH} exists."}

    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    prompt = prompt_template.replace("{EXCERPT}", excerpt.strip())

    for cli in ["claude", "gemini", "codex"]:
        try:
            proc = subprocess.run(
                [cli, "-p", prompt],
                capture_output=True, text=True, timeout=60,
            )
            raw = proc.stdout.strip()
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                return json.loads(match.group())
        except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
            continue

    return {"verdict": "BLOCK", "reason": "All LLM judges unavailable or timed out.",
            "fix": "Install claude CLI or set SKIP_LLM_JUDGES=1 for CI."}


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    content = ctx.get("article_content", "")
    excerpt = ctx.get("article_excerpt", "") or content[:500]
    title = ctx.get("article_title", "")

    # ── Gate 1: placeholder_block ──────────────────────────────────────────────
    for pattern in PLACEHOLDER_PATTERNS:
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            print(json.dumps({
                "verdict": "BLOCK",
                "gate": "placeholder_block",
                "reason": f"Unresolved placeholder found: '{match.group()}'. Article contains tokens that must be replaced before publishing.",
                "remediation": f"Replace all '{match.group()}' tokens with real URLs or remove them. Search the full article for any remaining REPLACE_ tokens.",
            }))
            return 1

    # ── Gate 2: backlink_check — WARN not BLOCK ────────────────────────────────
    has_backlink = any(re.search(p, content, re.IGNORECASE) for p in BACKLINK_PATTERNS)
    if not has_backlink:
        print(json.dumps({
            "verdict": "WARN",
            "gate": "backlink_check",
            "reason": "No back-link to a prior LinkedIn post or article found in the body. Back-links to prior campaign posts help readers navigate the series and resurface older content.",
            "remediation": "Add a reference link to the previous campaign's LinkedIn post or article. Even a single mention helps the algorithm chain content.",
        }))
        return 2

    # ── Gate 3: cta_check ─────────────────────────────────────────────────────
    has_cta = any(re.search(p, content, re.IGNORECASE) for p in CTA_PATTERNS)
    if not has_cta:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "cta_check",
            "reason": "No CTA found. Article must include at least one of: Substack URL (substack.com / thewhyman.blog) OR Co-Dialectic install link (github.com/Exponential-OS).",
            "remediation": "Add a CTA section before the closing. Include either the Substack link for the full piece or the Co-Dialectic install link to drive action.",
        }))
        return 1

    # ── Gate 4: quality — LLM judge ───────────────────────────────────────────
    if not excerpt:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "quality",
            "reason": "article_excerpt is empty and article_content is also empty. Cannot run quality judge.",
            "remediation": "Pass at least the first 500 characters of the article body as article_content.",
        }))
        return 1

    judge_result = run_llm_judge(excerpt)
    verdict = judge_result.get("verdict", "BLOCK").upper()

    if verdict != "PASS":
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "quality (LLM judge)",
            "reason": judge_result.get("reason", "LLM judge returned no reason."),
            "remediation": judge_result.get("fix", "Rewrite the opening paragraph to hook the reader immediately."),
        }))
        return 1

    print(json.dumps({
        "verdict": "PASS",
        "platform": "linkedin_article",
        "article_title": title,
        "char_count": ctx.get("char_count", len(content)),
        "has_backlink": has_backlink,
        "has_cta": has_cta,
        "quality": "PASS (LLM judge)",
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
