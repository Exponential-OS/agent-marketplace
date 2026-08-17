#!/usr/bin/env python3
"""
test_lesson_store.py — XOS-250.

The load-bearing test in this file is not "does it record" — it is
**"does it refuse to conclude."** Campaign 12's real numbers are stark
(7,106 group impressions, 0 followers). A learning system that emits a prior
from that at n=1 is doing the exact thing this ticket was written to correct.
So the stark case is asserted to produce NO direction.
"""

from __future__ import annotations

import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "social-distribution-engine"))

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))


# Campaign 12, measured 2026-08-16. Row one, not a finding.
CAMPAIGN_12 = [
    dict(
        campaign="12-token-yield", asset_id="group-5-engineers", surface="linkedin_group",
        attributes={"format": "text_only", "group_member_count": 112095, "moderated": True,
                    "mentions": {"count": 0}, "age_at_measurement_min": 1440},
        outcomes={"impressions": 3553, "engagements": 3, "profile_views": 1, "followers": 0},
        effort={"variants_written": 1, "review_passes": 1, "moderation_wait_min": 180, "total_minutes": 35},
    ),
    dict(
        campaign="12-token-yield", asset_id="group-6-genai", surface="linkedin_group",
        attributes={"format": "text_only", "group_member_count": 352218, "moderated": True,
                    "mentions": {"count": 0}, "age_at_measurement_min": 1440},
        outcomes={"impressions": 3553, "engagements": 2, "profile_views": 0, "followers": 0},
        effort={"variants_written": 1, "review_passes": 1, "moderation_wait_min": 240, "total_minutes": 35},
    ),
    dict(
        campaign="12-token-yield", asset_id="hub-article", surface="linkedin_article",
        attributes={"format": "article", "mentions": {"count": 1, "own_page": True, "resharers": 0},
                    "age_at_measurement_min": 96},
        outcomes={"impressions": 347, "engagements": 9, "profile_views": 2, "followers": 0},
        effort={"variants_written": 1, "review_passes": 3, "total_minutes": 120},
    ),
]


def seed(store, rows, ls):
    for r in rows:
        ls.record_asset(**r)


with tempfile.TemporaryDirectory() as td:
    store = pathlib.Path(td) / "lessons.jsonl"
    os.environ["BAE_LESSON_STORE"] = str(store)
    import lesson_store as ls  # noqa: E402

    print("\nXOS-250 — campaign lesson store\n")

    # --- capture --------------------------------------------------------------
    seed(store, CAMPAIGN_12, ls)
    check("store file created", store.exists())
    rows = ls.load_rows()
    check("all assets recorded", len(rows) == 3, f"got {len(rows)}")
    check("open attribute schema preserves unknown keys",
          rows[0]["attributes"].get("group_member_count") == 112095)
    check("effort is captured as a first-class field",
          rows[0]["effort"].get("total_minutes") == 35)

    # --- THE CRITICAL GUARD ---------------------------------------------------
    d = ls.digest(min_campaigns=15)
    check("n=1 campaign -> NOT sufficient", d["sufficient"] is False,
          f"campaigns={d['campaigns_recorded']}")
    check("n=1 -> summary says INSUFFICIENT out loud", "INSUFFICIENT" in d["summary"])
    check("n=1 -> reports the campaign count", d["campaigns_recorded"] == 1)
    check(
        "STARK data at n=1 still yields NO direction on any surface",
        all(v["direction"] is None for v in d["per_surface"].values()),
        "7,106 group impressions with 0 followers must NOT become a prior at n=1",
    )
    check("rendered digest states the refusal explicitly",
          "No directional read is offered" in ls.render_digest(d))

    # --- facts ARE reportable even when inferences are not --------------------
    grp = d["per_surface"]["linkedin_group"]
    check("group impressions still totalled (measurement, not finding)",
          grp["impressions"] == 7106, f"got {grp['impressions']}")
    check("engagement rate computed from real totals",
          grp["engagement_rate_pct"] is not None and abs(grp["engagement_rate_pct"] - 0.0704) < 0.01,
          str(grp["engagement_rate_pct"]))

    # --- the time-reallocation numbers ----------------------------------------
    check("effort aggregated per surface", grp["effort_minutes"] == 70, str(grp["effort_minutes"]))
    art = d["per_surface"]["linkedin_article"]
    check("engagements-per-hour computed (the return-on-effort view)",
          art["engagements_per_hour"] is not None and abs(art["engagements_per_hour"] - 4.5) < 0.01,
          str(art["engagements_per_hour"]))
    # 0 followers across 70 recorded minutes -> exactly 0.0/hr. Stated precisely
    # rather than "0.0 or None", which would pass under two different bugs.
    check("followers_per_hour is 0.0 for 70 effort-minutes and 0 followers",
          grp["followers_per_hour"] == 0.0, str(grp["followers_per_hour"]))

    # --- headline exclusion ---------------------------------------------------
    check("group surface flagged as NOT counting toward headline",
          grp["counts_toward_headline"] is False)
    check("article surface DOES count toward headline",
          art["counts_toward_headline"] is True)
    check("headline impressions exclude groups",
          d["headline"]["impressions"] == 347, str(d["headline"]["impressions"]))
    check("exclusion is explained, not silent", "hypothesis" in d["headline"]["excluded_note"])

    # --- crossing the threshold ----------------------------------------------
    for i in range(2, 16):
        ls.record_asset(campaign=f"c{i}", asset_id=f"a{i}", surface="linkedin_post",
                        outcomes={"impressions": 100, "engagements": 5, "followers": 1},
                        effort={"total_minutes": 30})
    d2 = ls.digest(min_campaigns=15)
    check("15 campaigns -> sufficient flips True", d2["sufficient"] is True,
          f"campaigns={d2['campaigns_recorded']}")
    check("sufficient summary no longer says INSUFFICIENT", "INSUFFICIENT" not in d2["summary"])
    check("threshold is reported so n is always visible",
          d2["min_campaigns_for_direction"] == 15)

    # --- robustness -----------------------------------------------------------
    with store.open("a", encoding="utf-8") as fh:
        fh.write("{not json\n")
    check("corrupt line skipped, store still readable", len(ls.load_rows()) == 17,
          str(len(ls.load_rows())))

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(0 if failed == 0 else 1)
