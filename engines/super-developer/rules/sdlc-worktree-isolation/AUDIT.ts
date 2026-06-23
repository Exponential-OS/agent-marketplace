#!/usr/bin/env bun
/**
 * AUDIT.ts - compliance check for sdlc-worktree-isolation.
 *
 * Source-checks the handler invariants that make this rule fail-hard:
 * mutating git verbs, read-only allowlist, manifest shared_repos config, BLOCK
 * exit code, WHAT/HOW remediation, and JSONL logging. Also summarizes recent
 * enforcement log rows for this rule.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SLUG = "sdlc-worktree-isolation";
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
  console.log("=== Source check: sdlc-worktree-isolation invariants ===");
  if (!existsSync(HANDLER_PATH)) {
    console.log(`  FAIL  handler.ts exists`);
    console.log(`\nWHAT: handler.ts missing at ${HANDLER_PATH}.`);
    console.log("HOW: restore rules/sdlc-worktree-isolation/handler.ts before relying on this rule.");
    return false;
  }

  const src = stripComments(readFileSync(HANDLER_PATH, "utf8"));
  const manifest = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, "utf8") : "";
  const required: Array<{ name: string; ok: boolean }> = [
    { name: "mutating verb list contains commit/add/merge/rebase/reset/push", ok: /MUTATING_SUBCOMMANDS/.test(src) && /"commit"/.test(src) && /"add"/.test(src) && /"merge"/.test(src) && /"rebase"/.test(src) && /"reset"/.test(src) && /"push"/.test(src) },
    { name: "read-only allowlist contains status/log/diff/fetch/pull --ff-only/worktree", ok: /READ_ONLY_ALLOWLIST/.test(src) && /"status"/.test(src) && /"log"/.test(src) && /"diff"/.test(src) && /"fetch"/.test(src) && /"pull --ff-only"/.test(src) && /"worktree"/.test(src) },
    { name: "shared_repos config is read from manifest.json", ok: /readSharedReposFromManifest/.test(src) && /shared_repos/.test(src) },
    { name: "primary worktree is resolved via git worktree list --porcelain", ok: /worktree/.test(src) && /list/.test(src) && /--porcelain/.test(src) && /parsePrimaryWorktree/.test(src) },
    { name: "BLOCK exits non-zero", ok: /process\.exit\(output\.verdict === "BLOCK" \? 1 : 0\)/.test(src) },
    { name: "BLOCK message contains WHAT and HOW", ok: /WHAT: mutating git op against the SHARED primary checkout/.test(src) && /HOW: Use a per-session worktree/.test(src) },
    { name: "logs every invocation to JSONL", ok: /appendFileSync\(path, JSON\.stringify\(rec\) \+ "\\n"\)/.test(src) && /\.cyborg-enforcement-log\.jsonl/.test(src) },
    { name: "manifest declares shared_repos as an array", ok: /"shared_repos"\s*:\s*\[/.test(manifest) },
    { name: "handler/AUDIT/WATCH are mode 755", ok: mode755(HANDLER_PATH) && mode755(AUDIT_PATH) && mode755(WATCH_PATH) },
  ];

  const missing = required.filter((item) => !item.ok);
  for (const item of required) console.log(`  ${item.ok ? "ok  " : "FAIL"}  ${item.name}`);
  if (missing.length > 0) {
    console.log(`\nWHAT: ${missing.length} source invariant(s) regressed in ${SLUG}.`);
    console.log("HOW: restore the missing handler/manifest/mode invariant before trusting shared-repo git mutations.");
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
