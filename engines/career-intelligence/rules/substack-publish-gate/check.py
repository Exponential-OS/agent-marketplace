#!/usr/bin/env python3
"""
check.py — substack-publish-gate enforcement logic.

Substack email sends are one-way doors: you cannot un-send to subscribers.
This gate fires BEFORE any publish action that would trigger an email blast.

Input JSON (via sys.argv[1]):
{
  "platform": "substack",
  "action": "publish|draft_save|edit",
  "is_email_send": true,
  "is_resend": false,
  "email_send_confirmed": false,  // human must set true to pass gate 2
  "post_title": "...",
  "post_excerpt": "...",          // first ~500 chars, for quality judge
  "word_count": 1500,
  "has_hook": true,
  "has_cta": true,
  "section": "...",               // optional: Substack section/newsletter name; WARN if absent on email send
  "tags": ["tag1", "tag2"]        // optional: Substack post tags; WARN if absent on email send (min 2 recommended)
}

Exits: 0=PASS, 1=BLOCK, 2=WARN

Gates (in order):
  1. resend_block      — is_resend=true always BLOCK, no exceptions
  2. email_send_gate   — is_email_send=true requires email_send_confirmed=true
  3. completeness      — word_count>=300 + has_hook + has_cta
  4. metadata          — section missing = WARN, tags empty/missing = WARN (WARN only, not BLOCK)
  5. quality           — LLM judge via PROMPT.md + claude -p on post_excerpt
"""
import json
import pathlib
import re
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROMPT_PATH = SCRIPT_DIR / "PROMPT.md"

MIN_WORD_COUNT = 300


