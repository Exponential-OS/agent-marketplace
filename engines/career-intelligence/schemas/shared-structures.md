<!-- schema: v3.0 -->
# Career Intelligence Shared Structures Registry

**Per ADR-002 (Schema Evolution Protocol).** Single source of truth for which
data structures are "shared" (read by more than one skill, script, or hook),
what schema version each is on, and who consumes it.

When a shared structure changes format:

1. **Bump the version** in this file.
2. **Run the blast-radius grep** against the Consumers list — every consumer
   must be updated in the same commit.
3. **Update or add the coherence test** in `tests/test-hooks.sh` so it asserts
   on specific field values under the new schema (not just "it didn't crash").
4. **Run the test suite** — green gates the commit.
5. **Cross-link** in an ADR if the change affects mental model.

A shared structure without a coherence test is tech debt. The goal is one
value-asserting test per structure, minimum.

---

## Registry

### `career-intelligence/projects/job-search/job-pipeline-match-tracker.json`

- **Version:** v3.0 (JSON flat array — XOS-26 canonical path)
- **Format:** JSON array of role objects. Each object carries:
  ```json
  {
    "id":            <integer>,
    "batch_date":    "<YYYY-MM-DD>",
    "batch_context": "<string>",
    "company":       "<string>",
    "role":          "<string>",
    "score":         <integer 0-100>,
    "score_quality": "JD" | "partial" | "title-only",
    "decision":      "FULL_INVEST" | "APPLY" | "CHECK_DELTA" | "SKIP",
    "resume_track":  "<string> | null",
    "warm_path":     "<string>",
    "jd_url":        "<url> | null",
    "status":        "QUEUED" | "APPLIED" | "INTERVIEWING" | "OFFERED" | "REJECTED" | "DEAD" | "SKIPPED",
    "updated_at":    "<YYYY-MM-DD>"
  }
  ```
  v1.0–v2.0 were 9/10-column markdown tables (retired). v3.0 is JSON only.
- **Writers (two):**
  - `skills/job-match-scorer/SKILL.md` — appends new role objects (creates rows; full scoring fields)
  - `skills/apply-tracker/SKILL.md` — updates `status` + `updated_at` on existing rows (lifecycle transitions after apply)
- **Consumers (readers):**
  - `scripts/pipeline-query.py` — `lookup_row`, `filter_rows`, `sort_rows` (JSON parse)
  - `scripts/validate-tracker-json.py` — schema validation
  - `scripts/pipeline-view.py` — combined pipeline + tracker view
  - `skills/apply-dashboard/SKILL.md` — invokes `pipeline-query.py --tracker-path`
  - `skills/pipeline-sync/SKILL.md` — source of truth for scoring history
  - `skills/mission-control/SKILL.md` — counts by `status` for dashboard metrics
  - `skills/application-qa/SKILL.md` — resolves role context via `pipeline-query.py --lookup`
  - `skills/skills-update/SKILL.md` — reads active pipeline roles for gap flagging
  - `skills/pipeline-view/SKILL.md` — reads all scored roles
  - `skills/cruise-control/SKILL.md` — scores and recommendations
- **Coherence test:** `tests/test-hooks.sh` [C1] — writes a JSON fixture at the
  canonical path, runs `pipeline-query.py --lookup 999 --format json`, and asserts
  specific field values (`decision`, `resume_track`, `warm_path`, `jd_url`).
- **Incident history:** v1.0 → v2.0 drift caused WO-048 (parser read shifted
  cells, returned Decision=UNKNOWN on all lookups). v2.0 → v3.0 (XOS-26): migrated
  from 10-col markdown table to JSON flat array; old path `.career-os/memory/` retired.

### `career-intelligence/projects/job-search/job-pipeline.json`

