---
name: linkedin-distribution-module
description: >
  Specialized skill for mastering LinkedIn distribution. Encapsulates LinkedIn's
  algorithmic rules, manages Groups, and ensures optimal Comment Cascade execution.
triggers:
  - post to linkedin
  - linkedin distribution
  - linkedin campaign
---

# LinkedIn Distribution Module

## Purpose

This skill specializes in LinkedIn content distribution. It encapsulates the "invisible" algorithmic rules of the platform to maximize organic reach and prevent spam or penalties. 

## Output Format

Always start your response with:
```
━━━ Career OS: LinkedIn Distribution Module ━━━
```

## Comment Hijack Gates (MANDATORY for hijack-style comments)

A "hijack" = posting a substantive comment on an influencer post to drive traffic to your hub.
Two gates fire before any hijack comment is posted.

### Gate A — Target scoring (run first, before writing the comment)

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/social-distribution-engine/detect.py 2>/dev/null | tail -1)" '{
  "platform": "linkedin",
  "author_followers": <int or omit if unknown>,
  "post_age_hours": <float>,
  "post_likes": <int>,
  "post_comments": <int>,
  "post_reposts": <int>,
  "topic_relevance": <0-3: 3=direct AI/work/agents match, 2=adjacent, 1=tangential, 0=unrelated>,
  "has_prior_engagement": <true if author has engaged with your content>,
  "post_velocity": "fast|normal|slow"
}'
```

Exit 0 = HIJACK or MONITOR (proceed to write the comment).
Exit 1 = SKIP (don't write — surface the score and reason to the user).

### Gate B — Comment quality + dedup (run before posting)

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/rules/comment-hijack-gate/HOW.py 2>/dev/null | tail -1)" '{
  "platform": "linkedin",
  "target_post_url": "<URL>",
  "target_post_age_hours": <float>,
  "comment_text": "<full comment including hub URL>",
  "hub_url": "<hub post URL>",
  "previously_commented_urls": ["<URL>", ...]
}'
```

Exit 0 = PASS (post the comment). Exit 1 = BLOCK (do not post — surface remediation).

Gate B checks: hub_url present in comment, freshness (≤72h for LinkedIn), dedup, and LLM standalone_value judge.

**Playbook:** `$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/social-distribution-engine/hijack-playbook.md 2>/dev/null | tail -1)`

## Capabilities

### 1. Execute Algorithmic Posting
When distributing to LinkedIn:
- **No Link Penalties:** Never place links in the main text of the post. Always place the link to the hub (e.g., Substack) in the first comment.
- **Hub vs. Spoke:** If LinkedIn is a spoke, apply the "Comment Cascade" protocol. Ensure the first comment links back to the canonical Hub Post.
- **Gap Timing:** Enforce a minimum 15-minute gap between LinkedIn spokes to avoid cross-post penalties.
- **Asset Attachment:** Use correct visual assets based on the campaign specs (e.g., 1200x627 for short posts, no images for comment cascades).

### 2. Group Management & Posting

For full LinkedIn Groups discovery + distribution, use the `linkedin-groups-distribution-module` skill.

Summary of groups rules enforced by that skill:
- Check `brain.read("brand-amplification/campaigns/social-channel-directory.md")` for approved LinkedIn Groups.
- 7-day cooldown per group (enforced by `linkedin-groups-dedup` gate).
- Max 3 groups per campaign. Max 150 words per group post. Open with question — not declaration.
- Dedup gate fires before every group post:

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/rules/linkedin-groups-dedup/HOW.py 2>/dev/null | tail -1)" \
  '{"group_url": "<URL>"}'
```

Exit 0 = PASS. Exit 1 = BLOCK (with next available date).

- **Rule:** If a group historically yields 0 engagement, do NOT post. Escalate to the Analytics Engine for pruning.

### 3. Record Execution
After posting, immediately update the campaign tracker (e.g., `[campaign-name]-distribution-stats.md`) with the exact time, URL, and status.

## Lessons Repository
Update `WIP/career-os-product/linkedin-algo-lessons.md` if any new algorithmic insight is discovered during distribution.
