# Career Intelligence Engine

Your career co-pilot with persistent memory. Job search, resume customization, network outreach, and interview prep — all in one place, all remembering your background automatically.

Built as a Claude Code plugin. Your data stays in your own workspace, versioned by git.

---

## Install

```
claude plugin install career-intelligence@xos
```

---

## First-Time Setup (10 minutes)

### Step 1 — Set your workspace

Run this in your terminal before opening Claude Code:

```bash
export CAREER_HOME="$HOME/career-os"
mkdir -p "$CAREER_HOME"
echo 'export CAREER_HOME="$HOME/career-os"' >> ~/.zshrc
```

This tells the plugin where to store your data. Every session reads and writes here.

> **Why CAREER_HOME?** The plugin is multi-user — it reads `$CAREER_HOME` at runtime so your files never mix with anyone else's. Default is `~/career-os` but you can use any path you own.

### Step 2 — Run the onboarding wizard

In Claude Code, say:

```
onboard me to career intelligence
```

The wizard asks 8 short questions about your work history and job search preferences. It takes about 10 minutes. When it finishes, you'll have two files that every other skill loads automatically:

- `brain/identity/experience-history.md` — your canonical background
- `brain/projects/job-search/job-search-config.md` — your targeting criteria

You explain your background once. Every future session — resumes, outreach, interview prep — reads these files automatically.

### Step 3 — Open Mission Control

```
mission control
```

Your home screen. Shows today's priorities, pipeline status, and what to do next. If onboarding isn't complete, it tells you exactly what's missing and routes you to the right wizard.

---

## What If I Skip a Setup Step?

Every skill has a pre-flight check. If you try to use `resume-engine` without onboarding:

```
⛔ experience-history.md not found.
Run 'onboard me to career intelligence' first.
```

Skills fail loudly and tell you the fix. You won't silently get bad output.

---

## Skills

### Job Search

| Say | What happens |
|---|---|
| `scan for jobs` | Full LinkedIn + ATS scan. Finds roles matching your config, scores them, detects warm paths. |
| `enrich warm paths` | Re-scans existing results to find 1st/2nd-degree contacts. |
| `score these roles` | Scores a scan result against your targeting config. |
| `apply dashboard` | Shows your apply-ready queue: scored, not yet applied. |
| `pipeline` | Active pipeline: interviews, referrals, stage detail. |
| `I applied to [Company]` | Records an application. |
| `got rejected from [Company]` | Updates pipeline stage. |

**Config lives at** `brain/config/job-search.md`. Edit to tune target roles, companies, salary range, and non-negotiables. The scheduler reads this before every scan.

**Daily auto-scan** (no manual trigger needed):

Say: `set up a daily job scan at 6am` — Claude Code creates a scheduled task.

---

### Resume & Cover Letter

| Say | What happens |
|---|---|
| `customize resume for [Company]` | Tailors your resume to the JD. Injects keywords, reorders bullets by relevance. |
| `cover letter for [Company]` | Targeted cover letter. Never auto-generated — must be explicitly requested. |
| `list resume tracks` | Shows available tracks with target role types. |
| `generate my base resume from experience history` | Drafts an initial resume from your onboarding data if you have no existing file. |

**Resume tracks** come from filenames in `Resumes & Cover Letters/`. Name them to reflect the role type:
- `resume-engineering-leader.md` → Engineering Leader track
- `resume-exec.md` → Executive track  
- `resume-ic.md` → IC track

The engine auto-detects tracks and selects the best one for each JD.

**QA gates** run before every output:
- Page count (1 page IC / 2 pages leadership)
- No banned phrases ("responsible for", "helped with")
- ≥70% JD keyword coverage
- Biographical claim verification against your experience history

---

### Outreach

| Say | What happens |
|---|---|
| `write outreach for [Contact] to [Company]` | Forwardable referral email in your champion's voice. |
| `linkedin message to [Contact]` | LinkedIn DM with proof-of-work hook. Character-limited. |
| `follow up with [Contact]` | Time-calibrated follow-up based on last contact date. |
| `thank you note for [Contact]` | Post-interaction note with specific conversation callback. |

**Contact profiles** live at `brain/network/people/`. If a contact has no profile yet, the composer asks 3 questions and creates one before drafting.

**Dedup gate** runs before every draft: if you've reached out to this contact recently, it blocks the draft and shows the prior outreach date.

---

### Stories (your evidence library)

Stories are what makes your resumes and outreach specific and credible. The resume engine and outreach composer both search your story library for the strongest evidence to inject.

| Say | What happens |
|---|---|
| `save this story` | Captures a win, project, or experience. |
| `capture this achievement` | Same. |

**Stories live at** `brain/stories/`. Each story has competency tags and metrics. When the resume engine customizes a bullet or the outreach composer picks proof points, it matches stories to the JD's requirements.

**To get value fast**: after onboarding, spend 20 minutes capturing your top 5–10 career wins. The more stories you have, the more specific and compelling every resume and outreach draft becomes.

---

### Interview Prep

| Say | What happens |
|---|---|
| `prep me for [Company]` | Company research, role analysis, likely question set. |
| `mock interview for [Company]` | Interactive mock with feedback. |
| `research [Interviewer Name]` | Builds a dossier from LinkedIn + public sources. |

---

### Network Intelligence

| Say | What happens |
|---|---|
| `who do I know at [Company]` | Scans your contacts for warm paths. |
| `warm intros for [Company]` | Shows relationship strength and suggested ask. |

---

## Common Workflows

### Week 1 (new user)
1. `onboard me to career intelligence`
2. `mission control`
3. `scan for jobs`
4. `score these roles`
5. `apply dashboard`

### Resume customization
1. Add your current resume to `Resumes & Cover Letters/` (name it by track type)
2. `customize resume for [Company]`
3. Review QA results
4. `cover letter for [Company]` — only when needed

### Outreach
1. `who do I know at [Company]`
2. `write outreach for [Contact] to [Company]`
3. Review the draft (dedup + claim checks ran automatically)
4. Send manually, then: `I sent the message to [Contact]`

---

## Directory Structure

After onboarding, `$CAREER_HOME` looks like this:

```
$CAREER_HOME/
├── brain/
│   ├── identity/
│   │   └── experience-history.md     ← canonical background (onboarding creates)
│   ├── network/
│   │   └── people/                   ← one file per contact
│   ├── projects/
│   │   └── job-search/
│   │       ├── job-pipeline.json
│   │       ├── job-search-config.md  ← targeting criteria
│   │       └── scans/                ← scan results by date
│   ├── stories/                      ← career story library
│   ├── sessions/
│   │   └── ledger/                   ← daily session logs
│   └── config/
│       └── job-search.md             ← job search settings
├── Resumes & Cover Letters/          ← resume tracks + generated outputs
└── INPUT/                            ← drop JDs and prep materials here
```

---

## Troubleshooting

**"⛔ experience-history.md not found"**
→ Run `onboard me to career intelligence`

**"⛔ [gate script] not found"**
→ Run `claude plugin update career-intelligence@xos --scope user`

**Scan returns no results**
→ Check `brain/config/job-search.md` exists. If not: `set up my job search config`. Then re-scan.

**Resume engine asks "which track?" every time**
→ Name your resume files with the track type: `resume-engineering-leader.md` not `my-resume.md`

**Outreach blocked by dedup gate**
→ A message was already sent recently. Check `brain/network/people/[name].json` for `last_contact` date.

---

## Privacy

Your data never leaves your machine (except to your own GitHub repo if you connect one). No backend, no telemetry, no phone-home. Session logs, pipeline data, and contact files all live in `$CAREER_HOME`.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
