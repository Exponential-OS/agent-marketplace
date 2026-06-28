# Auto-Surface Warm Intros on JD-Track
status: design
slug: xos-83-warm-intro-surfacing
ticket: XOS-83
repo: ~/aiprojects/career-intelligence-engine

## What
When a new role/company enters the pipeline (a QUEUED match-tracker row / scan write-back), automatically call the merged depth-2 warm-path engine (`src/network/warm-path-query.ts` → `warmPathsToCompany`) and surface the top intro paths onto the row's existing `warm_path` field, so `pipeline-view` renders them with zero extra user action.

## Why
Makes the Warm-Network moat **proactive** instead of on-demand — the highest-NSM moment (a JD entering the pipeline) is exactly when a warm intro is most valuable, surfaced for free. NSM: multiplies Validated Outward Wins (warm intros made) per unit of user attention. Builds directly on XOS-82 (now on main).

## Scope
- **In:**
  - `src/network/surface-intros.ts` — `surfaceIntroOpportunitiesForTrackedRole({ tracker_id, company, role }, opts?: { topN?: number; eventSink?: EventSink })`: calls `warmPathsToCompany(company)`, takes `topN` (default 3) score-sorted paths, derives `ask_candidate` (evidence prefixed "ask candidate:"), returns a `SurfacedIntroRecord` and produces a concise human display string suitable for the match-tracker `warm_path` field.
  - Reuse `WarmPathQueryResult` / `WarmPath` shapes from `src/network/warm-path-graph.ts` — no new graph logic.
  - Sink-agnostic: optional `eventSink` (default null no-op); emits an optional local `intro_opportunity_surfaced` event only when a sink is provided. NO phone-home.
  - Bun unit tests in `tests/`.
- **Out:**
  - PostHog / any outbound telemetry — gated by XOS-98's telemetry/privacy decision (honor the no-phone-home promise; local sink only).
  - New hooks (the plugin is skill-driven; no PostToolUse hook exists). Triggering is via the skill write-back path.
  - match-tracker schema expansion — write to the EXISTING `warm_path` field (schema already has it); no schema change.

## Acceptance criteria
- [ ] `surfaceIntroOpportunitiesForTrackedRole({company:"TargetCo",...})` returns a record whose top path has intermediary + `strength_label` + `ask_candidate`, and a display string written to `warm_path`.
- [ ] Calls `warmPathsToCompany` (does not reimplement traversal); respects `topN`.
- [ ] No warm path → `warm_path` stays empty/"Cold", no event emitted, no throw.
- [ ] Sink-agnostic: no outbound calls; `eventSink` defaults to no-op.
- [ ] `bun test` green; no unrelated changes.

## Test plan
- [ ] Happy: tracked company with a warm path (fixture people files) → `warm_path` populated, `path_count >= 1`, top path has intermediary + strength.
- [ ] Boundary: no paths → empty/"Cold", no event, no crash.
- [ ] Integration: verifies `warmPathsToCompany` is invoked with the company + `topN`, and `WarmPath[]` maps faithfully to the surfaced record (incl. ask_candidate derivation).

## Rollback
Additive — new `surface-intros.ts` + tests; no edits to existing runtime paths (skill write-back wiring is a separate, reversible prose edit). Revert the branch to undo; the helper is inert unless called.
