---
name: cruise-control
description: >
  Autonomous execution engine for Career OS. Takes a plan (from open GitHub
  Issues at $CAREER_GITHUB_REPO, or a conversation-agreed task list) and
  executes it end-to-end — applying to roles,
  generating resumes, sending outreach, updating pipeline. Gate-controlled: only
  activates on explicit user instruction. Presents a visibility table after every
  batch.
triggers:
  - cruise control
  - cc
  - do it
  - execute
  - ship it
  - go
  - execute the plan
  - run the queue
---

# Cruise Control — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_GITHUB_REPO` is derived from: `git -C $CAREER_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents)
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

**Execution order:** Cruise Control reads from `tier:p1` first (highest priority), then `tier:p2`, with operational items (`cadence:operational`) preferred over strategic for short-cycle batch runs:
```bash
gh issue list --repo $CAREER_GITHUB_REPO --state open \
  --label "tier:p1" --json number,title,body,labels --limit 50
gh issue list --repo $CAREER_GITHUB_REPO --state open \
  --label "tier:p2" --json number,title,body,labels --limit 50
```

**Status transitions** translate to label edits + issue close:
- `in_progress` → `gh issue edit <num> --add-label "status:in-progress"`
- `done` → `gh issue close <num> --reason completed`
- `blocked` → `gh issue edit <num> --add-label "status:blocked"` + comment with blocker context

## Purpose

Cruise Control is the autonomous execution engine. It takes an agreed plan and
executes it with minimal human intervention — applying to roles, generating
documents, updating files, and reporting results. It exists to protect the human's
time (P13) by turning a list of tasks into completed work.

This was previously a Kernel-level execution mode (Layer 2). It is now a plugin
skill (Layer 3) because it orchestrates other Career OS skills and benefits from
the same upgrade/versioning/testing infrastructure.

## Output Format

Always start your response with:
```
━━━ Career OS: Cruise Control ━━━
```

## How to Invoke

Say any of: "cruise control", "cc", "do it", "execute", "ship it", "go",
"execute the plan", "run the queue"

---

## GATE CONTROLLER

Cruise Control is **gate-controlled** — it ONLY activates when the user
explicitly triggers it. This is a safety mechanism: autonomous execution of
career-critical tasks (applications, outreach) requires explicit human consent.

### Activation Gates

**Explicit triggers (any of these activate Cruise Control):**
- "do it", "execute", "ship it", "go"
- "cruise control", "cc"
- "execute the plan", "run the queue"

**NOT triggers (these do NOT activate Cruise Control):**
- "can you do it?" (question, not instruction)
- "what would you do?" (hypothetical)
- "plan this" (planning mode, not execution)
- Implied urgency without explicit instruction

**When in doubt:** Ask. "Ready to execute? Say 'go' to start Cruise Control."

### Plan First (Never Skip)

Cruise Control requires a plan before execution. The plan can come from:

1. **GitHub Issues at `$CAREER_GITHUB_REPO`** — the standing task list, organized by `tier:*` labels (replaces Tasks.md as of v0.25.0)
2. **Conversation agreement** — a plan discussed and approved in this session
3. **Handoff doc** — tasks inherited from a previous session

If no plan exists when Cruise Control is triggered:
```
━━━ Career OS: Cruise Control ━━━

No execution plan found. Let me build one from your current state.

[Reads pipeline, tasks, scan results]
[Presents proposed plan with numbered items]

Approve this plan? Say "go" to execute.
```

Every plan shows its reasoning chain — expose thinking step-by-step before
delivery. The user sees WHY each task is ordered the way it is.

### Tasks = Contract

Once a plan is accepted, it WILL be executed or explicitly renegotiated.
If circumstances change mid-execution (new information, a task turns out to
be blocked), Cruise Control renegotiates by presenting the updated situation
and asking for direction — it doesn't silently skip.

---

## EXECUTION ENGINE

### Typed Work Item Routing

