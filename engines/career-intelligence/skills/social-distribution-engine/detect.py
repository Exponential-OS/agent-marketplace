#!/usr/bin/env python3
"""
detect.py — hijack target scoring for comment-hijack campaigns.

Scores a post on whether it's worth a comment hijack. Call before researching
the comment; don't spend writing time on a SKIP target.

Usage:
  python3 detect.py '{
    "platform": "linkedin",
    "author_followers": 250000,
    "post_age_hours": 4,
    "post_likes": 180,
    "post_comments": 45,
    "post_reposts": 20,
    "topic_relevance": 3,
    "has_prior_engagement": false,
    "post_velocity": "fast"
  }'

Output JSON:
  {
    "verdict": "HIJACK" | "MONITOR" | "SKIP",
    "score": 0-100,
    "signals": {
      "reach": <int>,
      "freshness": <int>,
      "engagement": <int>,
      "relevance": <int>,
      "prior_engagement": <int>,
      "velocity": <int>
    },
    "optimal_post_time": "now" | "within Xh" | "skip",
    "reason": "one-line rationale"
  }

topic_relevance scale:
  3 = direct match (AI + work, agents, cyborg, digital twin, future of work)
  2 = adjacent (productivity, tech leadership, organizational change)
  1 = tangential (general business, loosely tech-adjacent)
  0 = unrelated

post_velocity: "fast" | "normal" | "slow"
  fast   = comments/reposts coming in within minutes of each other
  normal = steady but not surging
  slow   = sparse or stalling
"""
from __future__ import annotations

import json
import sys


# ── Per-platform freshness windows (hours) ────────────────────────────────────
FRESHNESS_WINDOWS = {
    "linkedin": 72,
    "twitter": 8,
    "x": 8,
}

# ── Author reach scoring (follower count → points out of 25) ─────────────────
def _reach_score(platform: str, followers: int | None) -> int:
    if followers is None:
        return 10  # unknown: assume mid-tier

    if platform in ("twitter", "x"):
        if followers >= 1_000_000:
            return 25
        if followers >= 500_000:
            return 20
        if followers >= 100_000:
            return 15
        if followers >= 50_000:
            return 8
        return 0
    else:  # linkedin and everything else
        if followers >= 500_000:
            return 25
        if followers >= 100_000:
            return 20
        if followers >= 50_000:
            return 15
        if followers >= 10_000:
            return 8
        return 0


# ── Post freshness scoring (age_hours → points out of 20) ────────────────────
def _freshness_score(platform: str, age_hours: float | None) -> int:
    if age_hours is None:
        return 8  # unknown: mid-score

    window = FRESHNESS_WINDOWS.get(platform, 48)

    if age_hours > window:
        return 0  # outside window entirely
    if age_hours <= 2:
        return 20
    if age_hours <= 8:
        return 15
    if age_hours <= 24:
        return 10
    return 5


# ── Post engagement scoring (likes + comments + reposts → points out of 20) ──
def _engagement_score(platform: str, likes: int, comments: int, reposts: int) -> int:
    total = likes + comments + reposts

    if platform in ("twitter", "x"):
        # X needs more engagement to be worth targeting (higher volume baseline)
        if total >= 1000:
            return 20
        if total >= 500:
            return 15
        if total >= 200:
            return 10
        if total >= 50:
            return 5
        return 0
    else:  # linkedin
        if total >= 500:
            return 20
        if total >= 200:
            return 15
        if total >= 100:
            return 10
        if total >= 50:
            return 7
        if total >= 20:
            return 3
        return 0


# ── Topic relevance scoring (0-3 manual scale → points out of 20) ────────────
def _relevance_score(relevance: int) -> int:
    mapping = {3: 20, 2: 12, 1: 5, 0: 0}
    return mapping.get(max(0, min(3, relevance)), 0)


# ── Prior engagement bonus (0 or 10 points) ───────────────────────────────────
def _prior_engagement_score(has_prior: bool) -> int:
    return 10 if has_prior else 0


# ── Post velocity scoring (fast/normal/slow → points out of 5) ───────────────
def _velocity_score(velocity: str) -> int:
    mapping = {"fast": 5, "normal": 2, "slow": 0}
    return mapping.get(velocity.lower(), 2)


# ── Optimal post time ─────────────────────────────────────────────────────────
def _optimal_time(platform: str, age_hours: float | None, freshness_pts: int) -> str:
    if freshness_pts == 0:
        return "skip — past freshness window"
    if age_hours is None or age_hours <= 2:
        return "now"

    window = FRESHNESS_WINDOWS.get(platform, 48)
    hours_left = window - (age_hours or 0)
    if hours_left <= 4:
        return "now — closing fast"
    return f"within {min(2, int(hours_left // 3))}h"


def main() -> int:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    if not raw:
        print(json.dumps({"verdict": "SKIP", "score": 0, "reason": "No input provided."}))
        return 1

    try:
        ctx = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "SKIP", "score": 0, "reason": f"Invalid JSON: {e}"}))
        return 1

    platform = ctx.get("platform", "linkedin").lower().strip()
    followers = ctx.get("author_followers")
    age_hours = ctx.get("post_age_hours")
    likes = ctx.get("post_likes", 0)
    comments_count = ctx.get("post_comments", 0)
    reposts = ctx.get("post_reposts", 0)
    relevance = ctx.get("topic_relevance", 2)
    has_prior = ctx.get("has_prior_engagement", False)
    velocity = ctx.get("post_velocity", "normal")

    signals = {
        "reach": _reach_score(platform, followers),
        "freshness": _freshness_score(platform, age_hours),
        "engagement": _engagement_score(platform, likes, comments_count, reposts),
        "relevance": _relevance_score(relevance),
        "prior_engagement": _prior_engagement_score(has_prior),
        "velocity": _velocity_score(velocity),
    }

    score = sum(signals.values())
    optimal_time = _optimal_time(platform, age_hours, signals["freshness"])

    # Hard override: if outside freshness window, always SKIP regardless of score
    if signals["freshness"] == 0:
        verdict = "SKIP"
        reason = f"Post is past the {FRESHNESS_WINDOWS.get(platform, 48)}h freshness window — late comments get zero algorithm distribution."
    elif score >= 60:
        verdict = "HIJACK"
        reason = f"Strong target (score {score}/100) — reach + freshness + engagement justify a substantive comment."
    elif score >= 40:
        verdict = "MONITOR"
        reason = f"Borderline target (score {score}/100) — watch for engagement surge or reconsider if topic relevance increases."
    else:
        verdict = "SKIP"
        reason = f"Weak target (score {score}/100) — signal-to-effort ratio doesn't justify a hijack slot."

    print(json.dumps({
        "verdict": verdict,
        "score": score,
        "signals": signals,
        "optimal_post_time": optimal_time,
        "reason": reason,
    }, indent=2))
    return 0 if verdict in ("HIJACK", "MONITOR") else 1


if __name__ == "__main__":
    sys.exit(main())
