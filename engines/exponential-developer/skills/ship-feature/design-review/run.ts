#!/usr/bin/env bun
/**
 * Gate-A.7 design-review harness.
 *
 * Reads a /ship-feature plan plus its appended Change Manifest, asks a fresh
 * reviewer for a structured design verdict, writes the sidecar verdict record,
 * and appends a human-readable verdict block for the PR body.
 *
 * FAILS CLOSED (the XOS-56 fix): the earlier reasoning gate was removed because
 * it fail-OPENED when claude-fable-5 was unavailable. Here, an unreachable or
 * unparseable reviewer records verdict UNREACHABLE, which design-review-gate
 * treats as BLOCK — an unavailable model never waves Stage 4 through.
 * OAuth CLI only: *_API_KEY env vars are stripped (sanitizedEnv) so the reviewer
 * runs on the flat-fee subscription, never pay-per-token API billing.
 * DESIGN_REVIEW_TIMEOUT_MS defaults to 300_000; DESIGN_REVIEW_TOTAL_BUDGET_MS
 * defaults to 540_000. Raising these beyond the documented 600s Bash cap requires
 * an invocation path with a larger outer timeout (including the 900_000 call ceiling).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";

export type ReviewVerdict = "GREEN" | "YELLOW" | "RED";
export type RecordedVerdict = ReviewVerdict | "UNREACHABLE" | "SKIPPED";
export type UnreachableReason = "timeout" | "cli_missing" | "nonzero_exit" | "unparseable" | "budget_exhausted" | "unknown";
export type AdjustmentClass = "A" | "B";

export interface Finding {
  severity: string;
  lens: string;
  fix: string;
}

export interface StructuredVerdict {
  verdict: ReviewVerdict;
  findings: Finding[];
}

export interface ReviewerCliResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  signal?: string | null;
  elapsedMs?: number;
  reason?: UnreachableReason;
  model?: string;
  family?: string;
}

export interface ReviewerContext {
  attempt: number;
  kind: "primary" | "retry" | "cross-family" | "spot-check";
  model: string;
  family: string;
}

export type ReviewerCommand = (prompt: string, context: ReviewerContext) => ReviewerCliResult | Promise<ReviewerCliResult>;

export interface CrossFamilyRecord {
  status: "not_required" | "unavailable" | "available";
  reviewer?: string;
  verdict?: ReviewVerdict;
  findings?: Finding[];
  reason?: string;
}

export interface AdjustmentRecord {
  class: AdjustmentClass;
  applied: boolean;
  text: string;
}

export interface DesignReviewRecord {
  verdict: RecordedVerdict;
  findings: Finding[];
  spec_sha256: string;
  manifest_sha256: string;
  reviewer_model: string;
  reviewer_family: string;
  cross_family: CrossFamilyRecord | string;
  cycle: number;
  timestamp: string;
  rule?: string;
  adjustments?: AdjustmentRecord[];
  escalation_artifact?: string;
  reason?: UnreachableReason;
  elapsed_ms?: number | null;
  signal?: string | null;
  exit_code?: number | null;
  stderr_tail?: string;
  models_tried?: string[];
}

export interface RunResult {
  record: DesignReviewRecord;
  sidecarPath: string;
  escalationPath?: string;
  exitCode: number;
  parked: boolean;
}

export interface RunOptions {
  reviewer?: ReviewerCommand;
  crossFamilyReviewer?: ReviewerCommand;
  now?: Date;
  monotonicNow?: () => number;
  env?: Record<string, string | undefined>;
  tier?: string;
  sidecarPath?: string;
  lensesPath?: string;
  commandRunner?: (command: string[], options: CommandRunnerOptions) => ReviewerCliResult;
}

interface CommandRunnerOptions {
  env: Record<string, string>;
  cwd?: string;
  timeout?: number;
  /**
   * Injectable clock, mirroring RunOptions.monotonicNow. The timeout classification
   * below depends on MEASURED elapsed time, so a test cannot exercise it with a mock
   * that returns instantly -- it would have to burn the real budget (285s) to reach
   * the threshold. Threading the clock keeps that path testable in milliseconds.
   */
  monotonicNow?: () => number;
}

interface ManifestSummary {
  paths: string[];
  fileCount: number;
  newPublicSurface: boolean;
  behaviorFlag: boolean;
}

export const MECHANICAL_SKIP_FILE_THRESHOLD = 5;
const DEFAULT_MODEL = "claude-fable-5";
const DEFAULT_MODEL_LADDER: readonly string[] = [DEFAULT_MODEL, "claude-sonnet-5", "claude-haiku-4-5"];
const PRIMARY_MODEL_ENV = "DESIGN_REVIEW_MODEL";
const DEFAULT_FAMILY = "anthropic";
const GEMINI_MODEL = "gemini-2.5-flash";
const REVIEW_BLOCK_HEADING = "## Design-review verdict (Gate-A.7)";
const CLASS_A_HEADING = "## Design-review Class-A adjustments (Gate-A.7)";
const ESCALATION_HEADING = "## Design-review escalation (Gate-A.7)";
const EXTRA_AUTH_ENV = new Set(["ANTHROPIC_AUTH_TOKEN"]);

