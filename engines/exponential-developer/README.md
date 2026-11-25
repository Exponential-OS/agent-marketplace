# exponential-developer

`exponential-developer` packages the xHumanOS exponential-developer engine as a cross-xOS Claude plugin. It installs the canonical `ship-feature` skill and the `/ship-feature` command alias for the agentic SDLC pipeline used across xHumanOS, xTeamOS, and xFamilyOS development.

Install it through the xOS marketplace once registered. The plugin declares `workspace_binding.mode = "global"` so `/ship-feature` resolves from every cwd/repo; this is cross-xOS developer tooling, not a workspace-bound product plugin.

## Prerequisites — read before installing

`/ship-feature` **will not run without these.** Stage 0 exits 1 before any code is touched.

| Requirement | Why it is needed | What happens without it |
|---|---|---|
| **A Linear account, workspace and team** | Stage 0 claims the work item on Linear so two machines cannot build the same ticket. | `/ship-feature` takes a *required* Linear ticket id as its first argument. There is nothing to pass it. |
| **`LINEAR_API_KEY` exported** | `sdlc-work-claim` writes the claim and its heartbeat through the Linear API. | The rule exits 1 with a remediation line. **There is no local fallback** — local-only state cannot coordinate claims across machines. |
| **A `claude` CLI authenticated via OAuth** | Gate-A.7 runs the design review through `claude -p`. | The gate records `UNREACHABLE`, which **blocks** the build. Fail-closed is deliberate. |
| **A cross-family reviewer CLI (`gemini` or `codex`)** | Stage 6 cross-family review is NON-OPTIONAL for every run — `SKILL.md:448`: "there is no decision to skip". | No cross-family reviewer is reachable, and the Stage 8 merge gate refuses a PR produced without this stage. |
| **`gh`, authenticated** | The pipeline opens the PR with `gh pr create` and merges it with `gh pr merge --auto --squash`. | The pipeline cannot reach or clear its PR stage. |

If your account cannot reach the default design-review model, set `DESIGN_REVIEW_MODEL` to one it can. This is currently the only escape from a blocked Gate-A.7, and until this commit it was named nowhere outside `design-review/run.ts` — not in `SKILL.md`, not here. See XOS-413.

> **Scope note, stated plainly.** This pipeline was built for a multi-machine agent fleet and its coordination guarantees assume one. A single developer on one laptop still pays the full Linear dependency for a cross-machine collision problem they do not have. Whether that remains the right trade is tracked in XOS-414.

## Ownership

This plugin has a **designated owner session**. Findings go to the owner; they are not fixed
in whichever session happened to notice them.

| | |
|---|---|
| **Where ownership is recorded** | `anand-career-os/AGENT_STATUS.yaml` → `agents.exponential-developer`, anchored by Linear **XOS-412** |
| **How to report a finding** | Linear team **XOS**, label **`exponential-developer`**, **and assign it** |
| **Why "and assign it"** | The coordination BUS queries `viewer.assignedIssues` with no label filter. A labelled-but-unassigned finding is invisible to the owner. XOS-417 sat unseen for three days exactly this way. |

**This points at the record rather than naming a session, deliberately.** Ownership can be
reassigned; a name hardcoded here would go stale silently, which is the same class of defect
as the stale paths XOS-353 removed from this plugin.

**A bypass is a reportable finding, not a private shortcut.** If you did software work without
`/ship-feature`, or skipped a stage, that is evidence of a product gap — this plugin is shipped
to people who have no agent to improvise around it for them. File it.

## Contents

- `skills/ship-feature/SKILL.md` - canonical Agentic SDLC pipeline skill body.
- `commands/ship-feature.md` - thin command alias that loads the skill.
- `rules/` - bundled SDLC runtime gates invoked by the skill via `${CLAUDE_PLUGIN_ROOT}`.

## Runtime paths

The SDLC rules invoked by this skill (`sdlc-work-claim`, `sdlc-worktree-isolation`, `ship-feature-gate`) are bundled into this plugin and invoked through `${CLAUDE_PLUGIN_ROOT}`, so the plugin carries its own gate code and no install depends on paths outside it.

**Portable paths are not the same as portable dependencies.** The rules resolve anywhere; `sdlc-work-claim` still requires the external Linear account and key listed under Prerequisites. This line previously claimed installs were "portable across machines" with no such qualification, which reads as "works anywhere" and is the reason XOS-414 was filed.
