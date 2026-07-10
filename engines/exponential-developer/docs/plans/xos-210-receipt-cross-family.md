# XOS-210 (receipt half) — ship-feature Stage-6 receipt surfaces cross_family.degraded

status: design
slug: xos-210-receipt-cross-family
ticket: XOS-210
repo: ~/aiprojects/super-developer-plugin

## What
The Stage-6 `ship-feature-judge-receipt:v1` block now carries a `cross_family` line populated from the judge JSON's authoritative `cross_family.degraded` field (co-dialectic ≥4.35.0, shipped in XOS-207). A degraded review (a family lane errored/timed-out/emptied) is now VISIBLE in the PR body instead of masquerading as full cross-family. On a T3+ change, `cross_family.degraded: true` auto-applies `human-merge`.

## Why
XOS-207 made the signal exist; nothing consumed it. Today a down agy lane made every gate silently OpenAI-only. This makes that loss visible at the exact human-review surface (the PR receipt) and turns a degraded T3 review into a human-merge, so no one merges a "cross-family GREEN" that was really single-family.

## Scope
- In: `skills/ship-feature/SKILL.md` — receipt template + Stage-6 populate instruction (read `cross_family.degraded`, never `all_flags[0]`) + Stage-8 auto-escalation adds `cross_family.degraded on T3+` as a human-merge trigger. Version 0.11.0→0.12.0 + CHANGELOG.
- Out: codi Protocol-8 consumer (deferred slice — codi loads every session, higher blast radius, human-present review). No handler/executable/gate-logic change here — prose only, backward-compatible (older judge JSON → `cross_family: unknown`).

## Acceptance criteria
- [ ] Receipt template includes a `cross_family:` line with the three states (intact / ⚠ DEGRADED / unknown).
- [ ] Stage-6 instruction says read the structured `cross_family.degraded`, never `all_flags[0]`.
- [ ] Stage-8 auto-escalation lists `cross_family.degraded` on T3+ as a human-merge trigger.
- [ ] Backward-compatible: judge JSON without `cross_family` → `unknown`, not a crash.

## Test plan
- [ ] Prose-only change (no executable code); verified by cross-family judge review of the diff + manual read of the receipt template rendering the three states.

## Rollback
Revert the commit — additive prose + version bump; no executable behavior depends on it.

## Change manifest
```
+ added     docs/plans/xos-210-receipt-cross-family.md
~ modified  skills/ship-feature/SKILL.md   — receipt cross_family line + Stage-6 populate + Stage-8 escalation
~ modified  .claude-plugin/plugin.json     — 0.11.0 → 0.12.0
~ modified  CHANGELOG.md                   — 0.12.0
− removed   (none)
⚙ migrated  (none — additive, backward-compatible)
```
