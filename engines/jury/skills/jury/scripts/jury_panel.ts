#!/usr/bin/env bun
/**
 * judge_panel.ts — Judge-panel cascade-then-jury harness (OAuth-only local-CLI edition).
 *
 * Small-fish first: ≥2 cross-family cheap judges in parallel.
 * Escalate to one big-fish cross-family tiebreaker on disagreement or low confidence.
 *
 * Both judges run exclusively via OAuth-authenticated local CLIs over the
 * user's paid subscriptions. API keys and API-billing fallbacks are unsupported:
 *   - Google → `agy` CLI (Antigravity OAuth / Ultra entitlement)
 *   - OpenAI → `codex` CLI (ChatGPT Plus/Pro subscription via codex login OAuth)
 *
 * Pre-conditions (one-time per machine):
 *   1. `agy` on PATH and authenticated:
 *      agy --model "Gemini 3.5 Flash (Low)" --dangerously-skip-permissions \
 *        --sandbox --print-timeout 120s -p "..."
 *      The script strips API-key-shaped environment variables so agy uses
 *      OAuth / Ultra entitlement.
 *   2. `codex` on PATH and authenticated (`codex login`).
 *      Creds at ~/.codex/auth.json. CLI uses ChatGPT Plus/Pro entitlements.
 *
 * If either CLI is MISSING (binary not on PATH), the juror fails hard with
 * verdict="error" and flag CLI_NOT_INSTALLED. It never falls back to an API.
 *
 * If a CLI is INSTALLED but fails (auth, runtime, timeout, non-zero exit), the
 * juror returns the CLI error — NO fallback fires.
 *
 * Reads model pins from $JURY_ENV (default: ~/.jury/.env; falls back to
 * $CO_DIALECTIC_ENV / ~/.co-dialectic/.env for back-compat).
 *
 * Usage:
 *     bun run judge_panel.ts --rubric hallucination --artifact "..."
 *     bun run judge_panel.ts --rubric hallucination --artifact-file ./artifact.txt
 *     bun run judge_panel.ts --rubric custom --rubric-text "..." --artifact "..."
 *
 * Output: single JSON object on stdout. Errors on stderr.
 */

