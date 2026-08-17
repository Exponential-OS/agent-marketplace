<!-- product-vs-solution: example -->
<!-- this file contains project rules authored by the original developer. Personal references are provenance context, not runtime data. -->
# Career Intelligence Plugin — Project Rules

## What This Is

A Cowork plugin for Career Intelligence. Hooks in `hooks/`, skills in `skills/`, tests in `tests/`.

## Private Workspace (anand-career-os)

Specs, handoffs, and career data live in the private workspace — not this repo:

- **Product specs & PRDs:** `$CAREER_SPECS/`
- **Handoff:** `$CAREER_SPECS/NEXT_SESSION_HANDOFF.md`
- **Cross-agent relay:** `$CAREER_HOME/NEXT_SESSION_HANDOFF.md`
- **Pipeline & memory:** `$CAREER_HOME/brain/`
- **Routing manifest:** `$CAREER_HOME/workspace.manifest.yaml`

## Version

v0.25.0 — Task substrate cutover (2026-04-26). `brain/tasks/Tasks.md`
is DEPRECATED. Skills now read/write tasks via GitHub Issues at
`thewhyman/anand-career-os` (canonical single inbox for all Cyborg work).
Repo of work indicated by `repo:*` label, NOT by issue location. Cadence
indicated by `cadence:*` label (`operational` for high-frequency churn;
`strategic` for sprint-scale; `meta` for trackers). Tier indicated by
`tier:*` label (`p1`/`p2`/`p3`/`backlog`). Skills updated:
mission-control (read-only), apply-tracker (kind:waiting-on / prep /
offer-eval), cruise-control (executes tier:p1 → tier:p2),
pipeline-sync (Pipeline ↔ Tracker ↔ open issues), outreach-composer
(kind:follow-up nudges), job-search-scheduler (kind:scan-result),
network-intelligence (read-only). Read via `gh` CLI (universal) +
`github-mcp` MCP server (structured fallback). Migration script:
`migrations/v0.0.0-to-v1.0.0.sh` (version stamp + advisory; no
auto-migration of existing Tasks.md content).

Previous: v0.24.0 — Substrate rollback (2026-04-26). Dolt + Neo4j +
Redis substrate (v0.20.0 → v0.23.0) rolled back; brain layer is
file-only again (markdown + frontmatter + git). The Dolt SQL adapter
deprecated. biographical-claim-precheck wired into outreach-composer
+ resume-engine SKILL.md. co-dialectic mode toggle session-scoped +
codi demo preset. judge-panel API fallback gated to CLI-not-installed
only.

Previous: v0.23.0 — Indexed temporal queries (2026-04-25). Parallel `_dt DATE` columns
alongside existing VARCHAR date columns on 7 high-value query targets:
roles.batch_date / outcome_date · applications.applied_date / status_date ·
events.event_date · stories.story_date · people.last_contact. Each gets its
own index. New adapter API: `list_roles(batch_after=, batch_before=)`,
`list_recent_stories(since=)`, `list_people(last_contact_before=, _after=)`.
Strangler-fig migration — old VARCHAR columns stay, no breakage. 28/28 pytest
green. Audit-only columns (source_mtime, ingested_at, frontmatter-sourced
created_at/updated_at) stay VARCHAR by design (prose-tolerant). Item #6 (hooks
review) still deferred — Co-Dialectic Dolt-ledger integration paused per user
directive 2026-04-25 (privacy + coupling + xOS-kernel-migration-timing
concerns); Career-OS hooks unchanged.

Previous: v0.22.0 — Campaign-ready release (2026-04-25). 5 items shipped: `dev/ci-local.sh`
single-command runner, `docs/MEMORY-ACCESS.md` SSOT, `decision_tier` normalized
column + index (270 rows back-populated), healthcheck identifier hardening,
README Dolt setup + roadmap. 2 items deferred to v0.23.0: VARCHAR→DATETIME
timestamps (invasive), hooks review (Co-Dialectic coordination needed).
**Architectural specs added** for the 3-tier xOS / xHumanOS Career Module /
Anand-xHumanOS-incarnation refactor (in anand-career-os workspace WIP). Plugin
is campaign-ready: cruise-control / outreach / apply-tracker / interview-prep
all functional against Dolt. 25/25 pytest green.

