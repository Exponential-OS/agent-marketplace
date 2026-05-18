<!-- product-vs-solution: example -->
# MCP Requirements — social-distribution@xos


## The confidence ladder (NEW in this release)

New users want to WATCH the browser do irreversible things (post, send DM, submit form) before trusting cloud automation. This aligns with the Irreversible-Action Invariant in the Cyborg Constitution.

**Per-workflow browser defaults** (customer-editable at `~/.codialectic/browser-prefs.json`):

- **Setup workflows** → browserbase (easy, cloud, fast)
- **Posting / sending / submitting** → chrome-devtools-mcp (Chrome Canary, local, **visible** — user can watch and intervene)
- **Anonymous web reads** → playwright-ms (no auth needed)

After 10 successful runs of a chrome-devtools workflow, the plugin nudges: "Confident now? Graduate to browserbase?" One-time suggestion, customer can decline forever.

This is the design — graceful confidence-building, not forced trust.

Run `codi mcp doctor sde` to verify.

## The cascade for authenticated browsing (Substack publish, LinkedIn People tab, OAuth setup flows)

**Primary:** `browserbase` (FREE Hobby tier — ~60 browser-min/mo)
  - Easy setup (~5 min, 2 env vars). No local Chrome dance.
  - Fits typical casual usage (~50-100 min/mo from setup + monthly publish).

**Automatic fallback when browserbase quota exhausted:** `chrome-devtools-mcp` (FREE, UNLIMITED, local)
  - Ships with `launchers/launch-chrome-devtools-mcp.sh` — detects Chrome Canary or regular Chrome, launches port 9222 + persistent profile (auth survives reboots).
  - Optional macOS LaunchAgent (auto-start on boot).
  - Trade: more setup pain, but unlimited free use.

**Upgrade path (rare):** $39/mo Browserbase Starter — only if you genuinely exceed ~60 min/mo. Most customers never hit this; the cascade above covers them.

The MCP-Auto-Installer pattern: install browserbase free tier first as the *setup bootstrap*. If you blow through 60 min on heavy-publish months, install chrome-devtools as the *steady-state runner*. Both can coexist.

## Required (2)

| MCP | Used by | Install |
|---|---|---|
| `composio` (LinkedIn) | social-distribution-engine, campaign-engine, linkedin-distribution-module | `codi mcp setup sde composio-linkedin` |
| `playwright-ms` | content-url-resolution-check (Gate 4), web reads | `codi mcp setup sde playwright` |

## At least ONE required (cascade above applies)

| MCP | Best for | Install |
|---|---|---|
| `browserbase` (free Hobby tier) | Casual users; easy setup | `codi mcp setup sde browserbase` |
| `chrome-devtools-mcp` (free, unlimited) | Heavy use OR quota-conscious users | `codi mcp setup sde chrome-devtools` |

## Optional spokes

| MCP | When | Install |
|---|---|---|
| `composio` (Reddit) | Reddit spoke | `codi mcp setup sde composio-reddit` |
| `composio` (X/Twitter) | X spoke | `codi mcp setup sde composio-x` |

## Not required

- `linkedin-community` — that's career-intel's (profile reads)
- `perplexity`, `supabase`, `gitkraken`, `vercel` — none needed
