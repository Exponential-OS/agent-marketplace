---
name: quote-flywheel
description: >
  Daily Naval-style quote-a-day flywheel for drafting one safe §1 quote into a
  LinkedIn-native post and presenting it for explicit human approval.
triggers:
  - quote flywheel
  - daily quote
  - naval quote a day
  - draft quote post
---

# Quote Flywheel

## Purpose

This playbook makes the brand flywheel spin daily: select one approved quote,
draft a platform-native LinkedIn post, run framing gates, and present the draft
for one-tap human approval.

MVP is DRAFT-first only. It never posts, schedules, submits, or opens a posting
transport.

## Load-Bearing Safety Rules

1. The quote deck has safety-gated sections. Select only from:
   `## §1 — POST FREELY (universal wisdom)`.
2. Hard-exclude every quote under §2 and §3:
   - §2 is HOLD until provisional filed; public posting may leak IP.
   - §3 is BORROWED; never post as original.
3. Keep the selected quote text verbatim.
4. Attribute provenance:
   - `[you]` = Anand original.
   - `[cyborg]` = co-authored line.
5. Honor the no-outside-work-disclosure firewall. Before adding any framing
   beyond the generic template, load the BAE context preflight from
   `social-distribution-engine`: professional brand plus the IP Firewall in
   `brand-amplification/voice-strategies/content-flywheel.md`. If the IP
   Firewall is unavailable, use only the generic frame and flag the missing
   context before approval.
6. The Irreversible-Action Invariant applies. Approval logs approval only.
   Approval does not publish.

XOS-140 harvest and any Adam-Grant screenshot cascade are separate follow-ups.
Do not run them as part of this skill.

## Deterministic Selector

Use the local deterministic code path:

```bash
bun scripts/quote-selector.ts select
```

Configuration:

- `CYBORG_QUOTES_DECK` overrides the deck path.
- Default deck:
  `~/anand-career-os/WIP/branding-product/cyborg-quotes.md`.
- `QUOTE_FLYWHEEL_LOG` overrides the JSONL state log path.
- `QUOTE_FLYWHEEL_STATE_DIR` overrides the state directory.
- Default log:
  `~/.brand-amplification-state/quote-flywheel-log.jsonl`.
- `--dedup-days N` overrides the no-repeat window; default is 30.

The selector:

- Parses only the §1 safety-gate section.
- Stops scanning at the next safety-gate heading, so §2 and §3 never become
  candidates.
- Selects the least-recently-used quote outside the dedup window.
- Tolerates a missing deck or missing log with a safe skip message.
- Appends a local JSONL draft record with:
  `{ quote_hash, drafted_at, approved_at?, posted_at?, status }`.

## Daily Cadence — Today's Draft (XOS-161)

For the daily quote trigger, run the once-per-calendar-day guard first:

```bash
bun scripts/daily-cadence.ts
```

The guard reads the same quote log as the selector.

- If today's `drafted_at` record already exists, say that today's draft was
  already surfaced and stop.
- If no draft exists for today, the guard calls the existing selector and
  surfaces one §1-only draft for approval.
- Missing or empty logs count as no draft surfaced today.
- The output remains DRAFT-only: no posting, no scheduling, no browser action,
  and no transport.

After a draft is surfaced, continue with the existing LinkedIn Gate 1, T4
framing judge, and one-tap approval flow below. Approval only appends an
approved record; it never publishes.

Optional wiring is human-gated. Do not force-install a global every-session
hook. If Anand explicitly opts in after review, use either a once/day
SessionStart hook or a cron entry that runs:

```bash
bun scripts/daily-cadence.ts
```

The hook or cron must preserve the same once/day guard and must not call any
posting or scheduling transport. Autonomous posting is a separate explicit
graduation decision after the confidence ladder; approval counts never
auto-graduate the workflow.

## Daily Workflow

1. For the daily trigger, run `bun scripts/daily-cadence.ts`. For an ad hoc
   non-daily draft, run the selector directly.
2. If it returns a safe skip, stop and surface the message.
3. Draft as a LinkedIn post using the `linkedin-distribution-module` formatting
   conventions:
   - hook on top,
   - tight line grouping,
   - plain-text paste-safe,
   - no links in the body,
   - hashtags appended at the end,
   - no markdown tables or pipe characters.
4. Run LinkedIn Gate 1 before handoff:

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/social-distribution-engine/post_validator.py 2>/dev/null | tail -1)" \
  --platform linkedin_post \
  --text "<post body including appended hashtags>"
```

5. Run the cross-family T4 framing judge through `judge-panel` when available.
   The judge evaluates:
   - quote text is unchanged,
   - only §1 provenance is used,
   - no outside-work/IP disclosure,
   - the hook creates a light frame without over-explaining,
   - the draft is LinkedIn-native and paste-safe.

   If `judge-panel` is unavailable or `SKIP_LLM_JUDGES=1`, return WARN and
   require human review before approval. Never treat a skipped judge as approval.

6. Present the draft for one-tap approval:

```text
LinkedIn draft

<paste-safe draft>

Approve:
bun scripts/quote-selector.ts approve <quote_hash>
```

7. On approval, append an approved record only:

```bash
bun scripts/quote-selector.ts approve <quote_hash>
```

No posting action is allowed in v1.

## Local Telemetry

Emit local-only telemetry only when `XOS_98_TELEMETRY` is enabled, matching the
existing BAE `content_strategy_applied` pattern.

Events:

- `quote_drafted`
- `quote_daily_surfaced`
- `quote_approved`
- `quote_posted` is reserved for a future graduated mode.

Telemetry path:

`brand-amplification/telemetry/events.jsonl`

Telemetry must use `brain.read()` plus `brain.write()` with
`engine_id: "brand-amplification"`. Do not write telemetry directly to the
filesystem and do not send telemetry over the network.

## Graduation Rule

After roughly 10 approved quote drafts, the playbook is eligible for autonomous
mode. Eligibility is not graduation.

Graduation requires an explicit human decision in a future turn, and even a
graduated mode remains gated by the Irreversible-Action Invariant. Never
auto-graduate from approval counts alone.
