"""
lesson_store.py — Brand Amplification's memory across campaigns.

XOS-250. The engine shipped campaigns and learned nothing from them. Every
campaign started from zero, so it was a publisher, not an engine.

THE POINT IS ANAND'S HOURS, NOT A DASHBOARD
    "our goal is to increase time spent on high value content generation and
     distribution and less on the 80% noise that doesn't move the needle."

That framing has a consequence the ticket did not spell out: **you cannot
reallocate time you never recorded.** Impressions alone can only ever produce an
engagement chart. So `effort` is a first-class field here, sibling to outcomes —
without it, "0.07% engagement" is half a ratio and the product can never say
"stop spending that hour."

THE THING THIS MODULE MOSTLY DOES IS REFUSE TO CONCLUDE
Campaign 12 is row one, not a finding. A single campaign cannot teach anything
about LinkedIn's algorithm, and a prior asserted at n=1 is noise dressed as
signal — the exact error this ticket was written to correct. So the digest
withholds direction until sample size justifies it and always reports n. Silence
is the honest output early on.

Recording is cheap and always allowed. Concluding is gated.
"""

from __future__ import annotations

import json
import os
import pathlib
from collections import defaultdict
from datetime import datetime, timezone

STORE_ENV = "BAE_LESSON_STORE"
STATE_DIR_ENV = "CLAUDE_PLUGIN_DATA"
DEFAULT_STATE_DIR = "~/.career-os-state"
STORE_NAME = "campaign-lessons.jsonl"

# "somewhere north of 15-20 campaigns" — the ticket's own number. Below this the
# digest reports insufficient data rather than a direction. Overridable so tests
# and future recalibration do not require an edit here.
MIN_CAMPAIGNS_FOR_DIRECTION = int(os.environ.get("BAE_MIN_CAMPAIGNS", "15"))

# Group impressions are excluded from headline success by default (ticket:
# "Do not count group impressions toward campaign success"). This is a DEFAULT,
# not a deletion — the rows stay, and the hypothesis stays testable.
HEADLINE_EXCLUDED_SURFACES = {"linkedin_group"}


def store_path() -> pathlib.Path:
    override = os.environ.get(STORE_ENV)
    if override:
        return pathlib.Path(override).expanduser()
    base = os.environ.get(STATE_DIR_ENV) or DEFAULT_STATE_DIR
    return pathlib.Path(base).expanduser() / STORE_NAME


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def record_asset(
    campaign: str,
    asset_id: str,
    surface: str,
    attributes: dict | None = None,
    outcomes: dict | None = None,
    effort: dict | None = None,
) -> dict:
    """
    Append one asset row. Never raises — a capture failure must not break a ship.

    `attributes` is deliberately open. New dimensions will be named that we have
    not thought of, and a closed schema would silently drop them; an unknown key
    is preserved and simply not yet summarized.
    """
    rec = {
        "ts": _now(),
        "campaign": campaign,
        "asset_id": asset_id,
        "surface": surface,
        "attributes": attributes or {},
        "outcomes": outcomes or {},
        "effort": effort or {},
    }
    try:
        p = store_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    except Exception:
        pass
    return rec


def load_rows() -> list[dict]:
    p = store_path()
    if not p.exists():
        return []
    rows = []
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except Exception:
        return []
    return rows


def engagement_rate(outcomes: dict) -> float | None:
    imp = outcomes.get("impressions")
    eng = outcomes.get("engagements")
    if not isinstance(imp, (int, float)) or not imp:
        return None
    if not isinstance(eng, (int, float)):
        return None
    return round(eng / imp * 100, 4)


def _num(v) -> float:
    return float(v) if isinstance(v, (int, float)) else 0.0


