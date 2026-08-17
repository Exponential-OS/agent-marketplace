---
name: cover-letter
description: >
  First-class cover-letter generation for any application, tracked or
  untracked. Generates uploadable DOCX and PDF cover letters from explicit
  company, role, JD, and grounded candidate identity. Say "write a cover
  letter for [Company]", "cover letter for [Company]", or "cover letter".
triggers:
  - write a cover letter for
  - write cover letter for
  - cover letter for
  - cover letter
---

# Cover Letter — Career Intelligence Skill

## Purpose

Generate a targeted cover letter as a standalone deliverable. This skill works
for any application: tracked pipeline rows, dashboard-resolved roles, or a
one-off role where the user provides company, role, and JD text.

Cover letters are opt-in only. Never generate one as a side effect of resume
customization, dashboard rendering, application QA, or cruise-control apply
work unless the work item explicitly asks for a cover letter.

## Output Format

Always start with:
```
━━━ Career Intelligence: Cover Letter ━━━
```

## How to Invoke

- `cover letter for [Company]` — direct standalone request
- `write a cover letter for [Company]` — direct standalone request
- `cover letter for #68` — tracked role reference, resolved via pipeline if available
- `cover letter` — ask for company, role, and JD if not already in context

## Inputs

Required for generation:

| Input | Source | Notes |
|-------|--------|-------|
| Company | User request, dashboard context, or pipeline lookup | Required |
| Role | Explicit user input, dashboard context, or pipeline lookup | Required |
| JD | Pasted JD, JD URL/content from pipeline, or explicit role brief | Required for a targeted letter; if missing, ask for it |
| Candidate identity | `$CAREER_HOME/brain/identity/experience-history.md` | Required grounding source |

Optional context:

| Input | Source | Notes |
|-------|--------|-------|
| Stories | `$CAREER_HOME/brain/stories/**/*.md` | Use only stories that match JD competencies |
| Skills matrix | `$CAREER_HOME/brain/identity/skills-matrix.md` | Ground technical skill claims |
| People files | `$CAREER_HOME/network/people/*.json` or `.md` | Required if naming a contact, referral, or relationship |
| Pipeline context | `career-intelligence/projects/job-search/*` or `pipeline-query.py` | Optional; never required for untracked applications |

## Context Pre-Flight

1. Require canonical identity:
   ```bash
   if [ ! -f "$CAREER_HOME/brain/identity/experience-history.md" ]; then
     echo "⛔ experience-history.md not found."
     echo "Run 'onboard me to career intelligence' first — cover letters make biographical claims and require canonical grounding."
     exit 1
   fi
   ```
2. Ensure company, role, and JD are present. If any are missing, ask only for
   the missing fields. Do not require a pipeline row.
3. If the request uses `#N` or a fuzzy tracked-role reference, resolve it with
   `pipeline-query.py` when available. If lookup fails, fall back to explicit
   user-provided company, role, and JD.
4. If a named person, referral, hiring manager, or warm path is mentioned, read
   the relevant people file before using that fact. If no people file or
   same-session user statement grounds it, do not include the named-person claim.

## Cover Letter Generation Protocol

This section is the single source of truth for cover-letter generation. Other
skills, including `resume-engine`, must delegate here instead of carrying their
own cover-letter recipe.

### Step 1: Grounding Read

Read the candidate sources before drafting:

- `$CAREER_HOME/brain/identity/experience-history.md`
- `$CAREER_HOME/brain/identity/skills-matrix.md` if present
- Relevant `$CAREER_HOME/brain/stories/**/*.md`
- Relevant `$CAREER_HOME/network/people/*.json` or `.md` only when the letter
  will mention a named contact, referral, prior conversation, or warm path

The JD is not a canonical source for candidate claims. JD numbers describe the
employer or role, not the candidate. Never turn a JD metric into a candidate
achievement.

### Step 2: Select Evidence

Select 2-3 grounded stories or experience facts that map to the JD's top
requirements. Prefer evidence with verified metrics, but never invent a
number, percent, dollar value, team size, tenure, title, date, or scale figure.
If the best evidence is qualitative, keep it qualitative.

### Step 3: Draft

Structure:

- **Hook:** Company-specific opening tied to the product, mission, JD problem,
  or verified company context. Avoid generic praise.
- **Match:** 2-3 short paragraphs mapping grounded experience to the top JD
  requirements. Each paragraph should follow claim -> evidence -> relevance.
- **Value:** The specific capability the candidate brings to this role.
- **Close:** A direct, specific closing. Do not use "I look forward to hearing
  from you."

Style:

- Keep it under 400 words.
- Use a confident, human voice.
- Avoid "I am writing to express my interest", "passionate about", "unique
  opportunity", and other generic filler.
- Mention the company at least 3 times, with context.
- Include at least 1 grounded metric when one exists in identity, skills, or
  stories. Do not fabricate a metric to satisfy this.

### Step 4: Mechanical Grounding Gate

