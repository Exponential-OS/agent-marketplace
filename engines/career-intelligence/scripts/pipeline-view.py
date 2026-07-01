#!/usr/bin/env python3
"""
pipeline-view.py — On-demand formatted view of the job pipeline.

Replaces job-pipeline.md as the human-readable output surface.
Reads job-pipeline.json + job-pipeline-match-tracker.json and renders
formatted sections on demand.

Usage:
    python3 pipeline-view.py --career-home <path> [--section all|active|referrals|applied|queue] [--format text|json]

Exit: 0 always.
"""

import argparse
import json
import os
import sys
from datetime import date, datetime

# ── helpers ──────────────────────────────────────────────────────────────────

def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: could not load {path}: {e}", file=sys.stderr)
        return None


def today_str():
    return date.today().isoformat()


def days_since(date_str):
    if not date_str:
        return None
    try:
        d = date.fromisoformat(str(date_str).split("(")[0].strip())
        return (date.today() - d).days
    except ValueError:
        return None


def overdue_label(follow_up_str):
    if not follow_up_str:
        return ""
    try:
        fu = date.fromisoformat(str(follow_up_str).split("(")[0].strip())
        delta = (date.today() - fu).days
        if delta > 0:
            return f" ⚠ {delta}d OVERDUE"
        elif delta == 0:
            return " ← TODAY"
        else:
            return f" (in {abs(delta)}d)"
    except ValueError:
        return ""


def score_stars(score):
    if score is None:
        return ""
    if score >= 89:
        return "⭐⭐"
    if score >= 85:
        return "⭐"
    return ""


def extract_intro_badge(warm_path_str):
    if isinstance(warm_path_str, list):
        warm_path_str = warm_path_str[0] if warm_path_str else ""
    if not warm_path_str:
        return ""
    badge = str(warm_path_str).strip().splitlines()[0].strip()
    return "" if badge == "—" else badge


# CLI output cannot track intro_badge_clicked; gate any future interactive UI telemetry behind XOS-98.

# ── section renderers ─────────────────────────────────────────────────────────

def render_header(pipeline):
    sm = pipeline.get("search_mode", {})
    mode = sm.get("mode", "UNKNOWN")
    comp = sm.get("comp_floor_usd", 0)
    set_date = sm.get("set_date", "?")
    note = sm.get("note", "")
    icon = "🔥" if mode == "PANIC" else "🎯"
    print(f"\n{icon} SEARCH MODE: {mode} (set {set_date})")
    print(f"   Comp floor: ${comp:,}  |  {note}")


def render_referrals(pipeline):
    referrals = pipeline.get("pending_referrals", [])
    if not referrals:
        print("\nNo pending referrals.")
        return

    print("\n⏳ PENDING REFERRAL ASKS")
    print(f"{'Contact':<22} {'Role / Company':<36} {'Ch':<10} {'Sent':<12} {'Follow-up':<12} Status")
    print("-" * 110)

    for r in referrals:
        contact = r.get("contact", "—")
        role = r.get("role", "—")[:35]
        ch = r.get("channel", "—")
        sent = r.get("sent_date", "—")
        fu = r.get("follow_up_date") or "—"
        fu_label = fu + (overdue_label(fu) if fu != "—" else "")
        status = r.get("status", "—")
        status_note = r.get("status_note", "")

        if status == "dead":
            status_icon = "❌"
        elif status == "agreed_to_refer":
            status_icon = "✅"
        else:
            status_icon = "⏳"

        print(f"{contact:<22} {role:<36} {ch:<10} {sent:<12} {fu_label:<20} {status_icon} {status_note}")


