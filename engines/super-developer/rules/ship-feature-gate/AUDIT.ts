#!/usr/bin/env bun
/**
 * AUDIT.ts - compliance check for ship-feature-gate.
 *
 * Source-checks the high-signal shipping classifiers, merge receipt gate,
 * active marker TTL, emergency bypass, fail-hard BLOCK output,
 * fail-open crash path, and mode bits.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SLUG = "ship-feature-gate";
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
  console.log("=== Source check: ship-feature-gate invariants ===");
  if (!existsSync(HANDLER_PATH)) {
    console.log(`  FAIL  handler.ts exists`);
    console.log(`\nWHAT: handler.ts missing at ${HANDLER_PATH}.`);
    console.log("HOW: restore rules/ship-feature-gate/handler.ts before relying on this rule.");
    return false;
  }

  const src = stripComments(readFileSync(HANDLER_PATH, "utf8"));
  const manifest = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, "utf8") : "";
  const required: Array<{ name: string; ok: boolean }> = [
    { name: "active marker TTL is four hours", ok: /ACTIVE_TTL_MS\s*=\s*4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src) },
    { name: "active marker dir is ~/.ship-feature/active", ok: /\.ship-feature/.test(src) && /active/.test(src) && /hasFreshActiveMarker/.test(src) },
    { name: "BLOCK message contains WHAT and HOW route-through remediation", ok: /WHAT: shipping op outside a \/ship-feature run/.test(src) && /HOW: route through the ship-feature skill/.test(src) },
    { name: "classifies gh pr create", ok: /gh/.test(src) && /pr/.test(src) && /create/.test(src) },
    { name: "classifies gh pr merge as receipt-gated merge", ok: /kind:\s*"merge"/.test(src) && /gh pr merge/.test(src) },
    { name: "merge receipt marker is canonical", ok: /JUDGE_RECEIPT_MARKER/.test(src) && /ship-feature-judge-receipt:v1/.test(src) },
    { name: "merge receipt fetch is injectable and uses Bun.spawnSync", ok: /fetchPrBody/.test(src) && /Bun\.spawnSync/.test(src) },
    { name: "merge receipt BLOCK message contains XOS-138 WHAT and HOW", ok: /WHAT: merge blocked — PR carries no cross-family judge receipt/.test(src) && /XOS-138/.test(src) && /HOW: run \/ship-feature Stage 6/.test(src) },
    { name: "merge receipt fetch failures fail open with WARNING", ok: /mergeReceiptWarning/.test(src) && /fail-open for XOS-138/.test(src) && /WARNING/.test(src) },
    { name: "classifies git push to main", ok: /git/.test(src) && /push/.test(src) && /isMainPush/.test(src) && /isMainRefspec/.test(src) && /refs\/heads\/main/.test(src) },
    { name: "classifies railway up", ok: /railway/.test(src) && /up/.test(src) },
    { name: "classifies ship-* commands", ok: /ship-\*/.test(src) && /isShipCommandName/.test(src) },
    { name: "emergency bypass is logged", ok: /SHIP_FEATURE_GATE_OFF/.test(src) && /bypass/.test(src) },
    { name: "PreToolUse BLOCK emits deny JSON", ok: /permissionDecision:\s*"deny"/.test(src) && /decision:\s*"block"/.test(src) },
    { name: "BLOCK exits non-zero", ok: /process\.exit\(output\.verdict === "BLOCK" \? 1 : 0\)/.test(src) },
    { name: "handler crash fails open", ok: /fail-open/.test(src) && /process\.exit\(0\)/.test(src) },
    { name: "manifest declares PreToolUse Bash hook", ok: /"hook_type"\s*:\s*"PreToolUse"/.test(manifest) && /"Bash"/.test(manifest) },
    { name: "handler/AUDIT/WATCH are mode 755", ok: mode755(HANDLER_PATH) && mode755(AUDIT_PATH) && mode755(WATCH_PATH) },
  ];

  const missing = required.filter((item) => !item.ok);
  for (const item of required) console.log(`  ${item.ok ? "ok  " : "FAIL"}  ${item.name}`);
  if (missing.length > 0) {
    console.log(`\nWHAT: ${missing.length} source invariant(s) regressed in ${SLUG}.`);
    console.log("HOW: restore the missing handler/manifest/mode invariant before trusting the shipping gate.");
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
