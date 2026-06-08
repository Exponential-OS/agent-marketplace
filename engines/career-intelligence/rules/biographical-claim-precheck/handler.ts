#!/usr/bin/env bun
// handler.ts — biographical-claim-precheck enforcement (TypeScript+Bun replacement for HOW.py)
// Fires before any draft destined for a real human: grep for tenure/role/scale/date_range claims
// and verify each one has an anchor in the named canonical source(s).

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const SLUG = "biographical-claim-precheck";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

const CAREER_HOME =
  process.env.CAREER_HOME ??
  process.env.CAREER_OS_HOME ??
  null;

const DEFAULT_CANONICAL = CAREER_HOME
  ? join(CAREER_HOME, "brain", "identity", "experience-history.md")
  : null;

// Claim patterns — heuristic, high-recall
const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  {
    kind: "tenure",
    re: /\b\d+(?:\.\d+)?\s*(?:yr|yrs|year|years|mo|month|months)\b/i,
  },
  {
    kind: "report_count",
    re: /\b\d+\s*(?:report|reports|engineer|engineers|direct|direct[\.\-]report|eng[^a-z])/i,
  },
  {
    kind: "scale",
    re: /\$\d+(?:\.\d+)?\s*[BKMbkm]\b/,
  },
  {
    // bare scale/throughput without $ — "50M events", "1M TPS", "180k", "3x".
    // The JD-bleed / inflation surface (XOS-34).
    kind: "metric_scale",
    re: /\b\d+(?:\.\d+)?\s*(?:[KMB]\b|TPS|[Xx]\b|\/(?:sec|day|year|yr|mo|month))/i,
  },
  {
    // percentages — "40% cost reduction", "60% overhead", "45% MTTR".
    kind: "percentage",
    re: /\b\d+(?:\.\d+)?\s*%/,
  },
  {
    // "N+" count boasts with no unit/$/% — "400+ corridors", "10M+ shipments".
    kind: "plus_count",
    re: /\b\d+(?:\.\d+)?[KMBkmb]?\+/,
  },
  {
    kind: "date_range",
    re: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—to]+\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\d{4}/i,
  },
  {
    kind: "role_title",
    re: /\b(?:L\d+|Senior|Sr\.|Director|Head of|VP|Chief|Lead|Principal|Manager|SDM|Engineering Manager|SEM)\b.{0,80}\b(?:at|@)\s+[A-Z][A-Za-z]+/,
  },
];

// Numeric-claim tokenizer (mirrors HOW.py). Each quantity normalizes to a comparable
// token (value, or value+unit): "1M"/"1,000,000" → "1000000"; "2.3k"/"2,300" → "2300";
// "$2B" → "2000000000"; "40%"/"5x" keep their unit. Lookbehind skips identifiers glued
// to a letter ("P99","H100","EC2") and never splits a multi-digit number; the unit must
// be glued and not begin a following word (so "7 months" is 7, not 7,000,000).
const SCAN_RE = /(?<![A-Za-z0-9.])(\d[\d,]*(?:\.\d+)?)(%|TPS|[KMB]|[Xx])?(?![A-Za-z])/gi;
const UNIT_MULT: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
// Approximate career-totals ("10+ years") — derived from grounded dates, not a fabricated
// metric; strip before anchoring so honest summaries don't block. Precise "15 years" stays strict.
const APPROX_TENURE_RE = /\b\d+(?:\.\d+)?\+\s*(?:years?|yrs?)\b/gi;
const CAP_WORD_RE = /\b[A-Z][A-Za-z]{2,}\b/g;

function numericTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(SCAN_RE)) {
    const num = m[1].replace(/,/g, "");
    const unit = (m[2] ?? "").toLowerCase();
    const v = parseFloat(num);
    if (Number.isNaN(v)) continue;
    if (unit in UNIT_MULT) {
      const val = v * UNIT_MULT[unit];
      out.add(Number.isInteger(val) ? String(val) : String(val));
    } else if (unit === "%" || unit === "x") {
      out.add((Number.isInteger(v) ? String(v) : String(v)) + unit);
    } else {
      out.add(Number.isInteger(v) ? String(v) : String(v));
    }
  }
  return out;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

interface ClaimItem {
  text: string;
  pattern: string;
  line: number;
}

interface Input {
  draft_path?: string;
  canonical_sources?: string[];
  stakes?: string;
}

interface Output {
  verdict: string;
  tier: string;
  draft_path?: string;
  canonical_sources?: string[];
  claims_total: number;
  claims_anchored: number;
  claims_unanchored: ClaimItem[];
  next_action?: string;
  reason?: string;
  missing?: string[];
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  try {
    appendFileSync(LOG_PATH, JSON.stringify({ ts, rule_slug: SLUG, ...extra }) + "\n");
  } catch { /* fail-open */ }
}

function emit(output: Output, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

function expandUser(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function extractClaims(text: string): Array<{ kind: string; line: number; phrase: string }> {
  const out: Array<{ kind: string; line: number; phrase: string }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { kind, re } of PATTERNS) {
      if (re.test(lines[i])) {
        out.push({ kind, line: i + 1, phrase: lines[i] });
      }
    }
  }
  return out;
}

