#!/usr/bin/env python3
"""
HOW.py — warm-contact-outreach-dedup enforcement.

Before suggesting or drafting outreach to a named contact for a job referral,
check their people file for existing recent outreach. BLOCK if outreach was
sent within the lookback window (default 14 days).

Input JSON via $1 or stdin (when $1 == '-'):
  contact_name   - full or partial name of the contact (e.g. "Iuliia Melnychuk")
  people_dir     - absolute path to brain/network/people/
                   (default: $CAREER_OS_HOME/brain/network/people, with
                    $CAREER_OS_HOME falling back to ~/anand-career-os)
  lookback_days  - how many days to treat as "recent" (default: 14)

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
_CAREER_OS_HOME = pathlib.Path(
    os.environ.get("CAREER_OS_HOME", str(pathlib.Path.home() / "anand-career-os"))
)
DEFAULT_PEOPLE_DIR = _CAREER_OS_HOME / "brain/network/people"
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
    candidates = list(people_dir.glob("*.md"))

    # Filename match (slug form)
    for f in candidates:
        stem = f.stem.replace("-", " ").lower()
        if all(part in stem for part in name_parts):
            return f

    # Frontmatter / heading match
    for f in candidates:
        try:
            for line in f.read_text(errors="ignore").splitlines()[:20]:
                if all(part in line.lower() for part in name_parts):
                    return f
        except OSError:
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
    last_contact_str = _extract_last_contact(text)
    if not last_contact_str:
        return None

    try:
        last_contact = datetime.date.fromisoformat(last_contact_str)
    except ValueError:
        return None

    days_ago = (datetime.date.today() - last_contact).days

    if days_ago <= lookback_days:
        summary = _extract_latest_outreach_entry(text)
        follow_up = _extract_follow_up(text)
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