def digest(rows: list[dict] | None = None, min_campaigns: int | None = None) -> dict:
    """
    Summarize what has been recorded, and REFUSE to state direction early.

    The return always carries `campaigns_recorded` and `sufficient`. When
    `sufficient` is False, `per_surface` still reports observed totals (facts we
    measured) but `direction` is None everywhere and `headline` says so. Facts
    are always reportable; inferences are not.
    """
    rows = load_rows() if rows is None else rows
    threshold = MIN_CAMPAIGNS_FOR_DIRECTION if min_campaigns is None else min_campaigns

    campaigns = {r.get("campaign") for r in rows if r.get("campaign")}
    n_campaigns = len(campaigns)
    sufficient = n_campaigns >= threshold

    by_surface: dict[str, dict] = defaultdict(
        lambda: {
            "assets": 0,
            "campaigns": set(),
            "impressions": 0.0,
            "engagements": 0.0,
            "followers": 0.0,
            "profile_views": 0.0,
            "effort_minutes": 0.0,
        }
    )
    for r in rows:
        s = r.get("surface") or "unknown"
        o = r.get("outcomes") or {}
        e = r.get("effort") or {}
        b = by_surface[s]
        b["assets"] += 1
        if r.get("campaign"):
            b["campaigns"].add(r["campaign"])
        b["impressions"] += _num(o.get("impressions"))
        b["engagements"] += _num(o.get("engagements"))
        b["followers"] += _num(o.get("followers"))
        b["profile_views"] += _num(o.get("profile_views"))
        b["effort_minutes"] += _num(e.get("total_minutes"))

    per_surface = {}
    for s, b in by_surface.items():
        imp = b["impressions"]
        mins = b["effort_minutes"]
        per_surface[s] = {
            "assets": b["assets"],
            "campaigns": len(b["campaigns"]),
            "impressions": imp,
            "engagements": b["engagements"],
            "engagement_rate_pct": round(b["engagements"] / imp * 100, 4) if imp else None,
            "followers": b["followers"],
            "profile_views": b["profile_views"],
            "effort_minutes": mins,
            # The time-reallocation numbers. These are what turn into an hour saved.
            "followers_per_hour": round(b["followers"] / (mins / 60), 3) if mins else None,
            "engagements_per_hour": round(b["engagements"] / (mins / 60), 3) if mins else None,
            "counts_toward_headline": s not in HEADLINE_EXCLUDED_SURFACES,
            # Gated. Never a direction below threshold, no matter how stark the row looks.
            "direction": None,
        }

    headline_surfaces = [s for s in per_surface if s not in HEADLINE_EXCLUDED_SURFACES]
    headline = {
        "impressions": sum(per_surface[s]["impressions"] for s in headline_surfaces),
        "followers": sum(per_surface[s]["followers"] for s in headline_surfaces),
        "excluded_surfaces": sorted(HEADLINE_EXCLUDED_SURFACES),
        "excluded_note": (
            "Group impressions are excluded from headline success by default (XOS-250). "
            "The rows are still recorded — whether groups earn their hour is a hypothesis "
            "for the table to settle, not a conclusion drawn today."
        ),
    }

    if sufficient:
        summary = (
            f"{n_campaigns} campaigns recorded — at or above the {threshold}-campaign "
            "threshold. Directional reads may now be computed; each must still carry n."
        )
    else:
        summary = (
            f"INSUFFICIENT DATA — {n_campaigns} campaign(s) recorded, "
            f"{threshold} needed before any direction is stated. "
            "Totals below are measurements, not findings. A prior asserted now would be "
            "noise dressed as signal."
        )

    return {
        "campaigns_recorded": n_campaigns,
        "assets_recorded": len(rows),
        "min_campaigns_for_direction": threshold,
        "sufficient": sufficient,
        "summary": summary,
        "headline": headline,
        "per_surface": per_surface,
    }


def render_digest(d: dict | None = None) -> str:
    d = digest() if d is None else d
    lines = ["Brand Amplification — campaign lesson store", ""]
    lines.append(d["summary"])
    lines.append("")
    lines.append(f"  campaigns: {d['campaigns_recorded']}   assets: {d['assets_recorded']}")
    lines.append("")
    lines.append(f"{'surface':<20}{'assets':>7}{'impr':>10}{'eng%':>8}{'flw':>6}{'mins':>7}{'flw/hr':>9}  headline")
    for s, b in sorted(d["per_surface"].items()):
        er = "-" if b["engagement_rate_pct"] is None else f"{b['engagement_rate_pct']:.2f}"
        fph = "-" if b["followers_per_hour"] is None else f"{b['followers_per_hour']:.2f}"
        lines.append(
            f"{s:<20}{b['assets']:>7}{int(b['impressions']):>10}{er:>8}"
            f"{int(b['followers']):>6}{int(b['effort_minutes']):>7}{fph:>9}"
            f"  {'yes' if b['counts_toward_headline'] else 'no'}"
        )
    lines.append("")
    if not d["sufficient"]:
        lines.append("No directional read is offered. That is the correct output at this n.")
    return "\n".join(lines)


if __name__ == "__main__":
    print(render_digest())
