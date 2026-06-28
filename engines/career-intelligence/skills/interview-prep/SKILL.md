---
name: interview-prep
description: >
  Maps your stories to interview rounds based on JD requirements.
  Generates per-round talking points, mock questions with scoring,
  and coaching notes based on personality profile. Say "prep me for
  [Company]" to generate a prep doc, or "mock interview for [Company]"
  to practice with feedback.
triggers:
  - prep me for
  - ip
  - interview prep
  - mock interview
  - practice for
  - get ready for
---

# Interview Prep — Career OS Skill

## Purpose

Prepares you for interviews by matching your stories to the role's requirements, generating prep documents with talking points, and running mock practice sessions with structured feedback.

## Output Format

Always start with:
```
━━━ Career OS: Interview Prep ━━━
```

## How to Invoke

- `prep me for [Company]` — generate a prep document
- `mock interview for [Company]` — practice with scored feedback
- `interview prep` — show what preps are available

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Target company/role | User request or pipeline entry | Which interview to prepare for |
| Stories | `brain/stories/*.md` | Career stories with competency frontmatter |
| Story Index | `brain/stories/STORY_INDEX.md` | Competency clusters for fast matching |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Stage, contacts, next steps for target |
| JD | `brain/reference/jd-samples/{company}*.pdf` | Role requirements, competencies sought |
| Personality | `brain/config/personality.md` (optional) | RHETI type for coaching calibration |
| Skills matrix | `brain/identity/skills-matrix.md` | Technology proficiency for technical rounds |
| JD Alignment Framework | `brain/projects/jd-alignment-framework.md` | Track definitions and requirements — used for story-to-track mapping and round preparation |

### Brain API (brain-kernel >= 1.0.0)

All writes go through `brain.write()`. `interview-prep/` maps to the engine's
`projects/**` owned namespace. Mock debriefs land in `stories/**`.

### Outputs

| Output | brain.write() path | When Created |
|--------|-------------------|-------------|
| Prep document | `career-intelligence/projects/interview-prep/prep-{company}.md` | Every prep session |
| Mock debrief | `career-intelligence/stories/mock-{company}-{date}.md` | After mock session |

### Legacy Read Tolerance

Canonical write path: `career-intelligence/projects/interview-prep/prep-{company}.md`.

The skill may encounter files that pre-date this convention or were
written outside the skill (user-initiated notes, legacy installs). On
read:

- Accept any `*.md` file in `brain/interview-prep/` for the
  requested company — match by filename substring (lowercased).
- Prefer `prep-*.md` when multiple matches exist; fall back to any
  `.md` match if no canonical file is present.
