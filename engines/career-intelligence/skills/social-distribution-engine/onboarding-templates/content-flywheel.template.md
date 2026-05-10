---
name: {{USER_NAME}} SDE Instance Config
type: instance-config
scope: xHumanOS — {{USER_NAME}}
created: {{DATE}}
updated: {{DATE}}
who: {{USER_NAME}}
why: >
  The social-distribution-engine skill reads this file to understand THIS user's
  specific topology — which platform is the honey pot, which is the juice hub,
  which platforms are active spokes. Generic strategy lives in the plugin bundle.
  This file is the per-instance override and operating config.
related:
  - brain/social-distribution-engine/social-channel-directory.md
  - brain/identity/handles.md
  - brain/identity/professional-brand.md
---

# {{USER_NAME}} Distribution Topology

## Platform Roles

| Platform | Role | Why |
|---|---|---|
| {{HONEY_POT_PLATFORM}} | **Honey Pot** — conversion hub, owned soil | {{HONEY_POT_REASON}} |
| {{JUICE_PLATFORM}} | **Juice Hub** — primary engagement engine | {{JUICE_REASON}} |
| {{SPOKE_1}} | Spoke | Drives back to juice hub. |
| {{SPOKE_2}} | Spoke (gated) | Check social-channel-directory.md before posting. |
| {{SPOKE_3}} | Spoke (visual) | Image-first. Used for visual campaign assets only. |

## The Flywheel Sequence (ALWAYS this order)

1. Publish {{HONEY_POT_PLATFORM}} (source — honey pot)
2. Publish {{HUB_ARTICLE_PLATFORM}} Article (SEO Hub — evergreen, publishes FIRST)
3. Publish {{HUB_POST_PLATFORM}} Post (Post Hub / Juice Hub — all spokes drive here, publishes SECOND)
4. Publish spoke posts (links to hub in first reply/comment)

External links go in COMMENTS only (body links = algorithm suppression).

## My Voice

- **Brand:** {{BRAND_NAME}}
- **Tone:** {{TONE_SUMMARY}}
- **Primary content format:** {{PRIMARY_FORMAT}}

## Active Handles

See `brain/identity/handles.md` for current handle list across all platforms.

## Golden Hour Settings

- **Preferred timezone:** {{TIMEZONE}}
- **Peak posting windows:** Mon–Thu, morning (7:30–9:00) or midday (11:30–13:00)
- **Scheduling:** Add `scheduled_at` to each campaign component (ISO 8601) to activate Gate 9 validation.

## Signal Sharing

- **Opt-in to anonymous signal aggregation:** {{SHARE_OUTCOMES}}
  - If `true`: campaign performance deltas (reach tier, golden hour hit, engagement mix) are anonymized and contributed to the shared signal map to improve gate thresholds for all users.
  - Content is NEVER shared — only bucketed outcome metrics.
