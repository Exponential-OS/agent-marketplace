---
name: follow-up-nudge
description: >
  Surfaces one-week and two-week follow-up nudges for applications that are
  applied and awaiting response, with a plain-text draft ready for the human
  to approve. Draft-only: never sends. Use when the user asks what to follow
  up on, stale applications, application nudges, or job-search follow-ups.
triggers:
  - follow-up nudge
  - follow up nudges
  - application follow ups
  - stale applications
  - who should I follow up with
  - follow up on applications
---

# Follow-Up Nudge — Career OS Skill

## Purpose

Find applications that have gone quiet and prepare follow-up drafts the user
can review. The skill reads the same pipeline source as pipeline-view:
`career-intelligence/projects/job-search/job-pipeline.json` and its
`stage_data[]` entries.

v1 is a surface only. It computes nudges, drafts messages, shows them, emits
local gated telemetry when enabled, and waits. It does not send messages.

## Company Action Gate (run BEFORE surfacing each nudge)

A follow-up is a `follow_up` action on a named company, so it is subject to the
Company Action Gate. Before surfacing a nudge for any company, run the
company-flags filter and honor the verdict — a deprioritized or flagged company
must never surface as an action, even if its stage is `applied`:

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/company-flags-filter/HOW.py 2>/dev/null | tail -1)" \
  '{"company":"<name>","action":"follow_up","flags_file":"'"$CAREER_HOME"'/career-intelligence/projects/job-search/company-flags.json"}'
```

- exit 1 = BLOCK → suppress this company's nudge entirely (do not show the draft).
- exit 2 = WARN → do not surface the follow-up; surface the referral/flag status instead.
- exit 0 = clear → proceed to draft.

The gate FAIL-HARDs (BLOCK) if `flags_file` is provided but missing — never
silent-pass on absent safety config.

Gate semantics to know (by design, not a gap): a `deprioritized` company is
BLOCKED for every action including `follow_up`. A `flagged do_not_apply` company
is blocked only for `apply`/`referral` (new asks) — `follow_up` on an
already-submitted application is intentionally permitted (you are continuing an
existing thread, not opening a new one). This gate is the single source of truth
for company flags (same gate mission-control and apply-dashboard invoke); do not
re-implement flag logic inside the helper.

## Direct Outreach Gate

This skill is under the Direct Outreach Gate because the next action is outreach
to a real named human.

Required sequence:
1. Ground in the contact if a people file exists.
2. Draft the message.
3. Show the full draft to the user.
4. Wait for explicit approval for that single message.
5. Never auto-send from this skill.

A blanket approval for multiple drafts approves zero sends. Each draft needs
its own explicit per-message approval in its own turn. Showing a draft is not
sending. Do not update `last_contact`, `message_sent`, or any people-file
outreach state from a draft.

## Cadence

Read `stage_data[]` and consider only entries whose stage is:
- `applied`

`applied` is the unambiguous "I applied, no first response yet" stage (lifecycle:
Applied → [Waiting] → Screen → Interview → Offer). Do NOT nudge:
- `deprioritized` — the Company Action Gate (below) forbids surfacing it.
- engaged / awaiting-their-decision stages — `advancing`, `in_process`,
  `awaiting_decision`, `panel_interview` — you are already in contact.
- closed stages — `rejected`, `dead`, `declined`, `offered`.

Use the deterministic helper:

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/pipeline/followup-nudge.ts" \
  --pipeline "$CAREER_HOME/career-intelligence/projects/job-search/job-pipeline.json" \
  --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --emit
```

The CLI wraps `computeFollowupNudges(pipeline, nowIso, opts)` with the parsed
pipeline object and an explicit `nowIso`. The pure helper itself never reads
the clock.

Nudge rules:
- 1-week nudge: days since applied or last activity is at least 7 and less than 14, unless a 1-week nudge is already logged.
- 2-week nudge: days since applied or last activity is at least 14, unless a 2-week nudge is already logged.
- Missing, empty, or malformed entries are skipped. Never crash because one pipeline row is bad.

Dedup contract: the helper reads prior nudge markers (per-entry flags like
`followup_1wk_logged` / a `followup_nudges[]` log, or the `loggedNudges` option)
and suppresses a cadence once it is logged. Those markers are written by
`apply-tracker` when the user records the follow-up as actually sent — NOT by this
draft-only skill (writing "nudged" from a mere draft would be false state). So a
nudge intentionally RE-SURFACES every run until the follow-up is sent (and logged)
or the application advances out of `applied`. That persistence is correct reminder
behavior, not a bug — a reminder that stops before you act is useless.

After presenting nudges, call `emitFollowupNudgesSurfaced(nudges)`. It uses
`src/telemetry/events.ts`, writes only local JSONL when `XOS_98_TELEMETRY` is
enabled, and performs zero network calls.

## Read Paths

Primary:
`brain.read("career-intelligence/projects/job-search/job-pipeline.json")`

Fallback, matching pipeline-view:
`$CAREER_HOME/career-intelligence/projects/job-search/job-pipeline.json`

Contact grounding:
- Identify a named contact from `recruiter`, `hm`, `hiring_manager`, or `contact`.
- If a contact is present, look for a people file in `network/people/` using the existing primitives path. Prefer JSON, tolerate legacy Markdown.
- Use relationship context, channel preference, company, and role from the people file when present.
- If no people file exists, draft a neutral follow-up and make the recipient placeholder explicit.

## Output Format

Always start with:

```text
━━━ Career OS: Follow-Up Nudges ━━━
```

If there are no nudges:

```text
No follow-up nudges due.
```

If there are nudges, show each application and draft in plain text. Do not use
Markdown tables, pipe characters, bold, code fences, or backticks in the copy
the user will paste.

Template:

```text
1. Acme AI — Engineering Manager
Reference: #105
Applied or last activity: 2026-06-22
Age: 8 days
Cadence: 1wk
Contact grounding: Priya Shah, recruiter, email preferred, last contact 2026-06-22

Draft
Subject: Following up on Engineering Manager

Hi Priya,

I wanted to follow up on my application for the Engineering Manager role at Acme AI. I’m still very interested in the team and the problem space, and I’d be glad to share any additional context that would help with the review.

Thanks,
Anand

Gate: Draft only. I will wait for your explicit approval for this one message before any send. This skill never auto-sends.
```

For a 2-week nudge, keep the tone concise and non-pushy:

```text
Draft
Subject: Checking in on Engineering Manager

Hi Priya,

I wanted to check in on my application for the Engineering Manager role at Acme AI. I remain interested and would appreciate any update you can share when convenient. If there is anything else I can provide, I’m happy to send it over.

Thanks,
Anand
```

## Safety Rules

- Draft only. Never auto-send.
- Never open a browser, Gmail, LinkedIn, or any network surface from this skill.
- Never mark a message as sent from a draft.
- Never update people-file outreach history unless the user later confirms the message was sent.
- Keep drafts paste-safe plain text.
- If a draft includes a new biographical claim about the user, run the outreach-fact-check or biographical-claim precheck before showing the draft.

## Dependencies

- `src/pipeline/followup-nudge.ts` for deterministic nudge computation and local gated telemetry.
- `apply-tracker` for the lifecycle meaning of `stage_data[]`.
- `pipeline-view` for the applied-awaiting-response stage read path.
- `outreach-composer` and `outreach-fact-check` for the Direct Outreach Gate discipline.
