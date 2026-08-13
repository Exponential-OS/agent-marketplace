---
name: reddit-distribution-module
description: >
  Specialized skill for mastering Reddit distribution. Heavily emphasizes The
  Scraping Invariant and anti-spam protocols due to strict Reddit moderation.
triggers:
  - post to reddit
  - reddit distribution
  - reddit campaign
---

# Reddit Distribution Module

## Purpose

This skill specializes in Reddit content distribution. Reddit is highly sensitive to promotional content and "competitor superiority" claims. This module ensures content is framed technically and engages the community rather than broadcasting.

## Output Format

Always start your response with:
```
━━━ Brand Amplification: Reddit Distribution Module ━━━
```

## Reddit Pre-Post Viability Gate (MANDATORY)

Run this gate before drafting for a Reddit surface, then run it again with the final candidate title/body before posting. It is offline: history comes from `submission_history` or the workspace ledger, never a Reddit fetch.

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/rules/reddit-prepost-viability/HOW.py 2>/dev/null | tail -1)" '{
  "subreddit": "r/Entrepreneur",
  "body": "<planned framing before drafting, or exact final body before posting>",
  "title": "<optional post title>",
  "handle": "thewhyman007"
}'
```

Exit 0 = PASS (draft/post may continue). Exit 1 = BLOCK (do not draft or post). Exit 2 = WARN (surface the named warning and resolve or explicitly review it before continuing).

## Capabilities

### 1. Autonomous Execution & Content Adaptation
When distributing to Reddit, this module operates completely independently:
- **Dependency Resolution:** It reads the `campaign-master.md` file directly to find the `HUB_URL` (e.g., the LinkedIn or Substack link). It does not need the Master Orchestrator to spoon-feed it variables. If the Hub URL is missing, it parks itself.
- **Content Adaptation:** It takes the "Master Content" thesis and autonomously rewrites it for the Reddit audience. 
- **No Promotional Hooks:** Strips marketing language. Uses technical deep-dives or "case study" framing.
- **Cross-Post Detection Evasion:** Staggers posts across similar subreddits (e.g., r/MachineLearning and r/LocalLLaMA) by at least 24 hours.
- **Asset Attachment:** Uses correct visual assets (typically a 1080x1080 square).

### 2. Subreddit Management
- Check `brain.read("brand-amplification/campaigns/social-channel-directory.md")` BEFORE posting.
- **NEVER** post to a Subreddit marked `⚠️ BANNED` or `Low ROI`.
- If a post receives no engagement or gets deleted, escalate to the Analytics Engine for immediate logging to prevent repeat offenses.

### 3. Record Execution
After posting, immediately update the campaign tracker with the exact time, URL, and status.

## Lessons Repository
Update `WIP/career-os-product/reddit-algo-lessons.md` if any new algorithmic insight or moderation action is discovered during distribution.
