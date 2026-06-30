# Solo-Session Roles + Heartbeat Liveness + Role Shedding

status: design
slug: solo-session-roles-heartbeat
ticket: XOS-120
repo: ~/aiprojects/agent-marketplace/engines/coordination

## What

Extends the coordination engine (XOS-119 Linear bus) with three behaviours:
(1) a solo session automatically owns ALL cyborg roles by default (computed
dynamically, not stored as permanent state);
(2) each session writes a heartbeat liveness marker (local filesystem primary;
optional single-comment-per-session to Linear as a best-effort broadcast);
(3) effective role coverage is computed as: all_roles minus roles claimed by
OTHER LIVE sessions — so roles auto-reclaim when a dedicated session goes stale.

## Why

The anatomical invariant: a single agent running alone is the whole living body
or nothing. If a solo agent only does "its lane," every other lane flatlines.
Guarantee: beat slow (every role keeps a pulse), never stop (no role flatlines
while any live session exists). The heartbeat on the bus lets cross-machine
sessions detect liveness. Role coverage is dynamic — permanent shed state
violates the invariant because a dead dedicated session would orphan its role.

## Scope

**In:**
- New `session-roles.ts` module:
  - `SessionLivenessMarker` interface:
    `{ session_id, host, started_at, last_heartbeat_at, all_roles, linear_comment_id?, last_linear_mutation_at? }`
    — `last_linear_mutation_at` is persisted in the marker so the throttle
    survives the short-lived CLI process restarts.
    — `all_roles` is the FULL set this session can cover (["*"] shorthand for
    "all known roles"); NOT the filtered set (that's computed dynamically).
  - `writeSessionHeartbeat(opts)` — writes/updates the local marker file.
    When `LINEAR_COORDINATION_ISSUE_ID` is set AND `LINEAR_API_KEY` is set:
    (a) on first call, posts one new comment (stores the returned comment ID
    in the local marker); (b) on subsequent calls, calls `commentUpdate` to
    EDIT the same comment (no new comment per call = no spam). Both paths
    fire-and-forget with a hard 500 ms timeout; never block the prompt path.
    Throttled: only triggers the Linear mutation when ≥5 min since the last
    mutation. Fails open on any error.
  - `readActiveSessions(dataRoot, stalenessMinutes, env?)` — scans
    `.cyborg-state/coordination/sessions/` for all `<session_id>.json` files,
    returns only those with `last_heartbeat_at` within the stale threshold.
  - `isSoloSession(sessionId, dataRoot, stalenessMinutes)` — returns true iff
    this session is the only live session in the local session directory.
  - `resolveRoles(sessionId, allRoles, dataRoot, stalenessMinutes)` —
    DYNAMICALLY computes effective roles each call:
    `effectiveRoles = allRoles.filter(r => no other LIVE session owns r as a
    dedicated (non-"*") role)`. No permanent mutation. A dedicated session going
    stale means its roles fall back to the solo/covering session automatically.
  - `detectRoleOwner(role, dataRoot, stalenessMinutes)` — returns the
    session_id of the LIVE session whose `all_roles` contains ONLY that role
    (dedicated session), or null if covered by a solo session or unclaimed.
- Integration into `linear-bus-pull.ts` (UserPromptSubmit hook):
  - After bus pull succeeds (or fails open), call `writeSessionHeartbeat` with
    the current session's `all_roles` (from env `LINEAR_SESSION_ROLES` or
    `["*"]` by default) — fire and forget.
  - Call `resolveRoles` to compute effective roles; append a one-liner to
    `additionalContext` showing current coverage (e.g.
    `ROLES: all (solo)` or `ROLES: codi,brand (2/4 dedicated)`), but only when
    roles differ from the previous prompt (avoid noise).
- New `hooks/session-start-roles.ts` file — minimal; exports a single function
  that writes the initial heartbeat synchronously (before any prompt fires the
  hook). Called from a `SessionStart` hook if/when the host supports that event;
  falls back gracefully when the hook event is unsupported.
  - Note: Claude Code currently fires `UserPromptSubmit` but not `SessionStart`
    as a distinct event. The session-start function is exported for future use
    and can also be invoked by the `setup.py` bootstrap.
- `hooks/hooks.json` unchanged (UserPromptSubmit is the existing integration
  path; no new hook events added yet until the runtime exposes SessionStart).
