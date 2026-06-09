#!/usr/bin/env python3
"""
HOW.py — warm-contact-outreach-dedup enforcement.

Before suggesting or drafting outreach to a named contact for a job referral,
check their people file for existing recent outreach. BLOCK if outreach was
sent within the lookback window (default 14 days).

Input JSON via $1 or stdin (when $1 == '-'):
  contact_name   - full or partial name of the contact (e.g. "Iuliia Melnychuk")
  people_dir     - absolute path to the people directory
                   (default: $CAREER_HOME/network/people)
  lookback_days  - how many days to treat as "recent" (default: 14)

Reads both .json (canonical) and .md (legacy/unmigrated) people files. The live
workspace is 100% .json — globbing .md only (the pre-v0.72.0 bug) found ZERO
candidates and silently never blocked, defeating the double-outreach guard.

Output: JSON {"verdict": "PASS"} or {"verdict": "BLOCK", "reason": "...", "last_contact": "...", ...}
Exit:   0=PASS  1=BLOCK
"""
import datetime
import json
import os
import pathlib
import re
import sys

RULE_SLUG = "warm-contact-outreach-dedup"
LOG_FILE = pathlib.Path.home() / ".cyborg-enforcement-log.jsonl"
_CAREER_HOME_RAW = os.environ.get("CAREER_HOME") or os.environ.get("CAREER_OS_HOME")
_CAREER_HOME = pathlib.Path(_CAREER_HOME_RAW).expanduser() if _CAREER_HOME_RAW else None
# BRAIN-KERNEL-BYPASS: subprocess gate reads filesystem directly, bypassing kernel ACL.
# Resolved by V1.1-WORK-001 (kernel CLI mode) — at that point this can use brain.read().
DEFAULT_PEOPLE_DIR = _CAREER_HOME / "network/people" if _CAREER_HOME else pathlib.Path("/nonexistent/career-home-not-set")
DEFAULT_LOOKBACK_DAYS = 14


def _log(verdict: str) -> None:
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    record = {"ts": ts, "rule_slug": RULE_SLUG, "script_type": "HOW", "verdict": verdict}
    try:
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(record) + "\n")
    except OSError:
        pass


def _find_people_file(contact_name: str, people_dir: pathlib.Path) -> pathlib.Path | None:
    name_parts = contact_name.lower().split()
    # .json is canonical (live workspace is 100% .json); .md kept for unmigrated files.
    candidates = sorted(people_dir.glob("*.json")) + sorted(people_dir.glob("*.md"))

    # Filename match (slug form)
    for f in candidates:
        stem = f.stem.replace("-", " ").lower()
        if all(part in stem for part in name_parts):
            return f

    # Content match — JSON: name field; MD: frontmatter/heading lines.
    for f in candidates:
        try:
            if f.suffix == ".json":
                data = json.loads(f.read_text(errors="ignore"))
                hay = " ".join(
                    str(data.get(k, "")) for k in ("name", "slug")
                ).lower()
                if all(part in hay for part in name_parts):
                    return f
            else:
                for line in f.read_text(errors="ignore").splitlines()[:20]:
                    if all(part in line.lower() for part in name_parts):
                        return f
        except (OSError, ValueError):
            continue

    return None


def _extract_last_contact(text: str) -> str | None:
    # Primary: last_contact frontmatter field
    for line in text.splitlines()[:30]:
        m = re.match(r"last_contact:\s*(\d{4}-\d{2}-\d{2})", line.strip())
        if m:
            return m.group(1)
    # Fallback: conversation_history.last_message_sent (set by relationship origin scan)
    for line in text.splitlines()[:50]:
        m = re.match(r"last_message_sent:\s*(\d{4}-\d{2}-\d{2})", line.strip())
        if m:
            return m.group(1)
    return None


def _extract_follow_up(text: str) -> str | None:
    for line in text.splitlines()[:30]:
        m = re.match(r"follow_up:\s*(\d{4}-\d{2}-\d{2})", line.strip())
        if m:
            return m.group(1)
    return None


def _extract_latest_outreach_entry(text: str) -> str:
    log_section = False
    entries = []
    for line in text.splitlines():
        if re.search(r"## outreach log", line, re.IGNORECASE):
            log_section = True
            continue
        if log_section:
            if line.startswith("## "):
                break
            if re.match(r"^\s*-\s*\*\*\d{4}-\d{2}-\d{2}", line):
                entries.append(line.strip(" -").strip())
    return entries[-1] if entries else ""


def _json_latest_outreach(data: dict) -> str:
    """Best-effort one-line summary of the most recent outreach from a JSON people file."""
    for key in ("interaction_log", "interaction_notes"):
        v = data.get(key)
        if isinstance(v, list) and v:
            last = v[-1]
            return str(last) if not isinstance(last, dict) else json.dumps(last)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return str(data.get("relationship", "")).strip()


def check(d: dict) -> dict | None:
    """Returns a block dict if recent outreach found, else None (PASS)."""
    contact_name = d.get("contact_name", "").strip()
    if not contact_name:
        return {"verdict": "BLOCK", "reason": "contact_name is required"}

    people_dir = pathlib.Path(d.get("people_dir", str(DEFAULT_PEOPLE_DIR)))
    lookback_days = int(d.get("lookback_days", DEFAULT_LOOKBACK_DAYS))

    if not people_dir.exists():
        return None  # Can't check — fail open

    people_file = _find_people_file(contact_name, people_dir)
    if not people_file:
        return None  # No file → no prior outreach on record

    text = people_file.read_text(errors="ignore")
    if people_file.suffix == ".json":
        try:
            data = json.loads(text)
        except ValueError:
            return None
        last_contact_str = data.get("last_contact") or data.get("last_interaction")
        follow_up = data.get("follow_up")
        summary = _json_latest_outreach(data)
    else:
        last_contact_str = _extract_last_contact(text)
        follow_up = _extract_follow_up(text)
        summary = _extract_latest_outreach_entry(text)
    if not last_contact_str:
        return None

    try:
        last_contact = datetime.date.fromisoformat(last_contact_str)
    except ValueError:
        return None

    days_ago = (datetime.date.today() - last_contact).days

    if days_ago <= lookback_days:
        parts = [
            f"Outreach to {contact_name} already sent {days_ago}d ago ({last_contact_str}).",
            f"Most recent: {summary}" if summary else "",
            f"Follow-up scheduled: {follow_up}" if follow_up else "",
            "Check for a reply instead of re-suggesting outreach.",
        ]
        return {
            "verdict": "BLOCK",
            "reason": " ".join(p for p in parts if p),
            "last_contact": last_contact_str,
            "days_since_outreach": days_ago,
            "people_file": str(people_file),
        }

    return None


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]

    try:
        d = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        result = {"verdict": "BLOCK", "reason": f"Invalid JSON: {e}"}
        _log("BLOCK")
        print(json.dumps(result))
        return 1

    block = check(d)
    if block:
        _log("BLOCK")
        print(json.dumps(block))
        return 1

    _log("PASS")
    print(json.dumps({"verdict": "PASS"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
