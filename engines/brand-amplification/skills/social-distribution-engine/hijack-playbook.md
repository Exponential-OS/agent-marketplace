---
name: Comment Hijack Playbook
type: strategy
scope: distribution-engine
created: 2026-05-07
updated: 2026-05-17
status: active
customer-config: "$CAREER_HOME/brand-amplification/identity/hijack-examples.md"
related: content-flywheel.md
---


# Comment / Article Hijack Playbook

A "hijack" = posting a substantive comment on a high-engagement influencer post
that drives traffic to your hub. Spokes in the P16 hub-and-spoke flywheel.

## Enforcement gate

Before any hijack comment posts, run the comment-hijack gate from the installed plugin:
```
python3 $PLUGIN_RULES/comment-hijack-gate/HOW.py '{
  "platform": "linkedin",
  "target_post_url": "...",
  "target_post_age_hours": 18,
  "comment_text": "...",
  "hub_url": "...",
  "previously_commented_urls": []
}'
```
Exit 0 = safe to post. Exit 1 = blocked with remediation.

---

## Target Selection Criteria

Run `$PLUGIN_RULES/detect.py` first — it scores all signals and returns HIJACK/MONITOR/SKIP.
Manual thresholds below are for triage when the script isn't available.

### Minimum thresholds
| Signal | LinkedIn | X/Twitter | Notes |
|--------|----------|-----------|-------|
| Follower count | >50k | >500k | Below these, reach doesn't justify writing time |
| Post age | <72h | <8h | Hard ceiling — baked into gate and detect.py |
| Engagement (likes+comments+reposts) | >50 | >200 | Low engagement = no distribution surface |
| Topic relevance | ≥2 (adjacent) | ≥2 (adjacent) | 0-3 scale; see detect.py header |

### Tier 1 targets (score ≥80 in detect.py)
Authors: 500k+ LinkedIn followers, 1M+ X followers. Any topic-relevant post <24h old
with surging engagement. Example tier: Karpathy, Reid Hoffman, Andrew Ng, Shreyas Doshi.
These posts get the full ClawCamp-style substantive comment — 3-4 sentences, named claim,
personal angle, hub link.

### Tier 2 targets (score 60-79 in detect.py)
Authors: 50k-500k LinkedIn, 100k-1M X. Good engagement on directly-relevant topic.
Example tier: ClawCamp organizers, domain-adjacent thought leaders.
Shorter comment (2-3 sentences) is fine here — signal/effort ratio matters more.

### Strong signals (add 10-15 to mental score)
- Post is directly on your thesis (AI + work, cyborg, agents, digital twin)
- Author has engaged with your content before
- Post is gaining velocity (comments coming in within minutes of each other)
- Post has a genuine question or debate you can add to

### Weak signals / skip conditions
- Author posts only about unrelated topics (topic_relevance = 0)
- Post is >48h on LinkedIn, >8h on X with engagement stalling
- Your hub is only tangentially related — forced connection gets no engagement
- Author is known for not engaging with comments (wasted slot)

---

## Comment Structure

**Formula:** Genuine insight/extension → connect to your thread → hub link as closer (not opener)

**Pattern:**
```
[Their point restated with your lens] — [your extension or counter or data point].
[One sentence connecting to your talk/article].
[Hub link with soft CTA]: [URL]
```

**Anti-patterns:**
- "Check out my post on this" → BLOCKED by gate
- Agreeing without adding anything → gate catches via length
- Dropping link with no context → gate catches (hub_url not in comment or too short)

---

## Platform-Specific Rules

### LinkedIn
- External links in comments are NOT penalized (unlike post body) — include hub URL directly
- Tag the author only if you have a genuine connection point to their specific claim
- Best time: within 2h of post going live (algorithm surface window)
- Self-reply with Substack link 30 min later if you want the honey pot path too

### X / Twitter
- 8h freshness window — X moves fast, dead posts get zero distribution
- Quote-tweet > reply if your addition is meaty (own distribution graph)
- Keep under 280 chars for replies; thread if longer
- No link penalty in replies

---

## Logged Hijacks

Customer-specific logged hijacks live in `$CAREER_HOME/brand-amplification/identity/hijack-examples.md`.

Template for each row:

| Date | Person | Platform | Post URL | Hub URL | Engagement delta | Outcome |
|------|--------|----------|----------|---------|-----------------|---------|
| YYYY-MM-DD | Name | LinkedIn/X | post_url | hub_url | TBD | LIVE/PENDING |

---

## Implementation Status
- [x] Standalone_value LLM judge built in comment-hijack-gate (Gate 4)
- [x] Minimum thresholds calibrated from real hijack data
- [x] `detect.py` built for automated target scoring
