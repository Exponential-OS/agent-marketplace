#!/usr/bin/env bun
/**
 * AUDIT.ts - compliance check for design-review-gate.
 *
 * Source-checks the Stage-4 command classifiers, sidecar verdict hash gate,
 * emergency bypass, fail-hard BLOCK output, fail-open crash path, and mode bits.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SLUG = "design-review-gate";
const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = join(HERE, "handler.ts");
const MANIFEST_PATH = join(HERE, "manifest.json");
const AUDIT_PATH = join(HERE, "AUDIT.ts");
const WATCH_PATH = join(HERE, "WATCH.ts");
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");

interface LogRow {
  ts?: string;
  slug?: string;
  rule_slug?: string;
  verdict?: string;
  target?: string;
  reason?: string;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function mode755(path: string): boolean {
  if (!existsSync(path)) return false;
  return (statSync(path).mode & 0o777) === 0o755;
}

function checkSource(): boolean {
  console.log("=== Source check: design-review-gate invariants ===");
  if (!existsSync(HANDLER_PATH)) {
    console.log(`  FAIL  handler.ts exists`);
    console.log(`\nWHAT: handler.ts missing at ${HANDLER_PATH}.`);
    console.log("HOW: restore rules/design-review-gate/handler.ts before relying on this rule.");
    return false;
  }

  const src = stripComments(readFileSync(HANDLER_PATH, "utf8"));
  const manifest = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, "utf8") : "";
  const required: Array<{ name: string; ok: boolean }> = [
    { name: "classifies codex exec as Stage-4 build", ok: /exec === "codex"/.test(src) && /args\[0\] === "exec"/.test(src) },
    { name: "classifies git worktree add -b feat/*", ok: /worktreeBranch/.test(src) && /startsWith\("feat\/"\)/.test(src) },
    { name: "resolves docs/plans spec path", ok: /docs\/plans/.test(src) && /resolveSpecPathForInput/.test(src) },
    { name: "verdict sidecar is .design-review.json", ok: /\.design-review\.json/.test(src) && /verdictPathForSpec/.test(src) },
    { name: "checks spec_sha256 against current plan file", ok: /spec_sha256/.test(src) && /sha256File/.test(src) },
    { name: "BLOCKs missing verdict record", ok: /no design-review verdict record exists/.test(src) },
    { name: "BLOCKs RED and UNREACHABLE", ok: /verdict === "RED"/.test(src) && /verdict === "UNREACHABLE"/.test(src) },
    { name: "BLOCKs applied Class-B adjustments", ok: /hasClassBApplied/.test(src) && /Class-B design adjustment was applied/.test(src) },
    { name: "allows GREEN, SKIPPED, and YELLOW with no Class-B applied", ok: /verdict === "GREEN"/.test(src) && /verdict === "SKIPPED"/.test(src) && /verdict === "YELLOW"/.test(src) },
    { name: "emergency bypass is logged", ok: /DESIGN_REVIEW_GATE_OFF/.test(src) && /bypass/.test(src) },
    { name: "BLOCK message contains Gate-A.7 WHAT and HOW", ok: /WHAT: Gate-A\.7 design-review gate blocked Stage 4/.test(src) && /HOW: run `bun run/.test(src) },
    { name: "PreToolUse BLOCK emits deny JSON", ok: /permissionDecision:\s*"deny"/.test(src) && /decision:\s*"block"/.test(src) },
    { name: "BLOCK exits non-zero", ok: /process\.exit\(output\.verdict === "BLOCK" \? 1 : 0\)/.test(src) },
    { name: "handler crash fails open", ok: /fail-open/.test(src) && /process\.exit\(0\)/.test(src) },
    { name: "manifest declares PreToolUse Bash hook", ok: /"hook_type"\s*:\s*"PreToolUse"/.test(manifest) && /"Bash"/.test(manifest) },
    { name: "manifest records XOS-196 origin", ok: /XOS-196/.test(manifest) },
    { name: "handler/AUDIT/WATCH are mode 755", ok: mode755(HANDLER_PATH) && mode755(AUDIT_PATH) && mode755(WATCH_PATH) },
  ];

  const missing = required.filter((item) => !item.ok);
  for (const item of required) console.log(`  ${item.ok ? "ok  " : "FAIL"}  ${item.name}`);
  if (missing.length > 0) {
    console.log(`\nWHAT: ${missing.length} source invariant(s) regressed in ${SLUG}.`);
    console.log("HOW: restore the missing handler/manifest/mode invariant before trusting the design-review gate.");
    return false;
  }
  console.log("  PASS: source invariants present.\n");
  return true;
}

function readRows(): LogRow[] {
  if (!existsSync(LOG_PATH)) return [];
  const rows: LogRow[] = [];
  for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as LogRow);
    } catch {
      /* skip malformed rows */
    }
  }
  return rows;
}

function auditLog(days: number): void {
  console.log(`=== Log audit: last ${days} days (${LOG_PATH}) ===`);
  if (!existsSync(LOG_PATH)) {
    console.log("  (no enforcement log yet)\n");
    return;
  }
  const cutoffMs = Date.now() - days * 86_400_000;
  const rows = readRows().filter((row) => (row.slug === SLUG || row.rule_slug === SLUG) && row.ts && Date.parse(row.ts) >= cutoffMs);
  if (rows.length === 0) {
    console.log("  0 invocations in window.\n");
    return;
  }
  const verdicts = new Map<string, number>();
  for (const row of rows) {
    const verdict = row.verdict ?? "UNKNOWN";
    verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);
  }
  console.log(`  ${rows.length} invocations.`);
  for (const [verdict, count] of Array.from(verdicts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(4)}  ${verdict}`);
  }
  const recentBlocks = rows.filter((row) => row.verdict === "BLOCK").slice(-5);
  if (recentBlocks.length > 0) {
    console.log("  recent BLOCK events:");
    for (const row of recentBlocks) console.log(`    ${row.ts}  ${row.target}  ${row.reason}`);
  }
  console.log("");
}

const days = Number(process.argv[2] ?? "7");
const sourceOk = checkSource();
auditLog(Number.isFinite(days) && days > 0 ? days : 7);
process.exit(sourceOk ? 0 : 1);
