import { existsSync, readFileSync } from "fs";
import { defaultEventsPath, type TelemetryEnv } from "./events";

export interface WeeklyInboundByPost {
  post_id: string;
  count: number;
}

export interface WeeklyInboundSummary {
  total: number;
  byPost: WeeklyInboundByPost[];
}

export interface WeeklyInboundSummaryOptions {
  env?: TelemetryEnv;
  eventsPath?: string;
  now?: Date;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function summarizeWeeklyContentInbound(
  options: WeeklyInboundSummaryOptions = {},
): WeeklyInboundSummary {
  const env = options.env ?? process.env;
  const path = options.eventsPath ?? defaultEventsPath(env);
  if (!existsSync(path)) return emptySummary();

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return emptySummary();
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const sinceMs = nowMs - SEVEN_DAYS_MS;
  const byPost = new Map<string, number>();
  let total = 0;

  for (const line of raw.split(/\r?\n/)) {
    const event = parseEventLine(line);
    if (!isContentToDmTrackedEvent(event)) continue;

    const eventMs = Date.parse(event.ts);
    if (!Number.isFinite(eventMs) || eventMs < sinceMs || eventMs > nowMs) continue;

    const postId = event.post_id.trim();
    total += 1;
    byPost.set(postId, (byPost.get(postId) ?? 0) + 1);
  }

  return {
    total,
    byPost: [...byPost.entries()]
      .map(([post_id, count]) => ({ post_id, count }))
      .sort((a, b) => b.count - a.count || a.post_id.localeCompare(b.post_id)),
  };
}

function emptySummary(): WeeklyInboundSummary {
  return { total: 0, byPost: [] };
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
