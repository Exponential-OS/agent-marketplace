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
━━━ Career OS: Reddit Distribution Module ━━━
```

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
