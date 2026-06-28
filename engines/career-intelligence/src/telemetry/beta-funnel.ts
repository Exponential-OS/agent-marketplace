import { existsSync, readdirSync } from "fs";
import {
  emitEvent,
  isXos98TelemetryEnabled,
  readTelemetryState,
  ts,
  writeTelemetryState,
  type EmitEventResult,
  type TelemetryEvent,
  type TelemetryStateOptions,
} from "./events";

export const ARTIFACT_TYPES = ["resume", "cover_letter", "outreach"] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ActivationTrigger = ArtifactType;

export interface BetaFunnelOptions extends TelemetryStateOptions {
  now?: Date;
  cohort?: string;
}

export interface OnboardingStartedEvent extends TelemetryEvent {
  event: "onboarding_started";
  cohort: string;
  ts: string;
}

export interface OnboardingCompletedEvent extends TelemetryEvent {
  event: "onboarding_completed";
  cohort: string;
  ts: string;
}

export interface FirstArtifactCreatedEvent extends TelemetryEvent {
  event: "first_artifact_created";
  artifact_type: ArtifactType;
  ts: string;
}

export interface BetaUserActivatedEvent extends TelemetryEvent {
  event: "beta_user_activated";
  cohort: string;
  trigger: ActivationTrigger;
  ts: string;
}

export interface D7ReturnEvent extends TelemetryEvent {
  event: "d7_return";
  cohort: string;
  ts: string;
}

export interface IdentityFilesInput {
  experienceHistoryPath: string;
  jobSearchConfigPath: string;
}

export interface ArtifactCreatedInput {
  artifact_type: ArtifactType;
}

export interface ArtifactCreatedResult {
  first_artifact: EmitEventResult<FirstArtifactCreatedEvent>;
  activation?: EmitEventResult<BetaUserActivatedEvent>;
}

export interface D7ReturnInput {
  ledgerDir: string;
}

export function cohortFromDate(date: Date = new Date()): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function buildOnboardingStartedEvent(
  input: { cohort: string },
  now: Date = new Date(),
): OnboardingStartedEvent {
  return { event: "onboarding_started", cohort: input.cohort, ts: ts(now) };
}

export function buildOnboardingCompletedEvent(
  input: { cohort: string },
  now: Date = new Date(),
): OnboardingCompletedEvent {
  return { event: "onboarding_completed", cohort: input.cohort, ts: ts(now) };
}

export function buildFirstArtifactCreatedEvent(
  input: ArtifactCreatedInput,
  now: Date = new Date(),
): FirstArtifactCreatedEvent {
  assertArtifactType(input.artifact_type);
  return { event: "first_artifact_created", artifact_type: input.artifact_type, ts: ts(now) };
}

export function buildBetaUserActivatedEvent(
  input: { cohort: string; trigger: ActivationTrigger },
  now: Date = new Date(),
): BetaUserActivatedEvent {
  assertArtifactType(input.trigger);
  return { event: "beta_user_activated", cohort: input.cohort, trigger: input.trigger, ts: ts(now) };
}

export function buildD7ReturnEvent(
  input: { cohort: string },
  now: Date = new Date(),
): D7ReturnEvent {
  return { event: "d7_return", cohort: input.cohort, ts: ts(now) };
}

export function emitOnboardingStarted(
  options: BetaFunnelOptions = {},
): EmitEventResult<OnboardingStartedEvent> {
  const state = readTelemetryState(options);
  const event = buildOnboardingStartedEvent({ cohort: resolveCohort(options, state.cohort) }, options.now);
  if (state.onboarding_started) return { written: false, event };

  const result = emitEvent(event, options);
  if (result.written) {
    writeTelemetryState({ ...state, cohort: event.cohort, onboarding_started: true }, options);
  }
  return result;
}

export function emitOnboardingCompleted(
  options: BetaFunnelOptions = {},
): EmitEventResult<OnboardingCompletedEvent> {
  const state = readTelemetryState(options);
  const event = buildOnboardingCompletedEvent({ cohort: resolveCohort(options, state.cohort) }, options.now);
  if (state.onboarding_completed) return { written: false, event };

  const result = emitEvent(event, options);
  if (result.written) {
    writeTelemetryState({ ...state, cohort: event.cohort, onboarding_completed: true }, options);
  }
  return result;
}

export function emitOnboardingCompletedIfIdentityFilesPresent(
  input: IdentityFilesInput,
  options: BetaFunnelOptions = {},
): EmitEventResult<OnboardingCompletedEvent> {
  const state = readTelemetryState(options);
  const event = buildOnboardingCompletedEvent({ cohort: resolveCohort(options, state.cohort) }, options.now);
  if (!existsSync(input.experienceHistoryPath) || !existsSync(input.jobSearchConfigPath)) {
    return { written: false, event };
  }
  if (state.onboarding_completed) return { written: false, event };

  const result = emitEvent(event, options);
  if (result.written) {
    writeTelemetryState({ ...state, cohort: event.cohort, onboarding_completed: true }, options);
  }
  return result;
}

export function emitFirstArtifactCreated(
  input: ArtifactCreatedInput,
  options: BetaFunnelOptions = {},
): EmitEventResult<FirstArtifactCreatedEvent> {
  return emitArtifactCreated(input, options).first_artifact;
}

