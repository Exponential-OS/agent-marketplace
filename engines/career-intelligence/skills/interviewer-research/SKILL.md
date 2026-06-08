---
name: interviewer-research
description: >
  Auto-fires when apply-tracker advances a role to "Panel Scheduled" or
  "Screen → Interview". Spawns parallel research sub-agents per interviewer,
  producing a per-interviewer dossier (background + likely questions +
  user stories to prepare + watch-outs). Output to
  INPUT/{company-slug}-{date}-prep-dossier.md. Read-only on brain layer;
  writes to INPUT/.
triggers:
  - interviewer research for
  - research interviewers
  - dossier for
  - prep dossier
  - interview dossier for
---

# Interviewer Research — Career OS Skill

## Purpose

Auto-fires when **apply-tracker** advances a role to `Panel Scheduled` or
`Screen → Interview`. Spawns one parallel research sub-agent **per
interviewer**, producing a single aggregated dossier (background + likely
questions + user stories to prepare + watch-outs) so the user walks into
the interview with a researched briefing instead of doing 30+ minutes of
manual lookup per panel.

This skill is the **research substrate** behind the per-round prep GitHub
Issues (`kind:prep`) opened by apply-tracker. Per-round talking-points
generation is owned by the existing `interview-prep` skill; this skill
produces the upstream interviewer research that prep consumes.

## Output Format

Always start with:
```
━━━ Career OS: Interviewer Research ━━━
```

## How to Invoke

- **Auto-trigger** (primary path): apply-tracker invokes on
  `Screen → Interview` or `Applied → Panel Scheduled` transitions, passing
  `{company, role, interviewers, date, jd_path?}`.
- **Manual** (testing / re-run): `dossier for [Company]` or
  `research interviewers for [Company]` — looks up the role from pipeline
  + the most recent interview entry, then proceeds.

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Trigger payload | apply-tracker stage transition | `{company, role, interviewers: [{name, role, linkedin?}], date, jd_path?}` |
| JD | `brain/reference/jd-samples/{company}*.pdf` (if `jd_path` not provided) | Role requirements, competencies sought |
| Identity | `~/<workspace>/brain/identity/identity.md` | User's positioning, current arc |
| Experience | `~/<workspace>/brain/identity/experience-history.md` | Canonical role-by-role history (used for resume-claim mapping) |
| Story Index | `~/<workspace>/brain/stories/STORY_INDEX.md` | Competency clusters → story mapping |
| Stories | `~/<workspace>/brain/stories/*.md` | STAR-structured narratives with metrics |
| People | `~/<workspace>/network/people/*.md` (optional) | If interviewer is already in the network — prior context, warm-path notes |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Stage / role context for the company |

### Outputs

| Output | Path | When Created |
|--------|------|-------------|
| Aggregated dossier | `INPUT/{company-slug}-{YYYY-MM-DD}-prep-dossier.md` | Every dossier run (one per panel) |
| GitHub Issue | `kind:prep` linked to the dossier | One per dossier run |

`INPUT/` is workspace-level (`~/<workspace>/INPUT/`). Slug rule:
lowercase-kebab-case of company; date = panel date if known, otherwise
today's date in `YYYY-MM-DD`.

### Tools / MCP

- **Playwright MCP** (`mcp__playwright-ms__browser_*`) + Claude's built-in `WebSearch` / `WebFetch` — primary research substrate. Free, fast, low-token. Use `WebSearch` for broad lookups ("VC partner background"), `WebFetch` for specific URLs (blog posts, company sites), and Playwright for JS-rendered pages.
- **LinkedIn MCP** (`mcp__linkedin-community__get_person_profile`) — when a LinkedIn URL is known or fuzzy-resolvable, fetch structured profile data (current role, prior roles, education).
- **Perplexity MCP** (`mcp__perplexity__perplexity_research`) — OPTIONAL. If installed (Anand-private setup), prefer it for VC partners / public CTOs with substantial public footprints. Most customers should skip — Playwright + WebSearch covers the same ground at zero cost.
- **gh CLI** — opens the `kind:prep` GitHub Issue at
  `$CAREER_GITHUB_REPO` linking the dossier.

---

## MECHANISM (the parallelization win)

### Step 1: Resolve trigger payload

If invoked from apply-tracker, the payload is structured:
```json
{
  "company": "[Company]",
  "role": "[Role]",
  "interviewers": [
    {"name": "[Interviewer A]", "role": "Partner", "linkedin": "https://linkedin.com/in/..."},
    {"name": "[Interviewer B]", "role": "CTO", "linkedin": null}
  ],
  "date": "[YYYY-MM-DD]",
  "jd_path": "brain/reference/jd-samples/[company-role].pdf"
}
```

If invoked manually with just a company name, look up the role from
`job-pipeline.json` Active section and parse interviewer names from the
panel entry.

### Step 2: Read static brain context (once, shared across sub-agents)

Load these once into the orchestrator's context so each sub-agent prompt
can include the relevant user-context without re-reading:

