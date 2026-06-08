---
name: resume-engine
description: >
  JD-specific resume customization with ATS optimization, multi-track support
  (Engineering Leader, Innovator, Executive), cover letter generation, and
  automated QA gates. Writes to Resumes & Cover Letters/. Say "customize
  resume for [Company]" or "cover letter for [Company]".
triggers:
  - customize resume for
  - re
  - build resume
  - resume for
  - tailor resume for
  - cover letter for
  - write cover letter
  - list resume tracks
  - generate my base resume from experience history
---

# Resume Engine — Career OS Skill

## FIRST-TIME SETUP (new users)

**Step 1 — Complete career-intelligence-onboarding first.**
Say "onboard me to career intelligence". This creates `brain/identity/experience-history.md` which the QA gate reads to verify biographical claims. Without it, the canonical-claim gate will BLOCK every resume generated.

**Step 2 — Add your existing resume.**
Create `Resumes & Cover Letters/` in your `$CAREER_HOME`. Paste your current resume as a markdown or text file. Name it to reflect the role type: `resume-engineering-leader.md`, `resume-exec.md`, `resume-ic.md`. The engine detects track names from filenames.

If you have no existing resume file: say "generate my base resume from experience history". The engine will draft a starting resume from `brain/identity/experience-history.md` — you review and edit it before using it for applications.

**Step 3 — Optionally define your tracks.**
Your tracks are inferred from `Resumes & Cover Letters/` filenames by default. To explicitly define tracks with their target signals, add a `Resume Tracks` section to `brain/config/job-search.md` after running "set up my job search config". This is optional but improves track auto-selection for ambiguous JDs.

**What customizes per your situation:**
- Tracks come from YOUR files in `Resumes & Cover Letters/` — not from any other user's files
- Stories come from `brain/stories/*.md` — populated from your onboarding + over time as you capture wins
- Skills matrix comes from `brain/identity/skills-matrix.md` — created during onboarding from your skills answers

---

## Purpose

Generates and customizes resumes targeted at specific roles. Supports multiple resume tracks, optimizes for ATS keyword matching against stored JDs, generates cover letters, and enforces QA gates before output.

## Output Format

Always start with:
```
━━━ Career OS: Resume Engine ━━━
```

## Context Pre-Flight (MANDATORY FIRST CHECK)

Before any resume operation, verify:

```bash
if [ ! -f "$CAREER_HOME/brain/identity/experience-history.md" ]; then
  echo "⛔ experience-history.md not found."
  echo "Run 'onboard me to career intelligence' first — this creates your canonical biography."
  echo "The resume engine needs it to verify every biographical claim before output."
  exit 1
fi
TRACKS=$(ls "$CAREER_HOME/Resumes & Cover Letters/"*.md 2>/dev/null | wc -l)
if [ "$TRACKS" -eq 0 ]; then
  echo "⚠️  No resume files found in 'Resumes & Cover Letters/'."
  echo "Add your existing resume there, or say 'generate my base resume from experience history'."
fi
```

If `experience-history.md` missing → STOP, print error, do not generate. No experience file = no canonical claim verification = ungrounded resume.

If `Resumes & Cover Letters/` is empty → WARN (proceed to generate base resume from experience-history.md if user confirms).

## How to Invoke

- `customize resume for [Company]` — tailor a resume for a specific role
- `resume for #68` — by match tracker number (auto-resolves track + JD)
- `resume for Harvey Director` — fuzzy name resolution
- `generate my base resume from experience history` — draft initial resume from onboarding data
- `cover letter for [Company]` — generate a targeted cover letter
- `list resume tracks` — show available tracks and their targets

---

## ROLE RESOLUTION

Resume-engine accepts role references in three forms:

1. **Company name:** "cover letter for Harvey AI" — search pipeline/tracker by name
2. **`#N` reference:** "cover letter for #68" — look up by match tracker entry number
3. **Fuzzy name:** "resume for Harvey Director" — fuzzy match on company + role

### Resolution Flow

When the user provides `#N` or a fuzzy name:

1. Run `pipeline-query.py --lookup "{input}" --format json` from `~/.career-os-state/scripts/`
2. Parse the JSON output to get: company, role, score, resume track, JD URL
3. If ambiguous (multiple matches), present disambiguation (A/B/C scheme)
4. **Auto-select resume track** from the match tracker scoring — no need for
   the user to specify "Eng Leader" vs "Exec" (the job-match-scorer already decided)
5. **Auto-fetch JD** from the resolved JD URL (or scan cache) — no need for
   the user to paste or specify

When routed from apply-dashboard with pre-loaded context, skip the resolution
step and use the provided context directly.

**Auto-resolved context** (when invoked via `cover letter for #68`):
- Resume track: Exec (from match tracker)
- JD URL: resolved from match tracker (auto-fetched)
- Score + rationale: for cover letter framing
- Warm path: affects cover letter tone (referral mention vs cold)

This eliminates the back-and-forth where the engine asks "which track?"
or "can you paste the JD?"

**Fallback:** If `pipeline-query.py` is not available, fall back to the
existing behavior (accept company name, ask for track selection).

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Target company/role | User request, `#N` reference, or pipeline | Which role to customize for |
| JD | `brain/reference/jd-samples/{company}*.pdf` or auto-fetched from JD URL | Keywords, requirements for ATS matching |
| Resume tracks | `Resumes & Cover Letters/` | Source templates per track |
| Stories | `brain/stories/*.md` | Evidence to inject (metrics, projects) |
| Skills matrix | `brain/identity/skills-matrix.md` | Technology proficiency for keyword injection |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Role context, stage |
| JD Alignment Framework | `brain/projects/jd-alignment-framework.md` | Track definitions and emphasis areas — used for track selection when customizing resume |
| Resume Generation Guide | `brain/projects/resume-generation-guide.md` | 12 build rules, 4-track map, generation procedures — this IS the build protocol |

### Brain API (brain-kernel >= 1.0.0)

Resumes and cover letters are owned paths. All writes go through `brain.write()`
with `engine_id: "career-intelligence"`.

### Outputs

| Output | brain.write() path | When Created |
|--------|-------------------|-------------|
| Customized resume | `career-intelligence/resumes/{company}-{track}-{date}.md` | Every customize |
| Cover letter (DOCX) | `career-intelligence/cover-letters/{company}-cover-{date}.docx` | Every cover letter (editable source) |
| Cover letter (PDF) | `career-intelligence/cover-letters/{company}-cover-{date}.pdf` | Every cover letter (final for upload) |

---

## BEHAVIOR: Customize Mode (`customize resume for [Company]`)

### Step 1: Select Track

Read all resume tracks from `Resumes & Cover Letters/`. Select best-fit based on JD emphasis:

| JD Emphasis | Track | Signals |
|---|---|---|
| Platform, scaling, operational rigor | Engineering Leader | "reliable systems", "team growth", "SLAs", "incident response" |
| VP/C-level, business strategy, P&L | Executive | "revenue", "board", "strategy", "P&L", "business outcomes" |
| 0→1, product innovation, AI architecture | Innovator | "greenfield", "prototype", "research", "novel", "architecture" |

If uncertain, ask: "This JD emphasizes both scaling and innovation. Which track: Engineering Leader or Innovator?"

### Step 2: Keyword Match Matrix

Generate a mapping: JD requirements → existing resume evidence

```
━━━ Keyword Analysis ━━━

JD Keywords Found in Resume: 14/20 (70%)
Missing Keywords: Kubernetes, RAG pipelines, prompt engineering,
                  stakeholder management, hiring pipeline, OKRs

Injecting from your stories + skills matrix...
```

### Step 3: Customize

- Inject relevant metrics and stories from `brain/stories/`
- Reorder bullet points by relevance to this JD (highest-match bullets first)
- Add JD-specific keywords naturally from skills-matrix (not keyword stuffing)
- Match technology terms to proficiency levels from skills-matrix
- Ensure standard labels on every bullet (per Artifact Quality Rules)

### Step 4: QA Gates

ALL must pass before output. If any fail, report failures and suggest fixes — do NOT output the resume.

