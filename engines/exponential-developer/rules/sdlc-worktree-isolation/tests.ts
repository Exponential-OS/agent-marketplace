import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { processInput, type ProcessOptions } from "./handler";

const fakeHome = "/Users/tester";
const sharedRepoName = "cyborg";
const sharedRepoShell = `~/${sharedRepoName}`;
const primary = `${fakeHome}/cyborg`;
const linked = "/tmp/cyborg-xyz";
const nonShared = `${fakeHome}/aiprojects/foo`;
const tempDirs: string[] = [];

function tempLog(): string {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-worktree-isolation-test-"));
  tempDirs.push(dir);
  return join(dir, "log.jsonl");
}

function options(): ProcessOptions {
  const logPath = tempLog();
  return {
    homeDir: fakeHome,
    sharedRepos: [sharedRepoShell],
    logPath,
    now: new Date("2026-06-09T12:00:00Z"),
    realpath(path: string): string {
      return resolve(path);
    },
    resolveGitToplevel(target: string): string | null {
      const normalized = resolve(target);
      if (normalized === primary || normalized.startsWith(primary + "/")) return primary;
      if (normalized === linked || normalized.startsWith(linked + "/")) return linked;
      if (normalized === nonShared || normalized.startsWith(nonShared + "/")) return nonShared;
      return normalized;
    },
    resolvePrimaryWorktree(repo: string): string | null {
      return resolve(repo) === primary ? primary : null;
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("BLOCK: git -C shared repo commit -m x from a non-worktree cwd", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} commit -m x`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
  expect(result.message).toContain("WHAT:");
  expect(result.message).toContain("HOW:");
});

test("BLOCK: bare git commit with cwd at shared primary", () => {
  const result = processInput({ command: "git commit -m x", cwd: primary }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
});

test("PASS: git -C /tmp/cyborg-xyz commit in linked worktree", () => {
  const result = processInput({ command: "git -C /tmp/cyborg-xyz commit -m x", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(linked);
  expect(result.reason).toContain("not a designated shared primary checkout");
});

test("PASS: git -C shared repo status is read-only", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} status`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(primary);
});

test("PASS: git -C shared repo worktree add is allowlisted", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} worktree add /tmp/x`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("worktree");
});

test("PASS: git -C ~/aiprojects/foo commit is non-designated", () => {
  const result = processInput({ command: "git -C ~/aiprojects/foo commit -m x", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(nonShared);
});

test("PASS: git -C shared repo fetch is read-only allowlisted", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} fetch`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
});

test("PASS: git -C shared repo pull --ff-only is safe fast-forward sync", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} pull --ff-only`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(primary);
  expect(result.reason).toContain("idempotent fast-forward sync");
});

test("PASS: git -C shared repo pull --ff-only origin main is safe fast-forward sync", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} pull --ff-only origin main`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(primary);
  expect(result.reason).toContain("idempotent fast-forward sync");
});

test("BLOCK: git -C shared repo pull without --ff-only mutates the primary checkout", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} pull`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
});

test("BLOCK: unknown git subcommand against primary checkout fails closed", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} frobnicate`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
  expect(result.reason).toContain("unrecognized subcommand");
  expect(result.reason).toContain("fail-closed");
});

test("PASS: unknown git subcommand in non-shared repo does not over-block", () => {
  const result = processInput({ command: "git -C /tmp/other frobnicate", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe("/tmp/other");
  expect(result.reason).toContain("target is not a designated shared primary checkout");
});

test("PASS: git -C shared repo branch -a is read-only allowlisted", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} branch -a`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
});

test("BLOCK: compound command blocks mutating git after non-git clause", () => {
  const result = processInput({ command: `echo hi && git -C ${sharedRepoShell} commit -m x`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
});

test("PASS: compound command allows multiple read-only git operations", () => {
  const result = processInput({ command: `git -C ${sharedRepoShell} status && git -C ${sharedRepoShell} log`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
});

test("BLOCK: compound command blocks when later git clause hits primary", () => {
  const result = processInput({ command: `git -C /tmp/wt commit && git -C ${sharedRepoShell} add .`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
});

test("BLOCK: subshell cd into primary applies to bare git invocation", () => {
  const result = processInput({ command: `(cd ${sharedRepoShell} && git commit -m x)`, cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(primary);
});
