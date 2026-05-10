---
name: linkedin-groups-distribution-module
description: >
  LinkedIn Groups discovery + distribution spoke. Phase 1: finds right groups for user's content
  pillars, scores them, writes approved groups to social-channel-directory.md. Phase 2: treats
  linkedin_group as a distribution spoke type with 7-day cooldown enforcement and discussion-framing rules.
depends_on:
  - linkedin-distribution-module
  - chrome-devtools MCP (authenticated LinkedIn session, port 9222)
  - brain/social-distribution-engine/social-channel-directory.md
triggers:
  - discover linkedin groups
  - find groups for my content
  - add groups to my distribution
  - post to linkedin groups
  - linkedin group distribution
version: "1.0.0"
ships_as: "v0.49.0"
---

# LinkedIn Groups — Discovery + Spoke Support

## Output Format

Always start your response with:
```
━━━ Career OS: LinkedIn Groups Distribution Module ━━━
```

## Why Groups

LinkedIn Groups are **underutilized high-trust surfaces**. Group members are self-selected niche
audiences — a post in a 3,000-member AI Engineering group reaches more qualified readers than
10,000 impressions in the feed. Groups compound: a member who sees you in their group AND feed
trusts you more.

---

## Phase 1 — Discovery Flow

### Trigger
"discover linkedin groups" | "find groups for my content" | "add groups to my distribution"

### Step 0 — Pre-flight (mandatory)
Read `$CAREER_HOME/brain/identity/professional-brand.md` → extract `content_pillars` (list of topics).
If not found → stop and ask user for 3–5 topic keywords.

### Step 1 — Search (chrome-devtools MCP)
Requires authenticated LinkedIn session (port 9222 active — check before proceeding).

For each content pillar (max 3 searches to avoid rate limiting):
```
Navigate: https://www.linkedin.com/search/results/groups/?keywords={pillar}
Extract: group name, member count, recent activity, description, group URL
```

Aggregate results, deduplicate, sort by relevance + activity.

### Step 2 — Score each group (0–100)

| Signal | Points |
|---|---|
| Member count 500–5000 | +20 |
| Member count >5000 | +15 |
| Member count <500 | +5 |
| Recent activity >10 posts/mo | +25 |
| Recent activity 1–10 posts/mo | +10 |
| Recent activity 0 posts/mo | −20 |
| Direct pillar keyword match | +30 |
| Adjacent topic match | +15 |
| "job postings only" in description | −30 |
| "promotional" in rules | −20 |
| Already in social-channel-directory.md | flag as "already tracked" |

Present top 10 candidates (score ≥ 40):
```
Group: "AI Product Leaders Network" | 4,200 members | Active (23 posts/mo) | Score: 82
Group: "LLM Engineering Community"  | 1,800 members | Active (15 posts/mo) | Score: 75
...
```

### Step 3 — User approval
Show list. User selects which to add (can select all or subset).

### Step 4 — Write to social-channel-directory.md
For each approved group, append to `$CAREER_HOME/brain/social-distribution-engine/social-channel-directory.md`
under a `## LinkedIn Groups` section:

```markdown
| linkedin_group | {Group Name} | {URL} | {member_count} | {activity_summary} | ✅ APPROVED | Added {DATE} |
```

Commit: `feat(sde): add N LinkedIn groups to distribution channels`

---

## Phase 2 — Spoke Distribution Rules

### Channel type: `linkedin_group`

**Trigger:** When a campaign's surface coverage matrix includes `linkedin_group` spokes.

#### Mandatory formatting (different from regular feed posts)

| Rule | Reason |
|---|---|
| Open with a QUESTION or observation | Groups respond to discussion-starters, not broadcast |
| Max 150 words in post body | Groups are conversational — short = more replies |
| ONE external link allowed in body | Groups are less algorithmically suppressed for links |
| No promotional language ("buy", "sign up", "check out my service") | Groups ban spam; promotional posts get removed |
| Add "What's your take?" or similar discussion CTA | Drives comments = algorithmic visibility |
| No more than 1–2 hashtags | Groups derank hashtag-stuffed posts |

#### Timing rules
- **Cooldown:** 7 days minimum between posts to the same group (enforced by dedup gate)
- **Best times:** Tue–Thu 10:00–12:00 user's local timezone
- **Max groups per campaign:** 3 (more = spam pattern risk)

#### Dedup gate (fires before every group post)

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-os/*/rules/linkedin-groups-dedup/HOW.py 2>/dev/null | tail -1)" \
  '{"group_url": "<URL>", "lookback_days": 7}'
```

Exit 0 = PASS. Exit 1 = BLOCK with last-post date and next available date.

#### Post log schema
After each group post, append to `$CAREER_HOME/brain/social-distribution-engine/groups-post-log.jsonl`:
```json
{"group_url": "...", "group_name": "...", "posted_at": "2026-05-10T14:00:00Z", "campaign": "...", "post_url": "..."}
```

#### Comment monitoring reminder
After a groups post is distributed, add Day+1 reminder in the campaign ledger:
`"Reply to any comments in '{group_name}' — first 24h is the visibility window"`

---

## Out of Scope
- Auto-posting to groups without user approval (Irreversible-Action Invariant)
- Private/invite-only group discovery
- Group admin relationships (Phase 3)
