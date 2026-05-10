#!/usr/bin/env python3
"""
check.py — linkedin-mention-gate enforcement logic.

Input JSON (via sys.argv[1]):
{
  "person": "Exact LinkedIn Display Name",
  "name_verified": true,              // confirmed from people file or human
  "mention_picker_attempted": true,   // type_text "@Name" was used (not execCommand)
  "mention_picker_result": "found|not_found|skipped",
  "human_confirmed_fallback": false   // human explicitly said "go ahead plain text"
}

Exits: 0=PASS, 1=BLOCK
"""
import json
import sys

context_raw = sys.argv[1] if len(sys.argv) > 1 else ""

try:
    ctx = json.loads(context_raw)
except json.JSONDecodeError as e:
    print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
    sys.exit(1)

person = ctx.get("person", "(unknown)")
name_verified = ctx.get("name_verified", False)
picker_attempted = ctx.get("mention_picker_attempted", False)
picker_result = ctx.get("mention_picker_result", "skipped")
human_confirmed = ctx.get("human_confirmed_fallback", False)

# Gate 1: name must be verified before touching the picker
if not name_verified:
    print(json.dumps({
        "verdict": "BLOCK",
        "reason": (
            f"Name for '{person}' not verified. Check their people file for exact LinkedIn "
            "display name, or ask human: 'What is [person]'s exact name on LinkedIn?' "
            "Never type a guessed name into the picker."
        ),
        "remediation": "Read brain/network/people/<slug>.json → use 'name' field. If file missing → ask human."
    }))
    sys.exit(1)

# Gate 2: picker must be attempted (not bypassed with execCommand/insertText)
if not picker_attempted:
    print(json.dumps({
        "verdict": "BLOCK",
        "reason": (
            f"@mention picker not attempted for '{person}'. Must use type_text tool with "
            "'@Name' to trigger LinkedIn's resolver — not document.execCommand or insertText, "
            "which bypass the picker and produce plain text only."
        ),
        "remediation": "Use type_text '@{verified_name}' into focused LinkedIn editor, then wait for picker dropdown."
    }))
    sys.exit(1)

# Gate 3: if picker found nothing, must have human confirmation before posting plain text
if picker_result == "not_found" and not human_confirmed:
    print(json.dumps({
        "verdict": "BLOCK",
        "reason": (
            f"LinkedIn mention picker could not find '{person}' (likely 3rd+ connection or "
            "no recent engagement with the post). STOP — do NOT post plain text silently."
        ),
        "remediation": (
            f"Ask human: 'I can't find {person} in the LinkedIn mention picker "
            "(likely 3rd+ connection with no recent engagement). Can you provide their "
            "LinkedIn profile URL so I can @tag them correctly?' "
            "Wait for URL or explicit 'go ahead plain text' before proceeding."
        )
    }))
    sys.exit(1)

print(json.dumps({"verdict": "PASS", "person": person, "mention_picker_result": picker_result}))
sys.exit(0)
