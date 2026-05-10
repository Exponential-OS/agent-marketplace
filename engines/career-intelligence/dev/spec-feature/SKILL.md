---
name: Spec Career OS Feature
description: Generates work order specs from product specs. Creates feature specs that any IDE or agent can pick up to build.
---

# Spec Career OS Feature

## What This Does
Reads product specs (PRD.md, PRODUCT_SPEC.md) from $CAREER_SPECS and generates work order files in $CAREER_SPECS/work-orders/. Work orders are feature specs that any IDE or agent can pick up to build.

Does NOT write implementation code — only generates the spec artifact.

## Prerequisites

This skill must be run from the career workspace directory ($CAREER_HOME).

**Directory guard (enforced):** Before ANY work, run:
```bash
bash "$CLAUDE_PLUGIN_ROOT/dev/guard.sh" home "Spec Feature"
```
If it exits non-zero, STOP. Show the guard's output and do nothing else.

## Steps

### 0. Gather local context
Read from the current working directory (which should be $CAREER_HOME):
- NEXT_SESSION_HANDOFF.md (if exists) — recent session context
- brain/pipeline.md (if exists) — current pipeline state
- brain/tasks/ (if exists) — current priorities
- CLAUDE.md (if exists) — workspace rules

Product specs live in a subdirectory: WIP/career-os-product/ (i.e., $CAREER_SPECS).

### Single feature
1. Identify feature name from user request
2. Read WIP/career-os-product/PRD.md and WIP/career-os-product/PRODUCT_SPEC.md for feature context
3. Generate WIP/career-os-product/work-orders/{feature-name}-SKILL.md with:
   - YAML frontmatter: name, description, triggers, phase
   - Behavior spec: what it does, inputs, outputs
   - Dependencies on other skills
   - Test criteria: happy path, boundary, environmental
4. Report what was created

### All pending
1. Read WIP/career-os-product/PRODUCT_SPEC.md — extract all planned skills from the Skill Inventory table
2. List existing work orders in WIP/career-os-product/work-orders/
3. List implemented skills in $CAREER_OS_PLUGIN/skills/
4. Diff: planned minus (already specced + already implemented) = pending
5. Generate work orders for all pending features
6. Report summary: created N work orders, M already existed, K already implemented
