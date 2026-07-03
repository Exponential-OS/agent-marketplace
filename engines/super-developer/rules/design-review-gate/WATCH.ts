#!/usr/bin/env bun
/**
 * WATCH.ts - keep / kill / modify harness for design-review-gate.
 *
 * Runs synthetic tests, checks whether a Claude Bash PreToolUse hook appears
 * registered, and reports recent gate activity. Settings activation is
 * intentionally human-gated; this script only reports registration state.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const SLUG = "design-review-gate";
const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = join(HERE, "tests.ts");
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const SETTINGS_PATHS = [
  join(homedir(), ".claude", "settings.json"),
  join(homedir(), ".claude", "settings.local.json"),
  join(process.cwd(), ".claude", "settings.json"),
  join(process.cwd(), ".claude", "settings.local.json"),
];

interface LogRow {
  ts?: string;
  slug?: string;
  rule_slug?: string;
  verdict?: string;
  reason?: string;
}

function runTests(): boolean {
  const result = spawnSync("bun", ["test", "./tests.ts"], { cwd: HERE, encoding: "utf8" });
  const passed = result.status === 0;
  console.log(`1. CORRECTNESS  : tests.ts ${passed ? "PASS" : "FAIL"}`);
  if (!passed) {
    const tail = [result.stdout, result.stderr].filter(Boolean).join("\n").split("\n").slice(-12).join("\n");
    console.log(tail);
  }
  return passed;
}

function hookRegistered(): boolean {
  const hits: string[] = [];
  for (const path of SETTINGS_PATHS) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes(SLUG) || text.includes("design-review-gate/handler.ts")) hits.push(path);
  }
  console.log(`2. HOOK         : ${hits.length > 0 ? "registered in " + hits.join(", ") : "not registered in checked Claude settings"}`);
  return hits.length > 0;
}

function recentActivity(): void {
  console.log(`3. ACTIVITY     : ${LOG_PATH}`);
  if (!existsSync(LOG_PATH)) {
    console.log("                 no enforcement log yet");
    return;
  }
  const rows: LogRow[] = [];
  for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as LogRow;
      if (row.slug === SLUG || row.rule_slug === SLUG) rows.push(row);
    } catch {
      /* skip malformed rows */
    }
  }
  if (rows.length === 0) {
    console.log("                 no design-review-gate rows yet");
    return;
  }
  const recent = rows.slice(-5);
  for (const row of recent) {
    console.log(`                 ${row.ts ?? "(no-ts)"} ${row.verdict ?? "UNKNOWN"} ${row.reason ?? ""}`);
  }
}

console.log("=== WATCH: design-review-gate - keep/kill/modify ===\n");
const correct = runTests();
const wired = hookRegistered();
recentActivity();

console.log("\n--- VERDICT ---");
if (!correct) {
  console.log("MODIFY (urgent): correctness tests failed.");
} else if (!wired) {
  console.log("KEEP (activation pending): rule is correct, but the Bash PreToolUse hook is not registered in checked settings.");
} else {
  console.log("KEEP: correct and registered.");
}
process.exit(0);
