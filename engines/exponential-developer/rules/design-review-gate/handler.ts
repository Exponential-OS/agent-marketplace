#!/usr/bin/env bun
/**
 * handler.ts - design-review-gate enforcement.
 *
 * Blocks Stage-4 build/implementation commands unless the current /ship-feature
 * plan has a fresh Gate-A.7 design-review verdict sidecar whose spec hash still
 * matches the plan file. Missing, stale, RED, UNREACHABLE, or Class-B-applied
 * records are fail-hard BLOCKs. Unexpected handler crashes fail open.
 *
 * Direct input:
 *   { "command": "codex exec ...", "cwd": "/tmp/repo", "spec_path": "docs/plans/x.md" }
 *
 * PreToolUse input:
 *   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "..." }
 *
 * Exit:
 *   0 PASS
 *   1 BLOCK
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import { basename, dirname, extname, join, resolve } from "path";

export const SLUG = "design-review-gate";
export const ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");

type Verdict = "PASS" | "BLOCK";
type DesignReviewVerdict = "GREEN" | "YELLOW" | "RED" | "UNREACHABLE" | "SKIPPED";

interface HandlerInput {
  command?: unknown;
  cwd?: unknown;
  spec_path?: unknown;
  design_review_spec?: unknown;
  tool_name?: unknown;
  tool?: unknown;
  tool_input?: unknown;
  input?: unknown;
}

export interface HandlerOutput {
  verdict: Verdict;
  target: string;
  reason: string;
  message: string;
}

export interface ProcessOptions {
  homeDir?: string;
  activeDir?: string;
  logPath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  specPath?: string;
  verdictPath?: string;
}

export interface DesignReviewRecord {
  verdict?: unknown;
  findings?: unknown;
  spec_sha256?: unknown;
  manifest_sha256?: unknown;
  reviewer_model?: unknown;
  reviewer_family?: unknown;
  cross_family?: unknown;
  cycle?: unknown;
  timestamp?: unknown;
  rule?: unknown;
  class_b_applied?: unknown;
  adjustments?: unknown;
  applied_adjustments?: unknown;
}

interface BuildMatch {
  build: boolean;
  target: string;
  reason: string;
  branch?: string | null;
}

export interface SpecResolution {
  specPath: string;
  reason: string;
}

export interface VerdictCheck {
  ok: boolean;
  reason: string;
  message: string;
  record?: DesignReviewRecord;
  specPath?: string;
  verdictPath?: string;
  specSha256?: string;
}

interface GitInvocation {
  subcommand: string | null;
  args: string[];
}

function isoNow(now = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

function log(output: HandlerOutput, options: ProcessOptions, extra: Record<string, unknown> = {}): void {
  const path = options.logPath ?? LOG_PATH;
  const rec = {
    ts: isoNow(options.now),
    slug: SLUG,
    rule_slug: SLUG,
    verdict: output.verdict,
    target: output.target,
    reason: output.reason,
    ...extra,
  };
  try {
    appendFileSync(path, JSON.stringify(rec) + "\n");
  } catch {
    /* telemetry must not mask the enforcement verdict */
  }
}

function normalizeInput(raw: HandlerInput): { command: string; cwd: string; specPath: string | null } {
  const toolInput = (raw.tool_input ?? raw.input ?? {}) as { command?: unknown; cwd?: unknown; spec_path?: unknown; design_review_spec?: unknown };
  const command = typeof raw.command === "string" ? raw.command : typeof toolInput.command === "string" ? toolInput.command : "";
  const cwd = typeof raw.cwd === "string" ? raw.cwd : typeof toolInput.cwd === "string" ? toolInput.cwd : process.cwd();
  const specPath =
    typeof raw.spec_path === "string"
      ? raw.spec_path
      : typeof raw.design_review_spec === "string"
        ? raw.design_review_spec
        : typeof toolInput.spec_path === "string"
          ? toolInput.spec_path
          : typeof toolInput.design_review_spec === "string"
            ? toolInput.design_review_spec
            : null;
  return { command, cwd: cwd || process.cwd(), specPath };
}

