#!/usr/bin/env python3
"""
cyborg-db — Unified CLI for the Career-OS memory substrate (Dolt-first, .md fallback).

Skills + shell scripts hit this thin wrapper instead of parsing markdown directly.
Falls back to .md automatically when the Dolt container is unreachable, so the
runtime stays zero-breakage regardless of DB state.

Examples:
    cyborg-db status                                  # show backend + row counts
    cyborg-db roles --min-score 85                    # highest-scored roles
    cyborg-db roles --decision FULL_INVEST            # strategic roles only
    cyborg-db applications --section active           # live pipeline
    cyborg-db stories --count                         # just the number (for brain render)
    cyborg-db stories --category google               # filtered list
    cyborg-db skills --category languages             # skill slice
    cyborg-db people --warmth-min 4                   # warm-path-capable contacts
    cyborg-db identity strategy                       # fetch career-strategy body
    cyborg-db scoring jd_alignment                    # fetch JD-alignment framework
    cyborg-db --format json roles --min-score 90      # machine-readable
    cyborg-db --backend md status                     # force markdown backend
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "dev"))

try:
    from memory_adapter import Adapter, AdapterUnreachable  # type: ignore
except ImportError as e:
    print(f"ERROR: memory_adapter not importable: {e}", file=sys.stderr)
    print("Hint: ensure career-os-plugin/dev/memory_adapter.py exists and PYTHONPATH covers it.",
          file=sys.stderr)
    sys.exit(3)


def _out(obj, fmt):
    if fmt == "json":
        print(json.dumps(obj, indent=2, default=str))
        return
    # tabular (default): compact columnar print
    if isinstance(obj, dict):
        for k, v in obj.items():
            print(f"{k:24s} {v}")
        return
    if isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict):
                # pick a sensible line layout
                if "score" in item and "company" in item:
                    print(f"{item.get('score') or '??':>3} | "
                          f"{item.get('company', ''):30s} | "
                          f"{(item.get('role_title') or '')[:60]}")
                elif "section" in item and "company" in item:
                    print(f"{(item.get('section') or ''):12s} | "
                          f"{item.get('company', ''):30s} | "
                          f"{(item.get('role_title') or '')[:50]}")
                elif "skill" in item:
                    print(f"{(item.get('category') or ''):16s} | "
                          f"{item.get('skill', ''):24s} | "
                          f"{(item.get('proficiency') or ''):20s} | "
                          f"{(item.get('recency') or '')}")
                elif "warmth" in item and "name" in item:
                    print(f"{(item.get('warmth') or '?'):>2} | "
                          f"{item.get('name', ''):28s} | "
                          f"{(item.get('company') or '')[:40]}")
                else:
                    print(item)
            else:
                print(item)
        return
    print(obj)


def cmd_status(a: Adapter, args):
    h = a.healthcheck()
    d = asdict(h)
    _out(d, args.format)


def cmd_roles(a: Adapter, args):
    rows = [r.to_dict() for r in a.list_roles(
        decision=args.decision, min_score=args.min_score, company=args.company)]
    _out(rows, args.format)
    if args.format != "json":
        print(f"... total={len(rows)}", file=sys.stderr)


def cmd_applications(a: Adapter, args):
    rows = [asdict(x) for x in a.list_applications(
        section=args.section, status=args.status, company=args.company)]
    _out(rows, args.format)
    if args.format != "json":
        print(f"... total={len(rows)}", file=sys.stderr)


def cmd_stories(a: Adapter, args):
    if args.count:
        n = a.count_stories_recursive()
        _out({"count": n}, args.format)
        return
    rows = [asdict(s) for s in a.list_stories(category=args.category)]
    _out(rows, args.format)


def cmd_skills(a: Adapter, args):
    rows = [asdict(s) for s in a.list_skills(category=args.category)]
    _out(rows, args.format)


def cmd_people(a: Adapter, args):
    rows = [asdict(p) for p in a.list_people(warmth_min=args.warmth_min)]
    _out(rows, args.format)


def cmd_identity(a: Adapter, args):
    row = a.get_identity(args.key)
    if not row:
        print(f"identity key not found: {args.key}", file=sys.stderr)
        sys.exit(1)
    if args.format == "json":
        _out(row, "json")
    else:
        print(row["body_md"])


def cmd_scoring(a: Adapter, args):
    row = a.get_scoring_metadata(args.key)
    if not row:
        print(f"scoring_metadata key not found: {args.key}", file=sys.stderr)
        sys.exit(1)
    if args.format == "json":
        _out(row, "json")
    else:
        print(row["body_md"])


def main():
    ap = argparse.ArgumentParser(prog="cyborg-db",
                                 description="Dolt-canonical memory CLI (v0.21.0+).")
    ap.add_argument("--format", choices=["table", "json"], default="table")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="health + row counts")

    p = sub.add_parser("roles", help="scored job opportunities")
    p.add_argument("--min-score", type=int, default=None)
    p.add_argument("--decision", default=None)
    p.add_argument("--company", default=None)

    p = sub.add_parser("applications", help="pipeline applications")
    p.add_argument("--section", default=None,
                   help="active | warm_intros | inactive | rejected | inactive_rejected")
    p.add_argument("--status", default=None, help="substring match on status column")
    p.add_argument("--company", default=None)

    p = sub.add_parser("stories", help="STAR stories")
    p.add_argument("--count", action="store_true")
    p.add_argument("--category", default=None)

    p = sub.add_parser("skills", help="skills matrix rows")
    p.add_argument("--category", default=None)

    p = sub.add_parser("people", help="contacts from brain layer")
    p.add_argument("--warmth-min", type=int, default=None)

    p = sub.add_parser("identity", help="identity/brand/strategy doc")
    p.add_argument("key", choices=["identity", "brand", "experience", "professional-brand", "strategy"])

    p = sub.add_parser("scoring", help="scoring framework / ATS rules / resume guide")
    p.add_argument("key", choices=["jd_alignment", "ats_rules", "resume_guide"])

    args = ap.parse_args()
    try:
        a = Adapter()
    except AdapterUnreachable as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("Start Dolt:  docker start cyborg-brain-db", file=sys.stderr)
        sys.exit(2)

    cmds = {
        "status": cmd_status, "roles": cmd_roles, "applications": cmd_applications,
        "stories": cmd_stories, "skills": cmd_skills, "people": cmd_people,
        "identity": cmd_identity, "scoring": cmd_scoring,
    }
    try:
        cmds[args.cmd](a, args)
    finally:
        a.close()


if __name__ == "__main__":
    main()
