# /career-mcp-setup — Auto-install MCPs for Career Intelligence

Runs the `career-mcp-setup` skill: the guided installer for MCPs the Career Intelligence Engine needs.

The skill takes one argument — the recipe name. Examples:

- `/career-mcp-setup linkedin-community` — required (profile reads, people search), 2 min, first invocation handles login
- `/career-mcp-setup playwright` — required (anonymous ATS scans), 30 sec, no auth
- `/career-mcp-setup browserbase` — optional (LinkedIn People tab + DM threads), 3 min, free Hobby tier
- `/career-mcp-setup chrome-devtools` — optional alternative to browserbase, free unlimited, local launcher

If no argument: the skill walks the recommended install order.

All credentials land in `~/.codialectic/secrets.env` (chmod 600, gitignored). The skill never modifies `.mcp.json` directly.

**Execute the career-mcp-setup skill now with argument:** $ARGUMENTS