import {
  readFileSync,
  existsSync,
  mkdtempSync,
  unlinkSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

const VERSION = "3.4.0";

// ─── Types ──────────────────────────────────────────────────────────────────

type Verdict = "pass" | "fail" | "uncertain" | "error" | "timeout";

interface JurorResult {
  model: string;
  family: string;
  verdict: Verdict;
  confidence: number;
  flags: string[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  raw_response: string;
  error: string | null;
}

interface CascadeResult {
  version: string;
  rubric: string;
  persona: string | null;
  cascade: {
    stage_1_small_fish: JurorResult[];
    agreement: string;
    confidence_tier: string;
    escalated: boolean;
    stage_2_tiebreaker: JurorResult | null;
  };
  final_verdict: Verdict;
  final_confidence: number;
  all_flags: string[];
  cost_usd_estimate: number;
  cost_vs_naive_parallel_jury_ratio: number | null;
}

interface ParsedArgs {
  rubric: string;
  rubricText: string | null;
  artifact: string | null;
  artifactFile: string | null;
  tiebreaker: string | null;
  persona: string | null;
  silent: boolean;
}

// ─── Config — model pins from $JURY_ENV (default ~/.jury/.env; falls back to
// $CO_DIALECTIC_ENV / ~/.co-dialectic/.env for back-compat) ──────────────────

const ENV_CANDIDATES = [
  process.env.JURY_ENV,
  process.env.CO_DIALECTIC_ENV,
  join(homedir(), ".jury", ".env"),
  join(homedir(), ".co-dialectic", ".env"),
].filter(Boolean) as string[];

const CYBORG_ENV =
  ENV_CANDIDATES.find((path) => existsSync(path)) ??
  join(homedir(), ".jury", ".env");

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return env;
  }
  for (const lineRaw of text.split("\n")) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const ENV_FILE = loadEnv(CYBORG_ENV);

const FALLBACK_SMALL_GEMINI = "Gemini 3.5 Flash (Low)";
const FALLBACK_BIG_GEMINI = "Gemini 3.1 Pro (High)";

// OAuth caveat: ChatGPT-account-auth Codex CLI rejects nano/mini-tier API models.
// JUDGE_PANEL_OPENAI_OAUTH_MODEL takes precedence; default gpt-5.6-sol.
const OPENAI_OAUTH_DEFAULT =
  process.env.JUDGE_PANEL_OPENAI_OAUTH_MODEL ??
  ENV_FILE["JUDGE_PANEL_OPENAI_OAUTH_MODEL"] ??
  "gpt-5.6-sol";
const SMALL_OPENAI = OPENAI_OAUTH_DEFAULT;
const BIG_OPENAI = ENV_FILE["OPENAI_BIG_JUDGE_MODEL"] ?? "gpt-5.4";

const CONFIDENCE_THRESHOLD = parseInt(
  ENV_FILE["JUDGE_PANEL_CONF_THRESHOLD"] ?? "80",
  10,
);
const CALL_TIMEOUT_S = parseInt(ENV_FILE["JUDGE_PANEL_TIMEOUT_S"] ?? "120", 10);
const CALL_TIMEOUT_MS = CALL_TIMEOUT_S * 1000;

const AGY_BIN =
  ENV_FILE["JUDGE_PANEL_AGY_BIN"] ??
  process.env.JUDGE_PANEL_AGY_BIN ??
  "agy";
const CODEX_BIN =
  ENV_FILE["JUDGE_PANEL_CODEX_BIN"] ??
  process.env.JUDGE_PANEL_CODEX_BIN ??
  "codex";

interface PricingEntry {
  in: number;
  out: number;
}
const PRICING: Record<string, PricingEntry> = {
  [FALLBACK_SMALL_GEMINI]: { in: 0.3, out: 2.5 },
  [SMALL_OPENAI]: { in: 0.05, out: 0.4 },
  [BIG_OPENAI]: { in: 1.25, out: 10.0 },
  [FALLBACK_BIG_GEMINI]: { in: 1.25, out: 10.0 },
};

// ─── Rubrics ────────────────────────────────────────────────────────────────

const RUBRICS: Record<string, string> = {
  hallucination: `You are an independent fact-checker. Evaluate the ARTIFACT below for hallucination risk.

Score verdict: pass = well-grounded, no fabrication; fail = specific unsupported claims, fake citations, contradictions; uncertain = mixed signal you cannot resolve without more context.

Evaluate: (1) specificity of claims (2) citation plausibility (3) internal consistency (4) confidence calibration vs domain (5) known fabrication patterns.`,

  flattery: `You are a sycophancy detector. Evaluate the ARTIFACT for performative warmth / flattery.

pass = no flattery markers; fail = HIGH-severity markers present ("Great question", "You're absolutely right", "Most productive session", "Amazing work"); uncertain = ambiguous context where a phrase could be genuine or filler.

List every flattery phrase you detect in \`flags\`.`,

  "spec-coherence": `You are a software architect. Evaluate the ARTIFACT (spec, design doc, PRD) for coherence.

pass = internally consistent, claims match intended implementation, no blast-radius gaps; fail = contradicts itself, claims features not specified, version bumps without migration plan, references a file/module that doesn't exist; uncertain = requires context you lack.

Flag each coherence gap.`,

  "patent-safety": `You are a patent attorney. Evaluate the ARTIFACT for §102 prior-art risk and claim/spec boundary leakage.

pass = no obvious prior-art vulnerability, claim language stays pure technical; fail = unambiguously anticipated by prior art, or spec-interior language (biological/branding) leaks into claim text, or enablement gap; uncertain = needs live literature search to resolve.`,

  "prompt-quality": `You are an expert prompt engineer. Evaluate the ARTIFACT (a user's prompt to an LLM) on effectiveness.

pass = specific, context-rich, reasoning depth requested, intent clear; fail = vague, missing context, ambiguous goal, unclear success criteria; uncertain = mid-tier.`,

  // --- Fish-swarm orchestration rubrics (v3.5.1) -----------------------
  "prompt-sharpen": `You are a prompt-engineering coach. The ARTIFACT is a user prompt that may be vague, missing context, or ambiguous in intent. Rewrite it into a SPECIFIC, context-rich, intent-clear prompt that an LLM can act on without follow-up questions.

verdict = pass (a sharpened version is provided in flags[0]); fail (the original cannot be sharpened without the user's input — explain what's missing in flags); uncertain (the prompt is already specific — say so in flags).

Always: flags[0] MUST contain the sharpened prompt verbatim (or "ALREADY_SHARP" / "NEEDS_USER_INPUT: <what>"). Subsequent flags = brief notes on changes made.`,

  "persona-detect": `You are a domain classifier. The ARTIFACT is a user prompt or task description. Identify the SINGLE highest-fit persona from this roster (from the Constitution): design (Jony Ive), architecture (Jeff Dean), debugging (Linus Torvalds), product (Shreyas Doshi), positioning (Steve Jobs), career (Reid Hoffman), productivity (Tim Ferriss), data (Nate Silver), writing (George Orwell), mindset (Tim Storey), legal (RBG), finance (Buffett), research (Andrew Ng), life-coach (default).

verdict = pass (clear persona match, name in flags[0]); uncertain (multi-domain — list top 2 in flags[0..1] for fusion); fail (no roster persona fits — propose a new one in flags[0]).

flags[0] MUST be the persona slug (e.g., "architecture", "product", "life-coach"). If multi-domain, flags[0..1] = the two top fits.`,

  "calibration-scan": `You are a sycophancy detector running the calibration-auditor pass. The ARTIFACT is text generated by an LLM (a response, draft, summary). Detect flattery, performative warmth, and engagement-maximizing filler.

verdict = pass (no flattery markers); fail (HIGH-severity markers found); uncertain (borderline — phrase could be genuine or filler).

HIGH markers: "Great question", "You're absolutely right", "Excellent point", "Most productive session", "Amazing work", "Perfect", "Fantastic", "Brilliant insight". MEDIUM: "I'd be happy to", "Let me help you with", "Of course". flags = every flagged phrase verbatim, one per entry.`,

  "hallucination-preflight": `You are a risk classifier running BEFORE an LLM generates a response. The ARTIFACT is the user's prompt. Classify the hallucination-risk class the response would carry, so the caller can route grounding accordingly.

verdict = pass (low risk — opinion, creative, internal-state, math from given numbers); fail (HIGH risk — needs grounding before the response is generated); uncertain (mid-tier).

flags[0] MUST be one risk label: FACTUAL (claims about the world), LEGAL (laws, statutes, case names), MEDICAL (drugs, dosages, diagnoses), FINANCIAL (prices, rates, regulations), TEMPORAL (current date, recent events), CITATION (paper/book/quote attribution), or NONE. flags[1] MUST be the recommended grounding action: WEB_SEARCH, PRIMARY_SOURCE, USER_CONFIRMATION, ARXIV_RECENT, PATENT_DB, NONE_NEEDED. Subsequent flags = specific claims that need grounding.`,

  "t0t2-jury": `You are a lightweight jury for T0-T2 stakes artifacts (reversible, low-blast-radius — internal notes, drafts, exploratory output). The ARTIFACT may be code, prose, a plan, or a decision. Decide if it's good-enough-to-ship-internally.

verdict = pass (ship it — meets bar for T0-T2); fail (block — specific defect named in flags[0]); uncertain (could go either way — flags[0] = the deciding question for the human).

flags[0] = ONE-LINE reason (what makes it pass/fail/uncertain). Be terse. T3-T4 artifacts should escalate to the full judge-panel cascade — say so in flags if the artifact's stakes are higher than T2.`,
};

// ─── Persona-driven judges ───────────────────────────────────────────────────
//
// A persona line is prepended to each judge's prompt so the judge channels a
// specific expert lens rather than producing a generic LLM review.
//
// Factual/sycophancy rubrics (hallucination, flattery, patent-safety,
// calibration-scan, hallucination-preflight) intentionally have null defaults
// — these require grounded detection, not stylistic judgment.
//
// The --persona CLI flag (or JUDGE_PANEL_PERSONAS env var) always wins over
// the rubric default.

export const RUBRIC_DEFAULT_PERSONAS: Record<string, string | null> = {
  // Factual / sycophancy rubrics — grounded detection, not stylistic judgment.
  // Expert taste adds noise here; a fabricated citation is wrong regardless of lens.
  hallucination: null,
  flattery: null,
  "patent-safety": null,
  "calibration-scan": null,
  "hallucination-preflight": null,
  "persona-detect": null,
  "t0t2-jury": null,
  custom: null,

  // Design / UX / product rubrics — these demand the minute-details lens of world-class
  // product and design thinkers.  Steve Jobs + Jony Ive together cover product vision
  // (Jobs) and tactile/visual craft (Ive).
  ux: "Steve Jobs + Jony Ive",
  visual: "Steve Jobs + Jony Ive",
  product: "Steve Jobs + Jony Ive",
  "custom-ux": "Steve Jobs + Jony Ive",

  // Architecture / systems rubrics — Jeff Dean's lens catches the O(n²) you missed
  // in the happy-path spec and the distributed-systems traps lurking in the design.
  "spec-coherence": "Jeff Dean",
  architecture: "Jeff Dean",

  // Prompt-engineering rubrics — sharpening/quality is a product-spec act;
  // Doshi's product-quality discipline surfaces vague intent and missing success criteria.
  "prompt-quality": "Shreyas Doshi",
  "prompt-sharpen": "Shreyas Doshi",
};

/**
 * Resolve which persona (if any) to inject into each judge prompt.
 *
 * Priority: cliPersona (--persona flag / JUDGE_PANEL_PERSONAS env) >
 *           rubric default from RUBRIC_DEFAULT_PERSONAS >
 *           null (no injection)
 */
export function resolvePersona(
  rubric: string,
  cliPersona: string | null,
): string | null {
  if (cliPersona && cliPersona.trim()) return cliPersona.trim();
  return RUBRIC_DEFAULT_PERSONAS[rubric] ?? null;
}

export function buildPrompt(rubricText: string, artifact: string, persona?: string | null): string {
  const personaPrefix = persona && persona.trim()
    ? `Judge as ${persona.trim()} — channel the top-0.001% standard in their domain; scrutinize as they would and catch the minute details they would catch.\n\n`
    : "";
  return `${personaPrefix}${rubricText}

ARTIFACT:
\`\`\`
${artifact}
\`\`\`

Return ONLY a single JSON object on one line. No markdown fences. No prose. Exactly this schema:
{"verdict":"pass"|"fail"|"uncertain","confidence":0-100,"flags":["short reason 1","short reason 2"]}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

function newJurorError(
  model: string,
  family: string,
  flags: string[],
  error: string,
  latencyMs = 0,
  raw = "",
  tokensIn = 0,
  tokensOut = 0,
  verdict: Verdict = "error",
): JurorResult {
  return {
    model,
    family,
    verdict,
    confidence: 0,
    flags,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: latencyMs,
    raw_response: raw,
    error,
  };
}

function balancedJsonObjects(raw: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects.sort((a, b) => b.length - a.length);
}

function parseVerdict(
  raw: string,
  model: string,
  family: string,
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
): JurorResult {
  const trimmed = raw.trim();
  const candidates = [trimmed, ...balancedJsonObjects(raw)].filter(
    (candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index,
  );
  if (candidates.length === 0) {
    return newJurorError(
      model,
      family,
      [],
      "no JSON object in response",
      latencyMs,
      raw,
      tokensIn,
      tokensOut,
    );
  }

  let obj: Record<string, unknown> | null = null;
  let lastDecodeError = "unknown JSON parse failure";
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
        break;
      }
      lastDecodeError = "decoded JSON value is not an object";
    } catch (e: unknown) {
      lastDecodeError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!obj) {
    return newJurorError(
      model,
      family,
      [],
      `json decode: ${lastDecodeError}`,
      latencyMs,
      raw,
      tokensIn,
      tokensOut,
    );
  }

  let verdict = String(obj["verdict"] ?? "error").toLowerCase().trim() as Verdict;
  if (!["pass", "fail", "uncertain"].includes(verdict)) {
    verdict = "error";
  }

  let confidence = 0;
  const rawConf = obj["confidence"];
  if (typeof rawConf === "number" && Number.isFinite(rawConf)) {
    confidence = Math.floor(rawConf);
  } else if (typeof rawConf === "string") {
    const parsed = parseInt(rawConf, 10);
    if (!Number.isNaN(parsed)) confidence = parsed;
  }
  confidence = Math.max(0, Math.min(100, confidence));

  let flags: string[];
  const rawFlags = obj["flags"];
  if (Array.isArray(rawFlags)) {
    flags = rawFlags.map((f) => String(f));
  } else if (rawFlags === undefined || rawFlags === null) {
    flags = [];
  } else {
    flags = [String(rawFlags)];
  }

  return {
    model,
    family,
    verdict,
    confidence,
    flags,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: latencyMs,
    raw_response: raw,
    error: null,
  };
}

function cliInstalled(binName: string): boolean {
  // Use Bun's sync spawn with `which`. Returns true if binary on PATH.
  try {
    const proc = Bun.spawnSync(["which", binName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function ensureCli(
  binName: string,
  family: string,
  model: string,
): JurorResult | null {
  if (cliInstalled(binName)) return null;
  return newJurorError(
    model,
    family,
    ["CLI_NOT_INSTALLED"],
    `\`${binName}\` not on PATH — install and authenticate the OAuth CLI. ` +
      "This harness is OAuth-only and has no API fallback.",
  );
}

