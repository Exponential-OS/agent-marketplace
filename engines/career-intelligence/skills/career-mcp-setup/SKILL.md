---
name: career-mcp-setup
description: >
  Guided install for MCPs that career-intelligence needs: linkedin-community
  (profile reads), playwright-ms (anonymous ATS scans), optional browserbase
  (LinkedIn People tab + DMs) and perplexity (interviewer research). Uses
  browser automation where OAuth is required.
triggers:
  - career mcp setup
  - mcp setup
  - install linkedin
  - install browserbase
  - install perplexity
  - help me set up mcp
metadata:
  version: "1.0.0"
  author: "Anand Vallamsetla"
---

<!-- product-vs-solution: example -->

### BEGIN MCP-SETUP ###

# MCP Setup (career-intelligence) — Guided Install

career-intelligence needs four MCPs at most: two required, two optional. This skill walks each install. Composio is NOT in scope — career-intel doesn't publish. (See social-distribution-plugin for composio recipes.)


## The cascade — graceful degradation, no paywall extortion

For authenticated browsing, the recipe set provides two free paths:

1. **Primary**: `browserbase` FREE Hobby tier (~60 browser-min/mo). Easy setup, no local Chrome dance. **Sufficient for typical casual usage** — most users never hit the limit.
2. **Fallback when free tier exhausted**: `chrome-devtools-mcp` (FREE, UNLIMITED, local). Ships with launcher script. More setup pain but truly unlimited.

The auto-installer detects browserbase quota exhaustion and prompts the customer to install chrome-devtools as the steady-state runner. No forced $39/mo upgrade.

## Usage

```
career mcp setup <recipe>
```

Recipes shipped at `recipes/`:

| Recipe | Required? | Used by | Browser? | Time |
|---|---|---|---|---|
| `linkedin-community` | ✓ required | network-intelligence, outreach-composer | Yes (initial LinkedIn login) | 2 min |
| `playwright` | ✓ required | job-search-scheduler (ATS scans) | No — npm install only | 30 sec |
| `browserbase` | optional | LinkedIn People tab, DM threads | Yes (browserbase sign-up) | 3 min |
| `perplexity` | optional | interviewer-research | Yes (key copy from dashboard) | 1 min |

## How the auto-flow works (using `browserbase` as worked example)

1. Pre-flight: skill exits cleanly if env vars already set (idempotent).
2. Skill prints: *"A browser will open to browserbase.com. Sign up (free trial available) or sign in. Press ENTER when at dashboard."*
3. Skill opens browser via playwright-ms (or chrome-devtools-mcp if installed).
4. After human login, skill navigates to API Keys, extracts the key + project ID.
5. Writes `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` to `~/.codialectic/secrets.env` (chmod 600).
6. Prints: *"Run `source ~/.codialectic/secrets.env`, restart Claude Code, then `career mcp doctor`."*

For recipes that just need an API key (perplexity), the flow is simpler: navigate, wait for login, extract key, write, done.

For `linkedin-community`, the MCP itself handles login on first use — this recipe just runs the install command + tells the user what to do on first invocation.

## Manual fallback

If browser automation is unavailable, the skill prints copy-pasteable manual steps. Same recipe data, different rendering.

## Security

- All credentials → `~/.codialectic/secrets.env` with `chmod 600`.
- Never modifies `.mcp.json` (workspace-install-gate would BLOCK).
- Never logs credentials.
- Browser session ends after extraction.

### END MCP-SETUP ###
