# Depth-2 Warm-Path Engine
status: design
slug: xos-82-warm-path-engine
ticket: XOS-82
repo: ~/aiprojects/career-intelligence-engine

## What
A local, in-memory graph engine over `network/people/*.json` that surfaces **depth-2 intro paths** to a target company ("self → intermediary → someone-at-TargetCo"), plus direct (depth-1) paths. Pure module + optional Bun query handler. No network calls, no phone-home.

## Why
Foundation of the Warm-Network moat (epic XOS-76) — the differentiation no competitor has (warm graph from *real relationship history*, not scraped LinkedIn). Every downstream warm-network feature (XOS-83 auto-surface, XOS-85 intro-strength badge) has no path data without it. NSM: multiplies "Validated Outward Wins per active user-hour" — warm intros are high-conversion outcomes surfaced with zero extra user attention.

## Scope
- **In:**
  - `src/network/warm-path-graph.ts` — load + validate-tolerant parse of `network/people/*.json`; build nodes (self + person + normalized company aliases); edges: `self→person` (always; weighted) and `person→person` (only on explicit evidence in `they_told_us`/`family_context` name refs or shared `companies[]`/cohort).
  - Depth-≤2 BFS to target-company nodes; path output `{path_nodes, path_length, intermediary, target_person, evidence[], warmth_score, strength_label, stale, last_contact}`.
  - Scoring from schema fields (`warmth`, `connection_strength`, `relationship`, `last_contact`, `referral_status`, `channel`); 5-level strength semantics + 90-day stale flag per existing `network-intelligence` SKILL conventions.
  - Company normalization matching the existing pattern (lowercase + strip parentheticals like `(current - VP)`; `companies[0]` with `company` legacy fallback).
  - `src/network/warm-path-query.ts` — exported `warmPathsToCompany(company, opts)`; optional `rules/warm-path-query/handler.ts` (JSON argv→stdout, local append-only log) following `rules/company-flags-filter/handler.ts`.
  - Bun unit tests over temp people-file fixtures.
- **Out:**
  - PostHog / any phone-home telemetry (gated by XOS-98 values decision) — engine takes an optional `eventSink` interface; default null no-op; a local JSONL sink is permitted, no remote.
  - The proactive surfacing hook on JD-track (that is XOS-83, builds on this).
  - LinkedIn 2nd-degree scraping (out of scope; local graph only).

## Acceptance criteria
- [ ] `warmPathsToCompany("TargetCo")` returns ranked depth-1 + depth-2 paths from real `network/people/*.json`, each with intermediary, evidence, and a warmth score.
- [ ] Inferred-only edges (no explicit evidence) are classified as "ask candidate", not asserted as hard paths (no fabricated relationships — honors named-person-claim grounding).
- [ ] Company-string variants normalize and match (`"TargetCo (current - VP)"` ⇄ `"TargetCo"`).
- [ ] Engine is sink-agnostic: returns structured data regardless of telemetry; no outbound calls.
- [ ] `bun test` green; lint/typecheck/build green; no unrelated changes.

## Test plan
- [ ] Happy: fixture `self → Alice → Bob@TargetCo` (Alice has Bob in `they_told_us`, Bob `companies[0]="TargetCo"`) → one depth-2 path, correct intermediary, score>0, evidence non-empty.
- [ ] Boundary: no path → empty `paths[]` no crash; depth-1-only → `path_length:1`, `intermediary:null`; company variant normalizes.
- [ ] Environmental: malformed JSON file skipped + logged, graph proceeds; missing `companies` → node w/o company edges; missing `warmth` → neutral score; unknown fields ignored.

## Rollback
Pure additive new module + tests + optional handler; no edits to existing runtime paths. Revert the feature branch / delete the new files — zero impact on shipped behavior. Engine is inert unless explicitly called.