def run_llm_judge(post_excerpt: str) -> dict:
    """Call PROMPT.md via claude -p for quality check."""
    if not PROMPT_PATH.exists():
        return {
            "verdict": "BLOCK",
            "reason": f"PROMPT.md not found at {PROMPT_PATH}. Cannot run LLM quality judge.",
            "fix": f"Ensure {PROMPT_PATH} exists.",
        }

    prompt_template = PROMPT_PATH.read_text()
    prompt = prompt_template.replace("{EXCERPT}", post_excerpt.strip())

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
            "reason": "claude CLI not found. Cannot run LLM quality judge.",
            "fix": "Install claude CLI: https://claude.ai/code",
        }
    except subprocess.TimeoutExpired:
        return {
            "verdict": "BLOCK",
            "reason": "LLM judge timed out (60s). Cannot verify post quality.",
            "fix": "Retry. If persistent, check claude CLI connectivity.",
        }

    raw = proc.stdout.strip()
    json_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not json_match:
        return {
            "verdict": "BLOCK",
            "reason": f"LLM judge returned non-JSON: {raw[:200]}",
            "fix": "Retry. If persistent, check PROMPT.md format.",
        }

    try:
        return json.loads(json_match.group())
    except json.JSONDecodeError as e:
        return {
            "verdict": "BLOCK",
            "reason": f"LLM judge returned malformed JSON: {e}",
            "fix": "Retry.",
        }


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    is_resend = ctx.get("is_resend", False)
    is_email_send = ctx.get("is_email_send", False)
    email_send_confirmed = ctx.get("email_send_confirmed", False)
    action = ctx.get("action", "").lower()
    post_title = ctx.get("post_title", "")
    post_excerpt = ctx.get("post_excerpt", "")
    word_count = ctx.get("word_count", 0)
    has_hook = ctx.get("has_hook", False)
    has_cta = ctx.get("has_cta", False)
    section = ctx.get("section", "")
    tags = ctx.get("tags", [])

    # ── Gate 1: resend_block — inviolable one-way door ─────────────────────────
    if is_resend:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "resend_block",
            "reason": "This is a RESEND of an already-published post. Substack email cannot be un-sent — a second publish triggers a second email blast to all subscribers.",
            "remediation": (
                "Edit the post in-place without republishing: "
                "post editor → Settings/gear icon → swap cover or fix body → Save. "
                "NEVER click Publish, Send, Republish, or 'Notify subscribers' on an already-sent post. "
                "This gate has no override. Resend authorization requires explicit user action in the Substack UI — not agent delegation."
            ),
        }))
        return 1

    # ── Gate 2: email_send_gate — human confirmation required ─────────────────
    if is_email_send and action not in ("draft_save", "edit"):
        if not email_send_confirmed:
            print(json.dumps({
                "verdict": "BLOCK",
                "gate": "email_send_gate",
                "reason": "This action sends email to all subscribers. Explicit human confirmation is required before the agent proceeds.",
                "remediation": (
                    "Review the post draft carefully. "
                    "If ready to send, add `\"email_send_confirmed\": true` to the payload — "
                    "this field must be set by the human in the current turn, not by a standing rule. "
                    "Then re-run the gate."
                ),
            }))
            return 1

    # ── Gate 3: completeness ───────────────────────────────────────────────────
    if word_count < MIN_WORD_COUNT:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "completeness",
            "reason": f"Post is {word_count} words — below the {MIN_WORD_COUNT}-word minimum for an email send. Subscribers expect substance.",
            "remediation": f"Expand the post to at least {MIN_WORD_COUNT} words before sending.",
        }))
        return 1

    if not has_hook:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "completeness",
            "reason": "Post is missing an opening hook. The first paragraph does not create tension, curiosity, or a strong claim.",
            "remediation": "Rewrite the opener so the first 1-2 sentences immediately establish what the reader stands to gain or what is at stake.",
        }))
        return 1

    if not has_cta:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "completeness",
            "reason": "Post is missing a CTA (call to action). Every email send needs a clear next step for the reader.",
            "remediation": "Add a CTA: subscribe link, share prompt, reply invitation, or action link.",
        }))
        return 1

    # ── Gate 4: metadata — section + tags (WARN only, not BLOCK) ─────────────
    metadata_warnings = []
    if is_email_send:
        if not section:
            metadata_warnings.append(
                "No 'section' field provided. For multi-section Substack publications, assign the post to the correct section before sending. "
                "Add \"section\": \"<section name>\" to the payload. Single-section publications can ignore this warning."
            )
        if not tags or (isinstance(tags, list) and len(tags) == 0):
            metadata_warnings.append(
                "No tags provided. Substack tags improve SEO and discoverability. "
                "Add \"tags\": [\"tag1\", \"tag2\"] (2-3 recommended). "
                "Without tags, the post will not surface in Substack search or topic feeds."
            )
        elif isinstance(tags, list) and len(tags) < 2:
            metadata_warnings.append(
                f"Only {len(tags)} tag provided. Minimum 2 tags recommended for Substack discoverability. "
                "Add at least one more tag covering the post topic."
            )

    # ── Gate 5: quality — LLM semantic judge ──────────────────────────────────
    if not post_excerpt:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "quality",
            "reason": "post_excerpt is empty. Cannot run LLM quality judge without excerpt.",
            "remediation": "Pass the first ~500 characters of the post body as post_excerpt.",
        }))
        return 1

    judge_result = run_llm_judge(post_excerpt)
    verdict = judge_result.get("verdict", "BLOCK").upper()

    if verdict != "PASS":
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "quality (LLM judge)",
            "reason": judge_result.get("reason", "LLM judge returned no reason."),
            "remediation": judge_result.get("fix", "Rewrite the opening to hook immediately before sending."),
        }))
        return 1

    if metadata_warnings:
        print(json.dumps({
            "verdict": "WARN",
            "gate": "metadata",
            "platform": ctx.get("platform", "substack"),
            "post_title": post_title,
            "word_count": word_count,
            "quality": "PASS (LLM judge)",
            "reason": " | ".join(metadata_warnings),
            "remediation": "Add section and/or tags fields to the payload. Post can ship but discoverability will be reduced.",
        }))
        return 2

    print(json.dumps({
        "verdict": "PASS",
        "platform": ctx.get("platform", "substack"),
        "post_title": post_title,
        "word_count": word_count,
        "is_email_send": is_email_send,
        "email_send_confirmed": email_send_confirmed,
        "quality": "PASS (LLM judge)",
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