GitHub Issues at `$CAREER_GITHUB_REPO` use labels for typed metadata
that Cruise Control reads to determine routing and execution order.

**Routing by `blocked_on:*` label (parsed from issue body or label suffix):**

| `blocked_on` value | CC Behavior |
|---|---|
| `none` | Pick up and execute immediately |
| `cowork` | Execute (we ARE the Cowork session) |
| `human` | Skip — add to blocked summary, send notification via `unblock_channel` |
| `cli` | Skip — write handoff command to `NEXT_SESSION_HANDOFF.md` |
| `async` | Send approval request via `unblock_channel`, continue other items, resume when approved |
| `scheduled` | Skip — verify scheduled task exists |
| `dependency:#{N}` | Resolve dependent issue #{N} first, then unblock this item |

**Execution order:** Sort by `tier:*` label (`tier:p1` first, then `p2`/`p3`/`backlog`), then by severity within tier (critical → high → medium → low) extracted from the issue body. This replaces flat queue ordering.

**Status transitions:** When picking up an issue, add `status:in-progress` label
(`gh issue edit <num> --add-label status:in-progress`). On completion, close the
issue (`gh issue close <num> --reason completed`) and the closing-session ID is
captured in the closing comment. On failure, add `status:blocked` label and
comment with the error context.

### Task List Intelligence

The task list is a living artifact, not a static queue. During execution:

- **Split** items that are too large. "Apply to 5 roles" becomes 5 discrete tasks.
- **Merge** items that execute more efficiently together. "Generate resume for
  Company A" + "Generate resume for Company B" (same track) → batch.
- **Reorder** based on discovered dependencies. If applying to Company X requires
  a resume that hasn't been generated yet, move resume generation before application.
- **Promote** items that become urgent during execution (e.g., a deadline discovered
  while researching a role).

### Atomic Split

When Cruise Control completes its part of a task but a human must act:

```
Task: "Apply to Affirm — Director"
  ✅ [completed] Resume customized (cover letter opt-in only — WO-044)
  ⏳ [blocked:human] Submit application at affirm.com/careers (requires login)
```

The completed portion is saved. The human portion is clearly marked with
instructions. Cruise Control moves to the next task.

### Relentless Forward Progress

If blocked on human input for one task, Cruise Control moves to the next task
in the queue. It never freezes the entire queue waiting for one answer.

Blocked tasks are collected and presented at the end:
```
⏳ BLOCKED (needs your input):
  3. Affirm application — needs manual submission at affirm.com/careers
  7. Scale AI outreach — need to confirm: should we mention Director path?
```

### Skill Orchestration

Cruise Control doesn't implement application logic itself — it orchestrates
other Career OS skills:

| Task Type | Skill Invoked |
|-----------|--------------|
| Customize resume | `resume-engine` |
| Score roles | `job-match-scorer` |
| Find warm intros | `network-intelligence` |
| Write outreach | `outreach-composer` |
| Generate interview prep | `interview-prep` |
| Update pipeline status | `apply-tracker` |
| Reconcile data | `pipeline-sync` |
| Find new roles | `job-search-scheduler` |

### Error Handling

When a task fails:
1. Log the error with context
2. Mark the task as ❌ with the error reason
3. Move to the next task
4. Include failed tasks in the visibility table with actionable error info

---

## VISIBILITY TABLE

After every batch (or at natural breakpoints during long execution), Cruise
Control ALWAYS presents a summary table. This is non-negotiable — silent
shipping violates P10 (Visual-First) and P8 (Feedback Loops).

```
━━━ Cruise Control: Batch Complete ━━━

| # | Task | Status | Files Changed | Needs Input? |
|---|------|--------|---------------|-------------|
| 1 | Score 3/31 scan roles | ✅ | job-pipeline-match-tracker.json | No |
| 2 | Apply: Visa Director | ✅ | job-pipeline.json, issue #142 closed | No |
| 3 | Apply: Sierra AI EM | ✅ | job-pipeline.json, issue #143 closed | No |
| 4 | Apply: Affirm (submit) | ⏳ | Resume generated | Yes — manual submit |
| 5 | Draft outreach: Ron Deang | ✅ | (console output) | Review before sending |

Completed: 3/5 | Blocked: 1 | Needs Review: 1

→ Say "go" to continue with remaining tasks
→ Or give me new instructions
```

