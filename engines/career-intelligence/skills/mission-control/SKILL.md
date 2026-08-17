---
name: mission-control
description: >
  Career Intelligence home screen and central router. Two jobs: show the dashboard and
  route every action to the correct skill. Mission Control reads and presents
  but never directly edits persistence files.
triggers:
  - mission control
  - mc
  - reboot
  - what's my mission
  - career pulse
  - launch sequence
  - what's my day look like
  - career status
  - what should I do today
  - home screen
  - dashboard
  - beta metrics
  - funnel
  - nsm
  - local telemetry
---

# Mission Control — Career Intelligence Home Screen & Router

## Task Substrate (v0.25.0+)

> `$CAREER_GITHUB_REPO` is derived from: `git -C $CAREER_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents): `gh issue list --repo $CAREER_GITHUB_REPO --state open --json number,title,labels,body`
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

Mission Control is read-only on tasks (priority dashboard rendering only). Skills that own writes (apply-tracker, cruise-control, pipeline-sync) call `gh issue create` / `gh issue edit` directly.

## Purpose

Career Intelligence's central nervous system. Two jobs: **show the dashboard** and
**route every action to the correct skill**. Mission Control never directly
edits persistence files — it reads, presents, and dispatches.

## Output Format

Always start with:
```
━━━ Career Intelligence: Mission Control ━━━
```

---

## CORE PRINCIPLE: Skill Routing Is Mandatory

Mission Control is the **dispatcher**. Every user action that mutates data
MUST be routed to the skill that owns those files. This is the single most
important rule in Career Intelligence.

### Routing Table (NON-NEGOTIABLE)

When the user's intent matches a row below, invoke that skill. **Never**
perform the action yourself by directly editing files.

| User Intent | Route To | Trigger Examples |
|------------|----------|-----------------|
| Search/scan for jobs | `job-search-scheduler` | "scan for jobs", "find roles", "job search", "any new roles" |
| Enrich warm paths on scan results | `job-search-scheduler` | "enrich warm paths", "warm paths", "find connections", "check my network", "find referrals", "network scan" |
| Score/evaluate roles | `job-match-scorer` | "score these", "match score", "rate this role", "score the latest scan" |
| Rescore title-only roles | `job-match-scorer` | "rescore queue", "rescore JD-fetched", "rescore title-only" |
| Customize resume | `resume-engine` | "customize resume for [Co]", "resume for [Co]" |
| Write cover letter | `cover-letter` | "cover letter for [Co]", "write a cover letter for [Co]" |
| Answer portal questions | `application-qa` | "answer questions for [Co]", "portal questions" |
| Record application or status change | `apply-tracker` | "I applied to [Co]", "got rejected from", "heard back" |
| View active pipeline (interviews, referrals, stage detail) | `pipeline-view` | "pipeline", "show pipeline", "referrals", "who's advancing", "apply queue", "pipeline summary" |
| View apply-ready pipeline (scored, not yet applied) | `apply-dashboard` | "dashboard", "show apply queue", "what should I apply to" |
| Interview prep or mock | `interview-prep` | "prep me for [Co]", "mock interview" |
| Save a career story | `story-capture` | "save this story", "capture this", "I want to remember" |
| Find warm contacts | `network-intelligence` | "who do I know at [Co]", "warm intros for" |
| Write outreach message | `outreach-composer` | "write outreach for [Name]", "follow up with" |
| Sync/reconcile pipeline | `pipeline-sync` | "sync pipeline", "data health check" |
| Score LinkedIn profile against brand voice | `profile-brand-alignment` | "profile brand alignment", "profile coherence", "brand voice fit" |
| View local beta funnel / NSM metrics | `mission-control` present-only via `src/telemetry/report.ts` | "beta metrics", "funnel", "nsm", "local telemetry" |
| Batch-execute tasks | `cruise-control` | "cc", "go", "ship it", "execute" |
| Update skills matrix | `skills-update` | "update my skills", "I learned [tech]" |
| Organize/index stories | `organize` | "organize", "index stories" |
| Git backup | `version-control` | "backup", "push to github" |
| Search past sessions | `session-logger` | "what did we discuss", "replay", "session history" |

### What Mission Control Does NOT Do

- Never directly edit `job-pipeline.json` or `job-pipeline-match-tracker.json` — route to apply-tracker or pipeline-sync
- Never create/edit task issues directly — that's apply-tracker, cruise-control, or pipeline-sync (via `gh issue` against `$CAREER_GITHUB_REPO`)
- Never edit `job-pipeline-match-tracker.json` — that's job-match-scorer
- Never edit story files — that's story-capture or organize
- Never edit people files — that's network-intelligence
- Never edit `skills-matrix.md` — that's skills-update
- Never generate resumes — that's resume-engine
- Never generate cover letters — that's cover-letter
- Never write outreach messages — that's outreach-composer
- Never score roles — that's job-match-scorer

### Implicit Routing (Detect Intent, Don't Ask)

When the user says something that maps to a skill, **invoke the skill
immediately** (P11 — default to action). Don't say "Would you like me
to use the resume-engine skill?" — just use it.

| Pattern | Route To |
|---------|----------|
| "X rejected me" / "didn't get X" | apply-tracker (reject) |
| "Got an interview at X" / "screening with X" | apply-tracker (advance) |
| "Applied to X" / "just submitted X" | apply-tracker (applied) |
| "Met [person] at [event]" | network-intelligence (ingest) |
| "Let me tell you about [project]" | story-capture |
| "[Person] said they'd refer me" | apply-tracker + network-intelligence |
| "Got an offer from X" | apply-tracker (offer) |
| "ran the scan, now find who I know" | job-search-scheduler (enrich mode) |
| "any warm paths in today's scan?" | job-search-scheduler (enrich mode) |
| "check linkedin for connections" | job-search-scheduler (enrich mode) |
| "find intros" / "find 2nd degree" | job-search-scheduler (enrich mode) |

### Routing Disambiguation: job-search-scheduler vs network-intelligence

These two skills overlap on warm-path detection. The routing rule:

| Signal | Route To | Why |
|--------|----------|-----|
| Company name present ("warm paths for Anthropic") | network-intelligence | Single-company deep analysis |
| No company name ("warm paths", "find connections") | job-search-scheduler (enrich) | Batch enrichment on latest scan |
| "who do I know at [Co]" | network-intelligence | Explicit company = single |

**Rule:** Company name → network-intelligence. No company → job-search-scheduler enrich mode.

---

## BEHAVIOR: First Run (No Onboarding Complete)

**Detection:** Check the onboarding marker:
- Career intelligence: `brain/identity/experience-history.md` does NOT exist

If the file does not exist, show the welcome and route to the onboarding wizard:

```
━━━ Career Intelligence: Mission Control ━━━

