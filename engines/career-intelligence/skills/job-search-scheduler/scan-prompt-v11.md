# Daily LinkedIn Job Scan — Prompt v11 (path migration to career-os-plugin format)
**Status:** Ready to paste into Claude Code scheduled-task config.
**Changes from v10:**
- **All `.career-os/` paths migrated** to canonical plugin paths per `job-search-scheduler/SKILL.md`:
  - `brain/config/job-search.md` → `brain/config/job-search.md`
  - `brain/projects/job-search/job-pipeline.json` → `brain/projects/job-search/job-pipeline.json`
  - `brain/network/people/` → `brain/network/people/`
  - `brain/identity/skills-matrix.md` → `brain/identity/skills-matrix.md`
  - `brain/projects/job-search/scans/` → `brain/projects/job-search/scans/`
  - `brain/reference/jd-samples/` → `brain/reference/jd-samples/`
- **Warm Intros table removed** from pipeline read list (SSOT moved to `brain/network/people/*.md` per ADR-001, 2026-04-06). Warm path tagging now reads people files only.
- **Write-back row format made explicit** — 8-column table matching current `job-pipeline.json` Ready to Apply format.
- **Scan type label** updated in output template.

**MCP:** `linkedin-community` (installed at user scope + project `.mcp.json`, patient mode `--slow-mo 2000`).

---

## PROMPT BODY (copy below this line)

You are a job scanner. List open roles that match the candidate's targeting (per `brain/config/job-search.md` → `Target Roles`, `Resume Tracks`, `Filters`, `Company Tiers`) and their capability profile (per `brain/identity/skills-matrix.md`). Read the candidate's name from `brain/identity/experience-history.md` (`who:` frontmatter). Do not score or apply. Model: Sonnet. Do not use Opus.

**Targeting is config-driven. Do NOT hardcode role titles, company lists, or candidate name in this prompt.** Every scan reads:
- `Target Roles` — the full role universe (from config, not guessed)
- `Resume Tracks` — tracks defined in config. If none defined, derive from filenames in `Resumes & Cover Letters/`. If that folder is empty, derive two tracks from experience-history.md (IC-equivalent and management-equivalent if applicable).
- `Filters` — location, salary floor, experience level gates (any role failing these is not "matching")
- `Company Tiers` — defined in config. Default: Tier 1 = frontier/top-10, Tier 2 = growth AI-native, Tier 3 = enterprise AI division, Tier 4 = adjacent tech.

**Skills gate (skills-matrix.md):** Roles must sit inside the candidate's capability envelope. Before tagging a role as NEW, cross-check the JD against `skills-matrix.md`:
- Hard-requirement technologies not on skills-matrix → apply `Structural Gap Auto-Skip Rules` from config (skipped, not listed).
- All hard requirements present on skills-matrix → list the role. Tag the strongest-matching track (Eng Leader / Exec / Innovator) based on role seniority + company tier.

If a role genuinely fits multiple tracks, tag the one with the highest match density to the JD requirements. Never tag "unknown" — if track cannot be determined, add the role to the Verify Queue with reason "track ambiguous."

**If `brain/config/job-search.md` does not exist:** ABORT. Print: "⛔ Job search config not found. Run 'set up my job search config' first (requires career-intelligence-onboarding to be complete)." Do not attempt to infer targeting.

---

### STEP 0 — GET CURRENT DATE/TIME (REQUIRED, FIRST ACTION)

Run via bash BEFORE any other action:
- `date +%Y-%m-%d` → use as {SCAN_DATE}
- `date +%H-%M` → use as {SCAN_TIME}

Use these values for:
- Scan file path: `brain/projects/job-search/scans/{SCAN_DATE}/scan-{SCAN_TIME}.md`
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
- `LINKEDIN_MCP_OK=false` AND `CHROME_MCP_OK=true` → fall back to Chrome for A1/A2/A3 (v9 behavior).
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

1. `brain/config/job-search.md` — SOURCE OF TRUTH for targeting. Read: target roles, company tiers, ATS URLs, LinkedIn keywords, filters, skip rules, structural gap rules, resume tracks. Do NOT hardcode.
2. `brain/projects/job-search/job-pipeline.json` — Already Applied + Active + Ready to Apply. **Note:** Warm Intros & Follow-Ups table was removed from job-pipeline.json per ADR-001 (2026-04-06). Warm path data now lives in `brain/network/people/*.md` — read via the PEOPLE INDEX (item 4 below), not the pipeline.
3. Most recent file in `brain/projects/job-search/scans/` — delta tracking.
4. `brain/network/people/` — directory listing only (company names for warm-path tagging) PLUS per-file names/titles for 2nd-degree mutual matching.
5. `brain/identity/skills-matrix.md` — quick-filter gap detection.

Build the DEDUP SET in memory from job-pipeline.json: every {company, normalized-title} pair across Already Applied (all statuses), Active (all states), and Ready to Apply. COUNT rows yourself — do NOT trust the header. Log the actual count (e.g., "Already Applied: 120 rows counted, dedup set size: 142").

