# Content → recruiter-DM tracker (XOS-102)

status: design
slug: content-dm-tracker
ticket: XOS-102
repo: ~/aiprojects/career-intelligence-engine (built off origin/main 0.73.4)

## What
Establish the causal chain content → pipeline: when a recruiter/inbound DM is received
that the user attributes to a post, capture `source=post` + `post_id` on the contact,
emit a LOCAL `content_to_dm_tracked` telemetry event (`post_id` + `dm_source`), and
surface the attribution so "which post drove which conversation" is legible.

## Why
NSM = validated outward wins per active user-hour. A win is only countable if attributed.
This makes content wins legible as career wins ("wins per post"), and feeds the NSM with
real attribution data. (EPIC 5 child; mirrors the Epic-2 brand-inbound tracker, scoped to content.)

## Scope (MVP, S-effort)
- **In:**
  - `src/telemetry/events.ts`: add a `ContentToDmTrackedEvent` type + an
    `emitContentToDmTracked({ post_id, dm_source, contact_slug?, attributed_by? })` helper,
    following the existing XOS-98 event-helper pattern. Emits via `emitEvent` →
    `XOS_98_TELEMETRY`-gated, local JSONL only, ZERO network (no phone-home — PostHog stays
    dropped for xOS).
  - Attribution capture (SKILL instruction): when logging an inbound recruiter DM against a
    `network/people/{slug}.md` contact (network-intelligence) or a pipeline entry, allow the
    user to attribute it to a post → record `source: post` + `post_id` on the contact
    frontmatter (and/or pipeline entry), and call the new event helper.
  - Surfacing: a content-attribution line in an existing view (pipeline-view or
    apply-dashboard) — "inbound from {contact} via post {post_id}" + a simple count of
    post-attributed inbounds. (Career-side surfacing is the MVP; brand-side "post performance
    view" surfacing is a follow-up — noted below.)
  - Tests in `tests/telemetry-events.test.ts` for the new event (gated on/off, fields present,
    local-only).
  - Version bump per the engine's consistency requirements.
- **Out (follow-up):** brand-amplification-side post-performance view that aggregates
  attributed DMs per post (cross-engine surfacing); auto-inference of attribution (this MVP
  is user-confirmed attribution, which the DoD calls the accuracy baseline).

## Acceptance criteria
- [ ] `content_to_dm_tracked` event with `post_id` + `dm_source` emitted via the XOS-98
      primitive; written ONLY when `XOS_98_TELEMETRY` enabled; local JSONL; no network call.
- [ ] Inbound DM can be attributed to a post (`source=post` + `post_id`) on the contact/pipeline
      record via the documented skill flow.
- [ ] Attribution is visible in a career view (count + per-DM source post).
- [ ] Tests green; version-consistency green.

## Test plan
- [ ] `bun test` — new event helper: gated-off → not written; gated-on → JSONL line with
      post_id + dm_source; no network.
- [ ] Skill-flow smoke: documented capture + surfacing reads correctly (CLI render).

## Rollback
Revert the PR. Additive event helper + SKILL instructions + a view line; no data migration;
existing telemetry events unaffected.

## Lane
xos product (career-intelligence-engine). No co-dialectic collision. Built off origin/main
(local checkout is stale/diverged — 0.73.1, 3-ahead/4-behind).
