import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type TelemetryEnv = Record<string, string | undefined>;
export type TelemetryEvent = object;

export interface EmitEventOptions {
  env?: TelemetryEnv;
  eventsPath?: string;
}

export interface EmitEventResult<T extends TelemetryEvent> {
  written: boolean;
  event: T;
  path?: string;
}

export interface TelemetryStateOptions extends EmitEventOptions {
  statePath?: string;
}

export type ContentToDmAttributionMethod = "user" | "inferred";

export interface ContentToDmTrackedInput {
  post_id: string;
  dm_source: string;
  contact_slug?: string;
  attributed_by?: ContentToDmAttributionMethod;
}

export interface ContentToDmTrackedOptions extends EmitEventOptions {
  now?: Date;
  cohort?: string;
}

export interface PostPromptFromConversationInput {
  conversation_source: string;
  contact_slug?: string;
  insight_summary?: string;
}

export interface PostPromptFromConversationOptions extends EmitEventOptions {
  now?: Date;
  cohort?: string;
}

export interface InsightCardViewedInput {
  insight_kind: string;
  week_of?: string;
}

export interface InsightCardViewedOptions extends EmitEventOptions {
  now?: Date;
  cohort?: string;
}

export interface InsightActedOnInput {
  insight_kind: string;
  action?: string;
  week_of?: string;
}

export interface InsightActedOnOptions extends EmitEventOptions {
  now?: Date;
  cohort?: string;
}

export interface ProfileChangeLoggedInput {
  section: string;
  note?: string;
}

export interface ProfileChangeLoggedOptions extends EmitEventOptions {
  now?: Date;
  cohort?: string;
}

export interface DashboardViewedInput {
  has_career_data: boolean;
  has_brand_data: boolean;
}

export interface DashboardViewedOptions extends EmitEventOptions {
  now?: Date;
  cohort?: string;
}

export interface IdentityFileBootstrappedInput {
  files_created?: readonly string[];
}

export interface IdentityFileBootstrappedOptions extends EmitEventOptions {
  now?: Date;
}

export interface ContentToDmTrackedEvent extends TelemetryEvent {
  event: "content_to_dm_tracked";
  post_id: string;
  dm_source: string;
  contact_slug?: string;
  attributed_by: ContentToDmAttributionMethod;
  cohort?: string;
  ts: string;
}

export interface PostPromptFromConversationEvent extends TelemetryEvent {
  event: "post_prompt_from_conversation";
  conversation_source: string;
  contact_slug?: string;
  insight_summary?: string;
  cohort?: string;
  ts: string;
}

export interface InsightCardViewedEvent extends TelemetryEvent {
  event: "insight_card_viewed";
  insight_kind: string;
  week_of?: string;
  cohort?: string;
  ts: string;
}

export interface InsightActedOnEvent extends TelemetryEvent {
  event: "insight_acted_on";
  insight_kind: string;
  action?: string;
  week_of?: string;
  cohort?: string;
  ts: string;
}

export interface ProfileChangeLoggedEvent extends TelemetryEvent {
  event: "profile_change_logged";
  section: string;
  note?: string;
  cohort?: string;
  ts: string;
}

export interface DashboardViewedEvent extends TelemetryEvent {
  event: "dashboard_viewed";
  has_career_data: boolean;
  has_brand_data: boolean;
  cohort?: string;
  ts: string;
}

export interface IdentityFileBootstrappedEvent extends TelemetryEvent {
  event: "identity_file_bootstrapped";
  files_created: string[];
  count: number;
  ts: string;
}

export interface Xos98TelemetryState {
  cohort?: string;
  first_artifact_created?: boolean;
  first_artifact_type?: string;
  beta_user_activated?: boolean;
  onboarding_started?: boolean;
  onboarding_completed?: boolean;
  d7_return?: boolean;
  session_started_at_ms?: number;
}

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isXos98TelemetryEnabled(env: TelemetryEnv = process.env): boolean {
  const value = env.XOS_98_TELEMETRY?.trim().toLowerCase() ?? "";
  return ENABLED_VALUES.has(value);
}

export function defaultEventsPath(env: TelemetryEnv = process.env): string {
  return env.CAREER_OS_EVENTS_LOG ?? env.XOS_EVENTS_LOG ?? join(homedir(), ".career-os-events.jsonl");
}