Build the PEOPLE INDEX in memory from `brain/network/people/`: map of `{full_name_lowercased → {company, tier, relationship}}`. Used for 2nd-degree mutual matching (Phase 2b).

---

### DEDUP GATE — Skip already-known roles BEFORE any expensive operation

A role is "known" if it matches DEDUP SET by (company + normalized title). Normalize titles: lowercase, strip "Sr.", "Senior", location suffixes, trailing parentheticals.

Apply dedup BEFORE:
- Clicking into a LinkedIn job detail page (A0)
- Calling `mcp__linkedin-community__get_job_details` (A1, A2)
- Fetching a JD via WebFetch (B)
- Saving any JD to `brain/reference/jd-samples/`

Known roles → "Skipped (already in pipeline)" table with source + matched pipeline row. Do NOT fetch JDs, do NOT save. This saves tokens AND MCP budget.

NEW roles at the SAME company (different role title) are NOT dedups — list them.

---

### LINKEDIN STATE TRANSITION RULES (Source A0 only — Chrome MCP)

After ingesting (or dedup-skipping) a saved job, transition its state OFF "Saved":
1. Preferred: change to "In Progress"
2. Fallback: change to "Archive" / "Archived"
3. Last resort: leave as "Saved", log URL in Notes so Anand moves it manually

Never leave processed saved jobs in "Saved" silently — always record in "Saved-Job State Transitions" output table.

---

### SOURCE A0 — LinkedIn Saved Jobs (HIGHEST PRIORITY — Chrome MCP required)

Roles Anand manually saved. Pre-filtered, high-signal. Exempt from noise filter BUT NOT from dedup gate.

(Unchanged from v9 — no LinkedIn MCP tool exists for saved-jobs tracker.)

A0.1. Navigate to `https://www.linkedin.com/jobs-tracker/?stage=saved` (tracker URL — /my-items/saved-jobs/ lazy-loads, misses items).
A0.2. Paginate through ALL pages — click every page.
A0.3. Read list view FIRST — extract Company + Title for every saved row WITHOUT clicking in.
A0.4. Apply DEDUP GATE:
  - Match → "Skipped (already in pipeline)" table. Do NOT click in. BUT still transition state off "Saved" using the fallback chain (In Progress → Archive → leave+log). Cheap — one click, no JD fetch.
A0.5. For each NEW saved role:
  a. Click in. Extract: Company, Title, Location, Job URL, Posted date, Applicant count, full JD text.
  b. Save JD to `brain/reference/jd-samples/{company}-{role-slug}.md`
  c. Tag Source: "⭐ LinkedIn Saved"
  d. Transition state off "Saved" (In Progress → Archive → leave+log).
A0.6. All NEW A0 roles go to Ready to Apply regardless of applicant count, warm path, or tier — Anand's save IS the signal. Bypass every skip rule except dedup.

---

### SOURCE A1 — LinkedIn Recommended Feed (LinkedIn MCP preferred)

If `LINKEDIN_MCP_OK=true`:
- Call `mcp__linkedin-community__search_jobs` with no keywords (or as documented by the MCP for recommended feed). Increments `mcp_calls_used`.
- Parse returned JSON. Apply DEDUP GATE to the title list. Known roles → skipped table, no further calls.
- For each NEW role, call `mcp__linkedin-community__get_job_details(job_id)` to fetch full JD + applicant count. Each call increments budget.
- Hard safety cap: 200 roles captured OR budget exhausted, whichever first.

If `LINKEDIN_MCP_OK=false`, use Chrome MCP (v4 A1 behavior) — scroll feed, dedup at list level, click only NEW roles.

---

### SOURCE A2 — LinkedIn Keyword Search (LinkedIn MCP preferred)

If `LINKEDIN_MCP_OK=true`:
- For each keyword from config (`LinkedIn Search Keywords`), call `mcp__linkedin-community__search_jobs(keyword, filters_from_config)`. Each search is 1 MCP call.
- First 30 results per search.
- Apply DEDUP GATE across A0/A1/A2 (no double-counting).
- For NEW roles: `get_job_details(job_id)` for JD + applicant count. Each call counts against budget.

If budget runs out mid-search: log remaining keywords in Verify Queue with reason "MCP budget exhausted."

If `LINKEDIN_MCP_OK=false`, use Chrome MCP (v4 A2 behavior).

---

### SOURCE A3 — 1st-Degree Connections at Company (LinkedIn MCP preferred)

For each NEW role (from A0, A1, A2 — after dedup, before noise filter):

