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

# Job Search Scheduler — Career Intelligence Skill

## Task Substrate (v0.25.0+)

> `$CAREER_GITHUB_REPO` is derived from: `git remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `workspace.manifest.yaml` `task_routing:` section for the full architecture.

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

**Step 3 — Optional trigger**
The cron/event trigger invokes `career-intelligence:job-search-scheduler` by name
at project scope in the career workspace. It carries no scan prompt body. Trigger
creation is owned by the user; interactive and scheduled invocations load this same file.

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
━━━ Career Intelligence: Job Search ━━━
```

For enrichment mode:
```
━━━ Career Intelligence: Warm Path Enrichment ━━━
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

### Mode 3: Triggered scan
A trigger invokes this skill by name and runs the same full scan below. Deep Chrome
People-tab enrichment remains an explicit enrichment mode; bounded MCP warm-path
probes run during every full scan when available.

All data paths below are relative to the session's project workspace root. Resolve
validator scripts from this loaded skill's installation directory; keep cwd at workspace
root. Do not derive data roots from environment variables.

## DATA ARCHITECTURE

### Inputs (what the skill reads)

| Source | Path | What It Provides |
|--------|------|------------------|
| Config | `career-intelligence/config/job-search.md` | Target roles, company tiers, ATS URLs, LinkedIn keywords, filters, skip rules, warm-path settings |
| JD samples | `brain/identity/reference/jd-samples/*.md` | Saved JD snapshots for roles already fetched |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Existing role records for deduplication; people files own warm paths |
| Skills matrix | `identity/skills-matrix.md` | Technology proficiency for quick-filter gap detection |
| People | `network/people/*.md` | Contact network for warm-path cross-referencing |
| Identity | `xHumanOS/identity/identity.md` | Values, philosophy for culture fit |
| Company flags | `career-intelligence/projects/job-search/company-flags.json` | Membership exclusions, cleared overrides, staleness |
| LinkedIn (via LinkedIn MCP or Chrome MCP) | Browser navigation | Job feeds, company pages, People tabs, connection data |
| Previous scan | `career-intelligence/projects/job-search/scans/{latest}/*.md` | Delta tracking — what changed since last scan |

### Outputs (what the skill writes)

| Output | Path | What It Contains |
|--------|------|------------------|
| Scan report | `career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/scan-{HH}-{MM}.md` | Roles found, warm tags, JD quality, verify queue |
| Enrichment report | `career-intelligence/projects/job-search/scans/{YYYY-MM-DD}/enrich-{HH}-{MM}.md` | Deep warm-path results for roles from latest scan |
| JD snapshots | `brain/identity/reference/jd-samples/{company}-{role-slug}.md` | Fetched JD text (permanent — URLs die, snapshots don't) |
| Task updates | GitHub Issues `$CAREER_GITHUB_REPO` | New `kind:scan-result` issues opened per high-priority role |
| Outcomes | `career-intelligence/projects/job-search/job-pipeline.json` | Append evidenced rejection/closed-door outcomes to the role’s `stage_data[]` |
| Company exclusions | `career-intelligence/projects/job-search/company-flags.json` | Record evidenced company-level closed doors/rejections with reason, date and optional action; update `_updated`; preserve cleared overrides |
| Pipeline updates | `career-intelligence/projects/job-search/job-pipeline.json` | New "Ready to Apply" entries |

---

## BEHAVIOR: Mode Selection (Automatic)

When the skill is invoked, determine mode from the trigger:

| Trigger matches | Mode | Action |
|----------------|------|--------|
| Scan triggers ("scan for jobs", "any new roles", etc.) | Full Scan | Run full scan procedure |
| Enrich triggers ("enrich warm paths", "warm paths", etc.) | Enrichment Only | Skip discovery; run enrichment procedure on existing scans |
| "scan and enrich" or "full scan with warm paths" | Full Scan + Enrichment | Run complete pipeline including deep warm paths |

---

## BEHAVIOR: Full Scan (interactive or triggered)


You are a job scanner. List open roles that match the candidate's targeting (per `career-intelligence/config/job-search.md` → `Target Roles`, `Resume Tracks`, `Filters`, `Company Tiers`) and their capability profile (per `identity/skills-matrix.md`). Read the candidate's name from `brain/identity/experience-history.md` (`who:` frontmatter). Do not score or apply.

**Targeting is config-driven. Do NOT hardcode role titles, company lists, or candidate name in this procedure.** Every scan reads:
- `Target Roles` — the full role universe (from config, not guessed)
- `Resume Tracks` — tracks defined in config. If none defined, derive from filenames in `Resumes & Cover Letters/`. If that folder is empty, derive two tracks from experience-history.md (IC-equivalent and management-equivalent if applicable).
- `Filters` — location, salary floor, experience level gates (any role failing these is not "matching")
- `Company Tiers` — defined in config. Default: Tier 1 = frontier/top-10, Tier 2 = growth AI-native, Tier 3 = enterprise AI division, Tier 4 = adjacent tech.

**Skills gate (skills-matrix.md):** Roles must sit inside the candidate's capability envelope. Before tagging a role as NEW, cross-check the JD against `skills-matrix.md`:
- Hard-requirement technologies not on skills-matrix → apply `Structural Gap Auto-Skip Rules` from config (skipped, not listed).
- All hard requirements present on skills-matrix → list the role. Tag the strongest-matching track (Eng Leader / Exec / Innovator) based on role seniority + company tier.

If a role genuinely fits multiple tracks, tag the one with the highest match density to the JD requirements. Never tag "unknown" — if track cannot be determined, add the role to the Verify Queue with reason "track ambiguous."

**If `career-intelligence/config/job-search.md` does not exist:** ABORT. Print: "⛔ Job search config not found. Run 'set up my job search config' first (requires career-intelligence-onboarding to be complete)." Do not attempt to infer targeting.

---

### STEP 0 — GET CURRENT DATE/TIME (REQUIRED, FIRST ACTION)

Run via bash BEFORE any other action:
- `date +%Y-%m-%d` → use as {SCAN_DATE}
- `date +%H-%M` → use as {SCAN_TIME}

Use these values for:
- Scan file path: `career-intelligence/projects/job-search/scans/{SCAN_DATE}/scan-{SCAN_TIME}.md`
- Scan header: `# Job Scan — {SCAN_DATE} {SCAN_TIME}`
- "Posted" column normalization: LinkedIn "3 days ago" → {SCAN_DATE minus 3 days}
- Pipeline write-back tag: `Scan {SCAN_DATE} — awaiting scoring`

Do NOT guess the date. Do NOT write literal `{date}` / `{time}` placeholders. If bash fails, ABORT.

---

### STEP 0.5 — MCP AVAILABILITY PROBE

Check which tools are available this run. Set flags:
- `LINKEDIN_MCP_OK` = true if `mcp__linkedin-community__search_jobs` is callable.
- `CHROME_MCP_OK` = true if Chrome MCP is callable.
- `PLAYWRIGHT_MCP_OK` = true if playwright-ms browser tools are callable (test by checking tool list for `mcp__playwright-ms__browser_navigate`).

Log both flags at top of the scan file.

**Routing:**
- `LINKEDIN_MCP_OK=true` → Sources A1, A2, A3, and LinkedIn JD fetches use the MCP.
- `LINKEDIN_MCP_OK=false` AND `CHROME_MCP_OK=true` → fall back to Chrome for A1/A2/A3 (same discovery procedure).
- `LINKEDIN_MCP_OK=false` AND `CHROME_MCP_OK=false` → skip A0/A1/A2/A3 entirely, log as skipped, run Source B only.
- Source A0 (Saved Jobs tracker) ALWAYS requires Chrome MCP (no MCP tool for it). If `CHROME_MCP_OK=false`, skip A0 with a note.

**MCP BUDGET (hard cap for this run):** 20 total calls across:
- `mcp__linkedin-community__search_jobs`
- `mcp__linkedin-community__get_job_details`
- `mcp__linkedin-community__search_people`
- `mcp__linkedin-community__get_person_profile`
- `mcp__linkedin-community__get_company_profile`

Maintain a counter `mcp_calls_used`. Before every MCP call, check `mcp_calls_used < 20`. On budget exhaustion, stop making MCP calls and log remaining work in the Verify Queue. Do NOT substitute Chrome MCP to bypass the budget — the budget exists to protect the LinkedIn account from flagging.

---

### BEFORE SCANNING — Read These Files

1. `career-intelligence/config/job-search.md` — SOURCE OF TRUTH for targeting. Read: target roles, company tiers, ATS URLs, LinkedIn keywords, filters, skip rules, structural gap rules, resume tracks. Do NOT hardcode.
2. `career-intelligence/projects/job-search/job-pipeline.json` — Already Applied + Active + Ready to Apply. **Note:** Warm Intros & Follow-Ups table was removed from job-pipeline.json per ADR-001 (2026-04-06). Warm path data now lives in `network/people/*.md` — read via the PEOPLE INDEX (item 4 below), not the pipeline.
3. Most recent file in `career-intelligence/projects/job-search/scans/` — delta tracking.
4. `network/people/` — directory listing only (company names for warm-path tagging) PLUS per-file names/titles for 2nd-degree mutual matching.
5. `identity/skills-matrix.md` — quick-filter gap detection.

Build the DEDUP SET in memory from job-pipeline.json: every {company, normalized-title} pair across Already Applied (all statuses), Active (all states), and Ready to Apply. COUNT rows yourself — do NOT trust the header. Log the actual count (e.g., "Already Applied: 120 rows counted, dedup set size: 142").

Build the PEOPLE INDEX in memory from `network/people/`: map of `{full_name_lowercased → {company, tier, relationship}}`. Used for 2nd-degree mutual matching (Phase 2b).

---

### COMPANY FLAGS GATE — required before expensive role enrichment and publication

Read `career-intelligence/projects/job-search/company-flags.json`. Run the validator
from workspace root, with the absolute script path resolved from this loaded skill:

```bash
bun <loaded-skill-directory>/check-company-flags.ts <candidate-roles.json> > <gate-result.json>
```

The input is a JSON array of roles with `company`; output is `{kept, excluded,
warnings, bootstrapped, notices}`. Feed ONLY `kept` into JD fetches, scoring, pipeline
writes and dashboard action items. Run again on the final candidate set. A nonzero
exit blocks publication: mark the report `gate did not run`, retain the Verify Queue,
and fix the named error. Do not interpret failure as zero exclusions.

Membership in either deprioritized or flagged excludes a company; cleared wins.
Action is a reason refinement, including conditional referral restrictions, never the
filter key. The gate deduplicates exclusions by company. Saved jobs, tier overrides
and warm paths do not bypass it. Render every returned company, list, reason and
action in `## Company exclusions`, and all warnings/notices verbatim. More than
30 days since `_updated` warns. First run with an existing job-search directory
bootstraps a missing flags file and reports it; missing directory or malformed JSON
fails hard. Preserve flags data; never reset a malformed file to empty.

### ALGO SURFACES — mandatory on every scan and track

The following table is checked bidirectionally against `ALGO_SURFACES` exported by
`check-yield-table.ts`. Track selection filters roles, never the surface roster.

| Surface | Purpose |
|---|---|
| LinkedIn Saved | User-curated jobs |
| LinkedIn Recommended | Personalized recommendations |
| LinkedIn Search | Every configured keyword |
| ATS Direct | Every configured career page |

For every surface, report listed/new/excluded counts and status, including zero yield,
unavailable transport and budget exhaustion. Unavailable means incomplete coverage,
not a claim that the surface was searched. Never silently omit a surface.

When a surface is weak or off-target, STOP query tuning. First read the actual skills
listed on that surface, then read the resume uploaded there, compare both with the
canonical skills/resume track, fix supported profile defects, and re-check results
with the same query. Record before/after evidence. If edits require user approval
or access is unavailable, record the blocked diagnostic; do not tune around it.
Only after that diagnostic may targeting queries be changed (XOS-267).

The report MUST contain this section (replace counts and status with measured values):

```markdown
## ALGO SURFACES
| Surface | Listed | New | Excluded | Status |
|---|---|---|---|---|
| LinkedIn Saved | 0 | 0 | 0 | pending |
| LinkedIn Recommended | 0 | 0 | 0 | pending |
| LinkedIn Search | 0 | 0 | 0 | pending |
| ATS Direct | 0 | 0 | 0 | pending |
```

Before pipeline write-back or scoring, run:

```bash
bun <loaded-skill-directory>/check-yield-table.ts <scan-report.md>
```

Nonzero means incomplete: add the missing measured rows before proceeding. A complete
row set does not imply successful coverage; disclose all unavailable surfaces.

### DEDUP GATE — Skip already-known roles BEFORE any expensive operation

A role is "known" if it matches DEDUP SET by (company + normalized title). Normalize titles: lowercase, strip "Sr.", "Senior", location suffixes, trailing parentheticals.

Apply dedup BEFORE:
- Clicking into a LinkedIn job detail page (A0)
- Calling `mcp__linkedin-community__get_job_details` (A1, A2)
- Fetching a JD via WebFetch (B)
- Saving any JD to `brain/identity/reference/jd-samples/`

Known roles → "Skipped (already in pipeline)" table with source + matched pipeline row. Do NOT fetch JDs, do NOT save. This saves tokens AND MCP budget.

NEW roles at the SAME company (different role title) are NOT dedups — list them.

---

### LINKEDIN STATE TRANSITION RULES (Source A0 only — Chrome MCP)

After ingesting (or dedup-skipping) a saved job, transition its state OFF "Saved":
1. Preferred: change to "In Progress"
2. Fallback: change to "Archive" / "Archived"
3. Last resort: leave as "Saved", log URL in Notes so the user moves it manually

Never leave processed saved jobs in "Saved" silently — always record in "Saved-Job State Transitions" output table.

---

### SOURCE A0 — LinkedIn Saved Jobs (HIGHEST PRIORITY — Chrome MCP required)

Roles the user manually saved. Pre-filtered, high-signal. Exempt from noise filter BUT NOT from dedup gate.

No LinkedIn API tool exposes the saved-jobs tracker.

A0.1. Navigate to `https://www.linkedin.com/jobs-tracker/?stage=saved` (tracker URL — /my-items/saved-jobs/ lazy-loads, misses items).
A0.2. Paginate through ALL pages — click every page.
A0.3. Read list view FIRST — extract Company + Title for every saved row WITHOUT clicking in.
A0.4. Apply DEDUP GATE:
  - Match → "Skipped (already in pipeline)" table. Do NOT click in. BUT still transition state off "Saved" using the fallback chain (In Progress → Archive → leave+log). Cheap — one click, no JD fetch.
A0.5. For each NEW saved role:
  a. Click in. Extract: Company, Title, Location, Job URL, Posted date, Applicant count, full JD text.
  b. Save JD to `brain/identity/reference/jd-samples/{company}-{role-slug}.md`
  c. Tag Source: "⭐ LinkedIn Saved"
  d. Transition state off "Saved" (In Progress → Archive → leave+log).
A0.6. All NEW A0 roles go to Ready to Apply regardless of applicant count, warm path, or tier — the user's save IS the signal. Saved intent bypasses targeting/noise skips, never dedup, closed-role checks or company exclusions.

---

### SOURCE A1 — LinkedIn Recommended Feed (LinkedIn MCP preferred)

If `LINKEDIN_MCP_OK=true`:
- Call `mcp__linkedin-community__search_jobs` with no keywords (or as documented by the MCP for recommended feed). Increments `mcp_calls_used`.
- Parse returned JSON. Apply DEDUP GATE to the title list. Known roles → skipped table, no further calls.
- For each NEW role, call `mcp__linkedin-community__get_job_details(job_id)` to fetch full JD + applicant count. Each call increments budget.
- Volume target: 200 roles when available; stop at feed exhaustion, 200 roles, or the hard MCP budget, whichever comes first. Record any shortfall and cause in the yield table; never bypass the budget to reach a volume floor.

If `LINKEDIN_MCP_OK=false`, use Chrome MCP (same list-first discovery) — scroll feed, dedup at list level, click only NEW roles.

---

### SOURCE A2 — LinkedIn Keyword Search (LinkedIn MCP preferred)

If `LINKEDIN_MCP_OK=true`:
- For each keyword from config (`LinkedIn Search Keywords`), call `mcp__linkedin-community__search_jobs(keyword, filters_from_config)`. Each search is 1 MCP call.
- Capture at least 30 per keyword when available; record shortfall when fewer results exist or the hard MCP budget stops retrieval.
- Apply DEDUP GATE across A0/A1/A2 (no double-counting).
- For NEW roles: `get_job_details(job_id)` for JD + applicant count. Each call counts against budget.

If budget runs out mid-search: log remaining keywords in Verify Queue with reason "MCP budget exhausted."

If `LINKEDIN_MCP_OK=false`, use Chrome MCP (same keyword procedure).

---

### SOURCE A3 — 1st-Degree Connections at Company (LinkedIn MCP preferred)

For each NEW role (from A0, A1, A2 — after dedup, before noise filter):

If `LINKEDIN_MCP_OK=true` AND budget available:
- Call `mcp__linkedin-community__search_people(company=role.company, connection_degree=1)`. 1 MCP call per company (dedup companies — don't re-query for multiple roles at same co).
- Capture: name, title, LinkedIn URL.
- Feed results into WARM PATH TAGGING.

If `LINKEDIN_MCP_OK=false` OR budget exhausted: fall back to read "X connections at this company" from the Chrome-rendered LinkedIn job page passively. Do NOT navigate to the People tab.

**Company-level cache:** Maintain `company_1st_degree_cache = {company → [people]}` for the run. Don't re-query the same company across multiple roles.

---

### PHASE 2b — 2nd-Degree Warm Paths (LinkedIn MCP required)

**Purpose:** Surface actionable warm paths inline in the scan.

**When to run:** ONLY for roles with warm-path tag = `Cold` after Phase 2a (no 1st-degree found in A3 AND no existing match in People/pipeline).

**Budget:** Hard cap of 5 second-degree probes per scan (regardless of remaining MCP budget). Prioritize tier-1/tier-2 companies from config.

**Algorithm:**
1. Pick up to 5 cold-tagged roles, sorted by tier (tier-1 first).
2. For each role's company C:
   a. Call `mcp__linkedin-community__search_people(company=C, connection_degree=2)`. Top 10 results only. [1 MCP call]
   b. For each 2nd-degree person P2 (cap at top 3 per company):
      - Call `mcp__linkedin-community__get_person_profile(P2.url)`. [1 MCP call]
      - Extract `shared_connections` or `mutual_connections` (exact field name TBD at first run — log actual response shape for the plugin WO-A probe).
      - For each mutual M: normalize M's name, look up in PEOPLE INDEX.
      - If M is in PEOPLE INDEX → emit warm path: `2nd: [P2.name] — [P2.title] via [M.name] (your [M.tier] contact at [M.company])`.
3. Update role's warm-path tag from `Cold` → the strongest 2nd-degree path found.
4. Cap total Phase 2b MCP calls at 15 (5 companies × (1 search_people + ~2 profile reads)). If any single company burns more than 4 calls, stop that company and move to next.

**Output:** Phase 2b results go into BOTH the "Warm Paths Found" table AND the New Roles table's Warm Path column.

**If `LINKEDIN_MCP_OK=false`:** Skip Phase 2b entirely. Log as "Phase 2b skipped — LinkedIn MCP unavailable" in Notes. Do NOT substitute Chrome.

---

### SOURCE B — ATS Career Pages (WebFetch — unchanged)

WebFetch URLs from config (`ATS Direct URLs`). Match titles to target roles.

Listing page returned → scan titles, apply DEDUP GATE, skip known. For NEW matches: capture Company, Title, Location, URL. Fetch individual JD URL (second WebFetch) only for non-dedup roles.

"No jobs" / fail → log in "No Matching Roles." Move on.

Do NOT use Chrome MCP or LinkedIn MCP for these. ATS pages are server-rendered; WebFetch is faster and cheaper.

**Exception — Ashby (`jobs.ashbyhq.com`) is JS-rendered.** WebFetch returns a blank shell.
- If `PLAYWRIGHT_MCP_OK=true`: use playwright-ms (`mcp__playwright-ms__browser_navigate` → `mcp__playwright-ms__browser_snapshot`) — anonymous, handles JS, no auth needed. This unlocks Modal, Glean, Writer, Snorkel, Harvey, and any other Ashby-hosted company in config.
- If `PLAYWRIGHT_MCP_OK=false`: add to Verify Queue with reason "Ashby JS-rendered — needs playwright-ms or Chrome session."

Other JS-rendered sites in config `JS-Rendered Sites`: covered by LinkedIn MCP/Chrome searches. If neither MCP available: "Not scanned — needs MCP."

---

### WARM PATH TAGGING (Phase 2a — no extra navigation)

For every NEW role, check company name against the PEOPLE INDEX (built from `network/people/`). The Warm Intros & Follow-Ups table no longer exists in job-pipeline.json (removed ADR-001 2026-04-06) — people files are the SSOT.

- Match → `Existing: [Name]`. Multiple matches for same company → tag STRONGEST: (1) 🔥 ACTIVE referral, (2) ✅ REFERRAL CONFIRMED, (3) ✅ Resume sent, (4) other.
- Source A3 returned 1st-degree → `1st: [Name] — [Title]`
- No match → `Cold` (eligible for Phase 2b).

---

### JD FETCH GATE (only for NEW roles — after dedup)

For every NEW role that passed dedup:

1. Extract direct job apply URL (not company page, not search URL).
2. Validate:
   - `jobs.ashbyhq.com/company/UUID` — JS-rendered: if `PLAYWRIGHT_MCP_OK=true` use playwright-ms (`browser_navigate` → `browser_snapshot`); else Verify Queue, tag `⚠️ title-only`
   - `job-boards.greenhouse.io/company/jobs/ID` — valid, WebFetch
   - `jobs.lever.co/company/UUID` — valid, WebFetch
   - `careers.{company}.com/jobs/...` — valid, WebFetch
   - `linkedin.com/jobs/view/ID` — valid; if `LINKEDIN_MCP_OK` use `get_job_details`, else Chrome extract
   - `linkedin.com/jobs/search/...` — NOT a JD URL
   - `linkedin.com/company/...` — NOT a JD URL
3. Valid → fetch JD. Tag `✅ JD`.
4. LinkedIn search/company only → `🔄 partial`.
5. 404 / "Job not found" / redirect → CLOSED, exclude.
6. Cannot fetch → Verify Queue, tag `⚠️ title-only`.
7. Save JDs to `brain/identity/reference/jd-samples/{company}-{role-slug}.md`.
8. Applicant count (from LinkedIn job detail when available):
   - Exact: "47 applicants" → 47
   - "Over 100" → 100, "Over 200" → 200, "Over 400" → 400
   - "Be an early applicant" → 0
   - Not visible (ATS-only) → "n/a"
9. Posted date (normalize vs {SCAN_DATE}):
   - "3 days ago" → {SCAN_DATE minus 3}
   - "Reposted 2 days ago" → flag with ♻️
   - Exact date → use as-is
   - Not visible → "unknown"

---

### VERIFICATION

- A0 (Chrome Saved): URLs live from Chrome. No extra verification.
- A1, A2 (LinkedIn MCP or Chrome): `get_job_details` success OR Chrome click success = verified.
- B (ATS): WebFetch loaded = verified. 404 on individual URL → exclude.

Do NOT use WebSearch.

---

### SKIP RULES

Read from config: `General Skip Rules` + `Structural Gap Auto-Skip Rules`.

**400-applicant NOISE FILTER — high-applicant cold roles:**
- IF `applicant_count ≥ 400 AND warm_path = Cold AND company NOT in tier-1 override` → SKIP with reason "high noise (400+ applicants, cold)."
- Tier-1 override comes from config’s Company Tiers (never skip on noise alone). Neither tier nor warm path overrides company exclusions.
- Source A0 ALWAYS exempt from noise filter.
- Early-applicant bonus: applicant_count < 25 → tag `⭐ early`.
- **Phase 2b warm-path upgrade:** A role that was Cold but upgraded to 2nd-degree via Phase 2b is NO LONGER Cold for purposes of the noise filter. Reevaluate before skipping.

---

### RESUME TRACK (config-driven, skills-checked)

For every NEW role that passed dedup and the skills gate:

1. **Read** `Resume Tracks` from `career-intelligence/config/job-search.md`. Three tracks: Eng Leader / Exec / Innovator.
2. **Classify by role seniority** (from the JD title/level):
   - IC-lead, EM, SEM, Senior Manager → candidate for **Eng Leader**
   - Director, Sr Director, VP Eng → candidate for **Exec**
   - Head of X, CTO, VP Eng at sub-100-person co → candidate for **Innovator**
3. **Classify by company archetype** (from the role's company tier in config):
   - Tier 1 (frontier AI labs) or Tier 2 (AI-native product co) → prefers Eng Leader or Innovator depending on stage
   - Tier 3 (big-co AI divisions) → prefers Exec
   - Tier 4 (adjacent / early-stage / stealth) → prefers Innovator
4. **Cross-check skills-matrix.md:** the track's implicit strengths (from `Resume Tracks` descriptors in config) must overlap with the JD's hard requirements AND with skills-matrix. If skills-matrix shows a gap against hard requirements → apply `Structural Gap Auto-Skip Rules` (skip). If skills-matrix shows a gap against nice-to-haves only → proceed, note the gap in the Track column suffix (e.g., `Eng Leader ⚠️ML infra gap`).
5. **Emit** the track tag in the `Track` column of the New Roles table. Never leave blank. If role/company-archetype signals conflict → add to Verify Queue with reason `track ambiguous — manual classification needed`.

**Output examples (Track column):**
- `Eng Leader` — clean match (EM at Anthropic, no gaps)
- `Exec ⚠️growth-eng gap` — Director at growth-stage, but skills-matrix shows partial coverage of growth-eng stack
- `Innovator` — Head of Eng at seed-stage AI co, 0→1 mandate

---

### NEW COMPANIES (LinkedIn surfaces only)

If LinkedIn surfaces a company not in config's ATS list or Company Tiers: "New Companies" table. Flag for addition using config criteria.

---

### OUTPUT

Save to: `career-intelligence/projects/job-search/scans/{SCAN_DATE}/scan-{SCAN_TIME}.md`

```markdown
# Job Scan — {SCAN_DATE} {SCAN_TIME}

## Search Mode: {from config}

**Candidate:** {{CANDIDATE_NAME}}
**Scan type:** Full scan (single skill procedure)
**Reference:** Previous scan {date} {time} — delta tracked below.
**Agent:** {agent-id}

---

## MCP Availability & Budget
| Tool | Available | Calls Used | Cap |
|---|---|---|---|
| linkedin-community MCP | {true/false} | {N} | 20 |
| Chrome MCP | {true/false} | — | — |

Phase 2b calls: {N}/15 used. Companies probed: {list}.

---

## Pre-Scan Check
Scan date (from bash): {SCAN_DATE} {SCAN_TIME}
Already Applied rows counted: {N} (header said {M})
Dedup set size: {N} unique {company, title} pairs
People index size: {N} contacts
Last scan: {date} {time} — {path}
Source A0 (saved jobs visible): {N} total, {K} new, {M} already in pipeline

---

## Summary
| Source | Listed | New (fetched) | Dedup skipped | Noise skipped | Other skipped | Dead |
|---|---|---|---|---|---|---|
| A0. LinkedIn Saved | X | X | X | 0 (exempt) | X | X |
| A1. LinkedIn Recommended (MCP) | X | X | X | X | X | X |
| A2. LinkedIn Search (MCP) | X | X | X | X | X | X |
| B. ATS Direct | X | X | X | X | X | X |
| **Total** | **X** | **X** | **X** | **X** | **X** | **X** |

## New Roles
| # | Company | Title | Location | Posted | Applicants | Track | Warm Path | JD Quality | Source | URL |
|---|---|---|---|---|---|---|---|---|---|---|

## Warm Paths Found
| Company | Contact | Degree | Role | Action |

(Degree column: 1st, 2nd via [Mutual], Existing)

## Phase 2b — 2nd-Degree Probes
| Company | 2nd-Degree Person | Mutual (your contact) | Mutual Tier | Suggested Action |

## New Companies (not on ATS list)
| Company | Roles | Stage | Add to list? |

## Status Changes (vs last scan)
| Company | Title | Change |

## Verify Queue
| Company | Role | Source URL | JD Quality | Failure Reason | Action |

## Skipped (already in pipeline) — DEDUP GATE
| Company | Title | Source | Matched pipeline row / status |

## Skipped (noise / structural / other)
| Company | Role | Reason | Applicants |

## Saved-Job State Transitions (Source A0)
| Company | Role | Prior state | New state | Method used | Status |

## No Matching Roles
| Company | Notes |

## Notes
(Flag saved jobs where neither "In Progress" nor "Archive" was available. Flag MCP budget exhaustion. Flag Phase 2b field-shape discoveries for plugin WO-A.)
```

⭐ = priority for Opus scoring (Source A0 OR applicant_count < 25 OR Phase 2b 2nd-degree match).
List source failures.

---

### WRITE-BACK AND SCORING

Only after both validators pass, re-read the pipeline and dedup again. Append kept,
new roles as Ready to Apply records using the existing JSON schema; preserve all
existing records and identifiers. Never append Markdown tables into a JSON file.
Tag scan timestamp, direct URL, JD path/quality, track, applicant count, and warm path.
Record observed rejection/closed-role outcomes in the matching role's `stage_data[]`
with source evidence and time. A closed posting alone is not a company-wide ban.
For evidenced company-level closed doors, update company-flags with company, reason,
date and action when known; preserve cleared decisions. Re-run the flags gate after
such updates and before emitting action items.

Invoke `job-match-scorer` on kept roles with fetched JDs, then `mission-control` to
display scored results. The scanner does not invent scores or submit applications.
Title-only roles stay in Verify Queue; newly fetched JDs previously scored title-only
are identified for the scorer's rescore queue. Open high-priority `kind:scan-result`
tasks through the Task Substrate above after filtering and scoring.

## Deep Chrome Enrichment Procedure

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
   - Alumni: `/company/{slug}/people/?keywords={alma_mater}` (read the user's schools
     from their canonical education record; never hardcode a school)

4. **Rate limiting:** Wait 2-3 seconds between companies to avoid LinkedIn throttling.

**Fallback:** If JS extraction fails (empty results, CAPTCHA, DOM change):
- Log the failure with the specific selector that broke
- Fall back to screenshot-based extraction for that company only
- Surface warning: "DOM extraction failed for {Company} — falling back to screenshot"

#### 3a: 1st-Degree Detection
- Navigate to People tab filtered by 1st connections (URL param or JS filter)
- Extract via DOM: name, title, relationship context
- Cross-reference against `network/people/*.md`
- Cross-reference against the people index

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
| Shared school or program cohort | Strong | Alumni warm outreach |
| LinkedIn 1st but not in people/ | Medium | Connect first, then ask |
| Close personal or social circle | Very strong | Text/WhatsApp ask |

#### 3c: Alumni Network Detection
- Navigate to People tab with `?keywords={alma_mater}` (one query per school in the
  user's canonical education record)
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
- Load people files (the warm-path source of truth)

If no scans exist: "No scan found. Say 'scan for jobs' to run one first."
If all scans already enriched: "All scans have been enriched. Run a new scan first."

### Step 2: Deep Warm-Path Detection
For each role from the unenriched scans that needs enrichment (Cold or surface-level only):
- Run Steps 3a-3e from the full scan (1st-degree, 2nd-degree, alumni detection)
- Use DOM/JS extraction strategy (see Deep Chrome Enrichment Procedure) — not screenshots
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
| {N} {alma_mater} alumni | Alumni network | Medium | Alumni outreach |

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

Create the config file. The user owns trigger creation; it invokes this skill by name.

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
