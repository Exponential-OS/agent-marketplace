#!/usr/bin/env python3
"""
HOW.py — image-brand-completeness-gate enforcement (entry point).

Checks that every image template contains:
  1. All required brand handles from brand-spec.json (BLOCK if missing)
  2. A substantive SVG visual element (BLOCK if text-only — "pictures > words")

Usage:
  python3 HOW.py '{"html_file": "/abs/path/template.html"}'
  python3 HOW.py '{"html_file": "/abs/path/template.html", "brand_spec": "/path/brand-spec.json"}'
"""
from __future__ import annotations

import datetime
import json
import pathlib
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
SLUG = SCRIPT_DIR.name
LOG_PATH = pathlib.Path.home() / ".career-os-enforcement-log.jsonl"


def _read_context() -> str:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        return sys.stdin.read().strip()
    return sys.argv[1]


def main() -> int:
    context_raw = _read_context()
    if not context_raw:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": "No input.",
            "remediation": "Pass JSON with html_file field (absolute path to HTML template).",
        }))
        return 1

    try:
        json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON: {e}"}))
        return 1

    proc = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "check.py"), context_raw],
        capture_output=True,
        text=True,
    )

    out = proc.stdout
    try:
        parsed = json.loads(out) if out.strip() else {"raw": out}
    except json.JSONDecodeError:
        parsed = {"raw": out}

    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with LOG_PATH.open("a") as f:
            f.write(json.dumps({"timestamp": ts, "rule": SLUG, "result": parsed}) + "\n")
    except OSError:
        pass

    sys.stdout.write(out)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
