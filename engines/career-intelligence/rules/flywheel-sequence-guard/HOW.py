#!/usr/bin/env python3
"""
flywheel-sequence-guard/HOW.py — Enforces the Estate Model publish order.

The Estate Model has a hard dependency chain:
  1. Substack (source/honey pot) — must publish first
  2. LinkedIn Article (hub) — publishes AFTER Substack; body links to Substack URL
  3. LinkedIn Post (post_hub spoke) — publishes AFTER Article; first-comment links to Article URL
  4. All external spokes (X, Reddit, Instagram, Facebook) — publish AFTER Post Hub exists

This gate checks: if you are attempting to distribute a spoke/hub, are its
dependencies already live (status="published"/"live")?

Usage:
    python3 HOW.py '<json>'

Input JSON:
    {
      "campaign_file": "/abs/path/to/campaign.json",
      "target": "spoke-x-thread"        # spoke id, "hub", or "source"
                                          # omit target to check all readiness
    }

Exit:
    0 = PASS  (target's dependencies are satisfied — safe to publish target)
    1 = BLOCK (dependency not yet live — cannot publish target yet)
    2 = WARN  (cannot determine — campaign.json missing or malformed)

Stdout: JSON {"status": "pass|block|warn", "target": str, "blocking_deps": [...], "message": str}
"""

import json
import pathlib
import sys

LIVE_STATUSES = {"published", "live", "sent"}
PENDING_STATUSES = {"pending", "draft", "ready", "ready_for_review", "ready_to_publish", "scheduled"}


def out(code, status, target, blocking_deps, message):
    print(json.dumps({
        "status": status,
        "target": target,
        "blocking_deps": blocking_deps,
        "message": message
    }))
    sys.exit(code)


def get_status(obj):
    return (obj.get("status") or "").lower().strip()


def is_live(obj):
    return get_status(obj) in LIVE_STATUSES


def main():
    if len(sys.argv) < 2:
        out(2, "warn", "", [], "No input provided.")

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(1, "block", "", [], f"Invalid JSON: {e}")

    campaign_file = ctx.get("campaign_file", "")
    target_id = ctx.get("target", "")

    if not campaign_file:
        out(2, "warn", "", [], "campaign_file is required.")

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", "", [], f"campaign.json not found: {campaign_file}")

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", "", [], f"Cannot parse campaign.json: {e}")

    source = campaign.get("source", {})
    hub = campaign.get("hub", {})
    spokes = campaign.get("spokes", [])

    # Index spokes by id and role
    spoke_by_id = {s.get("id", ""): s for s in spokes}
    post_hub = next((s for s in spokes if s.get("role") == "post_hub"), None)

    # Define the dependency chain:
    # source → hub → post_hub → all other spokes
    def check_source():
        """No dependencies — source can always publish."""
        return []

    def check_hub():
        """Hub requires source to be live (needs Substack URL for body link)."""
        if not is_live(source):
            return [{"id": "source", "platform": source.get("platform", "substack"),
                     "status": get_status(source),
                     "reason": "Substack (source) must publish first — LinkedIn Article body links to it."}]
        return []

    def check_post_hub():
        """Post hub requires hub (Article) to be live (needs Article URL for first-comment)."""
        deps = []
        if not is_live(source):
            deps.append({"id": "source", "platform": source.get("platform", "substack"),
                         "status": get_status(source),
                         "reason": "Substack must be live before Post Hub."})
        if not is_live(hub):
            deps.append({"id": "hub", "platform": hub.get("platform", "linkedin"),
                         "type": hub.get("type", "article"),
                         "status": get_status(hub),
                         "reason": "LinkedIn Article must publish BEFORE Post Hub — first-comment needs Article URL."})
        return deps

    def check_spoke(spoke):
        """External spokes require post_hub to be live (they drive to it)."""
        spoke_id = spoke.get("id", "")
        role = spoke.get("role", "")
        if role == "post_hub":
            return check_post_hub()
        # All non-hub spokes need post_hub live
        deps = check_post_hub()
        if post_hub and not is_live(post_hub):
            ph_id = post_hub.get("id", "spoke-linkedin-post")
            ph_status = get_status(post_hub)
            # Avoid duplicating if already in deps from check_post_hub
            if not any(d.get("id") == ph_id for d in deps):
                deps.append({"id": ph_id, "platform": "linkedin", "type": "post",
                              "status": ph_status,
                              "reason": f"LinkedIn Post Hub must be live before {spoke_id} — all spokes drive to it."})
        return deps

    # Determine what to check
    if not target_id:
        # Check overall readiness — collect unique unsatisfied deps by id (first-seen wins)
        seen_dep_ids: dict = {}

        def _add_deps(deps):
            for d in deps:
                did = d.get("id", "")
                if did and did not in seen_dep_ids:
                    seen_dep_ids[did] = d

        _add_deps(check_hub())
        if post_hub:
            _add_deps(check_post_hub())
        for spoke in spokes:
            if spoke.get("role") == "post_hub":
                continue
            _add_deps(check_spoke(spoke))

        unsatisfied = list(seen_dep_ids.values())
        if unsatisfied:
            out(1, "block", "all", unsatisfied,
                f"BLOCK — {len(unsatisfied)} unsatisfied dependencies. Publish in Estate order: "
                f"Substack → LinkedIn Article → LinkedIn Post → Spokes.")
        else:
            out(0, "pass", "all", [],
                "PASS — All dependency constraints satisfied. Publish in Estate order.")

    elif target_id == "source":
        blocking = check_source()
        if blocking:
            out(1, "block", target_id, blocking, f"BLOCK — {target_id} has unsatisfied dependencies.")
        out(0, "pass", target_id, [], f"PASS — {target_id} has no dependencies. Safe to publish.")

    elif target_id == "hub":
        blocking = check_hub()
        if blocking:
            out(1, "block", target_id, blocking,
                f"BLOCK — LinkedIn Article cannot publish yet. Substack must publish first.")
        out(0, "pass", target_id, [], "PASS — Substack is live. Safe to publish LinkedIn Article.")

    elif target_id in spoke_by_id:
        spoke = spoke_by_id[target_id]
        blocking = check_spoke(spoke)
        if blocking:
            out(1, "block", target_id, blocking,
                f"BLOCK — {target_id} cannot publish yet. Unsatisfied dependencies.")
        out(0, "pass", target_id, [], f"PASS — All dependencies for {target_id} are live.")

    else:
        out(2, "warn", target_id, [],
            f"Unknown target '{target_id}'. Valid: 'source', 'hub', or a spoke id from campaign.json.")


if __name__ == "__main__":
    main()