// 1 = anchored, 0 = unanchored, 2 = no distinctive tokens (WARN-equivalent).
// A numeric claim anchors iff EVERY numeric token in it is in the canonical token set
// (one ungrounded number = fabrication risk — XOS-34). Non-numeric claims anchor on
// the first capitalized token.
function isAnchored(phrase: string, canonicalTokens: Set<string>, canonicalTexts: string[]): number {
  const scrubbed = phrase.replace(APPROX_TENURE_RE, " ");
  const tokens = numericTokens(scrubbed);
  const words = [...scrubbed.matchAll(CAP_WORD_RE)].map(m => m[0]).slice(0, 3);

  if (tokens.size === 0 && words.length === 0) return 2;
  if (tokens.size > 0) return isSubset(tokens, canonicalTokens) ? 1 : 0;

  const firstWord = words[0];
  for (const canon of canonicalTexts) {
    if (new RegExp(`\\b${firstWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(canon)) return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({
      verdict: "BLOCK",
      tier: "T4",
      claims_total: 0,
      claims_anchored: 0,
      claims_unanchored: [],
      reason: "Usage: handler.ts '<json>'",
    }, 1);
  }

  let ctx: Input;
  try { ctx = JSON.parse(raw); }
  catch (e: unknown) {
    emit({
      verdict: "BLOCK",
      tier: "T4",
      claims_total: 0,
      claims_anchored: 0,
      claims_unanchored: [],
      reason: `Invalid JSON input: ${e instanceof Error ? e.message : String(e)}`,
    }, 1);
  }

  const stakes = ctx!.stakes ?? "T4";
  const draftPathRaw = ctx!.draft_path ?? "";

  if (!draftPathRaw) {
    emit({
      verdict: "BLOCK",
      tier: stakes,
      claims_total: 0,
      claims_anchored: 0,
      claims_unanchored: [],
      reason: "no draft_path provided",
    }, 1);
  }

  const draftPath = resolve(expandUser(draftPathRaw));
  if (!existsSync(draftPath)) {
    emit({
      verdict: "BLOCK",
      tier: stakes,
      claims_total: 0,
      claims_anchored: 0,
      claims_unanchored: [],
      reason: `draft_path not found: ${draftPath}`,
    }, 1);
  }

  const canonicalSourcesRaw = ctx!.canonical_sources ?? [];
  const canonicalPaths = canonicalSourcesRaw.length > 0
    ? canonicalSourcesRaw.map(p => resolve(expandUser(p)))
    : [DEFAULT_CANONICAL];

  const missing = canonicalPaths.filter(p => !existsSync(p));
  if (missing.length > 0) {
    emit({
      verdict: "BLOCK",
      tier: stakes,
      claims_total: 0,
      claims_anchored: 0,
      claims_unanchored: [],
      reason: "canonical source(s) missing",
      missing,
    }, 1);
  }

  let draftText: string;
  try { draftText = readFileSync(draftPath, "utf-8"); }
  catch (e: unknown) {
    emit({
      verdict: "BLOCK",
      tier: stakes,
      claims_total: 0,
      claims_anchored: 0,
      claims_unanchored: [],
      reason: `cannot read draft: ${e instanceof Error ? e.message : String(e)}`,
    }, 1);
  }

  const canonicalTexts = canonicalPaths.map(p => {
    try { return readFileSync(p, "utf-8"); } catch { return ""; }
  });
  const canonicalTokens = new Set<string>();
  for (const ct of canonicalTexts) for (const t of numericTokens(ct)) canonicalTokens.add(t);

  const claims = extractClaims(draftText!);
  const claimsTotal = claims.length;
  let claimsAnchored = 0;
  const unanchored: ClaimItem[] = [];

  for (const { kind, line, phrase } of claims) {
    const anchored = isAnchored(phrase, canonicalTokens, canonicalTexts);
    if (anchored === 1) {
      claimsAnchored++;
    } else {
      const safePhrase = phrase.replace(/[\\\"\t]/g, "").slice(0, 200);
      unanchored.push({ text: safePhrase, pattern: kind, line });
    }
  }

  const unanchoredCount = claimsTotal - claimsAnchored;

  if (claimsTotal === 0 || unanchoredCount === 0) {
    emit({
      verdict: "PASS",
      tier: stakes,
      draft_path: draftPath,
      canonical_sources: canonicalPaths,
      claims_total: claimsTotal,
      claims_anchored: claimsAnchored,
      claims_unanchored: [],
      next_action: "ship",
    }, 0);
  } else {
    emit({
      verdict: "BLOCK",
      tier: stakes,
      draft_path: draftPath,
      canonical_sources: canonicalPaths,
      claims_total: claimsTotal,
      claims_anchored: claimsAnchored,
      claims_unanchored: unanchored,
      next_action: "abort-and-recheck-canonical",
    }, 1);
  }
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    verdict: "BLOCK",
    tier: "T4",
    claims_total: 0,
    claims_anchored: 0,
    claims_unanchored: [],
    reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
  }) + "\n");
  process.exit(1);
});
