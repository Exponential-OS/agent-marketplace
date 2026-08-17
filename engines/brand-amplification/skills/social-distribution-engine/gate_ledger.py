"""
gate_ledger.py — evidence that the Draft Handoff Gate actually ran.

XOS-249. The Draft Handoff Gate is MANDATORY in SKILL.md, and on 2026-08-16 an
agent produced LinkedIn copy without it. Nothing noticed, because a skill that
must be remembered is a document, not a pipeline.

This is the evidence half. `post_validator.py` records every validation here,
keyed by a hash of the exact copy it validated. A PreToolUse hook then refuses
to publish copy that has no matching record.

DESIGN NOTE — why hashes and not a copy-shape heuristic:
The obvious implementation is "at session end, if the transcript looks like it
contains LinkedIn copy and no gate ran, warn". That detector cannot be made
precise: it fires on quoted examples, drafts the user pasted in, and analysis
of someone else's post. A gate whose warnings are usually wrong teaches everyone
to ignore it — the failure mode already filed as XOS-241. Hash matching has no
false positives by construction: the hook only fires on an actual publish call,
and it either has a matching validation record or it does not.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
from datetime import datetime, timezone

LEDGER_ENV = "BAE_DRAFT_GATE_LEDGER"
STATE_DIR_ENV = "CLAUDE_PLUGIN_DATA"
DEFAULT_STATE_DIR = "~/.career-os-state"
LEDGER_NAME = "draft-gate-ledger.jsonl"

# Keep a bounded window. This is evidence for the current work, not an archive.
MAX_RECORDS = 2000


def ledger_path() -> pathlib.Path:
    override = os.environ.get(LEDGER_ENV)
    if override:
        return pathlib.Path(override).expanduser()
    state_dir = os.environ.get(STATE_DIR_ENV) or DEFAULT_STATE_DIR
    return pathlib.Path(state_dir).expanduser() / LEDGER_NAME


def normalize(text: str) -> str:
    """
    Normalize copy for hashing.

    Deliberately conservative. It absorbs the differences a copy-paste round trip
    introduces (line endings, trailing spaces, a stray blank line at either end)
    and NOTHING else. Normalizing punctuation or case would let genuinely
    different copy match a stale record, which is the one failure that matters:
    publishing text nobody validated while the gate reports green.
    """
    if not isinstance(text, str):
        return ""
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    t = "\n".join(line.rstrip() for line in t.split("\n"))
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def record_validation(platform: str, text: str, verdict: str) -> None:
    """Append a validation record. Never raises — evidence must not break the validator."""
    try:
        path = ledger_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        rec = {
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "platform": platform,
            "verdict": verdict,
            "sha256": content_hash(text),
            "chars": len(normalize(text)),
        }
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        _truncate(path)
    except Exception:
        # A failure to record evidence must never mask or block a validation run.
        pass


def _truncate(path: pathlib.Path) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) > MAX_RECORDS:
            path.write_text("\n".join(lines[-MAX_RECORDS:]) + "\n", encoding="utf-8")
    except Exception:
        pass


def load_records() -> list[dict]:
    path = ledger_path()
    if not path.exists():
        return []
    out = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except Exception:
        return []
    return out


def find_validation(text: str, platform: str | None = None) -> dict | None:
    """
    Return the most recent validation record for this exact copy, or None.

    Platform is compared only when the caller supplies one AND the record has
    one, so a record written by an older version still counts as evidence.
    """
    want = content_hash(text)
    match = None
    for rec in load_records():
        if rec.get("sha256") != want:
            continue
        if platform and rec.get("platform") and rec.get("platform") != platform:
            continue
        match = rec
    return match
