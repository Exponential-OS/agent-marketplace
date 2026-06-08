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
_career_home_raw = os.environ.get("CAREER_HOME") or os.environ.get("CAREER_OS_HOME")
_career_home = pathlib.Path(_career_home_raw).expanduser() if _career_home_raw else None
DEFAULT_CANONICAL = (_career_home / "brain" / "identity" / "experience-history.md") if _career_home else pathlib.Path("/nonexistent/career-home-not-set")

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
        # bare scale/throughput units without a $ prefix: "50M events", "1M TPS",
        # "180k", "10M+ shipments", "3x latency". These are the JD-bleed / inflation
        # surface (XOS-34): an employer's "50M events/sec" lifted into the candidate's
        # bio reads as a bare number+unit, never a $-figure.
        "metric_scale",
        re.compile(
            r"\b\d+(?:\.\d+)?\s*(?:[KMB]\b|TPS|[Xx]\b|/(?:sec|day|year|yr|mo|month))",
            re.IGNORECASE,
        ),
    ),
    (
        # percentages: "40% cost reduction", "60% overhead", "45% MTTR". The
        # quantification gate pressures the model into inventing these; the gate
        # must therefore be able to see them.
        "percentage",
        re.compile(r"\b\d+(?:\.\d+)?\s*%"),
    ),
    (
        # "N+" count claims with no unit/$/%: "400+ payment corridors",
        # "10M+ shipments". The trailing "+" marks a quantified boast the
        # other patterns miss when there's no currency/percent/scale suffix.
        "plus_count",
        re.compile(r"\b\d+(?:\.\d+)?[KMBkmb]?\+"),
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

# Numeric-claim tokenizer. A claim and its canonical anchor must compare as the SAME
# token even when written differently, so we normalize each number to a VALUE:
#   "1M" / "1,000,000" / "1m" → "1000000";  "2.3k" / "2,300" → "2300";  "$2B" → "2000000000"
# Percentages and multipliers keep their unit ("40%", "5x"). Comparing values (not raw
# strings) fixes the "1M TPS" boundary bug, the "2,300 vs 2.3k" format mismatch, and keeps
# "18" from matching "180". A digit run glued to a letter ("P99", "H100", "S3", "EC2",
# "k8s") is a technical IDENTIFIER, not a quantity claim, and is excluded.
# Lookbehind `(?<![A-Za-z0-9.])` starts the match at a clean number boundary: it skips
# digits glued to a leading letter (identifiers — "P99", "H100", "EC2", "S3") and, by
# also excluding a preceding digit/dot, never splits a multi-digit number (an earlier
# ".?"-prefix version cannibalized "180k" into "80k" → 80,000, position-dependently).
# The unit must be GLUED to the digits and not begin a following word — `(?![A-Za-z])`
# stops "7 months" capturing "m" as mega (→ 7,000,000) and "18 months" → 18,000,000.
SCAN_RE = re.compile(
    r"(?<![A-Za-z0-9.])(?P<num>\d[\d,]*(?:\.\d+)?)(?P<unit>%|TPS|[KMB]|[Xx])?(?![A-Za-z])",
    re.IGNORECASE,
)
_UNIT_MULT = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}
CAP_WORD_RE = re.compile(r"\b[A-Z][A-Za-z]{2,}\b")

# Approximate career-totals like "10+ years" / "10+ yrs". The trailing "+" signals
# an approximation a candidate derives from grounded date ranges (2014→2024 ≈ 10y),
# not a precise performance metric. These are near-universal in résumé summaries and
# are NOT the fabrication surface XOS-34 targets (invented %, $, throughput, counts).
# Strip them before numeric anchoring so the gate doesn't block honest summaries.
# Precise tenures without the "+" ("15 years") stay strict — those can be inflated.
APPROX_TENURE_RE = re.compile(r"\b\d+(?:\.\d+)?\+\s*(?:years?|yrs?)\b", re.IGNORECASE)


def _numeric_tokens(text: str) -> set[str]:
    """Normalize every quantity in `text` to a comparable token (value, or value+unit).

    Skips digit runs glued to a letter (identifiers like P99/H100/S3). Returns a set so
    a claim is anchored iff each of its quantities also appears in the canonical set.
    """
    out: set[str] = set()
    for m in SCAN_RE.finditer(text):
        num = m.group("num").replace(",", "")
        unit = (m.group("unit") or "").lower()
        try:
            val = float(num)
        except ValueError:
            continue
        if unit in _UNIT_MULT:
            val *= _UNIT_MULT[unit]
            out.add(str(int(val)) if val == int(val) else str(val))
        elif unit in ("%", "x"):
            base = str(int(val)) if val == int(val) else str(val)
            out.add(base + unit)
        else:  # bare number, or TPS-style throughput where the magnitude is what matters
            out.add(str(int(val)) if val == int(val) else str(val))
    return out


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


def _word_in_any(word: str, canonical_texts: list[str]) -> bool:
    return any(
        re.search(rf"\b{re.escape(word)}\b", canon, re.IGNORECASE)
        for canon in canonical_texts
    )


def _is_anchored(phrase: str, canonical_tokens: set[str], canonical_texts: list[str]) -> int:
    """Return: 1 = anchored, 0 = unanchored, 2 = no distinctive tokens (WARN).

    A numeric claim is anchored ONLY if EVERY numeric token in it is in the canonical
    token set. Checking just the first number (the old behaviour) let fabricated and
    inflated figures pass whenever one grounded number sat beside them — e.g.
    "scaled from 180k to 1M TPS" passed on 1M alone even when 180k was invented,
    and "$2M savings on the $4.2M budget" passed on 4.2 while $2M was fabricated.
    Every-token-must-anchor is what catches metric inflation and JD-bleed (the XOS-34
    failure mode). Tokens carry their unit ("1m", "40%", "2b") so the comparison is
    consistent between draft and canonical, and set membership keeps "18" from falsely
    matching "180". For non-numeric claims (e.g. role titles) the first capitalized
    token must anchor.
    """
    scrubbed = APPROX_TENURE_RE.sub(" ", phrase)
    tokens = _numeric_tokens(scrubbed)
    words = CAP_WORD_RE.findall(scrubbed)[:3]
    if not tokens and not words:
        return 2

    if tokens:
        # Every numeric token must be grounded. One unanchored token = fabrication risk.
        return 1 if tokens <= canonical_tokens else 0

    # No numbers — anchor on the first distinctive capitalized token (e.g. employer/title).
    return 1 if _word_in_any(words[0], canonical_texts) else 0


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

    canonical_tokens: set[str] = set()
    for ct in canonical_texts:
        canonical_tokens |= _numeric_tokens(ct)

    claims = _extract_claims(draft_text)
    claims_total = len(claims)
    claims_anchored = 0
    unanchored: list[dict] = []

    for kind, ln, phrase in claims:
        anchored = _is_anchored(phrase, canonical_tokens, canonical_texts)
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
