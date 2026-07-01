---
name: network-intelligence
description: >
  Maps your network to target companies. Discovers warm intro paths,
  scores connection strength (5-level scale), ingests new contacts from
  conversation, and recommends who to reach out to and how. Also detects
  relationship origin (where/when you met) and cohort clusters (people
  from the same company/era). Records inbound recruiter DMs that came from
  the user's public posts as brand-attributed pipeline opportunities. Say
  "who do I know at [Company]", "how do I know [Name]", "tell me about
  [Contact]", or "a recruiter DM'd me after seeing my post".
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
  - recruiter DM
  - inbound recruiter
  - saw my post
  - post generated
---

# Network Intelligence — Career OS Skill

## Task Substrate (v0.25.0+)

> `$CAREER_GITHUB_REPO` is derived from: `git -C $CAREER_HOME remote get-url origin | sed 's/.*github.com[:/]//;s/.git$//'`

Tasks live in `$CAREER_GITHUB_REPO` GitHub Issues (canonical source of truth — single inbox for all Cyborg work). Repo of work indicated by `repo:*` label, NOT by issue location. Cadence indicated by `cadence:*` label (`operational` for high-frequency churn; `strategic` for sprint-scale; `meta` for trackers). Tier indicated by `tier:*` label (`p1`/`p2`/`p3`/`backlog`).

Tasks.md is DEPRECATED as of v0.25.0. See `$CAREER_HOME/workspace.manifest.yaml` `task_routing:` section for the full architecture.

This skill reads/writes via:
- `gh` CLI (universal, all agents)
- `github-mcp` MCP server (post-restart, when MCP boots — at `npx @modelcontextprotocol/server-github`)

Network-intelligence READS people files + pipeline (markdown) and produces intro recommendations. Recommendation reports remain markdown files at `career-intelligence/tasks/intros-{company}-{date}.md` (working drafts, not tasks). When a recommendation graduates to a scheduled outreach action, it's the **outreach-composer** skill that opens a `kind:follow-up` issue — not this skill.

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
- `a recruiter DM'd me after seeing my post` — record a brand-attributed inbound pipeline opportunity

---

## DATA ARCHITECTURE

### Inputs

| Source | Path | What It Provides |
|--------|------|------------------|
| Contact profiles | `network/people/*.md` | Structured contact data with company history, relationship |
| Pipeline | `career-intelligence/projects/job-search/job-pipeline.json` | Target companies to map against |
| CLAUDE.md | People table | Quick reference for top contacts |
| Experience history | `identity/experience-history.md` | User's own employment timeline (for origin cross-reference) |
| LinkedIn contact_info | LinkedIn MCP `get_person_profile(sections="contact_info")` | Connection date (when relationship started on LinkedIn) |
| LinkedIn experience | LinkedIn MCP `get_person_profile(sections="experience")` | Their employment timeline (for employer overlap detection) |
| LinkedIn inbox | LinkedIn MCP `search_conversations` + `get_conversation` | Message history (relationship warmth, dormancy, last exchange) |

### Brain API (brain-kernel >= 1.0.0)

`network/people/**` is an xOS primitive. Writes go through `brain.write()` with
`engine_id: "career-intelligence"` — permitted because `network/people/**` is in
this engine's `writes_to_primitives` declaration.

### Outputs

| Output | brain.write() path | When Created |
|--------|-------------------|-------------|
| Contact profiles | `network/people/{slug}.md` | Contact ingestion or update |
| Intro recommendations | `career-intelligence/projects/intros-{company}-{date}.md` | Path finding results |

**Write call pattern (people — primitive write):**
```
brain.write("network/people/{slug}.md", content, {
  provenance: { who: "career-intelligence", why: "contact ingested", source: "network-intelligence" },
  engine_id: "career-intelligence"
})
```

---

## BEHAVIOR: Path Finding (`who do I know at [Company]`)

### Step 1: Scan Network

1. Read ALL contact profiles from `network/people/`
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