/**
 * Successful reviewer calls took 87-190s across three sessions, so a budget under ~90s
 * cannot plausibly complete the observed workload.
 *
 * This is the clamp MINIMUM for both budgets, not merely a runtime floor, and that is
 * deliberate. When it was only a runtime floor the two numbers disagreed: the per-call
 * clamp allowed 30_000 while the floor demanded 90_000, so `DESIGN_REVIEW_TIMEOUT_MS=30000`
 * -- a legal, in-range value -- placed a call that could not finish and then reported
 * reason:"timeout". A confident wrong label is the exact defect (D1) this module exists to
 * remove, so a budget too small to work is now unconfigurable rather than merely guarded.
 */
const MIN_USABLE_CALL_MS = 90_000;

/**
 * The `command -v` availability probe's budget. ONE constant, read by both the admission
 * check and the spend, because the defect this module just fixed was precisely two
 * numbers that had to agree being held in two places: the floor guarded `remaining` while
 * the call spent `min(perCall, remaining)`. Guarded quantity and spent quantity must be
 * the same expression, not two literals that happen to match today.
 */
const PROBE_TIMEOUT_MS = 5_000;

/** Marker proving `command -v` actually executed; see probeCommand. */
const PROBE_SENTINEL = "XOSPROBE";

/**
 * Clamp minimum for the TOTAL budget. Deliberately ABOVE MIN_USABLE_CALL_MS rather than
 * equal to it: the clock starts when ReviewBudget is constructed, and spec loading plus
 * prompt construction both spend before the first reviewer call is admitted. (The 5s CLI
 * probes do NOT -- they run in the cross-family leg, after the primary call has already
 * returned. An earlier version of this comment said otherwise and was simply wrong.)
 * A total of exactly 90_000 therefore guarantees `remaining < 90_000` at
 * admission and budget_exhausts before placing any call -- a legal configuration that can
 * never succeed. 120_000 is one usable call plus 30s of that overhead.
 *
 * Measured rather than guessed (2026-11-19): the elapsed time between construction and
 * the first admission is 3.0 ms for a 25KB spec and 5.6 ms for a toy one -- the work is
 * a handful of file reads and a string concat, and it does not scale meaningfully with
 * spec size. 30s of headroom is ~5000x the observed cost. The margin is deliberately
 * absurd because the failure it prevents (a legal config that can never place a call) is
 * silent, and the cost of the margin is only that a sub-2-minute total budget is
 * rejected -- which could not have completed a 87-190s review anyway.
 */
const MIN_TOTAL_BUDGET_MS = 120_000;

function resolveBudgetMs(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function resolveReviewerTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  return resolveBudgetMs(env.DESIGN_REVIEW_TIMEOUT_MS, 300_000, MIN_USABLE_CALL_MS, 900_000);
}

export function resolveTotalBudgetMs(env: Record<string, string | undefined> = process.env): number {
  return resolveBudgetMs(env.DESIGN_REVIEW_TOTAL_BUDGET_MS, 540_000, MIN_TOTAL_BUDGET_MS, 3_600_000);
}


class ReviewBudget {
  private readonly clock: () => number;
  private readonly started: number;
  private readonly perCall: number;
  private readonly total: number;

  constructor(options: RunOptions) {
    this.clock = options.monotonicNow ?? (() => performance.now());
    this.started = this.clock();
    this.perCall = resolveReviewerTimeoutMs(options.env);
    this.total = resolveTotalBudgetMs(options.env);
  }

  canProbe(): boolean {
    return this.total - (this.clock() - this.started) >= PROBE_TIMEOUT_MS;
  }

  async call(invoke: (timeout: number) => ReviewerCliResult | Promise<ReviewerCliResult>): Promise<ReviewerCliResult> {
    const elapsed = this.clock() - this.started;
    const remaining = this.total - elapsed;
    if (remaining < MIN_USABLE_CALL_MS) {
      return { ok: false, stdout: "", exitCode: null, timedOut: false, elapsedMs: elapsed, reason: "budget_exhausted" };
    }
    return invoke(Math.min(this.perCall, remaining));
  }
}

function unreachableDetails(result: ReviewerCliResult | null) {
  let reason: UnreachableReason = "unknown";
  if (result?.reason === "budget_exhausted") reason = "budget_exhausted";
  else if (result?.timedOut) reason = "timeout";
  else if (result?.exitCode === 127) reason = "cli_missing";
  else if (typeof result?.exitCode === "number" && result.exitCode !== 0) reason = "nonzero_exit";
  else if (result?.ok && !parseStructuredVerdict(result.stdout)) reason = "unparseable";
  return {
    reason,
    elapsed_ms: result?.elapsedMs ?? null,
    signal: result?.signal ?? null,
    exit_code: result?.exitCode ?? null,
    stderr_tail: (result?.stderr ?? "").slice(-2000),
  };
}

