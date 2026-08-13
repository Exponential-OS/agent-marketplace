---
name: cascade-planner
description: >
  Draft-first Adam-Grant-style screenshot cascade planner for a Substack source.
  Use when Codex needs to turn a provided Substack URL, title, and excerpt into
  an approval-ready staged plan where LinkedIn is the juice hub, X and configured
  spokes reuse the same screenshot, LinkedIn comment links to Substack, and every
  spoke links one rung up to the LinkedIn post.
triggers:
  - cascade planner
  - screenshot cascade
  - adam grant cascade
  - substack to linkedin to x
---

# Cascade Planner

## Purpose

Create a paste-safe DRAFT-only plan for the Substack -> LinkedIn -> spokes
funnel:

1. Substack is the honey pot and source long-form.
2. LinkedIn is the juice hub. It uses a screenshot of the Substack post and puts
   the Substack URL in the LinkedIn comment only.
3. X and any configured spokes reuse the same screenshot and link one rung up to
   the LinkedIn post URL.

This skill plans the cascade only. It must never publish, schedule, open a
posting UI, capture a screenshot, or call the network.

## Required Input

- `substackUrl`: canonical URL of the already-written Substack source.
- `title`: title of the Substack source.
- `excerpt`: short excerpt or thesis from the source.
- Optional configured spokes from
  `brain.read("brand-amplification/voice-strategies/content-flywheel.md")`. Always
  include X even when the config does not list it.

**Source-already-published precondition (load-bearing).** This planner cascades an
*already-published* Substack long-form. The caller MUST confirm the source is
already public and §1-safe (POST FREELY) before cascading. The planner trusts the
provided `url`/`title`/`excerpt` as published material — it is NOT a first-publish
path and must never be used to push §2 (HOLD-until-provisional / patent-gated) or
no-outside-work-disclosure material into public reach. If the source's §1 status is
unconfirmed, stop and confirm before drafting.

Before drafting, honor the BAE context preflight from
`social-distribution-engine`: load professional brand and the IP Firewall when
available (`brain.read("brand-amplification/voice-strategies/content-flywheel.md")`
— IP Firewall section). If the IP Firewall is unavailable, keep the copy generic and
flag the missing context. The plan must honor section 1-only and
no-outside-work-disclosure constraints from the source long-form.

## Deterministic Helper

Use the pure local helper to build the staged plan:

```bash
bun scripts/cascade-plan.ts --url "<substackUrl>" --title "<title>" --excerpt "<excerpt>" --spokes x,threads,facebook
```

The helper returns:

- sequence and dependencies
- link-target map
- one reusable screenshot reference
- platform-native draft copy
- guardrails and approval ladder

Do not add network, posting, scheduling, browser, or screenshot-capture code.

## Output Contract

Return one plain-text view for approval. Do not use markdown tables or pipe
characters.

Include:

- DRAFT_ONLY mode.
- Confidence ladder: `DRAFT -> approve(~10) -> graduate`.
- Graduation note: approval count creates eligibility only; explicit human
  graduation is required in a future turn. Never auto-graduate.
- Source URL, title, and excerpt.
- Reusable screenshot instruction:
  `Screenshot to take: the Substack post at <substackUrl>`.
- Visual review note on every screenshot-bearing step:
  `VISUAL REVIEW REQUIRED before posting.`
- Sequence:
  `Step 1 LinkedIn` before every spoke.
- Dependency:
  LinkedIn must exist before spokes can replace their LinkedIn URL placeholder.
- Link-target map:
  `linkedin.comment -> <substackUrl>`
  `x -> <LinkedIn post URL placeholder>`
  `<configured-spoke> -> <LinkedIn post URL placeholder>`
- LinkedIn draft:
  - LinkedIn-native hook in the first lines.
  - Tight line grouping.
  - No URL in the body.
  - Hashtags appended at the end.
  - Explicit note: `COMMENT link target: <substackUrl>`.
  - Explicit note: link goes in the LinkedIn comment, never the body.
- Spoke drafts:
  - Reuse the SAME Substack screenshot.
  - Link target is the LinkedIn post URL placeholder until Step 1 is live.
  - X uses the thread shape from `x-distribution-module`: main tweet hooks,
    Reply 1 delivers value, Reply 2 carries the LinkedIn link.

## Guardrails

- Irreversible-Action Invariant: every step is DRAFT. Human approval is not a
  publish command.
- Visual-Asset Review Invariant: every screenshot-bearing step requires visual
  review before posting.
- Body-link rule: LinkedIn body links are forbidden. The Substack link goes in
  the comment only.
- Funnel rule: spokes link to LinkedIn, never directly to Substack.
- Plain-text rule: no markdown tables and no pipe characters in drafts or plan.
- Scope rule: brand-amplification only.
