#!/usr/bin/env bun
/**
 * handler.ts - sdlc-worktree-isolation enforcement.
 *
 * Blocks mutating git operations against designated shared primary checkouts.
 * Linked worktrees are allowed; read-only git operations are allowed. This
 * coordinates the filesystem side of SDLC isolation, while sdlc-work-claim
 * coordinates Linear tickets.
 *
 * Direct input:
 *   { "command": "git -C <shared-repo> commit -m x", "cwd": "/tmp" }
 *
 * PreToolUse input:
 *   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "..." }
 *
 * Output JSON:
 *   { verdict, target, reason, message }
 *
 * Exit:
 *   0 PASS
 *   1 BLOCK or handler error
 */

import { appendFileSync, existsSync, readFileSync, realpathSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

export const SLUG = "sdlc-worktree-isolation";
export const DEFAULT_SHARED_REPOS = [join(homedir(), "cyborg")];
export const MUTATING_SUBCOMMANDS = [
  "commit",
  "add",
  "merge",
  "rebase",
  "reset",
  "rm",
  "mv",
  "checkout",
  "switch",
  "cherry-pick",
  "apply",
  "restore",
  "push",
] as const;
const PULL_FF_ONLY_LABEL = "pull --ff-only";
export const READ_ONLY_ALLOWLIST = [
  "status",
  "log",
  "diff",
  "show",
  "fetch",
  PULL_FF_ONLY_LABEL,
  "branch",
  "branch -a",
  "worktree",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "cat-file",
  "blame",
  "remote -v",
  "config --get",
] as const;
// Composite allowlist entries are handled by dedicated classifiers below.
const ALWAYS_READ_ONLY_SUBCOMMANDS = new Set<string>(
  READ_ONLY_ALLOWLIST.filter((entry) => !entry.includes(" ") && entry !== "branch" && entry !== "worktree")
);

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "manifest.json");
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");

type Verdict = "PASS" | "BLOCK";
type OperationKind = "mutating" | "read-only" | "unknown";

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

interface GitInvocation {
  subcommand: string | null;
  args: string[];
  cPath?: string;
  cwd?: string;
}

interface OperationClassification {
  kind: OperationKind;
  reason: string;
}

export interface ProcessOptions {
  homeDir?: string;
  sharedRepos?: string[];
  logPath?: string;
  now?: Date;
  realpath?: (path: string) => string;
  resolveGitToplevel?: (target: string) => string | null;
  resolvePrimaryWorktree?: (repo: string) => string | null;
}

function isoNow(now = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function readSharedReposFromManifest(): string[] {
  if (!existsSync(MANIFEST_PATH)) return DEFAULT_SHARED_REPOS.slice();
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { shared_repos?: unknown };
    if (!Array.isArray(manifest.shared_repos)) return DEFAULT_SHARED_REPOS.slice();
    const repos = manifest.shared_repos.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    return repos.length > 0 ? repos : DEFAULT_SHARED_REPOS.slice();
  } catch {
    return DEFAULT_SHARED_REPOS.slice();
  }
}

function log(output: HandlerOutput, options: ProcessOptions): void {
  const path = options.logPath ?? LOG_PATH;
  const rec = {
    ts: isoNow(options.now),
    slug: SLUG,
    rule_slug: SLUG,
    verdict: output.verdict,
    target: output.target,
    reason: output.reason,
  };
  try {
    appendFileSync(path, JSON.stringify(rec) + "\n");
  } catch {
    /* telemetry must not mask the enforcement verdict */
  }
}

function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

function defaultRealpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function resolvePath(path: string, baseCwd: string, options: ProcessOptions): string {
  const expanded = expandHome(path, options.homeDir ?? homedir());
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseCwd, expanded);
  return (options.realpath ?? defaultRealpath)(absolute);
}