Previous: v0.21.0 — Dolt-canonical cutover (2026-04-24, ADR-003 Phase 3): `.md`
fallback removed. Adapter raises `AdapterUnreachable` when the
`cyborg-brain-db` Docker container is down; no silent degradation. Driven
by a dual Ground-Zero-gated review (Codex + Gemini 3.1 Flash Lite) — 8
findings addressed, 3 minor deferred to v0.22.0. Migration script now
does per-batch `dolt_commit` with SHA in `migration_log` + reconcile pass
that deletes orphan rows. Write API (`upsert_role`, `upsert_application`,
`append_task`) now live. 22/22 pytest green. `scripts/pipeline-query.py`
rewritten as a 145-line adapter shim (was 732 lines of markdown parsing).

Previous: v0.20.0 — Dolt memory substrate (2026-04-24, ADR-003): SQL-
queryable memory layer backed by DoltDB in Docker. New
`dev/memory_adapter.py` + `scripts/cyborg-db.py` + tests. Phase 1 ingest
migrated 592 rows across 12 new tables. Had `.md` fallback — removed in
v0.21.0.

Earlier: v0.19.1 — Doc-coherence patch (2026-04-23): added `interview-prep/` and
`pipeline-snapshots/` directory layouts to `schemas/shared-structures.md`
registry per ADR-002. v0.19.0 shipped the structures + migration +
boundary test but missed the registry entries themselves — this patch
closes that gap. Tests 196 / 0 (was 194 / 0, +2 C3 assertions). No
code / migration / skill behavior changes.

Earlier: v0.19.0 — WO-054 Interview-prep filename convention
normalization (2026-04-23): canonical write path `prep-{slug}.md`
enforced, legacy `{company}-*-prep.md` files renamed via migration,
new `intel-*.md` prefix for insider-intel docs, `_archive/` subdir for
archived preps, 3 loose WIP root files ingested into plugin memory,
boundary test added for convention enforcement,
`brain/pipeline-snapshots/` scaffold directory added. No
hook changes; skill read-path tolerance documented, writes remain
canonical.

Earlier: v0.18.1 — Release-prep patch (2026-04-19): xOS architecture
context added (WIP/xOS-product/ARCHITECTURE-TAXONOMY.md), session-logger
hook orphan fix deferred to end-of-session runbook, unified ci.sh spec
referenced (WIP/xOS-product/UNIFIED-CI-SPEC.md), version drift in this
CLAUDE.md corrected. No hook/data-format changes.

v0.18.0 — WO-043 Greenhouse portal, WO-044 cover letter
DOCX/PDF, WO-045 SSOT read paths, WO-046 ledger push fix, WO-047
scorer → job-match-scorer rename, WO-048 tracker 10-col schema,
WO-049 recursive story count, WO-051 ADR-002 schema evolution,
WO-052 first-run gate, WO-053 schema version backfill.

v0.17.0 — Hook paths fix (P0), rescore queue consumer (P1),
multi-scan enrichment (P2), browser perf DOM/JS extraction (P2).

## Engineering Principles

Read `~/.claude/CLAUDE.md` for all application principles (currently P0-P22) and the eight Ground Zero frameworks. They govern all decisions here.

## Memory Access (v0.24.0+ — file-only, post-substrate-rollback 2026-04-26)

**Substrate decision rolled back.** Career-OS no longer uses Dolt / Neo4j / Redis. The brain layer is file-only: markdown + frontmatter + git. No DB, no container, no migrate step.

**Reads:** direct markdown reads against `~/anand-career-os/brain/`. Use `grep`, `jq`, `pyyaml`, or `pathlib` — no SQL adapter. Examples in `README.md` "Skill-side memory access".

**Writes:** unchanged — each skill is sole writer for its owned `.md` files (see `schemas/shared-structures.md`).

**Full reference:** `docs/MEMORY-ACCESS.md`.

**Local dev loop:** `bash dev/ci-local.sh` (pytest only — Dolt steps deprecated).

## Before You Code

1. Read `skills/*/SKILL.md` for the feature spec you're implementing.
2. Understand the hook chain: `hooks/hooks.json` defines SessionStart → UserPromptSubmit → Stop.
3. Hook scripts live in `hooks/scripts/`. Skills live in `skills/{name}/`.
4. For ANY read from memory, use `scripts/cyborg-db.py` or the adapter — do NOT regex-parse `brain/*.md`. See `docs/MEMORY-ACCESS.md`.

## After Every Change

Run the test suite:

```bash
bash tests/test-hooks.sh
```

Do not commit until tests pass (P7).

## Git Strategy

- **Use feature branches + FF-merge** per the GIT-NATIVE COORDINATION invariant
  (Ground Zero, codified 2026-04-26 in `~/cyborg/CONSTITUTION.md`). One
  `HANDOFF.md` per branch at repo root; merge to `main` via fast-forward when
  the branch is ready. Direct-to-main is BLOCKED by `.githooks/pre-commit` on
  `~/cyborg/`; treat the same discipline as authoritative here so the swarm's
  coordination layer stays uniform across repos.
