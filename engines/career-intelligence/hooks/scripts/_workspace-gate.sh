#!/usr/bin/env bash
set -euo pipefail
# _workspace-gate.sh — shared workspace-binding gate (XOS-39).
#
# SOURCE this as the first executable line of every hook script that writes
# cwd-relative files or runs git. It reads `workspace_binding` from the plugin
# manifest and `exit 0`s (silently skipping the hook) when the current directory
# is NOT a bound workspace. Because it is sourced, the `exit 0` propagates to the
# calling script — one line per hook, one copy of the logic.
#
# Replaces the per-script `is_career_os_workspace()` function that was duplicated
# across init-repo.sh / capture-prompt.sh / capture-response.sh and was forgotten
# in the 3rd in v0.66 (the single-slot-learning failure behind the 408-stray-commits
# incident). Single source + manifest declaration + the CI audit
# (tests/test_workspace_gate.py) make it impossible to forget.
#
# Manifest contract (.claude-plugin/plugin.json):
#   "workspace_binding": {
#     "mode": "workspace-only",                 # or "global" (default) = never skip
#     "detect": ["$CAREER_HOME", "brain/identity/", ".career-os-workspace"]
#   }
# detect: "$ENV" (cwd == realpath($ENV)), "dir/" (cwd/dir exists), "file" (cwd/file exists).
# Any one match => run.
#
# Optional: set WSG_SKIP_ECHO before sourcing to emit a no-op payload on skip
# (e.g. UserPromptSubmit hooks must return {"decision":"approve"}).
#
# Fail-safe: any python/manifest error => skip (never silently run everywhere).

__wsg_root="$(pwd)"
__wsg_plugin="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd)}"

__wsg_decision="$(python3 -c '
import json, os, sys
manifest_path, cwd = sys.argv[1], sys.argv[2]
DEFAULT = {"mode": "workspace-only", "detect": ["$CAREER_HOME", "brain/identity/", ".career-os-workspace"]}
try:
    wb = json.load(open(manifest_path)).get("workspace_binding", {"mode": "global"})
except Exception:
    wb = DEFAULT
if wb.get("mode", "global") != "workspace-only":
    print("run"); sys.exit(0)
cwd_real = os.path.realpath(cwd)
for sig in wb.get("detect", DEFAULT["detect"]):
    if sig.startswith("$"):
        env = os.environ.get(sig[1:], "")
        if env and os.path.realpath(os.path.expanduser(env)) == cwd_real:
            print("run"); sys.exit(0)
    elif sig.endswith("/"):
        if os.path.isdir(os.path.join(cwd, sig)):
            print("run"); sys.exit(0)
    elif os.path.exists(os.path.join(cwd, sig)):
        print("run"); sys.exit(0)
print("skip")
' "$__wsg_plugin/.claude-plugin/plugin.json" "$__wsg_root" 2>/dev/null)" || __wsg_decision="ERR"

if [ "$__wsg_decision" != "run" ]; then
    # if/then (not &&) so this is safe under the `set -e` above.
    if [ -n "${WSG_SKIP_ECHO:-}" ]; then echo "$WSG_SKIP_ECHO"; fi
    exit 0
fi
unset __wsg_root __wsg_plugin __wsg_decision