- **Version:** v1.0 (JSON — XOS-26 canonical path)
- **Format:** JSON object with top-level arrays:
  ```json
  {
    "stage_data": [
      {
        "company":      "<string>",
        "role":         "<string>",
        "stage":        "<string>",
        "recruiter":    "<string> | null",
        "hm":           "<string> | null",
        "comp":         "<string> | null",
        "next_action":  "<string> | null",
        "stage_detail": "<string> | null",
        "updated_at":   "<YYYY-MM-DD>"
      }
    ],
    "pending_referrals": [
      {
        "company":          "<string>",
        "contact":          "<string>",
        "follow_up_date":   "<YYYY-MM-DD>",
        "status":           "<string>"
      }
    ]
  }
  ```
  Legacy format was a markdown file with Active / Warm Intros / Archived sections
  (retired, replaced by JSON in XOS-26). Warm Intros table removed per ADR-001
  (2026-04-06); warm path data now lives in `network/people/*.json`.
- **Sole writer:** `skills/apply-tracker/SKILL.md` — updates `stage_data[]` entries
- **Consumers (readers):**
  - `scripts/pipeline-view.py` — combined pipeline + tracker view
  - `skills/apply-tracker/SKILL.md` (read-then-write)
  - `skills/story-capture/SKILL.md` — links companies to `related_companies`
  - `skills/job-search-scheduler/SKILL.md` — dedup against Already Applied
  - `skills/apply-dashboard/SKILL.md` — `stage_data` cross-reference
  - `skills/outreach-composer/SKILL.md` — company context, hiring manager, stage
  - `skills/interview-prep/SKILL.md` — stage, contacts, next steps
  - `skills/interviewer-research/SKILL.md` — stage/role context
  - `skills/resume-engine/SKILL.md` — role context, stage
  - `skills/job-match-scorer/SKILL.md` — avoids re-scoring already-applied roles
  - `skills/pipeline-sync/SKILL.md` — source of truth for stage detail
  - `skills/skills-update/SKILL.md` — companies to check for gap closure
  - `skills/mission-control/SKILL.md` — active/advancing entries, stale alerts
  - `skills/pipeline-view/SKILL.md` — full pipeline render
  - `skills/network-intelligence/SKILL.md` — target companies
  - `skills/cruise-control/SKILL.md` — role details for execution
- **Coherence test:** _(pending — add in next iteration)_
- **Incident history:** Markdown → JSON migration in XOS-26.

### `brain/stories/` directory layout

- **Version:** v2.0 (hierarchical)
- **Format:** `brain/stories/**/*.md` — stories organized into
  category subdirectories (e.g., `stories/google/`, `stories/independent/`,
  `stories/job-search/`). `STORY_INDEX.md` and `README.md` at the top level
  are metadata, not stories.
  ```
  stories/
  ├── STORY_INDEX.md   (metadata, excluded from counts)
  ├── README.md        (metadata, excluded from counts)
  ├── <category>/
  │   └── <story>.md
  └── <loose-top-level-story>.md  (legacy, still counted)
  ```
  v1.0 was flat — all stories directly under `stories/`. v2.0 allows arbitrary
  nesting. Consumers must count recursively.
- **Sole writers:** `skills/story-capture/SKILL.md` (create), `skills/organize/SKILL.md` (index)
- **Consumers (readers):**
  - `skills/session-logger/SKILL.md`
  - `skills/mission-control/SKILL.md` — story count for Career Brain section
  - `skills/interview-prep/SKILL.md`
  - `skills/job-match-scorer/SKILL.md`
  - `skills/resume-engine/SKILL.md`
  - `skills/outreach-composer/SKILL.md`
  - `skills/application-qa/SKILL.md`
- **Coherence test:** `tests/test-hooks.sh` [C2] — creates a hierarchical
  fixture with known file counts and asserts the recursive `find` command
  returns the correct total.
- **Incident history:** v1.0 → v2.0 drift caused WO-049 (mission-control
  reported 7 stories when actual was 38 across 9 subdirectories).

### `network/people/` directory layout

