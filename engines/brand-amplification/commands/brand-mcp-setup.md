# /brand-mcp-setup — Auto-install MCPs for Brand Amplification

Runs the `brand-mcp-setup` skill: the MCP auto-installer + confidence ladder for the Brand Amplification Engine.

The skill takes one argument — the recipe name. Examples:

- `/brand-mcp-setup browserbase` — bootstrap browserbase (free Hobby tier, 5 min, 2 env vars)
- `/brand-mcp-setup chrome-devtools` — launcher script for Chrome Canary + persistent profile (free, unlimited, visible during posting)
- `/brand-mcp-setup composio-linkedin` — fully automated OAuth dance via browserbase (5 min, hands-off)
- `/brand-mcp-setup composio-reddit` — Reddit spoke OAuth
- `/brand-mcp-setup composio-x` — X / Twitter spoke OAuth
- `/brand-mcp-setup playwright` — anonymous web scraping (30 sec, no auth)

If no argument: the skill prints the install order for new customers (browserbase → chrome-devtools → composio-linkedin → playwright → optional spokes).

All credentials land in `~/.codialectic/secrets.env` (chmod 600, gitignored). The skill never modifies `.mcp.json` — the workspace install gate would block it.

**Execute the brand-mcp-setup skill now with argument:** $ARGUMENTS
