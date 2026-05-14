#!/usr/bin/env python3
"""
Co-Dialectic session-start hook.

1. Syncs ~/.claude/skills/co-dialectic/SKILL.md from plugin cache when stale.
2. Polls lifecycle registry for stuck/timed-out agents from prior sessions.
3. Emits JSON systemMessage to stdout.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def extract_version(path: Path) -> str:
    try:
        content = path.read_text(encoding="utf-8")
        m = re.search(r'^version:\s*["\']?(\d+\.\d+\.\d+)["\']?', content, re.MULTILINE)
        return m.group(1) if m else ""
    except OSError:
        return ""


def skill_sync(plugin_root: Path) -> str:
    plugin_skill = plugin_root / "skills" / "co-dialectic" / "SKILL.md"
    user_skill_dir = Path.home() / ".claude" / "skills" / "co-dialectic"
    user_skill = user_skill_dir / "SKILL.md"

    plugin_version = extract_version(plugin_skill)
    user_version = extract_version(user_skill)

    if user_version != plugin_version and plugin_skill.exists():
        user_skill_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(plugin_skill, user_skill)

    return plugin_version


def lifecycle_message(plugin_root: Path) -> str:
    lifecycle_script = plugin_root / "fish" / "scripts" / "agent_lifecycle.py"
    if not lifecycle_script.exists():
        return ""

    try:
        result = subprocess.run(
            [sys.executable, str(lifecycle_script), "poll", "--timeout-min", "10"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if result.returncode == 0 and result.stdout:
            data = json.loads(result.stdout)
            stuck_count = len(data.get("stuck", []))
            if stuck_count:
                return (
                    f" ⚠️ {stuck_count} background agent(s) timed out from a prior session"
                    f" — check status: python3 {lifecycle_script} status"
                )
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        pass

    return ""


def main() -> None:
    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", ""))

    version = skill_sync(plugin_root)
    extra = lifecycle_message(plugin_root)

    output = {
        "systemMessage": (
            f"Co-Dialectic v{version} loaded. "
            "Status line REQUIRED on every response: {Icon} {Domain} ({Name}) · {X}%. "
            "Default persona: ⚡ Productivity (Tim Ferriss). Default mode: 🛞 Drive. "
            "New user? Type /co-dialectic-onboarding. Protocols absent? Type /co-dialectic."
            + extra
        )
    }
    sys.stdout.write(json.dumps(output) + "\n")


if __name__ == "__main__":
    main()