function runGit(args: string[]): string | null {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function defaultResolveGitToplevel(target: string): string | null {
  const out = runGit(["-C", target, "rev-parse", "--show-toplevel"]);
  return out ? defaultRealpath(out) : null;
}

function parsePrimaryWorktree(porcelain: string): string | null {
  const firstWorktreeLine = porcelain.split("\n").find((line) => line.startsWith("worktree "));
  return firstWorktreeLine ? firstWorktreeLine.slice("worktree ".length).trim() : null;
}

function defaultResolvePrimaryWorktree(repo: string): string | null {
  const out = runGit(["-C", repo, "worktree", "list", "--porcelain"]);
  const parsed = out ? parsePrimaryWorktree(out) : null;
  return parsed ? defaultRealpath(parsed) : null;
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
  return token === "&&" || token === "||" || token === "|" || token === ";" || token === "&";
}

function isSubshellBoundary(token: string): boolean {
  return token === "(" || token === ")";
}

function isGitToken(token: string): boolean {
  return token === "git" || token.endsWith("/git");
}

function joinShellPath(currentCwd: string, cdPath: string): string {
  if (cdPath === "~" || cdPath.startsWith("~/") || isAbsolute(cdPath)) return cdPath;
  return join(currentCwd, cdPath);
}

function extractCdPath(tokens: string[]): string | null {
  if (tokens[0] !== "cd") return null;

  let i = 1;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      i++;
      break;
    }
    if (token !== "-" && token.startsWith("-")) continue;
    break;
  }

  return tokens[i] ?? "~";
}

function parseGitInvocation(args: string[], cwd?: string): GitInvocation {
  let cPath: string | undefined;
  let subcommand: string | null = null;
  let subArgs: string[] = [];

  const skipValueOptions = new Set([
    "-c",
    "--config-env",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--super-prefix",
  ]);
  const skipValuePrefixes = [
    "--config-env=",
    "--git-dir=",
    "--work-tree=",
    "--namespace=",
    "--exec-path=",
    "--super-prefix=",
  ];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "-C") {
      cPath = args[i + 1];
      i++;
      continue;
    }
    if (token.startsWith("-C") && token.length > 2) {
      cPath = token.slice(2);
      continue;
    }
    if (skipValueOptions.has(token)) {
      i++;
      continue;
    }
    if (skipValuePrefixes.some((prefix) => token.startsWith(prefix))) {
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    subcommand = token;
    subArgs = args.slice(i + 1);
    break;
  }

  return { subcommand, args: subArgs, cPath, cwd };
}

function extractGitInvocationFromClause(tokens: string[], cwd: string): GitInvocation | null {
  const gitIndex = tokens.findIndex(isGitToken);
  if (gitIndex < 0) return null;
  return parseGitInvocation(tokens.slice(gitIndex + 1), cwd);
}

export function extractGitInvocations(command: string, cwd = "."): GitInvocation[] {
  const tokens = tokenizeShell(command);
  const invocations: GitInvocation[] = [];
  const cwdStack: string[] = [];
  let currentCwd = cwd;
  let clause: string[] = [];

  const flushClause = (separator: string | null) => {
    if (clause.length === 0) return;

    const invocation = extractGitInvocationFromClause(clause, currentCwd);
    if (invocation) invocations.push(invocation);

    const cdPath = extractCdPath(clause);
    if (cdPath && separator !== "|" && separator !== "&") {
      currentCwd = joinShellPath(currentCwd, cdPath);
    }

    clause = [];
  };

  for (const token of tokens) {
    if (isSeparator(token)) {
      flushClause(token);
      continue;
    }
    if (isSubshellBoundary(token)) {
      flushClause(null);
      if (token === "(") cwdStack.push(currentCwd);
      else currentCwd = cwdStack.pop() ?? currentCwd;
      continue;
    }
    clause.push(token);
  }

  flushClause(null);
  return invocations;
}

export function extractGitInvocation(command: string): GitInvocation | null {
  return extractGitInvocations(command)[0] ?? null;
}

function hasArg(args: string[], ...names: string[]): boolean {
  return args.some((arg) => names.includes(arg));
}

function branchIsReadOnly(args: string[]): boolean {
  if (args.length === 0) return true;
  const readOnlyFlags = new Set([
    "-a",
    "--all",
    "-r",
    "--remotes",
    "-v",
    "-vv",
    "--list",
    "--show-current",
    "--contains",
    "--merged",
    "--no-merged",
    "--points-at",
    "--format",
    "--sort",
    "--color",
    "--no-color",
  ]);
  return args.every((arg) => readOnlyFlags.has(arg) || arg.startsWith("--format=") || arg.startsWith("--sort=") || arg.startsWith("--color="));
}