- **Version:** v2.0 (flat JSON — XOS-26 canonical path)
- **Format:** `network/people/<slug>.json` — flat directory, one JSON file per
  contact. Each file carries:
  ```json
  {
    "name":               "<string>",
    "companies":          ["<string>"],
    "role":               "<string>",
    "relationship":       "<string>",
    "warmth":             "<string>",
    "connection_strength":"<string>",
    "channel":            "<string>",
    "last_contact":       "<YYYY-MM-DD> | null",
    "referral_status":    "<string> | null",
    "their_expertise":    ["<string>"],
    "they_told_us":       {},
    "commitments_made":   {},
    "family_context":     {}
  }
  ```
  v1.0 was `brain/people/<name>.md` with YAML frontmatter + markdown body (retired).
  v2.0 is flat JSON at `network/people/` (bare kernel-relative path, 238+ files).
- **Writers (two):**
  - `skills/network-intelligence/SKILL.md` — contact ingestion + relationship/origin enrichment
  - `skills/outreach-composer/SKILL.md` — creates/updates a contact's `network/people/{slug}.json` on outreach (last_contact, follow_up, interaction log)
- **Consumers (readers):**
  - `scripts/people-followup-query.py`
  - `skills/apply-tracker/SKILL.md`
  - `skills/story-capture/SKILL.md`
  - `skills/job-search-scheduler/SKILL.md`
  - `skills/organize/SKILL.md`
  - `skills/interviewer-research/SKILL.md`
  - `skills/job-match-scorer/SKILL.md`
  - `skills/application-qa/SKILL.md`
  - `skills/mission-control/SKILL.md`
  - `skills/network-intelligence/SKILL.md` (read-then-write)
  - `skills/cruise-control/SKILL.md`
  - `skills/career-intelligence-onboarding/SKILL.md`
- **Coherence test:** _(pending)_
- **Incident history:** Markdown → JSON migration in XOS-26.

### `brain/tasks/Tasks.md`

- **Version:** v1.0 (typed work items — per WO-026)
- **Format:** Typed work items with priority (P0–P3), severity, value,
  blocked_on, done_when fields. One item per block.
- **Sole writers:** `skills/apply-tracker/SKILL.md`, `skills/pipeline-sync/SKILL.md`, `skills/cruise-control/SKILL.md`
- **Consumers (readers):**
  - `skills/mission-control/SKILL.md`
  - `skills/apply-tracker/SKILL.md`
  - `skills/job-search-scheduler/SKILL.md`
  - `skills/outreach-composer/SKILL.md`
  - `skills/pipeline-sync/SKILL.md`
  - `skills/network-intelligence/SKILL.md`
  - `skills/cruise-control/SKILL.md`
- **Coherence test:** _(pending)_
- **Incident history:** None since typed format landed.

### `brain/identity/skills-matrix.md`

- **Version:** v1.0
- **Format:** Markdown table with proficiency scale and learnability flags.
- **Sole writer:** `skills/skills-update/SKILL.md`
- **Consumers (readers):**
  - `skills/job-search-scheduler/SKILL.md` — technology gap detection
  - `skills/job-match-scorer/SKILL.md`
  - `skills/resume-engine/SKILL.md`
  - `skills/interview-prep/SKILL.md`
  - `skills/application-qa/SKILL.md`
  - `skills/mission-control/SKILL.md`
  - `skills/skills-update/SKILL.md` (read-then-write)
  - `skills/story-capture/SKILL.md`
  - `skills/outreach-composer/SKILL.md`
  - `skills/interviewer-research/SKILL.md`
  - `skills/pipeline-view/SKILL.md`
  - `skills/cruise-control/SKILL.md`
- **Coherence test:** _(pending)_
- **Incident history:** None.

### `career-intelligence/projects/interview-prep/` directory layout

