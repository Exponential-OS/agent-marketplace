"""
Adapter test suite — Dolt-canonical (v0.21.0+).

No fallback. If Dolt is down, tests that require it are SKIPPED (CI stays
green in environments without the DB), but fail-fast behavior is asserted:
the adapter MUST raise `AdapterUnreachable` when it can't reach the DB.

    pytest tests/test_memory_adapter.py -v
"""
from __future__ import annotations
import os
import socket
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
sys.path.insert(0, str(PLUGIN / "dev"))

from memory_adapter import (  # type: ignore
    Adapter, AdapterUnreachable, Role, Application, Story, SkillRow, Person,
)


def _dolt_up() -> bool:
    host = os.environ.get("CYBORG_DB_HOST", "127.0.0.1")
    port = int(os.environ.get("CYBORG_DB_PORT", "3306"))
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


DOLT_UP = _dolt_up()
requires_dolt = pytest.mark.skipif(not DOLT_UP, reason="Dolt server not reachable on 3306")


# ---------- fail-fast (always runs, no DB required) ----------

def test_adapter_raises_when_dolt_unreachable(monkeypatch):
    """If Dolt is down, adapter MUST raise — never silently return empty.
    Uses env override; no module reload (adapter reads env at __init__)."""
    monkeypatch.setenv("CYBORG_DB_PORT", "1")  # nothing listens on port 1
    monkeypatch.setenv("CYBORG_DB_TIMEOUT", "1")
    with pytest.raises(AdapterUnreachable) as ei:
        Adapter()
    assert "Cannot connect to Dolt" in str(ei.value)


def test_no_md_fallback_methods_exist():
    """Regression: adapter must not re-introduce .md reader methods."""
    forbidden = [attr for attr in dir(Adapter) if attr.startswith("_md_")]
    assert not forbidden, f"forbidden fallback methods present: {forbidden}"


# ---------- healthcheck ----------

@requires_dolt
def test_health_dolt_backend():
    with Adapter() as a:
        h = a.healthcheck()
        assert h.backend == "dolt"
        assert h.reachable is True
        for t in ("roles", "stories", "people", "applications", "skills_matrix",
                  "identity", "scoring_metadata", "projects", "references",
                  "events", "interview_prep", "tasks", "migration_log"):
            assert t in h.tables, f"missing table: {t}"
        assert h.row_counts["stories"] >= 1
        assert h.row_counts["people"] >= 1


# ---------- roles ----------

@requires_dolt
def test_roles_filters():
    with Adapter() as a:
        top = a.list_roles(min_score=90)
        for r in top:
            assert isinstance(r, Role)
            assert r.score is None or r.score >= 90
            assert r.company


@requires_dolt
def test_get_role_by_slug_round_trip():
    with Adapter() as a:
        some = a.list_roles(min_score=85)
        assert some, "expected at least one high-score role"
        fetched = a.get_role(some[0].slug)
        assert fetched is not None
        assert fetched.slug == some[0].slug
        assert fetched.company == some[0].company


@requires_dolt
def test_roles_company_filter():
    with Adapter() as a:
        anthropic = a.list_roles(company="Anthropic")
        for r in anthropic:
            assert "anthropic" in (r.company or "").lower()


@requires_dolt
def test_roles_tier_filter_uses_normalized_column():
    """v0.22.0 #3: tier= uses the indexed decision_tier column.
    Validates back-population + new Role dataclass field."""
    with Adapter() as a:
        full_invest = a.list_roles(tier="FULL_INVEST")
        assert len(full_invest) >= 1, "expected ≥1 FULL_INVEST role"
        for r in full_invest:
            assert r.decision_tier == "FULL_INVEST", (
                f"tier filter returned {r.decision_tier} for {r.slug}"
            )


@requires_dolt
def test_decision_enum_auto_promotes_to_tier():
    """When decision=... is a KNOWN enum (FULL_INVEST/APPLY/CHECK_DELTA/SKIP),
    adapter auto-promotes to indexed tier lookup for performance."""
    with Adapter() as a:
        via_enum = a.list_roles(decision="FULL_INVEST")
        via_tier = a.list_roles(tier="FULL_INVEST")
        # Same set (both hit the indexed column)
        assert {r.slug for r in via_enum} == {r.slug for r in via_tier}


@requires_dolt
def test_list_roles_batch_date_window():
    """v0.23.0 #4: indexed batch_date_dt column powers date-window queries."""
    with Adapter() as a:
        recent = a.list_roles(batch_after="2026-04-01")
        for r in recent:
            # Returned rows must have batch_date_dt populated >= 2026-04-01
            # (verified indirectly: prose batch_date should start with 2026-04 or later)
            if r.batch_date and r.batch_date != "retroactive":
                assert r.batch_date >= "2026-04-01" or "retroactive" in r.batch_date


