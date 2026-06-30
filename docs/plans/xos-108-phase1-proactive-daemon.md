# XOS-108 Phase-1: Proactive Daemon — Polling MVP

```
status: build-ready
slug:   xos-108-phase1-proactive-daemon
ticket: XOS-158 (sub-ticket of XOS-108)
repo:   ~/aiprojects/agent-marketplace
date:   2026-06-30
```

---

## BUILD vs DEPLOY SPLIT (read first)

This spec governs Phase-1 of the proactive-daemon.

**AI faculty (this PR):** builds `proactive-daemon.ts` + mocked tests + plist template + this doc.

**Human faculty (deploy-time gate):** resolves the 3 UNRESOLVED decisions below and activates via `launchctl load`. Nothing in this PR installs, starts, or activates the daemon.

---

## ⚠ HUMAN DEPLOY DECISIONS — UNRESOLVED ⚠

These three decisions are yours. They are documented here, not decided here.

| # | Decision | Options | Stakes | Why human-only |
|---|----------|---------|--------|---------------|
| 1 | **HOST** | (A) Mac-mini local (always-on, $0 infra, quota-wall risk) / (B) Cloud VM Railway/Fly.io (~$5/mo, no quota-wall) / (C) Stay reactive (no daemon) | T3 — infrastructure commitment | Hardware, power, and cost are your choices |
| 2 | **COST MODEL** | (A) Subscription (`claude -p`, quota-wall at ~4hr, $0 marginal) / (B) API key (metered, $256 lesson from 2026-05) / (C) Hybrid (subscription interactive + API daemon) | T3 — financial + architectural | Both documented failure modes; you weigh them |
| 3 | **SECURITY BLAST-RADIUS** | Accept: always-on process + `LINEAR_API_KEY` in env + `--dangerously-skip-permissions` on every spawn = standing blast radius if compromised. Mitigations: user-scope launchd (not root), no inbound network in Phase-1, read-only daemon on cyborg substrate, secrets NOT in the plist template. | T3 — security boundary | Explicit acceptance required; cannot be AI-decided |

**Activation command (human executes after decisions are made):**
```bash
# 1. Edit the plist template with your real values
cp engines/coordination/com.thewhyman.proactive-daemon.plist.template \
   ~/Library/LaunchAgents/com.thewhyman.proactive-daemon.plist
# 2. Edit ~/Library/LaunchAgents/com.thewhyman.proactive-daemon.plist
#    — set LINEAR_API_KEY, YOUR_USERNAME, HOSTNAME
# 3. Load
launchctl load ~/Library/LaunchAgents/com.thewhyman.proactive-daemon.plist
```

---

## What

A Bun/TypeScript polling daemon (`proactive-daemon.ts`) in the coordination engine that:

1. Polls every N minutes (default 5 min, configurable via `DAEMON_POLL_INTERVAL_MS`).
2. On each cycle:
   - Checks Linear bus for **urgent/assigned delta** via `queryLinearBusDelta()` (reuse from `linear-bus.ts`, XOS-119).
   - Checks cyborg **origin/main substrate SHA** (reuses substrate-rehydrate pattern from XOS-112).
   - Writes a **heartbeat marker** per XOS-120 (`writeSessionHeartbeat()`), every cycle regardless of fire conditions.
3. On genuine fire-condition (new Urgent ticket OR substrate SHA change):
   - Enforces **spawn-rate ceiling** (default ≤3/hr) before spawning.
   - Builds a context prompt from the fire conditions.
   - Spawns `claude --dangerously-skip-permissions -p <prompt>` (detached process).
4. **Fail-safe**: any error → log + continue, never crash the loop, never spawn on empty condition.
5. Writes a **liveness file** (`~/.cyborg-state/daemon/liveness.json`) on every cycle for external monitoring.

Also ships:
- `com.thewhyman.proactive-daemon.plist.template` — launchd plist template (NOT installed).
- Mocked tests covering all behavioral invariants.

---

## Why

The biggest NSM-denominator leak in the cyborg swarm today: Anand must prompt every action. An always-on daemon closes the human-courier gap for Urgent Linear events and substrate changes — the swarm self-initiates on real fire conditions, not just when Anand opens Claude.

---

## Scope

