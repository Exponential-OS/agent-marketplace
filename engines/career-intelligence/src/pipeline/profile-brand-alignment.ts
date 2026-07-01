import { readFileSync } from "fs";
import { emitEvent, ts, type EmitEventOptions, type EmitEventResult, type TelemetryEvent } from "../telemetry/events";

export const PROFILE_BRAND_ALIGNMENT_SCORED_EVENT = "profile_brand_alignment_scored";

export type ProfileAlignmentSection = "headline" | "summary" | "experience" | string;

export interface SectionScore {
  section: ProfileAlignmentSection;
  score: number;
  gaps: string[];
  weight?: number;
}

export interface NormalizedSectionScore {
  section: string;
  score: number;
  gaps: string[];
  weight: number;
}

export interface RankedAlignmentGap {
  section: string;
  gap: string;
  severity: number;
}

export type AlignmentStatus = "ok" | "insufficient_data";

export interface AlignmentResult {
  overall: number;
  status: AlignmentStatus;
  bySection: NormalizedSectionScore[];
  rankedGaps: RankedAlignmentGap[];
}

export interface AggregateAlignmentOptions {
  weights?: Record<string, number>;
  defaultWeight?: number;
}

export type AlignmentScoreBucket = "0-24" | "25-49" | "50-74" | "75-100";

export interface ProfileBrandAlignmentScoredEvent extends TelemetryEvent {
  event: typeof PROFILE_BRAND_ALIGNMENT_SCORED_EVENT;
  overall_score_bucket: AlignmentScoreBucket;
  section_count: number;
  gap_count: number;
  ts: string;
}

export interface ProfileBrandAlignmentTelemetryOptions extends EmitEventOptions {
  now?: Date;
}

export const DEFAULT_SECTION_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  headline: 4,
  summary: 3,
  experience: 2,
});

const DEFAULT_OTHER_SECTION_WEIGHT = 1;

export function aggregateAlignment(
  sectionScores: readonly unknown[] | null | undefined,
  opts: AggregateAlignmentOptions = {},
): AlignmentResult {
  const bySection = (sectionScores ?? [])
    .map((score) => normalizeSectionScore(score, opts))
    .filter((score): score is NormalizedSectionScore => score !== undefined);

  if (bySection.length === 0) {
    return {
      overall: 0,
      status: "insufficient_data",
      bySection: [],
      rankedGaps: [],
    };
  }

  const totalWeight = bySection.reduce((sum, score) => sum + score.weight, 0);
  const weightedScore = bySection.reduce((sum, score) => sum + score.score * score.weight, 0) / totalWeight;
  const rankedGaps = rankGaps(bySection);

  return {
    overall: roundScore(clampScore(weightedScore)),
    status: "ok",
    bySection,
    rankedGaps,
  };
}

export function formatAlignmentReport(result: AlignmentResult): string {
  const lines = [
    `Profile brand alignment score: ${result.overall}/100`,
    `Status: ${result.status === "ok" ? `scored ${result.bySection.length} section(s)` : "insufficient data"}`,
    "",
    "Section scores:",
  ];

  if (result.bySection.length === 0) {
    lines.push("- No valid profile sections scored.");
  } else {
    for (const score of result.bySection) {
      lines.push(`- ${score.section}: ${score.score}/100 (weight ${formatWeight(score.weight)})`);
    }
  }

  lines.push("", "Prioritized fixes:");
  if (result.rankedGaps.length === 0) {
    lines.push(result.status === "ok"
      ? "- No profile-brand gaps flagged."
      : "- No gaps ranked because no valid section scores were provided.");
  } else {
    result.rankedGaps.forEach((gap, index) => {
      lines.push(`${index + 1}. ${gap.section}: ${gap.gap} (severity ${gap.severity})`);
    });
  }

  return lines.map(sanitizeReportLine).join("\n");
}

export function buildProfileBrandAlignmentScoredEvent(
  result: AlignmentResult,
  now: Date = new Date(),
): ProfileBrandAlignmentScoredEvent {
  return {
    event: PROFILE_BRAND_ALIGNMENT_SCORED_EVENT,
    overall_score_bucket: scoreBucket(result.overall),
    section_count: result.bySection.length,
    gap_count: result.rankedGaps.length,
    ts: ts(now),
  };
}

export function emitProfileBrandAlignmentScored(
  result: AlignmentResult,
  options: ProfileBrandAlignmentTelemetryOptions = {},
): EmitEventResult<ProfileBrandAlignmentScoredEvent> {
  const event = buildProfileBrandAlignmentScoredEvent(result, options.now);
  return emitEvent(event, options);
}

export function scoreBucket(score: number): AlignmentScoreBucket {
  const normalized = clampScore(score);
  if (normalized < 25) return "0-24";
  if (normalized < 50) return "25-49";
  if (normalized < 75) return "50-74";
  return "75-100";
}

function normalizeSectionScore(
  raw: unknown,
  opts: AggregateAlignmentOptions,
): NormalizedSectionScore | undefined {
  if (!isRecord(raw)) return undefined;

  const section = normalizeSectionName(raw.section);
  if (!section) return undefined;

  if (typeof raw.score !== "number" || !Number.isFinite(raw.score)) return undefined;

  return {
    section,
    score: roundScore(clampScore(raw.score)),
    gaps: normalizeGaps(raw.gaps),
    weight: sectionWeight(section, raw.weight, opts),
  };
}

function rankGaps(bySection: readonly NormalizedSectionScore[]): RankedAlignmentGap[] {
  const gaps: RankedAlignmentGap[] = [];

  for (const sectionScore of bySection) {
    const severity = roundScore((100 - sectionScore.score) * sectionScore.weight);
    for (const gap of sectionScore.gaps) {
      gaps.push({
        section: sectionScore.section,
        gap,
        severity,
      });
    }
  }

  return gaps.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.gap.localeCompare(b.gap);
  });
}

function normalizeGaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((gap) => (typeof gap === "string" ? gap.trim() : ""))
    .filter(Boolean);
}

function sectionWeight(
  section: string,
  rawWeight: unknown,
  opts: AggregateAlignmentOptions,
): number {
  const explicit = finitePositiveNumber(rawWeight);
  if (explicit !== undefined) return explicit;

  const configured = finitePositiveNumber(opts.weights?.[section]);
  if (configured !== undefined) return configured;

  return DEFAULT_SECTION_WEIGHTS[section] ?? finitePositiveNumber(opts.defaultWeight) ?? DEFAULT_OTHER_SECTION_WEIGHT;
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeSectionName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

function roundScore(score: number): number {
  return Math.round(score);
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function sanitizeReportLine(line: string): string {
  return line.replace(/\|/g, "/").replace(/\s+/g, " ").trimEnd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCliArgs(argv: string[]): { scoresPath?: string } {
  const args: { scoresPath?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--scores") {
      args.scoresPath = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.scoresPath) {
    console.error("usage: bun src/pipeline/profile-brand-alignment.ts --scores <section-scores.json>");
    process.exit(2);
  }

  let scores: unknown = [];
  try {
    scores = JSON.parse(readFileSync(args.scoresPath, "utf-8")) as unknown;
  } catch {
    scores = [];
  }

  const result = aggregateAlignment(Array.isArray(scores) ? scores : []);
  console.log(formatAlignmentReport(result));
  emitProfileBrandAlignmentScored(result);
}
