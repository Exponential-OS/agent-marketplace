# Changelog

## 0.3.0

- Resolved Linear bus team/project from the workspace `wip_goal_map` with env overrides, longest-prefix WIP routing, and fail-safe per-session caching.
- Added optional Linear project scoping for assigned, comment, and urgent issue queries while preserving no-project query shapes.

## 0.2.0

- Relocated the verified Linear bus pull adapter and `UserPromptSubmit` hook into the installed coordination engine.
- Added Claude hook registration so each prompt can pull Linear work-bus context fail-open.
