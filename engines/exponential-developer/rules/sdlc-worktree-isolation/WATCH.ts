#!/usr/bin/env bun
/**
 * WATCH.ts - keep / kill / modify harness for sdlc-worktree-isolation.
 *
 * Runs the synthetic bun tests, checks whether the Bash PreToolUse hook appears
 * registered, and inspects the configured shared worktree shape so the rule can be revisited
 * if the shared-primary premise changes.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const SLUG = "sdlc-worktree-isolation";
const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = join(HERE, "tests.ts");
const SETTINGS_PATHS = [
  join(homedir(), ".claude", "settings.json"),
  join(homedir(), ".claude", "settings.local.json"),
  join(process.cwd(), ".claude", "settings.json"),
  join(process.cwd(), ".claude", "settings.local.json"),
];

function runTests(): boolean {
  const result = spawnSync("bun", ["test", "./tests.ts"], { cwd: HERE, encoding: "utf8" });
  const passed = result.status === 0;
  console.log(`1. CORRECTNESS  : tests.ts ${passed ? "PASS" : "FAIL"}`);
  if (!passed) {
    const tail = [result.stdout, result.stderr].filter(Boolean).join("\n").split("\n").slice(-10).join("\n");
    console.log(tail);
  }
  return passed;
}

function hookRegistered(): boolean {
  const hits: string[] = [];
  for (const path of SETTINGS_PATHS) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes(SLUG) || text.includes("sdlc-worktree-isolation/handler.ts")) hits.push(path);
  }
  console.log(`2. HOOK         : ${hits.length > 0 ? "registered in " + hits.join(", ") : "not registered in checked Claude settings"}`);
  return hits.length > 0;
}

function cyborgWorktreeShape(): boolean {
  const repo = join(homedir(), "cyborg");
  if (!existsSync(repo)) {
    console.log(`3. PREMISE      : ${repo} missing - cannot inspect shared primary checkout`);
    return false;
  }
  const result = spawnSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (result.status !== 0) {
    console.log("3. PREMISE      : git worktree list failed - cannot inspect shared primary checkout");
    return false;
  }
  const worktrees = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
  const primary = worktrees[0] ?? "";
  const linked = worktrees.slice(1);
  const primaryIsShared = primary === repo;
  console.log(`3. PREMISE      : primary=${primary || "(none)"} linked_worktrees=${linked.length}`);
  if (!primaryIsShared) {
    console.log("                 MODIFY: first worktree is not the configured shared repo; primary/shared assumption changed.");
    return false;
  }
  return true;
}

console.log("=== WATCH: sdlc-worktree-isolation - keep/kill/modify ===\n");
const correct = runTests();
const wired = hookRegistered();
const premise = cyborgWorktreeShape();

console.log("\n--- VERDICT ---");
if (!correct || !premise) {
  console.log("MODIFY (urgent): correctness or shared-primary premise failed.");
} else if (!wired) {
  console.log("KEEP (gap): rule is correct, but the Bash PreToolUse hook is not registered in checked settings.");
} else {
  console.log("KEEP: correct, registered, and the shared-primary premise still holds.");
}
process.exit(0);