def render_active(pipeline, tracker_data):
    stage_data = pipeline.get("stage_data", [])

    # build tracker lookup by id (flat list)
    tracker_by_id = {}
    if tracker_data and isinstance(tracker_data, list):
        for role in tracker_data:
            tid = role.get("id")
            if tid is not None:
                tracker_by_id[tid] = role

    active_stages = {"advancing", "panel_interview", "in_process", "recruiter_inbound"}
    active = [s for s in stage_data if s.get("stage") in active_stages]

    if not active:
        print("\nNo active applications with stage data.")
        return

    print("\n🔥 ACTIVE / ADVANCING")
    print("-" * 90)
    for s in active:
        tid = s.get("tracker_id")
        company = s.get("company", "—")
        role = s.get("role", "—")
        stage = s.get("stage", "—").replace("_", " ").upper()
        recruiter = s.get("recruiter") or s.get("hiring_manager") or "—"
        comp_note = s.get("comp_note", "")
        warm = s.get("warm_path", "")
        source = s.get("source", "")
        source_post = s.get("source_post", "")
        intro_badge = extract_intro_badge(warm)
        next_action = s.get("next_action", "")
        detail = s.get("stage_detail", "")

        id_label = f"#{tid}" if tid else "(no tracker ID)"
        score_str = ""
        if tid and tid in tracker_by_id:
            score = tracker_by_id[tid].get("score")
            score_str = f" {score}% {score_stars(score)}" if score else ""

        print(f"\n  {id_label} {company} — {role}{score_str}")
        print(f"     Stage: {stage}")
        if detail:
            print(f"     {detail}")
        if recruiter and recruiter != "—":
            print(f"     Recruiter/HM: {recruiter}")
        if comp_note:
            print(f"     Comp: {comp_note}")
        if intro_badge and intro_badge.lower() != "cold":
            print(f"     Intro: {intro_badge}")
        if source == "brand_inbound":
            source_label = "brand inbound"
            if source_post:
                source_label = f"{source_label} ({source_post})"
            print(f"     Source: {source_label}")
        if next_action:
            print(f"     → {next_action}")


def render_applied(pipeline, tracker_data):
    stage_data = pipeline.get("stage_data", [])

    # applied but not advancing
    applied_stages = {"applied", "deprioritized"}
    applied = [s for s in stage_data if s.get("stage") in applied_stages]

    tracker_by_id = {}
    if tracker_data and isinstance(tracker_data, list):
        for role in tracker_data:
            tid = role.get("id")
            if tid is not None:
                tracker_by_id[tid] = role

    if not applied:
        print("\nNo applied (non-advancing) stage data.")
        return

    print("\n📋 APPLIED (awaiting response)")
    print(f"{'ID':<6} {'Company':<20} {'Role':<40} {'Score':<8} {'Warm Path'}")
    print("-" * 100)

    for s in applied:
        tid = s.get("tracker_id")
        company = s.get("company", "—")[:19]
        role = s.get("role", "—")[:39]
        warm = extract_intro_badge(s.get("warm_path", "—")) or "—"
        stage = s.get("stage", "")

        score_str = ""
        if tid and tid in tracker_by_id:
            score = tracker_by_id[tid].get("score")
            score_str = f"{score}%" if score else "—"

        id_label = f"#{tid}" if tid else "—"
        dep_tag = " [DEPRIORITIZED]" if stage == "deprioritized" else ""

        print(f"{id_label:<6} {company:<20} {role:<40} {score_str:<8} {warm}{dep_tag}")


