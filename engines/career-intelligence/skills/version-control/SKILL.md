---
name: version-control
description: >
  Backup status, remote setup, Codeberg mirror, manual sync, and data recovery
  for Career OS. The hooks handle auto-commit/push — this skill handles setup,
  monitoring, and recovery.
triggers:
  - backup
  - vc
  - backup status
  - is my data safe
  - version control
  - git setup
  - set up git
  - connect github
  - codeberg mirror
  - set up mirror
  - add codeberg
  - push to github
  - push now
  - sync
  - recover
  - I lost data
  - restore
  - undo
---

# Version Control — Career OS Skill

## Purpose

Check backup health, set up remotes, sync on demand, and recover data.
Auto-commit and push are handled by hooks — this skill handles **setup,
monitoring, and recovery**.

## Output Format

Always start your response with:
```
━━━ Career OS: Version Control ━━━
```

## Capabilities

### 1. Backup Status

**Triggers:** "backup", "backup status", "is my data safe", "version control"

Check and report the health of the user's backup:

1. Run `git log -1 --format="%H %ci"` — last commit hash and timestamp
2. Run `git status -sb` — check if local is ahead of remote
3. Run `git remote -v` — list configured remotes
4. For each remote: `git ls-remote --exit-code <remote> HEAD 2>/dev/null` — connectivity check
5. Count unpushed commits: `git rev-list origin/main..HEAD --count`
6. Present as a health card:

```
━━━ Career OS: Version Control ━━━

Backup Status:

| Check | Status |
|-------|--------|
| Last commit | 2 minutes ago (2026-03-31 14:32:05) |
| Remote sync | ✅ up to date with origin/main |
| Unpushed | 0 commits |
| origin | github.com/user/career-os ✅ reachable |
| codeberg | codeberg.org/user/career-os ✅ reachable |

Everything is backed up.
```

If issues found, show specific guidance:
- Unpushed commits → "Run 'push now' to sync"
- Remote unreachable → "Check your internet connection or GitHub status"
- No remote configured → "Run 'git setup' to connect a remote"

### 2. Codeberg Mirror Setup

**Triggers:** "codeberg mirror", "set up mirror", "add codeberg"

Guided setup for dual-remote backup:

1. Check if `codeberg` remote already exists (`git remote -v | grep codeberg`)
   - If exists → show current config and ask if user wants to update it
2. If not configured, guide through setup:
   ```
   ━━━ Career OS: Version Control ━━━

   Codeberg Mirror Setup:

   Codeberg is a nonprofit, EU-based Git host — a second copy of your career data
   independent of GitHub.

   Steps:
   1. Create account at codeberg.org (if you don't have one)
   2. Create a new empty repo (same name as your GitHub repo works well)
   3. Give me the repo URL and I'll configure the mirror

   What's your Codeberg repo URL? (e.g., https://codeberg.org/username/career-os.git)
   ```
3. On receiving URL:
   - `git remote add codeberg <url>`
   - `git push codeberg main`
   - Verify: `git ls-remote --exit-code codeberg HEAD`
4. If GitHub Actions available, mention `mirror-codeberg.yml` for auto-sync:
   ```
   Mirror configured. For automatic sync on every push:
   - Copy .github/workflows/mirror-codeberg.yml to your data repo
   - Add CODEBERG_TOKEN as a GitHub Actions secret
   ```

### 3. Git Setup / First-Time Setup

**Triggers:** "git setup", "set up git", "connect github"

For workspaces without a remote:

1. Check `git remote -v`
2. **If no remote:**
   ```
   ━━━ Career OS: Version Control ━━━

   Your career data isn't connected to a remote yet. Let's fix that.

   Option A: Create a new GitHub repo
     → I'll guide you through gh repo create

   Option B: Connect an existing repo
     → Give me the URL (e.g., https://github.com/you/career-os.git)

   Which option?
   ```
3. **Option A flow:**
   - Check `gh auth status` — if not authed, guide through `gh auth login`
   - `gh repo create career-os --private --source=. --push`
   - Verify: `git remote -v` and `git ls-remote origin HEAD`
4. **Option B flow:**
   - `git remote add origin <url>`
   - `git push -u origin main`
   - Verify connectivity
5. **If remote exists:** show backup status (capability 1)

