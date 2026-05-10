#!/usr/bin/env python3
"""
HOW.py — content-format-check enforcement (Python entry point).

Thin wrapper that delegates to check.py (where the logic lives) and:
  - reads context from stdin (when $1 == "-") or sys.argv[1]
  - logs the result to ~/.cyborg-enforcement-log.jsonl
  - prints the JSON result on stdout
  - exits with check.py's return code (0=PASS, 1=BLOCK, 2=WARN)

Replaces HOW.sh. Same input/output contract.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
SLUG = SCRIPT_DIR.name
LOG_PATH = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"


def _read_context() -> str:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        return sys.stdin.read().strip()
    return sys.argv[1]


def main() -> int:
    context_raw = _read_context()
    if not context_raw:
        msg = {
            "verdict": "BLOCK",
            "reason": (
                "No input. Pass JSON: "
                '{"text":"...","platform":"substack|linkedin|twitter|reddit|instagram"}'
            ),
        }
        print(json.dumps(msg))
        return 1

    # Validate JSON early so check.py never receives garbage.
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
    log_record = {"timestamp": ts, "rule": SLUG, "result": parsed}
    try:
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(log_record) + "\n")
    except OSError:
        pass

    sys.stdout.write(out)
    if proc.stderr:
        sys.stderr.write(proc.stderr)

    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
