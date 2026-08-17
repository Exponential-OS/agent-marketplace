---
name: Build Career Intelligence Feature
description: Reads a work order from $CAREER_SPECS and implements the feature in the plugin repo with tests.
---

# Build Career Intelligence Feature

## What This Does
Reads an existing work order and implements the feature in the plugin repo with tests.

Does NOT write implementation code outside the current working directory.

## Prerequisites

This skill must be run from the plugin repo directory ($CAREER_OS_PLUGIN).

**Directory guard (enforced):** Before ANY work, run:
```bash
bash "$CLAUDE_PLUGIN_ROOT/dev/guard.sh" plugin "Build Feature"
```
If it exits non-zero, STOP. Show the guard's output and do nothing else.

**Work order input:** The skill reads the work order from `$CAREER_SPECS/work-orders/`. This is a one-time read-only input from outside the working directory — the only cross-directory read allowed.

## Steps

### List available
1. List work orders in $CAREER_SPECS/work-orders/
2. List implemented skills in skills/
3. Show: available to build (work order exists, not yet implemented)

### Build single feature
1. Read $CAREER_SPECS/work-orders/{feature-name}-SKILL.md
2. Create or update skills/{feature-name}/SKILL.md
3. Implement following the work order spec
4. Run `bash tests/test-hooks.sh` after changes
5. Iterate until tests pass
6. Commit with descriptive message
7. Remind user to pressure-test in Cowork

### Build all pending
1. List available work orders not yet implemented
2. Confirm with user before proceeding
3. Build each sequentially — tests must pass between each
4. Commit each feature atomically
