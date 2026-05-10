---
name: apply-tracker
description: >
  Tracks application lifecycle after you apply — updates status across pipeline,
  tasks, and match tracker when you get a response, schedule an interview, or
  receive a rejection. Closes the loop between "I applied" and "what happened".
  Triggers: "I applied to", "update status", "got rejected from", "interview
  scheduled", "heard back from", "application update", "track application",
  "mark as applied", "they rejected me".
triggers:
  - at
  - I applied to
  - update status
  - got rejected from
  - interview scheduled
  - heard back from
  - application update
  - track application
  - mark as applied
  - they rejected me
---

# Apply Tracker — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_OS_GITHUB_REPO` is derived from: `git -C $CAREER_OS_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_OS_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_OS_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents)
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

**Write paths (canonical commands):**
- New "Waiting On" entry (post-Apply): `gh issue create --repo $CAREER_OS_GITHUB_REPO --title "Waiting — {Company} {Role}" --body "<typed work item body>" --label "tier:p3,cadence:operational,repo:career-os-data,kind:waiting-on"`
- Interview prep item: `--label "tier:p1,cadence:operational,repo:career-os-data,kind:prep"`
- Offer evaluation: `--label "tier:p1,cadence:operational,repo:career-os-data,kind:offer-eval"`
- Close on rejection / advance: `gh issue close <num> --reason "completed"` (or `--reason "not planned"` for skipped)

**Read paths:** `gh issue list --repo $CAREER_OS_GITHUB_REPO --state open --label "kind:waiting-on" --json number,title,body,labels,createdAt`

## Purpose

Closes the post-application gap. When you apply to a role, get a response,
schedule an interview, or receive a rejection, this skill propagates that status
change to ALL relevant files — so every other skill sees consistent data.

Without this skill, status changes are manually typed into one file and the
others drift. The apply-tracker is the single entry point for all pipeline
status transitions after the initial scan/score/add cycle.

## Output Format

Always start your response with:
```
━━━ Career OS: Apply Tracker ━━━
```

## How to Invoke

- "I applied to [Company]" — record a new application
- "applied to #68" — record application by match tracker number
- "applied to Harvey Director" — fuzzy name resolution
- "heard back from [Company]" — update with response
- "got rejected from [Company]" — record rejection
- "interview scheduled at [Company] on [Date]" — advance to interview stage
- "update [Company] status" — general status update
- "mark [Company] as applied" — same as "I applied to"
- "skip #72" or "skip Canva" — mark a role as SKIPPED (not pursuing)
- "batch update" — update multiple roles at once (e.g., after checking email)

---

## DATA ARCHITECTURE

### Files This Skill Writes To

| File | Path | What Gets Updated |
|------|------|-------------------|
| Pipeline JSON | `brain/projects/job-search/job-pipeline.json` | Update/add `stage_data[]` entries (recruiter, HM, comp, stage, next_action); add to `pending_referrals[]` when referral initiated |
| Match Tracker | `brain/projects/job-search/job-pipeline-match-tracker.json` | Update `status` field on the role object (e.g., `APPLIED`, `REJECTED`, `INTERVIEWING`) + set `updated_at` |
| Tasks | GitHub Issues `$CAREER_OS_GITHUB_REPO` | Open issues for new apps (`kind:waiting-on`), interview prep (`kind:prep`), offer eval (`kind:offer-eval`); close on rejection / advance. Labels: `tier:*`, `cadence:operational`, `repo:career-os-data`. |
| Handoff | `NEXT_SESSION_HANDOFF.md` | Log significant state changes (advances, rejections) for other agents |

### Files This Skill Reads

| Source | Path | What It Provides |
|--------|------|------------------|
| Pipeline JSON | `brain/projects/job-search/job-pipeline.json` | Current stage_data entries and pending_referrals |
| Match Tracker | `brain/projects/job-search/job-pipeline-match-tracker.json` | Role id, batch, score, current status |
| People | `brain/network/people/*.md` | Contact info for follow-up suggestions |