// ─── CLI runners (OAuth) ────────────────────────────────────────────────────

async function spawnWithTimeout(
  cmd: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  // Filter out undefined env values for Bun's spawn API.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }

  const proc = Bun.spawn(cmd, {
    env: cleanEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }, timeoutMs);

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeoutId);

  return {
    exitCode: exitCode ?? -1,
    stdout: stdoutText,
    stderr: stderrText,
    timedOut,
  };
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface ResolvedModels {
  smallGemini: string;
  bigGemini: string;
}

function oauthOnlyEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/(?:^|_)API_KEY$/i.test(k)) out[k] = v;
  }
  return out;
}

function normalizeCliVersion(label: string, stdout: string): string {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return `${label} unknown`;
  const compact = firstLine.replace(/\s+/g, " ");
  return compact.toLowerCase().startsWith(label.toLowerCase())
    ? compact
    : `${label} ${compact}`;
}

const cliVersionCache = new Map<string, Promise<string>>();

function cliVersion(
  cacheKey: string,
  label: string,
  attempts: string[][],
): Promise<string> {
  const cached = cliVersionCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async (): Promise<string> => {
    if (!cliInstalled(attempts[0][0])) return `${label} unknown`;
    for (const command of attempts) {
      try {
        const result = await spawnWithTimeout(
          command,
          oauthOnlyEnv(),
          Math.min(CALL_TIMEOUT_MS, 5_000),
        );
        if (!result.timedOut && result.exitCode === 0 && result.stdout.trim()) {
          return normalizeCliVersion(label, result.stdout);
        }
      } catch {
        // Try the next version command.
      }
    }
    return `${label} unknown`;
  })();
  cliVersionCache.set(cacheKey, pending);
  return pending;
}

