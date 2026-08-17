---
name: session-logger
description: >
  Search, replay, and analyze your Career Intelligence conversation history.
  Query past sessions by topic, date, or keyword. View session summaries
  and usage analytics. Conversation capture is automatic via hooks.
triggers:
  - session log
  - conversation history
  - what did we discuss
  - replay
  - replay last session
  - session stats
  - find the conversation
---

# Session Logger — Career Intelligence Skill

## Purpose

Search, replay, and analyze your conversation history. Every exchange is
automatically captured to `brain/sessions/ledger/` by hooks — this skill makes
that data **queryable**.

## Output Format

Always start your response with:
```
━━━ Career Intelligence: Session Logger ━━━
```

## Capabilities

### 1. Session Replay

**Triggers:** "replay", "replay last session", "replay [date]"

Read the ledger file(s) for the requested session and present a structured summary:

1. Identify the target session:
   - No date specified → today's most recent session (last `## Session Start` block)
   - Date specified → read `brain/sessions/ledger/{YYYY-MM-DD}.md`
   - "last session" → find the most recent `## Session Start` across recent ledger files
2. Parse the session: split on `## ` headers, classify User/Claude/Session Start
3. Present:

```
━━━ Career Intelligence: Session Logger ━━━

Session: 2026-03-31, 14:32 – 15:47 (1h 15m)
Exchanges: 8

Topics discussed:
  • Resume customization for Anthropic role
  • Interview prep — system design stories
  • Pipeline status review

Key decisions:
  • Chose "ML Platform" story for system design round
  • Deferred Codeberg mirror setup to next week

Files touched:
  • brain/stories/ml-platform.md (updated)
  • Resumes & Cover Letters/anthropic-resume-v2.md (created)
```

### 2. Conversation Search

**Triggers:** "what did we discuss about [topic]", "when did I mention [term]",
"find the conversation where [description]"

Search across all ledger files for the requested topic:

1. Extract the search term from the user's request
2. Read ledger files in `brain/sessions/ledger/` (most recent first)
3. Find exchanges where the term appears in either User or Claude sections
4. Present matches with date, timestamp, and context snippet:

```
━━━ Career Intelligence: Session Logger ━━━

Found 3 matches for "anthropic":

| Date | Time | Speaker | Snippet |
|------|------|---------|---------|
| 2026-03-31 | 14:35 | User | "I want to apply to the Anthropic PM role..." |
| 2026-03-28 | 10:12 | Claude | "...Anthropic's interview process typically includes..." |
| 2026-03-25 | 16:45 | User | "Score the Anthropic job against my profile" |

Show full exchange? (give me a number)
```

If user asks to see a full exchange, read and display that specific User+Claude pair.

### 3. Session Summary

**Triggers:** "session log", "conversation history", "what did we discuss"

Generate a summary of recent sessions:

1. List ledger files in `brain/sessions/ledger/` (most recent first, last 7 days)
2. For each day: count sessions (Session Start markers), count exchanges, extract topic keywords from user prompts
3. Present as a table:

```
━━━ Career Intelligence: Session Logger ━━━

Recent Sessions:

| Date | Sessions | Exchanges | Topics |
|------|----------|-----------|--------|
| 2026-03-31 | 2 | 12 | resume, interview prep, pipeline |
| 2026-03-30 | 1 | 5 | job search, scoring |
| 2026-03-28 | 3 | 18 | networking, outreach, stories |
| 2026-03-25 | 1 | 8 | mission control, organize |

Total this week: 7 sessions, 43 exchanges

"replay [date]" for details on a specific day.
```

### 4. Session Analytics

**Triggers:** "session stats", "how much have I used Career Intelligence"

Aggregate across all ledger files:

1. Count all ledger files in `brain/sessions/ledger/`
2. For each: count Session Start markers and exchange pairs
3. Extract top topics by frequency (scan user prompts for skill trigger words and key nouns)
4. Present:

```
━━━ Career Intelligence: Session Logger ━━━

Career Intelligence Usage:

| Metric | Value |
|--------|-------|
| Active since | 2026-03-19 |
| Total days active | 9 |
| Total sessions | 24 |
| Total exchanges | 142 |
| Avg exchanges/session | 5.9 |
| Most active day | 2026-03-20 (6 sessions) |

Top topics: resume (23), interview prep (18), pipeline (15), networking (12), scoring (9)

Busiest week: Mar 19–25 (18 sessions)
```

## How It Works (Automated Capture)

This skill's data source is populated automatically by hooks — no manual invocation needed.

**Hooks:**
- `SessionStart` → `init-repo.sh`: Scaffolds `brain/` on first run, marks session start in ledger, runs version check + migration
- `UserPromptSubmit` → `capture-prompt.sh`: Appends user's prompt to daily ledger, unified atomic git commit
- `Stop` → `capture-response.sh`: Appends Claude's response, unified atomic git commit, pushes to remote

**Ledger location:** `brain/sessions/ledger/{YYYY-MM-DD}.md`

**Ledger format:**
```
# Session Ledger — 2026-03-19

## 14:32:05 — Session Start

---

## 14:32:10 — User

[User's prompt verbatim]

---

## 14:32:47 — Claude

[Claude's response verbatim]

---
```

**Unified commit model:**
Every commit includes ALL managed files, not just the ledger:
- `brain/` — ledger + any memory/task updates from this exchange
- `CLAUDE.md` — if modified during the exchange
- `NEXT_SESSION_HANDOFF.md` — if modified
- `Resumes & Cover Letters/` — if new files were generated
- `WIP/` — specs, feature specs, architecture documents

**Git strategy: direct-to-main**
- All commits go directly to `main`. No session branches.
- Session boundaries are marked by `## Session Start` entries in the ledger, not branch boundaries.
- After each atomic commit, `git push origin main` fires serially (blocking).
- If push fails, error is logged to `~/.career-os-state/git-errors.log` and next push catches up.

## What This Skill Does NOT Do

- Does NOT capture conversations — hooks handle that
- Does NOT manage git commits or pushes — hooks handle that
- Does NOT modify ledger files — they are append-only

This skill is **read-only** against `brain/sessions/ledger/`.

## Edge Cases

- **No ledger files yet:** "No session history found. Start a conversation and come back — Career Intelligence captures every exchange automatically."
- **Search with no matches:** "No matches for '[term]' in your session history."
- **Very large ledger files:** Scan headers first (## lines) to identify relevant sections before reading full content. Avoid loading entire multi-hundred-line ledger files when only a snippet is needed.
- **Ambiguous date:** "replay last week" → show the summary table for that week, let user pick a day.
