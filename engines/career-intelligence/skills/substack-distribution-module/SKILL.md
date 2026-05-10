---
name: substack-distribution-module
description: >
  Specialized skill for Substack, the "Honey Pot" and source of truth for long-form content.
  Enforces the Irreversible-Action Invariant strictly.
triggers:
  - post to substack
  - substack distribution
  - publish newsletter
---

# Substack Distribution Module

## Purpose

Substack is the "Honey Pot" — the ultimate conversion destination and source of truth for long-form content. Because publishing to Substack emails the subscriber list, this module strictly enforces the **Irreversible-Action Invariant**.

## Pre-Publish Gate (MANDATORY — runs before any publish action)

Call `substack-publish-gate` before ANY action that publishes or sends email to subscribers.
Exit 0 = PASS (proceed). Exit 1 = BLOCK (do not publish — surface the gate's remediation to the user).

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-os/*/rules/substack-publish-gate/HOW.py 2>/dev/null | tail -1)" '{
  "platform": "substack",
  "action": "publish",
  "is_email_send": <true if sending to subscribers>,
  "is_resend": <true if post was already sent — ALWAYS BLOCK>,
  "email_send_confirmed": <true only if human typed confirmation in THIS turn>,
  "post_title": "<title>",
  "post_excerpt": "<first ~500 chars of post body>",
  "word_count": <integer>,
  "has_hook": <true if opening creates immediate tension or curiosity>,
  "has_cta": <true if post ends with a clear next step for reader>
}'
```

Four gates (in order):
1. **resend_block** — `is_resend: true` → BLOCK, no override possible, no exceptions
2. **email_send_gate** — `is_email_send: true` requires `email_send_confirmed: true` set by the human in the current turn
3. **completeness** — word_count ≥ 300 + has_hook + has_cta
4. **quality** — LLM judge on post_excerpt via PROMPT.md

**Never set `is_resend: false` to force through a republish.** The human confirms by typing
`"email_send_confirmed": true` in the payload — it cannot be set by a standing rule or past approval.

## Capabilities

### 1. Publish as the Honey Pot
- Always publish Substack first before any other platforms.
- Run the pre-publish gate above before proceeding.
- Ensure the canonical URL is captured and passed back to the Master Engine so all spokes can link to it.

### 2. Irreversible-Action Invariant (HIGHEST SEVERITY)
- **Once sent to subscribers, ALL fixes are UPDATE-ONLY.**
- **NEVER** click "Publish" a second time, "Send to all," or delete-and-republish.
- If fixing a typo or changing a cover image on a live post, use the in-place editor and save WITHOUT sending.
- If the UI surfaces a "Send email to N subscribers?" prompt, **CANCEL and escalate**.

### 3. Record Execution
Update the campaign tracker. Note if the hub is `🔒 LOCKED` to prevent accidental republishes.
