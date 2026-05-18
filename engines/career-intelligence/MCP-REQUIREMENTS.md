<!-- product-vs-solution: example -->
# MCP Requirements — career-intelligence@xos


## The confidence ladder (NEW in this release)

New users want to WATCH the browser do irreversible things (post, send DM, submit form) before trusting cloud automation. This aligns with the Irreversible-Action Invariant in the Cyborg Constitution.

**Per-workflow browser defaults** (customer-editable at `~/.codialectic/browser-prefs.json`):

- **Setup workflows** → browserbase (easy, cloud, fast)
- **Posting / sending / submitting** → chrome-devtools-mcp (Chrome Canary, local, **visible** — user can watch and intervene)
- **Anonymous web reads** → playwright-ms (no auth needed)

After 10 successful runs of a chrome-devtools workflow, the plugin nudges: "Confident now? Graduate to browserbase?" One-time suggestion, customer can decline forever.

This is the design — graceful confidence-building, not forced trust.

Run `codi mcp doctor` to verify.

## Required (2)

| MCP | Used by | Install |
|---|---|---|
| `linkedin-community` | network-intelligence, outreach-composer, interviewer-research | `codi mcp setup linkedin-community` |
| `playwright-ms` | job-search-scheduler (ATS scans — fast, low-token, anonymous) | `codi mcp setup playwright` |

## The cascade for authenticated browsing (optional, only if you need LinkedIn People tab + in-app DMs)

**Primary:** `browserbase` (FREE Hobby tier — ~60 browser-min/mo, sufficient for casual use)
**Fallback when quota exhausted:** `chrome-devtools-mcp` (FREE, UNLIMITED, local — includes launcher script)
**Upgrade (rare):** Browserbase $39/mo Starter only if you exceed 60 min/mo

Both can coexist — use browserbase first for ease, fall back to chrome-devtools when free tier runs out.

## Not required

- `composio` — career-intel doesn't publish (that's social-distribution@xos)
- `perplexity` — Playwright + Claude's WebSearch/WebFetch covers interviewer research at $0
- `supabase`, `gitkraken`, `vercel` — not used

## Adding a new MCP

Drop `recipes/<name>.json` in `skills/career-mcp-setup/recipes/`. Both doctor + setup pick it up. The plugin evolves as MCP needs change.
