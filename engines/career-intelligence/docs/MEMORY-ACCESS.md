<!-- schema: v2.0 -->
# Memory Access (v0.24.0+) — File-only, post-substrate-rollback (2026-04-26)

**Audience:** every skill in this plugin. Referenced from SKILL.md files.

## The one rule

**Reads go directly against markdown + frontmatter. Writes go to `.md` files. No DB, no container, no migrate step.**

The Dolt SQL substrate (v0.20.0–v0.23.0, Apr 15 → Apr 25 2026) was rolled back on 2026-04-26 in favor of a file-only architecture. The migration scripts remain on disk at `~/cyborg/brain-db/` for reference if/when a queryable runtime substrate (semantic retrieval / vector store / graph DB) ships under the OpenClaw memory standard. Don't run them.

## Why file-only

- **Zero infra to provision.** No Docker, no daemon, no port. Plugin install → onboarding → running.
- **Cross-OS portable.** macOS / Linux / Windows / cloud VM all read markdown identically. (P3 corollary — Portability & Installability.)
- **Privacy by default.** Brain stays on the user's machine. Nothing leaves unless the user chooses (P5).
- **Git-native.** Every brain mutation is `git diff`-able + revertable + auditable.
- **OpenClaw-aligned.** Co-Dialectic plugin and other Claude-marketplace skills assume zero-DB substrate; file-only matches.

## How skills read memory

### Bash / shell — direct grep + frontmatter

```bash
# Health: count brain-layer files
ls ~/anand-career-os/brain/network/people/*.md | wc -l

# Roles in top tier
grep -lE "^tier: FULL_INVEST" ~/anand-career-os/brain/projects/job-search/roles/*.md

# Applications in active section
grep -lE "^status: active" ~/anand-career-os/brain/projects/job-search/applications/*.md

# Stories tagged for a competency
grep -lE "^tags:.*leadership" ~/anand-career-os/brain/stories/*.md

# People above a warmth floor
grep -lE "^warmth: [4-5]" ~/anand-career-os/brain/network/people/*.md
```

### Python — pyyaml + pathlib

```python
from pathlib import Path
import yaml

def list_roles(min_score: int = 85, tier: str | None = None) -> list[dict]:
    roles = []
    base = Path("~/anand-career-os/brain/projects/job-search/roles/").expanduser()
    for path in base.glob("*.md"):
        text = path.read_text()
        if not text.startswith("---\n"):
            continue
        fm_end = text.find("\n---\n", 4)
        if fm_end < 0:
            continue
        meta = yaml.safe_load(text[4:fm_end]) or {}
        if meta.get("score", 0) < min_score:
            continue
        if tier and meta.get("tier") != tier:
            continue
        roles.append({**meta, "path": str(path)})
    return roles
```

For complex queries, write a small skill-local helper. Don't build a global adapter — every adapter layer adds maintenance surface (P2) without ROI when the dataset is <10K rows.

## How skills write memory

Each skill is the **sole writer** for its owned `.md` files (see `schemas/shared-structures.md`). Writes are surgical:

- Read the file first.
- Edit the specific line / section / frontmatter field.
- Never rewrite the whole file (P15: surgical edits only).

| Skill | Writes to |
|---|---|
| `apply-tracker` | `brain/job-pipeline.md`, `brain/tasks/Tasks.md` |
| `job-match-scorer` | `brain/job-pipeline-match-tracker.md` |
| `skills-update` | `brain/skills-matrix.md` |
| `story-capture` | `brain/stories/**/*.md`, `STORY_INDEX.md` |
| `network-intelligence` | `~/anand-career-os/brain/network/people/<name>.md` (SSOT per ADR-001) |
| `interview-prep` | `brain/interview-prep/prep-*.md` |
| `pipeline-sync` | `brain/job-pipeline.md`, `brain/tasks/Tasks.md` |
| `cruise-control` | `brain/tasks/Tasks.md`, per-batch logs |
| `outreach-composer` | `brain/tasks/outreach-{contact}-{date}.md` |

Write-ownership boundaries from ADR-002 (schemas/shared-structures.md) are unchanged.