| Gate | Check | Threshold |
|------|-------|-----------|
| **Canonical claim verification** | Every biographical claim (tenure, role title, report count, scale-figure, date range) anchors in `$CAREER_HOME/brain/identity/experience-history.md`. Run `python3 "$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/biographical-claim-precheck/HOW.py 2>/dev/null | tail -1)"` against the in-progress draft; verdict must be PASS before any other gate fires. | Hard fail (BLOCK) |
| **Page count** | IC roles: 1 page. Leadership: 2 pages max. | Hard fail |
| **Banned phrases** | No "responsible for", "helped with", "worked on", "assisted in", "was involved in" | Hard fail |
| **Quantification** | Every bullet has a metric, scope indicator, or measurable outcome | Warn if >2 bullets lack metrics |
| **Contact info** | Name, email, LinkedIn, phone all present | Hard fail |
| **ATS keywords** | ≥70% of JD technical keywords appear in resume | Warn if <70%, fail if <50% |

**Canonical-claim gate origin (2026-04-26):** Resume customization injects biographical content (roles, tenures, metrics) — exactly the failure surface that produced [Recipient] + [Connection] hallucinations in outreach drafts the same day. The `biographical-claim-precheck` rule (Constitution rule directory) is the mechanical gate. No skip-rule, including "fast-pass" customizations.

QA output:
```
━━━ QA Results ━━━

✅ Page count: 2 pages (leadership role)
✅ Banned phrases: none found
⚠️ Quantification: 2 bullets missing metrics (Impact section, bullets 3 & 7)
✅ Contact info: all present
✅ ATS keywords: 85% coverage (17/20)

Fix the 2 quantification warnings? I can suggest metrics from your stories.
```

### Step 5: Output

Write via `brain.write("career-intelligence/resumes/{company}-{track}-{date}.md", ...)` with engine_id "career-intelligence"

Present summary:
```
━━━ Resume Ready ━━━

Track: Engineering Leader
Target: {Company} — {Role}
Changes: 4 bullets customized, 3 keywords added, Impact section reordered
ATS score: 85% keyword match
QA: All gates passed ✅

File: Resumes & Cover Letters/{company}-engineering-leader-{date}.md
```

---

## BEHAVIOR: Cover Letter (`cover letter for [Company]`)

### Opt-In Gate (WO-044, REQ-002)

**Cover letters are NEVER generated unless the user explicitly asks.** They
are a separate deliverable with different intent — some roles don't need one,
some portals don't accept one, and some users prefer to write their own.

**Explicit triggers (generate cover letter):**
- `cover letter for [Company]`
- `cover letter for #N`
- `write cover letter for [Company]`

**NOT triggers (do NOT generate a cover letter):**
- `customize resume for [Company]` — resume only
- `resume for #N` — resume only
- `apply-dashboard` routing `resume for #N` — resume only
- `cruise-control` batch processing — resume only unless the work item text
  explicitly says "cover letter"

### Step 1: Gather Context
1. Read JD + pipeline entry
2. Select 2-3 most relevant stories (by competency match to JD)

### Step 2: Generate

Structure:
- **Hook:** Company-specific opening — reference their product, recent news, mission, or a specific problem they're solving. Never generic.
- **Match:** 2-3 paragraphs mapping your experience to their top 3 requirements. Each paragraph: claim → evidence (story with metric) → relevance to them.
- **Value:** What you uniquely bring — not "passionate about AI" but a specific capability they can't easily find elsewhere.
- **Close:** Specific next step tied to their process. Never "I look forward to hearing from you."

### Step 3: QA Gates

| Gate | Check |
|------|-------|
| Length | < 400 words |
| Generic filler | No "I am writing to express my interest", "passionate about", "unique opportunity" |
| Company specificity | Company name mentioned ≥3 times with specific context |
| Metrics | At least 1 metric from user's stories |
| Tone | Confident but not arrogant. Human voice, not AI voice. |

### Step 4: Output (DOCX + PDF, WO-044)

Portals (Greenhouse, Ashby, Lever, Workday) require uploadable document
formats. Markdown cover letters cannot be uploaded anywhere. Output both
formats using the same toolchain as resumes:

1. **Generate DOCX** using the cover letter template at
   `Resumes & Cover Letters/templates/cover-letter-template.docx`.
   - If the template does not exist, create a minimal professional template
     on first use: single-column, standard 1" margins, contact info header,
     no footer. Commit the template so future generations reuse it.
   - Populate: recipient (hiring manager if known, else "Hiring Team"),
     date, company, role, and the body paragraphs from Step 2.
   - DOCX generation approach: use the same XML-surgery pattern (unzip,
     edit `word/document.xml`, rezip) that the resume customization flow
     uses, OR use `python-docx` if no template-surgery path exists yet.
     Either way, match the user's resume track visual style (font family,
     margins, header format) for brand consistency.

2. **Generate PDF** via LibreOffice headless conversion:
   ```bash
   libreoffice --headless --convert-to pdf --outdir "{output_dir}" "{output_dir}/{company}-cover-{date}.docx"
   ```
   Where `{output_dir}` is the absolute path to `$CAREER_HOME/career-intelligence/cover-letters/`.
   The `--outdir` flag ensures the PDF lands in a known location regardless of the current working
   directory, so `brain.write()` can reliably read from `{output_dir}/{company}-cover-{date}.pdf`.

3. **Output paths (via brain.write()):**
   ```
   career-intelligence/cover-letters/{company}-cover-{date}.docx  (editable)
   career-intelligence/cover-letters/{company}-cover-{date}.pdf   (final)
   ```

4. **Summary output:**
   ```
   ━━━ Career OS: Resume Engine ━━━

   Cover letter for {Company} {Role}:

   Stories used: {story1}, {story2}
   Company hooks: {specific references}
   QA: All gates passed ✅

   Files:
     DOCX (edit): Resumes & Cover Letters/{company}-cover-{date}.docx
     PDF (final): Resumes & Cover Letters/{company}-cover-{date}.pdf

   Next: review the DOCX, make edits, then re-export PDF if changed.
   ```

5. **LibreOffice not installed:** DOCX still generates; PDF conversion
   fails with an actionable message:
   `"PDF conversion requires LibreOffice. Install with 'brew install --cask libreoffice' then re-run."`

6. **No markdown fallback.** The `.md` cover letter output path is removed
   entirely (P2 Minimize Code — markdown cover letters can't be uploaded
   to any ATS, so the code path eliminates a class of unusable output).

---

## Anti-Pattern: Auto-Generated Cover Letters (WO-044)

- NEVER generate a cover letter as part of the resume flow
- NEVER offer "want a cover letter too?" after resume generation
- Cover letters are a separate, user-initiated action
- If a portal requires a cover letter, the user will ask for one
- This rule is a P0 Token Cost constraint: unrequested generation wastes
  Opus tokens on deliverables the user didn't ask for

---

## BEHAVIOR: Track Management

### `list resume tracks`

```
━━━ Resume Tracks ━━━

1. Engineering Leader — platform scaling, team growth, operational excellence
   Last modified: {date}
   Best for: EM, Director of Eng, VP Eng roles

2. Innovator — 0→1 products, AI architecture, research-to-production
   Last modified: {date}
   Best for: Applied AI Lead, Staff+ IC, founding engineer roles

3. Executive — business strategy, P&L, board communication
   Last modified: {date}
   Best for: VP, C-level, GM roles
```

### `create resume track`

Guided creation: ask for track name, target role type, key themes, then generate template from user's stories and existing tracks.

---

## BEHAVIOR: No JD Available

If no stored JD for this company:
- Customize from role title + pipeline context + skills-matrix
- Note in output:
  ```
  ⚠️ No JD available — customized from role-level norms.
  For ATS optimization, paste the JD: "here's the JD for {Company}"
  ```

---

## BEHAVIOR: No Matching Track

If none of the existing tracks match the JD emphasis:
```
None of your current tracks are ideal for this role.
Your tracks: Engineering Leader, Executive, Innovator

This role emphasizes {X} — closest is {track} but it's not great.
Options:
1. Customize the closest track anyway
2. Create a new track for this role type

Which approach?
```

---

## Dependencies

- `organize` — stories with frontmatter for evidence matching (recommended)
- JD stored in `brain/reference/jd-samples/` (helpful, not required)
- Existing resume tracks in `Resumes & Cover Letters/` (at least 1 required)
- `job-search-scheduler` — decision engine recommends which track to use