---

## STATUS LIFECYCLE

A role moves through these stages. The apply-tracker handles every transition:

```
Scan → Score → Ready to Apply → Applied → [Waiting] → Screen → Interview → Offer
                                    ↓                      ↓         ↓
                                 Rejected              Rejected  Declined
```

### Transition Actions

Each transition triggers specific file updates:

**Ready to Apply → Applied**
- Match Tracker: set `status` = `"APPLIED"`, `updated_at` = today on the role object (find by `id` or company+role match)
- Tasks: open a new GitHub issue:
  ```bash
  gh issue create --repo $CAREER_OS_GITHUB_REPO \
    --title "Waiting — {Company} {Role}" \
    --label "tier:p3,cadence:operational,repo:career-os-data,kind:waiting-on" \
    --body "$(cat <<EOF
  - **Severity:** High | **Value:** {comp from pipeline}
  - **Status:** blocked | **Blocked:** scheduled (daily stale check)
  - **Done when:** Response received or stale threshold hit (14d)
  - **Pipeline:** {pipeline-row reference}
  EOF
  )"
  ```
- Match Tracker: update Outcome column to "Applied {date}"
- Increment the Already Applied row count in the header

**Applied → Screen Scheduled**
- Pipeline JSON: add or update entry in `stage_data[]` with `stage: "advancing"`, screen date, recruiter details
- Tasks: open a new `tier:p1, kind:prep` issue for screen prep; close the `kind:waiting-on` issue (`gh issue close <num> --reason completed`)
- Handoff: log the advance

**Applied → Rejected**
- Match Tracker: set `status` = `"REJECTED"`, `updated_at` = today
- Tasks: close the `kind:waiting-on` issue (`gh issue close <num> --reason "not planned"`)
- Match Tracker: update Outcome to "Rejected {date}"
- Handoff: log the rejection

**Screen → Interview**
- Pipeline JSON: update `stage_data[]` entry with interview details (rounds, dates, interviewers), set `stage: "panel_interview"`
- Tasks: open one `tier:p1, kind:prep` issue per round:
  ```bash
  gh issue create --repo $CAREER_OS_GITHUB_REPO \
    --title "Prep for {Company} {Round} on {Date}" \
    --label "tier:p1,cadence:operational,repo:career-os-data,kind:prep" \
    --body "$(cat <<EOF
  - **Severity:** Critical | **Value:** {comp from pipeline}
  - **Status:** pending | **Blocked:** none
  - **Done when:** Prep doc generated and reviewed
  - **Due:** {interview_date - 1 day}
  EOF
  )"
  ```
- **NEW (v0.27):** ALSO invoke the `interviewer-research` skill with
  `{company, role, interviewers, date, jd_path?}` from the pipeline entry.
  The skill auto-generates per-interviewer background research (Perplexity
  + LinkedIn) and aggregates a dossier at
  `INPUT/{company-slug}-{date}-prep-dossier.md`. The existing per-round
  prep GitHub Issues (`kind:prep`) remain — `interviewer-research` is the
  research substrate behind them; per-round talking-points generation
  stays with the `interview-prep` skill.
- Suggest: "Say 'prep me for [Company]' to generate interview prep"

**Screen → Rejected**
- Match Tracker: set `status` = `"REJECTED"`, `updated_at` = today
- Pipeline JSON: remove entry from `stage_data[]` or add `stage: "dead"` note
- Tasks: close ALL related prep issues for this company (`gh issue close <num> --reason "not planned"`)
- Handoff: log

**Interview → Offer**
- Pipeline JSON: update `stage_data[]` entry with offer details; Match Tracker: set `status` = `"OFFERED"`
- Tasks: open a `tier:p1, kind:offer-eval` issue with the offer deadline as `Due:`
- Handoff: log (this is a major event)