export function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const push = () => {
    if (current !== "") {
      tokens.push(current);
      current = "";
    }
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\") escaped = true;
      else current += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    if (ch === "&" || ch === "|" || ch === ";") {
      push();
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
        tokens.push(ch + ch);
        i++;
      } else {
        tokens.push(ch);
      }
      continue;
    }
    if (ch === "(" || ch === ")") {
      push();
      tokens.push(ch);
      continue;
    }
    current += ch;
  }
  push();
  return tokens;
}

function isSeparator(token: string): boolean {
  return token === "&&" || token === "||" || token === "|" || token === ";" || token === "&" || token === "(" || token === ")";
}

function commandClauses(tokens: string[]): string[][] {
  const clauses: string[][] = [];
  let clause: string[] = [];
  const flush = () => {
    if (clause.length > 0) clauses.push(clause);
    clause = [];
  };
  for (const token of tokens) {
    if (isSeparator(token)) {
      flush();
      continue;
    }
    clause.push(token);
  }
  flush();
  return clauses;
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function executableIndex(clause: string[]): number {
  let i = 0;
  while (i < clause.length && isEnvAssignment(clause[i])) i++;
  if (clause[i] === "command" || clause[i] === "builtin") i++;
  if (clause[i] === "sudo") {
    i++;
    while (i < clause.length && clause[i].startsWith("-")) i++;
  }
  if (clause[i] === "env") {
    i++;
    while (i < clause.length && (isEnvAssignment(clause[i]) || clause[i].startsWith("-"))) i++;
  }
  return i;
}

function baseCommand(token: string): string {
  return basename(token);
}

function skipOption(args: string[], index: number, optionsWithValue: Set<string>): number {
  const arg = args[index];
  if (optionsWithValue.has(arg)) return index + 2;
  if (Array.from(optionsWithValue).some((option) => arg.startsWith(option + "="))) return index + 1;
  return index + 1;
}

function parseGitInvocation(args: string[]): GitInvocation {
  const optionsWithValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
  for (let i = 0; i < args.length; ) {
    const token = args[i];
    if (token === "--") {
      i++;
      if (i < args.length) return { subcommand: args[i], args: args.slice(i + 1) };
      break;
    }
    if (token.startsWith("-")) {
      i = skipOption(args, i, optionsWithValue);
      continue;
    }
    return { subcommand: token, args: args.slice(i + 1) };
  }
  return { subcommand: null, args: [] };
}

function worktreeBranch(args: string[]): string | null {
  if (args[0] !== "add") return null;
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token === "-b" || token === "--branch") return args[i + 1] ?? null;
    if (token.startsWith("--branch=")) return token.slice("--branch=".length) || null;
  }
  return null;
}

function isImplementScript(name: string): boolean {
  return /(^|[-_:])(implement|implementation|stage4|stage-4|build-feature)([-_:]|$)/i.test(name);
}

function runnerImplements(command: string, args: string[]): string | null {
  if (!["bun", "npm", "pnpm", "yarn"].includes(command)) return null;
  const runIndex = args.findIndex((arg) => arg === "run");
  if (runIndex < 0) return null;
  const script = args[runIndex + 1] ?? "";
  return isImplementScript(script) ? script : null;
}

function activeMarkerDir(options: ProcessOptions): string {
  return options.activeDir ?? join(options.homeDir ?? homedir(), ".ship-feature", "active");
}

function markerStartedMs(path: string): number | null {
  let statTime: number | null = null;
  try {
    statTime = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { started?: unknown };
    if (typeof parsed.started === "string") {
      const startedMs = Date.parse(parsed.started);
      if (Number.isFinite(startedMs)) return startedMs;
    }
    return statTime;
  } catch {
    return null;
  }
}

function activeMarkers(options: ProcessOptions): Array<Record<string, unknown>> {
  const dir = activeMarkerDir(options);
  if (!existsSync(dir)) return [];
  const nowMs = (options.now ?? new Date()).getTime();
  const markers: Array<Record<string, unknown>> = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    const startedMs = markerStartedMs(path);
    if (startedMs === null || nowMs - startedMs >= ACTIVE_TTL_MS) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      markers.push(parsed);
    } catch {
      markers.push({});
    }
  }
  return markers;
}