export function classifyGitOperation(invocation: GitInvocation | null): OperationClassification {
  if (!invocation) return { kind: "read-only", reason: "no git invocation detected" };
  if (!invocation.subcommand) return { kind: "unknown", reason: "git invocation has no subcommand" };

  const subcommand = invocation.subcommand.toLowerCase();
  const args = invocation.args;

  if (ALWAYS_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return { kind: "read-only", reason: `git ${subcommand} is read-only allowlisted` };
  }
  if (subcommand === "worktree") {
    // Worktree subcommands mutate registrations, not the primary checkout's HEAD,
    // index, or tracked content. `worktree add` is also this rule's remediation,
    // so it must pass even when invoked from the shared primary checkout.
    return { kind: "read-only", reason: "git worktree is read-only allowlisted for primary checkout collision scope" };
  }
  if (subcommand === "pull") {
    if (hasArg(args, "--ff-only")) {
      return { kind: "read-only", reason: `git ${PULL_FF_ONLY_LABEL} is idempotent fast-forward sync — safe on shared primary` };
    }
    return { kind: "mutating", reason: "git pull mutates HEAD and may update tracked files" };
  }
  if (subcommand === "branch") {
    return branchIsReadOnly(args)
      ? { kind: "read-only", reason: "git branch list form is read-only allowlisted" }
      : { kind: "mutating", reason: "git branch non-list form mutates refs" };
  }
  if (subcommand === "remote") {
    return args.length === 0 || (args.length === 1 && (args[0] === "-v" || args[0] === "--verbose"))
      ? { kind: "read-only", reason: "git remote -v is read-only allowlisted" }
      : { kind: "mutating", reason: "git remote non-list form mutates repository config" };
  }
  if (subcommand === "config") {
    return hasArg(args, "--get")
      ? { kind: "read-only", reason: "git config --get is read-only allowlisted" }
      : { kind: "mutating", reason: "git config non-get form can mutate repository config" };
  }
  if (subcommand === "stash") {
    const action = args[0] ?? "push";
    if (action === "list" || action === "show") return { kind: "read-only", reason: `git stash ${action} is read-only` };
    if (action === "push" || action === "pop" || action === "apply") return { kind: "mutating", reason: `git stash ${action} mutates worktree or index state` };
    return { kind: "mutating", reason: "git stash non-list form mutates worktree or index state" };
  }
  if (subcommand === "tag") {
    if (hasArg(args, "-d", "--delete")) return { kind: "mutating", reason: "git tag -d mutates refs" };
    if (args.length === 0 || hasArg(args, "-l", "--list")) return { kind: "read-only", reason: "git tag list form is read-only" };
    return { kind: "mutating", reason: "git tag non-list form mutates refs" };
  }
  if (MUTATING_SUBCOMMANDS.includes(subcommand as (typeof MUTATING_SUBCOMMANDS)[number])) {
    if (subcommand === "restore" && hasArg(args, "--staged")) {
      return { kind: "mutating", reason: "git restore --staged mutates the index" };
    }
    if (subcommand === "checkout" && hasArg(args, "-b", "-B")) {
      return { kind: "mutating", reason: "git checkout -b mutates refs and worktree state" };
    }
    return { kind: "mutating", reason: `git ${subcommand} mutates repository, index, or worktree state` };
  }

  return { kind: "unknown", reason: `git ${subcommand} is an unrecognized subcommand - treated as unsafe (fail-closed) on shared primary checkouts` };
}

function messageForBlock(primaryRepo: string): string {
  const repoName = basename(primaryRepo);
  return (
    `WHAT: mutating git op against the SHARED primary checkout ${primaryRepo} - concurrent sessions collide here. ` +
    `HOW: Use a per-session worktree, never the shared primary. Create one:  git -C ${primaryRepo} worktree add /tmp/${repoName}-<task> -b <branch> origin/main ` +
    `- commit there, then publish with  git -C /tmp/${repoName}-<task> push origin HEAD:main  (fast-forwards main). See SDLC WORK-CLAIM INVARIANT.`
  );
}

function pass(target: string, reason: string): HandlerOutput {
  return { verdict: "PASS", target, reason, message: `PASS: ${reason}` };
}

