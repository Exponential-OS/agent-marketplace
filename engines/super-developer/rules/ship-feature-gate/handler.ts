#!/usr/bin/env bun
/**
 * handler.ts - ship-feature-gate enforcement.
 *
 * Blocks high-signal shipping commands unless a fresh /ship-feature active-run
 * marker exists at ~/.ship-feature/active/<session>.json. This forces code
 * shipping through the Agentic SDLC pipeline instead of ad-hoc PR/deploy paths.
 *
 * Direct input:
 *   { "command": "gh pr create --fill", "cwd": "/tmp" }
 *
 * PreToolUse input:
 *   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "..." }
 *
 * Exit:
 *   0 PASS
 *   1 BLOCK
 *
 * Unexpected handler crashes fail open: log + allow.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";

export const SLUG = "ship-feature-gate";
export const ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;

const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const BLOCK_MESSAGE =
  "WHAT: shipping op outside a /ship-feature run. HOW: route through the ship-feature skill (Stage 0 claims the ticket + writes the active marker), then build→judge→ship.";

type Verdict = "PASS" | "BLOCK";

interface HandlerInput {
  command?: unknown;
  cwd?: unknown;
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
}

interface ShippingMatch {
  shipping: boolean;
  reason: string;
  target: string;
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

function normalizeInput(raw: HandlerInput): { command: string; cwd: string } {
  const toolInput = (raw.tool_input ?? raw.input ?? {}) as { command?: unknown; cwd?: unknown };
  const command = typeof raw.command === "string" ? raw.command : typeof toolInput.command === "string" ? toolInput.command : "";
  const cwd = typeof raw.cwd === "string" ? raw.cwd : typeof toolInput.cwd === "string" ? toolInput.cwd : process.cwd();
  return { command, cwd: cwd || process.cwd() };
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

function isShipCommandName(command: string): boolean {
  return /^ship-[A-Za-z0-9_.-]+$/.test(command);
}

function runnerShips(command: string, args: string[]): boolean {
  if (!["bun", "npm", "pnpm", "yarn"].includes(command)) return false;
  const runIndex = args.findIndex((arg) => arg === "run");
  if (runIndex < 0) return false;
  return isShipCommandName(args[runIndex + 1] ?? "");
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

function pushPositionals(args: string[]): string[] {
  const optionsWithValue = new Set(["--receive-pack", "--exec", "--push-option", "-o"]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; ) {
    const token = args[i];
    if (token === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (token.startsWith("-")) {
      i = skipOption(args, i, optionsWithValue);
      continue;
    }
    positional.push(token);
    i++;
  }
  return positional;
}

function isMainRefspec(refspec: string): boolean {
  if (refspec === "main" || refspec === "refs/heads/main") return true;
  const parts = refspec.split(":");
  if (parts.length < 2) return false;
  const destination = parts[parts.length - 1];
  return destination === "main" || destination === "refs/heads/main";
}

function isMainPush(args: string[]): boolean {
  const positional = pushPositionals(args);
  if (positional.length < 2) return false;
  return positional.slice(1).some(isMainRefspec);
}

function ghCommandPair(args: string[]): [string | null, string | null] {
  const optionsWithValue = new Set(["--repo", "-R", "--hostname"]);
  const commands: string[] = [];
  for (let i = 0; i < args.length; ) {
    const token = args[i];
    if (token.startsWith("-")) {
      i = skipOption(args, i, optionsWithValue);
      continue;
    }
    commands.push(token);
    i++;
    if (commands.length === 2) break;
  }
  return [commands[0] ?? null, commands[1] ?? null];
}

function firstNonFlag(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith("-")) return arg;
  }
  return null;
}

export function classifyShippingCommand(command: string, cwd: string): ShippingMatch {
  const clauses = commandClauses(tokenizeShell(command));
  for (const clause of clauses) {
    const execIndex = executableIndex(clause);
    if (execIndex >= clause.length) continue;
    const exec = baseCommand(clause[execIndex]);
    const args = clause.slice(execIndex + 1);

    if (isShipCommandName(exec)) {
      return { shipping: true, target: cwd, reason: "ship-* command " + exec };
    }
    if (runnerShips(exec, args)) {
      return { shipping: true, target: cwd, reason: exec + " run " + args[args.findIndex((arg) => arg === "run") + 1] };
    }
    if (exec === "gh") {
      const [group, subcommand] = ghCommandPair(args);
      if (group === "pr" && subcommand === "create") {
        return { shipping: true, target: cwd, reason: "gh pr create" };
      }
    }
    if (exec === "git") {
      const invocation = parseGitInvocation(args);
      if (invocation.subcommand === "push" && isMainPush(invocation.args)) {
        return { shipping: true, target: cwd, reason: "git push to main" };
      }
    }
    if (exec === "railway" && firstNonFlag(args) === "up") {
      return { shipping: true, target: cwd, reason: "railway up" };
    }
  }
  return { shipping: false, target: cwd, reason: "not a shipping-class command" };
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

export function hasFreshActiveMarker(options: ProcessOptions = {}): boolean {
  const dir = activeMarkerDir(options);
  if (!existsSync(dir)) return false;
  const nowMs = (options.now ?? new Date()).getTime();
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const startedMs = markerStartedMs(join(dir, entry));
    if (startedMs === null) continue;
    if (nowMs - startedMs < ACTIVE_TTL_MS) return true;
  }
  return false;
}

function pass(target: string, reason: string): HandlerOutput {
  return { verdict: "PASS", target, reason, message: "PASS: " + reason };
}

function block(target: string, reason: string): HandlerOutput {
  return { verdict: "BLOCK", target, reason, message: BLOCK_MESSAGE };
}

function processInputUnsafe(raw: HandlerInput, options: ProcessOptions): HandlerOutput {
  const env = options.env ?? process.env;
  const { command, cwd } = normalizeInput(raw);
  const target = resolve(cwd || process.cwd());

  if (env["SHIP_FEATURE_GATE_OFF"] === "1") {
    const output = pass(target, "SHIP_FEATURE_GATE_OFF=1; emergency bypass enabled");
    log(output, options, { bypass: true });
    return output;
  }

  if (!command.trim()) {
    const output = pass(target, "no command provided");
    log(output, options);
    return output;
  }

  const match = classifyShippingCommand(command, target);
  if (!match.shipping) {
    const output = pass(match.target, match.reason);
    log(output, options);
    return output;
  }

  if (hasFreshActiveMarker(options)) {
    const output = pass(match.target, "shipping-class command allowed by fresh /ship-feature active marker: " + match.reason);
    log(output, options, { shipping_reason: match.reason, active_marker: true });
    return output;
  }

  const output = block(match.target, "shipping op outside a /ship-feature run: " + match.reason);
  log(output, options, { shipping_reason: match.reason, active_marker: false });
  return output;
}

export function processInput(raw: HandlerInput, options: ProcessOptions = {}): HandlerOutput {
  try {
    return processInputUnsafe(raw, options);
  } catch (err) {
    const target = typeof raw.cwd === "string" ? raw.cwd : process.cwd();
    const output = pass(resolve(target), "ship-feature-gate crashed; fail-open: " + String(err instanceof Error ? err.message : err));
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
    const output = pass("", "ship-feature-gate crashed before emit; fail-open: " + String(err));
    log(output, {}, { fail_open: true, error: String(err) });
    emit(output, "direct");
    process.exit(0);
  });
}
