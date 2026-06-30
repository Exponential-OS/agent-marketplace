# Changelog

## 0.4.0 (XOS-120)

- **Solo-session roles:** a session with no live siblings automatically covers
  all known cyborg roles by default (`resolveRoles` — dynamic, not permanent
  state mutation). Roles auto-reclaim when a dedicated sibling goes stale.
- **Heartbeat liveness:** `writeSessionHeartbeat` writes a per-session marker
  to `.cyborg-state/coordination/sessions/<session_id>.json` on every prompt
  (via the existing `UserPromptSubmit` hook). When `LINEAR_COORDINATION_ISSUE_ID`
  + `LINEAR_API_KEY` are set, also broadcasts a single heartbeat comment to a
  Linear issue (first call creates; subsequent calls edit the same comment —
  no spam). Linear write is throttled ≥5 min and capped at 500 ms.
- **Role coverage context:** `additionalContext` now includes a `ROLES:` line
  when sibling sessions are detected, showing this session's effective role set.
- **New exports:** `session-roles.ts` (core liveness protocol),
  `hooks/session-start-roles.ts` (future `SessionStart` hook wiring).
- **Config:** `LINEAR_SESSION_ROLES` (comma-separated role names; default `*`
  for generalist); `LINEAR_COORDINATION_ISSUE_ID` (optional Linear issue for
  cross-machine heartbeat broadcast); stale threshold default = 30 min.

## 0.3.0

- Resolved Linear bus team/project from the workspace `wip_goal_map` with env overrides, longest-prefix WIP routing, and fail-safe per-session caching.
- Added optional Linear project scoping for assigned, comment, and urgent issue queries while preserving no-project query shapes.

## 0.2.0

- Relocated the verified Linear bus pull adapter and `UserPromptSubmit` hook into the installed coordination engine.
- Added Claude hook registration so each prompt can pull Linear work-bus context fail-open.