Save via `brain.write("career-intelligence/projects/intros-{company}-{date}.md", ...)`:
<!-- Path mapped from legacy brain/tasks/ to career-intelligence/projects/ (owned_paths: projects/**) -->

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
| Inbound content attribution | `source: post`, `post_id: {post_id}` when the user attributes an inbound DM to a post |

### Step 3: Cross-Reference

After saving, check against pipeline:
```
Saved Piyush's profile. Cross-referencing with your pipeline...

💡 Piyush was at Glean — and you have no Glean contacts yet.
   Glean is hiring EM roles. Want me to check if he knows anyone there?
```

### Step 4: Write/Update Profile

Write via `brain.write("network/people/{slug}.md", content, { provenance: { who: "career-intelligence", why: "contact ingested", source: "network-intelligence" }, engine_id: "career-intelligence" })` with frontmatter:

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
# Optional for inbound recruiter DMs attributed to content
source: post
post_id: {post_id}
---
```

Update CLAUDE.md hot cache if this is a high-value contact (score ≥ 4 or connected to pipeline company).

### Inbound recruiter DM attribution (XOS-102)

When logging an inbound recruiter DM against `network/people/{slug}.md`, ask whether the user wants to attribute it to a post if they mention content, a LinkedIn/X post, newsletter post, or "that post drove this DM."

If the user attributes the DM to a post:
1. Update the people-file frontmatter via `brain.write()` with `source: post` and `post_id: {post_id}`. Keep existing contact fields intact. Record the inbound channel in `conversation_history.platform` when available, and update `conversation_history.last_message_received` as usual.
2. Emit the local telemetry helper:
   ```ts
   emitContentToDmTracked({ post_id, dm_source, contact_slug: slug })
   ```
3. Use `attributed_by: "user"` by default. Only use `attributed_by: "inferred"` when the user explicitly asks to mark the attribution as inferred.

Do not invent post IDs. If the user cannot identify the post, record the inbound DM without `source` or `post_id` and skip the telemetry event.

### Conversation → post-worthy prompt (XOS-101)

When logging a warm conversation that surfaces a shareable insight, prompt the user to turn it into a post. This applies to DM exchanges, meeting notes, and relationship-refresh interactions when there is a clear lesson, strong opinion, notable exchange, market observation, or repeatable career/network insight.

Use a plain-text prompt:
```
This feels post-worthy — want me to open the campaign engine to draft it?
```

When you surface the prompt, emit the local telemetry helper:
```ts
emitPostPromptFromConversation({ conversation_source, contact_slug: slug, insight_summary })
```

Use `conversation_source: "dm"`, `"meeting"`, or `"relationship-refresh"` when the source is known. Include `contact_slug` when the conversation is tied to a saved person. Keep `insight_summary` brief and human-readable; skip it if the insight cannot be summarized safely.

If the user accepts, route to the brand campaign-engine to draft the post. If the user declines, continue saving the conversation without opening the campaign engine. Do not emit this event for routine check-ins with no post-worthy insight.

---

## BEHAVIOR: Brand Inbound Recruiter DM

Use this when a recruiter contacts the user after seeing one of the user's
posts. This closes the brand-to-career loop by adding a pipeline entry with
source attribution: the post generated a career opportunity.

### Trigger examples

- "A recruiter DM'd me after seeing my post"
- "This post got a recruiter inbound"
- "Record an inbound recruiter DM from my LinkedIn post"
- "A recruiter from Acme reached out because of post-123"

### Required confirmation

Before writing anything, confirm the details in plain text:

```text
Confirm inbound pipeline entry:
Company: {company}
Role: {role}
Recruiter: {recruiter or unknown}
Recruiter title: {title or unknown}
Source post: {post id/url or unknown}
Note: {short context or none}

Record this as a brand inbound pipeline opportunity? (yes/no)
```

If company or role is missing, ask for it. If `source_post` is missing, ask for
the post id or URL; if the user does not have it, continue with `source_post:
null` and still record the entry. Never infer a post id or URL.

### Append-only write path

The helper builds the entry only. Persist through the existing pipeline
read/write path and append to `stage_data[]`; never mutate, remove, reorder, or
rewrite existing entries as status changes.

Local only: use details the user provides in the chat. Do not open LinkedIn,
Gmail, a browser, or retrieve the post/message while recording this entry.

```ts
import {
  appendInboundEntry,
  buildInboundPipelineEntry,
  emitBrandInboundPipelineCreated,
} from "$CLAUDE_PLUGIN_ROOT/src/pipeline/inbound-pipeline";

const pipeline = JSON.parse(await brain.read("career-intelligence/projects/job-search/job-pipeline.json"));

// tracker_id is a GLOBAL #N id space — the match-tracker (job-pipeline-match-tracker.json)
// is the authoritative registry (ids into the hundreds), and stage_data + pending_referrals
// reference the SAME ids. Seed from the FULL id space, NOT stage_data alone, or a new entry
// will reuse an existing role's #N (e.g. stage_data max 142 → 143, but match-tracker already
// has #143). Pull every known id:
const matchTracker = JSON.parse(await brain.read("career-intelligence/projects/job-search/job-pipeline-match-tracker.json"));
const existingTrackerIds = [
  ...(pipeline.stage_data ?? []).map((s) => s.tracker_id),
  ...(pipeline.pending_referrals ?? []).map((r) => r.tracker_id),
  ...(Array.isArray(matchTracker) ? matchTracker : matchTracker.roles ?? []).map((r) => r.id),
];

const entry = buildInboundPipelineEntry({
  company,
  role,
  recruiter,
  recruiter_title,
  source_post,
  note,
}, { existingEntries: pipeline.stage_data ?? [], existingTrackerIds });

const nextPipeline = appendInboundEntry(pipeline, entry);
await brain.write("career-intelligence/projects/job-search/job-pipeline.json", JSON.stringify(nextPipeline, null, 2) + "\n", {
  provenance: { who: "career-intelligence", why: "brand inbound recruiter DM recorded", source: "network-intelligence" },
  engine_id: "career-intelligence",
});

emitBrandInboundPipelineCreated({ source_post: entry.source_post });
```

Entry semantics:
- `stage: "recruiter_inbound"` means the recruiter reached out first.
- `source: "brand_inbound"` marks the opportunity as generated by the user's
  brand/content surface.
- `source_post` stores the post id or URL when known.
- `next_action` defaults to `Respond to recruiter`.
- `tracker_id` is non-colliding across the GLOBAL id space: pass `existingTrackerIds`
  (match-tracker `id` + stage_data + pending_referrals) and the helper picks
  (global max) + 1. Passing only `stage_data` is unsafe — it collides with
  higher match-tracker ids.

Telemetry is local-only and gated by `XOS_98_TELEMETRY`. The event is
`brand_inbound_pipeline_created` and includes only `has_source_post` plus a
timestamp. Do not include company, role, recruiter name, post URL, message text,
or compensation in telemetry.

### Output

After the append succeeds, show the ROI plainly:

```text
Brand -> career ROI recorded:
{source_post or "A post"} generated a pipeline opportunity.

Pipeline: #{tracker_id} {company} - {role}
Stage: recruiter inbound
Next action: Respond to recruiter
```

Do not draft or send a recruiter response unless the user explicitly asks.
Route response drafting through `outreach-composer` and keep the Direct
Outreach Gate intact.

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

If `network/people/` is empty or has < 3 profiles:

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

Read `identity/experience-history.md` → extract companies + date ranges.

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

Write or update via `brain.write("network/people/{slug}.md", ...)` with engine_id "career-intelligence". Frontmatter:

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
  last_message_summary: "Congrats on new role / Thanks for reaching out"
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

Read ALL people files in `network/people/`. A contact is a cohort candidate if:
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

Full frontmatter schema for `network/people/{slug}.md`:

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

# Optional in v0.73.5 — inbound recruiter DM attributed to content
source: post
post_id: linkedin-post-2026-06-28

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
  last_message_summary: "Congrats on new role / Thanks for reaching out"
  platform: linkedin
---
```

Fields `relationship_origin`, `cohort`, and `conversation_history` are populated by the relationship origin scan. Fields `source` and `post_id` are optional and only present when an inbound recruiter DM is attributed to a post. Agents MUST NOT fabricate these fields — leave absent until the scan runs or the user provides the attribution.

**Interaction with warm-contact-outreach-dedup:** `HOW.py` checks `last_contact` first. If absent, it falls back to `conversation_history.last_message_sent` as the recency signal. This means the dedup rule works even for contacts whose people file was created before `last_contact` was manually set.

## UNIT-OF-WORK COMMIT (MANDATORY — after any outreach send this skill initiates)

When network-intelligence triggers an outreach send (path finding → outreach-composer → confirmed send), immediately call `outreach-people-file-commit/HOW.py` in the SAME execution turn. See `outreach-composer/SKILL.md → UNIT-OF-WORK COMMIT` for the exact invocation. This skill is responsible for the commit when IT initiates the send; outreach-composer is responsible when the user invokes it directly.

**Never defer to session end.** A killed session after send but before commit loses state permanently.

---

## Dependencies

- `organize` — contact profiles need to exist in `network/people/` (required for path finding)
- `outreach-composer` — drafts the actual messages after paths are identified (recommended)
- Pipeline entry — provides target companies (recommended)
- LinkedIn MCP (`mcp__linkedin-community__`) — required for relationship origin scan and cohort detection
- `identity/experience-history.md` — required for employer overlap cross-reference
