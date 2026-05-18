---
name: sde-mcp-doctor
description: >
  Diagnose MCP server availability for social-distribution. Probes the MCPs
  this plugin needs (composio for LinkedIn publish, browserbase for authenticated
  browsing, playwright for content URL checks), reports which are working/missing,
  and surfaces install commands.
triggers:
  - codi mcp sde
  - codi mcp doctor sde
  - mcp sde
  - sde mcp doctor
  - check sde mcps
metadata:
  version: "1.0.0"
  author: "Anand Vallamsetla"
---

<!-- product-vs-solution: example -->

### BEGIN SDE-MCP-DOCTOR ###

# MCP Doctor (social-distribution) — Required vs. Installed

## Output

```
━━━ MCP Doctor (social-distribution) · Status ━━━

REQUIRED (publishing breaks without these)
  ✓ composio (LinkedIn)  — installed, COMPOSIO_API_KEY + COMPOSIO_SESSION_ID set
  ✓ playwright-ms        — installed, working (content URL resolution, web reads)
  ✗ browserbase OR chrome-devtools-mcp — at least ONE required for Substack publish
      browserbase   (~$39/mo)              → codi mcp setup sde browserbase
      chrome-devtools (free, launcher)     → codi mcp setup sde chrome-devtools

OPTIONAL (per spoke)
  ◯ composio (Reddit)    — only if you post to Reddit
      → codi mcp setup sde composio-reddit
  ◯ composio (X)         — only if you post to X/Twitter (LinkedIn-only customers skip)
      → codi mcp setup sde composio-x

OUT OF SCOPE (social-distribution does NOT use these)
  ◯ linkedin-community   — that's career-intel's MCP (profile reads, not publishing)
  ◯ perplexity, supabase, gitkraken
```

## How it works

1. Discover wired MCPs (~/.mcp.json, claude mcp list).
2. Read this plugin's `MCP-REQUIREMENTS.md`.
3. Probe each:
   - composio (HTTP): GET the MCP URL with X-API-Key, expect 200
   - playwright-ms (stdio): tools/list JSON-RPC
   - browserbase (HTTP): tools/list with API key
   - chrome-devtools-mcp: check port 9222
4. Render report.
5. Save to `~/.codialectic/mcp-status-sde.json`.

## Relationship to other skills

- `sde-mcp-setup` — installs missing MCPs.
- `sde-onboarding` — calls sde-mcp-doctor as Phase 0.
- `social-distribution-engine` — runs `sde-mcp-doctor --quick` before publish.

### END SDE-MCP-DOCTOR ###
