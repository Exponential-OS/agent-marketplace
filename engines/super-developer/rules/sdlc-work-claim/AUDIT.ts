#!/usr/bin/env bun
/**
 * AUDIT.ts — compliance check for sdlc-work-claim.
 *
 * Two layers:
 *  1. Source check (build-time): verify handler.ts still enforces the
 *     invariants this gate exists for — LINEAR_API_KEY required + FAIL-HARD,
 *     STALE_MIN dead-agent window, compare-and-set race guard, the four
 *     actions (check/claim/heartbeat/release). If any regresses silently the
 *     cross-machine coordination guarantee is gone.
 *  2. Log read (runtime): summarize claim/block/release events from
 *     ~/.cyborg-enforcement-log.jsonl over the window — who claimed what,
 *     how many collisions were BLOCKED, any stale reclaims.
 *
 * Usage:
 *   bun run AUDIT.ts        # last 7 days of log
 *   bun run AUDIT.ts 30     # last 30 days
 *
 * Exit: 1 if a SOURCE invariant regressed (the gate is broken); 0 otherwise
 *       (log audit is read-only — surfaces signals, never blocks).
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SLUG = "sdlc-work-claim";
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const HANDLER_PATH = join(dirname(fileURLToPath(import.meta.url)), "handler.ts");

/**
 * Source check: the handler must still encode the four load-bearing invariants.
 * These are the exact properties that, if dropped, make the gate fail-open and
 * let two machines claim the same work unit — the failure this rule prevents
 * (observed 2026-06-09: two sessions both shipped XOS-25).
 */
function checkHandlerInvariants(): boolean {
  console.log("=== Source check: handler.ts invariants ===");
  if (!existsSync(HANDLER_PATH)) {
    console.log(`  FAIL: handler.ts not found at ${HANDLER_PATH}`);
    return false;
  }
  const raw = readFileSync(HANDLER_PATH, "utf8");
  // Strip comments so a commented-out invariant can't pass the check.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  const required: Array<{ name: string; re: RegExp }> = [
    { name: "LINEAR_API_KEY required (cross-machine source of truth)", re: /LINEAR_API_KEY/ },
    { name: "FAIL-HARD on missing key (throw, not warn-and-continue)", re: /throw new Error\([^)]*LINEAR_API_KEY|requireLinearApiKey/ },
    { name: "STALE_MIN dead-agent reclaim window", re: /STALE_MIN\s*=\s*\d+/ },
    { name: "action: check", re: /checkClaim|"check"/ },
    { name: "action: claim", re: /claimTicket|"claim"/ },
    { name: "action: heartbeat", re: /heartbeatTicket|"heartbeat"/ },
    { name: "action: release", re: /releaseTicket|"release"/ },
    { name: "live-holder block (compare-and-set guard)", re: /isHeldByDifferentLiveSession|reclaimable/ },
  ];
  const missing = required.filter((r) => !r.re.test(src));
  for (const r of required) {
    console.log(`  ${missing.includes(r) ? "FAIL" : "ok  "}  ${r.name}`);
  }
  if (missing.length > 0) {
    console.log(`\n  WHAT: ${missing.length} invariant(s) regressed in handler.ts.`);
    console.log("  HOW: restore the missing property — the gate fails-open without it, letting two machines claim the same ticket.");
    return false;
  }
  console.log("  PASS: all 8 invariants present.\n");
  return true;
}

interface LogRec {
  ts?: string;
  slug?: string;
  action?: string;
  ticket?: string;
  session?: string;
  verdict?: string;
  reclaimable?: boolean;
}

function auditLog(days: number): void {
  console.log(`=== Log audit: last ${days} days (${LOG_PATH}) ===`);
  if (!existsSync(LOG_PATH)) {
    console.log("  (no enforcement log yet — gate has not fired, or LINEAR_API_KEY unset)\n");
    return;
  }
  const cutoff = Date.now() - days * 86_400_000;
  const recs: LogRec[] = readFileSync(LOG_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as LogRec;
      } catch {
        return {} as LogRec;
      }
    })
    .filter((r) => r.slug === SLUG && r.ts && Date.parse(r.ts) >= cutoff);

  if (recs.length === 0) {
    console.log("  0 invocations in window.\n");
    return;
  }
  const byAction = new Map<string, number>();
  const blocks: LogRec[] = [];
  const reclaims: LogRec[] = [];
  for (const r of recs) {
    byAction.set(r.action ?? "?", (byAction.get(r.action ?? "?") ?? 0) + 1);
    if (r.verdict === "BLOCK") blocks.push(r);
    if (r.reclaimable) reclaims.push(r);
  }
  console.log(`  ${recs.length} invocations.`);
  for (const [a, n] of byAction) console.log(`    ${a}: ${n}`);
  console.log(`  ${blocks.length} BLOCK (collisions prevented), ${reclaims.length} stale-reclaimable signals.`);
  for (const b of blocks.slice(-5)) {
    console.log(`    BLOCK  ${b.ts}  ${b.ticket}  by-session=${b.session}`);
  }
  console.log("");
}

const days = Number(process.argv[2] ?? "7");
const sourceOk = checkHandlerInvariants();
auditLog(Number.isFinite(days) ? days : 7);
process.exit(sourceOk ? 0 : 1);
