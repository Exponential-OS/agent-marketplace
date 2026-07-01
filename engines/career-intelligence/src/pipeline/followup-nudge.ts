import { readFileSync } from "fs";
import { emitEvent, ts, type EmitEventOptions, type EmitEventResult, type TelemetryEvent } from "../telemetry/events";

export const FOLLOWUP_NUDGE_SURFACED_EVENT = "followup_nudge_surfaced";
export const FOLLOWUP_NUDGE_CADENCES = ["1wk", "2wk"] as const;

export type FollowupNudgeCadence = (typeof FOLLOWUP_NUDGE_CADENCES)[number];

export interface FollowupNudge {
  company: string;
  role: string;
  ref: string;
  id?: string | number;
  daysSince: number;
  cadence: FollowupNudgeCadence;
  appliedDate: string;
}

export interface LoggedFollowupNudge {
  cadence: FollowupNudgeCadence;
  ref?: string;
  id?: string | number;
  company?: string;
  role?: string;
}

export interface ComputeFollowupNudgesOptions {
  loggedNudges?: ReadonlyArray<LoggedFollowupNudge | string>;
}

export interface FollowupNudgeSurfacedEvent extends TelemetryEvent {
  event: typeof FOLLOWUP_NUDGE_SURFACED_EVENT;
  count: number;
  cadence_breakdown: Record<FollowupNudgeCadence, number>;
  ts: string;
}

export interface FollowupNudgeTelemetryOptions extends EmitEventOptions {
  now?: Date;
}

// Only "applied" is the unambiguous "I applied, no response yet" stage (per the
// apply-tracker lifecycle: Applied → [Waiting] → Screen → Interview → Offer).
// "deprioritized" is EXCLUDED: mission-control's Company Action Gate states a
// deprioritized company "must never surface as an action" (apply/follow_up/
// referral). Engaged stages (advancing/in_process/awaiting_decision) and closed
// stages (dead/rejected/offered/declined) are not "awaiting a first response".
const AWAITING_RESPONSE_STAGES = new Set(["applied"]);
const DATE_FIELDS = [
  "applied_date",
  "applied_at",
  "submitted_at",
  "submission_date",
  "last_activity",
  "last_activity_at",
  "stage_date",
  "updated_at",
  "stage_detail",
] as const;

export function computeFollowupNudges(
  pipeline: unknown,
  nowIso: string,
  opts: ComputeFollowupNudgesOptions = {},
): FollowupNudge[] {
  const nowDay = parseUtcDateOnly(nowIso);
  if (!nowDay) return [];

  const entries = extractStageData(pipeline);
  const nudges: FollowupNudge[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;

    const stage = normalizeStage(entry.stage);
    if (!AWAITING_RESPONSE_STAGES.has(stage)) continue;

    const company = stringField(entry.company ?? entry.company_name);
    const role = stringField(entry.role ?? entry.title);
    if (!company || !role) continue;

    const appliedDate = latestEntryDate(entry, nowDay);
    if (!appliedDate) continue;

    const daysSince = daysBetween(appliedDate.date, nowDay);
    if (daysSince < 7) continue;

    const cadence: FollowupNudgeCadence = daysSince >= 14 ? "2wk" : "1wk";
    const id = primitiveRef(entry.tracker_id ?? entry.id);
    const ref = refForEntry(entry, company, role);
    if (hasLoggedNudge(entry, { cadence, ref, id, company, role }, opts)) continue;

    nudges.push({
      company,
      role,
      ref,
      ...(id === undefined ? {} : { id }),
      daysSince,
      cadence,
      appliedDate: appliedDate.isoDate,
    });
  }

  return nudges;
}

export function buildFollowupNudgeSurfacedEvent(
  nudges: readonly FollowupNudge[],
  now: Date = new Date(),
): FollowupNudgeSurfacedEvent {
  return {
    event: FOLLOWUP_NUDGE_SURFACED_EVENT,
    count: nudges.length,
    cadence_breakdown: {
      "1wk": nudges.filter((nudge) => nudge.cadence === "1wk").length,
      "2wk": nudges.filter((nudge) => nudge.cadence === "2wk").length,
    },
    ts: ts(now),
  };
}

export function emitFollowupNudgesSurfaced(
  nudges: readonly FollowupNudge[],
  options: FollowupNudgeTelemetryOptions = {},
): EmitEventResult<FollowupNudgeSurfacedEvent> {
  const event = buildFollowupNudgeSurfacedEvent(nudges, options.now);
  return emitEvent(event, options);
}

function extractStageData(pipeline: unknown): unknown[] {
  if (Array.isArray(pipeline)) return pipeline;
  if (!isRecord(pipeline) || !Array.isArray(pipeline.stage_data)) return [];
  return pipeline.stage_data;
}