export function emitBetaUserActivated(
  input: { trigger: ActivationTrigger },
  options: BetaFunnelOptions = {},
): EmitEventResult<BetaUserActivatedEvent> {
  assertArtifactType(input.trigger);
  const state = readTelemetryState(options);
  const event = buildBetaUserActivatedEvent({
    cohort: resolveCohort(options, state.cohort),
    trigger: input.trigger,
  }, options.now);
  if (state.beta_user_activated) return { written: false, event };

  const result = emitEvent(event, options);
  if (result.written) {
    writeTelemetryState({ ...state, cohort: event.cohort, beta_user_activated: true }, options);
  }
  return result;
}

export function emitArtifactCreated(
  input: ArtifactCreatedInput,
  options: BetaFunnelOptions = {},
): ArtifactCreatedResult {
  assertArtifactType(input.artifact_type);
  const state = readTelemetryState(options);
  const firstArtifactEvent = buildFirstArtifactCreatedEvent(input, options.now);
  if (state.first_artifact_created) {
    return { first_artifact: { written: false, event: firstArtifactEvent } };
  }

  const first_artifact = emitEvent(firstArtifactEvent, options);
  let activation: EmitEventResult<BetaUserActivatedEvent> | undefined;

  if (first_artifact.written) {
    const cohort = resolveCohort(options, state.cohort);
    const activationEvent = buildBetaUserActivatedEvent({ cohort, trigger: input.artifact_type }, options.now);
    activation = state.beta_user_activated
      ? { written: false, event: activationEvent }
      : emitEvent(activationEvent, options);

    writeTelemetryState({
      ...state,
      cohort,
      first_artifact_created: true,
      first_artifact_type: input.artifact_type,
      beta_user_activated: state.beta_user_activated || activation.written,
    }, options);
  } else if (!isXos98TelemetryEnabled(options.env ?? process.env)) {
    const activationEvent = buildBetaUserActivatedEvent({
      cohort: resolveCohort(options, state.cohort),
      trigger: input.artifact_type,
    }, options.now);
    activation = { written: false, event: activationEvent };
  }

  return { first_artifact, activation };
}

export function emitD7ReturnFromLedger(
  input: D7ReturnInput,
  options: BetaFunnelOptions = {},
): EmitEventResult<D7ReturnEvent> {
  const state = readTelemetryState(options);
  const event = buildD7ReturnEvent({ cohort: resolveCohort(options, state.cohort) }, options.now);
  if (state.d7_return || !hasD7Return(input.ledgerDir, options.now ?? new Date())) {
    return { written: false, event };
  }

  const result = emitEvent(event, options);
  if (result.written) {
    writeTelemetryState({ ...state, cohort: event.cohort, d7_return: true }, options);
  }
  return result;
}

function resolveCohort(options: BetaFunnelOptions, stateCohort?: string): string {
  return options.cohort ?? stateCohort ?? cohortFromDate(options.now ?? new Date());
}

function assertArtifactType(value: string): asserts value is ArtifactType {
  if (!(ARTIFACT_TYPES as readonly string[]).includes(value)) {
    throw new Error(`artifact_type must be one of ${ARTIFACT_TYPES.join(", ")}`);
  }
}

function hasD7Return(ledgerDir: string, now: Date): boolean {
  let entries: string[];
  try {
    entries = readdirSync(ledgerDir);
  } catch {
    return false;
  }

  const today = localDayNumber(now);
  const priorDays = entries
    .map((entry) => /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(entry))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => localDayNumberFromParts(Number(match[1]), Number(match[2]), Number(match[3])))
    .filter((day) => day < today);

  if (priorDays.length === 0) return false;
  return today - Math.min(...priorDays) >= 7;
}

function localDayNumber(date: Date): number {
  return localDayNumberFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function localDayNumberFromParts(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

async function readCliInput(): Promise<Record<string, unknown>> {
  const raw = process.argv[3] !== undefined && process.argv[3] !== "-"
    ? process.argv[3]
    : (await Bun.stdin.text()).trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

if (import.meta.main) {
  try {
    const command = process.argv[2];
    const input = await readCliInput();
    let result: unknown;

    if (command === "onboarding-started") {
      result = emitOnboardingStarted();
    } else if (command === "onboarding-completed") {
      if (typeof input.experienceHistoryPath === "string" && typeof input.jobSearchConfigPath === "string") {
        result = emitOnboardingCompletedIfIdentityFilesPresent({
          experienceHistoryPath: input.experienceHistoryPath,
          jobSearchConfigPath: input.jobSearchConfigPath,
        });
      } else {
        result = emitOnboardingCompleted();
      }
    } else if (command === "artifact-created") {
      result = emitArtifactCreated({ artifact_type: String(input.artifact_type) as ArtifactType });
    } else if (command === "d7-return") {
      result = emitD7ReturnFromLedger({ ledgerDir: String(input.ledgerDir ?? "") });
    } else {
      throw new Error("Usage: beta-funnel.ts <onboarding-started|onboarding-completed|artifact-created|d7-return> '<json>'");
    }

    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
