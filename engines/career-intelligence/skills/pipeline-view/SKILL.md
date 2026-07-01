---
name: pipeline-view
description: >
  Shows the live job pipeline — active interviews, referral status with overdue
  alerts, applied roles, apply queue, and summary metrics. Reads job-pipeline.json
  and job-pipeline-match-tracker.json and renders a formatted view on demand.
  Say "pipeline", "show referrals", "who's in the queue", or "pipeline summary".
triggers:
  - pipeline
  - pv
  - show pipeline
  - active pipeline
  - referrals
  - show referrals
  - referral status
  - apply queue
  - show queue
  - pipeline summary
  - who's advancing
  - what's active
  - pipeline view
---

# Pipeline View — Career OS Skill

## Purpose

Human-readable view of the job pipeline, rendered on demand from JSON sources.
This skill has one job: run `pipeline-view.py` with the right flags and show
the output. No state mutations. No writes.

## Output Format

Always start with:
```
━━━ Career OS: Pipeline View ━━━
```

## How to Invoke

| User says | Section shown |
|---|---|
| `pipeline` / `show pipeline` | All sections |
| `active pipeline` / `who's advancing` | Active/advancing only |
| `referrals` / `show referrals` / `referral status` | Pending referrals with overdue alerts |
| `applied` / `what have I applied to` | Applied roles awaiting response |
| `apply queue` / `show queue` | Scored roles not yet applied, ranked by score |
| `pipeline summary` | Summary metrics only |

---

## BEHAVIOR

### Step 1: Map intent to `--section` flag

| Trigger pattern | Flag |
|---|---|
| referral(s) | `--section referrals` |
| active / advancing / interviews | `--section active` |
| applied / awaiting response | `--section applied` |
| queue / apply queue | `--section queue` |
| summary / metrics | `--section summary` |
| anything else / no qualifier | `--section all` |

### Step 2: Run the script

```bash
python3 ~/.career-os-state/scripts/pipeline-view.py \
  --career-home $CAREER_HOME \
  --section <section>
```

`$CAREER_HOME` must be set to the customer's workspace root (typically `~/career-os` or wherever they keep their career data). Run `career-intelligence-onboarding` if unsure.

### Step 3: Print the output verbatim

Render the script's stdout directly — do not paraphrase, summarize, or
reformat it. The script owns the display logic. If content-attributed
inbounds exist, append the XOS-102 block below after the script output.

If the script errors (file not found, JSON parse error), surface the
error message and suggest `sync pipeline` to diagnose data health.

### Step 4: Content-attributed inbound DMs (XOS-102)

The DM count is per-DM, NOT per-contact — one recruiter can send multiple
post-attributed DMs, so counting contacts under-counts. The per-DM unit of
record is the `content_to_dm_tracked` telemetry event (one event = one
attributed DM).

Count = the number of `content_to_dm_tracked` events in the telemetry log
(`$CAREER_OS_EVENTS_LOG` / `$XOS_EVENTS_LOG`, default `~/.career-os-events.jsonl`).
Each event carries `post_id` + `dm_source` (+ `contact_slug`). List one line
per event. Append a plain-text-friendly block:

```
━━━ Content → Inbound DMs ━━━
{N} inbound DMs attributed to your posts.
- inbound from {contact_slug} via post {post_id}
  source: {dm_source}
```

Fallback when the telemetry log is absent (e.g. `XOS_98_TELEMETRY` was off):
read `$CAREER_HOME/network/people/*.md` frontmatter, count contacts with
`source: post` + non-empty `post_id`, and label the number a **lower bound**
("≥{M} (contact-level; enable XOS_98_TELEMETRY for per-DM counts)") since it
collapses multiple DMs per contact.

If there are zero post-attributed inbounds (no events AND no flagged contacts),
omit the block unless the user asked specifically for content attribution.

---

## ROUTING

This skill is read-only. For any mutations, route to the appropriate skill:

| User follow-up | Route to |
|---|---|
| "I applied to #N" / mark as applied | apply-tracker |
| "follow up with [Name]" | outreach-composer |
| "prep me for [Company]" | interview-prep |
| "update BuildOps status" | apply-tracker |
| "sync pipeline" / "something looks wrong" | pipeline-sync |
| "score the queue" | job-match-scorer |

---

## FOOTER (always append after output)

```
━━━ Actions ━━━
→ "applied to #N"              — record application
→ "follow up with [Name]"      — draft follow-up message
→ "pipeline summary"           — metrics only
→ "referrals"                  — referral status + overdue alerts
→ "sync pipeline"              — diagnose data health
```
