---
name: apply-dashboard
description: >
  Your apply-ready pipeline view with quick actions. Shows scored roles grouped
  by decision tier, supports filtering (by score, company, decision, status),
  and routes actions to the right skill. Say "dashboard" to see what to apply to,
  "dashboard skipped" for skipped roles with reasons, "dashboard Anthropic" for
  company-specific view. Accepts actions like "cover letter for #68",
  "applied to Kadence", "skip #72", "answer questions for Harvey Director".
triggers:
  - db
  - dashboard
  - apply dashboard
  - show pipeline
  - what should I apply to
  - show apply queue
  - show me jobs
  - show me what to apply to
---

# Apply Dashboard — Career OS Skill

## Purpose

The single entry point for your post-scoring apply workflow. After the job-match-scorer
runs, this skill renders the apply-ready pipeline and routes quick actions
to the right downstream skill — so you never need to remember which skill
handles what.

Think of it as a thin dispatcher: it owns the view (via `pipeline-query.py`)
and the routing (to apply-tracker, resume-engine, application-qa). It does
NOT contain business logic for resume generation, question answering, or
file updates.

## Output Format

Always start your response with:
```
━━━ Career OS: Apply Dashboard ━━━
```

## How to Invoke

### View Commands
- `dashboard` — full apply-ready pipeline (≥80%, non-terminal), grouped by tier
- `dashboard skipped` — only skipped roles with reasons (for auditing job-match-scorer decisions)
- `dashboard --min-score 70` — lower the threshold to include CHECK DELTA
- `dashboard Anthropic` — all Anthropic roles regardless of score
- `dashboard --batch latest` — only the most recent scoring batch
- `dashboard applied` — show what's been applied to (tracking)

### Action Commands (routed to downstream skills)
- `cover letter for #68` or `cover letter for Harvey Director` → resume-engine
- `resume for #75` or `resume for Kadence` → resume-engine
- `answer questions for #68` or `answer #68` → application-qa
- `applied to #75` or `applied to Kadence` → apply-tracker
- `skip #72` or `skip Canva` → apply-tracker

---

## DATA ARCHITECTURE

### Script Dependency

This skill depends on `pipeline-query.py` located at:
```
~/.career-os-state/scripts/pipeline-query.py
```

The script reads the match tracker and pipeline files and outputs filtered,
sorted results. The dashboard skill runs this script and renders its output.

### Files This Skill Reads (via script)

| File | Path | What It Provides |
|------|------|------------------|
| Match Tracker | `career-intelligence/projects/job-search/job-pipeline-match-tracker.json` | All scored roles across all batches |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | stage_data — Applied/Active cross-reference |

### Files This Skill Writes

None. This skill is read-only. All mutations are routed to downstream skills.

---

## BEHAVIOR: Render Dashboard

### Step 1: Determine Intent

Parse the user's command to extract:
- **View filters:** min-score, decision tier, company, batch, status
- **Action intent:** cover letter, resume, answer, applied, skip
- **Role reference:** `#N` number or fuzzy name string

If the command is purely a view (no action), proceed to Step 2.
If the command includes an action, proceed to Step 4.

### Step 2: Run Pipeline Query

Execute the script with the appropriate flags. Map user intent to CLI args:

| User Says | Script Args |
|-----------|-------------|
| `dashboard` | (defaults: --min-score 80, exclude terminal) |
| `dashboard skipped` | `--decision SKIP --min-score 0 --include-closed` |
| `dashboard --min-score 70` | `--min-score 70` |
| `dashboard Anthropic` | `--company Anthropic --min-score 0 --include-closed` |
| `dashboard --batch latest` | `--batch latest` |
| `dashboard applied` | `--status APPLIED --include-closed` |
| `dashboard all` | `--min-score 0 --include-closed` |

Run:
```bash
python3 ~/.career-os-state/scripts/pipeline-query.py [flags] \
  --tracker-path $CAREER_HOME/career-intelligence/projects/job-search/job-pipeline-match-tracker.json
```

### Step 3: Render Output

Present the script's grouped table output directly. Add a footer with
available actions:

```
━━━ Career OS: Apply Dashboard ━━━

[grouped table output from script]

━━━ Actions ━━━
→ "resume for #N"                         — customize resume (DOCX+PDF)
→ "cover letter for #N"                   — generate cover letter (DOCX+PDF, opt-in only)
→ "answer questions for #N"               — portal question answers
→ "applied to #N" or "skip #N"            — record outcome
→ "dashboard skipped" to audit skip decisions
→ "cruise control" to batch-apply queued roles (resume only; cover letters are opt-in per WO-044)
```

