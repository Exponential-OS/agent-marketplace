---
name: Release Career Intelligence Plugin
description: Release gate for Career Intelligence plugin. Audits boundary rules coherence, test coverage, adds missing tests, runs suite, bumps version with migration, commits and pushes.
---

# Release Career Intelligence Plugin

## What This Does
Release gate for the Career Intelligence plugin. Audits workspace boundary rules against SKILL.md declarations, audits test coverage gaps, adds missing tests, runs the full suite, bumps version with migration, commits, and pushes. If tests fail, stops and provides actionable fix prompts.

Does NOT define what "good tests" or "good migrations" look like — that's P6, P7, P9 in ~/.claude/CLAUDE.md. This skill only orchestrates the release sequence.

## Prerequisites

This skill must be run from the plugin repo directory ($CAREER_OS_PLUGIN).

**Directory guard (enforced):** Before ANY work, run:
```bash
bash "$CLAUDE_PLUGIN_ROOT/dev/guard.sh" plugin "Release Plugin"
```
If it exits non-zero, STOP. Show the guard's output and do nothing else.

## Steps

### 0.5. Schema Coherence Gate (ADR-002)

Before auditing anything else, verify that the schema evolution protocol
is intact:

1. Read `schemas/shared-structures.md` — the shared-structures registry.
   Every shared data structure must be listed with its current version
   and consumers.
2. For any shared structure that has changed format since last release,
   verify:
   - Its version in the registry is bumped
   - Every consumer listed in the registry is updated in the commit range
     since the last release (run the grep sweep from ADR-002)
   - A value-asserting coherence test exists in `tests/test-hooks.sh`
     `-- Schema Coherence (ADR-002) --` section
3. The coherence tests (`[C1]`, `[C2]`, `[C3]`, and any others) must pass
   in Step 4 — they are first-class release gates.

If the registry is out of date or a coherence test is missing for a
changed structure, **stop and fix before releasing.** This gate prevents
the WO-048 / WO-049 / WO-052 drift class from recurring.

### 1. Audit boundary rules coherence
The init-repo.sh template contains a Plugin Boundary Rules section that tells
workspace agents which files are plugin-managed (read-only) and which are
agent-writable (with format contracts). This table must stay in sync with
what SKILL.md files actually declare.

**Audit procedure:**
1. Read `hooks/scripts/init-repo.sh` — extract the boundary rules tables
   (Plugin-Managed and Agent-Writable sections)
2. Read each `skills/*/SKILL.md` — extract file paths from input/output tables
   (look for `brain/` paths and output declarations)
3. Compare:
   - Every path a skill **writes to** must appear in the Agent-Writable table
     (or Plugin-Managed if it's a hook-owned path)
   - Every path in the Agent-Writable table must have at least one skill that
     declares it as an output
   - Format descriptions in the table must match what the SKILL.md specifies
4. Report discrepancies:
   ```
   Boundary audit:
     MISSING from template: brain/scans/ (written by job-search-scheduler)
     STALE in template: brain/glossary.md (no skill writes this anymore)
     FORMAT MISMATCH: stories/*.md — template says "YAML frontmatter" but
       organize SKILL.md specifies 7 required fields
   ```

If discrepancies found → update the init-repo.sh template to match, then
continue to Step 2. If clean → skip to Step 2.

### 2. Audit test coverage gaps
Read tests/test-hooks.sh. For each testable component, check whether the P7 tier targets are met:
- Happy path (1-2 per component)
- Boundary cases (2-3 per component)
- Environmental (1-2 per component)

List components with missing tiers. Include migration scripts as testable components.

If no gaps found, say so and skip to Step 3.

### 3. Add missing tests
For each gap identified in Step 2:
- Read the source file being tested to understand its behavior
- Write tests following the existing framework style in tests/test-hooks.sh (read the file — do not assume patterns)
- Place tests in the appropriate section with [XX] ID prefix and echo header matching existing convention

Do NOT invent test assertions for behavior that doesn't exist in the code. Tests encode what the code does, not what you wish it did.

### 4. Run tests
Run `bash tests/test-hooks.sh` from $CAREER_OS_PLUGIN.

If failures → go to Step 7.
If all pass → continue.

### 5. Propose version bump
1. Read .claude-plugin/plugin.json for current version
2. Read `git log` since the last version tag/bump to understand what changed
3. Classify changes and recommend a semver bump:
   - **Major** (X.0.0): breaking changes to hook contracts, data format changes that require non-trivial migration, removal of skills or hooks that users depend on
   - **Minor** (0.X.0): new skills, new hooks, new features in existing skills, new migration scripts for structural changes, new CI workflows
   - **Patch** (0.0.X): test additions/fixes, bug fixes, README/doc updates, refactors with no behavior change, version-stamp-only migrations
4. Present the recommendation to the user:
   ```
   Current version: {current}
   Changes since last release:
   - {summary of each change category}

   Recommended bump: {major|minor|patch} → v{proposed}
   Reason: {one-line justification}

   Proceed? (or specify a different version)
   ```
5. Wait for user confirmation before proceeding.

### 6. Commit + push (after confirmation)
1. Bump version in .claude-plugin/plugin.json to the confirmed version
2. Create migrations/v{old}-to-v{new}.sh — for test/doc-only releases, a version-stamp-only script is fine:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   CONTEXT_DIR="${1:-.}"
   mkdir -p "$CONTEXT_DIR/brain/config"
   echo "{new_version}" > "$CONTEXT_DIR/~/.career-os-state/version"
   echo "✅ Migration v{old} → v{new} complete"
   ```
3. Commit: stage all changed files (tests, migrations, plugin.json, any fixes from earlier steps)
4. Push to origin main
5. Output: "✅ Released v{new} — {N} tests pass. Pushed to origin/main."

### 7. On failure (at any step) — stop and guide
Do NOT commit. Do NOT push. Output:

```
❌ {N} tests failed:

FAIL: {test name} — {reason}
→ Likely cause: {one-line diagnosis}
→ File to fix: {path}

Paste this to fix and retry:
"Fix the failing test '{test name}' in $CAREER_OS_PLUGIN/tests/test-hooks.sh. The test expects {expected} but got {actual}. Read {file to fix}, fix the root cause, then run: release cosp plugin"
```
