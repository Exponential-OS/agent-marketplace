## 0.5.0 (XOS-140)

- **Auto-harvest quotable insights:** Stop hook (`hooks/quote-harvester.ts`) scans
  the session transcript (`transcript_path` from Stop payload) at end of every turn,
  extracts aphoristic statements via Gemini Flash (claude fallback), and appends to
  `~/anand-career-os/WIP/branding-product/cyborg-quotes.md`.
- **Three safety-gated sections:**
  - §1 POST FREELY — universal wisdom, safe to post now
  - §2 HOLD — architecture/xOS/cyborg/co-dialectic/IP-revealing; keyword safety net
    forces this classification even when the LLM misclassifies a line as "free"
  - §3 BORROWED — attributed to named third parties
- **Default-to-HOLD:** LLM JSON output with missing/invalid section defaults to §2 HOLD.
- **Idempotent:** watermark tracks last-processed message count; text-based dedup
  prevents duplicate entries in the deck.
- **Fail-safe:** any error (missing transcript, LLM failure, write error) exits 0,
  never blocks session end. Skips sessions with fewer than 4 new messages.
- **Test suite** (23 tests): section routing, architecture→HOLD safety net, idempotency,
  fail-safe for missing transcript / throwing extract function / small session.

# Changelog

## [0.5.1] — 2026-10-27 — personal paths out of a plugin that ships live hooks

This engine wires a `UserPromptSubmit` hook and a `Stop` hook, so its defaults
run on every prompt of every install. Four of them named one maintainer's
machine.

- **`hooks/quote-harvester.ts`** wrote harvested quotes into a path inside a
  private workspace. The new default is the deck `brand-amplification`'s
  quote-flywheel actually reads (`BAE_QUOTE_DECK`, else
  `~/.brand-amplification-state/cyborg-quotes.md`), because this hook is the
  WRITE half of a two-plugin loop — a tidy coordination-owned path would have
  left the halves pointed at different files, so the harvester would run,
  succeed, and feed nothing. `COORDINATION_QUOTE_DECK` overrides.
- **`proactive-daemon.ts`** defaulted `CYBORG_REPO` and `CAREER_OS_REPO` into
  named private directories. `CAREER_OS_REPO` is still read first so existing
  installs keep working; `WORKSPACE_REPO` / `$WORKSPACE_ROOT` / cwd is the new
  chain, and `CYBORG_REPO` / `$CYBORG_ROOT` has **no** default.
- **⚠️ The fix for that introduced a worse bug, caught by running it.**
  `resolve("")` returns the CWD, and `cyborgRepo` is passed to a `git fetch`
  with a **mutating refspec** — so an unset variable would have fetched refs
  into whatever repository the daemon happened to start in. Empty now means
  *disabled*: `readRemoteSubstrateSha` returns `null` before spawning git,
  which is the same fail-open result it already documented.
- **`com.thewhyman.proactive-daemon.plist.template`** and the catalog
  description taught a directory layout named after one machine.

101 tests pass. Verified by execution rather than inspection: all four deck
resolution cases, the legacy/new/cwd daemon chain, and that an unset substrate
repo returns `null` without running git at all.

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