- **Version:** v2.0 (engine-owned `prep-{company}.md` convention, per XOS-105)
- **Format:** Flat directory. Three filename prefixes:
  ```
  career-intelligence/projects/interview-prep/
  ├── prep-<company>.md       # round prep docs (canonical)
  ├── intel-<company>.md      # insider-intel notes (role context, interviewer background)
  └── _archive/
      └── prep-<company>-ARCHIVED.md  # retired prep docs
  ```
  `<company>` is the company token used by the prep skill, with optional
  role/stage suffix when disambiguation is needed.
- **Sole writer (canonical path):** `skills/interview-prep/SKILL.md` — writes
  to `career-intelligence/projects/interview-prep/prep-{company}.md` only.
  Does NOT write `intel-*.md` (manual/user-initiated class).
- **Consumers (readers):**
  - `skills/interview-prep/SKILL.md` (legacy-read tolerant — accepts any
    `*.md` match; prefers `prep-*.md`; ignores `_archive/` unless asked)
  - `skills/mission-control/SKILL.md` (prep availability check)
  - `skills/cruise-control/SKILL.md` (round-prep orchestration)
- **Coherence test:** `tests/test-hooks.sh` [B-interview-prep-convention]
  — legacy migration regression that asserts every non-archived prep file
  matches `prep-*.md` or `intel-*.md` after migration.
- **Incident history:** v0.0 → v1.0 drift surfaced 2026-04-23 when cleanup
  of loose WIP-root prep files exposed a gap between SKILL.md's canonical
  `prep-{company}.md` spec and on-disk legacy `{company}-*-prep.md` files
  (created manually before the skill existed). Normalized via
  `migrations/v0.18.1-to-v0.19.0.sh` (WO-054).

### `brain/pipeline-snapshots/` directory

- **Version:** v0.0 (scaffold only, not yet consumed — reserved per WO-054)
- **Format:** TBD. Intended for human-readable pipeline status captures
  separate from the live `job-pipeline.json` (periodic snapshots, handoff
  summaries, retro analysis).
- **Sole writer:** _(none yet — skill assignment pending)_
- **Consumers (readers):** _(none yet)_
- **Coherence test:** _(N/A until consumers added)_
- **Incident history:** Scaffolded in v0.19.0; format to be specified when
  first consumer lands.

---

## Not in scope

- `brain/sessions/ledger/*.md` — append-only session logs. No schema in the
  coherence sense — each entry is self-contained.
- `~/.career-os-state/` — error logs. Not read by skills.
- `brain/reference/jd-samples/*.pdf` — user-owned binary files.
- `brain/config/*.json` — configuration files with their own
  schemas, managed by individual skills. Consider a separate registry if
  config schemas start drifting.
- `NEXT_SESSION_HANDOFF.md` — free-form markdown with timestamped entries.
  Deliberately loose. If drift becomes an issue, move to v1.0 here.
- `brain/experiments/*.md` — P14 self-evolution logs, managed
  by the framework itself.

---

## Header Convention (WO-053)

Files in this registry carry a schema version header on line 1 of the file
(markdown comment):

```markdown
<!-- schema: v2.0 -->
```

Directory layouts carry a `.schema-version` file at the root of the layout:

```
brain/stories/.schema-version
  → contents: 2.0
```

Consumers that parse these files **should** read the header/version file and
compare against what they expect. A mismatch is a release-blocking error,
caught either by the coherence test at release time or by the consumer's own
defensive check at runtime.

WO-053 backfills these headers onto existing user-workspace structures via a
migration script.

---

## Blast-Radius Grep Procedure

When any structure above changes format, run the following before committing:

```bash
# tracker
grep -rl "job-pipeline-match-tracker.json" skills/ scripts/

# pipeline
grep -rl "job-pipeline.json" skills/ scripts/

# people
grep -rl "network/people" skills/ scripts/

# stories
grep -rl "stories/" skills/ scripts/

# skills-matrix
grep -rl "skills-matrix" skills/ scripts/

# interview-prep
grep -rl "interview-prep" skills/ scripts/
```

Every file returned must be reviewed and updated if its access pattern is
affected by the schema change. Update the Consumers list in this registry
to reflect reality after the sweep.
