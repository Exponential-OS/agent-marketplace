---
name: job-search-scheduler
description: >
  Two modes: (1) full job scan with deep warm-path detection, and
  (2) warm-path enrichment on existing scan results. Reads targeting from
  config, scans LinkedIn + ATS, fetches JDs, detects 1st/2nd-degree warm
  paths, and writes scan reports + pipeline updates.
triggers:
  # Full scan triggers
  - scan for jobs
  - js
  - job search
  - find matching roles
  - what jobs match me
  - scan for jobs today
  - daily job scan
  - any new roles
  - find new roles
  - run job scan
  - what's new on the market
  # Warm-path enrichment triggers
  - enrich warm paths
  - warm paths
  - find connections
  - who knows people at these companies
  - check my network
  - find referrals
  - warm intros for scan
  - network scan
  - enrich contacts
  - find warm leads
  - run warm path detection
  - check connections
  - linkedin people check
---

# Job Search Scheduler — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_GITHUB_REPO` is derived from: `git -C $CAREER_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents)
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

**New role discoveries open as `kind:scan-result` issues** (one per high-priority finding) so cruise-control / mission-control can pick them up:
```bash
gh issue create --repo $CAREER_GITHUB_REPO \
  --title "Score+apply: {Company} {Role}" \
  --label "tier:p2,cadence:operational,repo:career-os-data,kind:scan-result" \
  --body "<scan-source URL + JD path + warm-path tag + suggested resume track>"
```

Scan reports themselves remain markdown files at `career-intelligence/projects/job-search/scans/{date}/scan-{HH}-{MM}.md` — those are READ artifacts, not tasks.

## FIRST-TIME SETUP (new users — run this before your first scan)

**Prerequisite: career-intelligence-onboarding must be complete.**
Say "onboard me to career intelligence" to run it. It creates `brain/identity/experience-history.md` and `career-intelligence/projects/job-search/job-search-config.md` from an 8-question interview. Without these files, the scanner has no targeting config and will produce irrelevant results.

**Step 1 — Expand job search config**
After onboarding, say: "set up my job search config" or "expand job search targeting". This reads your preferences from `job-search-config.md` and creates the full operational config at `career-intelligence/config/job-search.md` — adding ATS direct URLs, LinkedIn search keywords, company tiers, and warm-path settings. This is what the scanner reads on every run.

**Step 2 — Add your resume tracks**
Create a folder `Resumes & Cover Letters/` in your workspace. Paste or upload your current resume as one or more files. The file names become your track names (e.g., `resume-engineering-leader.md`, `resume-executive.md`). The resume engine auto-detects tracks from filenames. If you have only one resume, name it `resume-base.md` — the engine will derive tracks from your experience history.

**Step 3 — Set up the 6 AM automated scan (optional)**
Use Claude Code's scheduled task system to run the scanner automatically:
1. Open Claude Code settings → Scheduled Tasks → New Task
2. Set schedule: `0 6 * * 1-5` (6 AM Monday–Friday)
3. Paste the prompt from `skills/job-search-scheduler/scan-prompt-v11.md` (everything below the `## PROMPT BODY` line)
4. Set workspace to your `$CAREER_HOME` directory
The automated scan runs in surface-level mode (no deep People tab navigation). You review the output and run "enrich warm paths" manually for high-priority roles.

**What to customize per your situation:**
- `career-intelligence/config/job-search.md` → edit `Target Roles`, `Filters`, `ATS Direct URLs`, `LinkedIn Search Keywords`
- Target level and comp floor come from your onboarding answers — edit them in the config file if your search evolves
- The scanner reads the config on every run; edits take effect immediately

---

## Purpose

Two jobs:
1. **Scan** — discover open roles matching your profile across LinkedIn and ATS career pages
2. **Enrich** — take an existing scan report and run deep warm-path detection (1st-degree, 2nd-degree, alumni networks) on the roles found

The scan produces a role list. The enrichment produces actionable referral paths.
Both write to the same scan directory. Together they form the highest-ROI step
in the job search: finding roles AND finding the people who can get you in.

## Output Format

Always start your response with:
```
━━━ Career OS: Job Search ━━━
```

For enrichment mode:
```
━━━ Career OS: Warm Path Enrichment ━━━
```

## How to Invoke

### Mode 1: Full Scan
Say: "scan for jobs", "any new roles?", "daily job scan", "find matching roles",
"what's new on the market", "run job scan"

Runs the complete pipeline: discover → JD fetch → quick filter → warm-path
detection → write scan report → pipeline write-back.

