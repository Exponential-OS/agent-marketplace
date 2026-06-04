---
name: story-capture
description: >
  Real-time career story capture with STAR structure extraction, YAML frontmatter
  generation, and automatic STORY_INDEX update. Activates whenever the user shares
  a career narrative, wants to save an experience, or references past work worth
  preserving. Owns all writes to: career-intelligence/stories/*.md and
  career-intelligence/stories/STORY_INDEX.md via brain.write().
triggers:
  - stc
  # Explicit capture
  - save this story
  - capture this
  - log this
  - I want to remember this
  - add this to my stories
  - save that as a story
  - add this experience
  # Update
  - update the story
  - add more context to
  - I want to revise
---

# Story Capture — Career OS Skill

## Purpose

Captures career stories in real-time during conversation. Extracts STAR structure,
generates YAML frontmatter, writes a structured `.md` file to
`brain/stories/`, and updates `STORY_INDEX.md` atomically.

Separated from `organize` because organize is a batch operation — story-capture
is real-time, capturing the story at the moment of telling when it's richest.

## Output Format

Always start your response with:
```
━━━ Career OS: Story Capture ━━━
```

## How to Invoke

- "save this story" — capture the story just told in conversation
- "capture this" — same as above
- "I want to remember this" — save a narrative as a structured story
- "update the [story name] story" — revise an existing story
- "add more context to [story]" — append details to an existing story

---

## DATA ARCHITECTURE

### Brain API (brain-kernel >= 1.0.0)

All writes go through `brain.write(path, content, opts)`. All reads go through
`brain.read(path)` / `brain.list(prefix)`. Direct filesystem writes are
FORBIDDEN — the kernel enforces ACL and provenance on every operation.

### Inputs (what the skill reads)

| Source | Brain path | What It Provides |
|--------|-----------|------------------|
| Conversation context | (in-session) | The narrative to extract STAR elements from |
| Existing stories | `brain.list("career-intelligence/stories/")` | Duplicate detection, cross-referencing |
| Story index | `brain.read("career-intelligence/stories/STORY_INDEX.md")` | Current index state for append |
| People | `brain.list("network/people/")` | Link mentioned people to `related_people` |
| Pipeline | `brain.read("career-intelligence/pipeline.json")` | Link mentioned companies to `related_companies` |

### Outputs (what the skill writes)

| Output | brain.write() path | What It Contains |
|--------|-------------------|------------------|
| Story file | `career-intelligence/stories/{slug}.md` | STAR-structured story with YAML frontmatter |
| Story index (appended) | `career-intelligence/stories/STORY_INDEX.md` | New row: title, company, timeframe, competencies, tags |
| Handoff entry | `NEXT_SESSION_HANDOFF.md` | Note that a new story was captured |

**Write call pattern:**
```
brain.write("career-intelligence/stories/{slug}.md", content, {
  provenance: { who: "career-intelligence", why: "story captured", source: "story-capture" },
  engine_id: "career-intelligence"
})
```

---

## BEHAVIOR: Capture a New Story

### Step 1: Extract STAR Elements

From the user's narrative, extract:
- **Situation** — context and problem
- **Task** — specific role and responsibility
- **Action** — what was done (tools, decisions, tradeoffs)
- **Result** — outcome (quantify where possible)

Even if incomplete, capture what's available. Mark missing fields as `TBD`.

### Step 2: Fill Gaps Conversationally

Ask only what's missing, one question at a time (never a form):
- "What was the outcome? Any numbers you can attach?"
- "What timeframe was this?"
- "Which competencies does this show? I'm thinking [X, Y] — anything to add?"
- "Any related people I should link this to?"

### Step 3: Propose the Draft

**ALWAYS show the structured draft before writing.** Never write without confirmation.

```markdown
---
title: "{Descriptive Title}"
company: "{Company}"
role: "{Role at Time}"
timeframe: "{Year or range}"
tags: [leadership, scale, migration, fintech]
competencies: [systems-thinking, stakeholder-management, execution-at-scale]
interview_questions:
  - "Tell me about a time you led a large-scale migration"
  - "How do you manage technical debt at scale?"
related_stories: []
related_people: []
related_companies: []
captured: "{YYYY-MM-DD}"
last_updated: "{YYYY-MM-DD}"
---

## Situation
{Extracted context}

## Task
{Extracted responsibility}

## Action
{Extracted actions}

## Result
{Extracted outcome}

## Lessons / What I'd Do Differently
{Optional — TBD if not mentioned}
```

### Step 4: Write on Approval

1. Write story file via `brain.write("career-intelligence/stories/{slug}.md", ...)`
2. Re-read `brain.read("career-intelligence/stories/STORY_INDEX.md")` (P15 — another agent may have updated it)
3. Append row via `brain.write("career-intelligence/stories/STORY_INDEX.md", ...)`
4. Scan existing stories for cross-references (same company/project/outcome)
5. Update `related_stories` frontmatter on any connected stories
6. Log to `NEXT_SESSION_HANDOFF.md`

---

## BEHAVIOR: Update an Existing Story

When the user asks to update or revise a story:

1. Find the existing story file by title or slug
2. Read current content
3. Show current vs. proposed changes
4. Update on confirmation
5. Update `last_updated` date
6. Re-run cross-reference check

---

## BEHAVIOR: Implicit Detection

Watch for narrative cues in conversation:
- "we built...", "I led...", "the result was...", "I learned..."
- "one time at [Company]...", "back when I was at..."
- Multi-sentence narrative about a project, outcome, or decision

When detected, **offer to capture** before the conversation moves on:
> "That sounds like a strong story for interviews. Want me to save it?"

Do NOT let career-relevant narratives live only in conversation context. Stories
are prep assets; context is ephemeral.

---

## STORY_INDEX.md Format

```markdown
# Story Index

Generated by Career OS. Updated by story-capture (real-time) and organize (batch).

| Story | Companies | Competencies | Tags | Related |
|-------|-----------|-------------|------|---------|
| [slug](stories/slug.md) | Company | comp1, comp2 | tag1, tag2 | related-slug |
```

---

## INTEGRATION POINTS

| Skill | Relationship |
|-------|-------------|
| `organize` | Batch version. After story-capture runs, organize's incremental re-index is a no-op for that story. |
| `interview-prep` | Reads stories — fresher stories = better prep. |
| `resume-engine` | Pulls from stories for bullet generation. STAR maps to resume bullets. |
| `network-intelligence` | Story mentions people → `related_people` → network-intelligence can query by story. |
| `mission-control` | Surfaces memory health. Story-capture keeps the index current. |

---

## MULTI-AGENT SAFETY (P15)

1. Re-read `STORY_INDEX.md` immediately before updating (another agent may have added a story)
2. Append rows to index — never rewrite the full table
3. Use the story title as the unique key — check for duplicates before creating a new file
4. Log the capture to `NEXT_SESSION_HANDOFF.md`

---

## FEEDBACK LOOP (P8)

Log which competencies are most frequently tagged. Over time surface:
- **Coverage gaps:** competencies never tagged = gaps in the prep arsenal
- **Overrepresentation:** same competency on every story = one-dimensional profile
- **Interview hit rate:** which stories get used in prep → which are most valuable

---

## EDGE CASES

- **Partial story** (missing Result or timeframe): capture with `TBD` fields, do not block
- **Duplicate title/company**: warn before creating, offer to update existing story instead
- **Stories dir doesn't exist**: `brain.write()` creates parent dirs automatically
- **STORY_INDEX.md doesn't exist**: write it fresh via `brain.write("career-intelligence/stories/STORY_INDEX.md", ...)`
- **User declines capture**: respect immediately, do not re-prompt for same narrative
