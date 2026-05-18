---
name: career-mcp-doctor
description: >
  Diagnose MCP server availability for career-intelligence. Probes the MCPs
  this plugin needs (linkedin-community, playwright-ms, optional browserbase
  or chrome-devtools-mcp), reports which are installed/auth-configured/working/missing,
  and surfaces install commands for each missing one.
triggers:
  - career mcp doctor
  - career mcp
  - mcp status
  - mcp doctor
  - check my mcps
  - which mcps do I need for career
metadata:
  version: "1.0.0"
  author: "Anand Vallamsetla"
---

<!-- product-vs-solution: example -->

### BEGIN MCP-DOCTOR ###

# MCP Doctor (career-intelligence) — Required vs. Installed

Customer installs career-intelligence@xos, runs `network-intelligence`, hits "tool not registered" with no map. This skill produces the map.

## Trigger

`career mcp doctor` (or `mcp status`).

## Output

```
━━━ MCP Doctor (career-intelligence) · Status ━━━

REQUIRED
  ✓ linkedin-community   — installed, working (LinkedIn profile/people search)
  ✓ playwright-ms        — installed, working (anonymous ATS scans — Greenhouse, Ashby, Workday)

OPTIONAL
  ◯ browserbase OR chrome-devtools-mcp — for AUTHENTICATED browsing (LinkedIn People tab, DM threads)
      browserbase (~$39/mo, low setup)  → career mcp setup browserbase
      chrome-devtools (free, launcher)  → career mcp setup chrome-devtools



OUT OF SCOPE (career-intel does NOT use these)
  ◯ composio, supabase, gitkraken, vercel
```

## How it works

1. Discover wired MCPs from `~/.mcp.json`, workspace `.mcp.json`, or `claude mcp list`.
2. Read this plugin's `MCP-REQUIREMENTS.md`.
3. Probe each required MCP:
   - stdio (linkedin-community, playwright-ms): run `tools/list` JSON-RPC
   - port (chrome-devtools-mcp): check 9222 listening
   - HTTP (browserbase): `tools/list` with API key
4. Render tiered report.
5. Save to `~/.codialectic/mcp-status-career.json`.

## Sub-flows

- `career mcp doctor --quick` — skip probe, compare manifest only.
- `career mcp doctor --json` — machine-readable.

## Relationship to other skills

- `mcp-setup` (sister) — installs missing MCPs.
- `career-intelligence-onboarding` — calls mcp-doctor Phase 0.
- `network-intelligence` + `outreach-composer` — run `mcp-doctor --quick` before LinkedIn ops.
- `job-search-scheduler` — runs `mcp-doctor --quick` before ATS scans.

### END MCP-DOCTOR ###
