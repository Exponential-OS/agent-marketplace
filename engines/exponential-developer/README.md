# exponential-developer

`exponential-developer` packages the xHumanOS exponential-developer engine as a cross-xOS Claude plugin. It installs the canonical `ship-feature` skill and the `/ship-feature` command alias for the agentic SDLC pipeline used across xHumanOS, xTeamOS, and xFamilyOS development.

Install it through the xOS marketplace once registered. The plugin declares `workspace_binding.mode = "global"` so `/ship-feature` resolves from every cwd/repo; this is cross-xOS developer tooling, not a workspace-bound product plugin.

## Contents

- `skills/ship-feature/SKILL.md` - canonical Agentic SDLC pipeline skill body.
- `commands/ship-feature.md` - thin command alias that loads the skill.
- `rules/` - bundled SDLC runtime gates invoked by the skill via `${CLAUDE_PLUGIN_ROOT}`.

## Runtime paths

The SDLC rules invoked by this skill (`sdlc-work-claim`, `sdlc-worktree-isolation`, `ship-feature-gate`) are bundled into this plugin and invoked through `${CLAUDE_PLUGIN_ROOT}` so installs are portable across machines.
