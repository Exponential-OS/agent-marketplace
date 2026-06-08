#!/usr/bin/env python3
"""validate-tracker-json.py — Validate job-pipeline-match-tracker.json against schema.

Pure Python stdlib — no jsonschema dep. Validates required fields, enum values,
id uniqueness, and date format.

Usage:
    python3 scripts/validate-tracker-json.py \
        --input career-intelligence/projects/job-search/job-pipeline-match-tracker.json

Exit: 0=valid, 1=invalid
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


DECISION_ENUM = {"FULL_INVEST", "APPLY", "CHECK_DELTA", "SKIP"}
STATUS_ENUM = {"QUEUED", "CHECK_DELTA", "SKIPPED", "APPLIED", "INTERVIEWING",
               "REJECTED", "DEAD", "OFFERED"}
QUALITY_ENUM = {"JD", "partial", "title-only", None}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED = {"id", "batch_date", "company", "role", "score", "decision", "status", "updated_at"}


def validate(rows: list) -> list[str]:
    errors: list[str] = []
    seen_ids: dict[int, int] = {}  # id → row index

    if not isinstance(rows, list):
        return ["Root must be a JSON array"]

    for i, row in enumerate(rows):
        prefix = f"Row {i}"

        if not isinstance(row, dict):
            errors.append(f"{prefix}: not an object")
            continue

        # Required fields
        for field in REQUIRED:
            if field not in row:
                errors.append(f"{prefix}: missing required field '{field}'")

        # id
        row_id = row.get("id")
        if row_id is not None:
            if not isinstance(row_id, int) or row_id < 1:
                errors.append(f"{prefix}: 'id' must be positive integer, got {row_id!r}")
            elif row_id in seen_ids:
                errors.append(f"{prefix}: duplicate id={row_id} (first at row {seen_ids[row_id]})")
            else:
                seen_ids[row_id] = i
            prefix = f"Row {i} (id={row_id})"

        # date fields
        for field in ("batch_date", "updated_at"):
            val = row.get(field)
            if val is not None and not DATE_RE.match(str(val)):
                errors.append(f"{prefix}: '{field}' must be YYYY-MM-DD, got {val!r}")

        # score
        score = row.get("score")
        if score is not None:
            if not isinstance(score, int) or score < 0 or score > 100:
                errors.append(f"{prefix}: 'score' must be 0-100 int or null, got {score!r}")

        # enum fields
        decision = row.get("decision")
        if decision not in DECISION_ENUM:
            errors.append(f"{prefix}: 'decision' must be one of {sorted(DECISION_ENUM)}, got {decision!r}")

        status = row.get("status")
        if status not in STATUS_ENUM:
            errors.append(f"{prefix}: 'status' must be one of {sorted(STATUS_ENUM)}, got {status!r}")

        quality = row.get("score_quality")
        if quality not in QUALITY_ENUM:
            errors.append(f"{prefix}: 'score_quality' must be one of {sorted(str(v) for v in QUALITY_ENUM)}, got {quality!r}")

        # company and role must be non-empty strings
        for field in ("company", "role"):
            val = row.get(field)
            if not isinstance(val, str) or not val.strip():
                errors.append(f"{prefix}: '{field}' must be non-empty string")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate match tracker JSON")
    parser.add_argument("--input", required=True, help="Path to .json file")
    args = parser.parse_args()

    path = Path(args.input).expanduser()
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 1

    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON: {e}", file=sys.stderr)
        return 1

    errors = validate(rows)

    if errors:
        print(f"INVALID: {len(errors)} error(s) found")
        for err in errors:
            print(f"  ✗ {err}")
        return 1

    print(f"VALID: {len(rows)} rows — all fields pass validation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
