#!/usr/bin/env python3
"""audit-people-schema.py

Finds people files missing recipient-context schema fields.
Prioritizes recently-active contacts (last_contact: 2026).

Usage: python3 audit-people-schema.py [--fix]
  --fix: injects empty schema fields into files missing them
         (safe — append to frontmatter only)

CLI utility (not a hook). Called from SessionStart.
"""

import os
import sys
from pathlib import Path

_CAREER_HOME_RAW = os.environ.get("CAREER_HOME") or os.environ.get("CAREER_OS_HOME")
_CAREER_HOME = Path(_CAREER_HOME_RAW).expanduser() if _CAREER_HOME_RAW else None
PEOPLE_DIR = _CAREER_HOME / "brain" / "network" / "people" if _CAREER_HOME else Path.home() / "career-os" / "brain" / "network" / "people"

REQUIRED_FIELDS = (
    "their_expertise",
    "they_told_us",
    "commitments_made",
    "do_not_explain",
)

SCHEMA_DEFAULTS = {
    "their_expertise": "[]  # topics they know better than us — never explain these back",
    "they_told_us":    "[]  # key facts they communicated — do not re-explain or re-raise",
    "commitments_made":"[]  # what the user committed to provide/do for them",
    "do_not_explain":  "[]  # topics to never explain in emails to this person",
}


def file_has_field(path: Path, field: str) -> bool:
    """Equivalent to: grep -q "^${field}:" "$file" """
    needle = f"{field}:"
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith(needle):
                    return True
    except OSError:
        return False
    return False


def file_contains(path: Path, substring: str) -> bool:
    """Equivalent to: grep -q "<substring>" "$file" """
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if substring in line:
                    return True
    except OSError:
        return False
    return False


def inject_fields(path: Path) -> None:
    """Inject empty schema fields into the file's frontmatter.

    Mirrors the original Python heredoc:
      - Find end of frontmatter (\n--- after position 3)
      - For each missing field, append "\n<field>: <default>" to frontmatter
      - Write back fm + rest if any field was added
    """
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        print(f"SKIP (read failed): {path}")
        return

    fm_end = content.find("\n---", 3)
    if fm_end == -1:
        print(f"SKIP (no frontmatter): {path}")
        return

    fm = content[:fm_end]
    rest = content[fm_end:]

    added = []
    for field, default in SCHEMA_DEFAULTS.items():
        if f"\n{field}:" not in fm:
            fm += f"\n{field}: {default}"
            added.append(field)

    basename = path.name
    if added:
        try:
            path.write_text(fm + rest, encoding="utf-8")
            print(f"  Added {added} → {basename}")
        except OSError as e:
            print(f"  WRITE FAILED: {basename} ({e})")
    else:
        print(f"  OK: {basename}")


def main() -> int:
    fix_mode = len(sys.argv) > 1 and sys.argv[1] == "--fix"

    missing_any: list[Path] = []
    missing_active: list[Path] = []

    if not PEOPLE_DIR.exists():
        return 0

    files = sorted(PEOPLE_DIR.glob("*.md"))
    for file in files:
        # If the file is missing any required field, it's a candidate.
        missing = False
        for field in REQUIRED_FIELDS:
            if not file_has_field(file, field):
                missing = True
                break
        if not missing:
            continue

        missing_any.append(file)
        if file_contains(file, "last_contact: 2026"):
            missing_active.append(file)

    if missing_active:
        print("=== People Schema Audit ===")
        print(f"Total files missing schema fields: {len(missing_any)}")
        print(f"Recently-active (2026) missing schema: {len(missing_active)}")
        print("")
        print("=== Recently-Active (Action Required) ===")
        for f in missing_active:
            print(f.name)
        print("")

    if fix_mode and missing_active:
        print("=== Injecting empty schema fields into recently-active files ===")
        for file in missing_active:
            inject_fields(file)
        print("")
        print("Done. Fill in non-empty values as you interact with each person.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
