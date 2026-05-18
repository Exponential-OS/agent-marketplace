#!/usr/bin/env python3
"""
check.py — comment-hijack-gate enforcement logic.

A "comment hijack" = posting a comment on a high-engagement influencer post
that drives traffic to your hub. This gate fires before any hijack comment
is posted.

Input JSON (via sys.argv[1]):
{
  "platform": "linkedin|twitter|x",
  "target_post_url": "https://...",
  "target_post_age_hours": 24,
  "comment_text": "The full comment you're about to post...",
  "hub_url": "https://...",
  "previously_commented_urls": ["https://..."]   // optional, default []
}

Exits: 0=PASS, 1=BLOCK

Gates (in order):
  1. hub_url_present    — structural: hub URL must appear in comment
  2. freshness          — structural: post age within platform window
  3. dedup              — structural: not already commented on this URL
  4. standalone_value   — semantic:   LLM judge via PROMPT.md + claude -p
"""
import json
import pathlib
import re
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROMPT_PATH = SCRIPT_DIR / "PROMPT.md"

# Platform-specific freshness windows (hours)
FRESHNESS_WINDOWS = {
    "linkedin": 72,
    "twitter": 8,
    "x": 8,
}
DEFAULT_FRESHNESS = 48


def run_llm_judge(comment_text: str, hub_url: str) -> dict:
    """Call PROMPT.md via claude -p for standalone_value check."""
    if not PROMPT_PATH.exists():
        return {
            "verdict": "BLOCK",
            "reason": f"PROMPT.md not found at {PROMPT_PATH}. Cannot run LLM quality judge.",
            "fix": f"Ensure {PROMPT_PATH} exists.",
        }

    prompt_template = PROMPT_PATH.read_text()

    # Strip hub URL from comment so judge evaluates value without the link
    comment_without_hub = comment_text.replace(hub_url, "[hub link]").strip()
    prompt = prompt_template.replace("{COMMENT_TEXT_WITHOUT_HUB}", comment_without_hub)

    try:
        proc = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        return {
            "verdict": "BLOCK",
            "reason": "claude CLI not found. Cannot run LLM quality judge for standalone_value.",
            "fix": "Install claude CLI: https://claude.ai/code — distribution engine actions require LLM quality gating.",
        }
    except subprocess.TimeoutExpired:
        return {
            "verdict": "BLOCK",
            "reason": "LLM judge timed out (60s). Cannot verify standalone_value.",
            "fix": "Retry. If persistent, check claude CLI connectivity.",
        }

    raw = proc.stdout.strip()

    # Extract JSON from response (claude -p may wrap with markdown)
    json_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not json_match:
        return {
            "verdict": "BLOCK",
            "reason": f"LLM judge returned non-JSON output: {raw[:200]}",
            "fix": "Retry. If persistent, check PROMPT.md format.",
        }

    try:
        result = json.loads(json_match.group())
    except json.JSONDecodeError as e:
        return {
            "verdict": "BLOCK",
            "reason": f"LLM judge returned malformed JSON: {e}. Raw: {raw[:200]}",
            "fix": "Retry.",
        }

    return result


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    platform = ctx.get("platform", "").lower().strip()
    target_url = ctx.get("target_post_url", "")
    age_hours = ctx.get("target_post_age_hours")
    comment = ctx.get("comment_text", "")
    hub_url = ctx.get("hub_url", "")
    previously_commented = ctx.get("previously_commented_urls", [])

    # ── Gate 1: hub_url must be present in the comment ────────────────────────
    if not hub_url:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": "hub_url not provided. A hijack comment without a hub link wastes the slot — the whole point is to drive traffic to the hub.",
            "remediation": "Add hub_url field with the URL of your hub post.",
        }))
        return 1

    if hub_url not in comment:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": "hub_url not found in comment_text. Hijack without the hub link drives no traffic.",
            "remediation": f"Include '{hub_url}' in the comment body.",
        }))
        return 1

    # ── Gate 2: freshness window ───────────────────────────────────────────────
    if age_hours is not None:
        window = FRESHNESS_WINDOWS.get(platform, DEFAULT_FRESHNESS)
        if age_hours > window:
            print(json.dumps({
                "verdict": "BLOCK",
                "reason": f"Target post is {age_hours}h old — past the {window}h freshness window for {platform or 'this platform'}. Late comments get zero algorithm distribution.",
                "remediation": "Find a fresher post from the same person, or skip this hijack slot.",
            }))
            return 1

    # ── Gate 3: dedup ──────────────────────────────────────────────────────────
    if target_url and target_url in previously_commented:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": f"Already commented on this post: {target_url}. Duplicate comments look spammy.",
            "remediation": "Find a different post from this person to hijack, or skip.",
        }))
        return 1

    # ── Gate 4: standalone_value — LLM semantic judge ─────────────────────────
    judge_result = run_llm_judge(comment, hub_url)
    verdict = judge_result.get("verdict", "BLOCK").upper()

    if verdict != "PASS":
        output = {
            "verdict": "BLOCK",
            "gate": "standalone_value (LLM judge)",
            "reason": judge_result.get("reason", "LLM judge returned no reason."),
            "remediation": judge_result.get("fix", "Rewrite comment to lead with genuine value before the hub link."),
        }
        print(json.dumps(output))
        return 1

    print(json.dumps({
        "verdict": "PASS",
        "platform": platform,
        "target_post_url": target_url,
        "comment_length": len(comment),
        "hub_url_present": True,
        "standalone_value": "PASS (LLM judge)",
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
