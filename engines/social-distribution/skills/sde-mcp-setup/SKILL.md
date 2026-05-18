---
name: sde-mcp-setup
description: >
  THE MCP-AUTO-INSTALLER + CONFIDENCE LADDER. Browserbase bootstraps every
  other online config setup (1 install + N magic setups). For posting,
  defaults to Chrome Canary (local, visible — user watches and intervenes,
  honoring the Irreversible-Action Invariant). After confidence builds
  (~10 successful runs of a workflow), suggests graduating to browserbase
  for that workflow.
triggers:
  - codi mcp setup sde
  - sde mcp setup
  - install composio
  - install sde browserbase
  - install sde chrome-devtools
  - help me set up sde mcp
  - magic mcp install
  - browser prefs
  - graduate to browserbase
metadata:
  version: "1.0.0"
  author: "Anand Vallamsetla"
---

<!-- product-vs-solution: example -->

### BEGIN SDE-MCP-SETUP ###

# MCP Setup (social-distribution) — Auto-Installer + Confidence Ladder

## Two ladders, not one

This product has two orthogonal customer journeys:

**Cost ladder** — what does the customer pay?
- Free Hobby (browserbase) → Free unlimited (chrome-devtools) → $39/mo Starter (rare)

**Confidence ladder** — what does the customer trust?
- "I want to watch" (chrome-devtools, local, visible) → "I trust the cascade" (browserbase, cloud, fast)

The cost ladder is well-understood. The **confidence ladder** is the product insight: new users need to SEE the browser do irreversible things (post LinkedIn, send DM, submit ATS form) before they trust automation. Forcing them to start with cloud automation breaks trust.

## Per-workflow defaults (the confidence-aware design)

Each workflow gets its OWN browser MCP default. Customer-editable via `~/.codialectic/browser-prefs.json`. Schema at `browser-prefs.schema.json`. Template at `browser-prefs.template.json`.

Out-of-the-box defaults:

| Workflow | Default | Rationale |
|---|---|---|
| `mcp_setup` | browserbase | Bootstrap — easy, no local Chrome dance. Cloud is fine for setup OAuth flows. |
| `linkedin_post`, `linkedin_article`, `linkedin_dm` | chrome-devtools-mcp | **Irreversible-Action Invariant**. User watches, can intervene. |
| `substack_publish` | chrome-devtools-mcp | Newsletter to subscribers = highest-stakes irreversible. ALWAYS visible. |
| `ats_form_submit` | chrome-devtools-mcp | Job application = high-stakes. Watch before submit. |
| `reddit_post`, `x_post` | chrome-devtools-mcp | Public irreversible. Watch. |
| `linkedin_people_tab` | chrome-devtools-mcp | Reading auth-walled content, but visual feedback helps debug. |
| `anonymous_web_read`, `ats_scan` | playwright-ms | No auth, low stakes, headless OK. |

## The confidence-graduation flow

After N successful runs (default `upgrade_threshold: 10`) of a workflow with chrome-devtools, mcp-doctor surfaces a one-time suggestion:

```
💡 You've published 10 LinkedIn posts via Chrome Canary. Confident in the flow now?
   Graduate to browserbase for this workflow (faster, no local Chrome window):
     codi mcp graduate linkedin_post
   Or keep watching (no further reminders):
     codi mcp keep-watching linkedin_post
```

User can decline forever (`user_declined_upgrade` array tracks this). Doctor never nags twice.

## Install order for new customers

1. **`codi mcp setup sde browserbase`** — bootstrap, 5 min. FREE Hobby tier sufficient for casual use.
2. **`codi mcp setup sde chrome-devtools`** — install for visible posting, 5 min. Launcher script ships with the plugin.
3. **`codi mcp setup sde composio-linkedin`** — fully automated OAuth dance via browserbase. 5 min.
4. **`codi mcp setup sde playwright`** — 30 sec, no auth.
5. Optional spokes (Reddit, X) as needed.

Total: ~15 min to fully configured publishing pipeline. Posting starts in Chrome Canary (visible). When confidence builds, graduate workflow-by-workflow to browserbase.

## Recipe format

Recipes at `recipes/<name>.json`. Drop a new file = new MCP supported, no code changes.

## Security

- Credentials → `~/.codialectic/secrets.env` (chmod 600, gitignored)
- Browser prefs → `~/.codialectic/browser-prefs.json` (no credentials, just preferences)
- Never modifies `.mcp.json` (workspace-install-gate would BLOCK)
- Browserbase sessions end after extraction

### END SDE-MCP-SETUP ###
