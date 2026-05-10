#!/usr/bin/env python3
"""
HOW.py — biographical-claim pre-write hook (Python entry point).

Replaces HOW.sh.

Fires BEFORE any draft destined for a real human (T4 outreach, biographical
pitch, resume blurb, warm-intro packet, public artifact making claims about
a Cyborg user's experience). Greps the draft for proper-noun + role + tenure
+ count + scale claims and verifies each one has an anchor in the named
canonical source(s).

Input JSON (stdin or argv):
  {
    "draft_path": "/path/to/draft.md",
    "canonical_sources": ["/path/to/canonical.md"],
    "stakes": "T4"
  }

Output JSON: verdict + claim accounting.
Exit:   0=PASS  1=BLOCK  2=WARN
"""

from __future__ import annotations

import datetime
import json
import os
import pathlib
import re
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
SLUG = SCRIPT_DIR.name
LOG_PATH = pathlib.Path.home() / ".career-os-enforcement-log.jsonl"
_career_os_home = pathlib.Path(os.environ.get("CAREER_OS_HOME", str(pathlib.Path.home() / "anand-career-os")))
DEFAULT_CANONICAL = _career_os_home / "brain" / "identity" / "experience-history.md"

# --- Claim patterns (heuristic, high-recall — agent confirms unanchored hits) ---

PATTERNS = [
    (
        "tenure",
        re.compile(r"\b\d+(?:\.\d+)?\s*(?:yr|yrs|year|years|mo|month|months)\b"),
    ),
    (
        "report_count",
        re.compile(
            r"\b\d+\s*(?:report|reports|engineer|engineers|direct|direct[\.\-]report|eng[^a-z])"
        ),
    ),
    (
        "scale",
        re.compile(r"\$\d+(?:\.\d+)?\s*[BKMbkm]\b"),
    ),
    (
        "date_range",
        re.compile(
            r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}"
            r"\s*[-–—to]+\s*"
            r"(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\d{4}"
        ),
    ),
    (
        "role_title",
        re.compile(
            r"\b(?:L\d+|Senior|Sr\.|Director|Head of|VP|Chief|Lead|Principal|Manager|SDM|Engineering Manager|SEM)\b"
            r".{0,80}\b(?:at|@)\s+[A-Z][A-Za-z]+"
        ),
    ),
]

NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
CAP_WORD_RE = re.compile(r"\b[A-Z][A-Za-z]{2,}\b")


def _read_context() -> str:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        return sys.stdin.read().strip()
    return sys.argv[1]


def _expand(p: str) -> pathlib.Path:
    return pathlib.Path(os.path.expanduser(p))


def _emit_and_log(payload: dict, log_extra: dict, exit_code: int) -> int:
    print(json.dumps(payload, separators=(",", ":")))
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rec = {"ts": ts, "rule_slug": SLUG, "script_type": "HOW"}
    rec.update(log_extra)
    try:
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass
    return exit_code


def _extract_claims(draft_text: str) -> list[tuple[str, int, str]]:
    out: list[tuple[str, int, str]] = []
    for line_no, line in enumerate(draft_text.splitlines(), 1):
        for kind, pat in PATTERNS:
            if pat.search(line):
                out.append((kind, line_no, line))
    return out


def _is_anchored(phrase: str, canonical_texts: list[str]) -> int:
    """Return: 1 = anchored, 0 = unanchored, 2 = no distinctive tokens (WARN)."""
    numbers = NUMBER_RE.findall(phrase)[:3]
    words = CAP_WORD_RE.findall(phrase)[:3]
    if not numbers and not words:
        return 2

    first_num = numbers[0] if numbers else None
    first_word = words[0] if words else None

    for canon in canonical_texts:
        num_hit = True if first_num is None else bool(
            re.search(rf"\b{re.escape(first_num)}\b", canon)
        )
        word_hit = True if first_word is None else bool(
            re.search(rf"\b{re.escape(first_word)}\b", canon, re.IGNORECASE)
        )
        if num_hit and word_hit:
            return 1
    return 0


def main() -> int:
    raw = _read_context() or "{}"
    try:
        ctx = json.loads(raw)
    except json.JSONDecodeError as e:
        return _emit_and_log(
            {"verdict": "BLOCK", "reason": f"Invalid JSON: {e}"},
            {"verdict": "BLOCK", "reason": "invalid-json"},
            1,
        )

    draft_path_raw = ctx.get("draft_path") or ""
    stakes = ctx.get("stakes", "T4")
    canonical_sources_raw = ctx.get("canonical_sources") or []

    if not draft_path_raw:
        return _emit_and_log(
            {"verdict": "BLOCK", "tier": stakes, "reason": "no draft_path provided"},
            {"verdict": "BLOCK", "stakes": stakes, "reason": "missing draft_path"},
            1,
        )

    draft_path = _expand(draft_path_raw)
    if not draft_path.is_file():
        return _emit_and_log(
            {
                "verdict": "BLOCK",
                "tier": stakes,
                "reason": f"draft_path not found: {draft_path}",
            },
            {"verdict": "BLOCK", "stakes": stakes, "reason": "draft missing"},
            1,
        )

    canonical_paths = [
        _expand(p) for p in canonical_sources_raw
    ] or [DEFAULT_CANONICAL]

    missing = [str(p) for p in canonical_paths if not p.is_file()]
    if missing:
        return _emit_and_log(
            {
                "verdict": "BLOCK",
                "tier": stakes,
                "reason": "canonical source(s) missing",
                "missing": missing,
            },
            {"verdict": "BLOCK", "stakes": stakes, "reason": "canonical missing"},
            1,
        )

    try:
        draft_text = draft_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return _emit_and_log(
            {"verdict": "BLOCK", "tier": stakes, "reason": f"cannot read draft: {e}"},
            {"verdict": "BLOCK", "stakes": stakes, "reason": "draft read error"},
            1,
        )

    canonical_texts: list[str] = []
    for p in canonical_paths:
        try:
            canonical_texts.append(p.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            canonical_texts.append("")

    claims = _extract_claims(draft_text)
    claims_total = len(claims)
    claims_anchored = 0
    unanchored: list[dict] = []

    for kind, ln, phrase in claims:
        anchored = _is_anchored(phrase, canonical_texts)
        if anchored == 1:
            claims_anchored += 1
        else:
            safe_phrase = re.sub(r'[\\\"\t]', "", phrase)[:200]
            unanchored.append({"text": safe_phrase, "pattern": kind, "line": ln})

    unanchored_count = claims_total - claims_anchored
    if claims_total == 0 or unanchored_count == 0:
        verdict, exit_code, next_action = "PASS", 0, "ship"
    else:
        verdict, exit_code, next_action = "BLOCK", 1, "abort-and-recheck-canonical"

    payload = {
        "verdict": verdict,
        "tier": stakes,
        "draft_path": str(draft_path),
        "canonical_sources": [str(p) for p in canonical_paths],
        "claims_total": claims_total,
        "claims_anchored": claims_anchored,
        "claims_unanchored": unanchored,
        "next_action": next_action,
    }
    log_extra = {
        "verdict": verdict,
        "stakes": stakes,
        "draft_path": str(draft_path),
        "claims_total": claims_total,
        "claims_anchored": claims_anchored,
        "claims_unanchored": unanchored_count,
        "next_action": next_action,
    }
    return _emit_and_log(payload, log_extra, exit_code)


if __name__ == "__main__":
    sys.exit(main())
