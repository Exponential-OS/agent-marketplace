# xOS Coordination Engine

**brain-multi-session-sync** — git-backed brain state sync across every Claude session.

## The problem

You have N sessions: local Claude Code, cloud claude.ai, Cursor, Codex, a teammate's session. They share a git-backed workspace. When any session compacts or opens fresh, it loses what the others know. The result: agents that contradict each other, forget active context, and make the human repeat themselves.

## The solution

A session-start hook that pulls the workspace's git state and surfaces a machine-parseable status file as Tier 1.5 context in co-dialectic's waky-waky. Every session opens with the same ground truth.

Works across **local Claude, cloud Claude, Cursor, Codex** — any runtime that runs co-dialectic.

## Install

```bash
claude plugin install coordination@xos
python3 ~/.claude/plugins/cache/xos/coordination/0.1.0/setup.py
```

Run `setup.py` again after each upgrade to refresh the hook script at its stable path.

## Configure

Add to `~/.codialectic/context.json`:

```json
{
  "workspace_root": "/absolute/path/to/your/workspace",
  "coordination_status_rel_path": "AGENT_STATUS.yaml"
}
```

`coordination_status_rel_path` is optional — defaults to `AGENT_STATUS.yaml`.

## Status file format (AGENT_STATUS.yaml convention)

Any YAML file works. The recommended structure:

```yaml
updated: 2026-05-14T21:00:00-07:00

global_facts:
  - fact: "one-line truth all agents must know"
    impact: "what to do differently"
    date: 2026-05-14
    action_required: true   # surfaces as alert in Tier 1.5

agents:
  my-agent:
    role: "what this agent does"
    current_task: "what it's doing now"
    status: IN_PROGRESS      # IN_PROGRESS | STANDBY | BLOCKED | DONE
    last_update: 2026-05-14T21:00:00-07:00
    blocking_others: false
    next_actions:
      - "next thing to do"
```

## How it works

1. `setup.sh` copies `session-start-sync.sh` to `~/.codialectic/coordination/` (stable, version-agnostic path)
2. Registers a `coordination-sync` hook in `~/.codialectic/hooks/session_start.json`
3. On session start, waky-waky runs the hook: `git pull --ff-only origin main` + `cat AGENT_STATUS.yaml`
4. Hook stdout becomes Tier 1.5 context — loaded before the root handoff, after core identity

## Architecture

codi owns the hook contract. This engine owns the git-sync behavior. Your workspace owns the status format. Nothing leaks across layers.