function logLane(family: string, version: string, model: string): void {
  process.stderr.write(`[jury] ${family}: ${version} / ${model}\n`);
}

function compareModelVersions(a: number[], b: number[]): number {
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface GeminiModelCandidate {
  displayName: string;
  version: number[];
  tier: "flash" | "pro";
  effort: string;
}

function parseGeminiModelCandidates(output: string): GeminiModelCandidate[] {
  const candidates: GeminiModelCandidate[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /\b(Gemini\s+([\d.]+)\s+(Flash|Pro)(?:\s+\(([^)]+)\))?)/i,
    );
    if (!match) continue;
    const displayName = match[1].replace(/\s+/g, " ").trim();
    if (candidates.some((candidate) => candidate.displayName === displayName)) {
      continue;
    }
    candidates.push({
      displayName,
      version: match[2].split(".").map((part) => Number(part)),
      tier: match[3].toLowerCase() as "flash" | "pro",
      effort: (match[4] ?? "").trim().toLowerCase(),
    });
  }
  return candidates;
}

function selectLatestGeminiModel(
  candidates: GeminiModelCandidate[],
  tier: "flash" | "pro",
): string | null {
  let pool = candidates.filter((candidate) => candidate.tier === tier);
  if (tier === "pro") {
    const highEffort = pool.filter((candidate) => candidate.effort === "high");
    if (highEffort.length > 0) pool = highEffort;
  }
  if (pool.length === 0) return null;

  pool.sort((a, b) => {
    const versionOrder = compareModelVersions(b.version, a.version);
    if (versionOrder !== 0) return versionOrder;
    if (tier === "flash") {
      return Number(b.effort === "low") - Number(a.effort === "low");
    }
    return Number(b.effort === "high") - Number(a.effort === "high");
  });
  return pool[0].displayName;
}

