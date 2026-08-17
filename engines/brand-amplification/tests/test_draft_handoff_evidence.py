#!/usr/bin/env python3
"""
test_draft_handoff_evidence.py — XOS-249.

Covers the evidence chain end to end: post_validator.py records a run, and the
PreToolUse hook allows or denies a publish based on whether matching evidence
exists.

Every allow-asserting case is paired with a near-identical deny case differing in
one field, so neither a blanket-allow nor a blanket-deny hook can pass.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "skills" / "social-distribution-engine" / "post_validator.py"
HOOK = ROOT / "hooks" / "scripts" / "preflight-draft-handoff-evidence.py"
sys.path.insert(0, str(ROOT / "skills" / "social-distribution-engine"))

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


# A realistic LinkedIn body: long enough to clear MIN_TEXT_CHARS.
COPY = (
    "Seven days ago this system had no distribution loop.\n\n"
    "Today it runs itself, and the numbers are the only argument that matters.\n\n"
    "#AI #Engineering #Startups"
)
OTHER_COPY = COPY.replace("Seven days", "Nine days")


def run_validator(text: str, platform: str, ledger: pathlib.Path) -> int:
    env = {**os.environ, "BAE_DRAFT_GATE_LEDGER": str(ledger)}
    p = subprocess.run(
        [sys.executable, str(VALIDATOR), "--platform", platform, "--text", text],
        capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL,
    )
    return p.returncode


def run_hook(tool_input: dict, ledger: pathlib.Path, extra_env: dict | None = None) -> dict:
    env = {**os.environ, "BAE_DRAFT_GATE_LEDGER": str(ledger)}
    env.pop("BAE_DRAFT_GATE_SKIP", None)
    if extra_env:
        env.update(extra_env)
    payload = {"tool_name": "mcp__composio__LINKEDIN_CREATE_LINKED_IN_POST", "tool_input": tool_input}
    p = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload), capture_output=True, text=True, env=env,
    )
    try:
        return json.loads(p.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return {"_unparseable": p.stdout, "_stderr": p.stderr}


def decision(out: dict) -> str:
    hso = out.get("hookSpecificOutput") or {}
    return hso.get("permissionDecision", "allow")


print("\nXOS-249 — Draft Handoff Gate evidence chain\n")

with tempfile.TemporaryDirectory() as td:
    ledger = pathlib.Path(td) / "ledger.jsonl"

    # --- the core failure this ticket is about --------------------------------
    out = run_hook({"commentary": COPY}, ledger)
    check("publish with NO validation record -> deny", decision(out) == "deny", json.dumps(out)[:200])
    check(
        "deny reason carries WHAT and HOW",
        "WHAT:" in (out.get("hookSpecificOutput", {}).get("permissionDecisionReason", ""))
        and "HOW:" in (out.get("hookSpecificOutput", {}).get("permissionDecisionReason", "")),
    )

    # --- the mirror: same copy, after the gate ran ----------------------------
    run_validator(COPY, "linkedin_post", ledger)
    check("ledger file written by the validator", ledger.exists())
    out = run_hook({"commentary": COPY}, ledger)
    check("publish WITH a matching record -> allow", decision(out) == "allow", json.dumps(out)[:200])

    # --- evidence must be copy-specific, not 'any validation happened' --------
    out = run_hook({"commentary": OTHER_COPY}, ledger)
    check(
        "different copy is NOT covered by another post's record -> deny",
        decision(out) == "deny",
        "a stale record must not green-light unvalidated text",
    )

    # --- copy-paste normalization must not cause a false deny ----------------
    # Each case isolates ONE normalization step, so a mutation that removes that
    # step alone is caught. CRLF is handled by both the \r\n replace and the
    # per-line rstrip, so a CRLF-only case cannot kill either individually.
    roundtripped = COPY.replace("\n", "\r\n") + "\n\n"
    out = run_hook({"commentary": roundtripped}, ledger)
    check("CRLF + trailing-newline round trip still matches -> allow", decision(out) == "allow")

    # Trailing SPACES (no \r) — only the per-line rstrip can absorb these.
    trailing_spaces = "\n".join(line + "   " for line in COPY.split("\n"))
    out = run_hook({"commentary": trailing_spaces}, ledger)
    check("trailing spaces on each line still match -> allow", decision(out) == "allow")

    # Extra blank lines between paragraphs — only the \n{3,} collapse absorbs these.
    extra_blanks = COPY.replace("\n\n", "\n\n\n\n")
    out = run_hook({"commentary": extra_blanks}, ledger)
    check("collapsed blank-line runs still match -> allow", decision(out) == "allow")

    # --- fail-safe directions -------------------------------------------------
    out = run_hook({"urn": "abc123"}, ledger)
    check("unreadable payload -> allow (never block on our own ignorance)", decision(out) == "allow")
    check("unreadable payload still warns", "systemMessage" in out)

    out = run_hook({"commentary": OTHER_COPY}, ledger, {"BAE_DRAFT_GATE_SKIP": "1"})
    check("documented skip env -> allow", decision(out) == "allow")
    check("skip env is announced, not silent", "SKIP" in out.get("systemMessage", "").upper())

    # --- the hook must key on content, not on the tool being called ----------
    out = run_hook({"text": COPY}, ledger)
    check("alternate payload key ('text') also resolves the copy -> allow", decision(out) == "allow")

    # --- the record itself is well-formed ------------------------------------
    # The subprocesses above got the ledger path via env; this process did not,
    # so point it at the same temp ledger before reading in-process.
    os.environ["BAE_DRAFT_GATE_LEDGER"] = str(ledger)
    import gate_ledger  # noqa: E402

    rec = gate_ledger.find_validation(COPY)
    check("recorded verdict is retrievable", rec is not None and "verdict" in (rec or {}))
    check("record carries a sha256", bool((rec or {}).get("sha256")))

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(0 if failed == 0 else 1)
