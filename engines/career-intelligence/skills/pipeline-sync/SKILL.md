---
name: pipeline-sync
description: >
  Reconciles data across Career OS's three core surfaces: job-pipeline.json (stage detail + referrals),
  job-pipeline-match-tracker.json (status + scoring), and GitHub Issues at $CAREER_OS_GITHUB_REPO
  (action items — replaces Tasks.md as of v0.25.0). Detects
  drift between surfaces, propagates updates, and ensures row counts and statuses
  are consistent. Use whenever data feels out of sync, after bulk operations,
  or on a schedule. Triggers: "sync pipeline", "reconcile", "data health check",
  "pipeline audit", "fix pipeline", "are my files in sync".
triggers:
  - ps
  - sync pipeline
  - reconcile
  - data health check
  - pipeline audit
  - fix pipeline
  - are my files in sync
---

# Pipeline Sync — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_OS_GITHUB_REPO` is derived from: `git -C $CAREER_OS_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_OS_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_OS_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents): `gh issue list --repo $CAREER_OS_GITHUB_REPO --state open --json number,title,body,labels,createdAt`
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

Pipeline-sync reconciles **Pipeline (markdown)** ↔ **Match Tracker (markdown)** ↔ **Open task issues (GitHub)**. Issue creates/closes are made via `gh issue create` / `gh issue close` against `$CAREER_OS_GITHUB_REPO`.

## Purpose

Career OS stores pipeline state across three interdependent files. When one file
is updated (by a scan, an application, or manual edit), the others can drift.
This skill detects inconsistencies and reconciles them — so every skill that reads
pipeline data gets a consistent view.

The three core files and their roles:

| File | Path | Role |
|------|------|------|
| Pipeline | `brain/projects/job-search/job-pipeline.json` | Source of truth for **status** (stage, comp, next action) |
| Match Tracker | `brain/projects/job-search/job-pipeline-match-tracker.json` | Source of truth for **scoring** (match %, category breakdowns) |
| Tasks | GitHub Issues `$CAREER_OS_GITHUB_REPO` | Source of truth for **action items** (what to do next, priority via `tier:*` label) |

## Output Format

Always start your response with:
```
━━━ Career OS: Pipeline Sync ━━━
```

## How to Invoke

Say any of: "sync pipeline", "reconcile", "data health check", "pipeline audit",
"fix pipeline", "are my files in sync"

**Scheduled:** Can run daily (recommended: after the job scan completes) via
Cowork's `schedule` skill infrastructure.

---

## DATA ARCHITECTURE

### Inputs (what the skill reads)

| Source | Path | What It Provides |
|--------|------|------------------|
| Pipeline | `brain/projects/job-search/job-pipeline.json` | Current status of all roles |
| Match Tracker | `brain/projects/job-search/job-pipeline-match-tracker.json` | Scoring history for all evaluated roles |
| Tasks | GitHub Issues `$CAREER_OS_GITHUB_REPO` (open, `kind:waiting-on`/`kind:prep`/etc.) | Current action items and "Waiting On" entries |
| Scan reports | `brain/scans/{YYYY-MM-DD}/` | Recent scan outputs (for new roles not yet in pipeline) |
| Handoff | `NEXT_SESSION_HANDOFF.md` | Recent state changes that may not be reflected in files |

### Outputs (what the skill writes)

| Output | Path | What It Contains |
|--------|------|------------------|
| Pipeline (updated) | `brain/projects/job-search/job-pipeline.json` | Reconciled statuses, corrected row counts |
| Tasks (updated) | GitHub Issues `$CAREER_OS_GITHUB_REPO` | New issues (`kind:waiting-on`, action items), closed stale issues |
| Sync report | Console output | Summary of what was found and fixed |

The match tracker is **read-only** for this skill — scoring is the job-match-scorer
skill's domain. Pipeline-sync reads it but never writes to it.

---

## BEHAVIOR: Sync Check

### Step 1: Read All Three Files

Read the current state of all three files. Count actual rows (never trust header
counts — headers lie).

### Step 2: Detect Inconsistencies

Run these checks:

**A. Row count audit**
- Count actual data rows in the Already Applied table of `job-pipeline.json`
- Compare to the count stated in the section header
- If mismatch → flag and fix the header

**B. Status drift (Pipeline ↔ Task issues)**
- For each role in Pipeline's Active section: verify a corresponding open issue exists
  on `$CAREER_OS_GITHUB_REPO` (either `tier:p1`/`tier:p2` action item or `kind:waiting-on`)
- For each open `kind:waiting-on` issue: verify the role still exists in Pipeline
  and hasn't been rejected/closed
- Flag orphans in either direction

**C. Score drift (Pipeline ↔ Match Tracker)**
- For each role in Pipeline's "Ready to Apply" section: check if a score exists
  in the Match Tracker
- For scored roles marked "Applied" in Match Tracker's Outcome column: verify
  they appear in Pipeline's Already Applied table
- Flag missing entries

**D. Scan → Pipeline propagation**
- Check the most recent scan date in `brain/scans/`
- For each role in that scan: verify it appears in Pipeline (either Ready to Apply,
  Already Applied, or explicitly skipped)
- Flag roles found in scans but missing from Pipeline

**E. Stale entry detection**
- Open `kind:waiting-on` issues older than 14 days with no status change (no comment or label edit) → flag for review
- Active entries with past-due next actions → flag as overdue

**F. Score quality check**
- For each role in Match Tracker with Quality `⚠️ title-only` and Status `QUEUED`:
  flag as requiring re-score before applying