If `LINKEDIN_MCP_OK=true` AND budget available:
- Call `mcp__linkedin-community__search_people(company=role.company, connection_degree=1)`. 1 MCP call per company (dedup companies — don't re-query for multiple roles at same co).
- Capture: name, title, LinkedIn URL.
- Feed results into WARM PATH TAGGING.

If `LINKEDIN_MCP_OK=false` OR budget exhausted: fall back to v9 behavior — read "X connections at this company" from the Chrome-rendered LinkedIn job page passively. Do NOT navigate to the People tab.

**Company-level cache:** Maintain `company_1st_degree_cache = {company → [people]}` for the run. Don't re-query the same company across multiple roles.

---

### PHASE 2b — 2nd-Degree Warm Paths (NEW in v10 — LinkedIn MCP required)

**Purpose:** Before the career-os-plugin ships WO-C (2nd-degree algorithm), surface warm paths inline in the scan. Interim implementation.

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

For every NEW role, check company name against the PEOPLE INDEX (built from `brain/network/people/`). The Warm Intros & Follow-Ups table no longer exists in job-pipeline.json (removed ADR-001 2026-04-06) — people files are the SSOT.

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
7. Save JDs to `brain/reference/jd-samples/{company}-{role-slug}.md`.
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

**NOISE FILTER — high-applicant cold roles:**
- IF `applicant_count ≥ 400 AND warm_path = Cold AND company NOT in tier-1 override` → SKIP with reason "high noise (400+ applicants, cold)."
- Tier-1 override (NEVER skip on noise alone): Anthropic, OpenAI, Google DeepMind, xAI, Meta AI, Mistral, Cohere, Scale AI, Databricks, Harvey, Vercel, Replit, Notion.
- Source A0 ALWAYS exempt from noise filter.
- Early-applicant bonus: applicant_count < 25 → tag `⭐ early`.
- **Phase 2b warm-path upgrade:** A role that was Cold but upgraded to 2nd-degree via Phase 2b is NO LONGER Cold for purposes of the noise filter. Reevaluate before skipping.

---

### RESUME TRACK (config-driven, skills-checked)

For every NEW role that passed dedup and the skills gate:

1. **Read** `Resume Tracks` from `brain/config/job-search.md`. Three tracks: Eng Leader / Exec / Innovator.
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

Save to: `brain/projects/job-search/scans/{SCAN_DATE}/scan-{SCAN_TIME}.md`

```markdown
# Job Scan — {SCAN_DATE} {SCAN_TIME}

## Search Mode: {from config}

**Candidate:** Anand Vallamsetla
**Scan type:** Automated daily scan (v11 — plugin path format)
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

### WRITE-BACK (after scan output saved)

For each NEW role (not dedup, not skipped):
1. Double-check against `brain/projects/job-search/job-pipeline.json` Active / Ready to Apply.
2. If NOT present: append a new "Ready to Apply" section with this exact format:

```markdown
## Ready to Apply (Scan {SCAN_DATE} {SCAN_TIME} — {N} roles, awaiting scoring)
| # | Company | Role | Location | Track | Warm Path | Notes | URL |
|---|---------|------|----------|-------|-----------|-------|-----|
| S1 | Anthropic | Engineering Manager, Inference ⭐⭐⭐ | San Francisco, CA (Hybrid) | Eng Leader | Nick (1st, Anthropic) | Scan {SCAN_DATE} — awaiting scoring; $425K–$560K; 481 apps (Tier-1 override); 2wk old | https://... |
```

Column rules:
- `#` — `S1`, `S2`, … (scan-relative, resets each section)
- `Company` — exact company name
- `Role` — exact role title; append ⭐ (early, <25 apps), ⭐⭐⭐ (Tier-1/highly relevant)
- `Location` — city + remote/hybrid/onsite
- `Track` — `Eng Leader`, `Exec`, or `Innovator` (+ ⚠️ gap note if applicable)
- `Warm Path` — contact name + degree + company; `Cold` if none
- `Notes` — `Scan {SCAN_DATE} — awaiting scoring` + comp range + applicant count + age + any flags (⚠️, ♻️ repost, ⭐ early, 🌐 2nd-degree warm + mutual name for Phase 2b upgrades, ⭐ Saved by Anand for A0)
- `URL` — direct ATS/LinkedIn job URL (not search/company URL)

3. Do NOT add scores. Do NOT modify existing entries. Do NOT touch Already Applied table.
4. Update the "Already Applied — Specific Roles ({N} total)" header count if your row count ≠ the stated N.

---

### RULES (non-negotiable)

- Bash date FIRST (Step 0). MCP probe second (Step 0.5). Config third. Pipeline fourth.
- BUILD DEDUP SET + PEOPLE INDEX before any network activity.
- APPLY DEDUP GATE before every click-into, MCP detail call, or WebFetch of individual JD.
- **MCP budget is hard:** 20 calls total; Phase 2b sub-cap 15. Budget exhaustion → Verify Queue, don't substitute Chrome.
- Do not score. Do not apply. Do not write narratives. One row per role. No descriptions.
- Do NOT use WebSearch.
- Noise filter at 400 applicants. A0 exempt. Phase 2b upgrades bypass cold-noise skip.
- LinkedIn state transition fallback chain for A0: In Progress → Archive → leave + log.
- No 20-role cap on Recommended feed — scroll/page until exhausted or 200-role safety cap.
- Phase 2b: 5 companies max, 15 MCP calls max within it, tier-1/tier-2 priority.
- Log exact MCP response shapes for `search_people` and `get_person_profile` the first time they're called this session — feeds career-os-plugin WO-A (schema probe).
