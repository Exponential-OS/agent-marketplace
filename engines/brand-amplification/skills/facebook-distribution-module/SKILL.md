---
name: facebook-distribution-module
description: >
  Specialized skill for Facebook distribution. Acts as a Spoke for network amplification.
triggers:
  - post to facebook
  - facebook distribution
---

# Facebook Distribution Module

## Purpose

Facebook acts as a Spoke for network amplification, reaching personal and extended professional networks to drive traffic back to the LinkedIn Hub (The Juice) or Substack (Honey Pot).

## Capabilities

### 1. Posting Rules
- Adapt copy from the LinkedIn short post. Avoid overly corporate jargon.
- Attach the same visual asset used for LinkedIn (1200x627).
- Link out directly or in comments depending on current algorithmic reach penalties (test and log).

### 2. Record Execution
Update the campaign tracker with the URL and status.

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
  '{"text":"<post body>","platform":"facebook","title":"<campaign title>","metadata":{"audience":"<target audience>"}}'
```

Exit 0 = PASS → post. Exit 1 = BLOCK → revise and re-run. Exit 2 = WARN → human approval before posting.
