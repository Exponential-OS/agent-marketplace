# Changelog

## 0.5.0 - 2026-06-29

- Make `/ship-feature` cross-family review unskippable at merge: Stage 6 now emits the canonical `ship-feature-judge-receipt:v1` receipt, Stage 7 requires it in the PR body, and `ship-feature-gate` blocks `gh pr merge` when the target PR lacks the receipt while failing open with a warning on PR-body fetch errors. (XOS-138)

## 0.4.1 - 2026-06-28

- Fix Stage 5.5 screenshot-attach mechanism: commit PNGs to the tracked `docs/verify/<ticket>/` path so they render in the PR "Files changed" tab (the proven-reliable method for a PRIVATE repo). Replaces the prior `github.com/user-attachments` 200-gate, which the bus proved is not reliably scriptable by a cell (raw/release URLs 404 for a private-repo viewer; inline user-attachments needs web-UI drag-drop). (XOS-118 follow-up)

## 0.4.0 - 2026-06-28

- Add Stage 5.5 E2E + VISUAL verification, Stage 5.6 real `/simplify`, and Stage 5.7 targeted verification rerun to `/ship-feature`. (XOS-118)
- Document the light XOS-112 reload-on-upgrade preflight coupling for required `/ship-feature` upgrades.

## 0.3.0 - 2026-06-23

- Removed the fable-5 reasoning gate (claude-fable-5 unavailable; reintroduced by mistake in 0.2.0). Reasoning validation now via cross-family judge-panel. (XOS-59 / XOS-56 follow-up)

## 0.2.0 - 2026-06-10

- Self-contained: bundled sdlc-work-claim, sdlc-worktree-isolation, ship-feature-gate rules + fable5-reasoning-validate script into the plugin; skill now invokes them via `${CLAUDE_PLUGIN_ROOT}` (portable on any machine, no `~/cyborg` dependency).

## 0.1.0 - 2026-06-10

- Package the canonical `ship-feature` Agentic SDLC skill as the cross-xOS `super-developer` plugin.
- Add the `/ship-feature` command alias.
- Declare global workspace binding so `/ship-feature` resolves from every cwd/repo.