### Mode 2: Warm-Path Enrichment (on existing scan)
Say: "enrich warm paths", "warm paths", "find connections", "check my network",
"find referrals", "warm intros for scan", "network scan", "enrich contacts",
"find warm leads", "linkedin people check", "check connections"

Reads the most recent scan report, identifies roles with Cold or surface-level
warm tags, and runs deep LinkedIn People tab navigation for 1st-degree,
2nd-degree, and alumni network detection. Writes an enrichment addendum to the
same scan date folder.

### Mode 3: Automated (Scheduled Task — 6 AM safety net)
Runs via `daily-linkedin-job-scan` scheduled task. Surface-level warm tagging
only (no People tab navigation — too slow for headless runs). Writes scan
report for user to review or enrich manually.

---

## ⚠️ PATH DRIFT — verified 2026-08-12

Paths below were corrected after a live scan found the documented config did not exist. The
workspace migrated `brain/` into engine-named folders; this skill still pointed at the old
tree. An agent trusting the old paths runs the scanner with NO targeting config and produces
irrelevant results silently.

| Was | Now | Verified |
|---|---|---|
| `brain/config/job-search.md` | `career-intelligence/config/job-search.md` | 2026-08-12 |
| `brain/reference/jd-samples/` | `brain/identity/reference/jd-samples/` | 2026-08-12 |
| `brain/identity/skills-matrix.md` | `identity/skills-matrix.md` | 2026-08-12 |
| `brain/identity/identity.md` | `xHumanOS/identity/identity.md` | 2026-08-12 |

`brain/identity/experience-history.md` was checked and is CORRECT — left alone.

**Before trusting any path in this file, confirm it exists.** These are workspace-specific
and drift whenever the brain layer is reorganised.

## CROSS-REFERENCES (P9 Coherence)

| Artifact | Location | Relationship |
|----------|----------|-------------|
| Config (targeting) | `career-intelligence/config/job-search.md` | Source of truth for all targeting parameters |
| Scheduled task prompt | `skills/job-search-scheduler/scan-prompt-v11.md` | Canonical scanner prompt (v11 — plugin path format). Paste into scheduled-task config. |
| Mission-control routing | `skills/mission-control/SKILL.md` | Routes scan + enrich triggers to this skill |
| Job-match-scorer skill | `skills/job-match-scorer/SKILL.md` | Receives scan output for deep scoring |
| Network-intelligence skill | `skills/network-intelligence/SKILL.md` | Deep contact analysis for individual companies |

If you change targeting → edit config only (both consumers read it).
If you change scan logic → update this SKILL.md AND the scheduled task prompt.

---

## DATA ARCHITECTURE

### Inputs (what the skill reads)

| Source | Path | What It Provides |
|--------|------|------------------|
| Config | `career-intelligence/config/job-search.md` | Target roles, company tiers, ATS URLs, LinkedIn keywords, filters, skip rules, warm-path settings |
| JD samples | `brain/identity/reference/jd-samples/*.md` | Saved JD snapshots for roles already fetched |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Already Applied table (skip dupes) + Warm Intros table (existing contacts) |
| Skills matrix | `identity/skills-matrix.md` | Technology proficiency for quick-filter gap detection |
| People | `network/people/*.md` | Contact network for warm-path cross-referencing |
| Identity | `xHumanOS/identity/identity.md` | Values, philosophy for culture fit |
| LinkedIn (via Chrome MCP) | Browser navigation | Job feeds, company pages, People tabs, connection data |
| Previous scan | `career-intelligence/projects/job-search/scans/{latest}/*.md` | Delta tracking — what changed since last scan |

### Outputs (what the skill writes)