function normalizeStage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function primitiveRef(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function refForEntry(entry: Record<string, unknown>, company: string, role: string): string {
  const trackerId = primitiveRef(entry.tracker_id);
  if (trackerId !== undefined) return `#${trackerId}`;

  const id = primitiveRef(entry.id);
  if (id !== undefined) return String(id);

  const slug = stringField(entry.slug);
  if (slug) return slug;

  return `${company} - ${role}`;
}

function latestEntryDate(
  entry: Record<string, unknown>,
  nowDay: Date,
): { date: Date; isoDate: string } | undefined {
  const dates = DATE_FIELDS
    .flatMap((field) => parseDateCandidates(entry[field]))
    .filter((date) => date.getTime() <= nowDay.getTime())
    .sort((a, b) => b.getTime() - a.getTime());

  const date = dates[0];
  if (!date) return undefined;
  return { date, isoDate: toIsoDate(date) };
}

function parseDateCandidates(value: unknown): Date[] {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [utcDayStart(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())];
  }
  if (typeof value !== "string") return [];

  const dates: Date[] = [];
  for (const match of value.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const date = utcDayStart(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!Number.isNaN(date.getTime())) dates.push(date);
  }
  return dates;
}

function parseUtcDateOnly(value: string): Date | undefined {
  const dateMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (dateMatch) {
    const date = utcDayStart(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return utcDayStart(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function utcDayStart(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return new Date(Number.NaN);
  }
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

function hasLoggedNudge(
  entry: Record<string, unknown>,
  target: LoggedFollowupNudge,
  opts: ComputeFollowupNudgesOptions,
): boolean {
  return hasLoggedNudgeInEntry(entry, target) || (opts.loggedNudges ?? []).some((logged) => loggedMatches(logged, target));
}

function hasLoggedNudgeInEntry(entry: Record<string, unknown>, target: LoggedFollowupNudge): boolean {
  const cadenceFlag = target.cadence === "1wk"
    ? ["followup_1wk_logged", "follow_up_1wk_logged", "nudge_1wk_logged"]
    : ["followup_2wk_logged", "follow_up_2wk_logged", "nudge_2wk_logged"];

  if (cadenceFlag.some((field) => entry[field] === true)) return true;

  const logFields = [
    "followup_nudges",
    "follow_up_nudges",
    "followup_nudge_log",
    "follow_up_nudge_log",
    "nudge_log",
    "nudges",
    "nudges_logged",
    "followups",
  ];

  return logFields.some((field) => logValueMatches(entry[field], target));
}

function logValueMatches(value: unknown, target: LoggedFollowupNudge): boolean {
  if (Array.isArray(value)) return value.some((item) => logValueMatches(item, target));
  if (isRecord(value)) {
    const cadence = stringField(value.cadence ?? value.type ?? value.nudge);
    if (cadence !== target.cadence) return false;

    const loggedRef = primitiveRef(value.ref);
    const loggedId = primitiveRef(value.id ?? value.tracker_id);
    if (loggedRef !== undefined && loggedRef === target.ref) return true;
    if (loggedId !== undefined && target.id !== undefined && String(loggedId) === String(target.id)) return true;
    if (stringField(value.company) === target.company && stringField(value.role) === target.role) return true;
    return loggedRef === undefined && loggedId === undefined && !value.company && !value.role;
  }
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return normalized.includes(target.cadence) && (
    normalized.includes(String(target.ref).toLowerCase())
    || (target.id !== undefined && normalized.includes(String(target.id).toLowerCase()))
    || (target.company !== undefined && normalized.includes(target.company.toLowerCase()))
  );
}

function loggedMatches(logged: LoggedFollowupNudge | string, target: LoggedFollowupNudge): boolean {
  if (typeof logged === "string") return logValueMatches(logged, target);
  if (logged.cadence !== target.cadence) return false;
  if (logged.ref && logged.ref === target.ref) return true;
  if (logged.id !== undefined && target.id !== undefined && String(logged.id) === String(target.id)) return true;
  return logged.company === target.company && logged.role === target.role;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCliArgs(argv: string[]): { pipelinePath?: string; nowIso?: string; emit: boolean } {
  const args: { pipelinePath?: string; nowIso?: string; emit: boolean } = { emit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pipeline") {
      args.pipelinePath = argv[i + 1];
      i += 1;
    } else if (arg === "--now") {
      args.nowIso = argv[i + 1];
      i += 1;
    } else if (arg === "--emit") {
      args.emit = true;
    }
  }
  return args;
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.pipelinePath || !args.nowIso) {
    console.error("usage: bun src/pipeline/followup-nudge.ts --pipeline <job-pipeline.json> --now <iso> [--emit]");
    process.exit(2);
  }

  let pipeline: unknown;
  try {
    pipeline = JSON.parse(readFileSync(args.pipelinePath, "utf-8")) as unknown;
  } catch {
    pipeline = {};
  }

  const nudges = computeFollowupNudges(pipeline, args.nowIso);
  if (args.emit) emitFollowupNudgesSurfaced(nudges);
  console.log(JSON.stringify(nudges, null, 2));
}
