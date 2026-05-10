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


def load_flags(flags_file):
    try:
        with open(flags_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        # If flags file missing or unreadable, PASS (don't block on missing config)
        return {}


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

    flags = load_flags(flags_file)
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