@requires_dolt
def test_list_recent_stories_uses_dt_index():
    """v0.23.0 #4: list_recent_stories() filters via story_date_dt index."""
    with Adapter() as a:
        recent = a.list_recent_stories(since="2025-01-01")
        # All returned stories must have story_date_dt >= 2025-01-01
        # (NULL-date stories excluded by design)
        for s in recent:
            if s.story_date:
                assert s.story_date.startswith(("2025", "2026", "2027"))


@requires_dolt
def test_list_people_last_contact_window():
    """v0.23.0 #4: last_contact_before / _after for decay-aware re-contact."""
    with Adapter() as a:
        # Just verify the method accepts the args and returns a list
        # (most rows have NULL last_contact_dt — empty result is fine)
        old_contacts = a.list_people(last_contact_before="2025-01-01")
        assert isinstance(old_contacts, list)
        recent_contacts = a.list_people(last_contact_after="2026-01-01")
        assert isinstance(recent_contacts, list)


@requires_dolt
def test_upsert_role_derives_tier_when_missing():
    """upsert_role populates decision_tier from decision when caller omits it."""
    with Adapter() as a:
        from memory_adapter import Role  # type: ignore
        test = Role(
            slug="__test_tier_derive__", company="TestCo", role_title="Test EM",
            score=88, decision="⭐ FULL INVEST",  # decision_tier intentionally left None
            batch_date="test-batch",
        )
        a.upsert_role(test)
        fetched = a.get_role("__test_tier_derive__")
        assert fetched is not None
        assert fetched.decision_tier == "FULL_INVEST", (
            f"expected tier derived from decision; got {fetched.decision_tier}"
        )
        # cleanup
        a._exec("DELETE FROM roles WHERE slug = %s", ("__test_tier_derive__",))


# ---------- stories ----------

@requires_dolt
def test_count_stories_dolt():
    with Adapter() as a:
        assert a.count_stories_recursive() >= 1


@requires_dolt
def test_list_stories_shape():
    with Adapter() as a:
        stories = a.list_stories()
        assert len(stories) >= 1
        for s in stories[:5]:
            assert s.slug
            assert isinstance(s.competencies, list)
            assert isinstance(s.tags, list)


# ---------- coherence C1 (replaces 10-col regex) ----------

@requires_dolt
def test_C1_role_row_shape():
    with Adapter() as a:
        rows = a.list_roles(min_score=80)
        assert len(rows) >= 1
        for r in rows[:10]:
            assert r.company, f"empty company for {r.slug}"
            assert isinstance(r.score, int) or r.score is None


# ---------- people (brain layer) ----------

@requires_dolt
def test_list_people():
    with Adapter() as a:
        rows = a.list_people()
        assert len(rows) >= 1
        assert all(p.name for p in rows[:10])


@requires_dolt
def test_people_warmth_filter():
    with Adapter() as a:
        warm = a.list_people(warmth_min=3)
        for p in warm:
            assert p.warmth is None or p.warmth >= 3


# ---------- skills ----------

@requires_dolt
def test_skills_category_filter():
    with Adapter() as a:
        langs = a.list_skills(category="languages")
        assert len(langs) >= 1
        for s in langs:
            assert s.category == "languages"
            assert s.skill


@requires_dolt
def test_skills_no_filter_returns_all_categories():
    with Adapter() as a:
        all_skills = a.list_skills()
        cats = {s.category for s in all_skills}
        assert len(cats) >= 2, f"expected multiple categories, got {cats}"


# ---------- applications ----------

@requires_dolt
def test_applications_section_filter():
    with Adapter() as a:
        active = a.list_applications(section="active")
        for a_row in active:
            assert a_row.section == "active"


# ---------- identity + scoring ----------

@requires_dolt
def test_get_identity_known_keys():
    with Adapter() as a:
        for key in ("identity", "brand", "experience", "professional-brand", "strategy"):
            row = a.get_identity(key)
            # not all keys may be populated — but if present, body_md must exist
            if row is not None:
                assert row["key"] == key
                assert row["body_md"]


@requires_dolt
def test_get_scoring_metadata_known_keys():
    with Adapter() as a:
        for key in ("jd_alignment", "ats_rules", "resume_guide"):
            row = a.get_scoring_metadata(key)
            if row is not None:
                assert row["key"] == key
                assert row["body_md"]
