---
name: {{USER_NAME}} Social Channel Directory
type: channel-directory
scope: xHumanOS — {{USER_NAME}}
created: {{DATE}}
updated: {{DATE}}
---

# Social Channel Directory — {{USER_NAME}}

**Purpose:** Channel-level quality ratings used by Gate 2 (channel-status-check) to block distribution to banned or low-ROI channels. Update after any community moderation incident or quality shift.

**Format:** Each channel entry includes status, ROI rating, and any posting constraints.

---

## LinkedIn

| Surface | Status | ROI | Notes |
|---|---|---|---|
| Personal Feed (Post) | ✅ ACTIVE | High | Primary juice hub. All campaigns post here. |
| LinkedIn Article | ✅ ACTIVE | High | SEO hub. Publish before Post Hub. |
| LinkedIn Newsletter | ⬜ INACTIVE | — | Not yet activated. |

## LinkedIn Groups

Use `"discover linkedin groups"` to find and score groups for your content pillars.
7-day cooldown per group. Max 3 groups per campaign. Posts must be discussion-framing (≤150 words, open with question).

| Channel Type | Group Name | URL | Members | Activity | Status | Added |
|---|---|---|---|---|---|---|
| linkedin_group | *(example)* | https://linkedin.com/groups/... | 0 | — | ⬜ PENDING | — |

## Substack

| Surface | Status | ROI | Notes |
|---|---|---|---|
| Main publication | ✅ ACTIVE | High | Honey pot. Conversion target. |

## X / Twitter

| Surface | Status | ROI | Notes |
|---|---|---|---|
| Main feed (@{{X_HANDLE}}) | ✅ ACTIVE | Medium | Spoke only. Links to LinkedIn hub in first reply. |

## Reddit

**Rule: check subreddit rules before every post. No direct self-promotion in post body.**

| Subreddit | Status | ROI | Notes |
|---|---|---|---|
| r/{{SUBREDDIT_1}} | ✅ ACTIVE | Medium | Value-first posts only. Link in comment. |
| r/{{SUBREDDIT_2}} | ⚠️ GATED | Low | Verify rules before each post. |

## Instagram

| Surface | Status | ROI | Notes |
|---|---|---|---|
| Feed (@{{INSTAGRAM_HANDLE}}) | ✅ ACTIVE | Medium | Visual spokes only. Save prompt required. |
| Stories | ⬜ INACTIVE | — | Not in current flywheel. |

## Facebook

| Surface | Status | ROI | Notes |
|---|---|---|---|
| Personal profile | ⚠️ LOW ROI | Low | Deprioritized. Use only for community groups. |
| {{FACEBOOK_GROUP_1}} | ✅ ACTIVE | Medium | Community group. Story-first posts. |

---

## Banned Channels

Channels that trigger Gate 2 BLOCK. Do not post here under any circumstances.

| Channel | Reason | Date banned |
|---|---|---|
| *(none yet)* | — | — |

---

## Review cadence

Update this file after any incident (ban, spam flag, community complaint) or when ROI shifts significantly. Gate 2 reads this file on every campaign preflight run.