For frontmatter mutations, use `python_frontmatter`:

```python
import frontmatter
p = frontmatter.load('path.md')
p['status'] = 'shipped'
p['last_update'] = '2026-04-26'
open('path.md', 'w').write(frontmatter.dumps(p))
```

## Schema

Frontmatter schemas live in `schemas/shared-structures.md`. Each schema specifies required fields, type, and example. Skills MUST validate their writes against the schema (write a tiny validator inline or in `dev/`); do NOT silently emit malformed frontmatter.

## What about `scripts/cyborg-db.py` and `dev/memory_adapter.py`?

Deprecated as of v0.24.0. They remain in-tree for reference but raise `AdapterDeprecated` when invoked. Will be removed in v0.25.0 unless the queryable-runtime substrate decision flips.

## Biographical-claim verification (T4 outreach + resume)

Skills that draft content destined for real humans (`outreach-composer`, `resume-engine`) MUST run the biographical-claim pre-check rule before output:

```bash
bash ~/cyborg/rules/biographical-claim-precheck/HOW.sh "$(jq -nc \
  --arg draft "/path/to/in-progress-draft.md" \
  --arg canonical "$HOME/anand-career-os/brain/identity/experience-history.md" \
  '{draft_path:$draft, canonical_sources:[$canonical], stakes:"T4"}')"
```

Verdict `BLOCK` means a claim has no canonical anchor; fix the draft, do not bypass. Origin: Matt Kleinman + Amanesh Goyal hallucinations (2026-04-26). See `~/cyborg/rules/biographical-claim-precheck/README.md`.

## Anti-patterns

- ❌ Don't build a new adapter layer to wrap markdown reads. Direct grep + frontmatter parse is faster to write, faster to debug, and one less thing to maintain.
- ❌ Don't add silent fallbacks (`.md` if DB down`). The DB is gone; there's nothing to fall back FROM.
- ❌ Don't bypass the biographical-claim-precheck for "small" outreach. Casual peer-to-peer DMs produced the originating Amanesh hallucination.
- ❌ Don't introduce new write surfaces without updating `schemas/shared-structures.md`. P9 coherence violation.
- ❌ Don't run `~/cyborg/brain-db/migrate_career_os.py`. The substrate is rolled back; the migration script is reference-only.

## Troubleshooting

- **"I see stale data" →** `git -C ~/anand-career-os pull --ff-only`. Sibling agents may have committed updates not yet pulled (GIT-NATIVE COORDINATION invariant).
- **"My grep returns nothing" →** check the canonical path with `ls ~/anand-career-os/brain/`. Brain reorganized 2026-04-26 (cyborg → xHumanOS migration); old paths under `~/cyborg/people/` and `~/cyborg/projects/` are now under `~/anand-career-os/brain/network/people/` and `~/anand-career-os/brain/projects/`.
- **"Frontmatter parse error" →** the file is missing `---\n...---\n` markers, or YAML inside is malformed. Fix the file; do NOT add silent fallback to the reader.
- **"AdapterDeprecated raised" →** you're calling `cyborg-db.py` or `memory_adapter.py`. Migrate to direct file reads per the examples above.

## References

- Schema definitions: `schemas/shared-structures.md`
- Brain layer root: `~/anand-career-os/brain/`
- Constitution memory rules: `~/cyborg/CONSTITUTION.md` § Multi-Agent (P15) + Shared-State Hydration Invariant
- Biographical-claim rule: `~/cyborg/rules/biographical-claim-precheck/`
- Migration archives (historical, do not run): `~/cyborg/brain-db/migrate_career_os.py` + `migrations/v0.19.1-to-v0.20.0.sh` etc.

## Origin

- 2026-04-15: Dolt substrate selected (ADR-003).
- 2026-04-24: v0.21.0 cutover — `.md` fallback removed, Dolt canonical.
- 2026-04-25: Migration paused at v0.23.0 stable.
- **2026-04-26: Substrate rolled back to file-only.** *"yes, i don't think i will be using dolt/neo4j/redis now as they are not standard openclaw"* — user.