1. JD (if `jd_path` provided or resolvable)
2. `~/<workspace>/brain/identity/identity.md` — current positioning
3. `~/<workspace>/brain/identity/experience-history.md` — canonical experience claims
4. `~/<workspace>/brain/stories/STORY_INDEX.md` — competency clusters

### Step 3: SPAWN PARALLEL SUB-AGENT PER INTERVIEWER (the win)

For N interviewers, spawn N parallel sub-agents. Each sub-agent is given:
- The interviewer's `{name, role, company, linkedin?}`
- The JD (if available)
- The pre-loaded user context (identity + experience + STORY_INDEX summary)
- A scoped task: research THIS interviewer, infer THEIR likely questions,
  map 2-3 user stories, surface watch-outs

**Each sub-agent's mechanism:**

a. **Live web research via Perplexity MCP:**
   - For VC / partners: portfolio bets, thesis areas, recent talks,
     investment cadence, public theses.
   - For CTO / Eng leaders: technical stack, prior systems, public talks,
     papers, GitHub activity, conference appearances.
   - For founders / CEOs: company thesis, public interviews, recent
     fundraising posture, hiring philosophy.
   - For ICs / engineers: technical specialty, public projects, blog
     posts, recent roles.

b. **LinkedIn structured pull** (if URL known): current role, prior
   roles, education — confirms or corrects Perplexity findings.

c. **Story-to-question mapping:**
   - For each likely question this interviewer would ask, scan
     `STORY_INDEX.md` competency clusters and pick the 2-3 stories that
     map most directly. Prefer stories with quantified metrics.

d. **Watch-outs:**
   - Sensitive topics (e.g., prior-employer departure context, level
     framing — see canonical `experience-history.md`).
   - Things to avoid (e.g., overclaiming domain depth if interviewer is
     a deep-domain expert; staying high-level on architecture if
     interviewer is a hands-on coder).
   - Prior session lessons relevant to this interviewer type (read from
     `feedback/` if applicable).

### Step 4: Aggregate sub-agent outputs

Each sub-agent returns a structured section. The orchestrator concatenates
them into a single markdown file at:
```
INPUT/{company-slug}-{date}-prep-dossier.md
```

### Step 5: Open `kind:prep` GitHub Issue

```bash
gh issue create --repo $CAREER_GITHUB_REPO \
  --title "Prep dossier — [Company] [Role] panel on [Date]" \
  --label "tier:p1,cadence:operational,repo:career-os-data,kind:prep" \
  --body "$(cat <<EOF
- **Severity:** Critical | **Value:** [comp from pipeline if available]
- **Status:** ready-to-review | **Blocked:** none
- **Done when:** Dossier reviewed + per-round prep generated
- **Due:** [panel_date - 1 day]
- **Dossier:** INPUT/[company-slug]-[date]-prep-dossier.md
- **Next:** Say "prep me for [Company]" to generate per-round talking points
EOF
)"
```

### Step 6: Confirm to user

```
━━━ Dossier ready: [Company] — [Role] panel on [Date] ━━━

✅ Researched [N] interviewers in parallel
✅ Output: INPUT/[company-slug]-[date]-prep-dossier.md
✅ GitHub Issue opened: #[issue_num] (kind:prep)

Interviewers covered:
  • [Name 1] — [Role]
  • [Name 2] — [Role]
  ...

→ Say "prep me for [Company]" to generate per-round talking points
→ Open dossier: open INPUT/[company-slug]-[date]-prep-dossier.md
```

---

## OUTPUT SCHEMA

The dossier file has this exact structure:

```markdown
# Interviewer Research — [Company] ([Role])

**Panel date:** [YYYY-MM-DD]
**Generated:** [YYYY-MM-DD HH:MM PT]
**JD:** [jd_path or "not provided"]
**Generated by:** career-os interviewer-research skill v0.27.0

---

## Panel Overview

- **Company:** [Company]
- **Role:** [Role]
- **Stage:** [Pipeline stage — Panel / Screen / Onsite / Final]
- **Interviewers:** [N]

---

## [Interviewer Name 1] — [Role], [Company]

### Background
- LinkedIn: [URL or "not found"]
- Education: [bullets from public profile]
- Prior roles: [bullets]
- [If VC/Partner:] Portfolio bets / thesis areas: [bullets]
- [If CTO/Eng leader:] Technical stack / prior systems / public talks/papers: [bullets]
- Recent public activity: [recent talks, posts, papers — 0-3 bullets]

### Likely Questions They'll Ask
- [3-5 inferred from this interviewer's role + user's resume + the JD]

### User Stories To Prepare
- **[Story slug 1]** — maps to [Question N]; key metric: [metric]
- **[Story slug 2]** — maps to [Question N]; key metric: [metric]
- **[Story slug 3]** — maps to [Question N]; key metric: [metric]

### Watch-Outs
- [known blind-spots, sensitive topics from prior session lessons, things to avoid]

---

## [Interviewer Name 2] — [Role], [Company]

[same template repeated]

---

## Cross-Cutting Themes

(Synthesized AFTER all per-interviewer sections — questions or topics
that appear across multiple interviewers, plus the 3-5 stories that
cover the most ground.)

- **Likely hot topics:** [list]
- **High-leverage stories** (cover ≥2 interviewers): [list]
- **Highest-priority watch-outs:** [list]

---

## Sources

(Per-interviewer citation list from Perplexity research — URL, title, date.)
```