def render_queue(tracker_data):
    if not tracker_data:
        print("\nMatch tracker not loaded.")
        return

    apply_statuses = {"QUEUED", "APPLY", "FULL_INVEST"}
    queue = []
    roles = tracker_data if isinstance(tracker_data, list) else []
    for role in roles:
        decision = role.get("decision", "")
        status = role.get("status", "")
        score = role.get("score")
        if decision in apply_statuses or status in apply_statuses:
            if status not in ("APPLIED", "REJECTED", "SKIPPED", "DEAD"):
                queue.append(role)

    if not queue:
        print("\nNo roles in apply queue.")
        return

    queue.sort(key=lambda r: -(r.get("score") or 0))

    print("\n🎯 APPLY QUEUE (scored, not yet applied)")
    print(f"{'#':<6} {'Company':<22} {'Role':<42} {'Score':<8} {'Warm'}")
    print("-" * 100)

    for r in queue[:20]:
        tid = r.get("id", "—")
        company = (r.get("company") or "—")[:21]
        role = (r.get("role") or "—")[:41]
        score = r.get("score")
        score_str = f"{score}% {score_stars(score)}" if score else "—"
        warm = r.get("warm_path") or r.get("warm_path_note") or "—"
        warm = (extract_intro_badge(warm) or "—")[:30]
        print(f"#{tid:<5} {company:<22} {role:<42} {score_str:<8} {warm}")

    if len(queue) > 20:
        print(f"  ... and {len(queue) - 20} more (--section all for full list)")


def render_summary(pipeline, tracker_data):
    if not tracker_data:
        return

    counts = {}
    roles = tracker_data if isinstance(tracker_data, list) else []
    for role in roles:
        status = role.get("status", "UNKNOWN")
        counts[status] = counts.get(status, 0) + 1

    total = sum(counts.values())
    applied = counts.get("APPLIED", 0)
    rejected = counts.get("REJECTED", 0)
    interviewing = counts.get("INTERVIEWING", 0)
    offered = counts.get("OFFERED", 0)
    queued = counts.get("QUEUED", 0)
    skipped = counts.get("SKIPPED", 0)

    resp_rate = round((rejected + interviewing + offered) / max(applied, 1) * 100)

    print("\n📊 PIPELINE SUMMARY")
    print(f"   Total tracked: {total}  |  Applied: {applied}  |  Response rate: {resp_rate}%")
    print(f"   Interviewing: {interviewing}  |  Offered: {offered}  |  Rejected: {rejected}  |  Queued: {queued}  |  Skipped: {skipped}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Pipeline view — formatted output from JSON sources")
    parser.add_argument("--career-home", default=os.environ.get("CAREER_HOME") or os.environ.get("CAREER_OS_HOME") or "")
    parser.add_argument("--section", choices=["all", "active", "referrals", "applied", "queue", "summary"],
                        default="all")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args()

    career_home = args.career_home
    pipeline_path = os.path.join(career_home, "career-intelligence/projects/job-search/job-pipeline.json")
    tracker_path = os.path.join(career_home, "career-intelligence/projects/job-search/job-pipeline-match-tracker.json")

    pipeline = load_json(pipeline_path)
    tracker_data = load_json(tracker_path)

    if pipeline is None:
        print(f"ERROR: {pipeline_path} not found. Run migration first.", file=sys.stderr)
        sys.exit(1)

    if args.format == "json":
        out = {}
        if args.section in ("all", "referrals"):
            out["pending_referrals"] = pipeline.get("pending_referrals", [])
        if args.section in ("all", "active"):
            out["stage_data_active"] = [s for s in pipeline.get("stage_data", [])
                                         if s.get("stage") in {"advancing", "panel_interview", "in_process", "recruiter_inbound"}]
        if args.section in ("all", "applied"):
            out["stage_data_applied"] = [s for s in pipeline.get("stage_data", [])
                                          if s.get("stage") in {"applied", "deprioritized"}]
        print(json.dumps(out, indent=2))
        return

    print(f"━━━ Career OS: Pipeline View ━━━  [{today_str()}]")

    if args.section in ("all", "summary"):
        render_summary(pipeline, tracker_data)

    render_header(pipeline)

    if args.section in ("all", "active"):
        render_active(pipeline, tracker_data)

    if args.section in ("all", "referrals"):
        render_referrals(pipeline)

    if args.section in ("all", "applied"):
        render_applied(pipeline, tracker_data)

    if args.section in ("all", "queue"):
        render_queue(tracker_data)

    print()


if __name__ == "__main__":
    main()