Welcome to Career Intelligence. I'm your career co-pilot with persistent memory.

Before I can help, I need to learn a bit about you. This takes ~5 minutes
and only happens once. Everything you share stays private on your machine.

Say "onboard me to career intelligence" to begin, or describe your job-search goal.
```

**If onboarding is missing:**
Invoke `career-intelligence-onboarding` immediately. Do not ask questions yourself — the onboarding wizard owns the interview.

**Git setup:** After any onboarding completes, prompt:
```
Your context is saved. Want to back it up to GitHub?
Say "backup" to set up git + GitHub remote — takes 2 minutes and protects everything.
```

---

## BEHAVIOR: Pending Skill Prompts

Before rendering the dashboard, check for pending skill flags:

- If `~/.career-os-state/pending-organize` exists:
  ```
  ━━━ Career Intelligence: New Feature Available ━━━

  The organize skill can index your stories — adding frontmatter,
  cross-references, and a searchable story index.

  Say "organize" to run it now, or dismiss to skip.
  ```

---

## BEHAVIOR: Returning User (Dashboard)

When `brain/identity/experience-history.md` exists, show the dashboard.

### Direct Local Metrics View (XOS-133)

**Triggers:** "beta metrics", "funnel", "nsm", "local telemetry"

Render the local XOS-98 telemetry dashboard by invoking the deterministic
aggregator:

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/telemetry/report.ts"
```