let resolvedModelsPromise: Promise<ResolvedModels> | null = null;

async function resolveModels(): Promise<ResolvedModels> {
  if (resolvedModelsPromise) return resolvedModelsPromise;
  resolvedModelsPromise = (async (): Promise<ResolvedModels> => {
    let discoveredSmall: string | null = null;
    let discoveredBig: string | null = null;
    if (cliInstalled(AGY_BIN)) {
      try {
        const result = await spawnWithTimeout(
          [AGY_BIN, "models"],
          oauthOnlyEnv(),
          Math.min(CALL_TIMEOUT_MS, 15_000),
        );
        if (!result.timedOut && result.exitCode === 0) {
          const candidates = parseGeminiModelCandidates(result.stdout);
          discoveredSmall = selectLatestGeminiModel(candidates, "flash");
          discoveredBig = selectLatestGeminiModel(candidates, "pro");
        }
      } catch {
        // Discovery is best-effort; stable defaults below keep the jury usable.
      }
    }

    // Discovery WINS (pick the latest live fish); env vars are only a fallback when
    // `agy models` is unavailable — a stale env pin must never beat the discovered latest
    // ("discover the latest," not "honor an old pin"). Fallback constants are the last resort.
    return {
      smallGemini:
        discoveredSmall ??
        process.env.GEMINI_CLI_DEFAULT_MODEL ??
        ENV_FILE["GEMINI_CLI_DEFAULT_MODEL"] ??
        FALLBACK_SMALL_GEMINI,
      bigGemini:
        discoveredBig ??
        process.env.GEMINI_CLI_PREMIUM_MODEL ??
        ENV_FILE["GEMINI_CLI_PREMIUM_MODEL"] ??
        FALLBACK_BIG_GEMINI,
    };
  })();
  return resolvedModelsPromise;
}

const AGY_PROMPT_CHAR_LIMIT = 24_000;

function compactPromptForAgy(prompt: string): string {
  if (prompt.length <= AGY_PROMPT_CHAR_LIMIT) return prompt;

  const artifactMarker = "ARTIFACT:\n```\n";
  const responseMarker =
    "\n```\n\nReturn ONLY a single JSON object on one line.";
  const artifactStart = prompt.indexOf(artifactMarker);
  const responseStart = prompt.lastIndexOf(responseMarker);
  const omission =
    "\n\n[... middle of oversized artifact omitted by jury harness ...]\n\n";

  if (artifactStart >= 0 && responseStart > artifactStart) {
    const contentStart = artifactStart + artifactMarker.length;
    const prefix = prompt.slice(0, contentStart);
    const suffix = prompt.slice(responseStart);
    const artifact = prompt.slice(contentStart, responseStart);
    const artifactBudget = AGY_PROMPT_CHAR_LIMIT - prefix.length - suffix.length - omission.length;
    if (artifactBudget > 1_000) {
      const headLength = Math.ceil(artifactBudget * 0.65);
      const tailLength = artifactBudget - headLength;
      return `${prefix}${artifact.slice(0, headLength)}${omission}${artifact.slice(-tailLength)}${suffix}`;
    }
  }

  const fallbackBudget = AGY_PROMPT_CHAR_LIMIT - omission.length;
  const headLength = Math.ceil(fallbackBudget * 0.65);
  return `${prompt.slice(0, headLength)}${omission}${prompt.slice(-(fallbackBudget - headLength))}`;
}