Cover letters are T4 external artifacts and make biographical claims. Before
writing DOCX/PDF, render the final letter body to a temp markdown/text file and
run the biographical-claim precheck against candidate-owned canonical sources.

```bash
PRECHECK="$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/biographical-claim-precheck/HOW.py 2>/dev/null | tail -1)"
CANON_JSON="$(python3 -c "import json,glob,os; h=os.environ['CAREER_HOME']; b=h+'/brain'; print(json.dumps([b+'/identity/experience-history.md', b+'/identity/skills-matrix.md']+sorted(glob.glob(b+'/stories/**/*.md', recursive=True))))")"
python3 "$PRECHECK" "$(printf '{"draft_path":"/tmp/cover-letter-draft.md","canonical_sources":%s,"stakes":"T4"}' "$CANON_JSON")"
echo "exit=$?"
```

Exit 0 is required. If the gate blocks, read `claims_unanchored[]`, remove or
correct every ungrounded claim, and re-run. Do not self-attest grounding and do
not ship until the script exits 0.

Named-person claims require their own grounding read: if the letter names a
contact or referral, the people file or the user's same-session statement must
support the relationship. If not, omit the name.

### Step 5: QA Gates

| Gate | Check |
|------|-------|
| Length | < 400 words |
| Generic filler | No "I am writing to express my interest", "passionate about", or "unique opportunity" |
| Company specificity | Company name mentioned >=3 times with specific context |
| Grounded metrics | At least 1 metric from identity, skills, or stories when available |
| Biographical grounding | Mechanical precheck exits 0 |
| Named-person grounding | People-file or same-session evidence exists for named referrals/relationships |
| Tone | Confident, specific, and not AI-generic |

### Step 6: Output DOCX + PDF

Write uploadable files to the existing `Resumes & Cover Letters/` location,
matching resume-engine's user-facing convention. When using brain-kernel, the
canonical write paths are:

```
career-intelligence/cover-letters/{company}-cover-{date}.docx
career-intelligence/cover-letters/{company}-cover-{date}.pdf
```

User-facing paths:

```
Resumes & Cover Letters/{company}-cover-{date}.docx
Resumes & Cover Letters/{company}-cover-{date}.pdf
```

DOCX generation:

1. Use `Resumes & Cover Letters/templates/cover-letter-template.docx`.
2. If missing, create a minimal professional template on first use: single
   column, 1" margins, contact-info header, no footer.
3. Populate recipient (hiring manager if grounded, else "Hiring Team"), date,
   company, role, and body paragraphs.
4. Use the same DOCX toolchain as resume artifacts: XML-surgery if available,
   otherwise `python-docx`.

PDF generation:

```bash
libreoffice --headless --convert-to pdf --outdir "{output_dir}" "{output_dir}/{company}-cover-{date}.docx"
```

If LibreOffice is not installed, keep the DOCX and print:

```
PDF conversion requires LibreOffice. Install with 'brew install --cask libreoffice' then re-run.
```

No markdown fallback. Markdown cover letters are not uploadable ATS artifacts.

### Step 7: Local Event

After successful DOCX generation, emit a local-only event using the bundled
helper. The helper no-ops unless `XOS_98_TELEMETRY` is enabled.

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/cover-letter/events.ts" "$(jq -nc \
  --arg company "{Company}" \
  --arg role "{Role}" \
  --argjson standalone true \
  '{standalone:$standalone,company:$company,role:$role}')"
```

Use `standalone: true` for direct standalone cover-letter requests. Use
`standalone: false` when invoked through resume-engine, apply-dashboard, or
another pre-resolved apply flow. The event is local JSONL only; no PostHog and
no network calls.

Then record the beta-funnel artifact signal. This is also local-only and
gated off by default:

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/telemetry/beta-funnel.ts" artifact-created \
  '{"artifact_type":"cover_letter"}'
```

## Summary Output

```
━━━ Career Intelligence: Cover Letter ━━━

Cover letter for {Company} — {Role}

Stories used: {story1}, {story2}
Company hooks: {specific references}
Grounding: experience-history.md + {stories/people files used}
QA: All gates passed

Files:
  DOCX (edit): Resumes & Cover Letters/{company}-cover-{date}.docx
  PDF (final): Resumes & Cover Letters/{company}-cover-{date}.pdf

Next: review the DOCX, make edits, then re-export PDF if changed.
```

## Anti-Patterns

- Do not require the role to be in the pipeline.
- Do not generate a cover letter unless explicitly requested.
- Do not duplicate this protocol in another skill.
- Do not use the JD as candidate biography evidence.
- Do not mention a referral, hiring manager relationship, or named contact
  unless grounded in a people file or same-session user statement.
- Do not output `.md` as the deliverable.

## Dependencies

- `resume-engine` — delegates cover-letter requests here after any legacy
  role resolution.
- `apply-dashboard` — routes `cover letter for #N` here with pre-resolved context.
- `application-qa` — redirects cover-letter fields here instead of answering inline.
- `biographical-claim-precheck` — mandatory grounding gate before output.