The aggregator reads the local events JSONL path resolved by `defaultEventsPath`
(`CAREER_OS_EVENTS_LOG` → `XOS_EVENTS_LOG` → `~/.career-os-events.jsonl`), skips
malformed rows, and prints the funnel, NSM, cohort, and recent-activity view.
Mission Control must not parse the JSONL or compute conversion, drop-off, cohort,
or NSM values itself. Treat the rendered NSM as an ESTIMATE because active time is
bucketed.

### Pre-Dashboard Checks (silent)

1. Read `NEXT_SESSION_HANDOFF.md` for previous session context
2. Check `git log --oneline -5` for `(handoff updated externally)` — if found,
   read current handoff for another agent's updates
3. Check story index health (exists? stale vs newest story?)
4. Read open task issues (`gh issue list --repo $CAREER_GITHUB_REPO --state open --json number,title,labels`) and `job-pipeline.json` + `job-pipeline-match-tracker.json` for dashboard data
5. **For every named contact in the Warm Contacts section:** apply the Contact Action Pre-Flight protocol (see below) before rendering any action suggestion for that contact.
6. Read the weekly content-attributed inbound summary from the local telemetry JSONL (XOS-89). If attributed inbound DMs exist and this week's card has not already been viewed, render the weekly insight card in the dashboard header area.
7. Read the latest local `profile_change_logged` event, if any. Summarize the 30d before/after inbound impact (XOS-94) and render a single plain-text profile-impact line in the dashboard header area.
8. Render the unified career + brand health dashboard (XOS-90). After computing whether each side has data, emit `emitDashboardViewed({ has_career_data, has_brand_data })` through the existing XOS-98 gated local JSONL telemetry path.

### Stale Pipeline Detection

For each entry in `job-pipeline.json` → `stage_data[]`, compute time-in-stage and flag:

| Stage | Stale After | Action |
|-------|-------------|--------|
| Applied, awaiting | 14 days | Flag + draft follow-up (route to outreach-composer) |
| Advancing (screen+) | 10 days since last activity | Flag + suggest ping recruiter |
| References in progress | 7 days | Flag |
| Ready to apply | 7 days | Flag + prompt to submit or drop |

If `brain/config/pipeline-health.json` exists, use its thresholds.

**Self-evolution (P14, EXP-002):** Track outcomes for threshold calibration.
After 10 outcomes → first calibration (±1 day/cycle). Log to
`brain/experiments/EXP-002-log.md`.

### Dashboard Layout

```
━━━ Career Intelligence — [Day], [Date] ━━━

⚠️ STALE ALERTS (only if any)
  - {Company} ({Stage}, {N}d) — {action}

TODAY'S PRIORITIES
  🔴 P0: [Description]  → "[prompt]"
  🔴 P0: [Description]  → "[prompt]"
  🟡 P1: [Description]  → "[prompt]"
  ⏳ Blocked ({N}): [summary]

PIPELINE
  ● Company    Stage ━━━━━━          METRICS
  ● Company    Stage ━━━━            Applications: N
  ● Company    Stage ━━              Response rate: N%
                                     Interviews: N
                                     Active contacts: N

LOCAL BETA METRICS
  [Render compact output from `bun "$CLAUDE_PLUGIN_ROOT/src/telemetry/report.ts"`]
  NSM line must retain the ESTIMATE label from the aggregator.

WARM CONTACTS — ACTION NEEDED (only if any due)
  | Contact | Company | Status | Next Action |

COMING UP
  [Date] — [Event/deadline]

CAREER BRAIN
  🟢 Stories: N  🟢/🔴 People: N  🟢/🟡 Index: status

QUICK ACTIONS
  ━━ Status ━━
  → "pipeline"                   Active: interviews, referrals, apply queue
  → "referrals"                  Referral status + overdue alerts
  → "dashboard"                  Scored roles ready to apply (≥80%)
  → "beta metrics"               Local funnel, estimated NSM, cohorts

  ━━ Search & Score ━━
  → "scan for jobs"              Find new roles with warm-path detection
  → "score the latest scan"      Score new roles (Opus)

  ━━ Apply ━━
  → "customize resume for [Co]"  Tailor resume
  → "cover letter for [Co]"      Generate cover letter
  → "answer questions for #N"    Portal question answers
  → "I applied to [Co]"          Record application

  ━━ Track ━━
  → "heard back from [Co]"       Process a response
  → "sync pipeline"              Reconcile all files

  ━━ Prep & Network ━━
  → "prep me for [Co]"           Interview prep
  → "follow up with [Name]"      Time-calibrated follow-up
  → "who do I know at [Co]"      Find warm intros

  ━━ Execute ━━
  → "cc" / "cruise control"      Batch-execute task list
  → "mission control"            Refresh dashboard
```

