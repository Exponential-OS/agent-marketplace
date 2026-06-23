# sdlc-work-claim

## Why

`sdlc-work-claim` enforces Stage 0 of the agentic SDLC pipeline: work allocation before spec, code, PR, merge, or deploy.

It exists because on 2026-06-09 two agent sessions both worked and shipped XOS-25. One shipped a CI-red build that the other session had already fixed. A local ledger cannot prevent that across multiple machines, so Linear is the source of truth.

## Rule

Before any pipeline work starts, the Linear issue must be in `In Progress` and have exactly one active claim comment held by this session with a fresh heartbeat.

Claim comment format:

```text
🤖 SDLC-CLAIM session=<sid> host=<host> branch=<branch> worktree=<path> started=<iso> heartbeat=<iso>
```

## Lifecycle

1. `check`: read Linear issue state and the active claim comment. Block if another live session owns the work.
2. `claim`: set the Linear issue to `In Progress` and upsert the `SDLC-CLAIM` comment for this session.
3. `heartbeat`: refresh the claim heartbeat while work continues. If this session does not own the claim, return PASS with a WARN message.
4. `release`: neutralize the active claim comment when this session finishes or abandons the work. It does not move the issue to Done.

## Dead-Agent Semantics

`STALE_MIN=30`. A claim is live when `now - heartbeat < 30 minutes`. At 30 minutes or older, the claim is stale and reclaimable after confirming no new commits landed from the old branch.

Stale means the gate will not block takeover. It does not prove the old work is safe to ignore.

## Linear API Key

The handler requires `LINEAR_API_KEY`.

If it is unset, the handler exits 1 with:

```text
export LINEAR_API_KEY=<key> (Linear → Settings → API → Personal API keys); cross-machine claim coordination cannot work without it.
```

There is no local fallback. Local-only state cannot coordinate work claims across machines.

## Litmus

Before any pipeline work: is this work unit claimed `In Progress` by THIS session with a fresh heartbeat? If another live session holds it, STOP.

## Files

- `handler.ts`: canonical Bun TypeScript gate.
- `tests.ts`: Bun tests with an injected Linear GraphQL fetch stub.
- `manifest.json`: rule manifest.
- `~/.cyborg-enforcement-log.jsonl`: one-line enforcement log.
