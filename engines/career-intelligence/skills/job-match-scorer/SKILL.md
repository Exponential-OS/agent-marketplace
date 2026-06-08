---
name: job-match-scorer
description: >
  Standalone job-match scoring skill. Takes roles from scan reports or manual input,
  evaluates them against your skills matrix, stories, and identity using the 6-category
  weighted decision engine, and writes scored results to job-pipeline-match-tracker.json.
  Separated from scanning because scoring requires deeper judgment (Opus-level).
  Triggers: "score these roles", "score jobs", "match score", "how well do I match",
  "rate this role", "score the latest scan", "run the decision engine".
triggers:
  - sc
  - score these roles
  - score jobs
  - match score
  - how well do I match
  - rate this role
  - score the latest scan
  - run the decision engine
  - rescore JD-fetched
  - rescore queue
  - rescore title-only
---

# Job Match Scorer — Career OS Skill

## Purpose

Evaluates job-candidate fit using a structured 6-category weighted scoring system.
This skill is deliberately separated from the job-search-scheduler because scanning
(finding roles) and scoring (evaluating fit) require different levels of judgment.
Scanning is fast, broad, and routine. Scoring is deep, opinionated, and benefits
from the strongest available model.

The job-match-scorer owns the Match Tracker file as its sole writer. Other skills read it;
only job-match-scorer writes to it.

## Output Format

Always start your response with:
```
━━━ Career OS: Job Match Scorer ━━━
```

## How to Invoke

- "score these roles" — score roles from the latest unscored scan
- "score the latest scan" — same as above
- "how well do I match [Company]" — score a single role
- "rate this role: [paste JD]" — score from pasted JD text
- "run the decision engine" — score all unscored roles in pipeline

---

## DATA ARCHITECTURE

### Brain API (brain-kernel >= 1.0.0)

All reads go through `brain.read()` / `brain.list()`. The match tracker is an
owned path (`career-intelligence/projects/job-search/job-pipeline-match-tracker.json`). Skills matrix at
`identity/skills-matrix.md` is an xOS primitive — read via `brain.read()`.

### Inputs (what the skill reads)

| Source | brain.read() path | What It Provides |
|--------|------------------|------------------|
| Scan reports | `brain.list("career-intelligence/projects/scans/{YYYY-MM-DD}/")` | Roles to score (title, company, URL, requirements) |
| Skills matrix | `brain.read("identity/skills-matrix.md")` | Technology proficiency levels, recency, learnability |
| Stories | `brain.list("career-intelligence/stories/")` | Evidence for domain, leadership, ambiguity categories |
| Identity | `brain.read("identity/identity.md")` | Values and philosophy for culture fit |
| Pipeline | `brain.read("career-intelligence/projects/job-search/job-pipeline.json")` | Already-applied roles (avoid re-scoring) |
| Match Tracker | `brain.read("career-intelligence/projects/job-search/job-pipeline-match-tracker.json")` | Previously scored roles (avoid duplicates, continue numbering) |
| People | `brain.list("network/people/")` | Warm contacts at target companies (bonus signal) |
| JD Alignment Framework | `brain.read("career-intelligence/projects/jd-alignment-framework.md")` | Track definitions, JD requirements tables, match evidence |

### Outputs (what the skill writes)

| Output | brain.write() path | What It Contains |
|--------|-------------------|------------------|
| Match Tracker (appended) | `career-intelligence/projects/job-search/job-pipeline-match-tracker.json` | New scored rows appended to JSON array |
| Console output | — | Formatted scoring summary with recommendations |

**Write call pattern:**
```
brain.write("career-intelligence/projects/job-search/job-pipeline-match-tracker.json", content, {
  provenance: { who: "career-intelligence", why: "roles scored", source: "job-match-scorer" },
  engine_id: "career-intelligence"
})
```

---

## SCORING METHODOLOGY

### The 6-Category Weighted Decision Engine

Each role is scored across 6 categories. Weights are calibrated for EM/Director-level roles:

