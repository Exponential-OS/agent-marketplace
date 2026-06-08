"""Regression tests for the biographical-claim-precheck gate (XOS-34).

The gate's job: BLOCK resume/outreach drafts that contain biographical numbers
absent from the candidate's canonical sources (fabricated metrics, JD-bleed,
inflated counts), while PASSing drafts whose every number is grounded.

These tests encode the XOS-34 failure modes the eval surfaced:
- invented performance metrics ("60% overhead", "$1.1M savings")
- JD-bleed (an employer's "50M events/sec" lifted into the candidate's bio)
- inflated counts (promoted 4 -> "5 promotions")
and the false-positive guard: an approximate career-total ("10+ years") must
NOT block an otherwise-grounded resume.
"""

import json
import pathlib
import subprocess
import sys

HOW = pathlib.Path(__file__).resolve().parents[1] / "rules" / "biographical-claim-precheck" / "HOW.py"


def _run(draft_text: str, canonical_text: str, tmp_path) -> dict:
    draft = tmp_path / "draft.md"
    canon = tmp_path / "experience-history.md"
    draft.write_text(draft_text, encoding="utf-8")
    canon.write_text(canonical_text, encoding="utf-8")
    ctx = json.dumps(
        {"draft_path": str(draft), "canonical_sources": [str(canon)], "stakes": "T4"}
    )
    proc = subprocess.run(
        [sys.executable, str(HOW), ctx], capture_output=True, text=True
    )
    return {"exit": proc.returncode, "payload": json.loads(proc.stdout)}


CANONICAL = """# Alex Rivera — Experience History
Vantage Systems — Senior Engineering Manager 2019-03 to 2024-11
- Led platform engineering org: 18 engineers across 3 teams
- Owned real-time payments infrastructure processing $2B/year
- Postgres scaling initiative to 1M TPS
- Managed $4.2M annual infra budget
- Grew team from 6 to 18; hired 9 engineers, promoted 4 to senior/staff
"""


def test_grounded_draft_passes(tmp_path):
    draft = (
        "- Owned real-time payments infrastructure processing $2B/year\n"
        "- Scaled Postgres to 1M TPS\n"
        "- Led an 18-engineer org; hired 9, promoted 4 to senior/staff\n"
        "- Managed a $4.2M infrastructure budget\n"
    )
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 0, r["payload"]
    assert r["payload"]["verdict"] == "PASS"


def test_fabricated_percentage_blocks(tmp_path):
    # "60% overhead reduction" and "45% MTTR" are nowhere in canonical.
    draft = "- Reduced operational overhead by 60% and cut MTTR by 45%\n"
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 1
    assert r["payload"]["verdict"] == "BLOCK"


def test_fabricated_dollar_savings_blocks(tmp_path):
    draft = "- Identified $1.1M in savings via reserved-instance planning\n"
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 1


def test_jd_bleed_blocks(tmp_path):
    # The employer's "50M events/sec" lifted into the candidate's bio.
    draft = "- Architected systems handling peak throughput of 50M+ transaction events\n"
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 1


def test_inflated_count_blocks(tmp_path):
    # canonical says "400+" appears nowhere; corridors count is invented.
    draft = "- Owned end-to-end platform serving 400+ payment corridors\n"
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 1


def test_grounded_number_beside_fabricated_still_blocks(tmp_path):
    # $2B is grounded but 99.99% uptime is not — the bullet contains a fabrication.
    draft = "- Owned payments infra processing $2B/year at 99.99% uptime\n"
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 1, "every number in a claim must anchor; one bad number blocks the line"


def test_approx_career_total_is_exempt(tmp_path):
    # "10+ years" is an approximate career-total derived from grounded dates,
    # not a fabricated performance metric. It must not block a grounded resume.
    draft = (
        "Engineering leader with 10+ years of experience.\n"
        "- Owned real-time payments infrastructure processing $2B/year\n"
        "- Led an 18-engineer org\n"
    )
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 0, r["payload"]


def test_precise_tenure_inflation_still_blocks(tmp_path):
    # No "+": a precise "25 years" claim (canonical supports ~5) is checkable and must block.
    draft = "Engineering leader with 25 years at Vantage.\n"
    r = _run(draft, CANONICAL, tmp_path)
    assert r["exit"] == 1
