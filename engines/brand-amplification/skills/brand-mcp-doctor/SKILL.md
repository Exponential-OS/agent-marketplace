---
name: brand-mcp-doctor
description: >
  Diagnose MCP server availability for brand-amplification. Probes the MCPs
  this plugin needs (composio for LinkedIn publish, browserbase for authenticated
  browsing, playwright for content URL checks), reports which are working/missing,
  and surfaces install commands.
triggers:
  - brand mcp doctor
  - brand mcp
  - mcp brand
  - check brand mcps
  - check my brand mcps
metadata:
  version: "1.0.0"
  author: "Anand Vallamsetla"
---

<!-- product-vs-solution: example -->

### BEGIN BRAND-MCP-DOCTOR ###

# MCP Doctor (brand-amplification) — Required vs. Installed

## Output

```
━━━ MCP Doctor (brand-amplification) · Status ━━━

REQUIRED (publishing breaks without these)
  ✓ composio (LinkedIn)  — installed, COMPOSIO_API_KEY + COMPOSIO_SESSION_ID set
  ✓ playwright-ms        — installed, working (content URL resolution, web reads)
  ✗ browserbase OR chrome-devtools-mcp — at least ONE required for Substack publish
      browserbase   (~$39/mo)              → brand mcp setup browserbase
      chrome-devtools (free, launcher)     → brand mcp setup chrome-devtools

OPTIONAL (per spoke)
  ◯ composio (Reddit)    — only if you post to Reddit
      → brand mcp setup composio-reddit
  ◯ composio (X)         — only if you post to X/Twitter (LinkedIn-only customers skip)
      → brand mcp setup composio-x

OUT OF SCOPE (brand-amplification does NOT use these)
  ◯ linkedin-community   — that's career-intelligence's MCP (profile reads, not publishing).
                            Will move to relationship-intelligence-engine when extracted.
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
5. Save to `~/.codialectic/mcp-status-brand.json`.

## Relationship to other skills

- `brand-mcp-setup` — installs missing MCPs.
- `sde-onboarding` — calls brand-mcp-doctor as Phase 0 (the distribution sub-engine inside brand-amplification).
- `social-distribution-engine` — the master distribution orchestrator inside BAE; runs `brand-mcp-doctor --quick` before publish.

### END BRAND-MCP-DOCTOR ###
