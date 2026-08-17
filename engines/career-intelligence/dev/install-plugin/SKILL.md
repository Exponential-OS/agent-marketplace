---
name: Install Career Intelligence Plugin
description: Installs or updates the Career Intelligence plugin from GitHub. Handles auth, validates install, confirms plugin is ready.
---

# Install Career Intelligence Plugin

## What This Does
Installs (or updates) the Career Intelligence plugin from its GitHub repo into Claude Code's plugin system. Handles GitHub authentication, validates the install, and confirms the plugin is ready for use.

Does NOT set up a career workspace — that happens automatically on first session start via the plugin's SessionStart hook.

## Steps

### 1. Check prerequisites
Verify the tools needed are available:
- `claude` CLI exists
- `git` exists
- `gh` CLI exists (needed for auth)

If any are missing, stop and tell the user what to install.

### 2. Check GitHub authentication
Run `gh auth status` to check if the user is authenticated to github.com.

**If NOT authenticated:**
1. Tell the user: "Career Intelligence plugin is hosted on GitHub. You need to authenticate."
2. Run `gh auth login` — this handles OAuth securely via GitHub's device flow. No tokens stored in plaintext.
3. Verify auth succeeded with `gh auth status`.
4. If auth fails, stop and provide the manual auth instructions:
   ```
   Run: gh auth login
   Select: GitHub.com → HTTPS → Authenticate with browser
   ```

**If already authenticated:** proceed.

### 3. Check if plugin is already installed
Run `claude plugin list 2>/dev/null` and check if `career-os` appears.

**If installed:**
- Show the installed version
- Ask: "Career Intelligence plugin is already installed (v{version}). Update to latest? (y/n)"
- If yes → run `claude plugin update career-intelligence@xos` or uninstall + reinstall
- If no → skip to Step 5 (verify)

**If not installed:** proceed to Step 4.

### 4. Install the plugin
Run:
```bash
claude plugin install career-intelligence@xos --scope user
```

If the install command fails:
- Check if the error is auth-related → retry auth (Step 2)
- Check if the error is network-related → tell user to check connectivity
- For any other error → show the raw error and stop

### 5. Verify installation
Run these checks:
1. `claude plugin list` — confirm `career-intelligence` appears
2. Check that the plugin cache directory exists: `~/.claude/plugins/cache/xos/career-intelligence/`
3. Validate plugin.json exists in the cached path
4. Check hooks.json exists and registers all 3 hooks (SessionStart, UserPromptSubmit, Stop)
5. Read the installed version from plugin.json

Output verification result:
```
✅ Career Intelligence plugin v{version} installed successfully.

Next steps:
1. Open a Cowork session with a fresh folder as your career workspace
2. Career Intelligence will automatically scaffold the workspace on first run
3. Say "mission control" to see your career home screen

Requirements:
- The workspace folder needs git initialized
- Connect a GitHub repo as remote for backup
```

### 6. On failure at any step — stop and guide
Do NOT retry silently. Output:

```
❌ Installation failed at: {step name}
Error: {error message}

{If auth issue}
→ Run: gh auth login
→ Then retry: install cosp plugin

{If network issue}
→ Check your internet connection
→ Verify https://github.com/Exponential-OS/career-intelligence-engine is accessible

{If plugin system issue}
→ Try manual install: claude plugin install career-intelligence@xos --scope user
→ Or load per-session: claude --plugin-dir /path/to/career-intelligence-engine
```

## Security Notes
- GitHub auth is handled entirely by `gh auth login` — uses OAuth device flow, tokens stored in the OS keyring (macOS Keychain). No plaintext credentials.
- The plugin repo is public (MIT license). No special permissions needed beyond basic GitHub access.
- Plugin hooks run shell scripts in the user's workspace. Review hooks/scripts/ if you want to audit what runs.