- For `⚠️ title-only` roles with Decision above `⏳ CHECK DELTA`: flag as data quality
  violation (should have been capped by job-match-scorer)
- **Rescore Queue detection:** For each `⚠️ title-only` role, check if a JD is now
  available (file in `brain/reference/jd-samples/` or fetchable URL). If yes,
  add to Rescore Queue — these can be batch-rescored immediately.
- Output:
  ```
  ⚠️ Title-only scores need re-scoring:
    - #75 Kadence VP Eng (89%) — scored from title only, JD not fetched
  → Say "rescore #75" to re-score with full JD, or "verify queue" to fetch JD first

  🔄 Rescore Queue (JD now available — can rescore immediately):
    - #82 Acme Staff Eng (68%) — JD fetched since scoring
    - #91 FooCorp Senior Eng (74%) — JD fetched since scoring
  → Say "rescore queue" to batch-rescore all {N} roles with full JDs
  ```

### Step 3: Present Findings

Show a health report:

```
━━━ Pipeline Health Report ━━━

✅ Row count: 104 actual = 104 in header
⚠️ Status drift: 2 issues found
   - Harvey AI EM Product: in Pipeline (Applied 3/31) but no open `kind:waiting-on` issue on $CAREER_OS_GITHUB_REPO
   - Goodfire: open `kind:waiting-on` issue #128 (3/17) but no update in 14 days — stale?
✅ Score coverage: all Ready to Apply roles have scores
⚠️ Scan propagation: 1 role from 3/31 scan not in Pipeline
   - You.com Director Platform (85%) — not yet in Ready to Apply or Applied
✅ No overdue active entries

━━━ Proposed Fixes ━━━
1. Open `kind:waiting-on` issue for Harvey AI EM Product (Applied 3/31)
2. Flag Goodfire issue #128 for follow-up decision (14 days, no response)
3. Add You.com to Pipeline "Ready to Apply"

Apply fixes? (y/n/pick numbers)
```

### Step 4: Apply Fixes

On user approval (or all if running in Cruise Control mode):
- Make surgical edits to each file (P15: never rewrite entire files)
- Update row counts if they changed
- Open new GitHub issues in typed work-item format:
  ```bash
  gh issue create --repo $CAREER_OS_GITHUB_REPO \
    --title "{description}" \
    --label "tier:p3,cadence:operational,repo:career-os-data,kind:waiting-on" \
    --body "$(cat <<EOF
  - **Severity:** {severity} | **Value:** {from pipeline comp}
  - **Status:** pending | **Blocked:** none
  - **Done when:** {specific condition}
  EOF
  )"
  ```
- Report what was changed

### Step 5: Commit

After fixes are applied, create a single atomic commit:
```
sync: reconcile pipeline, tasks, and tracker ({N} fixes)
```

---

## BEHAVIOR: Post-Scan Sync

When triggered after a job scan completes (either manually or via schedule):

1. Read the latest scan report from `brain/scans/{today}/`
2. For each new role in the scan:
   - If score ≥ 80%: add to Pipeline "Ready to Apply" section with score and
     recommended resume track
   - If score 60-79%: add to Pipeline "Ready to Apply" with "Check Delta" flag
   - If score < 60%: skip (already logged in scan report)
3. Run the full sync check (Steps 2-5 above)

This is the "write-back" that closes the loop between scanning and pipeline state.

---

## BEHAVIOR: Scheduled Sync

When running on a schedule (recommended: daily, 30 min after scan):
- Run the full sync check
- If no issues found: log a one-liner to the scan report and exit quietly
- If issues found: write them to `NEXT_SESSION_HANDOFF.md` under a
  "Pipeline Sync Alerts" section for the next agent to see
- Auto-fix only safe changes (row count corrections, opening missing
  `kind:waiting-on` issues). Stale entry decisions require human judgment — write to handoff doc.

---

## MULTI-AGENT SAFETY (P15)

This skill touches three shared files. Before writing to any file:
1. Re-read the file (another agent may have updated it)
2. Apply only surgical edits (append rows, update specific cells)
3. Never rewrite entire tables — merge your changes into the current state
4. If a merge conflict is detected, stop and report to the user

### SSOT Validation Rules (ADR-001)
In addition to reconciling the 3 core files, pipeline-sync should now validate:

1. **Warm Intros table consistency:** For each row in job-pipeline.json's Warm Intros table, verify the corresponding people/*.md file exists and its status matches. Flag mismatches but do NOT auto-fix — present to user.

2. **Cross-reference validation:** For each active pipeline role with a warm contact, verify the people file's referral_status references the correct role.

3. **Stale detection:** Flag people/*.md files where last_contact > 14 days and status is still "ACTIVE" — likely stale.

4. **Missing people files:** Flag contacts mentioned in job-pipeline.json that have no corresponding people/*.md file.

---

## IMPLEMENTATION PHASES

### Phase 1 (Current): Manual + Post-Scan
- Detects all 5 inconsistency types
- Presents findings and proposes fixes
- Applies fixes on approval
- Runs after scan via manual trigger or schedule

### Phase 2: Auto-Heal
- Safe fixes applied automatically (row counts, missing `kind:waiting-on` issues)
- Risky fixes (stale closures, score mismatches) still require approval
- Webhook integration: triggers automatically when job-pipeline.json changes (file watcher) or when issues open/close on `$CAREER_OS_GITHUB_REPO` (GitHub webhook)
