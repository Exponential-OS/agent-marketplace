<!-- schema: v1.0 -->
# Career OS Shared Structures Registry

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

### `brain/job-pipeline-match-tracker.md`

- **Version:** v2.0
- **Format:** 10-column markdown table, one per scoring batch
  ```
  | # | Company | Role | Score | Quality | Decision | Resume Track | Warm Path | JD Link | Outcome |
  ```
  v1.0 was 9 columns without Quality. Quality was inserted at index 4 between
  Score and Decision.
- **Sole writer:** `skills/job-match-scorer/SKILL.md`
- **Consumers (readers):**
  - `scripts/pipeline-query.py` — `parse_standardized_summary`, `is_standardized_header`
  - `skills/apply-dashboard/SKILL.md`
  - `skills/pipeline-sync/SKILL.md`
  - `skills/cruise-control/SKILL.md`
- **Coherence test:** `tests/test-hooks.sh` [C1] — parses a 10-col fixture
  row and asserts specific field values (Decision, Resume, Warm Path, JD URL).
  This test would have caught WO-048 before it shipped.
- **Incident history:** v1.0 → v2.0 drift caused WO-048 (parser read shifted
  cells, returned Decision=UNKNOWN on all lookups).

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

### `brain/job-pipeline.md`

- **Version:** v1.0
- **Format:** Markdown with sections for Active / Warm Intros / Archived.
  Writers track applied/status/date per entry.
- **Sole writer:** `skills/apply-tracker/SKILL.md`
- **Consumers (readers):**
  - `skills/mission-control/SKILL.md`
  - `skills/apply-dashboard/SKILL.md`
  - `skills/pipeline-sync/SKILL.md`
  - `skills/cruise-control/SKILL.md`
  - `skills/job-match-scorer/SKILL.md`
  - `scripts/pipeline-query.py`
- **Coherence test:** _(pending — add in next iteration)_
- **Incident history:** None yet. Stable format since v0.3.0.

### `brain/people/` directory layout

- **Version:** v1.0 (flat)
- **Format:** `brain/people/<name>.md` — YAML frontmatter
  (name, company, role, relationship, warmth, connection_strength, channel,
  last_contact, referral_status, context) + markdown body. Flat layout only —
  no subdirectories.
- **Sole writer:** `skills/network-intelligence/SKILL.md`
- **Consumers (readers):**
  - `skills/outreach-composer/SKILL.md`
  - `skills/mission-control/SKILL.md`
  - `skills/apply-tracker/SKILL.md`
  - `skills/interview-prep/SKILL.md`
  - `skills/pipeline-sync/SKILL.md`
- **Coherence test:** _(pending)_
- **Incident history:** None.

### `brain/tasks/Tasks.md`

- **Version:** v1.0 (typed work items — per WO-026)
- **Format:** Typed work items with priority (P0–P3), severity, value,
  blocked_on, done_when fields. One item per block.
- **Sole writers:** `skills/apply-tracker/SKILL.md`, `skills/pipeline-sync/SKILL.md`, `skills/cruise-control/SKILL.md`
- **Consumers (readers):**
  - `skills/mission-control/SKILL.md`
  - all three writers (read-then-append)
- **Coherence test:** _(pending)_
- **Incident history:** None since typed format landed.

### `brain/skills-matrix.md`

- **Version:** v1.0
- **Format:** Markdown table with proficiency scale and learnability flags.
- **Sole writer:** `skills/skills-update/SKILL.md`
- **Consumers (readers):**
  - `skills/job-match-scorer/SKILL.md`
  - `skills/resume-engine/SKILL.md`
  - `skills/interview-prep/SKILL.md`
  - `skills/application-qa/SKILL.md`
  - `skills/mission-control/SKILL.md`
- **Coherence test:** _(pending)_
- **Incident history:** None.

### `brain/interview-prep/` directory layout

- **Version:** v1.0 (prep-{slug}.md convention, per WO-054)
- **Format:** Flat directory. Three filename prefixes:
  ```
  brain/interview-prep/
  ├── prep-<slug>.md          # round prep docs (canonical)
  ├── intel-<slug>.md         # insider-intel notes (role context, interviewer background)
  └── _archive/
      └── prep-<slug>-ARCHIVED.md  # retired prep docs
  ```
  `<slug>` is the lowercased company name (hyphen-separated) with optional
  role/stage suffix when disambiguation is needed
  (e.g. `prep-amazon-aws-core-networking.md`, `prep-scale-ai-mihir.md`).
- **Sole writer (canonical path):** `skills/interview-prep/SKILL.md` — writes
  to `prep-{slug}.md` only. Does NOT write `intel-*.md` (manual/user-initiated
  class).
- **Consumers (readers):**
  - `skills/interview-prep/SKILL.md` (legacy-read tolerant — accepts any
    `*.md` match; prefers `prep-*.md`; ignores `_archive/` unless asked)
  - `skills/mission-control/SKILL.md` (prep availability check)
  - `skills/cruise-control/SKILL.md` (round-prep orchestration)
- **Coherence test:** `tests/test-hooks.sh` [B-interview-prep-convention]
  — asserts every non-archived file in `brain/interview-prep/` matches
  `prep-*.md` or `intel-*.md` after migration.
- **Incident history:** v0.0 → v1.0 drift surfaced 2026-04-23 when cleanup
  of loose WIP-root prep files exposed a gap between SKILL.md's canonical
  `prep-{company}.md` spec and on-disk legacy `{company}-*-prep.md` files
  (created manually before the skill existed). Normalized via
  `migrations/v0.18.1-to-v0.19.0.sh` (WO-054).

### `brain/pipeline-snapshots/` directory

- **Version:** v0.0 (scaffold only, not yet consumed — reserved per WO-054)
- **Format:** TBD. Intended for human-readable pipeline status captures
  separate from the live `job-pipeline.md` (periodic snapshots, handoff
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
