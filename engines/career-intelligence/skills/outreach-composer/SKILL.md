---
name: outreach-composer
description: >
  Writes calibrated outreach messages — forwardable emails in the champion's
  voice, LinkedIn DMs with proof-of-work hooks, time-appropriate follow-ups,
  and thank-you notes with specific conversation callbacks. Respects contact
  channel preferences. Say "write outreach for [Contact]" or "follow up with
  [Contact]".
triggers:
  - write outreach for
  - oc
  - draft message to
  - follow up with
  - thank you note for
  - reach out to
  - message for
  - draft email to
---

# Outreach Composer — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_GITHUB_REPO` is derived from: `git -C $CAREER_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents)
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

**Outreach follow-up nudges open as `kind:follow-up` issues:**
```bash
gh issue create --repo $CAREER_GITHUB_REPO \
  --title "Follow up with {Contact} re: {Company} — by {due_date}" \
  --label "tier:p3,cadence:operational,repo:career-os-data,kind:follow-up" \
  --body "<context summary + suggested approach + last_contact date>"
```

Outreach drafts themselves remain markdown files in `brain/tasks/outreach-{contact}-{date}.md` (drafts are working artifacts, not tasks). Only the **scheduled follow-up nudge** is a task issue.

## Purpose

Generates personalized outreach messages calibrated to the relationship, channel, and context. Applies networking psychology (invisible board principle, serotonin from helping, proof-of-work hooks) to maximize response rates without being pushy.

## Output Format

Always start with:
```
━━━ Career OS: Outreach Composer ━━━
```

## How to Invoke

- `write outreach for [Contact] to [Company]` — forwardable referral email
- `linkedin message to [Contact]` — DM with proof-of-work hook
- `follow up with [Contact]` — time-calibrated follow-up
- `thank you note for [Contact]` — post-interaction note with conversation callback

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Target contact | User request (name or company) | Who to write to |
| Contact profiles | `brain/network/people/*.md` | Relationship warmth, shared history, channel preference |
| Pipeline | `brain/projects/job-search/job-pipeline.json` | Company context, role, hiring manager, stage |
| Stories | `brain/stories/*.md` | Shared history with contact |
| Outreach patterns | `brain/projects/outreach-patterns.md` (if exists) | Proven templates (Pattern D, etc.) |
| Key assets | CLAUDE.md Key Assets section | LinkedIn article, GitHub, demo URLs |
| Glossary | `brain/identity/glossary.md` | Contact quick-reference |

### Outputs

| Output | Path | When Created |
|--------|------|-------------|
| Message draft | `brain/tasks/outreach-{contact}-{date}.md` | Every outreach |
| New contact profile | `brain/network/people/{name}.md` | When new contact ingested |

---

## STEP 0: Dedup Pre-Flight (MANDATORY — fires before every trigger, no exceptions)

Before doing anything else — before channel selection, before drafting, before asking for missing info — run the warm-contact-outreach-dedup check:

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/warm-contact-outreach-dedup/HOW.py 2>/dev/null | tail -1)" \
  '{"contact_name": "<CONTACT_NAME>"}'
```

Parse the result:
- `verdict: PASS` → proceed to Channel Selection
- `verdict: BLOCK` → **STOP. Do NOT draft.** Surface the block message verbatim and halt:

```
⛔ DEDUP BLOCK: {reason}
Last contact: {last_contact} ({days_since_outreach} days ago)
Check for a reply instead of re-contacting.
```

**Skip-rule: NONE.** Every trigger (`write outreach for`, `follow up with`, `linkedin message to`, `thank you note for`, `reach out to`, `message for`, `draft email to`) must invoke this check. The question "has outreach already gone out?" must be answered by data, not memory.

**Origin (2026-05-04):** Two back-to-back failures — drafted WhatsApp for a contact (Amanesh) who had already been reached via LinkedIn + phone + email; drafted follow-up for a contact (Ravi) whose people file showed same-day outreach. Neither would have happened if this gate had run. User: *"i thought you codified this in the plugin and shipped."*

---

## CHANNEL SELECTION (ALWAYS CHECK FIRST)

**Before composing any message**, read the contact profile's `channel:` field.

| Channel | Tone | Constraints |
|---------|------|-------------|
| WhatsApp | Casual, short, personal | Brief paragraphs, emoji OK |
| LinkedIn | Professional, proof-of-work hook | Connection request: <300 chars. DM: <500 chars |
| Email | Structured, forwardable | Subject line that works as-is |
| Text | Very brief, friends-only | 1-2 sentences max |

**If no channel specified in profile:** ask the user before composing. Never guess.

---

## BEHAVIOR: Forwardable Email (`write outreach for [Contact] to [Company]`)

This is the highest-value outreach pattern. The goal: your champion can forward your message to their contact at the target company in 10 seconds flat.

### Context Pre-Flight (MANDATORY FIRST CHECK)

Before doing anything else, verify required context files exist:

```bash
EXPERIENCE_HISTORY="$CAREER_HOME/brain/identity/experience-history.md"
if [ ! -f "$EXPERIENCE_HISTORY" ]; then
  echo "⛔ experience-history.md not found. Run 'onboard me to career intelligence' first — this file is required to verify biographical claims before any outreach is sent."
  exit 1