function highestAllowedReasoningEffort(output: string): string | null {
  const supported = output.match(/Supported values are\s*:?\s*([^\r\n]+)/i);
  if (!supported) return null;
  const segment = supported[1];
  let values = Array.from(
    segment.matchAll(/['"`]([a-z][a-z0-9_-]*)['"`]/gi),
    (match) => match[1].toLowerCase(),
  );
  if (values.length === 0) {
    values = Array.from(
      segment.matchAll(/\b(none|minimal|low|medium|high|xhigh)\b/gi),
      (match) => match[1].toLowerCase(),
    );
  }
  values = [...new Set(values)];
  if (values.length === 0) return null;

  const rank = ["none", "minimal", "low", "medium", "high", "xhigh"];
  return values.sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0];
}

function codexReasoningRetry(result: SpawnResult): string | null {
  if (result.exitCode === 0 || result.timedOut) return null;
  const output = `${result.stderr}\n${result.stdout}`;
  if (!/\b400\b/.test(output) || !/Supported values are/i.test(output)) {
    return null;
  }
  return highestAllowedReasoningEffort(output);
}

async function runGemini(model: string, prompt: string): Promise<JurorResult> {
  const version = await cliVersion("google", "agy", [
    [AGY_BIN, "version"],
    [AGY_BIN, "--version"],
  ]);
  if (!cliInstalled(AGY_BIN)) {
    logLane("google", version, model);
    return ensureCli(AGY_BIN, "google", model) as JurorResult;
  }
  const effectivePrompt = compactPromptForAgy(prompt);
  const start = Date.now();
  const childEnv = oauthOnlyEnv();

  let result: SpawnResult;
  try {
    logLane("google", version, model);
    result = await spawnWithTimeout(
      [
        AGY_BIN,
        "--model",
        model,
        "--dangerously-skip-permissions",
        "--sandbox",
        "--print-timeout",
        `${CALL_TIMEOUT_S}s`,
        "-p",
        effectivePrompt,
      ],
      childEnv,
      CALL_TIMEOUT_MS,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return newJurorError(
      model,
      "google",
      [],
      `agy spawn failed: ${msg}`,
      Date.now() - start,
    );
  }

  const latencyMs = Date.now() - start;
  if (result.timedOut) {
    return newJurorError(
      model,
      "google",
      [],
      `timeout after ${CALL_TIMEOUT_S}s`,
      latencyMs,
      "",
      0,
      0,
      "timeout",
    );
  }
  if (result.exitCode !== 0) {
    const errSnippet = result.stderr.slice(0, 500) || result.stdout.slice(0, 500);
    return newJurorError(
      model,
      "google",
      [],
      `agy exit ${result.exitCode}: ${errSnippet}`,
      latencyMs,
    );
  }

  const raw = result.stdout.trim();
  return parseVerdict(
    raw,
    model,
    "google",
    estimateTokens(effectivePrompt),
    estimateTokens(raw),
    latencyMs,
  );
}

async function runCodex(model: string, prompt: string): Promise<JurorResult> {
  const version = await cliVersion("openai", "codex", [
    [CODEX_BIN, "--version"],
  ]);
  if (!cliInstalled(CODEX_BIN)) {
    logLane("openai", version, model);
    return ensureCli(CODEX_BIN, "openai", model) as JurorResult;
  }
  const start = Date.now();
  const childEnv = oauthOnlyEnv();

  // Create temp file for --output-last-message.
  const tmpDir = mkdtempSync(join(tmpdir(), "judge-panel-codex-"));
  const lastMsgPath = join(tmpDir, "last-message.txt");

  try {
    let result: SpawnResult;
    const codexArgs = (reasoningEffort: string): string[] => [
      CODEX_BIN,
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--output-last-message",
      lastMsgPath,
      "-m",
      model,
      "-c",
      `model_reasoning_effort=${reasoningEffort}`,
      prompt,
    ];
    try {
      logLane("openai", version, model);
      result = await spawnWithTimeout(
        codexArgs("high"),
        childEnv,
        CALL_TIMEOUT_MS,
      );

      const retryEffort = codexReasoningRetry(result);
      if (retryEffort) {
        try {
          unlinkSync(lastMsgPath);
        } catch {
          // The failed run may not have created the output file.
        }
        result = await spawnWithTimeout(
          codexArgs(retryEffort),
          childEnv,
          CALL_TIMEOUT_MS,
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return newJurorError(
        model,
        "openai",
        [],
        `codex spawn failed: ${msg}`,
        Date.now() - start,
      );
    }

    const latencyMs = Date.now() - start;
    if (result.timedOut) {
      return newJurorError(
        model,
        "openai",
        [],
        `timeout after ${CALL_TIMEOUT_S}s`,
        latencyMs,
        "",
        0,
        0,
        "timeout",
      );
    }
    if (result.exitCode !== 0) {
      const errSnippet =
        result.stderr.slice(0, 500) || result.stdout.slice(0, 500);
      return newJurorError(
        model,
        "openai",
        [],
        `codex exit ${result.exitCode}: ${errSnippet}`,
        latencyMs,
      );
    }

    let raw = "";
    try {
      raw = readFileSync(lastMsgPath, "utf-8").trim();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return newJurorError(
        model,
        "openai",
        [],
        `codex last-message read failed: ${msg}`,
        latencyMs,
      );
    }
    if (!raw) {
      // Fallback: scan stdout for a JSON object as a last resort.
      raw = result.stdout.trim();
    }

    return parseVerdict(
      raw,
      model,
      "openai",
      estimateTokens(prompt),
      estimateTokens(raw),
      latencyMs,
    );
  } finally {
    try {
      unlinkSync(lastMsgPath);
    } catch {
      // ignore
    }
    try {
      // Remove the temp dir as well.
      const { rmdirSync } = require("fs") as typeof import("fs");
      rmdirSync(tmpDir);
    } catch {
      // ignore
    }
  }
}

// ─── Cascade orchestration ──────────────────────────────────────────────────

interface AggregateResult {
  agreement: string;
  confidenceTier: string;
  escalate: boolean;
}

function aggregate(small: JurorResult[]): AggregateResult {
  const verdicts = small
    .filter((j) => ["pass", "fail", "uncertain"].includes(j.verdict))
    .map((j) => j.verdict);

  if (verdicts.length < 2) {
    return { agreement: "insufficient", confidenceTier: "n/a", escalate: true };
  }
  if (verdicts.some((v) => v === "uncertain")) {
    return { agreement: "disagree", confidenceTier: "n/a", escalate: true };
  }
  const unique = new Set(verdicts);
  if (unique.size === 1) {
    const confs = small
      .filter((j) => j.verdict === "pass" || j.verdict === "fail")
      .map((j) => j.confidence);
    const tier = confs.every((c) => c >= CONFIDENCE_THRESHOLD) ? "high" : "low";
    return {
      agreement: "agree",
      confidenceTier: tier,
      escalate: tier === "low",
    };
  }
  return { agreement: "disagree", confidenceTier: "n/a", escalate: true };
}

async function runSmallPanel(
  prompt: string,
  smallGeminiModel: string,
): Promise<JurorResult[]> {
  return Promise.all([
    runGemini(smallGeminiModel, prompt),
    runCodex(SMALL_OPENAI, prompt),
  ]);
}

async function runTiebreaker(
  prompt: string,
  tiebreakerModel: string,
): Promise<JurorResult> {
  if (tiebreakerModel.toLowerCase().startsWith("gemini")) {
    return runGemini(tiebreakerModel, prompt);
  }
  return runCodex(tiebreakerModel, prompt);
}

function estimateCost(jurors: JurorResult[]): number {
  let total = 0.0;
  for (const j of jurors) {
    const p =
      PRICING[j.model] ??
      (j.model.toLowerCase().includes("gemini")
        ? j.model.toLowerCase().includes("flash")
          ? { in: 0.3, out: 2.5 }
          : { in: 1.25, out: 10.0 }
        : undefined);
    if (!p) continue;
    total += (j.tokens_in / 1_000_000) * p.in;
    total += (j.tokens_out / 1_000_000) * p.out;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

async function runCascade(
  rubricSlug: string,
  artifact: string,
  rubricText: string | null,
  tiebreaker: string | null,
  cliPersona: string | null = null,
): Promise<CascadeResult> {
  const models = await resolveModels();
  // Default tiebreaker: latest discovered Gemini Pro (High), cross-family and
  // cross-tier versus the small-fish panel. Explicit CLI/env choices still win.
  const tb =
    tiebreaker ??
    process.env.JUDGE_PANEL_DEFAULT_TIEBREAKER ??
    ENV_FILE["JUDGE_PANEL_DEFAULT_TIEBREAKER"] ??
    models.bigGemini;
  let template: string;
  if (rubricSlug === "custom") {
    if (!rubricText) {
      throw new Error("rubric=custom requires --rubric-text");
    }
    template = rubricText;
  } else {
    const t = RUBRICS[rubricSlug];
    if (!t) throw new Error(`unknown rubric: ${rubricSlug}`);
    template = t;
  }

  const effectivePersona = resolvePersona(rubricSlug, cliPersona);
  const prompt = buildPrompt(template, artifact, effectivePersona);

  // Stage 1 — small-fish panel
  const small = await runSmallPanel(prompt, models.smallGemini);
  const { agreement, confidenceTier, escalate } = aggregate(small);

  // Stage 2 — tiebreaker (only if needed)
  let big: JurorResult | null = null;
  if (escalate) {
    big = await runTiebreaker(prompt, tb);
  }

  // Final verdict
  let finalVerdict: Verdict;
  let finalConfidence: number;
  if (!escalate) {
    finalVerdict = small[0].verdict;
    const confs = small
      .filter((j) => j.verdict === "pass" || j.verdict === "fail")
      .map((j) => j.confidence);
    finalConfidence =
      confs.length > 0
        ? Math.floor(confs.reduce((a, b) => a + b, 0) / confs.length)
        : 0;
  } else if (big && (big.verdict === "pass" || big.verdict === "fail")) {
    finalVerdict = big.verdict;
    const aligned = small
      .filter((j) => j.verdict === big!.verdict)
      .map((j) => j.confidence);
    if (aligned.length > 0) {
      const avgAligned = aligned.reduce((a, b) => a + b, 0) / aligned.length;
      finalConfidence = Math.floor((big.confidence + avgAligned) / 2);
    } else {
      finalConfidence = big.confidence;
    }
  } else if (big && big.verdict === "uncertain") {
    finalVerdict = "uncertain";
    finalConfidence = big.confidence;
  } else {
    finalVerdict = "error";
    finalConfidence = 0;
  }

  // Collect flags (dedup while preserving order)
  const allFlags: string[] = [];
  const jurorsForFlags = big ? [...small, big] : [...small];
  for (const j of jurorsForFlags) {
    for (const f of j.flags) {
      if (!allFlags.includes(f)) allFlags.push(f);
    }
  }

  // Cost estimate vs naive parallel jury (3× big-fish run on same artifact)
  const jurorsFired = big ? [...small, big] : [...small];
  const costActual = estimateCost(jurorsFired);
  const naiveTokensIn = estimateTokens(prompt);
  const naiveTokensOut = 64;
  const bigPrice = PRICING[BIG_OPENAI] ?? { in: 1.25, out: 10.0 };
  const costNaive =
    3 *
    ((naiveTokensIn / 1_000_000) * bigPrice.in +
      (naiveTokensOut / 1_000_000) * bigPrice.out);
  const ratio =
    costNaive > 0 ? Math.round((costActual / costNaive) * 10000) / 10000 : null;

  return {
    version: VERSION,
    rubric: rubricSlug,
    persona: effectivePersona,
    cascade: {
      stage_1_small_fish: small,
      agreement,
      confidence_tier: confidenceTier,
      escalated: escalate,
      stage_2_tiebreaker: big,
    },
    final_verdict: finalVerdict,
    final_confidence: finalConfidence,
    all_flags: allFlags,
    cost_usd_estimate: costActual,
    cost_vs_naive_parallel_jury_ratio: ratio,
  };
}

// ─── CLI argument parsing ───────────────────────────────────────────────────

function printUsageError(msg: string): never {
  process.stderr.write(
    `judge_panel.ts: ${msg}\n\n` +
      "Usage: bun run judge_panel.ts --rubric <slug> (--artifact <text> | --artifact-file <path>)\n" +
      "                                  [--rubric-text <text>] [--tiebreaker <model>]\n" +
      "                                  [--persona <name(s)>]\n" +
      "                                  [--silent]\n" +
      "\n" +
      "  --persona        Inject a persona lens into every judge prompt.\n" +
      "                   E.g.: --persona \"Steve Jobs + Jony Ive\"\n" +
      "                   Also readable from env: JUDGE_PANEL_PERSONAS\n" +
      "                   Overrides any rubric default from RUBRIC_DEFAULT_PERSONAS.\n" +
      "                   Built-in defaults by rubric:\n" +
      "                     spec-coherence   → Jeff Dean\n" +
      "                     prompt-quality   → Shreyas Doshi\n" +
      "                     prompt-sharpen   → Shreyas Doshi\n" +
      "                     hallucination / flattery / patent-safety → none\n",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    rubric: "",
    rubricText: null,
    artifact: null,
    artifactFile: null,
    tiebreaker: null,
    // Seed from env first; CLI flag (parsed below) wins over it.
    persona: process.env["JUDGE_PANEL_PERSONAS"] ?? null,
    silent: false,
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    const needsValue = (name: string): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        printUsageError(`${name} requires a value`);
      }
      i += 2;
      return v;
    };

    if (a === "--rubric") {
      args.rubric = needsValue("--rubric");
    } else if (a === "--persona") {
      args.persona = needsValue("--persona");
    } else if (a === "--rubric-text") {
      args.rubricText = needsValue("--rubric-text");
    } else if (a === "--artifact") {
      args.artifact = needsValue("--artifact");
    } else if (a === "--artifact-file") {
      args.artifactFile = needsValue("--artifact-file");
    } else if (a === "--tiebreaker") {
      args.tiebreaker = needsValue("--tiebreaker");
    } else if (a === "--silent") {
      args.silent = true;
      i += 1;
    } else if (a === "-h" || a === "--help") {
      printUsageError("help");
    } else {
      printUsageError(`unknown argument: ${a}`);
    }
  }

  if (!args.rubric) {
    printUsageError("--rubric is required");
  }
  const allowedRubrics = [...Object.keys(RUBRICS), "custom"];
  if (!allowedRubrics.includes(args.rubric)) {
    printUsageError(
      `--rubric must be one of: ${allowedRubrics.join(", ")} (got '${args.rubric}')`,
    );
  }
  if (
    (args.artifact === null && args.artifactFile === null) ||
    (args.artifact !== null && args.artifactFile !== null)
  ) {
    printUsageError("exactly one of --artifact or --artifact-file is required");
  }

  return args;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  let artifact = args.artifact;
  if (args.artifactFile) {
    try {
      artifact = readFileSync(args.artifactFile, "utf-8");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        JSON.stringify({
          version: VERSION,
          error: `failed to read --artifact-file: ${msg}`,
        }) + "\n",
      );
      return 2;
    }
  }
  if (artifact === null) {
    // Should be unreachable due to parseArgs validation.
    process.stderr.write(
      JSON.stringify({ version: VERSION, error: "no artifact provided" }) + "\n",
    );
    return 2;
  }

  let result: CascadeResult;
  try {
    result = await runCascade(
      args.rubric,
      artifact,
      args.rubricText,
      args.tiebreaker,
      args.persona,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      JSON.stringify({ version: VERSION, error: msg }) + "\n",
    );
    return 2;
  }

  if (args.silent) {
    for (const j of result.cascade.stage_1_small_fish) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (j as any).raw_response;
    }
    if (result.cascade.stage_2_tiebreaker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (result.cascade.stage_2_tiebreaker as any).raw_response;
    }
  }

  const json = args.silent
    ? JSON.stringify(result)
    : JSON.stringify(result, null, 2);
  process.stdout.write(json + "\n");
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        JSON.stringify({ version: VERSION, error: `uncaught: ${msg}` }) + "\n",
      );
      process.exit(2);
    });
}
