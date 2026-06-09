---
name: instagram-distribution-module
description: >
  Specialized skill for Instagram distribution. Manages visual hooks, Carousels,
  and Story mechanics to drive traffic.
triggers:
  - post to instagram
  - instagram distribution
---

# Instagram Distribution Module

## Purpose

Instagram acts as a visual Spoke to drive traffic back to the Hub.

## Capabilities

### 1. Algorithmic Rules
- **Format:** Carousels perform better than single images. For Stories, post within 30 minutes of the feed post to boost engagement ("New post 👇").
- **Hashtags:** Use 15-25 hashtags (mix: 5 large >1M, 5 medium 100K-1M, 5 niche <100K).
- **Link Restriction:** Bio link is the ONLY funnel. Ensure the bio link is updated per campaign day to point to the Hub or Honey Pot.

### 2. Execution
- Post at optimal times (Mon/Wed/Fri 11 AM–1 PM, Sat 10 AM) if possible.
- Update campaign tracker with status.

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
  '{"text":"<post caption>","platform":"instagram","title":"<campaign title>","metadata":{"audience":"<target audience>"}}'
```

Exit 0 = PASS → post. Exit 1 = BLOCK → revise and re-run. Exit 2 = WARN → human approval before posting.