| Category | Weight | Scoring Source | What It Measures |
|----------|--------|---------------|-----------------|
| Technical Skills | 25% | `skills-matrix.md` — match each requirement to proficiency + recency | Can you do the technical work? |
| Domain Expertise | 20% | Story archive + resume evidence | Have you done this kind of work before? |
| Leadership & Scaling | 20% | Stories (team size, scope, outcomes) | Can you lead at the required scale? |
| Ambiguity & Cross-Functional | 15% | Stories (pivots, cross-org, stakeholder mgmt) | Can you navigate organizational complexity? |
| Data & Infrastructure | 10% | Skills matrix (BI tools, pipelines, cloud) | Do you have the technical infrastructure depth? |
| Culture & Values Fit | 10% | `identity.md` + company research | Will you thrive in this environment? |

### Learnability Factor

Technology scores are adjusted by learnability — not everything needs to be
known today:

| Tier | Time to Proficiency | Minimum Score | Example |
|------|---------------------|---------------|---------|
| Already proficient | 0 | Score at evidence level | Python, Kubernetes |
| Refreshable (deep history) | 1-3 days | ≥80% | Terraform (used 2 years ago) |
| Learnable (adjacent + AI tools) | 1-2 weeks | ≥70% | New framework in known language |
| Structural (requires domain depth) | 3+ months | Actual evidence level | ML research, compiler design |

**CRITICAL:** Never guess technology proficiency. Always check `skills-matrix.md`.
If a technology isn't listed, classify its learnability tier and score accordingly.

### Known Structural Gaps

Auto-filter when these appear as PRIMARY requirements in a JD. These cannot be
closed by framing or short-term learning — they require specific domain history:

| Gap | Signal Phrases | Discovered |
|-----|---------------|------------|
| API-as-revenue-product | "API platform P&L", "developer revenue", "API monetization" | Session 11 |
| Diffusion/generative model training | "train diffusion models", "LLM pretraining", "ML training infra" | Session 11 |
| Technical GTM / SE leadership | "leading technical GTM teams", "scaling solutions engineering" | 2026-03-29 |
| Identity / Auth systems | "identity management", "authentication systems", "OAuth", "SSO", "IAM" | 2026-03-29 |

If a JD lists a structural gap as PRIMARY (weighted heavily or listed first):
score that dimension ≤40%. It will likely not clear 80%.

### Warm Path Bonus

If a contact exists in `network/people/` at the target company:
- Active referral: +3% to overall score
- Confirmed connection: +2%
- Resume sent / loose connection: +1%

Note the warm path in the scoring output but keep the bonus modest — it
shouldn't push a poor-fit role into apply territory.

### Decision Thresholds

| Score Range | Action | What Happens Next |
|---|---|---|
| **≥90%** | FULL INVESTMENT | Resume + cover letter + warm intro search + company research |
| **80-89%** | APPLY | Targeted resume + cover letter |
| **60-79%** | CHECK DELTA | Can framing add 10-15%? If post-customization ≥80%, apply. Otherwise skip. |
| **<60%** | AUTO-SKIP | Log reason, don't add to pipeline |

### Resume Track Selection

| JD Emphasis | Recommended Track |
|---|---|
| Platform, scaling, operational rigor | Engineering Leader |
| VP/C-level, business strategy, P&L | Executive |
| 0→1, product innovation, AI architecture | Innovator |

---

## BEHAVIOR: Score a Batch (from scan)

### Step 1: Find Unscored Roles

- Read the latest scan report(s) from `career-intelligence/projects/job-search/scans/`
- Read the Match Tracker to find the last entry number
- Identify roles in scans that don't appear in the Match Tracker

### Step 2: Score Each Role

For each unscored role:
1. Extract requirements from the JD/scan entry
2. Categorize each requirement into one of the 6 categories
3. Score each category against the skill sources
4. Apply learnability adjustments
5. Check for warm paths
6. Calculate weighted total
7. Determine action threshold

### Step 3: Write to Match Tracker

Append new JSON objects to `job-pipeline-match-tracker.json` (flat array — JSON is
the only format, no MD batch sections). Read the file first to get the current max
`id`; new rows continue numbering from max_id + 1.

**JSON object schema (one per scored role):**

