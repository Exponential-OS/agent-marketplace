---
name: application-qa
description: >
  Generates copy-pasteable answers for job application portal questions.
  Takes a role reference (#N or company name), fetches the JD, and produces
  answers grounded in your stories, identity, and skills matrix — each sourced
  to specific evidence. Say "answer questions for #68" or "answer Harvey Director"
  or "portal questions for Kadence". Also handles custom questions when you paste
  them.
triggers:
  - aq
  - answer questions for
  - answer questions
  - application questions
  - portal questions
  - app questions for
---

# Application QA — Career OS Skill

## Purpose

Application portals ask questions beyond the resume. "Why this company?",
"Describe a time you...", "What's your management style?" — these require
tailored answers grounded in YOUR specific stories and the specific JD.

This skill generates those answers so you can copy-paste them into any
application portal. Each answer is sourced to specific evidence files so
you can verify and edit before submitting.

## Output Format

Always start with:
```
━━━ Career OS: Application QA — {Company} {Role} ━━━
```

## How to Invoke

- `answer questions for #68` — generate standard answers for role #68
- `answer Harvey Director` — fuzzy resolve, then generate
- `answer questions for Kadence` — same flow
- `answer #68: "Why do you want to work here?"` — answer a specific question
- Paste custom questions and say `answer these for #68` — answer whatever the portal asks

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Role context | Resolved via `pipeline-query.py --lookup` | Company, role, score, JD URL, resume track |
| JD content | Fetched from JD URL (WebFetch) or cached in `career-intelligence/projects/job-search/scans/` | Requirements, responsibilities, company values |
| Identity | `brain/identity/identity.md` | Career narrative, values, motivation, "why" |
| Stories | `brain/stories/*.md` | Evidence for behavioral/situational answers |
| Skills matrix | `brain/identity/skills-matrix.md` | Technical proficiency evidence |
| Match scoring | `career-intelligence/projects/job-search/job-pipeline-match-tracker.json` | Category scores, gap analysis, match rationale |
| People | `network/people/*.md` | Warm contacts (for "how did you hear about us") |
| JD Alignment Framework | `brain/projects/jd-alignment-framework.md` | Track definitions and match evidence — used for grounding portal answers in alignment data |
| Resume Generation Guide | `brain/projects/resume-generation-guide.md` | Generation context — ensures portal answers are coherent with resume narrative |

### Outputs

| Output | What It Contains |
|--------|------------------|
| Console output | Formatted Q&A with copy-pasteable answers and source citations |

This skill does NOT write to files. It generates answers for the user to
copy-paste into application portals.

---

## BEHAVIOR: Generate Standard Answers

### Step 1: Resolve Role

Accept `#N` or fuzzy name. Resolve using:
```bash
python3 $CAREER_HOME/~/.career-os-state/scripts/pipeline-query.py --lookup "{input}" --format json
```

If ambiguous, present disambiguation (A/B/C scheme).

If the role context was already provided by apply-dashboard (pre-resolved),
skip the lookup.

### Step 2: Load Context

Read these files (lazy-load — only what's needed):

1. **JD content** — Try in order:
   a. Fetch from JD URL via WebFetch (if URL is available and valid)
   b. Read from scan cache: `career-intelligence/projects/job-search/scans/{batch-date}/` matching company/role
   c. Read from match tracker detailed scoring section for this role
   d. If none available, work from the role title + company research only

2. **Identity** — `brain/identity/identity.md` (always read)

3. **Stories index** — `brain/stories/STORY_INDEX.md` (read index,
   then selectively read 3-5 most relevant stories based on JD requirements)

4. **Match scoring** — Read the detailed scoring section for this role from
   the match tracker (provides category scores and gap analysis)

5. **People** — Check `network/people/` for contacts at this
   company (for "how did you hear about us" and referral mentions)

### Step 3: Generate Standard Q&A

Generate answers for these common portal questions. Skip any that don't
apply to this specific role/company:

**Q1: "Why do you want to work at [Company]?"**
- Sources: identity.md (career motivation) + company mission/values from JD + match rationale from scoring
- Approach: Lead with genuine alignment between your career arc and their mission. Reference specific company initiatives or products.
- Length: 150-200 words

**Q2: "Describe a relevant accomplishment"**
- Sources: Best-fit story from stories/ matched to the JD's primary emphasis
- Approach: Pick the story with highest relevance to the JD's top-weighted category. Use STAR format with concrete metrics.
- Story selection priority: Match story theme to JD emphasis (AI, scale, leadership, 0→1)
- Length: 200-300 words

**Q3: "What's your management/leadership style?"**
- Sources: identity.md + leadership stories
- Approach: Describe coaching philosophy and leadership approach. Ground in specific examples.
- Length: 150-200 words

**Q4: "Why are you leaving your current role?"**
- Sources: identity.md (career transition narrative)
- Approach: Frame positively — seeking the next challenge. Keep professional and forward-looking.
- Length: 100-150 words

**Q5: "How did you hear about this role?"**
- Sources: People files, scan reports, warm contacts
- Approach: If there's a warm contact → mention the referral. If not → mention your targeted search.
- Length: 1-2 sentences

**Q6: "What's your experience with [specific technology from JD]?"**
- Sources: skills-matrix.md + relevant stories
- Approach: Map the technology to your proficiency level. If proficient, cite projects. If learnable, frame adjacent experience.
- Length: 100-200 words (only generate if JD calls out specific tech)

### Step 4: Format Output

```
━━━ Career OS: Application QA — {Company} {Role} ━━━

Q1: Why do you want to work at {Company}?
━━━
[Answer text — 150-200 words]

Sources: identity.md, stories/{slug}.md, match-tracker #{N}

---

Q2: Describe a relevant accomplishment
━━━
[Answer text — STAR format, 200-300 words]

Sources: stories/{slug}.md

---

[...continue for each applicable question...]

━━━
→ Copy-paste these into the application portal
→ Edit to add personal touches before submitting
→ Say "applied to #{N}" when done to update your pipeline
```

---

## BEHAVIOR: Custom Questions

When the user pastes specific portal questions:

1. Resolve the role reference
2. Load context (same as standard flow)
3. For each custom question:
   - Identify the best-fit story/evidence
   - Generate a tailored answer
   - Cite sources
4. Output in the same format as standard Q&A

---

## GUARDRAILS

- **Never fabricate experience.** Every claim must trace to a story file,
  skills-matrix entry, or identity statement. If there's no evidence for
  something, frame it as a learning opportunity, not existing expertise.

- **Match the company's tone.** If the JD is formal, keep answers professional.
  If the JD is casual, match that energy while staying substantive.

- **Respect the gap analysis.** If the match tracker shows a gap in a
  category, don't oversell that area. Acknowledge adjacent experience and
  frame the learning path.

- **Length discipline.** Portal text fields often have character limits.
  Keep answers within the specified word counts. Concise and compelling
  beats long and generic.

---

## Scope Boundary (WO-044)

This skill answers portal application questions (text fields). It does
**NOT** generate cover letters — that is `cover-letter`'s job. If a portal
question field asks "paste your cover letter" or "why are you interested,"
redirect:

> "This field wants a cover letter. Say 'cover letter for {Company}' to
> generate one as DOCX + PDF."

Do not generate the cover letter inline in an answer field. Cover letters
are a separate deliverable with their own QA gates, file format, and opt-in
gate (see `cover-letter/SKILL.md`).

## INTERACTION WITH OTHER SKILLS

| Skill | Relationship |
|-------|-------------|
| apply-dashboard | Upstream — routes "answer questions for #N" here with pre-resolved context |
| job-match-scorer | Upstream — scoring rationale informs answer framing |
| cover-letter | Peer — owns cover-letter generation and QA gates |
| resume-engine | Peer — answers complement the resume (don't contradict resume framing) |
| apply-tracker | Downstream — "applied to #N" after submitting answers |
| story-capture | Upstream — stories are the evidence base for all answers |