- New tests in `test/session-roles.test.ts`:
  - `isSoloSession` — no siblings → true; one live sibling → false; one stale
    sibling → true
  - `readActiveSessions` — filters by freshness threshold
  - `writeSessionHeartbeat` — creates marker; second call updates timestamp
    without creating a new file; Linear path skipped when env absent
  - `resolveRoles` — solo → returns allRoles; non-solo with live dedicated
    sibling → filters out that role; sibling goes stale → role reclaimed
  - `detectRoleOwner` — returns dedicated session or null
  - Fail-open: no API key, fetch throws, no `LINEAR_COORDINATION_ISSUE_ID`
- CHANGELOG entry and plugin version bump: 0.3.0 → 0.4.0

**Out:**
- Automated heartbeat polling timer — per-prompt cadence is sufficient
- Cross-machine role-shed detection from LINEAR comment body parsing — the Linear
  write is a broadcast, not a read-for-coordination substrate (reading back from
  Linear for role decisions defers to a follow-on ticket; local filesystem
  is primary for this ticket)
- XOS-149 (codi internal-state liveness in `~/.codialectic`) — separate ticket
- Role name catalogue — arbitrary strings via `LINEAR_SESSION_ROLES` env var
- Changing the `UserPromptSubmit` hook to block/synchronize on the Linear write
  (the hook DOES await up to 500 ms before allowing process.exit — not truly
  fire-and-forget — but the prompt path waits at most 500 ms regardless)

**Implementation constraints (from judge review):**
- `last_linear_mutation_at` must be stored in the marker file (not memory-only)
  to survive CLI process restarts between prompts.
- The hook CLI entry point must `await Promise.race([heartbeat(), 500ms timer])`
  before `process.exit(0)` — a background promise is killed on exit.
- `resolveRoles` rule: a DEDICATED session (one whose `all_roles` does NOT
  contain `"*"`) NEVER sheds a role that is in its own `all_roles`. Solo ("*")
  sessions shed roles to dedicated live siblings. If two dedicated sessions
  claim the same role, the older session (lower `started_at`) wins and the
  newer one keeps its role too (both claim = tie, both keep, no flatline).

## Acceptance criteria

- [ ] `resolveRoles("session-A", ["codi","brand","career"], dataRoot, 30)` on a
      fresh dataRoot (no siblings) returns all three roles
- [ ] When session-B's marker exists with `all_roles: ["codi"]` and a fresh
      heartbeat, `resolveRoles("session-A", ...)` returns `["brand","career"]`
- [ ] When session-B's marker is stale (> 30 min), `resolveRoles("session-A",...)`
      returns all three roles (session-B evicted)
- [ ] `writeSessionHeartbeat` creates `<dataRoot>/coordination/sessions/<id>.json`
      with the correct schema on first call
- [ ] Second call to `writeSessionHeartbeat` updates `last_heartbeat_at` without
      creating a duplicate file
- [ ] When `LINEAR_COORDINATION_ISSUE_ID` and `LINEAR_API_KEY` are absent,
      `writeSessionHeartbeat` writes locally and does NOT call fetch
- [ ] When fetch throws during the Linear write, `writeSessionHeartbeat` catches
      it and returns a warn string (does not rethrow)
- [ ] `runLinearBusPull` (integration) includes a ROLES line in `additionalContext`
      when roles are non-empty and changed
- [ ] All existing `linear-bus.test.ts` tests pass (no regression)
- [ ] `bun test` in the engine directory exits 0

## Test plan

- [ ] Unit tests in `test/session-roles.test.ts` covering every acceptance
      criterion above using tmp dirs (same pattern as `linear-bus.test.ts`)
- [ ] `bun test` in the engine directory exits 0 (full suite)
- [ ] Manual smoke: install coordination@xos after merge, open a session,
      confirm `~/.cyborg-state/coordination/sessions/<session-id>.json` is created

## Rollback

All new files (`session-roles.ts`, `hooks/session-start-roles.ts`,
`test/session-roles.test.ts`) are additive. The `linear-bus-pull.ts` integration
is wrapped in try/catch (existing fail-open pattern). Rollback = revert the
diff; the bus pull hook continues as 0.3.0 with no breakage.
