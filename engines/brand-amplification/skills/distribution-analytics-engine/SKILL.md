---
name: distribution-analytics-engine
description: >
  The Kinetic Learner. Connects engagement data back to the Master Engine.
  Responsible for the Global Channel Value Directory and aggressive channel pruning.
triggers:
  - analyze distribution
  - check campaign engagement
  - update channel directory
  - channel stats
---

# Distribution Analytics Engine — The Kinetic Learner

## Purpose

The feedback loop of the Social Distribution Engine. It collects engagement data from campaign trackers and updates the Global Channel Value Directory (`social-channel-directory.md`). It protects the human brand by aggressively pruning dead or toxic channels.

## Output Format

Always start your response with:
```
━━━ Career OS: Distribution Analytics Engine ━━━
```

## Brain API (brain-kernel >= 1.0.0)

All writes go through `brain.write()`. All reads go through `brain.read()` /
`brain.list()`. Direct filesystem writes are FORBIDDEN.

## Capabilities

### 1. Data Collection & Synthesis
**Triggers:** "analyze distribution", "check campaign engagement"
- Reads campaign masters: `brain.list("brand-amplification/campaigns/")` → filter to paths containing `master.md`.
- Aggregates metrics (Views, Likes, Comments, Upvotes, Shares) per channel.

### 2. Channel Pruning & Trust Preservation
- Updates via `brain.write("brand-amplification/campaigns/social-channel-directory.md", content, { provenance: { who: "brand-amplification", why: "channel directory updated after analytics", source: "distribution-analytics-engine" }, engine_id: "brand-amplification" })`.
- **Hard Pruning:** If a channel consistently yields 0 engagement or receives moderation warnings, mark it as `⚠️ BANNED` or `Low ROI`. The Platform Modules will read this and avoid posting there in the future.
- **Signal Amplification:** Identify high-performing channels and extract the "why" (e.g., "This group prefers technical deep-dives over promotional hooks"). Add this to:
  ```
  brain.write("brand-amplification/patterns/<platform>-lessons.md", content, { ... })
  ```

### 3. Strategy Adjustment
Provide concrete recommendations to the Master Distribution Engine for future campaigns (e.g., optimal posting times, content format preferences).

### 4. Signal Collection (v1.0 — local only)

After analytics collection completes, invoke `signal-collector.py` to map bucketed performance
outcomes to the local signal store:

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/social-distribution-engine/signal-collector.py 2>/dev/null | tail -1)" \
  '{"campaign_file": "<abs-path-to-campaign.json>"}'
```

- Exit 0 = signal collected or skipped (no analytics available yet)
- Exit 1 = error (invalid campaign file, malformed JSON)
- Output written via: `brain.write("brand-amplification/performance-history.md", content, { provenance: { who: "brand-amplification", why: "signal collected", source: "distribution-analytics-engine" }, engine_id: "brand-amplification" })`
  (For jsonl append pattern, read current content first, append new entry, then write back.)

**Privacy:** no content, handles, or identifiers are collected — only bucketed performance
outcome metrics (engagement tier, impression tier, day-of-week, hour, post type, etc.).
Signal collection is always local. Opt-in sync to aggregator is a separate user command.

**Invocation rule:** fire ONLY when `campaign.analytics` is populated (i.e., 48–72h after post).
If `analytics` is empty, signal-collector skips gracefully (no error).
