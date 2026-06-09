---
name: threads-distribution-module
description: >
  Specialized skill for Threads distribution. Short-form text amplification Spoke.
triggers:
  - post to threads
  - threads distribution
---

# Threads Distribution Module

## Purpose

Threads serves as a short-form, conversational Spoke. It operates similarly to X/Twitter but with a different community graph, driving engagement back to the Hub.

## Capabilities

### 1. Posting Rules
- Format similarly to the main X tweet. Keep it conversational.
- Attach 1080x1080 square images if applicable.
- Provide links to the Hub/Substack.

### 2. Record Execution
Update the campaign tracker with status and execution time.

## Publish Gate (MANDATORY — run immediately before posting)

Content-readiness gate (`social-content-readiness-check`): three parallel LLM judges
(tone/authenticity, IP/patent firewall, narrative clarity) + metadata completeness.
OAuth CLIs, no API key (claude → gemini → codex fallback). This gate lives in
career-intelligence and is called cross-plugin (same as the other distribution modules).

```bash
GATE=$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/social-content-readiness-check/HOW.py 2>/dev/null | tail -1)
if [ -z "$GATE" ]; then
  echo '{"verdict":"BLOCK","reason":"social-content-readiness-check script not found — plugin may need reinstall","remediation":"Run: claude plugin update career-intelligence@xos --scope user"}'
  exit 1
fi
python3 "$GATE" \
  '{"text":"<post body>","platform":"threads","title":"<campaign title>","metadata":{"audience":"<target audience>"}}'
```

Exit 0 = PASS → post. Exit 1 = BLOCK → revise and re-run. Exit 2 = WARN → human approval before posting.
