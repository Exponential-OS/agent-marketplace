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

`$CAREER_HOME` defaults to `~/anand-career-os`. If the user has set
`--career-home` elsewhere, use that path.

### Step 3: Print the output verbatim

Render the script's stdout directly — do not paraphrase, summarize, or
reformat it. The script owns the display logic.

If the script errors (file not found, JSON parse error), surface the
error message and suggest `sync pipeline` to diagnose data health.

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
