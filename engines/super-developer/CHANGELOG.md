# Changelog

## 0.2.0 - 2026-06-10

- Self-contained: bundled sdlc-work-claim, sdlc-worktree-isolation, ship-feature-gate rules + fable5-reasoning-validate script into the plugin; skill now invokes them via `${CLAUDE_PLUGIN_ROOT}` (portable on any machine, no `~/cyborg` dependency).

## 0.1.0 - 2026-06-10

- Package the canonical `ship-feature` Agentic SDLC skill as the cross-xOS `super-developer` plugin.
- Add the `/ship-feature` command alias.
- Declare global workspace binding so `/ship-feature` resolves from every cwd/repo.
