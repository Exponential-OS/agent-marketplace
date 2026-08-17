#!/usr/bin/env python3
"""
preflight-draft-handoff-evidence.py

XOS-249. PreToolUse hook on the publishing tools. Refuses to publish copy that
has no Draft Handoff Gate evidence.

THE PROBLEM THIS SOLVES
SKILL.md declares the Draft Handoff Gate MANDATORY. On 2026-08-16 an agent
produced LinkedIn copy without it and nothing noticed, because a skill that must
be remembered is a document, not a pipeline. Three separate defects that day
(XOS-240, XOS-244, XOS-248) all trace to the pipeline being bypassed invisibly.

HOW IT IS PRECISE
`post_validator.py` records every run in a ledger, keyed by a sha256 of the exact
copy it validated. This hook hashes the copy about to be published and looks for
a matching record. There is no "does this look like LinkedIn copy" heuristic —
those cannot be made accurate, and a gate that is usually wrong trains everyone
to ignore it (XOS-241). This fires only on a real publish call and either finds
matching evidence or does not.

FAIL-SAFE DIRECTION
Two cases deliberately do NOT block:
  - the tool payload has no extractable copy (we cannot judge what we cannot read)
  - BAE_DRAFT_GATE_SKIP=1 (deliberate, documented override)
Both still emit a visible systemMessage. Blocking on an unreadable payload would
strand a real publish on the hook's own ignorance, which is how gates get
disabled wholesale.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

SKIP_ENV = "BAE_DRAFT_GATE_SKIP"

# Keys the publishing tools use for the post body, most specific first.
TEXT_KEYS = (
    "commentary",
    "share_commentary",
    "text",
    "content",
    "body",
    "post_text",
    "message",
    "title_and_body",
)

# A publish payload's body is substantial; short strings are ids, urns, urls.
MIN_TEXT_CHARS = 40


def _load_ledger_module():
    """Import gate_ledger from the sibling skills/ tree without assuming sys.path."""
    here = pathlib.Path(__file__).resolve()
    # hooks/scripts/<this> -> plugin root -> skills/social-distribution-engine
    candidates = [
        here.parent.parent.parent / "skills" / "social-distribution-engine",
        here.parent.parent / "skills" / "social-distribution-engine",
    ]
    for c in candidates:
        if (c / "gate_ledger.py").exists():
            sys.path.insert(0, str(c))
            import gate_ledger  # type: ignore

            return gate_ledger
    return None


def extract_text(tool_input: dict) -> str:
    if not isinstance(tool_input, dict):
        return ""
    for key in TEXT_KEYS:
        v = tool_input.get(key)
        if isinstance(v, str) and len(v.strip()) >= MIN_TEXT_CHARS:
            return v
    # Fallback: the longest substantial string anywhere in the payload.
    best = ""
    def walk(node):
        nonlocal best
        if isinstance(node, str):
            if len(node) > len(best):
                best = node
        elif isinstance(node, dict):
            for vv in node.values():
                walk(vv)
        elif isinstance(node, list):
            for vv in node:
                walk(vv)
    walk(tool_input)
    return best if len(best.strip()) >= MIN_TEXT_CHARS else ""


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0  # unreadable hook input must never block a publish

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}

    if os.environ.get(SKIP_ENV) == "1":
        emit({"systemMessage": f"⚠ Draft Handoff Gate evidence check SKIPPED via {SKIP_ENV}=1 ({tool_name})."})
        return 0

    text = extract_text(tool_input)
    if not text:
        emit({"systemMessage": (
            f"⚠ Draft Handoff Gate: could not read post copy from {tool_name}, so gate evidence "
            "was NOT verified. Allowing the publish rather than blocking on an unreadable payload."
        )})
        return 0

    gl = _load_ledger_module()
    if gl is None:
        emit({"systemMessage": "⚠ Draft Handoff Gate: gate_ledger module not found; evidence not verified."})
        return 0

    rec = gl.find_validation(text)
    if rec:
        emit({"systemMessage": (
            f"✓ Draft Handoff Gate evidence found — validated {rec.get('ts')} "
            f"as {rec.get('platform')} (verdict: {rec.get('verdict')})."
        )})
        return 0

    reason = (
        "WHAT: this copy is about to be published but has NO Draft Handoff Gate record. "
        f"post_validator.py never validated this exact text (sha256 {gl.content_hash(text)[:12]}…). "
        "SKILL.md makes the gate MANDATORY before copy leaves the pipeline; on 2026-08-16 skipping it "
        "shipped a post with no image (XOS-248), group posts on the wrong platform (XOS-240), and a "
        "campaign declared complete with a surface unshipped (XOS-244).\n"
        "HOW: run the gate on the EXACT text you are publishing, hashtags included:\n"
        "  python3 \"$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/"
        "social-distribution-engine/post_validator.py 2>/dev/null | tail -1)\" \\\n"
        "    --platform <linkedin_post|linkedin_group|x_post|...> --text \"<exact copy>\"\n"
        "Fix any violations, re-run until it passes, then publish. Group posts use linkedin_group.\n"
        f"Deliberate override for a single call: {SKIP_ENV}=1"
    )
    emit({
        "systemMessage": "⛔ Draft Handoff Gate: publishing copy with no validation record — see reason.",
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