function block(target: string, reason: string, primaryRepo: string): HandlerOutput {
  return { verdict: "BLOCK", target, reason, message: messageForBlock(primaryRepo) };
}

function samePath(a: string, b: string): boolean {
  return a === b;
}

function normalizeInput(raw: HandlerInput): { command: string; cwd: string } {
  const directCommand = typeof raw.command === "string" ? raw.command : undefined;
  const directCwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
  const toolInput = (raw.tool_input ?? raw.input ?? {}) as { command?: unknown; cwd?: unknown };
  const command = directCommand ?? (typeof toolInput.command === "string" ? toolInput.command : "");
  const cwd = directCwd ?? (typeof toolInput.cwd === "string" ? toolInput.cwd : "") ?? process.cwd();
  return { command, cwd: cwd || process.cwd() };
}

export function processInput(raw: HandlerInput, options: ProcessOptions = {}): HandlerOutput {
  const { command, cwd } = normalizeInput(raw);
  const baseCwd = resolvePath(cwd, process.cwd(), options);

  if (!command.trim()) {
    const output = pass(baseCwd, "no command provided");
    log(output, options);
    return output;
  }

  const invocations = extractGitInvocations(command, baseCwd);
  if (invocations.length === 0) {
    const output = pass(baseCwd, "command is not a git invocation");
    log(output, options);
    return output;
  }

  const evaluated = invocations.map((invocation) => {
    const invocationCwd = resolvePath(invocation.cwd ?? baseCwd, baseCwd, options);
    const targetWorkdir = resolvePath(invocation.cPath ?? invocationCwd, invocationCwd, options);
    const targetTopLevel = (options.resolveGitToplevel ?? defaultResolveGitToplevel)(targetWorkdir);
    const target = targetTopLevel ? resolvePath(targetTopLevel, invocationCwd, options) : targetWorkdir;
    const classification = classifyGitOperation(invocation);
    return { classification, target };
  });

  if (invocations.length === 1 && evaluated[0].classification.kind === "read-only") {
    const output = pass(evaluated[0].target, evaluated[0].classification.reason);
    log(output, options);
    return output;
  }

  const sharedRepos = options.sharedRepos ?? readSharedReposFromManifest();
  const primaryRepos = sharedRepos.map((configured) => {
    const sharedRepo = resolvePath(configured, baseCwd, options);
    const primaryRaw = (options.resolvePrimaryWorktree ?? defaultResolvePrimaryWorktree)(sharedRepo) ?? sharedRepo;
    return resolvePath(primaryRaw, baseCwd, options);
  });

  for (const item of evaluated) {
    if (item.classification.kind === "read-only") continue;
    for (const primary of primaryRepos) {
      if (samePath(item.target, primary)) {
        const output = block(item.target, item.classification.reason, primary);
        log(output, options);
        return output;
      }
    }
  }

  const output =
    invocations.length === 1
      ? pass(evaluated[0].target, `${evaluated[0].classification.reason}, target is not a designated shared primary checkout`)
      : pass(Array.from(new Set(evaluated.map((item) => item.target))).join(", "), `all ${invocations.length} git invocations passed`);
  log(output, options);
  return output;
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

async function main(): Promise<void> {
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
    const output: HandlerOutput = {
      verdict: "BLOCK",
      target: "",
      reason: "invalid-json",
      message: "WHAT: handler input is not valid JSON. HOW: pass JSON {command,cwd}; parser error: " + String(err),
    };
    log(output, {});
    emit(output, mode);
    process.exit(1);
  }

  const output = processInput(input);
  emit(output, mode);
  process.exit(output.verdict === "BLOCK" ? 1 : 0);
}

if (import.meta.main) {
  main().catch((err) => {
    const output: HandlerOutput = {
      verdict: "BLOCK",
      target: "",
      reason: "handler-crash",
      message: "WHAT: sdlc-worktree-isolation crashed before it could enforce worktree isolation. HOW: fix this handler/runtime error before running shared-repo git mutations: " + String(err),
    };
    log(output, {});
    emit(output, "direct");
    process.exit(1);
  });
}

export const __sourceCheck = { stripComments, parsePrimaryWorktree };