**In:**
- `proactive-daemon.ts` — polling loop, fire-condition detection, spawn gate, heartbeat, liveness.
- `com.thewhyman.proactive-daemon.plist.template` — launchd template (template only).
- `docs/plans/xos-108-phase1-proactive-daemon.md` — this spec.
- `test/proactive-daemon.test.ts` — mocked tests.

**Out:**
- Actual daemon activation / launchctl load (human-only gate).
- GNAP message-based wake conditions (Phase 2, requires XOS-111).
- HTTP webhook listener (Phase 2, requires Linear Business Pro).
- Multi-role daemon instances (Phase 3).
- Letta/stateful memory layer (Phase 4).
- XOS-107 fix (separate ticket — prerequisite for safe production use).
- XOS-44 shared-primary isolation (separate ticket — prerequisite).

---

## Acceptance Criteria

- [x] `proactive-daemon.ts` reuses `queryLinearBusDelta()` from `linear-bus.ts`.
- [x] `proactive-daemon.ts` reuses `writeSessionHeartbeat()` from `session-roles.ts`.
- [x] Poll interval configurable via `DAEMON_POLL_INTERVAL_MS`; minimum 60 s enforced.
- [x] Spawn-rate ceiling configurable via `DAEMON_SPAWN_RATE_CEILING`; default ≤3/hr.
- [x] Heartbeat written on every cycle via `writeSessionHeartbeat()`.
- [x] Fire conditions: `linear-delta` (urgent issues) and `substrate-change` (SHA diff).
- [x] Fail-safe: any error inside the loop is caught, logged, and loop continues.
- [x] Never spawn on empty fire condition set.
- [x] Liveness file written on every cycle.
- [x] No personal data or secrets hardcoded in the template or daemon code.
- [x] Plist template is a template file only — NOT installed by this PR.
- [x] All 3 human deploy decisions documented as UNRESOLVED in this spec.

---

## Test Plan

Tests in `test/proactive-daemon.test.ts` use mocked I/O (no real spawns, no real Linear calls, no real git ops, no always-on loop execution):

- **fire-condition detection**: urgent Linear issue → fires linear-delta; substrate SHA change → fires substrate-change; neither present → empty fires array.
- **no-empty-spawn**: `spawnClaudeSession` with `fires=[]` returns `reason: "no-fires"` without spawning.
- **spawn-rate ceiling**: mock 3 recent spawns → next spawn returns `reason: "rate-limited"`.
- **fail-safe on error**: `pollOnce` throwing inside `runDaemon` → loop continues, error logged.
- **heartbeat write**: `writeSessionHeartbeat` called on every cycle regardless of fires.

---

## Architecture (reuse map)

```
proactive-daemon.ts
  ├── queryLinearBusDelta()     ← linear-bus.ts (XOS-119) — REUSED
  ├── hasLinearDelta()          ← linear-bus.ts (XOS-119) — REUSED
  ├── writeSessionHeartbeat()   ← session-roles.ts (XOS-120) — REUSED
  └── substrate SHA diff        ← substrate-rehydrate-check.ts pattern (XOS-112) — REUSED
```

---

## Rollback

This PR adds new files only (no modification to existing files). Rollback = close or revert the PR. No installed process, no launchd plist, no running daemon.

---

## Prerequisites (before production activation)

These are NOT in scope for this PR — they are blocking pre-conditions documented for the human:

| Prerequisite | Status | Why blocking |
|---|---|---|
| XOS-107 (Constitution clobber-guard) | Backlog | An always-on daemon loading a clobbered constitution mass-propagates corruption. Must be Done before activation. |
| XOS-44 (shared-primary isolation) | Held | Daemon spawning sessions that mutate shared `~/cyborg` multiplies collision rate. Should land before or jointly with activation. |
| XOS-120 (heartbeat protocol) | In Review → Done | Daemon reuses its heartbeat functions — needs to be merged first. |

---

## Phase roadmap (context)

| Phase | Scope | Status |
|---|---|---|
| Phase 0 | Prerequisites: XOS-107, XOS-44, XOS-120 | In flight |
| Phase 1 | This PR: polling daemon MVP | Built, not activated |
| Phase 2 | Push bus: Linear webhooks + GNAP messages (XOS-111) | Future |
| Phase 3 | Multi-role instances + role-shedding across daemons | Future |
| Phase 4 | Letta stateful memory layer | Optional / future |