fi
```

If `experience-history.md` is missing: **STOP and print the error above. Do not draft.** Outreach without canonical biography grounding is the failure mode that created fabricated credentials in past drafts.

### Pre-Flight Check (Outreach Friction Rule)

Before composing, verify you have:
1. **Exact role name** — from pipeline or user
2. **Hiring manager name** — from pipeline or user
3. **Contact's relationship context** — from people profile

If ANY are missing, flag it:
```
Before I compose, I need:
⚠️ Missing hiring manager name for {Company}
⚠️ No profile for {Contact} — how do you know them?

Fill these in and I'll draft the email.
```

### Canonical-Claim Verification (MANDATORY — do not skip)

**This skill drafts T4 outreach: messages that land in real humans' inboxes. Biographical hallucinations here destroy warm paths and credibility.**

Before WRITING the draft to disk (the final step), run the biographical-claim pre-check rule against your draft:

```bash
GATE=$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/biographical-claim-precheck/HOW.py 2>/dev/null | tail -1)
if [ -z "$GATE" ]; then
  echo '{"verdict":"BLOCK","reason":"biographical-claim-precheck script not found","remediation":"Run: claude plugin update career-intelligence@xos --scope user"}'
  exit 1
fi
python3 "$GATE" "$(jq -nc \
  --arg draft "/path/to/in-progress-draft.md" \
  --arg canonical "$CAREER_HOME/brain/identity/experience-history.md" \
  '{draft_path:$draft, canonical_sources:[$canonical], stakes:"T4"}')"
```

The script returns JSON:
- `verdict: PASS` → ship the draft
- `verdict: BLOCK` → at least one biographical claim (tenure, role, report count, scale-figure, date range) is NOT anchored in canonical. Read each entry in `claims_unanchored[]`, fix or remove the claim, re-run.

**Origin (2026-04-26):** [Recipient] email and [Connection] LinkedIn DM both shipped past prose verification with multiple unanchored biographical claims (employer-tenure, report-counts, product-attribution, platform-project-attribution). User caught both pre-send. The pre-write hook is the mechanical gate that prose alone failed to enforce.

**Skip-rule:** NONE. Even casual peer-to-peer DMs with biographical claims must run the check. The [Connection] DM was casual and still produced credibility-killing hallucination.

### Compose

1. Read contact profile — relationship warmth, shared history, communication style
2. Read pipeline entry for target company — role, HM name, stage
3. Generate email in the **FORWARDER's voice** (not the user's):
   - Subject line the forwarder would naturally write
   - Body the forwarder can paste into email/Slack as-is
   - References verified shared context only — never fabricated
   - Positions user as someone worth meeting (proof-of-work, not begging)
   - Includes forwardable blurb: who the user is, why they're relevant, 2-3 proof points

```
━━━ Forwardable Email Draft ━━━

