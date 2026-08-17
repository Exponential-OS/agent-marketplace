#!/usr/bin/env python3
"""
test_linkedin_group_platform.py — XOS-240.

The defect: group posts were validated as `linkedin_post`, whose
`links_in_body: false` is a FEED-algorithm rule. Groups do not suppress body
links, and a group post without its link has no purpose — so every group post
this workspace shipped FAILED gate 1 for a non-reason. On 2026-08-16 two group
posts were published anyway under a documented override, into 112k- and
352k-member groups. A gate that is wrong trains agents to override gates by
reflex, which is worse than having no gate.

The load-bearing assertion is the PAIR: the SAME text must pass as
`linkedin_group` and fail as `linkedin_post`. Asserting only the first would
pass even if the fix accidentally disabled link checking everywhere.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "skills" / "social-distribution-engine" / "post_validator.py"
PLATFORMS = ROOT / "skills" / "social-distribution-engine" / "platforms.json"

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))


def validate(platform: str, text: str) -> dict:
    # stdin MUST be closed: post_validator reads stdin whenever it is not a tty
    # and will block forever otherwise.
    p = subprocess.run(
        [sys.executable, str(VALIDATOR), "--platform", platform, "--text", text],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"verdict": "unparseable", "_stdout": p.stdout, "_stderr": p.stderr}


def violation_text(result: dict) -> str:
    out = []
    for v in result.get("violations") or []:
        out.append(v.get("message", "") if isinstance(v, dict) else str(v))
    return " | ".join(out)


# A group post whose entire purpose is to carry the link.
BODY = (
    "Seven days ago this had no distribution loop.\n\n"
    "Today it runs itself, and the numbers are the only argument that matters.\n\n"
    "https://exponentialos.io\n\n"
    "#AI #Engineering #Startups"
)

print("\nXOS-240 — linkedin_group platform\n")

# --- the platform must exist at all --------------------------------------
platforms = json.loads(PLATFORMS.read_text(encoding="utf-8"))
check("linkedin_group is a declared platform", "linkedin_group" in platforms)
check(
    "linkedin_group permits body links",
    platforms.get("linkedin_group", {}).get("links_in_body") is True,
)
check(
    "linkedin_post still SUPPRESSES body links (feed rule intact)",
    platforms.get("linkedin_post", {}).get("links_in_body") is False,
    "the feed rule must not be collateral damage",
)

# --- THE PAIR: same text, two surfaces, opposite verdicts ----------------
grp = validate("linkedin_group", BODY)
post = validate("linkedin_post", BODY)

check(
    "group post with a body link does NOT fail",
    grp.get("verdict") in ("pass", "warn"),
    f"verdict={grp.get('verdict')} {violation_text(grp)}",
)
check(
    "IDENTICAL text still FAILS as linkedin_post",
    post.get("verdict") == "fail",
    f"verdict={post.get('verdict')} — if this stops failing, link checking broke everywhere",
)
check(
    "the linkedin_post failure is specifically the body-link rule",
    "link" in violation_text(post).lower(),
    violation_text(post)[:120],
)
check(
    "and the group result carries no body-link violation",
    "link" not in violation_text(grp).lower(),
    violation_text(grp)[:120],
)

# --- the shared constraints must still apply to groups -------------------
over_limit = "x" * 3200
check(
    "group posts still enforce the character limit",
    validate("linkedin_group", over_limit).get("verdict") == "fail",
    "links_in_body:true must not disable every other check",
)
piped = "A group post\n\n| col | col |\n| --- | --- |\n\nhttps://exponentialos.io"
check(
    "group posts still reject pipe/markdown bleed",
    validate("linkedin_group", piped).get("verdict") == "fail",
    violation_text(validate("linkedin_group", piped))[:120],
)

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(0 if failed == 0 else 1)