function hasFreshActiveMarker(options: ProcessOptions): boolean {
  return activeMarkers(options).length > 0;
}

export function classifyBuildCommand(command: string, cwd: string, options: ProcessOptions = {}): BuildMatch {
  const clauses = commandClauses(tokenizeShell(command));
  for (const clause of clauses) {
    const execIndex = executableIndex(clause);
    if (execIndex >= clause.length) continue;
    const exec = baseCommand(clause[execIndex]);
    const args = clause.slice(execIndex + 1);

    if (exec === "codex" && args[0] === "exec") {
      return { build: true, target: cwd, reason: "codex exec Stage-4 implementation command" };
    }

    if (exec === "git") {
      const invocation = parseGitInvocation(args);
      if (invocation.subcommand === "worktree") {
        const branch = worktreeBranch(invocation.args);
        if (branch?.startsWith("feat/")) {
          return { build: true, target: cwd, reason: "git worktree add -b feat/* Stage-4 worktree command", branch };
        }
      }
    }

    const script = runnerImplements(exec, args);
    if (script && hasFreshActiveMarker(options)) {
      return { build: true, target: cwd, reason: exec + " run " + script + " in claimed /ship-feature run" };
    }

    if (isImplementScript(exec) && hasFreshActiveMarker(options)) {
      return { build: true, target: cwd, reason: exec + " in claimed /ship-feature run" };
    }
  }
  return { build: false, target: cwd, reason: "not a Stage-4 build/implementation command" };
}

function slugFromBranch(branch: string | null | undefined): string | null {
  if (!branch?.startsWith("feat/")) return null;
  const rest = branch.slice("feat/".length);
  return rest.split("/")[0]?.trim() || null;
}

function commandSpecPath(command: string, cwd: string): string | null {
  for (const token of tokenizeShell(command)) {
    if (!token.endsWith(".md")) continue;
    if (token.includes("docs/plans/")) return resolve(cwd, token);
  }
  return null;
}

function existingPlanForSlug(cwd: string, slug: string | null): string | null {
  if (!slug) return null;
  const candidate = resolve(cwd, "docs", "plans", slug + ".md");
  return existsSync(candidate) ? candidate : null;
}

function activeSpecPath(cwd: string, options: ProcessOptions): string | null {
  for (const marker of activeMarkers(options)) {
    const explicit = marker["spec_path"] ?? marker["specPath"] ?? marker["plan_path"] ?? marker["planPath"];
    if (typeof explicit === "string" && explicit.trim()) return resolve(cwd, explicit);
    const slug = typeof marker["slug"] === "string" ? marker["slug"] : slugFromBranch(typeof marker["branch"] === "string" ? marker["branch"] : null);
    const candidate = existingPlanForSlug(cwd, slug);
    if (candidate) return candidate;
  }
  return null;
}

export function resolveSpecPathForInput(raw: HandlerInput, match: BuildMatch, options: ProcessOptions = {}): SpecResolution | null {
  const { command, cwd, specPath } = normalizeInput(raw);
  const target = resolve(cwd || process.cwd());
  const explicit = options.specPath ?? specPath;
  if (explicit) return { specPath: resolve(target, explicit), reason: "explicit spec_path input" };

  const fromCommand = commandSpecPath(command, target);
  if (fromCommand) return { specPath: fromCommand, reason: "docs/plans/*.md command argument" };

  const fromBranch = existingPlanForSlug(target, slugFromBranch(match.branch));
  if (fromBranch) return { specPath: fromBranch, reason: "feat/* branch slug" };

  const fromMarker = activeSpecPath(target, options);
  if (fromMarker) return { specPath: fromMarker, reason: "fresh /ship-feature active marker" };

  return null;
}

