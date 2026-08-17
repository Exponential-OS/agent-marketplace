---
name: resume-engine
description: >
  JD-specific resume customization with ATS optimization, multi-track support
  (Engineering Leader, Innovator, Executive), and automated QA gates. Writes
  to Resumes & Cover Letters/. Say "customize resume for [Company]".
triggers:
  - customize resume for
  - re
  - build resume
  - resume for
  - tailor resume for
  - list resume tracks
  - generate my base resume from experience history
---

# Resume Engine — Career Intelligence Skill

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

Generates and customizes resumes targeted at specific roles. Supports multiple resume tracks, optimizes for ATS keyword matching against stored JDs, and enforces QA gates before output.

## Output Format

Always start with:
```
━━━ Career Intelligence: Resume Engine ━━━
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
- `cover letter for [Company]` — handled by the standalone `cover-letter` skill
- `list resume tracks` — show available tracks and their targets

---

## ROLE RESOLUTION

Resume-engine accepts role references in three forms:

1. **Company name:** "resume for Harvey AI" — search pipeline/tracker by name
2. **`#N` reference:** "resume for #68" — look up by match tracker entry number
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

**Auto-resolved context** (when invoked via `resume for #68`):
- Resume track: Exec (from match tracker)
- JD URL: resolved from match tracker (auto-fetched)
- Score + rationale: for resume framing
- Warm path: available for downstream apply-flow context

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

Resumes are owned paths. All writes go through `brain.write()` with
`engine_id: "career-intelligence"`. Cover-letter artifacts are owned by the
standalone `cover-letter` skill.

### Outputs

| Output | brain.write() path | When Created |
|--------|-------------------|-------------|
| Customized resume | `career-intelligence/resumes/{company}-{track}-{date}.md` | Every customize |

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
| **Canonical claim verification (MECHANICAL — see below)** | Every biographical claim (tenure, role title, report count, scale-figure, percentage, date range) anchors in `$CAREER_HOME/brain/identity/experience-history.md`. This is NOT a self-attestation — you MUST run the precheck script against the FINAL rendered draft and read its exit code. | Hard fail (BLOCK) |
| **Page count** | IC roles: 1 page. Leadership: 2 pages max. | Hard fail |
| **Banned phrases** | No "responsible for", "helped with", "worked on", "assisted in", "was involved in" | Hard fail |
| **Quantification** | Prefer quantified bullets. But a TRUE unquantified bullet always beats an invented metric — NEVER synthesize a number, %, $, or scale figure to satisfy this gate. If a real metric isn't in experience-history.md or a story file, leave the bullet qualitative and tell the user "bullet X has no grounded metric — add one?" | Warn if >2 bullets lack metrics. Inventing a metric = canonical-claim BLOCK, not a warn. |
| **Contact info** | Name, email, LinkedIn, phone all present | Hard fail |
| **ATS keywords** | ≥70% of JD technical keywords appear in resume | Warn if <70%, fail if <50% |

#### Canonical-claim gate — run it mechanically, do not self-attest

The model cannot grade its own grounding — a self-attested "PASS — no fabrication" is worthless (it has been observed to print PASS over a draft that contained invented metrics). The exit code of the script is the gate, not your opinion.

After rendering the FINAL resume draft (Step 3, fully customized), before Step 5 output:

1. Write the rendered draft to a temp file, e.g. `/tmp/resume-draft.md`.
2. Run the precheck against it. Canonical sources are the candidate's own data — `experience-history.md`, `skills-matrix.md`, and every `brain/stories/*.md` file (résumé metrics legitimately come from all three: tenures/scale from experience-history, tool counts like "40+ services" from the skills matrix, project metrics from stories). **NEVER pass the JD as canonical** — the JD's numbers describe the *employer* (e.g. "50M events/sec"), not the candidate; passing the JD is exactly how employer figures bleed into the bio (the XOS-34 JD-bleed failure):
   ```bash
   PRECHECK="$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/biographical-claim-precheck/HOW.py 2>/dev/null | tail -1)"
   CANON_JSON="$(python3 -c "import json,glob,os; h=os.environ['CAREER_HOME']; b=h+'/brain'; print(json.dumps([b+'/identity/experience-history.md', b+'/identity/skills-matrix.md']+sorted(glob.glob(b+'/stories/*.md'))))")"
   python3 "$PRECHECK" "$(printf '{"draft_path":"/tmp/resume-draft.md","canonical_sources":%s,"stakes":"T4"}' "$CANON_JSON")"
   echo "exit=$?"
   ```
3. **Exit 0 = PASS** → continue to output. **Exit 1 = BLOCK** → the JSON lists each unanchored claim under `claims_unanchored`. Remove or correct every one (delete the invented figure, or replace with a grounded one), re-render, and re-run. Do NOT output until exit 0.
4. Report the gate result by quoting the script's verdict + claim counts — not a hand-written "looks good."

**Canonical-claim gate origin (2026-04-26):** Resume customization injects biographical content (roles, tenures, metrics) — exactly the failure surface that produced [Recipient] + [Connection] hallucinations in outreach drafts the same day. **Reinforced 2026-06-07 (XOS-34):** an eval found the quantification gate pressured the model into inventing metrics ("60% overhead reduction", "$1.1M savings", a 4→5 promotion inflation) and then self-attesting "PASS — no fabrication." The mechanical exit-code gate above exists because the self-attested version cannot be trusted. No skip-rule, including "fast-pass" customizations.

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

After the write succeeds, emit the local-only beta-funnel artifact signal. The
helper no-ops unless `XOS_98_TELEMETRY` is enabled:

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/telemetry/beta-funnel.ts" artifact-created \
  '{"artifact_type":"resume"}'
```

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

## BEHAVIOR: Cover Letter Requests (`cover letter for [Company]`)

Cover-letter generation is owned by the standalone `cover-letter` skill. This
resume-engine section exists only as a legacy/delegation path so older routing
does not regress.

If a cover-letter request reaches resume-engine:

1. Confirm the request explicitly asks for a cover letter. Never generate one
   from `customize resume for`, `resume for #N`, or batch apply work unless the
   work item text says "cover letter".
2. Resolve `#N`, company, or fuzzy role references using the same Role
   Resolution flow above when useful.
3. Invoke `skills/cover-letter/SKILL.md` with the resolved context:
   company, role, JD or JD URL/content, score/rationale, resume track, and
   warm path if present.
4. Set the cover-letter event context to `standalone: false`.
5. Do not draft, QA, format, or emit cover-letter files inside resume-engine.
   `skills/cover-letter/SKILL.md` is the single source of truth for cover
   letter generation, grounding, DOCX/PDF output, and local event emission.

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