### Step 4: Resolve Role Reference and Route Action

When the user's command includes an action:

1. **Extract the reference:** Look for `#N` pattern or company/role name
2. **Resolve via script:**
   ```bash
   python3 pipeline-query.py --lookup "68" --format json
   ```
3. **If ambiguous (multiple matches):** Present disambiguation:
   ```
   Which Harvey role?
   A. #68 Engineering Director NY (88%)
   B. #85 Director Core Product (89% — already applied)
   C. #90 EM Product (86% — already applied)
   ```
   Wait for user to select before routing.

4. **Route to downstream skill** with full context pre-loaded:

| Action | Downstream Skill | Context Passed |
|--------|-----------------|----------------|
| `cover letter for #N` | resume-engine | Company, role, JD URL, resume track, score |
| `resume for #N` | resume-engine | Company, role, JD URL, resume track |
| `answer questions for #N` | application-qa | Company, role, JD URL, score, match rationale |
| `applied to #N` | apply-tracker | Company, role, date (today), score |
| `skip #N` | apply-tracker | Company, role, reason (if user provides one) |

When routing, provide the resolved context so the downstream skill does
NOT need to re-read files or re-resolve the role:

```
The user wants a cover letter for:
- Company: Harvey AI
- Role: Engineering Director (NY)
- Score: 88% (APPLY tier)
- Resume Track: Exec
- JD URL: https://jobs.ashbyhq.com/harvey/3d3aaf03-...
- Warm Path: Cold

Please generate a cover letter following the resume-engine workflow.
```

---

## SCORE QUALITY HANDLING

Roles with `⚠️ title-only` Score Quality are treated specially:

1. **Dashboard display:** Show with `⚠️` prefix and warning:
   ```
   ⚠️ #75 Kadence VP Eng — 89% (title-only — re-score before applying)
   ```

2. **Action suppression:** Do NOT route `cover letter for`, `resume for`,
   or `answer questions for` actions to title-only roles. Instead:
   ```
   ⚠️ #75 was scored from title only (no JD text). Re-score with full JD
   before generating application materials.
   → Say "verify queue" to fetch the JD, then "rescore #75"
   ```

3. **Status/skip still allowed:** `applied to #75` and `skip #75` are
   permitted even for title-only roles (user may have applied manually or
   wants to skip based on their own judgment).

4. **`🔄 partial` scores:** Displayed with note but actions are allowed:
   ```
   🔄 #68 Harvey AI Eng Director — 88% (partial JD — consider re-scoring)
   ```

---

## EDGE CASES

- **Script not found:** If `pipeline-query.py` doesn't exist at the expected
  path, fall back to manually reading the match tracker and filtering. This
  is token-expensive but functional. Suggest the user run the installer.

- **Empty results:** If no roles match the filter, say so and suggest
  relaxing the filter: "No roles found at ≥80%. Try `dashboard --min-score 70`
  to see borderline roles, or `dashboard skipped` to audit skip decisions."

- **Stale data:** The script reads files on every invocation — it's always
  current. If the user says "I just scored new roles" and they don't appear,
  check that the job-match-scorer wrote to the match tracker.

## Greenhouse Portal Indicator (WO-043, REQ-001)

When rendering a dashboard entry for a company in the Greenhouse list (see
`apply-tracker/SKILL.md` for the authoritative list) with status Applied or
later, append a `🌱` indicator and the portal verification link:

```
#68 Harvey AI Engineering Director — Applied 2026-04-01 🌱
    → Verify: my.greenhouse.io/applications/
```

The `🌱` emoji signals "Greenhouse-hosted — portal verification available."
For non-Greenhouse companies, omit the indicator and link. Pipeline entries
that already carry a `verified: greenhouse` metadata tag can additionally
show a `✓ verified` suffix after the indicator.

---

## INTERACTION WITH OTHER SKILLS

| Skill | Relationship |
|-------|-------------|
| job-match-scorer | Upstream — job-match-scorer writes data that dashboard reads |
| apply-tracker | Downstream — dashboard routes status updates here |
| resume-engine | Downstream — dashboard routes cover letter/resume requests here |
| application-qa | Downstream — dashboard routes portal question requests here |
| cruise-control | Peer — CC reads the same data for batch execution |
| pipeline-sync | Peer — sync validates the files that dashboard reads |
