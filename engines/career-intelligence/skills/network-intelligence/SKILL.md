---
name: network-intelligence
description: >
  Maps your network to target companies. Discovers warm intro paths,
  scores connection strength (5-level scale), ingests new contacts from
  conversation, and recommends who to reach out to and how. Also detects
  relationship origin (where/when you met) and cohort clusters (people
  from the same company/era). Say "who do I know at [Company]",
  "how do I know [Name]", or "tell me about [Contact]".
triggers:
  - who do I know at
  - ni
  - find connections to
  - network map
  - warm intros for
  - tell me about
  - add contact
  - who knows someone at
  - how do I know
  - relationship scan
  - relationship depth
  - when did I meet
  - relationship origin
---

# Network Intelligence — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_OS_GITHUB_REPO` is derived from: `git -C $CAREER_OS_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_OS_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_OS_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents)
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

Network-intelligence READS people files + pipeline (markdown) and produces intro recommendations. Recommendation reports remain markdown files at `brain/tasks/intros-{company}-{date}.md` (working drafts, not tasks). When a recommendation graduates to a scheduled outreach action, it's the **outreach-composer** skill that opens a `kind:follow-up` issue — not this skill.

## Purpose

Maps your professional and personal network to target companies. Discovers warm intro paths through shared history, scores connection strength, ingests unstructured contact descriptions, and recommends who to reach out to and how.

## Output Format

Always start with:
```
━━━ Career OS: Network Intelligence ━━━
```

## How to Invoke

- `who do I know at [Company]` — find warm paths to a target company
- `tell me about [Contact]` — add or update a contact from conversation
- `network map for [Company]` — visualize connection paths
- `warm intros for [Company]` — same as "who do I know at"
- `how do I know [Name]` — relationship origin scan (where/when you met, message history, cohort)
- `relationship scan for [Name]` — same as above

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Contact profiles | `brain/network/people/*.md` | Structured contact data with company history, relationship |
| Pipeline | `brain/projects/job-search/job-pipeline.json` | Target companies to map against |
| Glossary | `brain/identity/glossary.md` | Hot cache of key contacts |
| CLAUDE.md | People table | Quick reference for top contacts |
| Experience history | `brain/identity/experience-history.md` | User's own employment timeline (for origin cross-reference) |
| LinkedIn contact_info | LinkedIn MCP `get_person_profile(sections="contact_info")` | Connection date (when relationship started on LinkedIn) |
| LinkedIn experience | LinkedIn MCP `get_person_profile(sections="experience")` | Their employment timeline (for employer overlap detection) |
| LinkedIn inbox | LinkedIn MCP `search_conversations` + `get_conversation` | Message history (relationship warmth, dormancy, last exchange) |

### Outputs

| Output | Path | When Created |
|--------|------|-------------|
| Contact profiles | `brain/network/people/{name}.md` | Contact ingestion or update |
| Intro recommendations | `brain/tasks/intros-{company}-{date}.md` | Path finding results |

---

## BEHAVIOR: Path Finding (`who do I know at [Company]`)

### Step 1: Scan Network

1. Read ALL contact profiles from `brain/network/people/`
2. For each contact, check:
   - Current company matches target?
   - Company history includes target?
   - Known connections to people at target?
   - Worked at companies that commonly feed into target? (e.g., Google → Anthropic pipeline)

### Step 2: Score Connection Strength

| Level | Score | Definition | Approach |
|-------|-------|-----------|----------|
| **Inner Circle** | 5 | Worked together closely, personal relationship | Direct ask — they'll go out of their way |
| **Warm Offline** | 4 | Social connection outside work (neighbors, kids, poker) | Casual ask over drinks/text — leverage personal trust |
| **Warm Professional** | 3 | Former colleague, conference contact, shared project | LinkedIn/email with shared work context |
| **Network** | 2 | LinkedIn connection, mutual friends, same alma mater | Needs a hook — shared connection or proof-of-work |
| **Cold** | 1 | No existing relationship | Proof-of-work required — article, project, mutual interest |

### Step 3: Present Ranked Results

```
━━━ Paths to {Company} ━━━

🟢 INNER CIRCLE (5): {Name} — {Role}, {Company}
   Relationship: {how they know each other}
   Path: {recommended approach}
   Channel: {from contact profile}
   → "write outreach for {Name} to {Company}"

🟡 WARM PROFESSIONAL (3): {Name} — {Role}
   Relationship: {context}
   Path: {recommended approach}
   Channel: {channel}
   → "linkedin message to {Name}"

🔴 NO WARM PATHS FOUND
   Suggestions:
   - Check LinkedIn for 2nd-degree connections
   - Ask {closest contact} if they know anyone at {Company}
   - Cold outreach via LinkedIn with proof-of-work hook

{N} paths found. Strongest: {Name} (score {N}).
```

### Step 4: Write Recommendations

Save to `brain/tasks/intros-{company}-{date}.md`:

```markdown
# Warm Intro Paths — {Company}
**Generated:** {date}
**Target role:** {from pipeline}

## Recommended Actions
1. [ ] {Contact} (score 5) — {channel}: {1-line approach}
2. [ ] {Contact} (score 3) — {channel}: {1-line approach}
```

---

## BEHAVIOR: Contact Ingestion (`tell me about [Contact]`)

Voice-first friendly — the user describes contacts naturally, the skill extracts structure.

### Step 1: Listen

Accept unstructured input: "I know Piyush from Google — he's now CEO of Aida, an AI sales startup. We play poker on Thursdays with Pravir."

### Step 2: Extract

Pull structured fields from the description:

| Field | Example |
|-------|---------|
| Name | Piyush Prahladka |
| Current company | Aida (CEO) |
| Company history | Google (ex), Glean (founding staff) |
| Relationship | Close friend, poker group |
| Shared context | Thursday poker with Pravir |
| Connection strength | 5 (Inner Circle — personal + professional) |
| Channel preference | WhatsApp (inferred from "friend" — confirm with user) |

### Step 3: Cross-Reference

After saving, check against pipeline:
```
Saved Piyush's profile. Cross-referencing with your pipeline...

💡 Piyush was at Glean — and you have no Glean contacts yet.
   Glean is hiring EM roles. Want me to check if he knows anyone there?
```

### Step 4: Write/Update Profile

Write to `brain/network/people/{name}.md` with frontmatter:

```yaml
---
name: Piyush Prahladka
company: Aida
role: CEO
connection_strength: 5
channel: whatsapp
companies: [Google, Glean, Aida]
relationship: Close friend, Thursday poker group
last_contact: {date if known}
---
```

Update CLAUDE.md hot cache if this is a high-value contact (score ≥ 4 or connected to pipeline company).

---

## BEHAVIOR: Network Map (`network map for [Company]`)

### Phase 1 (Text)

```
━━━ Network Map: {Company} ━━━

You ──[5]── Pravir (Google Cloud) ──[?]── {Company}
You ──[3]── Drew (Anthropic) ──[direct]── {Company}
You ──[4]── Reid (OpenAI) ──[?]── {Company}

Legend:
  [N] = connection strength (1-5)
  [direct] = currently works there
  [?] = unknown if they know someone there — worth asking

Strongest path: Drew (score 3, works there directly)
Best warm path: Pravir (score 5, may know people) — ask over beers
```

### Phase 2 (Visual — Future)

React artifact with d3 network graph. Nodes = contacts, edges = connections, clusters = companies. Highlighted paths = warm intro routes.

---

## BEHAVIOR: Stale Contacts

When presenting any contact, check recency:

If last interaction > 90 days:
```
⚠️ {Name} — last contact was {N} days ago.
Worth a check-in before asking for an intro?
→ "follow up with {Name}"
```

---

## BEHAVIOR: Empty Network

If `brain/network/people/` is empty or has < 3 profiles:

```
━━━ Career OS: Network Intelligence ━━━

Your network map needs contacts to work with.

Tell me about 3-5 people in your network:
- Former colleagues at companies you admire
- Friends in tech (neighbors, parents from school, poker buddies)
- Conference contacts or mentors

Just talk naturally: "I know Pravir from Google, he's VP at Cloud now..."
I'll extract the details and start mapping paths to your target companies.
```

---

---

## BEHAVIOR: Relationship Origin Scan (`how do I know [Name]`)

Determines WHERE and WHEN a relationship started, its depth, and current dormancy.
Run this before drafting any outreach to a named contact.

### Step 1: Fetch LinkedIn signals (3 parallel calls)

```
get_person_profile(linkedin_username, sections="contact_info")  → connection date
get_person_profile(linkedin_username, sections="experience")    → their employment timeline
search_conversations(keywords=contact_name, limit=5)            → message thread(s)
```

If LinkedIn username unknown: search `search_people(keywords="Name Company")` first.

### Step 2: Read user's employment timeline

Read `brain/identity/experience-history.md` → extract companies + date ranges.

### Step 3: Cross-reference timelines

For each employer in the contact's history:
- Does it overlap (same company AND overlapping date range) with user's history?
- If yes → this is the likely **relationship origin**
- Record: `company`, `period` (overlapping range), `context` (consulting, colleague, etc.)

If no overlap found: origin is `unknown` — flag for user to fill in manually.

### Step 4: Parse message history

From `get_conversation(thread_id)`:
- Date of first message (oldest in thread)
- Date of last message sent by user
- Date of last message received from contact
- One-line summary of most recent exchange

### Step 5: Classify relationship tier

| Signals | Tier | Outreach approach |
|---|---|---|
| Shared employer + 2+ years overlap + replied to messages | Former colleague (warm) | Reference shared work context directly |
| Shared employer + messages replied | Former colleague (moderate) | Reference company, keep ask light |
| Connected 5+ years + messages replied | Long-term network (warm) | Reference longevity, casual tone |
| Connected 5+ years + no messages | Dormant connection | Brief re-intro before the ask |
| Connected < 2 years + messages replied | Recent professional (warm) | Direct ask OK |
| Connected < 2 years + no messages | Cold connection | Treat as cold outreach |