**Any → Withdrawn**
- Match Tracker: set `status` = `"DEAD"`, note reason in `updated_at` or stage_data entry
- Tasks: close all related issues for this company with reason `not planned`
- Match Tracker: update Outcome

---

## ROLE RESOLUTION

Apply-tracker accepts role references in three forms:

1. **Company name:** "I applied to Harvey AI" — search pipeline/tracker by name
2. **`#N` reference:** "applied to #68" — look up by match tracker entry number
3. **Fuzzy name:** "applied to Harvey Director" — fuzzy match on company + role

### Resolution Flow

When the user provides `#N` or a fuzzy name:

1. Run `pipeline-query.py --lookup "{input}" --format json` from `~/.career-os-state/scripts/`
2. Parse the JSON output to get: company, role, score, resume track, JD URL
3. If ambiguous (multiple matches), present disambiguation (A/B/C scheme):
   ```
   Which Harvey role?
   A. #68 Engineering Director NY (88%)
   B. #85 Director Core Product (89% — already applied)
   C. #90 EM Product (86% — already applied)
   ```
4. Once resolved, proceed with the existing workflow using the resolved context

When routed from apply-dashboard with pre-loaded context, skip the resolution
step and proceed directly to file updates.

**Fallback:** If `pipeline-query.py` is not available, fall back to manually
searching pipeline and match tracker files by company name.

---

## BEHAVIOR: Skip Role

When user says "skip #72" or "skip Canva":

1. Resolve the role (via `#N` or fuzzy name)
2. Update match tracker: set Status column to `⏭️ SKIPPED` for that row
3. If user provides a reason ("skip #72 — video domain gap"), record it
4. Do NOT update pipeline or Tasks (skip = not pursuing)
5. Confirm:

```
━━━ Skipped: {Company} — {Role} ━━━

✅ Tracker: Status updated to SKIPPED
   Reason: {reason if provided, otherwise "—"}

→ Say "dashboard skipped" to see all skipped roles
```

---

## BEHAVIOR: Record Application

When user says "I applied to [Company]", "applied to #68", or "mark [Company] as applied":

### Step 1: Find the Role

Resolve the role using the resolution flow above. If using company name only,
search Pipeline's "Ready to Apply" section first. If not found, search Match
Tracker. If still not found, ask the user for details (role title, URL, which
resume track was used).

### Step 2: Update All Files

Apply the "Ready to Apply → Applied" transition (see above).

### Step 3: Confirm

```
━━━ Applied: {Company} — {Role} ━━━

✅ Pipeline: moved to Already Applied (#{row_number})
✅ Tasks: opened issue #{N} (kind:waiting-on, applied {date})
✅ Tracker: outcome updated to "Applied {date}"

Follow-up reminder set for {date + 10 business days}.

→ Say "customize resume for {Company}" if you haven't tailored yet
→ Say "who do I know at {Company}" to find warm intro paths
```

---

## BEHAVIOR: Batch Update

When user says "batch update" or provides multiple status changes at once
(e.g., "got rejected from Microsoft and Anthropic, interview at Affirm"):

1. Parse all updates from the user's message
2. Show a confirmation table before applying:

```
━━━ Batch Update Preview ━━━

| # | Company | Current Status | New Status | Action |
|---|---------|---------------|------------|--------|
| 1 | Microsoft | Waiting (Applied 3/25) | ❌ Rejected | Close |
| 2 | Anthropic EM FS | Waiting (Applied 3/20) | ❌ Rejected | Close |
| 3 | Affirm | Screen completed | Interview scheduled | Advance |

Apply all? (y/n/pick numbers)
```

3. On approval, apply all transitions and show the summary

---

## BEHAVIOR: Status Check

When user asks "what's happening with [Company]":

1. Search all three files for the company
2. Consolidate into a single view:

```
━━━ {Company} Status ━━━

Score: {N}% (scored {date}, batch #{N})
Stage: {current stage}
Applied: {date}
Last update: {date} — {what happened}
Contacts: {any people files for this company}
Next action: {from Tasks or Pipeline}
```

---

## MULTI-AGENT SAFETY (P15)

This skill writes to 3 shared files plus the GitHub Issues task substrate. For each write:
1. Re-read the target file immediately before editing (or fetch the issue with `gh issue view <num> --json title,body,labels` before edit)
2. Use surgical edits — append rows, update specific cells, never rewrite tables; for issues, use `gh issue edit` rather than re-create
3. Log all changes to handoff doc so other agents see them
4. If a conflict is detected (file changed between read and write), re-read and retry

### SSOT Write Rules (ADR-001)
- Application **status** (Applied/Rejected/Interviewing/Offered) writes to `job-pipeline-match-tracker.json` (the `status` field on the role object)
- Application **stage detail** (recruiter name, HM, comp, next action) writes to `job-pipeline.json` → `stage_data[]`
- Do NOT duplicate application status into people/*.md or task issues (open task issues track ACTIONS waiting on the app, not the app's status itself)
- When a status change affects a warm contact (e.g., rejection after referral), update the people file's referral_status field only
- Pipeline-sync validates cross-references as a safety net

---

## Greenhouse Portal Verification (WO-043, REQ-001)

Many target companies use Greenhouse ATS. After submitting an application,
confirmation emails may be missed (spam, filtering, late delivery). Greenhouse
provides a single portal at `https://my.greenhouse.io/applications/` where
all Greenhouse-hosted applications are visible with current status.

### Greenhouse Company List (self-evolving per P14)

```yaml
greenhouse_companies:
  - Anthropic
  - Render
  - Replit
  - Harvey
  - Affirm
  - Snorkel
  - Handshake
```

Extend this list when a user applies to a new company and their portal URL
contains `greenhouse.io` or `boards.greenhouse.io`. Add entries alphabetically.

### Verification Prompt (after Ready to Apply → Applied transition)

When the user triggers `applied to {Company}` and `{Company}` is in the
Greenhouse list, emit this prompt **after** writing the status change to
`job-pipeline-match-tracker.json`:

```
You marked {Company} {Role} as Applied.

{Company} uses Greenhouse. Verify your submission at:
  https://my.greenhouse.io/applications/

Want to verify now? (If you have the portal open, tell me what status it shows.)
```

### Handling Portal Status Responses

| User Response | Action |
|---|---|
| "Application received" / "Under review" / "Submitted" | Add `verified: greenhouse` metadata tag to the pipeline entry. Note the verification in the commit message. |
| "Not found" / "No application listed" | Warn: "Greenhouse doesn't show this application. Submission may have failed. Revert to Ready to Apply and try resubmitting?" Offer revert. |
| "Rejected" / "No longer under consideration" | Route directly to the rejection flow — update status to Rejected with today's date. |
| User skips verification / no response | Proceed normally. Do NOT add `verified` tag. No blocking. |

### Rules

- **Verification is always optional.** Never block the status transition on a
  missing verification. The system nudges, it does not gate.
- **No browser automation.** Greenhouse portal requires authentication — do
  not attempt to scrape it. Human-in-the-loop only.
- **Non-Greenhouse companies:** skip the verification prompt entirely. Do not
  ask the user to verify on a portal that doesn't apply to them.
- **SSOT:** add `"verified": "greenhouse"` field to the matching `stage_data[]` entry in `job-pipeline.json`. No separate verification file.

---

## IMPLEMENTATION PHASES

### Phase 1 (Current): Manual Triggers
- All transitions triggered by user messages
- Batch update with confirmation
- Status check queries

### Phase 2: Auto-Detection
- Monitor email/notification integrations for rejection emails
- Auto-suggest status updates when recruiter emails arrive
- Calendar integration for interview scheduling
