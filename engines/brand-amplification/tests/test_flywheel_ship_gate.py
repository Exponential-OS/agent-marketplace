#!/usr/bin/env python3
"""
test_flywheel_ship_gate.py — XOS-240.

The rule this covers had NO tests in either place it previously existed
(cyborg's handler.ts, and the proposed HOW.py). It is a gate that BLOCKS a
"campaign complete" claim, so an untested version is worse than none: it can
either wave through an unshipped campaign or wedge a finished one.

`skip_http` is used everywhere except the one case that specifically covers dead
links, so the suite does not depend on the network.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
HANDLER = ROOT / "rules" / "flywheel-ship-gate" / "handler.ts"

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


def run(payload: dict) -> dict:
    p = subprocess.run(
        ["bun", "run", str(HANDLER), json.dumps(payload)],
        capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=120,
    )
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"verdict": "unparseable", "_out": p.stdout[:300], "_err": p.stderr[:300]}


def master(rows: str) -> str:
    fh = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
    fh.write("# Campaign master\n\n## Surface Coverage Matrix\n\n")
    fh.write("| # | Surface | Status | URL |\n|---|---|---|---|\n")
    fh.write(rows)
    fh.close()
    return fh.name


print("\nXOS-240 — flywheel ship gate (ported to TypeScript)\n")

# --- the happy path -------------------------------------------------------
ok = master(
    "| 1 | LinkedIn hub | ✅ LIVE | https://example.com/a |\n"
    "| 2 | Substack | ✅ PUBLISHED | https://example.com/b |\n"
)
r = run({"target": ok, "claim": "complete", "skip_http": True})
check("every surface shipped with a URL -> PASS", r.get("verdict") == "PASS", json.dumps(r)[:180])

# --- the failure this rule exists for -------------------------------------
pending = master(
    "| 1 | LinkedIn hub | ✅ LIVE | https://example.com/a |\n"
    "| 2 | Substack | ⬜ TODO | |\n"
)
r = run({"target": pending, "claim": "complete", "skip_http": True})
check("a still-pending surface -> BLOCK", r.get("verdict") == "BLOCK")
check("the BLOCK names the pending surface",
      any("Substack" in str(f.get("surface", "")) for f in r.get("findings", [])),
      json.dumps(r.get("findings"))[:180])

# --- "it shipped" without evidence ---------------------------------------
nourl = master(
    "| 1 | LinkedIn hub | ✅ LIVE | https://example.com/a |\n"
    "| 2 | Instagram | ✅ POSTED | |\n"
)
r = run({"target": nourl, "claim": "complete", "skip_http": True})
check("shipped WITHOUT a URL -> BLOCK ('shipped' must be falsifiable)", r.get("verdict") == "BLOCK")
check("the finding says so explicitly",
      any("URL" in str(f.get("issue", "")) for f in r.get("findings", [])),
      json.dumps(r.get("findings"))[:180])

# --- mid-campaign is not a failure ---------------------------------------
r = run({"target": pending, "claim": "in-progress", "skip_http": True})
check("same gaps mid-campaign -> WARN, not BLOCK", r.get("verdict") == "WARN",
      "an incomplete campaign is only a violation once you CLAIM complete")

# --- malformed input fails closed ----------------------------------------
r = run({"target": "/nonexistent/campaign.md", "claim": "complete", "skip_http": True})
check("missing campaign master -> BLOCK (fails closed)", r.get("verdict") == "BLOCK")

empty = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
empty.write("# Campaign master\n\nNo table here.\n")
empty.close()
r = run({"target": empty.name, "claim": "complete", "skip_http": True})
check("no surface table -> BLOCK (cannot verify what is not enumerated)", r.get("verdict") == "BLOCK")

# --- documented omissions are respected ----------------------------------
omitted = master(
    "| 1 | LinkedIn hub | ✅ LIVE | https://example.com/a |\n"
    "| 2 | Threads | N/A — no account | |\n"
)
r = run({"target": omitted, "claim": "complete", "skip_http": True})
check("an explicitly N/A surface does not block", r.get("verdict") == "PASS", json.dumps(r)[:180])

# --- the one network case -------------------------------------------------
dead = master(
    "| 1 | LinkedIn hub | ✅ LIVE | https://example.invalid/definitely-not-real |\n"
)
r = run({"target": dead, "claim": "complete", "skip_http": False})
check("a recorded URL that does not resolve -> BLOCK", r.get("verdict") == "BLOCK",
      "a dead URL means the surface is remembered, not shipped")

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(0 if failed == 0 else 1)