```json
{
  "id": 243,
  "batch_date": "2026-05-05",
  "batch_context": "May 5 scan",
  "company": "Acme AI",
  "role": "Engineering Director",
  "score": 87,
  "score_quality": "JD",
  "decision": "APPLY",
  "resume_track": "Exec",
  "warm_path": "Cold",
  "jd_url": "https://jobs.ashbyhq.com/acme/abc123",
  "status": "QUEUED",
  "updated_at": "2026-05-05"
}
```

**Field spec:**

| Field | Type | Enum / Format |
|-------|------|---------------|
| `id` | integer | Globally unique, continues from max existing id |
| `batch_date` | string | `YYYY-MM-DD` |
| `batch_context` | string | Free text (e.g. "May 5 scan") |
| `company` | string | Plain name, no markdown |
| `role` | string | JD title as-is |
| `score` | integer or null | 0-100; null if unscored |
| `score_quality` | string or null | `"JD"` \| `"partial"` \| `"title-only"` |
| `decision` | string | `"FULL_INVEST"` \| `"APPLY"` \| `"CHECK_DELTA"` \| `"SKIP"` |
| `resume_track` | string or null | `"Exec"` \| `"Eng Leader"` \| `"Innovator"` \| null |
| `warm_path` | string or null | Contact name or `"Cold"` |
| `jd_url` | string or null | Full HTTPS URL; null if expired/missing |
| `status` | string | `"QUEUED"` \| `"CHECK_DELTA"` \| `"SKIPPED"` \| `"APPLIED"` \| `"INTERVIEWING"` \| `"REJECTED"` \| `"DEAD"` \| `"OFFERED"` |
| `updated_at` | string | `YYYY-MM-DD` |

**Score Quality values:**

| Quality | Meaning | Decision Cap |
|---------|---------|-------------|
| `✅ JD` | Scored from full JD text (reliable) | No cap — full decision range |
| `🔄 partial` | Scored from LinkedIn snippet/summary (moderate) | Max: `✅ APPLY` |
| `⚠️ title-only` | Scored from title + company context only (unreliable) | Max: `⏳ CHECK DELTA` |

**CRITICAL:** The job-match-scorer MUST NOT produce `⭐ FULL INVEST` or `✅ APPLY`
decisions for `⚠️ title-only` scores. Title-only scores are capped at
`⏳ CHECK DELTA` regardless of the computed score percentage. This prevents
false positives from incomplete data (e.g., Kadence VP Eng 89% scored from
title only turned out to be a filled role).

**Status values on write:**

| Score Range | Status Written |
|-------------|---------------|
| ≥80% | `QUEUED` |
| 60-79% (CHECK DELTA) | `CHECK DELTA` |
| <60% | `⏭️ SKIPPED` |

**JD URL source:** Read from scan report `URL` column. If no URL, write `—`.

**Warm Path source:** Check `network/people/*.md` for contacts at target company. If found, include contact name. If not, `Cold` + optional LinkedIn alumni count.

After the summary table, write detailed scoring per role (category breakdowns,
rationale, gap analysis). The detailed sections are narrative — only the
summary table is standardized.

**Skip table format (required):**

```markdown
### Skipped (Below 80% Threshold)

| Company | Role | Score | Reason |
|---------|------|-------|--------|
| {Company} | {Role} | {score}% | {one sentence: structural gap or domain mismatch} |
```

The `Reason` column is REQUIRED. One sentence explaining the structural gap
or domain mismatch. This enables `pipeline-query.py --decision SKIP` to
show useful output.

Continue numbering from where the previous batch left off.

### Step 4: Present Summary

```
━━━ Scoring Complete: {Date} Batch ━━━

Scored: {N} roles
  ≥90% (Full Investment): {N}
  80-89% (Apply): {N}
  60-79% (Check Delta): {N}
  <60% (Skip): {N}

Top matches:
  1. {Company} — {Role}: {score}% ({action})
  2. {Company} — {Role}: {score}% ({action})

→ Say "dashboard" to see the apply queue
→ Say "cover letter for #{N}" to start applying
→ Say "sync pipeline" to propagate scores to pipeline and tasks
```

---

## BEHAVIOR: Score a Single Role

