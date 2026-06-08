#!/usr/bin/env python3
"""
company-flags-filter/HOW.py — Gate that prevents deprioritized or flagged
companies from appearing in dashboard action items.

Called by Mission Control, apply-dashboard, and job-search-scheduler before
surfacing ANY action item that names a company. A 92% score on a deprioritized
company must never surface as "apply now" — the flag wins over the score.

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "company": "OpenAI",
      "action": "apply|referral|follow_up|score",
      "flags_file": "/abs/path/to/brain/projects/job-search/company-flags.json"
    }

Exit:
    0 = PASS (no active flag, action is allowed)
    1 = BLOCK (company is deprioritized or flagged do_not_apply — suppress action)
    2 = WARN (company has active referral in progress — surface referral status instead)

Stdout: JSON {"status": "pass|block|warn", "reason": str, "re_evaluate_if": str|null}
"""

import json
import sys


class FlagsConfigError(Exception):
    """flags_file path was given but does not resolve to a readable JSON file.

    Misconfiguration, NOT 'no flags configured'. Per FAIL-HARD: a safety gate
    that silently PASSES when its config is missing is worse than no gate — it
    leaked do_not_apply companies (OpenAI/Google) into actions while reporting
    healthy (XOS-27 / review H-3, 2026-06-05). The legitimate 'no flags' case
    is an existing file containing {} — that still passes.
    """


def load_flags(flags_file):
    try:
        with open(flags_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise FlagsConfigError(
            f"flags_file not found at '{flags_file}'. Refusing to pass-all on a "
            f"missing safety config — fix the path or create the file (use an "
            f"empty {{}} to intentionally configure no flags)."
        )
    except (OSError, json.JSONDecodeError) as e:
        raise FlagsConfigError(f"flags_file at '{flags_file}' unreadable: {e}")


def normalize(name):
    return name.strip().lower()


def main():
    if len(sys.argv) < 2:
        out(0, "pass", "no input — defaulting to pass")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(1, "block", f"Invalid JSON: {e}")

    company = ctx.get("company", "").strip()
    action = ctx.get("action", "apply")
    flags_file = ctx.get("flags_file", "")

    if not company:
        out(1, "block", "company field is required")

    if not flags_file:
        out(1, "block", "flags_file path is required")

    try:
        flags = load_flags(flags_file)
    except FlagsConfigError as e:
        out(1, "block", str(e))
    company_lc = normalize(company)

    # Check deprioritized list
    for entry in flags.get("deprioritized", []):
        if normalize(entry.get("company", "")) == company_lc:
            reason = entry.get("reason", "Company deprioritized")
            re_eval = entry.get("re_evaluate_if")
            print(json.dumps({
                "status": "block",
                "reason": f"DEPRIORITIZED: {reason}",
                "re_evaluate_if": re_eval
            }))
            sys.exit(1)

    # Check flagged list
    for entry in flags.get("flagged", []):
        if normalize(entry.get("company", "")) == company_lc:
            flag_action = entry.get("action", "")
            if flag_action == "do_not_apply" and action in ("apply", "referral"):
                reason = entry.get("note", f"Company flagged: {entry.get('flag', 'unknown')}")
                print(json.dumps({
                    "status": "block",
                    "reason": f"FLAGGED ({entry.get('flag', '')}): {reason}",
                    "re_evaluate_if": None
                }))
                sys.exit(1)

    # Check warm_referral_active — if referral in flight, surface status not new ask
    for entry in flags.get("warm_referral_active", []):
        if normalize(entry.get("company", "")) == company_lc:
            status = entry.get("status", "unknown")
            contact = entry.get("contact", "unknown")
            follow_up = entry.get("follow_up", "unknown")
            print(json.dumps({
                "status": "warn",
                "reason": f"Referral already in flight via {contact} (status: {status}, follow_up: {follow_up}). Surface referral status instead of new action.",
                "re_evaluate_if": f"After {follow_up}"
            }))
            sys.exit(2)

    # No flags — action is allowed
    print(json.dumps({"status": "pass", "reason": "No active flags", "re_evaluate_if": None}))
    sys.exit(0)


def out(code, status, reason):
    print(json.dumps({"status": status, "reason": reason, "re_evaluate_if": None}))
    sys.exit(code)


if __name__ == "__main__":
    main()
