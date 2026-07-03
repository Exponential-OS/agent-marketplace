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
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";

export type ReviewVerdict = "GREEN" | "YELLOW" | "RED";
export type RecordedVerdict = ReviewVerdict | "UNREACHABLE" | "SKIPPED";
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
}

interface ManifestSummary {
  paths: string[];
  fileCount: number;
  newPublicSurface: boolean;
  behaviorFlag: boolean;
}

export const MECHANICAL_SKIP_FILE_THRESHOLD = 5;
const DEFAULT_MODEL = "claude-fable-5";
const DEFAULT_FAMILY = "anthropic";
const GEMINI_MODEL = "gemini-2.5-flash";
const REVIEW_BLOCK_HEADING = "## Design-review verdict (Gate-A.7)";
const CLASS_A_HEADING = "## Design-review Class-A adjustments (Gate-A.7)";
const ESCALATION_HEADING = "## Design-review escalation (Gate-A.7)";
const API_KEY_ENV = new Set(["OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]);

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
    if (API_KEY_ENV.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function decodePipe(pipe: Uint8Array | ArrayBuffer | undefined): string {
  if (!pipe) return "";
  return new TextDecoder().decode(pipe);
}

function defaultCommandRunner(command: string[], options: CommandRunnerOptions): ReviewerCliResult {
  const result = Bun.spawnSync(command, {
    env: options.env,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeout ?? 120_000,
  });
  return {
    ok: result.exitCode === 0,
    stdout: decodePipe(result.stdout),
    stderr: decodePipe(result.stderr),
    exitCode: result.exitCode,
  };
}

function defaultReviewer(prompt: string, context: ReviewerContext, options: RunOptions): ReviewerCliResult {
  const run = options.commandRunner ?? defaultCommandRunner;
  const result = run(["claude", "--model", context.model, "-p", prompt], { env: sanitizedEnv(options.env), timeout: 120_000 });
  return { ...result, model: context.model, family: context.family };
}

function commandAvailable(command: string, options: RunOptions): boolean {
  const run = options.commandRunner ?? defaultCommandRunner;
  const result = run(["sh", "-lc", "command -v " + command], { env: sanitizedEnv(options.env), timeout: 5_000 });
  return result.ok;
}

function defaultCrossFamilyReviewer(prompt: string, context: ReviewerContext, options: RunOptions): ReviewerCliResult {
  const run = options.commandRunner ?? defaultCommandRunner;
  if (commandAvailable("gemini", options)) {
    const result = run(["gemini", "-m", GEMINI_MODEL, "-p", prompt], { env: sanitizedEnv(options.env), timeout: 120_000 });
    return { ...result, model: GEMINI_MODEL, family: "google" };
  }
  if (commandAvailable("codex", options)) {
    const result = run(["codex", "exec", prompt], { env: sanitizedEnv(options.env), timeout: 120_000 });
    return { ...result, model: "codex-local", family: "openai" };
  }
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

function manifestSummary(manifest: string | Record<string, unknown>): ManifestSummary {
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

export function shouldSkip(manifest: string | Record<string, unknown>): { skip: boolean; rule?: string } {
  const summary = manifestSummary(manifest);
  if (summary.fileCount > MECHANICAL_SKIP_FILE_THRESHOLD) return { skip: false };
  if (summary.newPublicSurface || summary.behaviorFlag) return { skip: false };
  if (summary.paths.length === 0) return { skip: false };
  if (!summary.paths.every(isMechanicalPath)) return { skip: false };
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

async function callPrimaryReviewer(prompt: string, options: RunOptions): Promise<{ verdict: StructuredVerdict | null; result: ReviewerCliResult | null; unreachable: boolean }> {
  const reviewer = options.reviewer ?? ((p, c) => defaultReviewer(p, c, options));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const kind: ReviewerContext["kind"] = attempt === 1 ? "primary" : "retry";
    const result = await reviewer(prompt, { attempt, kind, model: DEFAULT_MODEL, family: DEFAULT_FAMILY });
    if (!result.ok) return { verdict: null, result, unreachable: true };
    const parsed = parseStructuredVerdict(result.stdout);
    if (parsed) return { verdict: parsed, result, unreachable: false };
    if (attempt === 1) continue;
    return { verdict: null, result, unreachable: true };
  }
  return { verdict: null, result: null, unreachable: true };
}

function mergeVerdicts(primary: StructuredVerdict, cross: StructuredVerdict | null): StructuredVerdict {
  if (!cross) return primary;
  const findings = [...primary.findings, ...cross.findings];
  if (cross.verdict === "RED" || primary.verdict === "RED") return { verdict: "RED", findings };
  if (cross.verdict === "YELLOW" || primary.verdict === "YELLOW") return { verdict: "YELLOW", findings };
  return { verdict: "GREEN", findings };
}

async function maybeCrossFamily(prompt: string, primary: StructuredVerdict, options: RunOptions, required: boolean, spotCheck: boolean): Promise<{ final: StructuredVerdict; record: CrossFamilyRecord }> {
  if (!required && !spotCheck) return { final: primary, record: { status: "not_required" } };
  const reviewer = options.crossFamilyReviewer ?? ((p, c) => defaultCrossFamilyReviewer(p, c, options));
  const kind: ReviewerContext["kind"] = required ? "cross-family" : "spot-check";
  const result = await reviewer(prompt, { attempt: 1, kind, model: GEMINI_MODEL, family: "google" });
  if (!result.ok) {
    return {
      final: primary,
      record: { status: "unavailable", reviewer: result.model ?? GEMINI_MODEL, reason: result.stderr || "cross-family reviewer unavailable" },
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
  const primary = await callPrimaryReviewer(prompt, options);

  if (primary.unreachable || !primary.verdict) {
    const record = writeRecord(specPath, sidecarPath, {
      verdict: "UNREACHABLE",
      findings: [],
      manifest_sha256: manifestSha,
      reviewer_model: primary.result?.model ?? DEFAULT_MODEL,
      reviewer_family: primary.result?.family ?? DEFAULT_FAMILY,
      cross_family: { status: "not_required" },
      cycle,
      timestamp,
    });
    return { record, sidecarPath, exitCode: 1, parked: false };
  }

  const tier = tierRank(options.tier, manifestText);
  const spotCheck = primary.verdict.verdict === "GREEN" && primary.verdict.findings.length === 0 && cycle === 1 && nonTrivial(reviewableSpec, manifestText);
  const cross = await maybeCrossFamily(prompt, primary.verdict, options, tier >= 3, spotCheck);
  const finalVerdict = cross.final;
  let adjustments = adjustmentsFor(finalVerdict);
  if (finalVerdict.verdict === "YELLOW" && adjustments.length > 0 && adjustments.every((item) => item.class === "A")) {
    adjustments = applyClassAAdjustments(specPath, adjustments);
  }

  const record = writeRecord(specPath, sidecarPath, {
    verdict: finalVerdict.verdict,
    findings: finalVerdict.findings,
    manifest_sha256: manifestSha,
    reviewer_model: primary.result?.model ?? DEFAULT_MODEL,
    reviewer_family: primary.result?.family ?? DEFAULT_FAMILY,
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
