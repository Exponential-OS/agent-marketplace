"""CI audit + behavior tests for the workspace-binding gate (XOS-39).

The gate (hooks/scripts/_workspace-gate.sh) is the single, manifest-driven replacement
for the per-script is_career_os_workspace() copy that was forgotten in one of three
sister scripts in v0.66 (the 408-stray-commits incident). These tests make the gate
impossible to forget:

  AUDIT  — every mutating hook script MUST source the gate, and MUST NOT carry an
           inline is_career_os_workspace() copy (regression guard).
  BEHAVE — the gate runs inside a bound workspace and skips outside it.
"""

import json
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOOKS = ROOT / "hooks" / "scripts"
GATE = HOOKS / "_workspace-gate.sh"
MANIFEST = ROOT / ".claude-plugin" / "plugin.json"

# Hook scripts that scaffold cwd-relative files or run git — these MUST gate.
MUTATING_HOOKS = ["init-repo.sh", "capture-prompt.sh", "capture-response.sh"]


def test_gate_file_exists():
    assert GATE.is_file(), "shared workspace gate missing"


def test_manifest_declares_workspace_only():
    wb = json.loads(MANIFEST.read_text()).get("workspace_binding", {})
    assert wb.get("mode") == "workspace-only", "plugin.json must declare workspace_binding.mode=workspace-only"
    assert wb.get("detect"), "workspace_binding.detect must list signals"


def test_every_mutating_hook_sources_the_gate():
    # AUDIT: this is the non-forgettable part. A new mutating hook that skips the
    # gate fails CI here.
    for name in MUTATING_HOOKS:
        body = (HOOKS / name).read_text()
        assert "_workspace-gate.sh" in body and "source" in body, \
            f"{name} does not source _workspace-gate.sh — contamination risk"


def test_no_inline_gate_copies_remain():
    # Regression guard: the inline copy that drifted in v0.66 must not return.
    # Match the function DEFINITION (`name() {`), not comment mentions of it.
    import re
    defn = re.compile(r"is_career_os_workspace\s*\(\)\s*\{")
    for name in MUTATING_HOOKS:
        body = (HOOKS / name).read_text()
        assert not defn.search(body), \
            f"{name} still DEFINES an inline is_career_os_workspace() — use the shared gate"


def _probe(cwd: str, env_extra: dict | None = None) -> bool:
    """Return True if the gate would RUN in `cwd`, False if it skips."""
    probe = tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False)
    probe.write(f'source "{GATE}"\necho RAN\n')
    probe.close()
    env = {**os.environ, "CLAUDE_PLUGIN_ROOT": str(ROOT)}
    env.pop("CAREER_HOME", None)
    if env_extra:
        env.update(env_extra)
    out = subprocess.run(["bash", probe.name], cwd=cwd, capture_output=True, text=True, env=env)
    os.unlink(probe.name)
    return "RAN" in out.stdout


def test_runs_inside_workspace_marker():
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "brain" / "identity").mkdir(parents=True)
        assert _probe(d) is True, "gate must RUN where brain/identity/ exists"


def test_skips_outside_workspace():
    with tempfile.TemporaryDirectory() as d:
        assert _probe(d) is False, "gate must SKIP a plain dir (no workspace markers)"


def test_runs_on_career_home_env_match():
    with tempfile.TemporaryDirectory() as d:
        assert _probe(d, {"CAREER_HOME": d}) is True, "gate must RUN when CAREER_HOME == cwd"