export function resolvePrimaryReviewerModel(env: Record<string, string | undefined> = process.env): string {
  const configured = env[PRIMARY_MODEL_ENV]?.trim();
  // Fable-5 quota exhaustion must not permanently wedge the gate; operators can route to an available model.
  return configured ? configured : DEFAULT_MODEL;
}

export function resolveReviewerCandidates(env: Record<string, string | undefined> = process.env): string[] {
  return env[PRIMARY_MODEL_ENV]?.trim()
    ? [resolvePrimaryReviewerModel(env)]
    : [...DEFAULT_MODEL_LADDER];
}

function advancesLadder(reason: UnreachableReason | undefined): boolean {
  return reason === "nonzero_exit";
}

function here(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path: string): string {
  return sha256Text(readFileSync(path, "utf8"));
}

export function sidecarPathForSpec(specPath: string): string {
  const ext = extname(specPath);
  const stem = ext ? specPath.slice(0, -ext.length) : specPath;
  return stem + ".design-review.json";
}

export function escalationPathForSpec(specPath: string): string {
  const ext = extname(specPath);
  const stem = ext ? specPath.slice(0, -ext.length) : specPath;
  return stem + ".design-review-escalation.md";
}

export function sanitizedEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/_API_KEY$/.test(key) || EXTRA_AUTH_ENV.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function decodePipe(pipe: Uint8Array | ArrayBuffer | undefined): string {
  if (!pipe) return "";
  return new TextDecoder().decode(pipe);
}

