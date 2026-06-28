<!-- product-vs-solution: example -->
# Social Distribution Plugin

**Platform:** xOS (shared primitive for xHumanOS + xTeamOS + xFamilyOS)
**Status:** v0.47.0 — extracted from career-intelligence-engine v0.61.0 on 2026-05-17

Content distribution orchestrator for human-cyborg partnerships. Implements the hub-and-spoke flywheel (P16 in the Cyborg Constitution), 10-gate preflight CI, and platform-native modules for the major surfaces.

## What's in the box

**Core skills**
- `social-distribution-engine` — Master Coordinator. Routes campaign distribution across platforms.
- `campaign-engine` — Plans new campaigns (Surface Coverage Matrix builder).
- `campaign-dashboard` — Initiative → Campaign → Spoke hierarchy view. Read-only.
- `distribution-analytics-engine` — Post-publish KPI sync, ROI per channel.
- `flywheel-amplification-module` — Day+1 self-reply, Day+2 pull-quote, comment cascade.

**Platform modules (one per surface)**
- LinkedIn (hub + groups), Substack (honey-pot), X, Reddit, Facebook, Instagram, Threads.

**Pre-flight gates (9 in sequence)**
1. `campaign-schema-validator` — schema compliance
2. `channel-status-check` — banned/low-ROI channel detection
3. `surface-coverage-check` — every campaign covers the full surface set
4. `content-url-resolution-check` — no unresolved placeholder URLs
5. `flywheel-sequence-guard` — Substack → LinkedIn Article → LinkedIn Post → Spokes order
6. `visual-asset-review-check` — image-bearing spokes reviewed pre-ship
7. `golden-hour-scheduling-check` — posts land in platform engagement windows
8. `campaign-estate-quality-check` — LLM judge for narrative coherence
9. `flywheel-cta-quality-check` — invisible-signal CTAs (bookmark, save, DM-share)

**Platform-specific publish gates**
- `substack-publish-gate`, `linkedin-article-publish-gate`, `linkedin-post-on-article-gate`, `x-cta-resolution-gate`, `comment-hijack-gate`

## Required environment

- `$CAREER_HOME` — customer's workspace root. Plugin reads:
  - `$CAREER_HOME/identity/professional-brand.md` — brand voice
  - `$CAREER_HOME/identity/handles.md` — platform handles
  - `$CAREER_HOME/brand-amplification/identity/brand-spec.json` — brand schema (created by `sde-onboarding`)
  - `$CAREER_HOME/brand-amplification/campaigns/` — initiative + campaign storage

## Install

```bash
claude plugin marketplace add Exponential-OS/agent-marketplace
claude plugin install social-distribution@xos
```

For first-time customers, run `sde-onboarding` after install to populate the brand spec.

## Companion plugins

- `career-intelligence@xos` — job search, pipeline, outreach (xHumanOS only)
- `co-dialectic@xos` — prompt sharpening + persona detection (universal)
- `brand-intelligence@xos` — persona schema + registry (planned; currently bundled here as `sde-onboarding`)

## Provenance

Extracted from career-intelligence-engine v0.61.0 to honor the xOS-vs-xHumanOS platform split per `WIP/xOS-platform/social-distribution-product/NEXT_SESSION_HANDOFF.md`.
