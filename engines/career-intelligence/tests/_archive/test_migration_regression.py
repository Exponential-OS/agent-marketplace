"""
Regression tests for the migration script — Codex findings #2, #4, #5.

Covers:
- Idempotency: a second `--all` run changes no rows
- Per-batch dolt commit: migration_log.dolt_commit_sha is populated
- Reconcile: orphaned rows get deleted when their source file disappears
- Rejected section: `rejected` is preserved as a distinct value (not mapped to `inactive`)

Runs against the live Dolt server; skipped if unreachable.
"""
from __future__ import annotations
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
sys.path.insert(0, str(PLUGIN / "dev"))

MIGRATE_SCRIPT = Path.home() / "cyborg" / "brain-db" / "migrate_career_os.py"
PY = str(Path.home() / "cyborg" / "brain-db" / ".venv" / "bin" / "python")


def _dolt_up() -> bool:
    try:
        with socket.create_connection(
            (os.environ.get("CYBORG_DB_HOST", "127.0.0.1"),
             int(os.environ.get("CYBORG_DB_PORT", "3306"))), timeout=1):
            return True
    except OSError:
        return False


DOLT_UP = _dolt_up()
requires_dolt = pytest.mark.skipif(not DOLT_UP, reason="Dolt server not reachable on 3306")


def _run_migration(*entities: str, env_override: dict | None = None) -> subprocess.CompletedProcess:
    cmd = [PY, str(MIGRATE_SCRIPT), *entities]
    env = {**os.environ, **(env_override or {})}
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env)


@requires_dolt
def test_migration_idempotent_small_batch():
    """Running the same entities twice produces reconciled=0 on the second run."""
    import re
    r1 = _run_migration("identity", "scoring_meta")
    assert r1.returncode == 0, f"first run failed: {r1.stderr}"
    r2 = _run_migration("identity", "scoring_meta")
    assert r2.returncode == 0, f"second run failed: {r2.stderr}"
    for line in r2.stdout.splitlines():
        if line.startswith("[") and "reconciled=" in line:
            m = re.search(r"reconciled=\s*(\d+)", line)
            assert m, f"couldn't parse reconciled from: {line!r}"
            n = int(m.group(1))
            assert n == 0, f"expected reconciled=0 on idempotent rerun, got {line!r}"


@requires_dolt
def test_migration_log_has_commit_sha():
    """Codex #2: migration_log.dolt_commit_sha must be populated, not NULL."""
    from memory_adapter import Adapter  # type: ignore
    _run_migration("identity")
    with Adapter() as a:
        rows = a._q(
            "SELECT entity, dolt_commit_sha FROM migration_log "
            "WHERE script_name='migrate_career_os.py' "
            "ORDER BY id DESC LIMIT 3"
        )
    recent = rows[0]
    assert recent["dolt_commit_sha"], (
        f"dolt_commit_sha is NULL for most recent migration ({recent['entity']})"
    )
    assert len(recent["dolt_commit_sha"]) >= 16, \
        f"sha too short: {recent['dolt_commit_sha']}"


@requires_dolt
def test_rejected_section_distinct_from_inactive():
    """Codex #4: `rejected` or `inactive_rejected` must exist as a distinct
    section value, not silently lumped into `inactive`."""
    from memory_adapter import Adapter  # type: ignore
    _run_migration("applications")
    with Adapter() as a:
        sections = {r["section"] for r in a._q("SELECT DISTINCT section FROM applications")
                    if r["section"]}
        rejected_present = a._q(
            "SELECT COUNT(*) AS n FROM applications "
            "WHERE UPPER(status) LIKE '%REJECT%' OR UPPER(status) LIKE '%DEAD%'"
        )
    if rejected_present[0]["n"] > 0:
        rejected_aware = sections & {"rejected", "inactive_rejected"}
        assert rejected_aware, (
            f"rejections exist but no 'rejected'-aware section found. sections={sections}"
        )


@requires_dolt
def test_reconcile_removes_orphan(tmp_path):
    """Codex #2 (part b): re-running after removing a source file deletes the orphan."""
    home = tmp_path / "career-os-home"
    events_dir = home / ".career-os" / "memory" / "events"
    events_dir.mkdir(parents=True)

    event_a = events_dir / "2026-05-01-testa.md"
    event_a.write_text(
        "---\nname: Test Event A\ndate: 2026-05-01\ntype: test\n---\n\n# Test A\n"
    )
    event_b = events_dir / "2026-05-02-testb.md"
    event_b.write_text(
        "---\nname: Test Event B\ndate: 2026-05-02\ntype: test\n---\n\n# Test B\n"
    )

    r1 = _run_migration("events", env_override={"CAREER_OS_HOME": str(home)})
    assert r1.returncode == 0, f"first run: {r1.stderr}"

    from memory_adapter import Adapter  # type: ignore
    with Adapter() as a:
        got = a._q("SELECT slug FROM events WHERE source_path LIKE %s", (f"{home}%",))
    got_slugs = {r["slug"] for r in got}
    assert "2026-05-01-testa" in got_slugs
    assert "2026-05-02-testb" in got_slugs

    event_b.unlink()
    r2 = _run_migration("events", env_override={"CAREER_OS_HOME": str(home)})
    assert r2.returncode == 0, f"second run: {r2.stderr}"

    with Adapter() as a:
        got2 = a._q("SELECT slug FROM events WHERE source_path LIKE %s", (f"{home}%",))
    got_slugs2 = {r["slug"] for r in got2}
    assert "2026-05-01-testa" in got_slugs2, "survivor removed"
    assert "2026-05-02-testb" not in got_slugs2, (
        "orphan NOT removed by reconcile — Codex #2 regression"
    )

    # cleanup
    with Adapter() as a:
        a._exec("DELETE FROM events WHERE source_path LIKE %s", (f"{home}%",))


@requires_dolt
def test_new_adapter_methods_exist():
    """Codex #3 / Gemini #1: spec-required methods present."""
    from memory_adapter import Adapter  # type: ignore
    with Adapter() as a:
        for method in ("get_role", "upsert_role", "get_application", "upsert_application",
                       "get_story", "get_skill", "append_task"):
            assert hasattr(a, method), f"missing adapter method: {method}"
        # Functional check: upsert + roundtrip
        from memory_adapter import Role  # type: ignore
        test_role = Role(
            slug="__test_upsert__", company="TestCo", role_title="Test EM",
            score=77, decision="TEST", batch_date="test-batch",
        )
        a.upsert_role(test_role)
        fetched = a.get_role("__test_upsert__")
        assert fetched is not None
        assert fetched.company == "TestCo"
        assert fetched.score == 77
        # cleanup
        a._exec("DELETE FROM roles WHERE slug = %s", ("__test_upsert__",))


@requires_dolt
def test_list_stories_by_competency():
    """Codex #3 / Gemini #1: list_stories(competency=) filter works."""
    from memory_adapter import Adapter  # type: ignore
    with Adapter() as a:
        all_stories = a.list_stories()
        if not all_stories or not any(s.competencies for s in all_stories):
            pytest.skip("no stories with competencies populated")
        # pick the first competency we find
        sample = next(s for s in all_stories if s.competencies)
        comp = sample.competencies[0]
        filtered = a.list_stories(competency=comp)
        assert len(filtered) >= 1
        assert all(comp in s.competencies for s in filtered)