function defaultCommandRunner(command: string[], options: CommandRunnerOptions): ReviewerCliResult {
  const clock = options.monotonicNow ?? (() => performance.now());
  const started = clock();
  const timeout = options.timeout ?? resolveReviewerTimeoutMs(options.env);
  try {
    const result = Bun.spawnSync(command, {
      env: options.env,
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout,
    });
    const elapsedMs = clock() - started;
    return {
      ok: result.exitCode === 0,
      stdout: decodePipe(result.stdout),
      stderr: decodePipe(result.stderr),
      exitCode: result.exitCode,
      timedOut: result.signalCode === "SIGTERM" && elapsedMs >= timeout * 0.95,
      signal: result.signalCode ?? null,
      elapsedMs,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { ok: false, stdout: "", stderr: String(error), exitCode: 127, timedOut: false, elapsedMs: clock() - started };
  }
}

async function defaultReviewer(prompt: string, context: ReviewerContext, options: RunOptions, timeout: number): Promise<ReviewerCliResult> {
  const run = options.commandRunner ?? defaultCommandRunner;
  const result = run(["claude", "--model", context.model, "-p", prompt], { env: sanitizedEnv(options.env), timeout, monotonicNow: options.monotonicNow });
  return { ...result, model: context.model, family: context.family };
}

/**
 * Probing a CLI has THREE outcomes, not two, and collapsing them is how this module keeps
 * reproducing its own bug:
 *
 *   present      `command -v` found it
 *   absent       `command -v` ran and reported nothing (exit 1) -- real evidence of absence
 *   inconclusive the probe itself timed out or failed oddly -- we learned NOTHING
 *
 * `return result.ok` collapsed `absent` and `inconclusive` into one `false`, so a probe
 * that timed out ended up asserting "no cross-family reviewer CLI available" -- a claim
 * the code never obtained evidence for. Callers must handle all three.
 */
type ProbeOutcome = { outcome: "present" | "absent" | "inconclusive"; detail: string };

function probeCommand(command: string, options: RunOptions): ProbeOutcome {
  const run = options.commandRunner ?? defaultCommandRunner;
  // The sentinel separates "the probe RAN" from "what the probe FOUND". Testing the
  // shell's own exit code conflates them: `sh -lc` sources a login profile first (observed
  // on this machine printing to stdout), so a nonzero exit may come from the profile
  // rather than from `command -v`, and POSIX specifies only a NONZERO not-found status --
  // not 1. Keying absence on `exitCode === 1` was therefore an assumption about shell
  // convention dressed as evidence. With the sentinel, absence is claimed only when
  // `command -v` demonstrably ran and reported nothing.
  const result = run(["sh", "-lc", `command -v ${command} >/dev/null 2>&1; printf '${PROBE_SENTINEL}:%s' "$?"`],
                     { env: sanitizedEnv(options.env), timeout: PROBE_TIMEOUT_MS, monotonicNow: options.monotonicNow });
  const match = new RegExp(`${PROBE_SENTINEL}:(\\d+)`).exec(result.stdout ?? "");
  if (!match) {
    // No sentinel: the probe never completed. A timeout, a profile that exits, a shell
    // that died. We learned nothing, and must not pretend otherwise.
    const why = result.timedOut ? "probe timed out" : `probe did not complete (exit ${result.exitCode ?? "null"})`;
    return { outcome: "inconclusive", detail: `${command} ${why}` };
  }
  return match[1] === "0"
    ? { outcome: "present", detail: command }
    : { outcome: "absent", detail: `${command} not installed` };
}

async function defaultCrossFamilyReviewer(prompt: string, context: ReviewerContext, options: RunOptions, budget: ReviewBudget): Promise<ReviewerCliResult> {
  const run = options.commandRunner ?? defaultCommandRunner;
  const candidates: Array<[string, string[], string, string]> = [
    ["gemini", ["gemini", "-m", GEMINI_MODEL, "-p", prompt], GEMINI_MODEL, "google"],
    ["codex", ["codex", "exec", prompt], "codex-local", "openai"],
  ];
  const undetermined: string[] = [];
  const unavailable = (stderr: string, reason: UnreachableReason | undefined, exitCode: number | null) =>
    ({ ok: false, stdout: "", stderr, exitCode, timedOut: false, reason, model: context.model, family: context.family });

  for (const [bin, argv, model, family] of candidates) {
    // Checked before EVERY probe, not once up front: a single leading check still leaves
    // the second probe to be placed with nothing left.
    if (!budget.canProbe()) {
      return unavailable(`cross-family probe not attempted (${bin}): review budget exhausted`, "budget_exhausted", null);
    }
    const probe = probeCommand(bin, options);
    if (probe.outcome === "present") {
      const result = await budget.call(timeout => run(argv, { env: sanitizedEnv(options.env), timeout, monotonicNow: options.monotonicNow }));
      return { ...result, model, family };
    }
    // An inconclusive probe is NOT a reason to abandon the remaining candidates. The point
    // of this leg is a second training distribution's opinion; giving that up because the
    // FIRST probe was flaky trades a real review for nothing. Remember it and keep going.
    if (probe.outcome === "inconclusive") undetermined.push(probe.detail);
    // outcome === "absent": real evidence. Keep looking.
  }
  // Every candidate was tried. If any probe was inconclusive we cannot claim absence --
  // one of those CLIs may well be installed and we simply failed to find out.
  // No `reason` code: cross_family.reason is human-facing and the DETAIL is the point;
  // "unknown" would be true but useless to whoever reads it.
  if (undetermined.length > 0) {
    return unavailable(`cross-family reviewer undetermined: ${undetermined.join("; ")}`, undefined, null);
  }
  // Reached ONLY when every candidate was probed and each reported a definite absence.
  return { ok: false, stdout: "", stderr: "no cross-family reviewer CLI available", exitCode: 127, model: context.model, family: context.family };
}

export function extractChangeManifest(planText: string): string {
  const match = planText.match(/^## Change manifest\s*$/im);
  if (!match || match.index === undefined) return "";
  const start = match.index;
  const rest = planText.slice(start);
  const next = rest.slice(match[0].length).search(/^## (?!Design-review verdict \(Gate-A\.7\)|Design-review escalation \(Gate-A\.7\))/im);
  if (next < 0) return rest.trim();
  return rest.slice(0, match[0].length + next).trim();
}

export function stripGeneratedReviewBlocks(planText: string): string {
  return planText
    .replace(new RegExp(`\\n?${escapeRegExp(REVIEW_BLOCK_HEADING)}[\\s\\S]*?(?=\\n## |$)`, "g"), "")
    .replace(new RegExp(`\\n?${escapeRegExp(ESCALATION_HEADING)}[\\s\\S]*?(?=\\n## |$)`, "g"), "")
    .trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBooleanFlag(text: string, names: string[]): boolean {
  for (const name of names) {
    const pattern = new RegExp(name + "\\s*[:=]\\s*(true|yes|1)", "i");
    if (pattern.test(text)) return true;
  }
  return false;
}

function pathMatches(line: string): string[] {
  const matches = line.match(
    /(?:[A-Za-z0-9_.@-]+\/[A-Za-z0-9_./@+-]+|[A-Za-z0-9_.@+-]+\.(?:md|json|ya?ml|toml|lock|txt)|VERSION|CHANGELOG(?:\.md)?|README(?:\.md)?|package(?:-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)/g
  );
  return matches ?? [];
}


function extractPathsFromManifestText(manifest: string): string[] {
  const paths = new Set<string>();
  for (const line of manifest.split("\n")) {
    if (/\(none\)/i.test(line)) continue;
    if (!/^\s*(?:\+|~|-|\u2212|\u2699)/.test(line)) continue;
    for (const found of pathMatches(line)) {
      if (found === "added" || found === "modified" || found === "removed" || found === "migrated") continue;
      paths.add(found.replace(/^[`'"]|[`'",]$/g, ""));
    }
  }
  return Array.from(paths);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function boolFromObject(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = obj[key];
    if (value === true) return true;
    if (typeof value === "string" && /^(true|yes|1)$/i.test(value.trim())) return true;
  }
  return false;
}

function pathsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!asObject(value)) return [];
  const obj = value as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of ["paths", "files", "added", "modified", "removed", "migrated"]) {
    paths.push(...pathsFromUnknown(obj[key]));
  }
  return paths;
}

/**
 * Exported for tests (XOS-415). Path extraction had TWO wrong-identity bugs in this ticket
 * alone -- install.sh matching nothing, and a verb stripped without a word boundary turning
 * `added_file.ts` into `_file.ts` -- and neither was observable through shouldSkip, whose
 * verdict is identical whether the extracted path is right or merely wrong in the same
 * direction. A guard you cannot ask "what did you see?" cannot be tested, only trusted.
 */
export function manifestSummary(manifest: string | Record<string, unknown>): ManifestSummary {
  if (typeof manifest === "string") {
    const explicitCount = manifest.match(/\bfile[-_ ]count\s*[:=]\s*(\d+)/i);
    const paths = extractPathsFromManifestText(manifest);
    return {
      paths,
      fileCount: explicitCount ? Number(explicitCount[1]) : paths.length,
      newPublicSurface: parseBooleanFlag(manifest, ["new[-_ ]public[-_ ]surface", "public[-_ ]surface"]),
      behaviorFlag: parseBooleanFlag(manifest, ["behavior[-_ ]flag", "behavior[-_ ]change", "behavior"]),
    };
  }

  const paths = pathsFromUnknown(manifest);
  const countRaw = manifest["file_count"] ?? manifest["fileCount"] ?? manifest["count"];
  const fileCount = typeof countRaw === "number" ? countRaw : paths.length;
  return {
    paths,
    fileCount,
    newPublicSurface: boolFromObject(manifest, ["new_public_surface", "newPublicSurface", "public_surface", "publicSurface"]),
    behaviorFlag: boolFromObject(manifest, ["behavior_flag", "behaviorFlag", "behavior", "behavior_change", "behaviorChange"]),
  };
}

function isMechanicalPath(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  const base = basename(normalized);
  if (normalized.startsWith("docs/")) return true;
  if (normalized.endsWith(".md")) return true;
  if (/^(VERSION|CHANGELOG(?:\.md)?|README(?:\.md)?)$/.test(base)) return true;
  if (/^(package(?:-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock)$/.test(base)) return true;
  if (normalized.startsWith(".claude-plugin/") && /^(plugin|marketplace)\.json$/.test(base)) return true;
  if (normalized.startsWith(".github/") && /\.(ya?ml)$/.test(base)) return true;
  if (/\.(json|ya?ml|toml)$/.test(base) && (normalized.startsWith(".") || /config|settings|manifest/i.test(normalized))) return true;
  return false;
}

// Exact standalone line in the Change manifest; mentioning the claim is not making it.
export const MECHANICAL_CLAIM = "I claim this change is mechanical-only.";

export function shouldSkip(manifest: string | Record<string, unknown>): { skip: boolean; rule?: string; blockedBy?: string } {
  if (typeof manifest !== "string") return { skip: false, blockedBy: "no_mechanical_claim" };
  // A bare split("\n") leaves \r welded to the line, so on CRLF the claim never matches
  // and that author can never reach the affirmative path -- a failure indistinguishable
  // from not having claimed. Only a TRAILING \r is stripped, per line: normalising \r
  // globally would turn an inline \r into a line break and promote a mention
  // ("x\rI claim...") into a standalone claim, which is a bypass, not a fix.
  // A file with no \n at all stays one line and is reviewed. That is the fail-closed side.
  if (!manifest.split("\n").some((line) => line.replace(/\r+$/, "") === MECHANICAL_CLAIM)) {
    return { skip: false, blockedBy: "no_mechanical_claim" };
  }
  const summary = manifestSummary(manifest);
  if (summary.fileCount > MECHANICAL_SKIP_FILE_THRESHOLD) return { skip: false, blockedBy: "file_count" };
  if (summary.newPublicSurface || summary.behaviorFlag) return { skip: false, blockedBy: "declared_flag" };
  if (summary.paths.length === 0) return { skip: false, blockedBy: "no_paths" };
  if (!summary.paths.every(isMechanicalPath)) return { skip: false, blockedBy: "non_mechanical_path" };
  return { skip: true, rule: `mechanical-manifest:file_count<=${MECHANICAL_SKIP_FILE_THRESHOLD}` };
}

export function classifyAdjustment(adjustmentText: string): AdjustmentClass {
  const text = adjustmentText.toLowerCase();
  if (!text.trim()) return "B";
  const neutralized = text
    .replace(/\b(?:no|without)\s+(?:scope|behavior|behaviour|dod|requirement)s?\s+change\b/g, "")
    .replace(/\bnon-?behavioral\b/g, "")
    .replace(/\bexisting behavior is unchanged\b/g, "");
  if (/\b(scope|requirement|acceptance criteria|dod|definition of done|user-visible|behavior|behaviour|remove|delete|drop|alter|replace|supersede|deprecate|migrate|out of scope|in scope|must no longer|instead of)\b/.test(neutralized)) {
    return "B";
  }
  if (/\b(clarify|clarifies|clarification|add a note|document|wording|typo|spelling|grammar|heading|comment|non-behavioral|no behavior change|no scope change)\b/.test(text)) {
    return "A";
  }
  return "B";
}

function normalizeFinding(value: unknown): Finding | null {
  const obj = asObject(value);
  if (!obj) return null;
  const severity = typeof obj["severity"] === "string" ? obj["severity"] : "";
  const lens = typeof obj["lens"] === "string" ? obj["lens"] : "";
  const fix = typeof obj["fix"] === "string" ? obj["fix"] : "";
  if (!severity || !lens || !fix) return null;
  return { severity, lens, fix };
}

function normalizeStructured(value: unknown): StructuredVerdict | null {
  const obj = asObject(value);
  if (!obj) return null;
  const verdict = typeof obj["verdict"] === "string" ? obj["verdict"].toUpperCase() : "";
  if (verdict !== "GREEN" && verdict !== "YELLOW" && verdict !== "RED") return null;
  const findingsRaw = Array.isArray(obj["findings"]) ? obj["findings"] : [];
  const findings = findingsRaw.map(normalizeFinding).filter((item): item is Finding => Boolean(item));
  return { verdict, findings };
}

function jsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fences = text.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [];
  for (const fence of fences) {
    const inner = fence.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (inner) candidates.push(inner);
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

export function parseStructuredVerdict(output: string): StructuredVerdict | null {
  for (const candidate of jsonCandidates(output.trim())) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeStructured(parsed);
      if (normalized) return normalized;
    } catch {
      /* keep scanning deterministic candidates */
    }
  }
  return null;
}

function readPriorRecord(sidecarPath: string): DesignReviewRecord | null {
  if (!existsSync(sidecarPath)) return null;
  try {
    return JSON.parse(readFileSync(sidecarPath, "utf8")) as DesignReviewRecord;
  } catch {
    return null;
  }
}

function nextCycle(prior: DesignReviewRecord | null): number {
  return typeof prior?.cycle === "number" && prior.cycle > 0 ? prior.cycle + 1 : 1;
}

function tierRank(tier: string | undefined, manifest: string): number {
  const value = tier ?? manifest.match(/\bT([0-4])\b/i)?.[1];
  if (!value) return 2;
  const match = String(value).match(/T?([0-4])/i);
  return match ? Number(match[1]) : 2;
}

function nonTrivial(planText: string, manifest: string): boolean {
  if (shouldSkip(manifest).skip) return false;
  const words = stripGeneratedReviewBlocks(planText).split(/\s+/).filter(Boolean).length;
  const files = manifestSummary(manifest).fileCount;
  return words > 120 || files > 1;
}

function buildPrompt(args: {
  lenses: string;
  specText: string;
  manifestText: string;
  priorRed?: DesignReviewRecord | null;
}): string {
  const scoped = args.priorRed?.verdict === "RED";
  return [
    "You are a fresh design-reasoning reviewer for a /ship-feature run.",
    "Your only inputs are the spec text and the Change Manifest below. Do not rely on any prior conversation.",
    scoped
      ? "This is a scoped RED re-review. Judge only whether the prior RED findings were addressed. A new finding may keep RED only if it meets the RED bar."
      : "Review the design before implementation starts.",
    "",
    "# Versioned rubric",
    args.lenses.trim(),
    "",
    scoped ? "# Prior RED findings\n" + JSON.stringify(args.priorRed?.findings ?? [], null, 2) + "\n" : "",
    "# Spec",
    args.specText.trim(),
    "",
    "# Change Manifest",
    args.manifestText.trim() || "(missing)",
    "",
    "Emit exactly one JSON object with this shape and no prose:",
    '{"verdict":"GREEN|YELLOW|RED","findings":[{"severity":"...","lens":"...","fix":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

async function callPrimaryReviewer(
  prompt: string,
  options: RunOptions,
  candidates: string[],
  budget: ReviewBudget
): Promise<{ verdict: StructuredVerdict | null; result: ReviewerCliResult | null; unreachable: boolean; modelsTried: string[] }> {
  const modelsTried: string[] = [];
  let lastResult: ReviewerCliResult | null = null;
  for (const model of candidates) {
    // Preserve the existing parse retry on the SAME model; it is not a ladder advance.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const kind: ReviewerContext["kind"] = attempt === 1 ? "primary" : "retry";
      const context: ReviewerContext = { attempt, kind, model, family: DEFAULT_FAMILY };
      // Admission runs before EVERY candidate/retry through the shared budget. Only
      // the admitted callback records an attempt, so budget denial cannot invent one.
      const result = await budget.call(async timeout => {
        if (attempt === 1) modelsTried.push(model);
        const response = options.reviewer
          ? await options.reviewer(prompt, context)
          : await defaultReviewer(prompt, context, options, timeout);
        return { ...response, model: response.model ?? model, family: response.family ?? DEFAULT_FAMILY };
      });
      lastResult = { ...result, model: result.model ?? modelsTried.at(-1) };
      const parsed = result.ok ? parseStructuredVerdict(result.stdout) : null;
      if (parsed) return { verdict: parsed, result: lastResult, unreachable: false, modelsTried };
      if (result.ok && attempt === 1) continue;
      if (!advancesLadder(unreachableDetails(result).reason) || candidates.length === 1) {
        return { verdict: null, result: lastResult, unreachable: true, modelsTried };
      }
      break;
    }
  }
  return {
    verdict: null,
    result: lastResult,
    unreachable: true,
    modelsTried,
  };
}

function mergeVerdicts(primary: StructuredVerdict, cross: StructuredVerdict | null): StructuredVerdict {
  if (!cross) return primary;
  const findings = [...primary.findings, ...cross.findings];
  if (cross.verdict === "RED" || primary.verdict === "RED") return { verdict: "RED", findings };
  if (cross.verdict === "YELLOW" || primary.verdict === "YELLOW") return { verdict: "YELLOW", findings };
  return { verdict: "GREEN", findings };
}

async function maybeCrossFamily(prompt: string, primary: StructuredVerdict, options: RunOptions, required: boolean, spotCheck: boolean, budget: ReviewBudget): Promise<{ final: StructuredVerdict; record: CrossFamilyRecord }> {
  if (!required && !spotCheck) return { final: primary, record: { status: "not_required" } };
  const reviewer: ReviewerCommand = options.crossFamilyReviewer
    ? (p, c) => budget.call(() => options.crossFamilyReviewer!(p, c))
    : (p, c) => defaultCrossFamilyReviewer(p, c, options, budget);
  const kind: ReviewerContext["kind"] = required ? "cross-family" : "spot-check";
  const result = await reviewer(prompt, { attempt: 1, kind, model: GEMINI_MODEL, family: "google" });
  if (!result.ok) {
    return {
      final: primary,
      record: { status: "unavailable", reviewer: result.model ?? GEMINI_MODEL, reason: result.reason ?? (result.stderr || "cross-family reviewer unavailable") },
    };
  }
  const parsed = parseStructuredVerdict(result.stdout);
  if (!parsed) {
    return {
      final: primary,
      record: { status: "unavailable", reviewer: result.model ?? GEMINI_MODEL, reason: "cross-family reviewer returned unparseable output" },
    };
  }
  return {
    final: mergeVerdicts(primary, parsed),
    record: { status: "available", reviewer: result.model ?? GEMINI_MODEL, verdict: parsed.verdict, findings: parsed.findings },
  };
}

function adjustmentsFor(verdict: StructuredVerdict): AdjustmentRecord[] {
  if (verdict.verdict !== "YELLOW") return [];
  return verdict.findings.map((finding) => {
    const klass = classifyAdjustment(finding.fix);
    return { class: klass, applied: false, text: finding.fix };
  });
}

function applyClassAAdjustments(specPath: string, adjustments: AdjustmentRecord[]): AdjustmentRecord[] {
  const classA = adjustments.filter((item) => item.class === "A");
  if (classA.length === 0) return adjustments;
  const block = [
    "",
    "",
    CLASS_A_HEADING,
    "",
    ...classA.map((item) => "- " + item.text),
    "",
  ].join("\n");
  appendFileSync(specPath, block);
  return adjustments.map((item) => (item.class === "A" ? { ...item, applied: true } : item));
}

function humanVerdictBlock(record: Omit<DesignReviewRecord, "spec_sha256">): string {
  const lines = [
    "",
    "",
    REVIEW_BLOCK_HEADING,
    "",
    `- verdict: ${record.verdict}`,
    `- cycle: ${record.cycle}`,
    `- reviewer: ${record.reviewer_family}/${record.reviewer_model}`,
    `- cross_family: ${typeof record.cross_family === "string" ? record.cross_family : record.cross_family.status}`,
    `- manifest_sha256: ${record.manifest_sha256}`,
    `- timestamp: ${record.timestamp}`,
  ];
  if (record.rule) lines.push(`- skip_rule: ${record.rule}`);
  if (record.findings.length === 0) {
    lines.push("- findings: none");
  } else {
    lines.push("- findings:");
    for (const finding of record.findings) lines.push(`  - [${finding.severity}] ${finding.lens}: ${finding.fix}`);
  }
  if (record.adjustments && record.adjustments.length > 0) {
    lines.push("- adjustments:");
    for (const adjustment of record.adjustments) lines.push(`  - Class ${adjustment.class}; applied=${adjustment.applied}: ${adjustment.text}`);
  }
  lines.push("");
  return lines.join("\n");
}

function writeRecord(specPath: string, sidecarPath: string, draft: Omit<DesignReviewRecord, "spec_sha256">): DesignReviewRecord {
  appendFileSync(specPath, humanVerdictBlock(draft));
  const record: DesignReviewRecord = { ...draft, spec_sha256: sha256File(specPath) };
  mkdirSync(dirname(sidecarPath), { recursive: true });
  writeFileSync(sidecarPath, JSON.stringify(record, null, 2) + "\n");
  return record;
}

function writeEscalation(specPath: string, prior: DesignReviewRecord | null, current: DesignReviewRecord): string {
  const path = escalationPathForSpec(specPath);
  const body = [
    ESCALATION_HEADING,
    "",
    `spec: ${specPath}`,
    `cycle: ${current.cycle}`,
    `timestamp: ${current.timestamp}`,
    "",
    "The design review returned a second RED. Park the run for human review before implementation continues.",
    "",
    "Prior findings:",
    JSON.stringify(prior?.findings ?? [], null, 2),
    "",
    "Current findings:",
    JSON.stringify(current.findings, null, 2),
    "",
  ].join("\n");
  writeFileSync(path, body);
  return path;
}

export async function runDesignReview(specPathInput: string, options: RunOptions = {}): Promise<RunResult> {
  const budget = new ReviewBudget(options);
  const specPath = resolve(specPathInput);
  const sidecarPath = options.sidecarPath ?? sidecarPathForSpec(specPath);
  const prior = readPriorRecord(sidecarPath);
  const cycle = nextCycle(prior);
  const timestamp = (options.now ?? new Date()).toISOString();

  const planText = readFileSync(specPath, "utf8");
  const reviewableSpec = stripGeneratedReviewBlocks(planText);
  const manifestText = extractChangeManifest(reviewableSpec);
  const manifestSha = sha256Text(manifestText);

  const skip = shouldSkip(manifestText);
  if (skip.skip) {
    const record = writeRecord(specPath, sidecarPath, {
      verdict: "SKIPPED",
      findings: [],
      manifest_sha256: manifestSha,
      reviewer_model: "objective-skip-rule",
      reviewer_family: "deterministic",
      cross_family: { status: "not_required" },
      cycle,
      timestamp,
      rule: skip.rule,
    });
    return { record, sidecarPath, exitCode: 0, parked: false };
  }

  const lensesPath = options.lensesPath ?? join(here(), "lenses.md");
  const lenses = readFileSync(lensesPath, "utf8");
  const prompt = buildPrompt({ lenses, specText: reviewableSpec, manifestText, priorRed: prior?.verdict === "RED" ? prior : null });
  const primaryModel = resolvePrimaryReviewerModel(options.env);
  const primary = await callPrimaryReviewer(prompt, options, resolveReviewerCandidates(options.env), budget);

  if (primary.unreachable || !primary.verdict) {
    const record = writeRecord(specPath, sidecarPath, {
      verdict: "UNREACHABLE",
      ...unreachableDetails(primary.result),
      models_tried: primary.modelsTried,
      findings: [],
      manifest_sha256: manifestSha,
      reviewer_model: primary.result?.model ?? primaryModel,
      reviewer_family: primary.result?.family ?? DEFAULT_FAMILY,
      cross_family: { status: "not_required" },
      cycle,
      timestamp,
    });
    return { record, sidecarPath, exitCode: 1, parked: false };
  }

  const tier = tierRank(options.tier, manifestText);
  const spotCheck = primary.verdict.verdict === "GREEN" && primary.verdict.findings.length === 0 && cycle === 1 && nonTrivial(reviewableSpec, manifestText);
  const cross = await maybeCrossFamily(prompt, primary.verdict, options, tier >= 3, spotCheck, budget);
  const finalVerdict = cross.final;
  let adjustments = adjustmentsFor(finalVerdict);
  if (finalVerdict.verdict === "YELLOW" && adjustments.length > 0 && adjustments.every((item) => item.class === "A")) {
    adjustments = applyClassAAdjustments(specPath, adjustments);
  }

  const record = writeRecord(specPath, sidecarPath, {
    verdict: finalVerdict.verdict,
    findings: finalVerdict.findings,
    manifest_sha256: manifestSha,
    reviewer_model: primary.result?.model ?? primaryModel,
    reviewer_family: primary.result?.family ?? DEFAULT_FAMILY,
    // Carried on SUCCESS too, not only on UNREACHABLE. reviewer_model alone names who
    // reviewed; it does not reveal that two stronger candidates refused first. A GREEN
    // produced after a silent capability downgrade is operationally different from a
    // GREEN produced by the first-choice model, and the operator needs to see which.
    models_tried: primary.modelsTried.length > 1 ? primary.modelsTried : undefined,
    cross_family: cross.record,
    cycle,
    timestamp,
    adjustments: adjustments.length > 0 ? adjustments : undefined,
  });

  if (record.verdict === "RED" && cycle >= 2) {
    const escalationPath = writeEscalation(specPath, prior, record);
    const withEscalation = { ...record, escalation_artifact: escalationPath };
    writeFileSync(sidecarPath, JSON.stringify(withEscalation, null, 2) + "\n");
    return { record: withEscalation, sidecarPath, escalationPath, exitCode: 1, parked: true };
  }

  return { record, sidecarPath, exitCode: record.verdict === "RED" ? 1 : 0, parked: false };
}

async function runCli(): Promise<void> {
  const specPath = process.argv[2];
  if (!specPath) {
    process.stderr.write("WHAT: missing design-review spec path.\nHOW: run `bun run skills/ship-feature/design-review/run.ts docs/plans/<slug>.md` after Gate-A.5.\n");
    process.exit(1);
  }
  const result = await runDesignReview(specPath);
  process.stdout.write(JSON.stringify(result.record, null, 2) + "\n");
  process.exit(result.exitCode);
}

if (import.meta.main) {
  runCli().catch((err) => {
    process.stderr.write("WHAT: Gate-A.7 design-review harness crashed.\nHOW: fix the harness/runtime error and rerun; do not proceed to Stage 4 without a GREEN/SKIPPED/allowed-YELLOW sidecar.\n" + String(err) + "\n");
    process.exit(1);
  });
}
