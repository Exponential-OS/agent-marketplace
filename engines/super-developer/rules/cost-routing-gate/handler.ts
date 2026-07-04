#!/usr/bin/env bun
/**
 * handler.ts - cost-routing-gate enforcement.
 *
 * PreToolUse gate for Edit, Write, and Bash. During a fresh /ship-feature run,
 * in-session source writes are routed to out-of-process Codex, and long
 * deploy/poll loops are routed to an out-of-process Haiku CLI. Unexpected
 * handler failures fail open.
 *
 * Direct input:
 *   { "tool_name": "Edit", "tool_input": { "file_path": "src/a.ts" }, "cwd": "/tmp/repo" }
 *   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "/tmp/repo" }
 *
 * PreToolUse input:
 *   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "..." }
 *
 * Exit:
 *   0 PASS or fail-open
 *   1 intended BLOCK
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

export const SLUG = "cost-routing-gate";
export const FRESH_TTL_MS = 30 * 60 * 1000;

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const TARGET_TOOLS = new Set(["Edit", "Write", "Bash"]);

type Verdict = "PASS" | "BLOCK";
type LogVerdict = Verdict | "FAIL_OPEN";

interface HandlerInput {
  tool_name?: unknown;
  tool?: unknown;
  command?: unknown;
  cwd?: unknown;
  file_path?: unknown;
  path?: unknown;
  tool_input?: unknown;
  input?: unknown;
}

interface NormalizedInput {
  tool: string;
  command: string;
  filePath: string | null;
  cwd: string | null;
  cwdProvided: boolean;
}

interface StatLike {
  mtimeMs: number;
  isDirectory?: () => boolean;
}

export interface FileSystemLike {
  appendFileSync(path: string, data: string): void;
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
  readdirSync(path: string): string[];
  realpathSync(path: string): string;
  statSync(path: string): StatLike;
}

export interface ProcessOptions {
  homeDir?: string;
  markerDir?: string;
  logPath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  fs?: Partial<FileSystemLike>;
}

export interface HandlerOutput {
  verdict: Verdict;
  target: string;
  reason: string;
  message: string;
}

interface ActiveMarker {
  path: string;
  data: Record<string, unknown>;
}

interface ScopedMarker {
  markerPath: string;
  root: string;
  field: "worktree" | "cwd" | "repo";
}

const nodeFs: FileSystemLike = {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync: (path: string) => realpathSync.native(path),
  statSync,
};

function fsFor(options: ProcessOptions): FileSystemLike {
  return { ...nodeFs, ...(options.fs ?? {}) };
}

function isoNow(now = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

function markerDir(options: ProcessOptions): string {
  return options.markerDir ?? join(options.homeDir ?? homedir(), ".ship-feature", "active");
}

function logDecision(output: HandlerOutput, options: ProcessOptions, extra: Record<string, unknown> = {}, verdict?: LogVerdict): void {
  const path = options.logPath ?? LOG_PATH;
  const rec = {
    ts: isoNow(options.now),
    slug: SLUG,
    rule_slug: SLUG,
    verdict: verdict ?? output.verdict,
    tool: extra.tool ?? "",
    target: output.target,
    cwd: extra.cwd ?? "",
    reason: output.reason,
    ...extra,
  };
  try {
    fsFor(options).appendFileSync(path, JSON.stringify(rec) + "\n");
  } catch {
    /* telemetry must not mask the enforcement verdict */
  }
}

function pass(target: string, reason: string): HandlerOutput {
  return { verdict: "PASS", target, reason, message: "PASS: " + reason };
}

function block(target: string, reason: string, message: string): HandlerOutput {
  return { verdict: "BLOCK", target, reason, message };
}

