#!/usr/bin/env python3
"""
xOS Coordination engine — setup
Run once after install, and again after each upgrade.

Usage:
    python3 setup.py

What it does:
  1. Copies session-start-sync.sh to ~/.codialectic/coordination/ (stable, version-agnostic path)
  2. Registers the 'coordination-sync' hook in ~/.codialectic/hooks/session_start.json
     Merges into an existing hooks file; does not overwrite other hooks.

Prerequisites:
  - ~/.codialectic/context.json must exist with workspace_root set
  - co-dialectic must be installed (provides the hooks contract)
"""

import json
import shutil
import stat
import sys
from pathlib import Path

HOOK_NAME = "coordination-sync"
STABLE_DIR = Path.home() / ".codialectic" / "coordination"
HOOKS_FILE = Path.home() / ".codialectic" / "hooks" / "session_start.json"
SCRIPT_SRC = Path(__file__).parent / "scripts" / "session-start-sync.sh"
SCRIPT_DEST = STABLE_DIR / "session-start-sync.sh"


def main() -> int:
    # Create stable dirs
    STABLE_DIR.mkdir(parents=True, exist_ok=True)
    HOOKS_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Copy hook script to stable path (version-agnostic; survives plugin upgrades)
    shutil.copy2(SCRIPT_SRC, SCRIPT_DEST)
    SCRIPT_DEST.chmod(SCRIPT_DEST.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    print(f"✓ Installed: {SCRIPT_DEST}")

    # Load or initialize hooks file
    if HOOKS_FILE.exists():
        with HOOKS_FILE.open() as f:
            hooks_doc = json.load(f)
    else:
        hooks_doc = {"hooks": []}

    hooks_doc.setdefault("hooks", [])

    # Check if already registered
    already = any(h.get("name") == HOOK_NAME for h in hooks_doc["hooks"])
    if already:
        print(f"✓ Hook '{HOOK_NAME}' already registered in {HOOKS_FILE}")
        print("  (re-run setup.py after upgrade to refresh the script at stable path)")
        return 0

    # Append coordination hook
    hooks_doc["hooks"].append({
        "name": HOOK_NAME,
        "command": "bash",
        "args": [str(SCRIPT_DEST)],
        "required": False,
        "timeout_seconds": 15,
    })

    with HOOKS_FILE.open("w") as f:
        json.dump(hooks_doc, f, indent=2)
        f.write("\n")

    print(f"✓ Hook registered: {HOOKS_FILE}")
    print()
    print("brain-multi-session-sync is active.")
    print("On each session start, waky-waky will pull your workspace and surface agent state as Tier 1.5 context.")
    print()
    print("Next step: ensure ~/.codialectic/context.json has workspace_root set.")
    print("  Optional: set coordination_status_rel_path (default: AGENT_STATUS.yaml)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
