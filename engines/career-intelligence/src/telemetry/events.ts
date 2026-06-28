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