- **Atomic commits.** Each commit is one logical change with all artifacts in its blast radius (P9).
- Commit messages: imperative mood, concise. Example: `add capture-response hook with ledger append`

## Repo Structure

```
hooks/
  hooks.json          Hook registration (SessionStart, UserPromptSubmit, Stop)
  scripts/            Shell scripts invoked by hooks
skills/
  mission-control/      Home screen dashboard + central router
  apply-dashboard/      Apply-ready pipeline view with quick actions
  application-qa/       Portal question answers sourced to stories
  job-search-scheduler/ Daily job scanning (finding roles)
  job-match-scorer/     Job-match scoring (6-category decision engine)
  pipeline-sync/        Reconcile pipeline, tracker, and tasks
  apply-tracker/        Post-application status lifecycle
  cruise-control/       Autonomous execution engine
  resume-engine/        JD-specific resume customization
  cover-letter/         Standalone cover-letter generation
  interview-prep/       Story-to-round mapping and mock interviews
  network-intelligence/ Warm intro discovery and contact mapping
  outreach-composer/    Calibrated outreach messages
  organize/             Bulk ingestion + self-evolving memory organization
  story-capture/        Real-time STAR-structured story capture
  skills-update/        Skills matrix write path + gap re-scoring hook
  session-logger/       Git-versioned conversation logging (via hooks)
  version-control/      Dual-remote backup (GitHub + Codeberg)
dev/                  Dev-only tools (not in skills/ to avoid Cowork validation)
  spec-feature/       Generate work order specs from product specs
  build-feature/      Implement a feature from a work order
  release-plugin/     Audit tests, bump version, commit, push
  install-plugin/     Install or update the plugin from GitHub
  ci/                 Full pipeline: spec → build → release → install
  guard.sh            Directory guard (plugin|home) used by all dev skills
tests/
  test-hooks.sh       Test suite — run after every change
```

## Data File Paths (canonical)

Skills reference these shared files. Always use these exact paths:

| File | Path | Owner |
|------|------|-------|
| Pipeline (status) | `brain/job-pipeline.md` | apply-tracker (writes), all skills (read) |
| Match Tracker (scoring) | `brain/job-pipeline-match-tracker.md` | job-match-scorer (writes), others (read) |
| Tasks (v0.25.0+) | GitHub Issues `thewhyman/anand-career-os` | apply-tracker, pipeline-sync, cruise-control (read via `gh issue list`; write via `gh issue create`/`gh issue close`) |
| Tasks (legacy, deprecated) | `brain/tasks/Tasks.md` | read-only historical reference; no skill writes here as of v0.25.0 |
| Scan reports | `brain/scans/{YYYY-MM-DD}/scan-{HH}-{MM}.md` | job-search-scheduler |
| Stories | `brain/stories/*.md` | organize |
| People | `brain/people/*.md` | network-intelligence |
| Identity | `brain/identity.md` | (read-only reference) |
| Skills matrix | `brain/skills-matrix.md` | (read-only reference) |
| JD samples | `brain/reference/jd-samples/*.pdf` | job-search-scheduler, resume-engine, interview-prep |
| Handoff | `NEXT_SESSION_HANDOFF.md` | mission-control, cruise-control |

## Boundaries

- **Never modify files outside this repo.** This plugin is installed into user workspaces via Cowork — the workspace is the user's, not ours.
- Hook scripts run in the user's workspace (`pwd`). They write to `brain/` and commit there.
- Plugin state goes to `${CLAUDE_PLUGIN_DATA}`, not to the workspace repo.

## Environment Variables

Scripts depend on these (provided by Cowork runtime):
- `CLAUDE_PLUGIN_ROOT` — path to this plugin repo
- `CLAUDE_PLUGIN_DATA` — writable state directory for this plugin
- `CAREER_HOME`, `CAREER_SPECS`, `CAREER_OS_PLUGIN` — see `~/.claude/CLAUDE.md`

## Key Conventions

- Shell scripts: `set -euo pipefail`, no bashisms beyond bash 3.2 (macOS compat).
- SKILL.md files use YAML frontmatter (`name`, `description`, `triggers`).
- Hooks use unified atomic commits — one commit captures all `brain/` changes per exchange.
- The plugin is the landlord of the user's workspace. It owns `brain/`, `CLAUDE.md` (in workspace), and `Resumes & Cover Letters/`.