To: {Contact} → forwards to {HM Name} at {Company}
Channel: Email
Subject: {subject line in forwarder's voice}

---

{Email body — written as if {Contact} is sending it}

---

Forwardable blurb (copy-paste for Slack/email):
"{User} is {1-line positioning}. {Proof point 1}. {Proof point 2}.
They're interested in the {Role} role — worth a conversation."

Includes: role name ✅ | HM name ✅ | forwardable blurb ✅
```

4. **Run Canonical-Claim Verification** (see section above) against the in-progress draft. BLOCK on any unanchored claim. Do NOT proceed to step 5 until verdict is PASS.
5. Write draft to `brain/tasks/outreach-{contact}-{date}.md`.
6. In the agent's response to the user, include a one-line evidence note: `Canonical-claim verification: PASS (N claims, all anchored).`

---

## BEHAVIOR: LinkedIn DM (`linkedin message to [Contact]`)

1. Read contact profile
2. Generate message with proof-of-work hook:
   - Reference something specific: their post, shared connection, company news, mutual project
   - Ask for advice, not a favor (invisible board principle: people want to feel like advisors, not gatekeepers)
   - Include proof-of-work: LinkedIn article link, GitHub, specific project reference
3. Enforce character limits:
   - Connection request: < 300 characters
   - InMail/DM: < 500 characters

```
━━━ LinkedIn DM Draft ━━━

To: {Contact}
Type: {Connection request / DM}
Characters: {N}/{limit}

---

{Message text}

---

Proof-of-work: LinkedIn article ✅
```

4. **Run Canonical-Claim Verification** (see "Canonical-Claim Verification" section under "Forwardable Email" above) against the in-progress draft. BLOCK on any unanchored claim. The [Connection] LinkedIn DM (2026-04-26) was the originating incident — casual peer-to-peer DM that still produced credibility-killing hallucination. No skip-rule for casual register.
5. Write draft to outreach file.
6. Include in agent response: `Canonical-claim verification: PASS (N claims).`

---

## BEHAVIOR: Follow-Up (`follow up with [Contact]`)

1. Read outreach history from contact profile and git log
2. Calculate time since last contact
3. Generate time-calibrated follow-up:

| Time Since Last | Approach | Example |
|---|---|---|
| < 1 week | **Too soon** — advise waiting | "Last message was 3 days ago. Give it at least a week — following up sooner signals desperation." |
| 1-2 weeks | **Gentle nudge** with new info | Share a relevant article, mention a new development, or add context |
| 2-4 weeks | **Re-engage** with different angle | New value-add, different shared context, or reference a recent event |
| > 4 weeks | **Fresh approach** — reset | Different channel, different topic, or acknowledge the gap |

```
━━━ Follow-Up Draft ━━━

To: {Contact}
Last contact: {date} ({N} days ago)
Strategy: {approach from table above}
Channel: {from contact profile}

---

{Follow-up message}

---
```

4. **Run Canonical-Claim Verification** if the follow-up references any new biographical claim about the user not present in the prior outreach. (Pure-recall follow-ups that only reference previous conversation can skip — but ANY new claim must verify.)
5. Write draft to outreach file.

---

## BEHAVIOR: Thank-You Note (`thank you note for [Contact]`)

1. Read recent interaction context from:
   - Interview debrief (`brain/interview-prep/`)
   - Ledger entries mentioning this contact
   - Contact profile notes
2. Generate note with:
   - **Specific callback** to something discussed — never generic "thanks for your time"
   - **Subtle forward momentum** — next step, shared resource, follow-up question
3. Match channel and tone to relationship

```
━━━ Thank-You Draft ━━━

To: {Contact}
Context: {what interaction this follows}
Channel: {from profile}

---

{Thank-you message with specific callback}

---
```

4. Write draft to outreach file

---

## BEHAVIOR: No Contact Profile

If no `brain/network/people/{name}.md` exists:

```
━━━ Career OS: Outreach Composer ━━━

I don't have a profile for {Name} yet. To write effective outreach, I need:

1. How do you know them? (worked together, social, mutual friend)
2. What company are they at?
3. Preferred contact channel? (LinkedIn, email, WhatsApp, text)

Tell me about them — I'll save their profile and compose the message.
```

After user describes the contact:
- Extract structured data → write `brain/network/people/{name}.md`
- Proceed with the original outreach request

---

## SSOT Write Rules (ADR-001)
- After composing outreach, write status ONLY to `people/<contact>.json` (or `.md` if not yet migrated)
- Update: last_contact date, outreach status, channel used, message summary
- Do NOT write outreach status to job-pipeline.json, task issues, or handoff docs (the `kind:follow-up` issue tracks the SCHEDULED NUDGE only — not the outreach status itself)
- Other skills (Mission Control, pipeline-sync) read from people/*.json

## UNIT-OF-WORK COMMIT (MANDATORY — same execution turn as confirmed send)

When the user confirms a message was sent (or you send it via browser automation), immediately call:

```bash
python3 $(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/outreach-people-file-commit/HOW.py 2>/dev/null | tail -1) "$(jq -nc \
  --arg people_file "$CAREER_HOME/brain/network/people/{slug}.json" \
  --arg career_home "$CAREER_HOME" \
  --arg last_contact "$(date +%Y-%m-%d)" \
  --arg follow_up "{follow_up_date}" \
  --arg summary "{one-line message summary}" \
  --arg commit_msg "outreach: {slug} — {company} {role} [{action}] [unit-of-work]" \
  '{people_file:$people_file,career_home:$career_home,updates:{last_contact:$last_contact,follow_up:$follow_up,conversation_history:{last_message_sent:$last_contact,last_message_summary:$summary}},commit_message:$commit_msg}')"
```

**Rules:**
- Call this in the SAME turn as the send confirmation — NEVER defer to session end
- If the user kills the session after send but before this script runs, state is lost
- Exit 0 = committed (show SHA). Exit 1 = BLOCK (surface error, do not proceed). Exit 2 = WARN (committed with issues)
- Slug = the people file basename without extension (e.g., `sandeep-reddy`)
- follow_up_date = today + 3 days for LinkedIn DM, today + 5 days for email (unless user specifies)

---

## Dependencies

- `organize` — contact profiles in `brain/network/people/` (required for warm outreach)
- Pipeline entry — helpful for company context (recommended)
- `network-intelligence` — identifies paths before outreach is composed (optional)
- Key assets in CLAUDE.md — LinkedIn article, GitHub links for proof-of-work
