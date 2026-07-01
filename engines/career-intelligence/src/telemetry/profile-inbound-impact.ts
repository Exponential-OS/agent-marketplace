import { existsSync, readFileSync } from "fs";
import { defaultEventsPath, type TelemetryEnv } from "./events";

export interface ProfileChangeImpactSummary {
  beforeCount: number;
  afterCount: number;
  inboundRateChange: number;
  windowDays: number;
}

export interface ProfileChangeImpactOptions {
  env?: TelemetryEnv;
  eventsPath?: string;
  windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function summarizeProfileChangeImpact(
  changeTsIso: string,
  options: ProfileChangeImpactOptions = {},
): ProfileChangeImpactSummary {
  const windowDays = normalizeWindowDays(options.windowDays);
  const empty = () => emptySummary(windowDays);
  const changeMs = Date.parse(changeTsIso);
  if (!Number.isFinite(changeMs)) return empty();

  const env = options.env ?? process.env;
  const path = options.eventsPath ?? defaultEventsPath(env);
  if (!existsSync(path)) return empty();

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return empty();
  }

  const windowMs = windowDays * DAY_MS;
  const beforeSinceMs = changeMs - windowMs;
  const afterUntilMs = changeMs + windowMs;
  let beforeCount = 0;
  let afterCount = 0;

  for (const line of raw.split(/\r?\n/)) {
    const event = parseEventLine(line);
    if (!isContentToDmTrackedEvent(event)) continue;

    const eventMs = Date.parse(event.ts);
    if (!Number.isFinite(eventMs)) continue;

    if (eventMs >= beforeSinceMs && eventMs < changeMs) {
      beforeCount += 1;
    } else if (eventMs > changeMs && eventMs <= afterUntilMs) {
      afterCount += 1;
    }
  }

  return {
    beforeCount,
    afterCount,
    inboundRateChange: afterCount - beforeCount,
    windowDays,
  };
}

function emptySummary(windowDays: number): ProfileChangeImpactSummary {
  return {
    beforeCount: 0,
    afterCount: 0,
    inboundRateChange: 0,
    windowDays,
  };
}

function normalizeWindowDays(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_WINDOW_DAYS;
}

function parseEventLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isContentToDmTrackedEvent(value: unknown): value is { event: string; post_id: string; ts: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return event.event === "content_to_dm_tracked"
    && typeof event.post_id === "string"
    && event.post_id.trim().length > 0
    && typeof event.ts === "string";
}
