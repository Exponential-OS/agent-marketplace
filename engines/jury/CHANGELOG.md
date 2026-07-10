## [0.2.0] — 2026-07-10 — THE-541: reliable + self-updating

- OAuth-only (removed all API-key fallback paths); missing CLI → fail-hard.
- codex lane: -c model_reasoning_effort with self-healing ladder (step down on capacity).
- Model DISCOVERY wins: agy models → latest Flash/Pro; env pins are fallback-only (stale ~/cyborg pin no longer beats discovery).
- Per-lane transparency: [jury] <family>: <cli> <version> / <model>.
- Fixed a safe-regex false-positive in the agy-models parser (linear rewrite).

# Changelog

## [0.1.0] - 2026-07-01

Initial standalone jury plugin — cross-family cascade-then-jury reviewer extracted from co-dialectic judge-panel (jury-core, free). XOS-184.
