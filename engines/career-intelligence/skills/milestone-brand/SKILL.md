---
name: milestone-brand
description: >
  Detects explicitly shareable career milestones in the job pipeline and
  surfaces draft-only brand-post prompts. Fail-closed by firewall design: no
  shareable flag means no suggestion. Use when the user asks for milestone
  brand moments, career-to-brand prompts, or shareable pipeline milestones.
triggers:
  - milestone brand
  - brand moment
  - career milestone post
  - shareable milestones
  - milestone to brand post
  - career-to-brand
---

# Milestone Brand — Career OS Skill

## Purpose

Close the input side of the career-to-brand fusion loop. When the user has
explicitly marked a pipeline milestone shareable, this skill suggests turning
that milestone into a brand post draft through the campaign engine.

This is option A: fail-closed and opt-in by firewall design. The user is under a
no-outside-work-disclosure firewall and a two-workspace firewall. Publicly
posting about interviews, offers, or other companies could expose a job search.
Therefore, the default is to suggest nothing.

Option B, auto-detecting all milestones, is deferred until the user supplies a
stealth-exclusion list.

## Output Format

Always start with:

```text
Career OS: Milestone Brand Moments
```

If there are no allowed prompts:

```text
No shareable brand milestones surfaced.
```

## Detection

Read the pipeline from:

`career-intelligence/projects/job-search/job-pipeline.json`

Fallback path:

`$CAREER_HOME/career-intelligence/projects/job-search/job-pipeline.json`

Run the deterministic helper:

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/pipeline/milestone-brand.ts" \
  --pipeline "$CAREER_HOME/career-intelligence/projects/job-search/job-pipeline.json"
```

The helper scans `stage_data[]` and returns only positive, notable stages such
as `advancing`, `in_process`, `panel_interview`, `awaiting_decision`, or
`offered`. It excludes `applied`, `dead`, `rejected`, `declined`, and
`deprioritized`.

Fail-closed contract:
- Include a candidate only when `entry.shareable === true` or
  `entry.brand_shareable === true`.
- A nested milestone object may also opt in with `shareable: true` or
  `brand_shareable: true`.
- Absence of the flag means "do not surface".
- Never infer shareability from a positive stage, notes, recruiter activity, or
  the apparent importance of the milestone.

## Company Action Gate (run BEFORE surfacing each prompt)

A brand-moment prompt names a company and can lead to public action, so it is
subject to the Company Action Gate. Before surfacing a prompt for any company,
run the company-flags filter and honor the verdict. A deprioritized or flagged
company must never surface as a brand action, even when the milestone was
explicitly marked shareable.

Use the stricter `apply` action for this MVP so `do_not_apply` flags also
suppress public brand prompts:

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/company-flags-filter/HOW.py 2>/dev/null | tail -1)" \
  '{"company":"<name>","action":"apply","flags_file":"'"$CAREER_HOME"'/career-intelligence/projects/job-search/company-flags.json"}'
```

- exit 1 = BLOCK -> suppress this company's prompt entirely.
- exit 2 = WARN -> do not surface the brand prompt; surface the referral/flag
  status instead.
- exit 0 = clear -> proceed to the draft-only prompt.

The gate FAIL-HARDs (BLOCK) if `flags_file` is provided but missing. Never
silent-pass on absent safety config, and do not re-implement flag logic inside
this skill.

## Draft/Suggestion Gate

This skill never posts, schedules, opens a browser, opens LinkedIn, or publishes
anything. It surfaces only a plain-text prompt for the user to consider.

Required sequence:
1. Build the prompt from the gated-clear milestone.
2. Show the full prompt to the user.
3. Wait for explicit approval before routing anything to the campaign engine.
4. Never auto-draft, auto-post, auto-schedule, or mark anything as published.

A blanket approval for multiple prompts approves zero publishing actions. Each
post still needs the normal human-approved publishing gate after drafting.

For each gated-clear milestone, show:

```text
Milestone: <role> at <company> reached <stage>.
Draft a brand post with the campaign engine?
Reference: <ref>
Starter angle: <angle>
Gate: Draft suggestion only. Nothing publishes automatically; the normal human-approved publishing gate still applies.
```

Showing this prompt is not approval to draft or publish. If the user chooses to
draft, route through the campaign engine. The final post still goes through the
normal human-approved publishing gate.

## Telemetry

After the Company Action Gate, emit telemetry only for prompts actually
surfaced:

```ts
import { emitMilestoneBrandSuggested } from "$CLAUDE_PLUGIN_ROOT/src/pipeline/milestone-brand";

emitMilestoneBrandSuggested(gatedClearMilestones);
```

The event is `milestone_brand_suggested`. It is local-only, gated by
`XOS_98_TELEMETRY`, and writes through `src/telemetry/events.ts`. Payload is
PII-free: count, stage breakdown, timestamp. Do not include company names, role
names, refs, notes, recruiter names, post text, or URLs.

## Safety Rules

- Fail-closed: no explicit shareable flag means no suggestion.
- Company Action Gate before every surfaced prompt.
- Draft/suggestion only; never auto-post.
- No network calls and no browser/social surfaces from this skill.
- Do not copy private pipeline notes into a brand prompt.
- Option B auto-detect-all remains deferred until a stealth-exclusion list exists.

## Dependencies

- `src/pipeline/milestone-brand.ts` for deterministic detection, prompt text, and
  local gated telemetry.
- `apply-tracker` for `stage_data[]` lifecycle semantics.
- `pipeline-view` for the pipeline read path.
- `rules/company-flags-filter/HOW.py` for company safety flags.