export function ts(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

export function buildContentToDmTrackedEvent(
  input: ContentToDmTrackedInput,
  now: Date = new Date(),
  cohort?: string,
): ContentToDmTrackedEvent {
  const attributed_by = input.attributed_by ?? "user";
  assertContentToDmAttributionMethod(attributed_by);

  const event: ContentToDmTrackedEvent = {
    event: "content_to_dm_tracked",
    post_id: requiredString(input.post_id, "post_id"),
    dm_source: requiredString(input.dm_source, "dm_source"),
    attributed_by,
    ts: ts(now),
  };

  const contact_slug = input.contact_slug?.trim();
  if (contact_slug) event.contact_slug = contact_slug;

  const normalizedCohort = cohort?.trim();
  if (normalizedCohort) event.cohort = normalizedCohort;

  return event;
}

export function emitContentToDmTracked(
  input: ContentToDmTrackedInput,
  options: ContentToDmTrackedOptions = {},
): EmitEventResult<ContentToDmTrackedEvent> {
  const event = buildContentToDmTrackedEvent(input, options.now, options.cohort);
  return emitEvent(event, options);
}

export function buildPostPromptFromConversationEvent(
  input: PostPromptFromConversationInput,
  now: Date = new Date(),
  cohort?: string,
): PostPromptFromConversationEvent {
  const event: PostPromptFromConversationEvent = {
    event: "post_prompt_from_conversation",
    conversation_source: requiredString(input.conversation_source, "conversation_source"),
    ts: ts(now),
  };

  const contact_slug = input.contact_slug?.trim();
  if (contact_slug) event.contact_slug = contact_slug;

  const insight_summary = input.insight_summary?.trim();
  if (insight_summary) event.insight_summary = insight_summary;

  const normalizedCohort = cohort?.trim();
  if (normalizedCohort) event.cohort = normalizedCohort;

  return event;
}

export function emitPostPromptFromConversation(
  input: PostPromptFromConversationInput,
  options: PostPromptFromConversationOptions = {},
): EmitEventResult<PostPromptFromConversationEvent> {
  const event = buildPostPromptFromConversationEvent(input, options.now, options.cohort);
  return emitEvent(event, options);
}

export function buildInsightCardViewedEvent(
  input: InsightCardViewedInput,
  now: Date = new Date(),
  cohort?: string,
): InsightCardViewedEvent {
  const event: InsightCardViewedEvent = {
    event: "insight_card_viewed",
    insight_kind: requiredString(input.insight_kind, "insight_kind"),
    ts: ts(now),
  };

  const week_of = input.week_of?.trim();
  if (week_of) event.week_of = week_of;

  const normalizedCohort = cohort?.trim();
  if (normalizedCohort) event.cohort = normalizedCohort;

  return event;
}

export function emitInsightCardViewed(
  input: InsightCardViewedInput,
  options: InsightCardViewedOptions = {},
): EmitEventResult<InsightCardViewedEvent> {
  const event = buildInsightCardViewedEvent(input, options.now, options.cohort);
  return emitEvent(event, options);
}

export function buildInsightActedOnEvent(
  input: InsightActedOnInput,
  now: Date = new Date(),
  cohort?: string,
): InsightActedOnEvent {
  const event: InsightActedOnEvent = {
    event: "insight_acted_on",
    insight_kind: requiredString(input.insight_kind, "insight_kind"),
    ts: ts(now),
  };

  const action = input.action?.trim();
  if (action) event.action = action;

  const week_of = input.week_of?.trim();
  if (week_of) event.week_of = week_of;

  const normalizedCohort = cohort?.trim();
  if (normalizedCohort) event.cohort = normalizedCohort;

  return event;
}

export function emitInsightActedOn(
  input: InsightActedOnInput,
  options: InsightActedOnOptions = {},
): EmitEventResult<InsightActedOnEvent> {
  const event = buildInsightActedOnEvent(input, options.now, options.cohort);
  return emitEvent(event, options);
}

export function buildProfileChangeLoggedEvent(
  input: ProfileChangeLoggedInput,
  now: Date = new Date(),
  cohort?: string,
): ProfileChangeLoggedEvent {
  const event: ProfileChangeLoggedEvent = {
    event: "profile_change_logged",
    section: requiredString(input.section, "section"),
    ts: ts(now),
  };

  const note = input.note?.trim();
  if (note) event.note = note;

  const normalizedCohort = cohort?.trim();
  if (normalizedCohort) event.cohort = normalizedCohort;

  return event;
}

export function emitProfileChangeLogged(
  input: ProfileChangeLoggedInput,
  options: ProfileChangeLoggedOptions = {},
): EmitEventResult<ProfileChangeLoggedEvent> {
  const event = buildProfileChangeLoggedEvent(input, options.now, options.cohort);
  return emitEvent(event, options);
}

export function buildDashboardViewedEvent(
  input: DashboardViewedInput,
  now: Date = new Date(),
  cohort?: string,
): DashboardViewedEvent {
  const event: DashboardViewedEvent = {
    event: "dashboard_viewed",
    has_career_data: requiredBoolean(input.has_career_data, "has_career_data"),
    has_brand_data: requiredBoolean(input.has_brand_data, "has_brand_data"),
    ts: ts(now),
  };

  const normalizedCohort = cohort?.trim();
  if (normalizedCohort) event.cohort = normalizedCohort;

  return event;
}

export function emitDashboardViewed(
  input: DashboardViewedInput,
  options: DashboardViewedOptions = {},
): EmitEventResult<DashboardViewedEvent> {
  const event = buildDashboardViewedEvent(input, options.now, options.cohort);
  return emitEvent(event, options);
}

export function buildIdentityFileBootstrappedEvent(
  input: IdentityFileBootstrappedInput = {},
  now: Date = new Date(),
): IdentityFileBootstrappedEvent {
  const files_created = normalizeStringList(input.files_created);
  return {
    event: "identity_file_bootstrapped",
    files_created,
    count: files_created.length,
    ts: ts(now),
  };
}

export function emitIdentityFileBootstrapped(
  input: IdentityFileBootstrappedInput = {},
  options: IdentityFileBootstrappedOptions = {},
): EmitEventResult<IdentityFileBootstrappedEvent> {
  const event = buildIdentityFileBootstrappedEvent(input, options.now);
  return emitEvent(event, options);
}

export function emitEvent<T extends TelemetryEvent>(
  event: T,
  options: EmitEventOptions = {},
): EmitEventResult<T> {
  const env = options.env ?? process.env;
  if (!isXos98TelemetryEnabled(env)) {
    return { written: false, event };
  }

  const path = options.eventsPath ?? defaultEventsPath(env);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + "\n");
  return { written: true, event, path };
}