export function verdictPathForSpec(specPath: string): string {
  const ext = extname(specPath);
  const stem = ext ? specPath.slice(0, -ext.length) : specPath;
  return stem + ".design-review.json";
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path: string): string {
  return sha256Text(readFileSync(path, "utf8"));
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function hasClassBApplied(record: DesignReviewRecord): boolean {
  if (record.class_b_applied === true) return true;
  const lists = [record.adjustments, record.applied_adjustments];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const klass = cleanString(rec["class"] ?? rec["classification"] ?? rec["kind"])?.toUpperCase();
      const applied = rec["applied"] === true || rec["auto_applied"] === true || rec["status"] === "applied";
      if (klass === "B" && applied) return true;
    }
  }
  return false;
}

function blockMessage(reason: string, specPath?: string): string {
  const target = specPath ? ` for ${specPath}` : "";
  return (
    "WHAT: Gate-A.7 design-review gate blocked Stage 4" +
    target +
    " because " +
    reason +
    ". HOW: run `bun run ${CLAUDE_PLUGIN_ROOT}/skills/ship-feature/design-review/run.ts <docs/plans/slug.md>` after Gate-A.5, resolve RED/UNREACHABLE/stale/Class-B-applied findings, and rerun the build only after the sidecar verdict is GREEN, SKIPPED, or an allowed YELLOW."
  );
}

function blockCheck(reason: string, specPath?: string, fields: Partial<VerdictCheck> = {}): VerdictCheck {
  return { ok: false, reason, message: blockMessage(reason, specPath), specPath, ...fields };
}

export function hasValidVerdict(specPath: string, options: ProcessOptions = {}): VerdictCheck {
  const resolvedSpec = resolve(specPath);
  if (!existsSync(resolvedSpec)) return blockCheck("the current spec file does not exist", resolvedSpec);

  const verdictPath = options.verdictPath ?? verdictPathForSpec(resolvedSpec);
  if (!existsSync(verdictPath)) return blockCheck("no design-review verdict record exists", resolvedSpec, { verdictPath });

  let record: DesignReviewRecord;
  try {
    record = JSON.parse(readFileSync(verdictPath, "utf8")) as DesignReviewRecord;
  } catch {
    return blockCheck("the design-review verdict record is not valid JSON", resolvedSpec, { verdictPath });
  }

  const currentSha = sha256File(resolvedSpec);
  const recordedSha = cleanString(record.spec_sha256);
  if (!recordedSha) return blockCheck("the design-review verdict record has no spec_sha256", resolvedSpec, { verdictPath, record, specSha256: currentSha });
  if (recordedSha !== currentSha) {
    return blockCheck("the spec was edited after review; rerun Gate-A.7", resolvedSpec, { verdictPath, record, specSha256: currentSha });
  }

  const verdict = cleanString(record.verdict)?.toUpperCase() as DesignReviewVerdict | undefined;
  if (hasClassBApplied(record)) return blockCheck("a Class-B design adjustment was applied to the reviewed spec", resolvedSpec, { verdictPath, record, specSha256: currentSha });
  if (verdict === "SKIPPED") return { ok: true, reason: "design review skipped by objective rule", message: "PASS: design review skipped by objective rule", record, specPath: resolvedSpec, verdictPath, specSha256: currentSha };
  if (verdict === "GREEN") return { ok: true, reason: "design review verdict GREEN", message: "PASS: design review verdict GREEN", record, specPath: resolvedSpec, verdictPath, specSha256: currentSha };
  if (verdict === "YELLOW") return { ok: true, reason: "design review verdict YELLOW with no Class-B applied adjustment", message: "PASS: design review verdict YELLOW with no Class-B applied adjustment", record, specPath: resolvedSpec, verdictPath, specSha256: currentSha };
  if (verdict === "RED") return blockCheck("the design-review verdict is RED", resolvedSpec, { verdictPath, record, specSha256: currentSha });
  if (verdict === "UNREACHABLE") return blockCheck("the design reviewer was unreachable or unparseable", resolvedSpec, { verdictPath, record, specSha256: currentSha });
  return blockCheck("the design-review verdict is missing or unknown", resolvedSpec, { verdictPath, record, specSha256: currentSha });
}

function pass(target: string, reason: string): HandlerOutput {
  return { verdict: "PASS", target, reason, message: "PASS: " + reason };
}