| Output | Path | What It Contains |
|--------|------|------------------|
| Scan report | `career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/scan-{HH}-{MM}.md` | Roles found, warm tags, JD quality, verify queue |
| Enrichment report | `career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/enrich-{HH}-{MM}.md` | Deep warm-path results for roles from latest scan |
| JD snapshots | `brain/identity/reference/jd-samples/{company}-{role-slug}.md` | Fetched JD text (permanent — URLs die, snapshots don't) |
| Task updates | GitHub Issues `$CAREER_GITHUB_REPO` | New `kind:scan-result` issues opened per high-priority role |
| Pipeline updates | `career-intelligence/projects/job-search/job-pipeline.json` | New "Ready to Apply" entries |

---

## BEHAVIOR: Mode Selection (Automatic)

When the skill is invoked, determine mode from the trigger:

| Trigger matches | Mode | Action |
|----------------|------|--------|
| Scan triggers ("scan for jobs", "any new roles", etc.) | Full Scan | Run complete pipeline (Steps 1-5) |
| Enrich triggers ("enrich warm paths", "warm paths", etc.) | Enrichment Only | Skip discovery, run warm-path enrichment on latest scan (Step 3 only) |
| "scan and enrich" or "full scan with warm paths" | Full Scan + Enrichment | Run complete pipeline including deep warm paths |

---

## BEHAVIOR: Full Scan (Mode 1)

### Step 1: Load Context

Read from config file (`career-intelligence/config/job-search.md`):
- Target roles, company tiers, ATS URLs, LinkedIn keywords, filters
- Skip rules, structural gap auto-skip rules
- Resume track mapping

Read pipeline + people files:
- Already Applied table → skip exact role+company pairs
- COUNT the rows yourself — do NOT trust header count
- Warm Intros table → for warm-path tagging
- People directory → company names for tagging

Read most recent scan file → for delta tracking.

### Step 2: Scan Discovery Sources

#### Source A: LinkedIn (Chrome MCP required)

If Chrome MCP unavailable: skip Source A entirely. Log it. Run Source B only.

**A1. Recommended feed:** Navigate linkedin.com/jobs → capture first 20 matching
roles from "Recommended for you."

**A2. Keyword searches:** Run each keyword from config's `LinkedIn Search Keywords`
section at linkedin.com/jobs/search/ with filters from config's
`LinkedIn Search Filters` section. First 15 results per search. Dedup.

**A3. Connection noting:** While on each LinkedIn job page, if LinkedIn shows
"X connections at this company" or names 1st-degree contacts, note them.
Do NOT navigate to People tabs in this step (that's Step 3).

**Fallback:** If Chrome MCP unavailable or LinkedIn logged out, skip and log.

#### Source B: ATS Career Pages (WebFetch only)

WebFetch each URL from config's `ATS Direct URLs` table. Look for role titles
matching target roles from config. WebFetch is faster and cheaper than Chrome
for server-rendered ATS pages.

JS-rendered sites from config's `JS-Rendered Sites` list are covered by
LinkedIn in Source A only.

### Step 2b: JD Fetch Gate (REQUIRED before scoring)

For every NEW role found:

1. Extract direct job apply URL (not company page, not LinkedIn search URL)
2. Validate URL pattern per config rules
3. If valid: fetch JD text, save to `brain/identity/reference/jd-samples/`, tag `✅ JD`
4. If LinkedIn search/company URL only: tag `🔄 partial`
5. If 404 / "Job not found": mark CLOSED, exclude
6. If cannot fetch (JS, login wall): add to Verify Queue, tag `⚠️ title-only`

**JD URL validation rules:**

| URL Pattern | Valid? | Action |
|-------------|--------|--------|
| `https://jobs.ashbyhq.com/...` | Yes | Fetch JD |
| `https://job-boards.greenhouse.io/...` | Yes | Fetch JD |
| `https://jobs.lever.co/...` | Yes | Fetch JD |
| `https://careers.{company}.com/...` | Yes | Fetch JD |
| `https://linkedin.com/company/...` | No | Company page — click through |
| `https://linkedin.com/jobs/search/...` | No | Search results — not a JD URL |

**Rescore notification (WO-035):** After fetching JDs, check if any newly-fetched JD
matches a role already in the match tracker with `⚠️ title-only` Quality. If so,
append a note to the scan report:
```
⚠️ {N} roles now have JDs that were previously scored title-only — run "rescore queue" to update scores
```
This is a notification only — do not auto-trigger rescoring (token cost is Opus-level,
user decides when to spend it).

### Step 2c: Surface-Level Warm Tagging

For every role found, check company name against:
- Warm Intros table in pipeline
- People directory

Tag with strongest match (priority: 🔥 ACTIVE > ✅ REFERRAL > ✅ Resume sent > other).
Note LinkedIn connection counts from A3.

This is the same level the automated 6 AM scan does. Deep detection is Step 3.

### Step 3: Deep Warm-Path Detection (Manual Scan Only)

**This step only runs when the user invokes the skill manually (not the scheduled task).**

For every NEW role found with ≥80% quick filter score, extract connection data
from the company's LinkedIn People tab.

#### Browser Extraction Strategy (WO-037: DOM/JS over screenshots)

**Primary method: DOM/JS extraction** (10-20x cheaper than screenshots)

1. **Navigate directly** to the People tab URL:
   `https://www.linkedin.com/company/{slug}/people/`
   This skips the "navigate to company page → click People tab" round-trip.

2. **Extract via JavaScript** (`javascript_tool` or equivalent JS execution):
   Query DOM for people cards — name, title, connection degree, mutual connections.
   Do NOT take screenshots to visually parse the page.

3. **Filter via URL parameters** instead of click-filter-screenshot:
   - 1st connections: `/company/{slug}/people/?facetNetwork=%5B"F"%5D`
   - 2nd connections: `/company/{slug}/people/?facetNetwork=%5B"S"%5D`
   - Alumni: `/company/{slug}/people/?keywords=Berkeley`

4. **Rate limiting:** Wait 2-3 seconds between companies to avoid LinkedIn throttling.

**Fallback:** If JS extraction fails (empty results, CAPTCHA, DOM change):
- Log the failure with the specific selector that broke
- Fall back to screenshot-based extraction for that company only
- Surface warning: "DOM extraction failed for {Company} — falling back to screenshot"

#### 3a: 1st-Degree Detection
- Navigate to People tab filtered by 1st connections (URL param or JS filter)
- Extract via DOM: name, title, relationship context
- Cross-reference against `network/people/*.md`
- Cross-reference against pipeline Warm Intros table

#### 3b: 2nd-Degree Detection (HIGH VALUE)
- Navigate to People tab filtered by 2nd connections (URL param or JS filter)
- For each 2nd-degree contact: extract WHO the mutual connection is from DOM
- If mutual connection is in `network/people/*.md` → **actionable intro path**
- Record: 2nd-degree name + title, mutual connection name, relationship strength

**2nd-degree scoring:**

| Mutual Connection Type | Strength | Action |
|------------------------|----------|--------|
| In people/ with 🔥 ACTIVE status | Very strong | Ask mutual for direct intro |
| In people/ with any status | Strong | Reach out to mutual, mention shared connection |
| Berkeley Haas EMBA cohort | Strong | Alumni warm outreach |
| LinkedIn 1st but not in people/ | Medium | Connect first, then ask |
| Poker gang / social circle | Very strong | Text/WhatsApp ask |

#### 3c: Alumni Network Detection
- Navigate to People tab with `?keywords=Berkeley` (or "Haas")
- Extract count and names via DOM
- 3+ alumni = alumni network tag (medium strength)

#### 3d: Score Adjustments
- 1st-degree referral path: +5% to match score
- 2nd-degree via known contact: +3% to match score
- Alumni network (3+): +2% to match score
- Cold: no adjustment

#### 3e: Chain to network-intelligence
For roles scoring ≥85% with warm paths found, suggest:
`"who do I know at [Company]"` → routes to network-intelligence for deep
contact analysis and outreach draft.

### Step 4: Quick Filter + Job-Match-Scorer Handoff

Apply quick filter from config to disqualify obvious mismatches.
Deep 6-category scoring is handled by the **job-match-scorer** skill.

| Factor | Weight |
|--------|--------|
| Role level fit | 20% |
| Company tier | 10% |
| Recency | 5% |
| Salary fit | 5% |

If quick filter < 50% → SKIP.

After scan completes, suggest: `"score the latest scan"` to invoke job-match-scorer.

### Step 5: Write Outputs

**Scan report** (`career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/scan-{HH}-{MM}.md`):

```markdown
# Job Scan — {date} {time}

## Search Mode: {from config}

**Candidate:** {read from brain/identity/experience-history.md → `who:` frontmatter field}
**Scan type:** Manual scan with deep warm-path detection
**Reference:** Previous scan {date} {time}

---

## Pre-Scan Check
Already Applied: {N} rows counted (header said {M})
Last scan: {date} {time} — {path}
People files: {N} contacts loaded

---

## Summary
| Source | Scanned | New | Skipped | Dead |
|--------|---------|-----|---------|------|

## New Roles
| # | Company | Title | Location | Track | Warm Path | JD Quality | Source | URL |

## Warm Paths Found
| Company | Role | Contact | Type | Strength | Action |
|---------|------|---------|------|----------|--------|

## 2nd-Degree Intro Paths (HIGH VALUE)
| Company | Role | 2nd-Degree Contact | Mutual Connection | Strength | Action |
|---------|------|--------------------|-------------------|----------|--------|

## Alumni Networks
| Company | Alumni Count | Notable Names | Action |

## New Companies (not on ATS list)
| Company | Roles | Stage | Add to list? |

## Status Changes (vs last scan)
| Company | Title | Change |

## Verify Queue
| Company | Role | Source URL | JD Quality | Failure Reason | Action |

## No Matching Roles
| Company | Notes |

## Skipped (with reason)
| Company | Role | Reason |

## Next Steps
→ "score the latest scan" — run Opus scoring on new roles
→ "enrich warm paths" — run deep warm-path detection (if not already done)
→ "who do I know at [Company]" — deep network analysis for a specific company
→ "dashboard" — see apply-ready queue
```

**Pipeline write-back:**
- New roles → append to "Ready to Apply" section with "Scan {date} — awaiting scoring"
- Do NOT add scores, do NOT modify existing entries, do NOT touch Already Applied

**Task updates:**
- Open `kind:scan-result` issues on `$CAREER_GITHUB_REPO` for high-priority new roles (one issue per role; see Task Substrate section above for command)

---

## BEHAVIOR: Warm-Path Enrichment (Mode 2)

When user says "enrich warm paths", "find connections", "check my network", etc.:

### Step 1: Find Unenriched Scans
- Find ALL scan files across `career-intelligence/projects/job-search/scans/` (any date directory, pattern `scan-*.md`)
- For each scan, check if a corresponding enrichment file exists:
  - Enrichment files match pattern `enrich-*.md` in the same date directory
  - A scan is "enriched" if an enrichment file's `Scan enriched:` field references it
- Collect roles from ALL unenriched scans (not just the most recent)
- Deduplicate by company + role title (same role in multiple scans = enrich once)
- Identify roles tagged Cold or with surface-level warm tags only
- Load people files and pipeline Warm Intros table

If no scans exist: "No scan found. Say 'scan for jobs' to run one first."
If all scans already enriched: "All scans have been enriched. Run a new scan first."

### Step 2: Deep Warm-Path Detection
For each role from the unenriched scans that needs enrichment (Cold or surface-level only):
- Run Steps 3a-3e from the full scan (1st-degree, 2nd-degree, alumni detection)
- Use DOM/JS extraction strategy (see Step 3 "Browser Extraction Strategy") — not screenshots
- Requires Chrome MCP for LinkedIn People tab navigation

If Chrome MCP unavailable: "Chrome MCP needed for LinkedIn People tab navigation. Run this in a session with Chrome access."

### Step 3: Write Enrichment Report
Save to `career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/enrich-{HH}-{MM}.md`:

```markdown
# Warm Path Enrichment — {date} {time}

**Scans enriched:** {scan-09-00.md, scan-10-30.md, ...}
**Roles analyzed:** {N total, M after deduplication}
**New warm paths found:** {N}
**2nd-degree intros found:** {N}

## Warm Path Results

### {Company} — {Role}
| Path | Type | Strength | Action |
|------|------|----------|--------|
| {Name} (1st, {Title}) | Direct referral | Very strong | Ask to refer |
| {Name} (2nd via {Mutual}) | 2nd-degree intro | Strong | Ask {Mutual} for intro |
| {N} Haas alumni | Alumni network | Medium | Alumni outreach |

## Priority Actions (sorted by strength)
| # | Company | Contact | Action | Strength |
|---|---------|---------|--------|----------|

## Still Cold (no paths found)
| Company | Role | LinkedIn Connections | Suggestion |
|---------|------|---------------------|------------|

→ "write outreach for [Name]" — draft intro request
→ "who do I know at [Company]" — deeper analysis on specific company
```

### Step 4: Update Scan Report
If the original scan report has warm-path tags, update them with enriched results.
Use surgical edits — do not rewrite the entire scan file.

---

## BEHAVIOR: First Run (No Config)

When `career-intelligence/config/job-search.md` does NOT exist:

Walk through setup questions (one at a time, P11):
1. Target role titles
2. Job boards to scan
3. Companies to include/exclude
4. Location preferences
5. Salary floor
6. Preferred scan time

Create config file and register scheduled task via `schedule` skill.

---

## BEHAVIOR: Manual Scan with Filters

User can request targeted scans:
- "Scan for Anthropic roles" → filter to one company
- "Find director-level AI roles posted this week" → filter by level + recency
- "Any new roles at my tier 1 companies?" → use company tier from config

---

## BEHAVIOR: Expanded Company Discovery (Weekly)

On weekly cadence or when user says "find new companies":
- Group LinkedIn results by company, flag unknowns
- Check qualification criteria from config
- Add qualified companies to pipeline and config's ATS list

---

## MISSION CONTROL INTEGRATION

When dashboard loads, check for today's scan:
- Scan exists + enriched: "{N} roles found, {N} warm paths — say 'dashboard' to apply"
- Scan exists, not enriched: "{N} roles found — say 'enrich warm paths' for referral detection"
- Scan stale (>24h): "Job scan overdue — say 'scan for jobs'"
- No scan config: "Set up job scanning → 'scan for jobs'"

---

## MULTI-AGENT SAFETY (P15)

- Read pipeline and people files before every scan (another agent may have updated them)
- Surgical edits to pipeline — append rows, never rewrite tables
- Write scan reports as new files (no overwrites)
- Log all changes to handoff doc
