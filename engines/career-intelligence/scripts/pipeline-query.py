#!/usr/bin/env python3
"""pipeline-query.py — Career OS Pipeline Query Tool.

Reads job-pipeline-match-tracker.json and outputs a filtered, sorted view.
Pure Python stdlib — zero pip dependencies.

Usage:
    python3 pipeline-query.py [options]

Options:
    --tracker-path PATH     Path to match-tracker.json  [required or $CAREER_HOME/brain/...]
    --min-score N           Minimum score (default: 80)
    --decision TIER         Filter by decision: FULL_INVEST, APPLY, CHECK_DELTA, SKIP
    --company NAME          Fuzzy company name filter
    --batch DATE            Filter by batch_date (YYYY-MM-DD) or "latest"
    --status STATUS         Filter by status
    --include-closed        Include terminal statuses (DEAD, SKIPPED, REJECTED)
    --lookup ID             Look up one role by id or fuzzy name; exits after printing
    --format table|json     Output format (default: table)
    --self-test             Run built-in smoke test against bundled fixture; exit 0=pass

Decision display order: FULL_INVEST → APPLY → CHECK_DELTA → SKIP
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DECISION_ORDER = ["FULL_INVEST", "APPLY", "CHECK_DELTA", "SKIP"]
DECISION_LABEL = {
    "FULL_INVEST": "⭐ FULL INVEST",
    "APPLY":       "✅ APPLY",
    "CHECK_DELTA": "⏳ CHECK DELTA",
    "SKIP":        "⏭️  SKIP",
}
QUALITY_LABEL = {
    "JD":         "✅ JD",
    "partial":    "🔄 partial",
    "title-only": "⚠️  title-only",
    None:         "",
}
TERMINAL_STATUSES = {"DEAD", "SKIPPED", "REJECTED"}


def _default_tracker() -> Path:
    home = os.environ.get("CAREER_HOME") or os.environ.get("CAREER_OS_HOME") or ""
    return Path(home) / "brain" / "projects" / "job-search" / "job-pipeline-match-tracker.json"


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def _fuzzy_match(text: str, query: str) -> bool:
    return query.lower() in text.lower()


def filter_rows(rows: list[dict], args: argparse.Namespace) -> list[dict]:
    results = list(rows)

    if not args.include_closed:
        results = [r for r in results if r.get("status") not in TERMINAL_STATUSES]

    if args.min_score is not None:
        results = [r for r in results if (r.get("score") or 0) >= args.min_score]

    if args.decision:
        tiers = {d.strip().upper() for d in args.decision.split(",")}
        results = [r for r in results if r.get("decision") in tiers]

    if args.company:
        results = [r for r in results if _fuzzy_match(r.get("company", ""), args.company)]

    if args.batch:
        if args.batch == "latest":
            if results:
                latest = max(r.get("batch_date", "") for r in results)
                results = [r for r in results if r.get("batch_date") == latest]
        else:
            results = [r for r in results if r.get("batch_date") == args.batch]

    if args.status:
        statuses = {s.strip().upper() for s in args.status.split(",")}
        results = [r for r in results if r.get("status") in statuses]

    return results


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------

def sort_rows(rows: list[dict]) -> list[dict]:
    def key(r: dict) -> tuple:
        dec_rank = DECISION_ORDER.index(r["decision"]) if r.get("decision") in DECISION_ORDER else 99
        score = -(r.get("score") or 0)
        return (dec_rank, score)
    return sorted(rows, key=key)


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

def lookup_row(rows: list[dict], ref: str) -> list[dict]:
    if ref.isdigit():
        return [r for r in rows if r.get("id") == int(ref)]
    return [r for r in rows
            if _fuzzy_match(r.get("company", ""), ref)
            or _fuzzy_match(r.get("role", ""), ref)]


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _format_score(row: dict) -> str:
    score = row.get("score")
    quality = row.get("score_quality")
    q_label = QUALITY_LABEL.get(quality, "")
    s = f"{score}%" if score is not None else "?%"
    return f"{s} {q_label}".strip()


def _trunc(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n - 1] + "…"


def render_table(rows: list[dict]) -> str:
    if not rows:
        return "(no rows match the filter)"

    lines = []
    current_dec = None

    for row in rows:
        dec = row.get("decision", "?")
        if dec != current_dec:
            current_dec = dec
            label = DECISION_LABEL.get(dec, dec)
            lines.append(f"\n{'─' * 62}")
            lines.append(f"  {label}")
            lines.append(f"{'─' * 62}")

        row_id = row.get("id", "?")
        company = _trunc(row.get("company", "?"), 22)
        role = _trunc(row.get("role", "?"), 38)
        score_str = _format_score(row)
        warm = row.get("warm_path") or "Cold"
        status = row.get("status", "?")

        lines.append(f"  #{row_id:<4} {company:<22} {score_str:<20} {status:<14} {warm}")
        lines.append(f"         {role}")

    lines.append("")
    lines.append(f"  {len(rows)} role(s) shown")
    return "\n".join(lines)


def render_json(rows: list[dict]) -> str:
    return json.dumps(rows, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

_FIXTURE: list[dict] = [
    {"id": 1, "batch_date": "2026-01-01", "batch_context": "test", "company": "Acme",
     "role": "EM Platform", "score": 90, "score_quality": "JD", "decision": "FULL_INVEST",
     "resume_track": "Eng Leader", "warm_path": "Cold", "jd_url": None,
     "status": "QUEUED", "updated_at": "2026-01-01"},
    {"id": 2, "batch_date": "2026-01-01", "batch_context": "test", "company": "Beta Corp",
     "role": "Director AI", "score": 82, "score_quality": "partial", "decision": "APPLY",
     "resume_track": "Exec", "warm_path": "Alice", "jd_url": "https://example.com/job/2",
     "status": "APPLIED", "updated_at": "2026-01-01"},
    {"id": 3, "batch_date": "2026-01-02", "batch_context": "test", "company": "Closed Inc",
     "role": "SEM Data", "score": 70, "score_quality": "title-only", "decision": "CHECK_DELTA",
     "resume_track": None, "warm_path": "Cold", "jd_url": None,
     "status": "DEAD", "updated_at": "2026-01-02"},
]


def run_self_test() -> int:
    errors: list[str] = []

    # default filter: min_score=80, exclude terminal (DEAD/SKIPPED/REJECTED)
    # id=1: QUEUED/FULL_INVEST/90% → PASS; id=2: APPLIED/APPLY/82% → PASS; id=3: DEAD/70% → FAIL
    args = argparse.Namespace(
        min_score=80, decision=None, company=None, batch=None,
        status=None, include_closed=False, lookup=None, format="table",
    )
    f = filter_rows(_FIXTURE, args)
    if len(f) != 2 or {r["id"] for r in f} != {1, 2}:
        errors.append(f"default filter: expected ids={{1,2}}, got {[r['id'] for r in f]}")

    # include_closed: all 3 rows have score ≥ 80 check … id=3 score=70 still excluded by min_score
    args.include_closed = True
    f2 = filter_rows(_FIXTURE, args)
    if len(f2) != 2:
        errors.append(f"include_closed (min_score=80): expected 2, got {len(f2)}")

    # include_closed + min_score=0 → all 3
    args.min_score = 0
    f2b = filter_rows(_FIXTURE, args)
    if len(f2b) != 3:
        errors.append(f"include_closed+min_score=0: expected 3, got {len(f2b)}")

    # company fuzzy
    args.include_closed = False
    args.company = "beta"
    args.min_score = 0
    f3 = filter_rows(_FIXTURE, args)
    if not any(r["id"] == 2 for r in f3):
        errors.append("company fuzzy: id=2 not found for 'beta'")

    # lookup by id
    m = lookup_row(_FIXTURE, "1")
    if not m or m[0]["id"] != 1:
        errors.append(f"lookup id=1 failed: {m}")

    # lookup by name
    m2 = lookup_row(_FIXTURE, "Acme")
    if not m2 or m2[0]["id"] != 1:
        errors.append(f"lookup name 'Acme' failed: {m2}")

    # sort order: FULL_INVEST before APPLY
    sorted_rows = sort_rows(_FIXTURE[:2])
    if sorted_rows[0]["decision"] != "FULL_INVEST":
        errors.append(f"sort: expected FULL_INVEST first, got {sorted_rows[0]['decision']}")

    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1

    print("self-test: all checks passed")
    return 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Career OS pipeline query")
    parser.add_argument("--tracker-path", help="Path to match-tracker.json")
    parser.add_argument("--min-score", type=int, default=80)
    parser.add_argument("--decision", help="Comma-separated: FULL_INVEST,APPLY,CHECK_DELTA,SKIP")
    parser.add_argument("--company", help="Fuzzy company name")
    parser.add_argument("--batch", help="YYYY-MM-DD or 'latest'")
    parser.add_argument("--status", help="Comma-separated status values")
    parser.add_argument("--include-closed", action="store_true")
    parser.add_argument("--lookup", help="Row id or fuzzy name")
    parser.add_argument("--format", choices=["table", "json"], default="table")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()

    tracker_path = Path(args.tracker_path).expanduser() if args.tracker_path else _default_tracker()

    if not tracker_path.exists():
        print(f"Match tracker not found: {tracker_path}", file=sys.stderr)
        print("Run: python3 scripts/migrate-tracker-to-json.py --input <md-file> --output <json-file>",
              file=sys.stderr)
        return 1

    try:
        rows = json.loads(tracker_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"Invalid JSON in {tracker_path}: {e}", file=sys.stderr)
        return 1

    if args.lookup:
        matches = lookup_row(rows, args.lookup)
        if not matches:
            print(f"No match for: {args.lookup}")
            return 0
        if len(matches) > 1 and not args.format == "json":
            print(f"Multiple matches ({len(matches)}):")
            for r in matches:
                print(f"  #{r['id']} {r['company']} — {r['role']} ({r.get('score')}%)")
            return 0
        if args.format == "json":
            print(render_json(matches))
        else:
            print(render_table(sort_rows(matches)))
        return 0

    filtered = filter_rows(rows, args)
    sorted_rows = sort_rows(filtered)

    if args.format == "json":
        print(render_json(sorted_rows))
    else:
        print(render_table(sorted_rows))

    return 0


if __name__ == "__main__":
    sys.exit(main())
