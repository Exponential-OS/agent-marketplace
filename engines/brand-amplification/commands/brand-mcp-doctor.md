# /brand-mcp-doctor — Diagnose Brand Amplification MCP setup

Runs the `brand-mcp-doctor` skill: probes every MCP the Brand Amplification Engine needs (composio for LinkedIn/Reddit/X publish, browserbase or chrome-devtools-mcp for authenticated browsing, playwright-ms for content URL checks), reports which are working / missing / unauthenticated, and surfaces the exact install command for each gap.

Use this:
- After a fresh install of `brand-amplification@xos` to verify all MCPs are wired up
- Before publishing a campaign to confirm credentials are still valid
- After an MCP install to confirm it landed correctly

The probe is read-only — it never modifies `.mcp.json` or any credential file. It writes its status report to `~/.codialectic/mcp-status-brand.json` (for the `record-success` / `graduate` / `keep-watching` graduation-counter flows) and prints a tiered report to the conversation.

**Execute the brand-mcp-doctor skill now.**
