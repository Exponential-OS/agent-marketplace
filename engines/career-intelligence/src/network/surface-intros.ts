import { warmPathsToCompany } from "./warm-path-query";
import type {
  StrengthLabel,
  WarmPath,
  WarmPathEvent,
  WarmPathEventSink,
  WarmPathQueryResult,
} from "./warm-path-graph";

const DEFAULT_TOP_N = 3;
const INTRO_STRENGTH_POINTS: Record<StrengthLabel, number> = {
  very_strong: 95,
  strong: 80,
  moderate: 55,
  weak: 25,
};

export interface TrackedRoleIntroContext {
  tracker_id?: string;
  company: string;
  role?: string;
}

export interface SurfaceIntroOptions {
  topN?: number;
  eventSink?: WarmPathEventSink;
  peopleDir?: string;
}

export interface SurfacedIntroPath extends WarmPath {
  ask_candidate: boolean;
}

export interface SurfacedIntroRecord {
  target_company: string;
  role?: string;
  tracker_id?: string;
  paths: SurfacedIntroPath[];
  path_count: number;
  warm_path_display: string;
}

export interface IntroStrengthScore {
  /** Total surfaced paths. Scoring and warm-intro badge counts use confirmed_count only. */
  path_count: number;
  confirmed_count: number;
  ask_candidate_count: number;
  score: number;
  strength_label: StrengthLabel | "cold";
  badge: string;
}

export interface IntroOpportunitySurfacedEvent extends WarmPathEvent {
  type: "intro_opportunity_surfaced";
  ts: string;
  target_company: string;
  role?: string;
  tracker_id?: string;
  path_count: number;
  top_strength_label?: StrengthLabel;
  surfaced_in: "pipeline-view";
  sink: "local";
}

export function surfaceIntroOpportunitiesForTrackedRole(
  ctx: TrackedRoleIntroContext,
  opts: SurfaceIntroOptions = {},
): SurfacedIntroRecord {
  const result: WarmPathQueryResult = warmPathsToCompany(ctx.company, {
    eventSink: opts.eventSink,
    peopleDir: opts.peopleDir,
  });
  const paths = result.paths
    .slice(0, normalizeTopN(opts.topN))
    .map((path): SurfacedIntroPath => ({
      ...path,
      ask_candidate: isAskCandidatePath(path),
    }));

  const record: SurfacedIntroRecord = {
    target_company: result.target_company,
    ...(ctx.role ? { role: ctx.role } : {}),
    ...(ctx.tracker_id ? { tracker_id: ctx.tracker_id } : {}),
    paths,
    path_count: paths.length,
    warm_path_display: warmPathDisplay(paths),
  };

  if (opts.eventSink && record.path_count > 0) {
    const event: IntroOpportunitySurfacedEvent = {
      type: "intro_opportunity_surfaced",
      ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      target_company: record.target_company,
      ...(record.role ? { role: record.role } : {}),
      ...(record.tracker_id ? { tracker_id: record.tracker_id } : {}),
      path_count: record.path_count,
      surfaced_in: "pipeline-view",
      sink: "local",
    };
    const topPath = record.paths[0];
    if (topPath) event.top_strength_label = topPath.strength_label;
    safeEmit(opts.eventSink, event);
  }

  return record;
}

export function scoreIntroStrength(paths: readonly WarmPath[]): IntroStrengthScore {
  const path_count = paths.length;
  const confirmedPaths = paths.filter((path) => !isAskCandidatePath(path));
  const confirmed_count = confirmedPaths.length;
  const ask_candidate_count = path_count - confirmed_count;

  if (path_count === 0) {
    return {
      path_count,
      confirmed_count,
      ask_candidate_count,
      score: 0,
      strength_label: "cold",
      badge: "Cold",
    };
  }

  if (confirmed_count === 0) {
    return {
      path_count,
      confirmed_count,
      ask_candidate_count,
      score: 0,
      strength_label: "cold",
      badge: askCandidateBadge(ask_candidate_count),
    };
  }

  const topPath = confirmedPaths[0];
  const topLabelPoints = topPath ? INTRO_STRENGTH_POINTS[topPath.strength_label] : 0;
  const supportBonus = Math.min(10, Math.max(0, confirmed_count - 1) * 5);
  const score = Math.min(100, topLabelPoints + supportBonus);
  const label = introStrengthLabelForScore(score);
  const warmIntroText = `${confirmed_count} warm ${confirmed_count === 1 ? "intro" : "intros"}`;
  const askCandidateSuffix = ask_candidate_count > 0 ? ` · +${askCandidateBadge(ask_candidate_count)}` : "";

  return {
    path_count,
    confirmed_count,
    ask_candidate_count,
    score,
    strength_label: label.strength_label,
    badge: `${warmIntroText} · ${label.display}${askCandidateSuffix}`,
  };
}

function normalizeTopN(topN: number | undefined): number {
  if (topN === undefined) return DEFAULT_TOP_N;
  if (!Number.isFinite(topN)) return DEFAULT_TOP_N;
  return Math.max(0, Math.floor(topN));
}

function warmPathDisplay(paths: SurfacedIntroPath[]): string {
  const introStrength = scoreIntroStrength(paths);
  if (introStrength.path_count === 0) return introStrength.badge;

  const pathLabels = paths.map((path) => {
    const name = path.intermediary?.name ?? path.target_person.name;
    const label = isAskCandidatePath(path) ? "ask candidate" : displayStrength(path.strength_label);
    return `via ${name} (${label})`;
  });

  return `${introStrength.badge}\n${pathLabels.join(" · ")}`;
}

function isAskCandidatePath(path: WarmPath): boolean {
  return path.evidence.some((item) => item.startsWith("ask candidate:"));
}

function askCandidateBadge(count: number): string {
  return `${count} ask-candidate${count === 1 ? "" : "s"}`;
}

function displayStrength(strength: StrengthLabel): string {
  return strength.replace(/_/g, " ");
}

function introStrengthLabelForScore(score: number): { strength_label: StrengthLabel | "cold"; display: string } {
  if (score >= 90) return { strength_label: "very_strong", display: "Very Strong" };
  if (score >= 70) return { strength_label: "strong", display: "Strong" };
  if (score >= 45) return { strength_label: "moderate", display: "Moderate" };
  if (score > 0) return { strength_label: "weak", display: "Weak" };
  return { strength_label: "cold", display: "Cold" };
}

function safeEmit(eventSink: WarmPathEventSink, event: IntroOpportunitySurfacedEvent): void {
  try {
    eventSink(event);
  } catch {
    // Surface results should not depend on local telemetry plumbing.
  }
}
