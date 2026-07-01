import { emitEvent, ts, type EmitEventOptions, type EmitEventResult, type TelemetryEvent } from "../telemetry/events";

export const BRAND_INBOUND_SOURCE = "brand_inbound";
export const RECRUITER_INBOUND_STAGE = "recruiter_inbound";
export const DEFAULT_INBOUND_NEXT_ACTION = "Respond to recruiter";
export const BRAND_INBOUND_PIPELINE_CREATED_EVENT = "brand_inbound_pipeline_created";

export type TrackerId = number;

export interface BuildInboundPipelineEntryInput {
  company: string;
  role: string;
  recruiter?: string | null;
  recruiter_title?: string | null;
  source_post?: string | null;
  note?: string | null;
  tracker_id?: string | number | null;
}

export interface BuildInboundPipelineEntryOptions {
  existingEntries?: readonly unknown[];
  // tracker_id is a GLOBAL id space — the same #N spans stage_data,
  // pending_referrals, AND the match-tracker (job-pipeline-match-tracker.json,
  // the authoritative role registry, ids up to the hundreds). Pass the FULL set
  // of known ids here so a new inbound entry never reuses an existing role's id.
  // Seeding from stage_data alone collides (stage_data max can be far below the
  // match-tracker max).
  existingTrackerIds?: readonly (string | number | null | undefined)[];
}

export interface InboundPipelineEntry {
  tracker_id: TrackerId;
  company: string;
  role: string;
  stage: typeof RECRUITER_INBOUND_STAGE;
  stage_detail: string | null;
  recruiter: string | null;
  recruiter_email: null;
  recruiter_title: string | null;
  hiring_manager: null;
  comp_note: null;
  warm_path: null;
  next_action: typeof DEFAULT_INBOUND_NEXT_ACTION;
  source: typeof BRAND_INBOUND_SOURCE;
  source_post: string | null;
}

export interface BrandInboundPipelineCreatedEvent extends TelemetryEvent {
  event: typeof BRAND_INBOUND_PIPELINE_CREATED_EVENT;
  has_source_post: boolean;
  ts: string;
}

export interface BrandInboundPipelineTelemetryInput {
  source_post?: unknown;
  has_source_post?: boolean;
}

export interface BrandInboundPipelineTelemetryOptions extends EmitEventOptions {
  now?: Date;
}

export function buildInboundPipelineEntry(
  input: BuildInboundPipelineEntryInput,
  options: BuildInboundPipelineEntryOptions = {},
): InboundPipelineEntry {
  return {
    tracker_id: nextTrackerId(
      options.existingEntries ?? [],
      input.tracker_id,
      options.existingTrackerIds ?? [],
    ),
    company: requiredString(input.company, "company"),
    role: requiredString(input.role, "role"),
    stage: RECRUITER_INBOUND_STAGE,
    stage_detail: stringField(input.note) ?? null,
    recruiter: stringField(input.recruiter) ?? null,
    recruiter_email: null,
    recruiter_title: stringField(input.recruiter_title) ?? null,
    hiring_manager: null,
    comp_note: null,
    warm_path: null,
    next_action: DEFAULT_INBOUND_NEXT_ACTION,
    source: BRAND_INBOUND_SOURCE,
    source_post: stringField(input.source_post) ?? null,
  };
}

export function appendInboundEntry(
  pipeline: unknown,
  entry: InboundPipelineEntry,
): Record<string, unknown> & { stage_data: unknown[] } {
  const base = isRecord(pipeline) ? pipeline : {};
  const stageData = Array.isArray(base.stage_data) ? base.stage_data : [];
  return {
    ...base,
    stage_data: [...stageData, entry],
  };
}

export function buildBrandInboundPipelineCreatedEvent(
  input: BrandInboundPipelineTelemetryInput = {},
  now: Date = new Date(),
): BrandInboundPipelineCreatedEvent {
  return {
    event: BRAND_INBOUND_PIPELINE_CREATED_EVENT,
    has_source_post: hasSourcePost(input),
    ts: ts(now),
  };
}

export function emitBrandInboundPipelineCreated(
  input: BrandInboundPipelineTelemetryInput = {},
  options: BrandInboundPipelineTelemetryOptions = {},
): EmitEventResult<BrandInboundPipelineCreatedEvent> {
  const event = buildBrandInboundPipelineCreatedEvent(input, options.now);
  return emitEvent(event, options);
}

function nextTrackerId(
  entries: readonly unknown[],
  requested: unknown,
  extraIds: readonly (string | number | null | undefined)[] = [],
): TrackerId {
  const used = new Set<TrackerId>();
  let max = 0;

  const note = (id: TrackerId | undefined) => {
    if (id === undefined) return;
    used.add(id);
    max = Math.max(max, id);
  };

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    note(trackerIdFromValue(entry.tracker_id));
  }
  // Fold in the full global id space (match-tracker ids, pending_referrals, …)
  // so we never reuse an existing role's #N.
  for (const raw of extraIds) note(trackerIdFromValue(raw));

  const requestedId = trackerIdFromValue(requested);
  if (requestedId !== undefined && !used.has(requestedId)) {
    return requestedId;
  }

  return max + 1;
}

function trackerIdFromValue(value: unknown): TrackerId | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function hasSourcePost(input: BrandInboundPipelineTelemetryInput): boolean {
  if (typeof input.has_source_post === "boolean") return input.has_source_post;
  return stringField(input.source_post) !== undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = stringField(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