- Ignore files in `_archive/` unless explicitly asked ("show archived
  prep for X").
- `intel-*.md` files are insider-intel notes (role context, interviewer
  background) — read alongside prep docs when available; do not
  generate `intel-*.md` files from prep sessions (that's a separate
  input class).

Do NOT silently rewrite legacy filenames on read. Filename migration
is handled by plugin migrations (`migrations/vN-to-vN+1.sh`), not by
the skill at runtime. This keeps the skill's write path canonical and
the migration the single source of truth for filename shape changes.

---

## BEHAVIOR: Prep Mode (`prep me for [Company]`)

### Step 1: Gather Context
1. Read pipeline entry for the company — get role, stage, interviewer names, dates
2. Read stored JD from `brain/reference/jd-samples/` — extract key requirements grouped by category (technical, leadership, domain, culture)
3. Read STORY_INDEX.md — match competency clusters to JD categories
4. Read matched story files for metrics and talking points

### Step 2: Generate Prep Doc

Write via `brain.write("career-intelligence/projects/interview-prep/prep-{company}.md", ...)`:

```markdown
# Interview Prep — {Company} ({Role})
**Stage:** {current stage from pipeline}
**Interviewer:** {name if known}
**Date:** {if known from pipeline}
**Generated:** {today's date}

## Role Summary

{2-3 sentences: what they're looking for, mapped to your profile}

### Strengths (direct matches)
- {requirement} → {your evidence with metric}

### Gaps (no direct story)
- {requirement} → Suggested angle: {framing advice}

## Story Map

| JD Requirement | Your Story | Key Talking Points |
|---|---|---|
| {requirement 1} | {story title} | • {metric/outcome} • {action taken} • {scale/scope} |
| {requirement 2} | {story title} | • {metric/outcome} • {action taken} |
| {requirement 3} | ⚠️ No matching story | Angle: {suggested framing using adjacent experience} |

## Round-by-Round Guide

### Behavioral Round
- Lead with: {strongest story for this company}
- Watch for: {common behavioral questions for this role level}
- Your edge: {what makes your background unique for this role}

### Technical/System Design Round
- Technologies to highlight: {from skills-matrix, matched to JD}
- Architecture story: {best system design story}
- Gaps to prepare for: {technologies in JD not in your matrix}

### Leadership Round
- Team scale story: {largest team managed, with metrics}
- Cross-functional story: {best cross-org collaboration}
- Failure/recovery story: {shows resilience and learning}

## Questions to Ask

Tailored to role level, company stage, and interviewer background:
- {question} — *Why: {what this reveals about the role/company}*
- {question} — *Why: {shows you've done research}*
- {question} — *Why: {evaluates culture fit for YOU}*

## Coaching Notes

{Generated from personality profile if available, otherwise from observed patterns}
- {tip based on RHETI type or common patterns for this user}
- {interviewer-specific adjustment if interviewer background known}
```

### Step 3: Present Summary

After writing the prep doc, present a condensed version in conversation:
```
━━━ Career OS: Interview Prep ━━━

Prep doc ready for {Company} — {Role}

STORY MAP: {N} requirements matched, {N} gaps identified
STRONGEST MATCH: {story} → {requirement}
BIGGEST GAP: {requirement} — suggested angle: {1-line framing}

Full prep: career-intelligence/projects/interview-prep/prep-{company}.md

Want to run a mock round? Say "mock interview for {Company}"
```

---

## BEHAVIOR: Mock Mode (`mock interview for [Company]`)

### Step 1: Setup
1. Load prep doc (generate via Prep Mode if missing)
2. Ask: "Which round? behavioral / technical / system design / leadership"

### Step 2: Conduct Mock
3. Ask questions one at a time — wait for user's full answer before proceeding
4. Questions should be realistic for the role level and company
5. Draw from JD requirements and gap analysis in prep doc

### Step 3: Score Each Answer

After each answer, provide structured feedback:

```
━━━ Feedback ━━━

STAR Structure:  ✅ Situation  ✅ Task  ✅ Action  ⚠️ Result (add the metric)
Specificity:     🟡 — "improved performance" → say "reduced p99 latency from 800ms to 120ms"
Relevance:       ✅ — directly answers the question
Conciseness:     ✅ — good length for a 2-minute answer

💡 You mentioned the outcome but not the scale — add the 40% metric
   and the team size (12 engineers across 3 teams).

Ready for the next question? (q to stop)
```

Scoring dimensions:
- **STAR structure** — did they hit Situation, Task, Action, Result?
- **Specificity** — concrete metrics, names, numbers vs vague claims
- **Relevance** — does the answer actually address what was asked?
- **Conciseness** — under ~2 minutes of speaking time?

### Step 4: Debrief
After 3-5 questions (or when user says `q`/`done`):

```
━━━ Mock Debrief ━━━

Questions: {N} asked
Average score: {rating}
Strongest answer: {question topic} — {why it worked}
Needs work: {question topic} — {specific improvement}

Debrief saved to brain/stories/mock-{company}-{date}.md
```

Write debrief via `brain.write("career-intelligence/stories/mock-{company}-{date}.md", ...)` with frontmatter:
```yaml
---
type: mock-interview
company: {company}
date: {date}
round: {round type}
questions_asked: {N}
---
```

---

## BEHAVIOR: No Stories Available

If `brain/stories/` is empty or has no STORY_INDEX.md:

```
━━━ Career OS: Interview Prep ━━━

You don't have stories indexed yet. Stories power interview prep —
they're how I match your experience to what the company is looking for.

Say "organize" to index your career stories first, then come back.
```

---

## BEHAVIOR: No JD Available

If no JD in `brain/reference/jd-samples/` for this company:

- Generate prep based on pipeline entry + role title + typical requirements for that level
- Note in prep doc header:
  ```
  ⚠️ No JD available — prep based on role-level norms.
  Paste the JD for a targeted version: "here's the JD for {Company}"
  ```
- Mock questions will be more generic but still calibrated to role level

---

## BEHAVIOR: Re-run Prep

If a prep doc already exists for this company:
- Overwrite with fresh version (previous version in git history)
- Note: "Updated prep for {Company} — previous version in git history"

---

## Dependencies

- `organize` — stories need frontmatter for competency matching (required)
- Pipeline entry — helpful but not required (can work from JD alone)
- `job-search-scheduler` — provides stored JDs (helpful, not required)