### Step 6: Update people file

Write or update `brain/network/people/{slug}.md` frontmatter:

```yaml
relationship_origin:
  company: Texas Guaranteed          # shared employer (or "unknown")
  period: 2009-2010                  # overlapping date range
  context: Oracle consulting engagement
  connected: 2010-10-15              # LinkedIn connection date
relationship_tier: former-colleague-warm
conversation_history:
  last_message_sent: 2019-06-19
  last_message_received: 2019-06-19
  last_message_summary: "Congrats on new role / Thanks Anand"
  platform: linkedin
```

### Step 7: Present summary

```
━━━ Relationship Origin: {Name} ━━━

Connected: {connection_date} ({N} years)
Origin:    {Company} ({period}) — {context}
Last exchange: {last_message_date} — "{summary}"
Dormancy:  {N} years

Tier: Former colleague (warm) — reference {Company} directly in opener.

Cohort check: {N} other connections from {Company} (~{period})
  → {Name2}, {Name3} — say "cohort scan for {Company}" to map them
```

---

## BEHAVIOR: Cohort Detection (`cohort scan for [Company]`)

Groups connections who share the same relationship origin into a named cohort.
One shared opener warms the entire cluster simultaneously.

### Step 1: Identify cohort candidates

Read ALL people files in `brain/network/people/`. A contact is a cohort candidate if:
- `relationship_origin.company` matches the target company, OR
- `relationship_origin` is unset AND LinkedIn `connected` date falls within ±18 months of the anchor connection

### Step 2: Verify candidates (optional, for unset origins)

For each unset-origin candidate in the window: run a quick relationship origin scan (Steps 1-4 above). If employer overlap confirmed → add to cohort.

### Step 3: Update cohort field in all member files

```yaml
cohort:
  name: texas-guaranteed-2009
  members: [sandeep-reddy, rob-[surname], sambasiva-[surname]]
  origin_company: Texas Guaranteed
  period: 2009-2010
```

### Step 4: Present cohort map

```
━━━ Cohort: Texas Guaranteed (~2009-2010) ━━━

3 connections from this era:
  Sandeep Reddy  — Director GTM Tech Ops, MongoDB  ← TARGET COMPANY ⭐
  Rob [Surname]  — [Current Role]
  Sambasiva      — [Current Role]

Strategy: one opener referencing Texas Guaranteed reaches all three.
Sandeep → MongoDB referral path (direct). Rob/Sambasiva → general warm reconnects.

→ "write outreach for Sandeep referencing Texas Guaranteed"
→ "cohort message for texas-guaranteed-2009" — draft one message for all three
```

---

## PEOPLE FILE SCHEMA (v0.30.0+)

Full frontmatter schema for `brain/network/people/{slug}.md`:

```yaml
---
name: Sandeep Reddy
companies:
  - MongoDB (current — Director GTM Tech Ops)
  - Amazon (prior — Sr TPM)
relationship: former-colleague
relationship_tier: former-colleague-warm
warmth: 3
channel: linkedin
last_contact: 2019-06-19

# NEW in v0.30.0 — relationship origin detection
relationship_origin:
  company: Texas Guaranteed
  period: 2009-2010
  context: Oracle consulting engagement
  connected: 2010-10-15
cohort:
  name: texas-guaranteed-2009
  members: [sandeep-reddy, rob-surname, sambasiva-surname]
  origin_company: Texas Guaranteed
  period: 2009-2010
conversation_history:
  last_message_sent: 2019-06-19
  last_message_received: 2019-06-19
  last_message_summary: "Congrats on new role / Thanks Anand"
  platform: linkedin
---
```

Fields `relationship_origin`, `cohort`, and `conversation_history` are populated by the relationship origin scan. Agents MUST NOT fabricate these fields — leave absent until the scan runs.

**Interaction with warm-contact-outreach-dedup:** `HOW.py` checks `last_contact` first. If absent, it falls back to `conversation_history.last_message_sent` as the recency signal. This means the dedup rule works even for contacts whose people file was created before `last_contact` was manually set.

## UNIT-OF-WORK COMMIT (MANDATORY — after any outreach send this skill initiates)

When network-intelligence triggers an outreach send (path finding → outreach-composer → confirmed send), immediately call `outreach-people-file-commit/HOW.py` in the SAME execution turn. See `outreach-composer/SKILL.md → UNIT-OF-WORK COMMIT` for the exact invocation. This skill is responsible for the commit when IT initiates the send; outreach-composer is responsible when the user invokes it directly.

**Never defer to session end.** A killed session after send but before commit loses state permanently.

---

## Dependencies

- `organize` — contact profiles need to exist in `brain/network/people/` (required for path finding)
- `outreach-composer` — drafts the actual messages after paths are identified (recommended)
- Pipeline entry — provides target companies (recommended)
- LinkedIn MCP (`mcp__linkedin-community__`) — required for relationship origin scan and cohort detection
- `brain/identity/experience-history.md` — required for employer overlap cross-reference
