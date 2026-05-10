# Career OS

The operating system for your career. Persistent memory, session capture, git-versioned data, full privacy.

## What It Does

Career OS turns Claude into a career co-pilot with perfect memory. It owns your career workspace — every conversation captured, every contact remembered, every story preserved. Context is never lost.

- **Session logging** — Every exchange (your prompts + Claude's responses) captured verbatim in daily ledger files
- **Unified atomic commits** — All changes (ledger, memory, tasks, output) committed together per exchange
- **Dashboard** — Career mission control: today's priorities, pipeline status, metrics, actionable prompts
- **Full privacy** — Your data stays in YOUR GitHub account. Career OS never phones home.
- **Dual-remote backup** — GitHub primary + Codeberg mirror. No single point of failure.

## Install

```
/plugin marketplace add Exponential-OS/agent-marketplace
/plugin install career-os@xos
```

That's it. Career-os ships under the `thewhyman` marketplace alongside Co-Dialectic and the xOS plugin family. See [Exponential-OS/agent-marketplace](https://github.com/Exponential-OS/agent-marketplace) for the full plugin list.

**Legacy install paths** (still work, but deprecated): `/plugin marketplace add Exponential-OS/career-os-plugin` then `/plugin install career-os@career-os-marketplace`. The `career-os-marketplace` standalone marketplace was retired 2026-04-27 — see [.claude-plugin/README.md](.claude-plugin/README.md) for migration notes.

## What's new in v0.27.0 (2026-04-27)

Two new skills for outreach + interview workflows:

- **`outreach-fact-check`** (T4 outreach immunity): read-only pre-flight verifier for biographical claims. Diffs claim against canonical brain sources (`experience-history.md`, `identity.md`, `awards-education-speaking.md`) and emits structured `match` / `mismatch` / `unknown` / `insufficient_evidence` verdicts. 10 claim classes covered (tenure, title, scope, compensation, recognition, education, speaking, identity, metric, comparative). Two modes: Mode 1 on-demand verification (default; ships in v0.26.0); Mode 2 PreToolUse hook on Gmail draft / outgoing tools (forward-spec for v0.27.x). Origin: 2026-04-26 outreach near-miss class.
- **`interviewer-research`** (panel prep automation): auto-fires on `apply-tracker`'s Screen → Interview / Panel Scheduled transitions. Spawns one parallel research sub-agent per interviewer (Perplexity MCP + LinkedIn MCP + canonical brain reads); outputs aggregated dossier at `INPUT/[company-slug]-[date]-prep-dossier.md` + a `kind:prep` GitHub Issue.

`apply-tracker` integration: NEW v0.27 trigger block on Screen → Interview transition auto-invokes `interviewer-research`.

See [CHANGELOG.md](CHANGELOG.md) for the v0.27.0 + v0.26.0 entries.

## First Run

1. Open a new Cowork or Claude Code session with a fresh folder as your career workspace
2. Career OS automatically scaffolds the workspace structure
3. Set up git: `git init && git add -A && git commit -m "Initial Career OS setup"`
4. Connect a GitHub repo as remote
5. Say "mission control" to see your career home screen

## Requirements

- **GitHub account** — Career OS uses git for persistence. No offline-only mode.
- **Claude Code or Cowork** — Plugin runs in Claude's plugin system.
- **No infrastructure** *(v0.24.0+)* — file-only memory substrate. No Docker, no Dolt, no database. Markdown + frontmatter + git. (Substrate rolled back 2026-04-26.)

## Memory Substrate — File-Only (v0.24.0+)

**Substrate decision rolled back 2026-04-26.** Career-OS no longer requires Dolt, Neo4j, Redis, or any database/container. The brain layer is FILE-ONLY: markdown + frontmatter + git for version control. No infrastructure to provision, no containers to start, no daily migrate step.

### Quick setup

```bash
# 1. /plugin marketplace add Exponential-OS/agent-marketplace
# 2. /plugin install career-os@xos
# 3. Run onboarding: career-os onboarding
```

That's it. Memory lives at `~/anand-career-os/brain/` (or your equivalent xHumanOS instance). Skills read markdown directly with grep, jq, and frontmatter parsing — no SQL.

### Skill-side memory access

Skills query memory via direct file reads (markdown + frontmatter). Examples:

```bash
# Find people with warmth >= 4
grep -lE "^warmth: [4-5]" ~/anand-career-os/brain/network/people/*.md

# Active job pipeline (FULL_INVEST tier)
grep -lE "^tier: FULL_INVEST" ~/anand-career-os/brain/projects/job-search/roles/*.md

# Stories tagged leadership
grep -lE "^tags:.*leadership" ~/anand-career-os/brain/stories/*.md
```

For complex queries, write a Python helper using `pyyaml` + `pathlib` — no DB adapter needed. See [`docs/MEMORY-ACCESS.md`](docs/MEMORY-ACCESS.md).

### What about the migration scripts in `migrations/v0.21.0+`?

Those are HISTORICAL. The Dolt substrate ran from v0.21.0 (2026-04-15) to v0.23.0 (2026-04-25); rolled back 2026-04-26. The migration scripts remain in-tree as reference for future queryable-runtime substrate (semantic retrieval / vector store / graph DB) when OpenClaw memory standard stabilizes. Don't run them.

## Roadmap (xOS Integration)

Career-OS plugin is on the path to becoming **TheWhyMan-xHumanOS** (Anand's xHumanOS incarnation). Today's plugin owns its own engines (scoring, distribution, campaign orchestration); when xOS kernel ships those primitives, plugin code splits cleanly:

- **Generic engine work → xOS kernel** (Ingestion / Extraction / Persona / Distribution / Campaign)
- **Career-domain logic → xHumanOS Career Module** (the 6-category scoring rubric, ATS rules library, job-pipeline state machine, resume tracks)
- **Per-human config → Anand-xHumanOS incarnation** (`INCARNATION.md` + `PERSONAS.md` + `DOMAIN-DATA.md`)

Specs in the anand-career-os workspace:
- `WIP/xOS-product/career-os-contributions-to-kernel.md` — what gets pushed up
- `WIP/xHumanOS-product/specs/career-module-spec.md` — career module spec
- `WIP/career-os-product/specs/Anand-xHumanOS-incarnation.md` — Anand's incarnation files

No flag-day rewrite — strangler-fig migration as kernel APIs stabilize.

## Workspace Structure

Career OS is the landlord — it owns and manages the entire folder:

```
~/my-career/                        Your Cowork context folder
├── brain/                     Hidden — the career brain
│   ├── ledger/                       Conversation logs (auto-captured)
│   ├── memory/                       Stories, contacts, pipeline
│   ├── tasks/                        Priorities and backlog
│   └── config/                       Settings and prompt templates
├── CLAUDE.md                       Rules engine (visible, editable)
└── Resumes & Cover Letters/        Output folder (deliverables)
```

## How It Works

### Hooks (automatic)

| Hook | Event | What It Does |
|------|-------|--------------|
| `init-repo.sh` | SessionStart | Checks version, runs migrations, scaffolds workspace |
| `capture-prompt.sh` | UserPromptSubmit | Captures prompt + unified commit of all changes |
| `capture-response.sh` | Stop | Captures response + unified commit of all changes |

### Git Strategy

Direct-to-main. Every exchange produces one atomic commit on `main` — no feature branches, no session branches. Each commit bundles all `brain/` changes (ledger, memory, tasks) from that exchange into a single rollback unit.

### Skills

| Skill | Purpose |
|-------|---------|
| `mission-control` | Career home screen — priorities, pipeline, metrics, action prompts |
| `job-search-scheduler` | Daily job scanning, JD matching, pipeline updates |
| `session-logger` | Documents the hook-based capture system |
| `version-control` | Git setup, dual-remote backup, secrets handling |

## Architecture

1. **Local-first** — Files + git, no external database
2. **Plugin is the landlord** — Owns the entire context folder
3. **GitHub is required** — No offline fallback
4. **Privacy by design** — Your data, your repo, your control
5. **Unified commits** — One atomic rollback unit per conversation turn

## License

MIT