### Data Sources

| Section | Source | Read Pattern |
|---------|--------|-------------|
| Priorities | GitHub Issues `$CAREER_GITHUB_REPO` | `gh issue list --state open` filtered by `tier:p1`/`tier:p2`, sort by tier ascending |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` → `stage_data[]` | Active/advancing entries |
| Metrics | `career-intelligence/projects/job-search/job-pipeline-match-tracker.json` | Count by `status` field (APPLIED, REJECTED, INTERVIEWING, OFFERED) |
| Warm Contacts | `people/*.json` + `people-followup-query.py` | Run: `python3 ~/.career-os-state/scripts/people-followup-query.py --people-dir $CAREER_HOME/network/people --days 7 --format json` — returns contacts with follow_up ≤ today+7d. Falls back to `.md` frontmatter for unmigrated files. NEVER hand-scan people files. |
| Company Action Gate | `company-flags.json` + `company-flags-filter/HOW.py` | Before surfacing ANY action for a named company, run: `python3 $(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/company-flags-filter/HOW.py 2>/dev/null \| tail -1) '{"company":"<name>","action":"<apply\|follow_up\|referral>","flags_file":"$CAREER_HOME/career-intelligence/projects/job-search/company-flags.json"}'` — exit 1=BLOCK (suppress), exit 2=WARN (surface referral status instead). A 92% score on a deprioritized company must never surface as an action. Gate FAIL-HARDs (BLOCK) if flags_file path is given but the file is missing (XOS-27) — never silent-pass on absent safety config. |
| Coming Up | GitHub Issues + `job-pipeline.json` → `pending_referrals[].follow_up_date` | Extract due dates from issue body / `due:*` labels + referral follow-up dates |
| Career Brain | `stories/**/*.md` (recursive), `people/*.json` | Count `.md` files recursively under `stories/` (stories are organized into category subdirs like `stories/google/`, `stories/independent/`). Exclude `STORY_INDEX.md` and `README.md`. For `people/`, count `*.json` files (migrated as of v0.37.0); fall back to `*.md` count if no JSON found. |
| Stale Alerts | `job-pipeline.json` → `stage_data[]` | Compute days-in-stage from `stage_detail` date or tracker `updated_at` |
| Local Beta Metrics | `src/telemetry/report.ts` reading the local events JSONL | Run `bun "$CLAUDE_PLUGIN_ROOT/src/telemetry/report.ts"` and render the output; do not duplicate math in this skill |
| Profile Impact | Local telemetry JSONL | Latest `profile_change_logged` event + `src/telemetry/profile-inbound-impact.ts` summary over `content_to_dm_tracked` events |

**Story count command (authoritative):**
```bash
find -H brain/stories -type f -name "*.md" \
  -not -name "STORY_INDEX.md" -not -name "README.md" 2>/dev/null | wc -l
```
Note: `-H` is required because `brain/stories/` may be a symlink to `$CAREER_HOME/brain/stories/` after the Brain-layer migration. Without `-H`, macOS `find` returns 0 results on a symlinked start directory.
Do NOT use `ls brain/stories/*.md` — it misses subdirectory contents
and will undercount when stories are organized into categories (P9 coherence
issue fixed by WO-049).

### Story Index Health Check

| Condition | Action |
|-----------|--------|
| stories/ has .md files (recursive) AND no STORY_INDEX.md | Suggest "organize" |
| STORY_INDEX.md exists but older than newest story (recursive) | Suggest "organize" (incremental) |
| STORY_INDEX.md exists and current | Show memory health counts |
| stories/ empty (recursive) or doesn't exist | Skip memory health section |

*"Recursive" means: apply the same find command as the Story count command above — include all subdirectories, exclude STORY_INDEX.md and README.md.*

### Scan Status Line

Include in dashboard header area:

```
SCAN STATUS
  ✅ 15 roles found, 6 warm paths, 3 second-degree intros (enriched)
  or
  ✅ 15 roles found (6 AM safety net) — say "enrich warm paths" for referral detection
  or
  ⚠️ No scan today — say "scan for jobs"
```

### Weekly insight — content → inbound (XOS-89)

Mission Control makes the brand → career flywheel visible once per week using
the same local attribution events surfaced by Pipeline View (XOS-102).

Read the local telemetry log via the shared weekly summary helper
`src/telemetry/weekly-inbound.ts`, which aggregates `content_to_dm_tracked`
events from `$CAREER_OS_EVENTS_LOG` / `$XOS_EVENTS_LOG`, defaulting to
`~/.career-os-events.jsonl`. One `content_to_dm_tracked` event equals one
attributed inbound recruiter DM.

Behavior:
- Compute `week_of` as the Monday date for the current week, formatted
  `YYYY-MM-DD`.
- If the weekly summary total is `0`, omit the card.
- If an `insight_card_viewed` event already exists for
  `insight_kind: "weekly_inbound"` and this `week_of`, omit the card.
- When the card renders, emit:
  `emitInsightCardViewed({ insight_kind: "weekly_inbound", week_of })`.
- When the user acts on the card, emit:
  `emitInsightActedOn({ insight_kind: "weekly_inbound", action, week_of })`.
- These helpers use the existing XOS-98 gated local JSONL emitter. They add no
  transport and make no outbound calls.

Plain-text card:

```
━━━ Weekly Insight ━━━
📈 This week: {N} recruiter DMs attributed to your posts
Top posts:
- {post_id}: {count} DMs

→ "campaign engine"          Turn the top post into your next content campaign
→ "post more on {topic}"      Double down on the topic that drove inbound
```

If only one top post exists, show one bullet. If several posts tie, show up to
three. Keep the output plain-text-friendly: no markdown tables, no pipe
characters, no nested cards.

Action telemetry:
- Opening or routing to the campaign engine:
  `action: "open_campaign_engine"`
- Posting more on the flagged topic:
  `action: "post_more_on_topic"`

### Profile impact — profile change → inbound (XOS-94)

Mission Control closes the feedback loop on profile optimization by tying a
logged profile change to inbound recruiter DM volume over the surrounding 30d
windows.

When the user says they updated or rewrote a profile section, log the change
with the local telemetry helper:

```ts
emitProfileChangeLogged({ section, note })
```

Use `section: "headline"`, `"summary"`, or `"experience"` when known. Keep
`note` short and optional, such as `"operator-led headline rewrite"`. The helper
uses the existing XOS-98 gated local JSONL emitter. It adds no transport and
makes no outbound calls.

To surface impact, read the latest `profile_change_logged` event from the local
telemetry log, then call `summarizeProfileChangeImpact(change.ts)` from
`src/telemetry/profile-inbound-impact.ts`. The helper counts
`content_to_dm_tracked` events in the 30 days before the change and the 30 days
after the change, then returns `inboundRateChange = afterCount - beforeCount`.

Plain-text line:

```
Profile impact: inbound-rate-change {+/-N} recruiter DMs after your {section} change
30d before: {beforeCount} DMs
30d after: {afterCount} DMs
```

Omit this line when there is no logged profile change. If the after window is
still in progress, show the count accumulated so far. Keep this as text in the
dashboard header area; do not add a nested card or table.

### Unified career + brand health dashboard (XOS-90)

Mission Control must make the career + brand fusion loop visible in one
6-second scan. Show both halves every time the returning-user dashboard renders:
career execution on one side, brand/inbound compounding on the other. If one
side has no data, keep the side visible and show a gentle no-data line instead
of omitting it.

Career data:
- Read `career-intelligence/projects/job-search/job-pipeline.json` using the
  existing Pipeline data-source pattern: `stage_data[]`.
- `has_career_data` is true when `stage_data[]` has at least one entry.
- Active applications: count non-terminal pipeline entries from `stage_data[]`
  (exclude terminal states: rejected, dropped, archived, closed, dead, deprioritized).
- Interviews: count `stage_data[]` entries whose stage/status/stage detail is
  screening, recruiter screen, hiring manager screen, technical screen, onsite,
  interview, references, or offer-process.
- Warm intros available: use existing Mission Control read paths only:
  `pending_referrals[]` from `job-pipeline.json` plus the existing
  `people-followup-query.py --people-dir $CAREER_HOME/network/people --days 7 --format json`
  pattern. Never hand-scan people files for this count.

Brand/inbound data:
- Weekly inbound DMs attributed to posts: call
  `summarizeWeeklyContentInbound` from `src/telemetry/weekly-inbound.ts`.
- Recent profile-change impact: when a latest local `profile_change_logged`
  event exists, call `summarizeProfileChangeImpact(change.ts)` from
  `src/telemetry/profile-inbound-impact.ts`.
- Post -> DM attribution count: count local `content_to_dm_tracked` records in
  the same telemetry JSONL used by the existing helpers. Do not recompute weekly
  groupings; the weekly count and top posts come from
  `summarizeWeeklyContentInbound`.
- `has_brand_data` is true when at least one `content_to_dm_tracked` event
  exists.

Telemetry:
- On every successful returning-user dashboard render, emit:
  `emitDashboardViewed({ has_career_data, has_brand_data })`.
- The helper writes only through the existing XOS-98 gated local JSONL emitter.
  It does not add transport, PostHog, fetch, HTTP, or any network call.

Plain-text dashboard block:

```
━━━ Career + Brand Health ━━━

CAREER
  Active applications: {active_applications}
  Interviews: {interviews}
  Warm intros available: {warm_intros_available}
  Status: {if no career data, "no data yet - add an application or referral"}

BRAND / INBOUND
  Weekly inbound DMs from posts: {weekly_inbound_total}
  Post -> DM attributions: {post_dm_attribution_count}
  Profile impact: {+/-N} DMs after {section} change
  Status: {if no brand data, "no data yet - track a post-attributed inbound DM"}
```

Rendering rules:
- Keep the output plain-text-friendly: no markdown tables, no pipe characters,
  no nested cards.
- Use short labeled lines over prose. This is the P10 visual-first view of the
  NSM: the user should see compounding wins across applications, interviews,
  warm intros, posts, and inbound in one glance.
- If there is no recent profile change, show
  `Profile impact: no recent profile change logged` rather than omitting the
  line.

### Post-Dashboard: Career Brain Enrichment (optional)

After dashboard renders, check these in priority order and offer ONE prompt:

**Priority order:**
1. Today's scan exists but NOT enriched → "Today's scan found {N} new roles but warm paths haven't been enriched yet. Say 'enrich warm paths' to find referrals via LinkedIn."
2. Stories < 3 (recursive count, per Story count command in Data Sources) → "Want to tell me about a project?"
3. Pipeline empty → "Are you interviewing anywhere?"
4. People = 0 → "Who are 2-3 people who could help?"
5. No STORY_INDEX → "Say 'organize' to index your stories"
6. No structural gaps → dynamic depth question from existing data

```
🟡 [One question with brief WHY]                    (skip to dismiss)
```

If user answers → route to appropriate skill → ask next → repeat until
user says skip/q/done or changes topic.

---

## BEHAVIOR: Session Continuity

1. **Read previous handoff:** `NEXT_SESSION_HANDOFF.md` — the previous
   session's narrative (what happened, what's in-flight, decisions made)
2. **Check for concurrent agent activity:** `git log --oneline -5` for
   `(handoff updated externally)` tag — if found, read current handoff
3. **Show dashboard** (reads all current state)
4. **Write YOUR handoff:** Overwrite `NEXT_SESSION_HANDOFF.md` with this
   session's narrative. Update continuously throughout the session.

---

## BEHAVIOR: Version Upgrade (P12 + P13)

When `~/.career-os-state/version` does NOT match plugin version:

1. Run migration chain (each script is idempotent)
2. Show what changed (new features, breaking changes)
3. Ask for retrospective feedback
4. Save to `brain/stories/retro-v{new-version}.md`
5. Proceed to normal dashboard

---

## BEHAVIOR: First Install Retrospective (P13)

On FIRST session after plugin install (no version file yet):

After onboarding completes:
```
You're all set up! How was the install experience?
Any steps that were confusing or could be smoother?
```

Save to `brain/stories/retro-v{version}-first-install.md`.
Set initial version in `~/.career-os-state/version`.

---

## PROTOCOL: Contact Action Pre-Flight (MANDATORY)

**Origin:** 2026-05-05 gate failure — Mission Control suggested "verify IC title with Paul" without reading paul-hessey.md, where the interaction log showed this had already been confirmed via email 2026-05-04. The action was already done; the suggestion created false noise and eroded trust.

**Rule:** Before surfacing ANY action suggestion for a named contact — follow-up, ping, verify, outreach, intro request, thank-you, or any other contact-directed action — Mission Control MUST read the contact's people file first.

### Step 1 — Structural Read Gate (BLOCK if skipped)

For each named contact about to appear in any action suggestion:

```
people_file = network/people/<slug>.md
```

If the file does not exist: emit `⚠️ No people file for {Name} — action suggestion suppressed. Say "add {Name} to network" to create one.` Do NOT suggest the action.

If the file exists: read it completely before proceeding to step 2.

### Step 2 — Interaction Log Check (semantic)

Read the `# Interaction Log` section of the people file. For the proposed action, ask:

> "Is there evidence in the interaction log that this action was already taken, or that the information it would surface is already known?"

| Log evidence | Verdict |
|---|---|
| Exact same action appears in log (e.g., "Citizenship confirmed") | SUPPRESS — do not suggest; it is already done |
| Related action appears (e.g., email response received after proposed follow-up) | SUPPRESS or DOWNGRADE — check if the follow-up is still relevant |
| No log entry at all for this action | ALLOW — safe to suggest |

### Step 3 — Staleness Check

Read `last_contact:` from the frontmatter.

- `last_contact` within **7 days**: contact is warm. Suggest actions conservatively — don't pile on.
- `last_contact` between **7–14 days**: note the gap inline: `(last contact {N}d ago)`.
- `last_contact` > **14 days** or missing: flag as stale before suggesting action.

### Output Format

When a contact action passes all three steps, surface it as:

```
WARM CONTACTS — ACTION NEEDED
  {Name} ({Company}) — {action} · last contact {N}d ago
```

When suppressed by log check, emit nothing (silent suppression — the human doesn't need to know about actions that are already done).

**Litmus test:** "Did I read the full people file for {Name} before suggesting this action? Did I check the interaction log for evidence this is already done?" If either answer is no — gate failed.

---

## ANTI-PATTERNS (Mission Control Must Never)

- Never directly edit any `brain/` file — route to owning skill
- Never generate a resume without resume-engine (skips QA gates)
- Never update pipeline without apply-tracker (skips multi-file sync)
- Never score without job-match-scorer (skips decision engine)
- Never write outreach without outreach-composer (skips pre-flight checks)
- Never add a contact without network-intelligence (skips structured ingestion)
- Never ask "would you like me to use [skill]?" — just use it (P11, P13)
- Never present 800 lines of capability — show what's relevant NOW