When the user asks "how well do I match [Company]" or pastes a JD:

1. Score the single role using the full methodology
2. Show the detailed category breakdown (not just the total)
3. Highlight the strongest and weakest categories
4. If score ≥ 60%: show what framing adjustments could improve it
5. Write the score to the Match Tracker (single-row append)

---

## BEHAVIOR: Re-Score

When the user asks to re-score a previously scored role (e.g., after updating
skills matrix or stories):

1. Find the existing entry in Match Tracker
2. Re-run the scoring with current data
3. Show before/after comparison
4. Update the entry in-place (don't create a duplicate)

---

## BEHAVIOR: Rescore Queue (JD-Fetched Batch Rescore)

When the user says "rescore JD-fetched", "rescore queue", or "rescore title-only":

### Step 1: Find Rescore Candidates
- Read Match Tracker for all rows where Quality is `⚠️ title-only`
- For each, check if a JD is now available:
  - JD file exists in `brain/reference/jd-samples/` matching company+role
  - OR JD URL in the match tracker row is now fetchable
- Split into two lists: **rescoreable** (JD available) and **still-blocked** (no JD)

If no title-only rows exist: "No title-only scores found. All roles have full scoring."
If title-only rows exist but none have JDs: "Found {N} title-only roles but no JDs available yet. Run 'verify queue' to fetch JDs first."

### Step 2: Batch Rescore
For each rescoreable role:
1. Fetch/read the JD text
2. Run full 6-category scoring with the JD
3. Update Quality from `⚠️ title-only` to `✅ JD`
4. Update the match tracker row in-place (score, decision, quality)

### Step 3: Show Results
Present a before/after comparison table:

```
━━━ Rescore Queue Results ━━━

Rescored {N} roles (JD now available):

| # | Company | Role | Before | After | Decision Change |
|---|---------|------|--------|-------|-----------------|
| 75 | Kadence | VP Eng | 89% (title-only, capped CHECK DELTA) | 72% (✅ JD, PASS) | ⬇️ Decision changed |
| 82 | Acme | Staff Eng | 68% (title-only, CHECK DELTA) | 85% (✅ JD, APPLY) | ⬆️ Decision changed |

⚠️ Still title-only ({M} roles, no JD available):
  - #90 FooCorp Senior Eng — say "verify queue" to fetch JD
```

Flag any role where the decision crossed a threshold (e.g., CHECK DELTA → APPLY or CHECK DELTA → PASS) — these need user attention.

---

## SELF-EVOLVING THRESHOLDS (P14)

The decision thresholds (80% apply, 60% check delta) are subject to self-evolution
per EXP-001 (defined in the Job Match Decision Engine spec).

### What the Job Match Scorer Tracks

For every scored role that reaches a known outcome, record it in the Match Tracker's
Outcome column:
- Applied → Screened? → Interviewed? → Offered? → Rejected at which stage?

### Calibration Logic

When ≥5 outcomes are known (rolling 30-day window):

| Screen Rate | Diagnosis | Action |
|---|---|---|
| > 50% | Thresholds calibrated | No change |
| 30-50% | Too permissive | Tighten apply threshold by 5% |
| < 30% | Too restrictive OR resume quality issue | Loosen by 5%, but require human approval before second consecutive loosening |

### Safeguards

- Max adjustment: ±5% per cycle
- Floor: 65% (never apply below this regardless)
- Ceiling: 95% (never require near-perfection)
- Second consecutive loosening requires human approval
- Manual override resets baseline
- Rollback if screen rate drops below 15% for 2 cycles after adjustment

### Current State

First calibration: ~April 5 (when pending applications have outcomes). Until then,
observation only — collect outcome data without adjusting thresholds.

---

## MULTI-AGENT SAFETY (P15)

The Match Tracker is a shared read file but the job-match-scorer is its sole writer.
Before appending:
1. `brain.read("career-intelligence/projects/job-search/job-pipeline-match-tracker.json")` — kernel pull ensures latest
2. Append only — never rewrite existing batch sections
3. If another agent somehow wrote to the tracker, re-read and continue
   numbering from the actual last entry
