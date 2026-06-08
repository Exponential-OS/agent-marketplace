#!/usr/bin/env python3
"""
people-followup-query.py — Scan network/people/ for contacts with
follow_up dates due within a window.

Reads *.json people files (migrated from .md in v0.37.0). Falls back to
parsing YAML frontmatter from *.md for any file not yet migrated.
Used by Mission Control to drive the "Warm Contacts — Action Needed" section.

Usage:
    python3 people-followup-query.py --people-dir <path> [--days 7] [--format table|json]

Exit: 0 always (empty output = no contacts due)
"""

import argparse
import json
import os
import sys
from datetime import date, timedelta

try:
    import yaml
except ImportError:
    yaml = None


def load_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def parse_md_frontmatter(path):
    """Fallback for .md files not yet migrated to .json."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return None
    if not content.startswith("---"):
        return None
    end = content.find("\n---", 3)
    if end == -1:
        return None
    fm_text = content[3:end].strip()
    if yaml:
        try:
            return yaml.safe_load(fm_text)
        except Exception:
            pass
    data = {}
    for line in fm_text.splitlines():
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            key, _, val = line.partition(":")
            data[key.strip()] = val.strip().strip('"').strip("'")
    return data


def parse_date(val):
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip().split("(")[0].strip().split(" ")[0].strip()
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def scan(people_dir, days_ahead):
    today = date.today()
    cutoff = today + timedelta(days=days_ahead)
    results = []
    seen_slugs = set()

    for fname in sorted(os.listdir(people_dir)):
        record = None
        slug = None

        if fname.endswith(".json"):
            slug = fname[:-5]
            record = load_json_file(os.path.join(people_dir, fname))
        elif fname.endswith(".md") and not fname.endswith(".bak"):
            slug = fname[:-3]
            if slug in seen_slugs:
                continue  # .json version already processed
            record = parse_md_frontmatter(os.path.join(people_dir, fname))

        if not record or slug is None:
            continue
        seen_slugs.add(slug)

        follow_up = parse_date(record.get("follow_up"))
        if follow_up is None or follow_up > cutoff:
            continue

        last_contact = parse_date(record.get("last_contact"))
        companies = record.get("companies", [])
        if isinstance(companies, list) and companies:
            company = str(companies[0]).split("(")[0].strip()
        elif companies and companies not in ({}, []):
            company = str(companies).split("(")[0].strip()
        else:
            # Fall back to singular "company" field (some files use this schema)
            company = str(record.get("company", "—")).split("(")[0].strip() or "—"

        channel = record.get("channel", "—")
        name = record.get("name", slug)

        conv = record.get("conversation_history", {})
        summary = ""
        if isinstance(conv, dict):
            summary = conv.get("last_message_summary", "")
        if not summary:
            summary = str(record.get("context", ""))[:80]

        overdue = (today - follow_up).days if follow_up < today else 0

        results.append({
            "name": name,
            "company": company,
            "channel": channel,
            "follow_up": str(follow_up),
            "last_contact": str(last_contact) if last_contact else "—",
            "overdue_days": overdue,
            "summary": str(summary)[:80] if summary else "—",
            "file": fname,
        })

    results.sort(key=lambda r: r["follow_up"])
    return results


def render_table(results, today):
    if not results:
        print("No contacts due in this window.")
        return
    print(f"WARM CONTACTS — ACTION NEEDED (as of {today})")
    print()
    print(f"{'Contact':<24} {'Company':<22} {'Ch':<10} {'Follow-up':<12} {'Status':<18} Last Context")
    print("-" * 112)
    for r in results:
        if r["overdue_days"] > 0:
            status = f"⚠ {r['overdue_days']}d overdue"
        elif r["follow_up"] == str(today):
            status = "due today"
        else:
            status = "upcoming"
        print(
            f"{r['name']:<24} {r['company']:<22} {r['channel']:<10} "
            f"{r['follow_up']:<12} {status:<18} {r['summary']}"
        )


def main():
    parser = argparse.ArgumentParser(description="People follow-up query")
    parser.add_argument("--people-dir", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--format", choices=["table", "json"], default="table")
    args = parser.parse_args()

    if not os.path.isdir(args.people_dir):
        print(f"ERROR: people-dir not found: {args.people_dir}", file=sys.stderr)
        sys.exit(1)

    results = scan(args.people_dir, args.days)
    if args.format == "json":
        print(json.dumps(results, indent=2))
    else:
        render_table(results, date.today())


if __name__ == "__main__":
    main()
