#!/usr/bin/env python3
"""
outreach-people-file-commit/HOW.py — Unit-of-work commit for outreach actions.

Called IMMEDIATELY after any outreach message is confirmed sent (same execution
turn as the send, never deferred to session end).

Enforces:
1. People file fields are updated atomically (last_contact, follow_up,
   conversation_history.last_message_sent/received/summary, commitments_made)
2. A git commit is made on the specific people file right now — not at
   session end, not by a hook, not "before we finish" — NOW.

If session dies after this script succeeds, state is preserved.
If session dies before this script runs, the disk may have uncommitted changes
but git status will surface them on resume.

Usage (called by outreach-composer and network-intelligence after send):
    python3 HOW.py '<json>'

Input JSON:
    {
      "people_file": "/abs/path/to/brain/network/people/slug.md",
      "career_home": "/abs/path/to/anand-career-os",
      "updates": {
        "last_contact": "2026-05-05",
        "follow_up": "2026-05-08",
        "conversation_history": {
          "last_message_sent": "2026-05-05",
          "last_message_summary": "Asked for intro to Dilip at MongoDB re: #232"
        },
        "commitments_made": "Sent blurb + resume PDF"
      },
      "commit_message": "outreach: sandeep-reddy — mongodb #232 intro ask [unit-of-work]"
    }

Exit: 0 = committed, 1 = BLOCK (validation failed), 2 = WARN (committed with issues)
Stdout: JSON {"status": "ok|warn|block", "committed": bool, "sha": str|null, "errors": [...]}
"""

import json
import os
import re
import subprocess
import sys
from datetime import date


def fail(errors, committed=False, sha=None):
    print(json.dumps({"status": "block", "committed": committed, "sha": sha, "errors": errors}))
    sys.exit(1)


def warn(msg, sha=None):
    print(json.dumps({"status": "warn", "committed": True, "sha": sha, "errors": [msg]}))
    sys.exit(2)


def ok(sha):
    print(json.dumps({"status": "ok", "committed": True, "sha": sha, "errors": []}))
    sys.exit(0)


def update_frontmatter_field(content, key, value):
    """Replace a top-level YAML frontmatter field value. Adds if missing."""
    pattern = rf'^({re.escape(key)}:\s*)(.+)$'
    replacement = rf'\g<1>{value}'
    updated, n = re.subn(pattern, replacement, content, flags=re.MULTILINE)
    if n == 0:
        # Field missing — inject before closing ---
        end = content.find('\n---', 3)
        if end != -1:
            updated = content[:end] + f'\n{key}: {value}' + content[end:]
        else:
            updated = content  # Can't find frontmatter end — skip
    return updated


def update_conversation_history(content, conv_updates):
    """Update nested conversation_history fields in frontmatter."""
    for subkey, subval in conv_updates.items():
        # Match "  last_message_sent: ..." indented under conversation_history
        pattern = rf'^(\s+{re.escape(subkey)}:\s*)(.+)$'
        replacement = rf'\g<1>{subval}'
        updated, n = re.subn(pattern, replacement, content, flags=re.MULTILINE)
        if n > 0:
            content = updated
        # If not found, leave as-is (schema gap — don't inject nested fields blindly)
    return content


def git_commit(career_home, people_file, commit_message):
    """Stage the people file and commit. Returns (success, sha_or_error)."""
    rel = os.path.relpath(people_file, career_home)
    try:
        subprocess.run(
            ["git", "-C", career_home, "add", rel],
            check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", career_home, "commit", "-m", commit_message],
            check=True, capture_output=True
        )
        sha_result = subprocess.run(
            ["git", "-C", career_home, "rev-parse", "--short", "HEAD"],
            check=True, capture_output=True, text=True
        )
        return True, sha_result.stdout.strip()
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode() if isinstance(e.stderr, bytes) else str(e.stderr)
        # "nothing to commit" is not an error if file was already staged
        if "nothing to commit" in stderr or "nothing added to commit" in stderr:
            return True, "already-clean"
        return False, stderr.strip()


def main():
    if len(sys.argv) < 2:
        fail(["Usage: HOW.py '<json>'"])

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        fail([f"Invalid JSON input: {e}"])

    people_file = ctx.get("people_file")
    career_home = ctx.get("career_home")
    updates = ctx.get("updates", {})
    commit_message = ctx.get("commit_message", "")

    # Validate required fields
    errors = []
    if not people_file:
        errors.append("people_file is required")
    elif not os.path.isfile(people_file):
        errors.append(f"people_file not found: {people_file}")
    if not career_home:
        errors.append("career_home is required")
    elif not os.path.isdir(career_home):
        errors.append(f"career_home not found: {career_home}")
    if not commit_message:
        errors.append("commit_message is required — must identify contact + action")
    if not updates:
        errors.append("updates is empty — nothing to write")
    if errors:
        fail(errors)

    # Validate date formats
    for date_field in ("last_contact", "follow_up"):
        val = updates.get(date_field)
        if val:
            try:
                date.fromisoformat(str(val).split("(")[0].strip().split(" ")[0])
            except ValueError:
                errors.append(f"{date_field} must be ISO date (YYYY-MM-DD), got: {val}")
    if errors:
        fail(errors)

    # Read people file
    try:
        with open(people_file, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        fail([f"Cannot read people file: {e}"])

    # Apply updates
    for key, val in updates.items():
        if key == "conversation_history" and isinstance(val, dict):
            content = update_conversation_history(content, val)
        elif key == "commitments_made":
            # commitments_made is a list in YAML — append, don't overwrite
            # Simple approach: add entry after existing commitments_made block
            pattern = r'(commitments_made:\s*\n(?:\s+-[^\n]*\n)*)'
            new_entry = f'  - "{val} ({updates.get("last_contact", "unknown date")})"\n'
            updated, n = re.subn(pattern, rf'\g<1>{new_entry}', content)
            if n > 0:
                content = updated
            # If commitments_made: [] (empty list), replace with entry
            content = re.sub(
                r'(commitments_made:\s*)\[\]',
                rf'\g<1>\n  - "{val} ({updates.get("last_contact", "unknown date")})"',
                content
            )
        else:
            content = update_frontmatter_field(content, key, str(val))

    # Write updated file
    try:
        with open(people_file, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        fail([f"Cannot write people file: {e}"])

    # Commit immediately — unit of work
    success, sha_or_error = git_commit(career_home, people_file, commit_message)
    if not success:
        warn(f"File updated but git commit failed: {sha_or_error}", sha=None)

    ok(sha_or_error)


if __name__ == "__main__":
    main()