### 4. Manual Push / Sync

**Triggers:** "push to github", "push now", "sync"

Force an immediate sync:

1. Check for uncommitted changes (`git status --porcelain`)
   - If uncommitted changes exist → `git add brain/ CLAUDE.md NEXT_SESSION_HANDOFF.md "Resumes & Cover Letters/" WIP/ 2>/dev/null; git commit -m "manual sync"`
2. Push to origin: `git push origin main`
3. If codeberg remote exists: `git push codeberg main`
4. Report result:

```
━━━ Career OS: Version Control ━━━

Sync complete:
  origin (github):   ✅ pushed (3 commits)
  codeberg (mirror): ✅ pushed (3 commits)
```

### 5. Data Recovery Guidance

**Triggers:** "recover", "I lost data", "restore", "undo"

When the user thinks they lost data:

1. **Assess the situation** — ask what they think is missing if not clear
2. **Check local state:**
   - `git log --oneline -20` — show recent commits
   - `git stash list` — any stashed changes
   - `git diff HEAD` — any uncommitted changes
3. **Check remote state:**
   - `git log origin/main --oneline -5` — is remote ahead or behind?
4. **Present recovery options based on findings:**

```
━━━ Career OS: Version Control ━━━

Recovery Options:

Your recent history:
  abc1234  2 min ago   exchange: pipeline review
  def5678  15 min ago  exchange: resume customization
  ghi9012  1 hour ago  session-start: 2026-03-31 14:32

Options:
  a) View a file from a previous commit: "show me [file] from [commit/time]"
  b) Restore a file: "restore [file] from [commit]"
  c) Pull from remote: if remote has data your local doesn't

Which would you like?
```

5. **Execute recovery:**
   - View old version: `git show <commit>:<path>`
   - Restore file: `git checkout <commit> -- <path>` — **confirm with user first**
   - Pull from remote: `git pull origin main`
6. **NEVER run destructive commands** (`git reset --hard`, `git clean -f`, `git checkout .`) without explicit user confirmation and explanation of consequences

## How It Works (Automated Backup)

The hooks handle automatic backup — no manual invocation needed for normal operation.

**Architecture:**
- **Primary remote:** GitHub (required)
- **Mirror remote:** Codeberg (recommended, nonprofit EU-based)

**Git strategy: direct-to-main**
- All commits go directly to `main`. No session branches.
- One atomic commit per conversation exchange (unified commit model).
- After each commit: `git push origin main` fires serially (blocking).
- If push fails, error is logged to `~/.career-os-state/git-errors.log`.

**Unified commit model:**
Every commit captures all managed file changes atomically:
- `brain/` — ledger, memory, tasks, config, logs
- `CLAUDE.md` — if modified
- `NEXT_SESSION_HANDOFF.md` — if modified
- `Resumes & Cover Letters/` — if new output generated
- `WIP/` — specs, feature specs, architecture documents

**Stale lock recovery:**
On each `SessionStart`, the hook checks for `.git/index.lock` files older than 60 seconds
and removes them — prevents stale locks from crashed processes.

**Error logging:**
All git failures logged to `~/.career-os-state/git-errors.log` with timestamps.

## Secrets Handling

Tokens in `brain/.env` (local, never committed):
- `GITHUB_PAT` — for GitHub API operations
- `CODEBERG_TOKEN` — for Codeberg mirror

Three protection layers: `.gitignore` + `chmod 600` + first-run prompt.
GitHub Actions use GitHub Settings → Secrets (not `.env`).

## What This Skill Does NOT Do

- Does NOT auto-commit or auto-push — hooks handle that
- Does NOT manage ledger files — session-logger hooks handle that
- Does NOT run destructive git operations without explicit user confirmation

## Edge Cases

- **No git repo:** "This workspace isn't a git repo yet. Run 'git setup' to get started."
- **No remote:** Direct to capability 3 (Git Setup).
- **Auth expired:** "GitHub authentication expired. Run `gh auth login` to re-authenticate."
- **Merge conflict on push:** "Push failed due to a conflict. This usually means another session pushed first. Run `git pull --rebase origin main` to catch up, then try again."
- **Codeberg token missing for Actions:** Guide user to create token and add as GitHub secret.
