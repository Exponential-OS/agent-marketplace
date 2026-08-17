---
name: organize
description: >
  Bulk file ingestion and self-evolving memory organization using relationship discovery.
  Auto-discovers relationships between stories, adds YAML frontmatter,
  regenerates indexes. Works incrementally — safe to run multiple times.
triggers:
  - organize
  - organize my files
  - ingest career files
  - link my stories
  - index my stories
---

# Organize — Career Intelligence Skill

## Purpose
Ingests existing career files into the `brain/` structure and discovers relationships between them. Cross-references stories by shared companies, people, competencies, and themes.

Safe to run multiple times — incremental by design.

## Output Format
Always start your response with this header so the user knows a Career Intelligence skill is responding:
```
━━━ Career Intelligence: Organize ━━━
```

## How It Works

This is a conversational skill. Claude reads the user's files, classifies them, confirms with the user, then organizes.

---

## BEHAVIOR: First Run (Bulk Ingestion)

When `brain/stories/STORY_INDEX.md` does NOT exist.

### Step 1: Scan

Scan the context folder recursively for career-relevant files:
- File types: `.md`, `.txt`, `.docx`, `.pdf`
- Skip: `brain/`, `.git/`, `node_modules/`, `Resumes & Cover Letters/` (already organized)

### Step 2: Classify

Classify each file into one of:

| Type | Destination | Detection signals |
|------|-------------|-------------------|
| Story | `brain/stories/` | Contains narrative about a project, achievement, or experience |
| Contact | `network/people/` | Contains info about a person — name, company, relationship |
| Resume | `Resumes & Cover Letters/` | Contains employment history, skills summary |
| Cover letter | `Resumes & Cover Letters/` | Addressed to hiring manager, references specific role |
| JD | `brain/reference/jd-samples/` | Job posting content — requirements, responsibilities |
| Notes | Leave in place | General notes, not career-specific enough to classify |
| Other | Leave in place | Binary files, non-career content |

### Step 3: Confirm

**ALWAYS present classification to user before any changes:**

```
I found these career-relevant files:

| File | Type | Action |
|------|------|--------|
| my-google-story.md | Story | → brain/stories/google-story.md |
| john-doe-notes.md | Contact | → network/people/john-doe.md |
| resume-2025.pdf | Resume | → Resumes & Cover Letters/ |
| random.txt | Notes | Leave in place |

Approve these changes? I won't move anything until you confirm.
```

### Step 4: Organize

On user approval:
1. Copy (not move) files to their destinations — originals stay until user deletes
2. Add YAML frontmatter to story files (see Frontmatter Format below)
3. Add YAML frontmatter to contact files
4. Run relationship discovery (see below)
5. Generate `brain/stories/STORY_INDEX.md`
6. Update `brain/identity/glossary.md` with extracted entities
7. Clear the pending flag: delete `~/.career-os-state/pending-organize` if it exists
8. Atomic commit: `git add brain/ "Resumes & Cover Letters/" && git commit`

---

## BEHAVIOR: Subsequent Runs (Incremental)

When `brain/stories/STORY_INDEX.md` EXISTS.

1. Scan for new/modified files not in STORY_INDEX.md
2. If new files found → classify, confirm, organize (same as first run)
3. Re-run relationship discovery across ALL stories (new + existing)
4. Update frontmatter on files where new relationships found
5. Regenerate STORY_INDEX.md
6. Update glossary.md
7. Atomic commit

If no new files found:
```
All files are organized. Running relationship discovery on existing stories...
```
Then run relationship discovery only and report any new connections found.

---

## Relationship Discovery

After files are organized, cross-reference all stories to find connections.

### Entity Extraction

From each story, extract:
- **Companies** mentioned (current, past, target)
- **People** mentioned (colleagues, managers, contacts)
- **Technologies** (languages, frameworks, tools, platforms)
- **Competencies** (leadership, architecture, scaling, hiring, etc.)
- **Themes** (failure/recovery, innovation, cross-functional, etc.)

### Cross-Referencing

For each pair of stories:
- Find shared entities (same company, same person, same tech)
- If 2+ shared entities → add to each other's `related_stories` frontmatter

### Output

Report connections found:
```
Relationship discovery complete:
  • "google-ml-platform" ↔ "google-team-scaling" — shared: Google, ML, leadership
  • "startup-pivot" ↔ "product-launch" — shared: product strategy, cross-functional
  • 3 new entities added to glossary
```

---

## Frontmatter Format

### Story Files

```yaml
---
title: Descriptive Story Title
companies:
  - Google
  - Anthropic
people:
  - Jane Smith
  - John Doe
competencies:
  - engineering leadership
  - system design
  - cross-functional collaboration
technologies:
  - Python
  - Kubernetes
  - LLMs
themes:
  - scaling teams
  - technical strategy
interview_questions:
  - Tell me about a time you scaled a team
  - Describe a technical decision with significant trade-offs
related_stories:
  - google-team-scaling
  - startup-pivot
---
```

### Contact Files

```yaml
---
name: Jane Smith
companies:
  - Google (2020-2023)
  - Anthropic (2023-present)
relationship: former colleague
warmth: 3  # 1=cold, 2=network, 3=warm-professional, 4=warm-offline, 5=inner-circle
channel: linkedin
last_contact: 2026-03-01
context: Worked together on ML platform team at Google
---
```

---

## STORY_INDEX.md Format

```markdown
# Story Index

Generated by Career Intelligence organize skill. Do not edit manually — will be regenerated.

| Story | Companies | Competencies | Related |
|-------|-----------|-------------|---------|
| [google-ml-platform](stories/google-ml-platform.md) | Google | system design, ML | google-team-scaling |
| [google-team-scaling](stories/google-team-scaling.md) | Google | leadership, hiring | google-ml-platform |
| [startup-pivot](stories/startup-pivot.md) | StartupCo | product strategy | product-launch |
```

---

## Glossary Update

After organizing, update `brain/identity/glossary.md` with:
- New companies mentioned across stories
- New people mentioned (with story references)
- New technologies and competencies

Merge with existing glossary content — never overwrite what's already there.

---

## Edge Cases

- **Files with existing frontmatter:** Merge new fields, don't overwrite existing values
- **Empty files:** Skip with note in output
- **Binary files (.pdf, .docx):** Classify by filename, copy without adding frontmatter
- **Duplicate content:** Flag for user — "These two files look similar, keep both?"
- **Large folders (50+ files):** Batch classification in groups of 10, confirm each batch