function block(target: string, reason: string, message: string): HandlerOutput {
  return { verdict: "BLOCK", target, reason, message };
}

function processInputUnsafe(raw: HandlerInput, options: ProcessOptions): HandlerOutput {
  const env = options.env ?? process.env;
  const { command, cwd } = normalizeInput(raw);
  const target = resolve(cwd || process.cwd());

  if (env["DESIGN_REVIEW_GATE_OFF"] === "1") {
    const output = pass(target, "DESIGN_REVIEW_GATE_OFF=1; emergency bypass enabled");
    log(output, options, { bypass: true });
    return output;
  }

  if (!command.trim()) {
    const output = pass(target, "no command provided");
    log(output, options);
    return output;
  }

  const match = classifyBuildCommand(command, target, options);
  if (!match.build) {
    const output = pass(match.target, match.reason);
    log(output, options);
    return output;
  }

  const spec = resolveSpecPathForInput(raw, match, options);
  if (!spec) {
    const reason = "no current docs/plans spec could be resolved for the Stage-4 build command";
    const output = block(match.target, reason, blockMessage(reason));
    log(output, options, { build_reason: match.reason });
    return output;
  }

  const check = hasValidVerdict(spec.specPath, options);
  if (check.ok) {
    const output = pass(match.target, `${match.reason}; ${check.reason}`);
    log(output, options, { build_reason: match.reason, spec_path: spec.specPath, verdict_path: check.verdictPath });
    return output;
  }

  const output = block(match.target, `${match.reason}; ${check.reason}`, check.message);
  log(output, options, {
    build_reason: match.reason,
    spec_path: spec.specPath,
    verdict_path: check.verdictPath,
    spec_sha256: check.specSha256,
  });
  return output;
}

export function processInput(raw: HandlerInput, options: ProcessOptions = {}): HandlerOutput {
  try {
    return processInputUnsafe(raw, options);
  } catch (err) {
    const target = typeof raw.cwd === "string" ? raw.cwd : process.cwd();
    const output = pass(resolve(target), "design-review-gate crashed; fail-open: " + String(err instanceof Error ? err.message : err));
    log(output, options, { fail_open: true, error: String(err instanceof Error ? err.message : err) });
    return output;
  }
}

function hookBlockOutput(output: HandlerOutput): Record<string, unknown> {
  return {
    ...output,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: output.message,
    },
    decision: "block",
    type: "error",
  };
}

function emit(output: HandlerOutput, mode: "direct" | "hook"): void {
  if (mode === "hook" && output.verdict === "BLOCK") {
    process.stdout.write(JSON.stringify(hookBlockOutput(output)) + "\n");
  } else {
    process.stdout.write(JSON.stringify(output) + "\n");
  }
  if (output.verdict === "BLOCK") process.stderr.write(output.message + "\n");
}

async function readInput(): Promise<{ raw: string; mode: "direct" | "hook" }> {
  const argVal = process.argv[2];
  if (argVal && argVal !== "-") return { raw: argVal, mode: "direct" };
  const stdin = process.stdin.isTTY ? "" : (await Bun.stdin.text()).trim();
  return { raw: stdin, mode: "hook" };
}

export async function runCli(): Promise<void> {
  const { raw, mode } = await readInput();
  if (!raw) {
    const output = pass("", "no input provided");
    log(output, {});
    emit(output, mode);
    process.exit(0);
  }

  let input: HandlerInput;
  try {
    input = JSON.parse(raw) as HandlerInput;
  } catch (err) {
    const output = pass("", "invalid JSON; fail-open: " + String(err));
    log(output, {}, { fail_open: true });
    emit(output, mode);
    process.exit(0);
  }

  const output = processInput(input);
  emit(output, mode);
  process.exit(output.verdict === "BLOCK" ? 1 : 0);
}

if (import.meta.main) {
  runCli().catch((err) => {
    const output = pass("", "design-review-gate crashed before emit; fail-open: " + String(err));
    log(output, {}, { fail_open: true, error: String(err) });
    emit(output, "direct");
    process.exit(0);
  });
}