function finish(output: HandlerOutput, options: ProcessOptions, extra: Record<string, unknown> = {}, logVerdict?: LogVerdict): HandlerOutput {
  logDecision(output, options, extra, logVerdict);
  return output;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeInput(raw: HandlerInput): NormalizedInput {
  const toolInput = (raw.tool_input ?? raw.input ?? {}) as {
    command?: unknown;
    cwd?: unknown;
    file_path?: unknown;
    path?: unknown;
  };
  const command = cleanString(raw.command) ?? cleanString(toolInput.command) ?? "";
  const filePath = cleanString(raw.file_path) ?? cleanString(raw.path) ?? cleanString(toolInput.file_path) ?? cleanString(toolInput.path);
  const cwdRaw = cleanString(raw.cwd) ?? cleanString(toolInput.cwd);
  const inferredTool = command ? "Bash" : filePath ? "Write" : "";
  return {
    tool: cleanString(raw.tool_name) ?? cleanString(raw.tool) ?? inferredTool,
    command,
    filePath,
    cwd: cwdRaw,
    cwdProvided: cwdRaw !== null,
  };
}

function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

function realpathOrResolve(path: string, fs: FileSystemLike): string {
  try {
    return fs.realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function resolvePath(path: string, baseCwd: string, options: ProcessOptions, fs: FileSystemLike): string {
  const expanded = expandHome(path, options.homeDir ?? homedir());
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseCwd, expanded);
  return realpathOrResolve(absolute, fs);
}

function existingDirectory(path: string, fs: FileSystemLike): boolean {
  if (!fs.existsSync(path)) return false;
  try {
    const st = fs.statSync(path);
    return typeof st.isDirectory === "function" ? st.isDirectory() : true;
  } catch {
    return false;
  }
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function markerFreshnessMs(path: string, marker: Record<string, unknown>, fs: FileSystemLike): number | null {
  const startedMs = parseTimeMs(marker["started"]);
  if (startedMs !== null) return startedMs;

  const heartbeatFields = ["heartbeat", "heartbeat_at", "heartbeatAt", "last_heartbeat", "lastHeartbeat"];
  for (const field of heartbeatFields) {
    const ms = parseTimeMs(marker[field]);
    if (ms !== null) return ms;
  }

  try {
    return fs.statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function activeMarkers(options: ProcessOptions = {}): ActiveMarker[] {
  const fs = fsFor(options);
  const dir = markerDir(options);
  if (!fs.existsSync(dir)) return [];
  const nowMs = (options.now ?? new Date()).getTime();
  const markers: ActiveMarker[] = [];

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const freshnessMs = markerFreshnessMs(path, data, fs);
    if (freshnessMs === null) continue;
    if (nowMs - freshnessMs >= FRESH_TTL_MS) continue;
    markers.push({ path, data });
  }

  return markers;
}

function scopedMarkers(markers: ActiveMarker[], options: ProcessOptions, fs: FileSystemLike): ScopedMarker[] {
  const scopes: ScopedMarker[] = [];
  for (const marker of markers) {
    // sdlc-work-claim's local marker currently stores ticket/session/branch/started
    // only. It can prove freshness, but blocking still requires an explicit scope.
    for (const field of ["worktree", "cwd", "repo"] as const) {
      const value = cleanString(marker.data[field]);
      if (!value) continue;
      const expanded = expandHome(value, options.homeDir ?? homedir());
      const absolute = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
      if (!existingDirectory(absolute, fs)) continue;
      scopes.push({ markerPath: marker.path, root: realpathOrResolve(absolute, fs), field });
      break;
    }
  }
  return scopes;
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
}

function relativeInRoot(root: string, target: string): string {
  return relative(root, target).split("\\").join("/");
}

function allowedWhaleWrite(root: string, target: string): boolean {
  const rel = relativeInRoot(root, target);
  return rel === "docs" || rel.startsWith("docs/") || target.toLowerCase().endsWith(".md");
}

function sourceBlockMessage(target: string, root: string): string {
  return (
    "WHAT: cost-routing-gate blocked an in-session source write during a fresh /ship-feature run: " +
    target +
    " is inside " +
    root +
    ". HOW: route implementation out-of-process with `codex exec` from Bash, then have this session read the diff/conclusions and continue gating/synthesis."
  );
}

function bashBlockMessage(cwd: string): string {
  return (
    "WHAT: cost-routing-gate blocked an in-session deploy/poll loop during a fresh /ship-feature run at " +
    cwd +
    ". HOW: route the deploy/watch work out-of-process with `claude --model haiku -p '<task>'`; have it report deploy id, final status, and smoke result back to this session."
  );
}

function hasDeployOrWatchPrimitive(command: string): boolean {
  return (
    /\brailway\s+(?:up|redeploy)\b/i.test(command) ||
    /\bgh\s+pr\s+checks\b[\s\S]*?\b--watch\b/i.test(command) ||
    /\bgh\s+run\s+watch\b/i.test(command) ||
    /\bvercel\b[\s\S]*?\b--prod\b/i.test(command)
  );
}

function hasWhileOrUntil(command: string): boolean {
  return /\b(?:while|until)\b/i.test(command);
}

function hasSleep(command: string): boolean {
  return /\bsleep\b/i.test(command);
}

function hasRepeatedStatusPoll(command: string): boolean {
  return /\b--watch\b/i.test(command) || /\bgh\s+run\s+watch\b/i.test(command) || /\bwatch\s+(?:gh|railway|vercel|curl)\b/i.test(command);
}

function hasStatusPollCommand(command: string): boolean {
  return (
    /\brailway\s+(?:status|logs|deployments?|deployment|open)\b/i.test(command) ||
    /\bgh\s+(?:pr\s+checks|run\s+(?:watch|view|list))\b/i.test(command) ||
    /\bvercel\s+(?:inspect|ls|deployments?)\b/i.test(command)
  );
}

export function isDeployPollLoop(command: string): boolean {
  const loopWithSleep = hasWhileOrUntil(command) && hasSleep(command);
  if (hasDeployOrWatchPrimitive(command) && (loopWithSleep || hasRepeatedStatusPoll(command))) return true;
  return loopWithSleep && hasStatusPollCommand(command);
}

function processWrite(input: NormalizedInput, markers: ActiveMarker[], options: ProcessOptions, fs: FileSystemLike): HandlerOutput {
  const cwd = input.cwd ?? process.cwd();
  if (!input.filePath) {
    return finish(pass("", "Edit/Write payload has no file_path"), options, { tool: input.tool, cwd });
  }

  const target = resolvePath(input.filePath, cwd, options, fs);
  const scopes = scopedMarkers(markers, options, fs);
  if (scopes.length === 0) {
    return finish(pass(target, "fresh markers exist, but none has a resolvable existing worktree/cwd/repo scope"), options, { tool: input.tool, target, cwd });
  }

  for (const scope of scopes) {
    if (!isInsidePath(scope.root, target)) continue;
    if (allowedWhaleWrite(scope.root, target)) {
      return finish(pass(target, "path is allowed for in-session docs/markdown work inside live worktree"), options, {
        tool: input.tool,
        target,
        cwd,
        marker: scope.markerPath,
        scope_field: scope.field,
      });
    }

    return finish(block(target, "source write inside fresh /ship-feature worktree", sourceBlockMessage(target, scope.root)), options, {
      tool: input.tool,
      target,
      cwd,
      marker: scope.markerPath,
      scope_field: scope.field,
    });
  }

  return finish(pass(target, "write target is outside every fresh /ship-feature worktree"), options, { tool: input.tool, target, cwd });
}

function processBash(input: NormalizedInput, markers: ActiveMarker[], options: ProcessOptions, fs: FileSystemLike): HandlerOutput {
  if (!input.command.trim()) {
    return finish(pass("", "Bash payload has no command"), options, { tool: input.tool, cwd: input.cwd ?? "" });
  }
  if (!input.cwdProvided || !input.cwd) {
    return finish(pass("", "Bash cwd absent; deploy-loop gate fails open by design"), options, { tool: input.tool });
  }

  const cwd = resolvePath(input.cwd, process.cwd(), options, fs);
  if (!isDeployPollLoop(input.command)) {
    return finish(pass(cwd, "Bash command is not a conservative deploy/poll loop signature"), options, { tool: input.tool, cwd });
  }

  const scopes = scopedMarkers(markers, options, fs);
  if (scopes.length === 0) {
    return finish(pass(cwd, "fresh markers exist, but none has a resolvable existing worktree/cwd/repo scope"), options, { tool: input.tool, cwd });
  }

  for (const scope of scopes) {
    if (!isInsidePath(scope.root, cwd)) continue;
    return finish(block(cwd, "deploy/poll loop inside fresh /ship-feature worktree", bashBlockMessage(cwd)), options, {
      tool: input.tool,
      cwd,
      marker: scope.markerPath,
      scope_field: scope.field,
    });
  }

  return finish(pass(cwd, "deploy/poll signature cwd is outside every fresh /ship-feature worktree"), options, { tool: input.tool, cwd });
}

function processInputUnsafe(raw: HandlerInput, options: ProcessOptions): HandlerOutput {
  const env = options.env ?? process.env;
  const fs = fsFor(options);
  const input = normalizeInput(raw);
  const targetForLog = input.filePath ?? input.cwd ?? "";

  if (env["COST_ROUTING_GATE_OFF"] === "1") {
    return finish(pass(targetForLog, "COST_ROUTING_GATE_OFF=1; emergency bypass enabled"), options, { tool: input.tool, cwd: input.cwd ?? "", bypass: true });
  }

  if (!TARGET_TOOLS.has(input.tool)) {
    return finish(pass(targetForLog, "tool is not targeted by cost-routing-gate"), options, { tool: input.tool, cwd: input.cwd ?? "" });
  }

  const markers = activeMarkers(options);
  if (markers.length === 0) {
    return finish(pass(targetForLog, "no fresh /ship-feature active marker; fast no-op"), options, { tool: input.tool, cwd: input.cwd ?? "" });
  }

  if (input.tool === "Edit" || input.tool === "Write") {
    return processWrite(input, markers, options, fs);
  }
  if (input.tool === "Bash") {
    return processBash(input, markers, options, fs);
  }

  return finish(pass(targetForLog, "tool is not targeted by cost-routing-gate"), options, { tool: input.tool, cwd: input.cwd ?? "" });
}

export function processInput(raw: HandlerInput, options: ProcessOptions = {}): HandlerOutput {
  try {
    return processInputUnsafe(raw, options);
  } catch (err) {
    const input = normalizeInput(raw);
    const target = input.filePath ?? input.cwd ?? "";
    const output = pass(target, "cost-routing-gate crashed; fail-open: " + String(err instanceof Error ? err.message : err));
    return finish(output, options, { tool: input.tool, cwd: input.cwd ?? "", fail_open: true }, "FAIL_OPEN");
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
    logDecision(output, {}, { tool: "" });
    emit(output, mode);
    process.exit(0);
  }

  let input: HandlerInput;
  try {
    input = JSON.parse(raw) as HandlerInput;
  } catch (err) {
    const output = pass("", "invalid JSON; fail-open: " + String(err));
    logDecision(output, {}, { tool: "", fail_open: true }, "FAIL_OPEN");
    emit(output, mode);
    process.exit(0);
  }

  const output = processInput(input);
  emit(output, mode);
  process.exit(output.verdict === "BLOCK" ? 1 : 0);
}

if (import.meta.main) {
  runCli().catch((err) => {
    const output = pass("", "cost-routing-gate crashed before emit; fail-open: " + String(err));
    logDecision(output, {}, { tool: "", fail_open: true, error: String(err) }, "FAIL_OPEN");
    emit(output, "direct");
    process.exit(0);
  });
}

export const __sourceCheck = { HERE, LOG_PATH };
