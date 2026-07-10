#!/usr/bin/env bun
/**
 * WATCH.ts — keep / kill / modify harness for sdlc-work-claim.
 *
 * Per CONSTITUTION-AS-LIVING-CODE: every rule carries a WATCH that periodically
 * asks "is this rule still earning its keep, and is it actually enforced live?"
 * and emits a keep/kill/modify verdict. This is the P14 self-evolution loop,
 * distinct from tests.ts (which proves correctness of the claim mechanics).
 *
 * What it checks:
 *  1. CORRECTNESS — runs tests.ts; if the mechanics regressed, the rule is
 *     broken regardless of how useful it is.
 *  2. LIVE-ENFORCEMENT — is LINEAR_API_KEY set? Without it the gate FAIL-HARDs
 *     and the pipeline cannot claim, so the rule is shipped-but-dark. This is
 *     the single biggest gap between "codified" and "enforcing".
 *  3. WIRING — is the gate still invoked from ship-feature.md Stage 0? A rule
 *     no run calls is dead code.
 *
 * Usage: bun run WATCH.ts
 * Exit:  0 (advisory — emits a verdict, does not gate).
 */

import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = join(HERE, "tests.ts");
const SHIP_FEATURE = join(HERE, "..", "..", "infrastructure", "claude-commands", "ship-feature.md");

function runTests(): boolean {
  if (!existsSync(TESTS)) return false;
  // tests.ts uses the `bun test` runner (afterEach/expect), not `bun run`.
  const r = spawnSync("bun", ["test", "./tests.ts"], { cwd: HERE, encoding: "utf8" });
  const passed = r.status === 0;
  console.log(`1. CORRECTNESS  : tests.ts ${passed ? "PASS" : "FAIL"}`);
  if (!passed) console.log([r.stdout, r.stderr].filter(Boolean).join("\n").split("\n").slice(-6).join("\n"));
  return passed;
}

function liveEnforcement(): boolean {
  const hasKey = Boolean(process.env.LINEAR_API_KEY?.trim());
  console.log(
    `2. LIVE-ENFORCE : LINEAR_API_KEY ${hasKey ? "SET — gate enforces live" : "UNSET — gate is shipped-but-dark (FAIL-HARDs on every run)"}`,
  );
  return hasKey;
}

function wiring(): boolean {
  if (!existsSync(SHIP_FEATURE)) {
    console.log("3. WIRING       : ship-feature.md not found — cannot confirm Stage 0 wiring");
    return false;
  }
  const wired = /sdlc-work-claim\/handler\.ts/.test(readFileSync(SHIP_FEATURE, "utf8"));
  console.log(`3. WIRING       : ship-feature.md Stage 0 ${wired ? "invokes the gate" : "does NOT invoke the gate — DEAD CODE"}`);
  return wired;
}

console.log("=== WATCH: sdlc-work-claim — keep/kill/modify ===\n");
const correct = runTests();
const live = liveEnforcement();
const wired = wiring();

console.log("\n--- VERDICT ---");
if (!correct || !wired) {
  console.log("MODIFY (urgent): mechanics or wiring broken — fix before relying on the gate.");
} else if (!live) {
  console.log(
    "KEEP (gap): rule is correct + wired, but UNENFORCED until LINEAR_API_KEY is set.\n" +
      "  Action: set LINEAR_API_KEY (Linear → Settings → API → Personal API keys) to activate cross-machine enforcement.",
  );
} else {
  console.log("KEEP: correct, wired, and enforcing live. No change.");
}
process.exit(0);
