# /career-mcp-doctor — Diagnose Career Intelligence MCP setup

Runs the `career-mcp-doctor` skill: probes every MCP the Career Intelligence Engine needs (linkedin-community for profile reads, playwright-ms for anonymous ATS scans, optional browserbase or chrome-devtools-mcp for authenticated LinkedIn People-tab + DM threads), reports which are working / missing / unauthenticated, and surfaces the exact install command for each gap.

Use this:
- After a fresh install of `career-intelligence@xos` to verify MCPs are wired up
- Before running network-intelligence or outreach-composer to confirm credentials
- After an MCP install to confirm it landed correctly

The probe is read-only. It writes a status report to `~/.codialectic/mcp-status-career.json` and prints a tiered report to the conversation.

**Execute the career-mcp-doctor skill now.**