export function defaultTelemetryStatePath(
  env: TelemetryEnv = process.env,
  eventsPath?: string,
): string {
  return join(dirname(eventsPath ?? defaultEventsPath(env)), ".xos-98-telemetry-state.json");
}

export function readTelemetryState(options: TelemetryStateOptions = {}): Xos98TelemetryState {
  const env = options.env ?? process.env;
  const path = options.statePath ?? defaultTelemetryStatePath(env, options.eventsPath);
  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Xos98TelemetryState;
  } catch {
    return {};
  }
}

export function writeTelemetryState(
  state: Xos98TelemetryState,
  options: TelemetryStateOptions = {},
): string {
  const env = options.env ?? process.env;
  const path = options.statePath ?? defaultTelemetryStatePath(env, options.eventsPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
  return path;
}

function requiredString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredBoolean(value: boolean, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function assertContentToDmAttributionMethod(value: string): asserts value is ContentToDmAttributionMethod {
  if (value !== "user" && value !== "inferred") {
    throw new Error('attributed_by must be "user" or "inferred"');
  }
}

export interface AudiencePreviewViewedInput {
  audience_count: number;
  top_score?: number;
}

export interface AudiencePreviewViewedOptions extends EmitEventOptions {
  now?: Date;
}

export type AudiencePreviewTopScoreBucket = "0" | "1-4" | "5-9" | "10-19" | "20+";

export interface AudiencePreviewViewedEvent extends TelemetryEvent {
  event: "audience_preview_viewed";
  audience_count: number;
  top_score_bucket: AudiencePreviewTopScoreBucket;
  ts: string;
}

export function buildAudiencePreviewViewedEvent(
  input: AudiencePreviewViewedInput,
  now: Date = new Date(),
): AudiencePreviewViewedEvent {
  return {
    event: "audience_preview_viewed",
    audience_count: nonNegativeInteger(input.audience_count),
    top_score_bucket: audienceTopScoreBucket(input.top_score),
    ts: ts(now),
  };
}

export function emitAudiencePreviewViewed(
  input: AudiencePreviewViewedInput,
  options: AudiencePreviewViewedOptions = {},
): EmitEventResult<AudiencePreviewViewedEvent> {
  const event = buildAudiencePreviewViewedEvent(input, options.now);
  return emitEvent(event, options);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function audienceTopScoreBucket(value: unknown): AudiencePreviewTopScoreBucket {
  const score = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (score <= 0) return "0";
  if (score < 5) return "1-4";
  if (score < 10) return "5-9";
  if (score < 20) return "10-19";
  return "20+";
}

