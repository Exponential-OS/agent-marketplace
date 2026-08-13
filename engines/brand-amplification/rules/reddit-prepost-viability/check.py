#!/usr/bin/env python3
"""Offline deterministic gate logic for reddit-prepost-viability.

Input JSON (via sys.argv[1]):
{
  "subreddit": "r/Entrepreneur",
  "body": "candidate post or comment text",
  "title": "optional post title",
  "handle": "thewhyman007",
  "ledger_path": "optional override",
  "research_path": "optional override",
  "submission_history": []
}

Exits: 0=PASS, 1=BLOCK, 2=WARN. Prints exactly one JSON object.
No network calls are made. See README.md for the verified Reddit 403 finding.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any

DEFAULT_LEDGER_PATH = pathlib.Path.home() / "anand-career-os/brand-amplification/reddit-surface-history.json"
DEFAULT_RESEARCH_PATH = pathlib.Path.home() / "anand-career-os/brand-amplification/research/50-subreddits-ai-citation-index-2026.md"

ANNOUNCING_SIGNALS = (
    ("i_built", re.compile(r"\bi\s+(?:built|made|created)\b", re.IGNORECASE), 3),
    ("im_excited", re.compile(r"\bi(?:'|’)?m\s+excited\b", re.IGNORECASE), 3),
    ("introducing", re.compile(r"\bintroducing\b", re.IGNORECASE), 3),
    ("launching", re.compile(r"\blaunch(?:ing|ed)?\b", re.IGNORECASE), 3),
    ("check_out", re.compile(r"\bcheck\s+(?:it\s+)?out\b", re.IGNORECASE), 2),
    ("my_new", re.compile(r"\bmy\s+new\b", re.IGNORECASE), 2),
    ("just_shipped", re.compile(r"\bjust\s+shipped\b", re.IGNORECASE), 3),
)

QUESTION_OPENING_RE = re.compile(
    r"^(?:how|what|why|when|where|who|which|has|have|do|does|did|can|could|should|would|is|are)\b[^?\n]{0,180}\?",
    re.IGNORECASE,
)
SECOND_PERSON_RE = re.compile(r"\b(?:you|your|you'll|you’re|you're)\b", re.IGNORECASE)
MEASUREMENT_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:%|percent|ms|s|sec(?:onds?)?|min(?:utes?)?|hours?|days?|x|×|k|m|b|tokens?|samples?|artifacts?|runs?|tests?|models?|users?)?\b",
    re.IGNORECASE,
)
TESTING_RE = re.compile(
    r"\b(?:in my testing|we measured|i measured|we tested|i tested|our experiment|my experiment)\b",
    re.IGNORECASE,
)
METHOD_RE = re.compile(
    r"\b(?:method|methodology|tested|measured|sample|dataset|benchmark|control|compared|comparison|results?)\b",
    re.IGNORECASE,
)
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
TITLE_PRODUCT_RE = re.compile(
    r"(?:\b[A-Z][A-Za-z0-9]+(?:[- ][A-Z][A-Za-z0-9]+)+\b|\bv\d+(?:\.\d+)*\b)"
)


def normalize_subreddit(raw: Any) -> tuple[str, str]:
    value = str(raw or "").strip().strip("*_` ")
    value = re.sub(r"^/?r/", "", value, flags=re.IGNORECASE).strip("/ ")
    return (f"r/{value}" if value else "", value.casefold())


def _result(gate: str, verdict: str, **details: Any) -> dict[str, Any]:
    return {"gate": gate, "verdict": verdict, **details}


def _read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def check_surface_history(ctx: dict[str, Any], subreddit: str, key: str) -> dict[str, Any]:
    source: str
    ledger_handle = None
    if "submission_history" in ctx:
        history = ctx.get("submission_history")
        source = "input.submission_history"
        if not isinstance(history, list):
            return _result(
                "surface_history",
                "WARN",
                source=source,
                reason="submission_history was provided but is not an array, so removal history could not be checked.",
                remediation="Pass submission_history as an array of {subreddit,date,outcome,removed_by,title} entries.",
            )
    else:
        path = pathlib.Path(str(ctx.get("ledger_path") or DEFAULT_LEDGER_PATH)).expanduser()
        source = str(path)
        if not path.is_file():
            return _result(
                "surface_history",
                "WARN",
                source=source,
                reason=f"Reddit surface-history ledger is missing at {path}; prior removals were not silently treated as safe.",
                remediation=f"Create {path} with {{\"handle\":\"...\",\"updated\":\"YYYY-MM-DD\",\"entries\":[...]}}. A verified seed is bundled beside this rule as reddit-surface-history.seed.json.",
            )
        try:
            ledger = _read_json(path)
            history = ledger.get("entries", []) if isinstance(ledger, dict) else None
            ledger_handle = ledger.get("handle") if isinstance(ledger, dict) else None
        except (OSError, json.JSONDecodeError) as e:
            return _result(
                "surface_history",
                "WARN",
                source=source,
                reason=f"Reddit surface-history ledger could not be read: {e}.",
                remediation="Repair the ledger JSON before relying on this surface.",
            )
        if not isinstance(history, list):
            return _result(
                "surface_history",
                "WARN",
                source=source,
                reason="Reddit surface-history ledger has no entries array.",
                remediation="Add an entries array using the schema documented in README.md.",
            )

    requested_handle = str(ctx.get("handle") or "").strip()
    if requested_handle and ledger_handle and requested_handle.casefold() != str(ledger_handle).casefold():
        return _result(
            "surface_history",
            "WARN",
            source=source,
            reason=f"Ledger belongs to handle '{ledger_handle}', not requested handle '{requested_handle}'.",
            remediation=f"Provide submission_history for {requested_handle} or point ledger_path at that handle's ledger.",
        )

    matches = []
    for entry in history:
        if not isinstance(entry, dict):
            continue
        _, entry_key = normalize_subreddit(entry.get("subreddit"))
        if entry_key == key and str(entry.get("outcome", "")).casefold() == "removed":
            matches.append({
                "date": str(entry.get("date") or "unknown"),
                "removed_by": str(entry.get("removed_by") or "unknown"),
                "title": str(entry.get("title") or ""),
            })

    if matches:
        dates_and_removers = ", ".join(
            f"{item['date']} ({item['removed_by']})" for item in matches
        )
        return _result(
            "surface_history",
            "BLOCK",
            source=source,
            removals=matches,
            reason=f"{subreddit} has prior removals: {dates_and_removers}. The spoke file rated r/LocalLLaMA 'LOW self-promo risk' after that subreddit had already removed this account twice; the data existed, but nothing read it.",
            remediation="Do not draft or post to this subreddit. Choose a viable top-50 surface without prior removals.",
        )

    return _result(
        "surface_history",
        "PASS",
        source=source,
        prior_removals=0,
        reason=f"No prior removal for {subreddit} appears in the supplied history.",
    )


def parse_top50_markdown(markdown: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        rank_text = cells[0].strip("*_` ") if cells else ""
        if len(cells) < 3 or not rank_text.isdigit():
            continue
        display, key = normalize_subreddit(cells[1])
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        rows.append({
            "rank": int(rank_text),
            "subreddit": display,
            "key": key,
            "category": cells[2],
            "engines": cells[3] if len(cells) > 3 else "",
        })
    return rows


def check_top50(ctx: dict[str, Any], subreddit: str, key: str) -> dict[str, Any]:
    path = pathlib.Path(str(ctx.get("research_path") or DEFAULT_RESEARCH_PATH)).expanduser()
    if not path.is_file():
        return _result(
            "top50_citation_index",
            "WARN",
            source=str(path),
            reason=f"Top-50 Reddit AI citation research is missing at {path}; targeting could not be verified.",
            remediation="Restore 50-subreddits-ai-citation-index-2026.md or pass research_path to a verified copy.",
        )
    try:
        rows = parse_top50_markdown(path.read_text(encoding="utf-8"))
    except OSError as e:
        return _result(
            "top50_citation_index",
            "WARN",
            source=str(path),
            reason=f"Top-50 Reddit AI citation research could not be read: {e}.",
            remediation="Repair the research file or pass research_path to a readable verified copy.",
        )

    match = next((row for row in rows if row["key"] == key), None)
    if match:
        return _result(
            "top50_citation_index",
            "PASS",
            source=str(path),
            rank=match["rank"],
            category=match["category"],
            engines=match["engines"],
            reason=f"{subreddit} is rank {match['rank']} in the top-50 AI citation index ({match['category']}).",
        )

    return _result(
        "top50_citation_index",
        "BLOCK",
        source=str(path),
        indexed_subreddits=len(rows),
        reason=f"{subreddit} is outside the top-50 Reddit AI citation index. Outside the top 50, a post produces neither reach nor citation; those 50 carry ~80% of Reddit's AI citation share, and Reddit is ~40% of multi-engine citations.",
        remediation="Target a relevant subreddit in the verified top-50 index.",
    )


def _signal(name: str, points: int, evidence: str) -> dict[str, Any]:
    return {"signal": name, "points": points, "evidence": evidence}


def check_format_class(title: str, body: str) -> dict[str, Any]:
    announcing: list[dict[str, Any]] = []
    answering: list[dict[str, Any]] = []
    combined = f"{title}\n{body}".strip()

    for name, pattern, points in ANNOUNCING_SIGNALS:
        match = pattern.search(combined)
        if match:
            announcing.append(_signal(name, points, match.group(0)))

    early_url = URL_RE.search(body[:200])
    if early_url:
        announcing.append(_signal("link_in_first_200_chars", 2, early_url.group(0)))

    title_product = TITLE_PRODUCT_RE.search(title)
    if title_product:
        announcing.append(_signal("product_or_tool_name_in_title", 1, title_product.group(0)))

    opening = body.lstrip()[:220]
    question = QUESTION_OPENING_RE.search(opening)
    if question:
        answering.append(_signal("question_shaped_opening", 3, question.group(0)))

    second_person = SECOND_PERSON_RE.search(body)
    if second_person:
        answering.append(_signal("second_person_address", 1, second_person.group(0)))

    measurement = MEASUREMENT_RE.search(body)
    if measurement:
        answering.append(_signal("concrete_number_or_measurement", 1, measurement.group(0)))

    testing = TESTING_RE.search(body)
    if testing:
        answering.append(_signal("first_person_experiment", 3, testing.group(0)))

    method = METHOD_RE.search(body)
    if method:
        answering.append(_signal("method_description", 1, method.group(0)))

    table_lines = [line for line in body.splitlines() if line.count("|") >= 2]
    if len(table_lines) >= 2:
        answering.append(_signal("comparison_table", 2, table_lines[0].strip()[:120]))

    announcing_score = sum(item["points"] for item in announcing)
    answering_score = sum(item["points"] for item in answering)
    classification = "announcing" if announcing_score > answering_score else "answering"
    verdict = "WARN" if classification == "announcing" else "PASS"

    return _result(
        "format_class",
        verdict,
        classification=classification,
        score={"announcing": announcing_score, "answering": answering_score},
        matched_signals={"announcing": announcing, "answering": answering},
        reason=(
            "Draft reads as an announcement about the author's work. Four removed posts used this framing; the survivor answered with a first-person experiment and concrete numbers."
            if classification == "announcing"
            else "Draft reads as an answer: answering signals meet or exceed announcement signals."
        ),
        remediation=(
            "Reframe around the reader's question, method, measurements, and comparison before mentioning the work."
            if classification == "announcing"
            else "None. Preserve the question, method, and evidence framing."
        ),
    )


def _offsets(text: str, character: str) -> list[int]:
    return [index for index, value in enumerate(text) if value == character]


def check_dashes(title: str, body: str) -> dict[str, Any]:
    em_locations = [
        {"field": field, "offset": offset}
        for field, text in (("title", title), ("body", body))
        for offset in _offsets(text, "—")
    ]
    en_locations = [
        {"field": field, "offset": offset}
        for field, text in (("title", title), ("body", body))
        for offset in _offsets(text, "–")
    ]

    if em_locations:
        return _result(
            "em_dash",
            "BLOCK",
            em_dash_offsets=em_locations,
            en_dash_offsets=en_locations,
            reason="U+2014 em dash found. On 2026-08-13, old.reddit.com/api/comment returned HTTP 500 with an empty errors array for comments containing this character; replacing it made both comments succeed.",
            remediation="Replace each em dash with a comma, colon, semicolon, or parentheses before posting.",
        )
    if en_locations:
        return _result(
            "em_dash",
            "WARN",
            em_dash_offsets=[],
            en_dash_offsets=en_locations,
            reason="U+2013 en dash found. The verified failure involved U+2014, but this adjacent Unicode dash should be reviewed for Reddit compatibility.",
            remediation="Prefer a plain hyphen or rewrite the punctuation before posting.",
        )
    return _result(
        "em_dash",
        "PASS",
        em_dash_offsets=[],
        en_dash_offsets=[],
        reason="No U+2014 em dash or U+2013 en dash found in title or body.",
    )


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1
    if not isinstance(ctx, dict):
        print(json.dumps({"verdict": "BLOCK", "reason": "Input JSON must be an object."}))
        return 1

    subreddit, key = normalize_subreddit(ctx.get("subreddit"))
    if not key:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": "subreddit is required. Pass either 'r/Name' or 'Name'.",
        }))
        return 1

    title = str(ctx.get("title") or "")
    body = str(ctx.get("body") or "")
    gates = [
        check_surface_history(ctx, subreddit, key),
        check_top50(ctx, subreddit, key),
        check_format_class(title, body),
        check_dashes(title, body),
    ]

    verdicts = [gate["verdict"] for gate in gates]
    if "BLOCK" in verdicts:
        verdict, code = "BLOCK", 1
    elif "WARN" in verdicts:
        verdict, code = "WARN", 2
    else:
        verdict, code = "PASS", 0

    print(json.dumps({
        "verdict": verdict,
        "subreddit": subreddit,
        "offline": True,
        "gates": gates,
        "summary": {
            "passes": verdicts.count("PASS"),
            "warns": verdicts.count("WARN"),
            "blocks": verdicts.count("BLOCK"),
        },
    }))
    return code


if __name__ == "__main__":
    sys.exit(main())