---

## ANTI-PATTERNS

- ❌ **Single agent doing all interviewers serially** — defeats the
  parallelization win. The whole point of this skill is N parallel
  research tasks. If you find yourself running interviewer #2's research
  AFTER interviewer #1 completes, you're doing it wrong.
- ❌ **Inventing facts about interviewers without live web research** —
  hallucinating LinkedIn URLs, fabricating talk titles, inferring
  "probably went to Stanford" from name — Ground Zero EMERGENT SYSTEM
  IMMUNITY violation (T4 stakes — outreach-adjacent artifact). Every
  factual claim must trace to a Perplexity source citation.
- ❌ **Generic prep advice** — "they'll probably ask about leadership."
  Output must be SPECIFIC to this interviewer + this role. If a section
  could be written without knowing the interviewer's name, the section
  is too generic.
- ❌ **Skipping the watch-outs section** — it's the highest-leverage
  section. Sensitive topics and things-to-avoid prevent T4 outreach
  failures the prep talking points won't catch.
- ❌ **Re-creating the dossier each session for the same panel** — if
  `INPUT/[company-slug]-[date]-prep-dossier.md` exists and is < 24h old,
  surface it instead of regenerating. New interviewers added → append
  new sections, don't full-rewrite.
- ❌ **Writing to `~/<workspace>/brain/`** — read-only on the brain layer.
  All writes go to `INPUT/` (workspace-level scratch) + GitHub Issues.

---

## COMPOSES WITH

- **`apply-tracker`** — auto-fires this skill on `Screen → Interview` /
  `Panel Scheduled` transitions.
- **`interview-prep`** — consumes the dossier as research substrate;
  generates per-round talking points, mock questions, scoring rubrics.
  Workflow: dossier first (research) → prep doc (talking points) →
  mock interview (practice).
- **`network-intelligence`** — if an interviewer is already in
  `~/<workspace>/network/people/`, this skill reads that file first; the
  network-intelligence skill writes to people files on contact ingest.
- **`outreach-composer`** — post-interview thank-you notes can reference
  specific dossier callbacks (e.g., "your point on [thesis area] resonated
  because [user experience]").
- **Perplexity MCP** — the primary research substrate.
- **LinkedIn MCP** — structured-profile fetch when URL is known.

---

## MULTI-AGENT SAFETY (P15)

This skill is **read-only on the brain layer** (`~/<workspace>/brain/`),
so it doesn't risk shared-file overwrites. Writes are scoped to:

1. `INPUT/[company-slug]-[date]-prep-dossier.md` — workspace-level scratch,
   single-author per panel (the company-slug+date is the de-facto lock).
2. GitHub Issue (one per dossier run, opened via `gh issue create`).

If the dossier file already exists for the same panel:
- < 24h old → surface existing file, ask user "regenerate or append new
  interviewers?"
- ≥ 24h old → regenerate fresh (panel context may have changed).

---

## TIER-SIZING (Operational Discipline)

Per `OPERATIONAL DISCIPLINE` Ground Zero invariant — right-size by task
class:

- **Orchestrator** (this skill, top-level) → Sonnet. Mid-complexity
  synthesis: trigger parsing, brain reads, sub-agent spawning, aggregation.
- **Per-interviewer sub-agents** → Sonnet. Each does live web research
  (Perplexity calls), structured analysis (story-to-question mapping),
  and watch-outs synthesis. Haiku is too thin for the synthesis layer;
  Opus is overkill.
- **JD parsing / story-index reading** → Haiku (mechanical extraction).

Parallel cost estimate (4 interviewers): ~4× Sonnet sub-agents in
parallel ≈ 60s wall-clock vs. ~4 min sequential. Token cost amortized
across the panel value (typically $200K+ comp).

---

## EXAMPLE INVOCATION (manual, for testing)

```
User: dossier for [Company]
[apply-tracker would normally pre-load this; in manual mode, look it up]

Skill:
━━━ Career OS: Interviewer Research ━━━

Resolving [Company] from pipeline...
  Role: [Role]
  Panel date: [YYYY-MM-DD]
  Interviewers (from pipeline entry):
    • [Interviewer A] — Partner
    • [Interviewer B] — CTO

Spawning 2 parallel research sub-agents...
  ✓ [Interviewer A] research complete (12s)
  ✓ [Interviewer B] research complete (14s)

Aggregating dossier...
  ✓ Output: INPUT/[company-slug]-[date]-prep-dossier.md
  ✓ GitHub Issue: #142 (kind:prep)

→ Say "prep me for [Company]" to generate per-round talking points
```

---

## ORIGIN

Codified 2026-04-27 as part of v0.27.0 to close a panel-prep automation
gap surfaced when a user advanced to a 2-interviewer panel and faced
30+ min of manual research per panel without automation.
Ship-tonight target for next-day conference demo.
