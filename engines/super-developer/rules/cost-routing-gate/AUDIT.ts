#!/usr/bin/env bun
/**
 * AUDIT.ts - compliance check for cost-routing-gate.
 *
 * Source-checks fail-open behavior, fail-hard intended BLOCKs, active marker
 * freshness/scope logic, WHAT/HOW remediation, JSONL logging, and the
 * TS+Bun-only load-bearing rule shape.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";

const SLUG = "cost-routing-gate";
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
  tool?: string;
  target?: string;
  cwd?: string;
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

function noShellInLoadBearingPaths(): boolean {
  const forbidden = new Set([".sh", ".bash", ".zsh", ".py", ".rb", ".pl"]);
  return readdirSync(HERE).every((entry) => !forbidden.has(extname(entry)));
}

function checkSource(): boolean {
  console.log("=== Source check: cost-routing-gate invariants ===");
  if (!existsSync(HANDLER_PATH)) {
    console.log("  FAIL  handler.ts exists");
    console.log(`\nWHAT: handler.ts missing at ${HANDLER_PATH}.`);
    console.log("HOW: restore rules/cost-routing-gate/handler.ts before relying on this rule.");
    return false;
  }

  const src = stripComments(readFileSync(HANDLER_PATH, "utf8"));
  const manifest = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, "utf8") : "";
  const required: Array<{ name: string; ok: boolean }> = [
    { name: "targets Edit, Write, and Bash", ok: /TARGET_TOOLS/.test(src) && /"Edit"/.test(src) && /"Write"/.test(src) && /"Bash"/.test(src) },
    { name: "fresh marker threshold is 30 minutes / 1800 seconds", ok: /FRESH_TTL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/.test(src) && /1800/.test(manifest) },
    { name: "reads ~/.ship-feature/active markers", ok: /\.ship-feature/.test(src) && /activeMarkers/.test(src) && /markerDir/.test(src) },
    { name: "path-scopes by worktree/cwd/repo and passes unscopable markers", ok: /"worktree", "cwd", "repo"/.test(src) && /none has a resolvable existing worktree\/cwd\/repo scope/.test(src) },
    { name: "allows docs/** and markdown", ok: /docs\/"\)/.test(src) && /\.md/.test(src) && /allowedWhaleWrite/.test(src) },
    { name: "source BLOCK remediation names codex exec", ok: /codex exec/.test(src) && /sourceBlockMessage/.test(src) },
    { name: "Bash deploy-loop classifier is present", ok: /isDeployPollLoop/.test(src) && /railway/.test(src) && /gh\\s\+pr\\s\+checks/.test(src) && /vercel/.test(src) },
    { name: "Bash BLOCK remediation names claude --model haiku -p", ok: /claude --model haiku -p/.test(src) && /bashBlockMessage/.test(src) },
    { name: "BLOCK messages contain WHAT and HOW", ok: /WHAT: cost-routing-gate blocked/.test(src) && /HOW: route/.test(src) },
    { name: "does not suggest in-session Agent or Task tools", ok: !/\bAgent\b/.test(src) && !/\bTask\b/.test(src) },
    { name: "environment bypass is COST_ROUTING_GATE_OFF", ok: /COST_ROUTING_GATE_OFF/.test(src) && /bypass/.test(src) },
    { name: "logs every decision to JSONL LOG_PATH", ok: /LOG_PATH/.test(src) && /\.cyborg-enforcement-log\.jsonl/.test(src) && /appendFileSync\(path, JSON\.stringify\(rec\) \+ "\\n"\)/.test(src) },
    { name: "FAIL_OPEN log verdict exists", ok: /FAIL_OPEN/.test(src) },
    { name: "handler crash and invalid JSON fail open with exit 0", ok: /fail-open/.test(src) && /process\.exit\(0\)/.test(src) },
    { name: "no direct process.exit(1); intended BLOCK is the only nonzero exit", ok: !/process\.exit\(1\)/.test(src) && /process\.exit\(output\.verdict === "BLOCK" \? 1 : 0\)/.test(src) },
    { name: "PreToolUse BLOCK emits deny JSON", ok: /permissionDecision:\s*"deny"/.test(src) && /decision:\s*"block"/.test(src) },
    { name: "manifest declares PreToolUse Edit|Write|Bash hook", ok: /"hook_type"\s*:\s*"PreToolUse"/.test(manifest) && /"Edit"/.test(manifest) && /"Write"/.test(manifest) && /"Bash"/.test(manifest) },
    { name: "no shell or python load-bearing files in rule directory", ok: noShellInLoadBearingPaths() },
    { name: "handler/AUDIT/WATCH are mode 755", ok: mode755(HANDLER_PATH) && mode755(AUDIT_PATH) && mode755(WATCH_PATH) },
  ];

  const missing = required.filter((item) => !item.ok);
  for (const item of required) console.log(`  ${item.ok ? "ok  " : "FAIL"}  ${item.name}`);
  if (missing.length > 0) {
    console.log(`\nWHAT: ${missing.length} source invariant(s) regressed in ${SLUG}.`);
    console.log("HOW: restore the missing handler/manifest/mode invariant before trusting the cost-routing gate.");
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
    for (const row of recentBlocks) console.log(`    ${row.ts}  ${row.tool ?? ""}  ${row.target || row.cwd || ""}  ${row.reason ?? ""}`);
  }
  console.log("");
}

const days = Number(process.argv[2] ?? "7");
const sourceOk = checkSource();
auditLog(Number.isFinite(days) && days > 0 ? days : 7);
process.exit(sourceOk ? 0 : 1);

