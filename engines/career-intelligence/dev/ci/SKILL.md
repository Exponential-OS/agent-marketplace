---
name: CI Pipeline
description: >
  Full dev pipeline: spec (optional) → build → release → install.
  Chains all dev skills in sequence with directory guards.
  Runs from $CAREER_OS_PLUGIN.
triggers:
  - ci
  - ci pipeline
  - run ci
  - full pipeline
  - build and release
---

# CI Pipeline — Career OS Dev Skill

## Purpose

Chains the dev skills into a single pipeline: spec → build → release → install.
Eliminates the need to remember which skill to run next or which directory to be in.

## Output Format

Always start your response with:
```
━━━ Career OS: CI Pipeline ━━━
```

## How to Invoke

- "ci" or "ci pipeline" — run build → release → install (default)
- "ci from spec" or "ci --from-spec" — run spec → build → release → install
- "ci [feature-name]" — run pipeline for a specific feature
- "ci --dry-run" — show what would happen without executing

## Prerequisites

**Directory guard (enforced):** Before ANY work, run:
```bash
bash "$CLAUDE_PLUGIN_ROOT/dev/guard.sh" plugin "CI Pipeline"
```
If it exits non-zero, STOP. Show the guard's output and do nothing else.

## Pipeline Stages

### Stage 0: Spec (optional — only with `--from-spec`)

Read work orders from `$CAREER_SPECS/work-orders/` (read-only cross-directory access).

1. Read `$CAREER_SPECS/PRD.md` — extract planned skills from Skill Inventory
2. List existing work orders in `$CAREER_SPECS/work-orders/`
3. List implemented skills in `skills/`
4. Diff: planned minus (specced + implemented) = pending
5. Generate work orders for pending features
6. Report what was created

If all features are already specced, skip to Stage 1.

This stage follows the `spec-feature` SKILL.md spec — read it for details.

### Stage 1: Build

Read work orders and implement features.

1. List work orders in `$CAREER_SPECS/work-orders/`
2. List implemented skills in `skills/`
3. Identify: work orders without implementations = buildable
4. If a specific feature was requested, filter to just that one
5. Show the build plan:
   ```
   ━━━ CI: Build Plan ━━━

   Work orders ready to build:
   1. WO-019 apply-tracker — post-application lifecycle tracking
   2. WO-021 job-match-scorer — 6-category match scoring engine

   Already implemented: 13 skills
   Nothing to build: 9 work orders (meta/infra tasks)

   Proceed? (y/n)
   ```
6. On approval, build each — create/update `skills/{name}/SKILL.md`
7. Run `bash tests/test-hooks.sh` after each feature

If all work orders are already built, skip to Stage 2.

This stage follows the `build-feature` SKILL.md spec — read it for details.

### Stage 2: Release

Version bump, test, commit, push.

1. Run `bash tests/test-hooks.sh` — full suite must pass
2. If failures → STOP pipeline. Show failures and fix guidance. Do not proceed.
3. Read `.claude-plugin/plugin.json` for current version
4. Read `git log` since last release to classify changes
5. Propose version bump (major/minor/patch) with justification
6. Wait for user confirmation
7. On approval:
   - Bump version in `plugin.json`
   - Create migration script `migrations/v{old}-to-v{new}.sh`
   - Update `CLAUDE.md` version line
   - Commit all changes
   - Push to origin main
8. Report: "Released v{new} — {N} tests pass"

This stage follows the `release-plugin` SKILL.md spec — read it for details.

### Stage 3: Install

Refresh the local Claude Code plugin cache.

1. Check `claude plugin list` for current installed version
2. If installed version matches new release → skip (already current)
3. Run `claude plugin update career-intelligence@xos` or uninstall + reinstall
4. Verify: `claude plugin list` shows new version
5. Report: "Installed v{new} — plugin cache refreshed"

This stage follows the `install-plugin` SKILL.md spec — read it for details.

## Pipeline Flow

```
[--from-spec]
     │
     ▼
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Spec   │───▶│  Build  │───▶│ Release │───▶│ Install │
│ (opt.)  │    │         │    │         │    │         │
│ $SPECS  │    │ $PLUGIN │    │ $PLUGIN │    │ $PLUGIN │
│ read    │    │ write   │    │ commit  │    │ refresh │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                    │              │
                    ▼              ▼
               tests must    tests must
               pass here     pass here
```

## Gate Rules

- **Tests are gates.** If tests fail at any stage, the pipeline stops. No skipping.
- **User confirmation required** before: build plan execution, version bump.
- **No confirmation needed** for: spec generation, test runs, install refresh.
- **If nothing to do** at a stage (all specced, all built, already installed), skip it with a one-liner and move to the next stage.

## Dry Run Mode

With `--dry-run`, show what each stage would do without executing:

```
━━━ CI: Dry Run ━━━

Stage 0 (Spec):     skipped — not requested
Stage 1 (Build):    0 features to build (all implemented)
Stage 2 (Release):  would bump 0.9.0 → 0.10.0 (2 skills updated)
Stage 3 (Install):  would refresh plugin cache (current: 0.9.0)

Run "ci" to execute.
```

## Visibility Table

After pipeline completes (or stops on failure), show summary:

```
━━━ CI Pipeline Complete ━━━

| Stage | Status | Detail |
|-------|--------|--------|
| Spec | skipped | not requested |
| Build | skipped | all work orders implemented |
| Release | done | v0.9.0 → v0.10.0, 163 tests pass |
| Install | done | plugin cache refreshed |

Total time: {duration}
```