### Visibility Table Rules

- One row per task (not per sub-step)
- Status uses: ✅ (done), ⏳ (blocked/waiting), ❌ (failed)
- "Files Changed" lists actual files modified (helps with git review)
- "Needs Input?" is always answered — never left blank
- Table appears after EVERY batch, even if all tasks succeeded

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Tasks | GitHub Issues `$CAREER_GITHUB_REPO` | The execution queue (open issues, sorted by `tier:*` label) |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Role details for execution |
| Match Tracker | `career-intelligence/projects/job-search/job-pipeline-match-tracker.json` | Scores and recommendations |
| Scan reports | `career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/` | Roles to process |
| Handoff | `NEXT_SESSION_HANDOFF.md` | Inherited tasks and context |
| People | `network/people/*.md` | Contact info for outreach tasks |

### Outputs

| Output | Path | What It Contains |
|--------|------|------------------|
| All files above | (various) | Updated by orchestrated skills |
| Visibility table | Console | Execution summary |
| Handoff (updated) | `NEXT_SESSION_HANDOFF.md` | What was accomplished, what's pending |

---

## MULTI-AGENT SAFETY (P15)

Cruise Control is the heaviest writer in the system — it orchestrates skills
that touch every shared file. Safety rules:

1. Each skill invocation re-reads its target files before writing
2. If multiple agents may be active, check `NEXT_SESSION_HANDOFF.md` for
   recent activity notes — if another agent logged overlapping scope work,
   ask for permission first
3. After completion, it updates the handoff doc with everything it did
4. Commits are atomic per logical unit of work (not one giant commit at the end)

---

## SHORTHAND ALIASES

| Shorthand | Canonical |
|---|---|
| cc | Cruise Control |
| go | Execute (activate Cruise Control) |
| mc | Mission Control (different skill) |

---

## Cover Letter Policy (WO-044, REQ-002)

APPLY work items generate a **resume only** by default. Cover letters are
NEVER auto-generated as part of an APPLY item — they are a separate, opt-in
deliverable (see `cover-letter/SKILL.md`). A cover letter is
produced only if the work item text explicitly says "cover letter", e.g.:

- `T-47: Apply to Harvey Director — include cover letter` → generate both
- `T-47: Apply to Harvey Director` → resume only

This is a P0 Token Cost constraint: unrequested Opus-generated cover letters
waste tokens on deliverables the user never asked for.

---

## Greenhouse Portal Verification Gate (WO-043, REQ-001)

When Cruise Control executes an APPLY-class work item for a company in the
Greenhouse list (see `apply-tracker/SKILL.md` for the authoritative list), add
a post-apply verification step to the work item completion checklist:

```
Post-apply verification:
  - [ ] Greenhouse portal shows application received
```

If Cruise Control is running autonomously and cannot verify (no human present),
surface the verification as a `blocked: human` task so the user can confirm
later without blocking the rest of the queue:

```bash
gh issue create --repo $CAREER_GITHUB_REPO \
  --title "Verify {Company} application on Greenhouse" \
  --label "tier:p3,cadence:operational,repo:career-os-data,kind:verify,blocked_on:human" \
  --body "$(cat <<EOF
- **Severity:** Medium | **Value:** {role comp estimate}
- **Status:** blocked | **Blocked:** human (verify at my.greenhouse.io/applications/)
- **Done when:** User confirms portal shows application received
EOF
)"
```

Non-Greenhouse companies skip this gate entirely — the APPLY item completes
on the normal success criteria.

---

## MIGRATION NOTE

This skill replaces the Cruise Control section in `brain/config/KERNEL.md`.
The Kernel now contains only shorthand aliases and a pointer to this skill.
All execution logic lives here.
