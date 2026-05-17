# product-vs-solution: example — test fixture with Anand-personal names as plausible synthetic data.

"""test_outreach_dedup.py — pytest port of test-outreach-dedup.sh

Tests warm-contact-outreach-dedup/HOW.py by calling check() directly.
Requires CAREER_HOME or falls back to ~/anand-career-os.
"""
from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys
import textwrap

import pytest

# ---------------------------------------------------------------------------
# Import HOW.py from the plugin repo (sibling of tests/)
# ---------------------------------------------------------------------------
_PLUGIN_ROOT = pathlib.Path(__file__).parent.parent
_HOW_PATH = _PLUGIN_ROOT / "rules" / "warm-contact-outreach-dedup" / "HOW.py"
_SKILL_PATH = _PLUGIN_ROOT / "skills" / "outreach-composer" / "SKILL.md"

spec = importlib.util.spec_from_file_location("HOW", _HOW_PATH)
HOW = importlib.util.module_from_spec(spec)
spec.loader.exec_module(HOW)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _date(days_ago: int) -> str:
    return (datetime.date.today() - datetime.timedelta(days=days_ago)).isoformat()


def _write_person(tmp_path: pathlib.Path, name: str, *, last_contact: str | None = None,
                  conv_last_sent: str | None = None) -> pathlib.Path:
    slug = name.lower().replace(" ", "-")
    p = tmp_path / f"{slug}.md"
    lines = ["---", f"name: {name}"]
    if last_contact:
        lines.append(f"last_contact: {last_contact}")
    if conv_last_sent:
        lines.extend(["conversation_history:", f"  last_message_sent: {conv_last_sent}"])
    lines += ["---", f"# {name}"]
    p.write_text("\n".join(lines))
    return p


def _call(d: dict, tmp_path: pathlib.Path) -> dict:
    """Call HOW.check() and normalise to a result dict."""
    d.setdefault("people_dir", str(tmp_path))
    result = HOW.check(d)
    if result is None:
        return {"verdict": "PASS"}
    return result


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestBlock:
    def test_recent_3_days_exit_code_via_verdict(self, tmp_path):
        _write_person(tmp_path, "Test Person", last_contact=_date(3))
        r = _call({"contact_name": "Test Person"}, tmp_path)
        assert r["verdict"] == "BLOCK"

    def test_recent_3_days_has_days_since(self, tmp_path):
        _write_person(tmp_path, "Test Person 2", last_contact=_date(3))
        r = _call({"contact_name": "Test Person 2"}, tmp_path)
        assert "days_since_outreach" in r

    def test_missing_contact_name_blocks(self, tmp_path):
        r = _call({}, tmp_path)
        assert r["verdict"] == "BLOCK"

    def test_missing_contact_name_verdict_in_result(self, tmp_path):
        r = _call({}, tmp_path)
        assert "verdict" in r

    def test_exactly_14_day_boundary_blocks(self, tmp_path):
        _write_person(tmp_path, "Boundary Person", last_contact=_date(14))
        r = _call({"contact_name": "Boundary Person"}, tmp_path)
        assert r["verdict"] == "BLOCK"

    def test_conversation_history_fallback_blocks(self, tmp_path):
        _write_person(tmp_path, "Fallback Person", conv_last_sent=_date(2))
        r = _call({"contact_name": "Fallback Person"}, tmp_path)
        assert r["verdict"] == "BLOCK"

    def test_conversation_history_fallback_verdict_key(self, tmp_path):
        _write_person(tmp_path, "Fallback Person 2", conv_last_sent=_date(2))
        r = _call({"contact_name": "Fallback Person 2"}, tmp_path)
        assert "verdict" in r


class TestPass:
    def test_old_contact_20_days_passes(self, tmp_path):
        _write_person(tmp_path, "Old Contact", last_contact=_date(20))
        r = _call({"contact_name": "Old Contact"}, tmp_path)
        assert r["verdict"] == "PASS"

    def test_old_contact_verdict_key(self, tmp_path):
        _write_person(tmp_path, "Old Contact 2", last_contact=_date(20))
        r = _call({"contact_name": "Old Contact 2"}, tmp_path)
        assert "verdict" in r

    def test_no_file_passes(self, tmp_path):
        r = _call({"contact_name": "Nobody Exists"}, tmp_path)
        assert r["verdict"] == "PASS"

    def test_no_file_verdict_key(self, tmp_path):
        r = _call({"contact_name": "Nobody Exists 2"}, tmp_path)
        assert "verdict" in r

    def test_custom_lookback_days_pass(self, tmp_path):
        _write_person(tmp_path, "Custom Person", last_contact=_date(5))
        r = _call({"contact_name": "Custom Person", "lookback_days": 3}, tmp_path)
        assert r["verdict"] == "PASS"

    def test_custom_lookback_days_verdict_key(self, tmp_path):
        _write_person(tmp_path, "Custom Person 2", last_contact=_date(5))
        r = _call({"contact_name": "Custom Person 2", "lookback_days": 3}, tmp_path)
        assert "verdict" in r


class TestSkillMd:
    def test_skill_md_has_step_0(self):
        assert _SKILL_PATH.exists(), f"SKILL.md not found at {_SKILL_PATH}"
        assert "STEP 0" in _SKILL_PATH.read_text()

    def test_skill_md_references_dedup_rule(self):
        assert "warm-contact-outreach-dedup" in _SKILL_PATH.read_text()

    def test_skill_md_has_dedup_block_stop(self):
        assert "DEDUP BLOCK" in _SKILL_PATH.read_text()
