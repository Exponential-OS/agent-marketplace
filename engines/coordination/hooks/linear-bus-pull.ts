/**
 * UserPromptSubmit hook for Linear bus pull.
 *
 * Fail-safe contract: every exported and CLI entry point catches errors and
 * emits nothing on failure. This hook must never block or deny a prompt.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  getLinearBusHighWatermark,
  hasLinearDelta,
  queryLinearBusDelta,
  resolveLinearConfig,
  type LinearBusDelta,
  type LinearBusResult,
  type LinearConfig,
} from "../linear-bus.ts";

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_COLD_START_WINDOW = "24h";
const HOOK_TIMEOUT_MS = 4_000;
const SUMMARY_ITEM_LIMIT = 8;

type Env = Record<string, string | undefined>;

export interface LinearBusHookInput {
  session_id: string;
}

export interface LinearBusMarker {
  last_seen_at: string;
  updated_at?: string;
}

export interface LinearBusHookOptions {
  env?: Env;
  dataRoot?: string;
  fetchDelta?: (since: string, config: LinearConfig) => Promise<LinearBusResult>;
  now?: () => Date;
}

export async function runLinearBusPull(
  rawInput: string,
  options: LinearBusHookOptions = {},
): Promise<string | null> {
  try {
    return await runLinearBusPullUnsafe(rawInput, options);
  } catch {
    return null;
  }
}

export function resolveLinearBusDataRoot(env: Env = process.env): string {
  const configured = env.CLAUDE_PLUGIN_DATA?.trim();
  if (configured) return expandHome(configured, env);
  return join(env.HOME || homedir(), ".cyborg-state");
}

export function resolveLinearBusMarkerPath(
  sessionId: string,
  env: Env = process.env,
  dataRoot?: string,
): string {
  validateSessionId(sessionId);
  return join(dataRoot ?? resolveLinearBusDataRoot(env), "linear-bus", `${sessionId}.json`);
}

export function summarizeLinearBusDelta(delta: LinearBusDelta): string {
  const parts: string[] = [];
  const totalItems =
    delta.assignedIssues.length + delta.recentComments.length + delta.urgentIssues.length;
  let remaining = SUMMARY_ITEM_LIMIT;
  let displayed = 0;

  if (delta.assignedIssues.length > 0) {
    const visible = delta.assignedIssues.slice(0, remaining);
    remaining -= visible.length;
    displayed += visible.length;
    parts.push(
      `${delta.assignedIssues.length} assigned updated: ${visible.map(formatIssue).join("; ")}`,
    );
  }

  if (delta.recentComments.length > 0) {
    const visible = delta.recentComments.slice(0, remaining);
    remaining -= visible.length;
    displayed += visible.length;
    if (visible.length > 0) {
      parts.push(
        `${delta.recentComments.length} comment${delta.recentComments.length === 1 ? "" : "s"}: ${visible
          .map(formatComment)
          .join("; ")}`,
      );
    }
  }

  if (delta.urgentIssues.length > 0) {
    const visible = delta.urgentIssues.slice(0, remaining);
    remaining -= visible.length;
    displayed += visible.length;
    if (visible.length > 0) {
      parts.push(`${delta.urgentIssues.length} urgent: ${visible.map(formatIssue).join("; ")}`);
    }
  }

  const hidden = totalItems - displayed;
  if (hidden > 0) {
    parts.push(`+${hidden} more`);
  }

  return truncate(`BUS: ${parts.join(" | ")}`, 1800);
}

async function runLinearBusPullUnsafe(
  rawInput: string,
  options: LinearBusHookOptions,
): Promise<string | null> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const input = parseHookInput(rawInput);
  const markerPath = resolveLinearBusMarkerPath(input.session_id, env, options.dataRoot);
  const since = resolveLastSeenAt(markerPath, env, now);
  const config = resolveLinearConfig(env);
  const fetchDelta = options.fetchDelta ?? queryLinearBusDelta;
  const result = await withTimeout(fetchDelta(since, config), HOOK_TIMEOUT_MS);

  if (!result.ok || !result.delta || !hasLinearDelta(result.delta)) {
    return null;
  }

  const additionalContext = summarizeLinearBusDelta(result.delta);
  const lastSeenAt = maxTimestamp(since, getLinearBusHighWatermark(result.delta) ?? result.delta.queriedAt);
  writeMarker(markerPath, {
    last_seen_at: lastSeenAt,
    updated_at: now().toISOString(),
  });

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  });
}

function parseHookInput(rawInput: string): LinearBusHookInput {
  const parsed: unknown = JSON.parse(rawInput);
  if (!isRecord(parsed) || typeof parsed.session_id !== "string") {
    throw new Error("session_id missing");
  }
  validateSessionId(parsed.session_id);
  return { session_id: parsed.session_id };
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error("invalid session_id");
  }
}

function resolveLastSeenAt(markerPath: string, env: Env, now: () => Date): string {
  if (!existsSync(markerPath)) return resolveColdStartSince(env, now());
  return readLastSeenAt(markerPath);
}

function resolveColdStartSince(env: Env, now: Date): string {
  return new Date(now.getTime() - parseWindowMs(env.LINEAR_BUS_COLD_START_WINDOW)).toISOString();
}

function parseWindowMs(value: string | undefined): number {
  const fallbackMs = 24 * 60 * 60 * 1000;
  const raw = value?.trim() || DEFAULT_COLD_START_WINDOW;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;

  const unit = match[2].toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function readLastSeenAt(markerPath: string): string {
  const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
  if (!isRecord(parsed) || typeof parsed.last_seen_at !== "string") {
    throw new Error("invalid marker");
  }
  if (Number.isNaN(Date.parse(parsed.last_seen_at))) {
    throw new Error("invalid marker timestamp");
  }
  return parsed.last_seen_at;
}

function writeMarker(markerPath: string, marker: LinearBusMarker): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Linear bus hook timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatIssue(issue: { identifier: string; title: string }): string {
  return truncate(`${issue.identifier || "issue"} ${compact(issue.title)}`.trim(), 100);
}

function formatComment(comment: LinearBusDelta["recentComments"][number]): string {
  const author = compact(comment.user?.name || "comment");
  const body = compact(comment.body || "updated");
  return truncate(`${author} on ${comment.issue.identifier || "issue"}: ${body}`, 140);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function maxTimestamp(a: string, b: string): string {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isNaN(aTime)) return b;
  if (Number.isNaN(bTime)) return a;
  return new Date(Math.max(aTime, bTime)).toISOString();
}

function expandHome(value: string, env: Env): string {
  if (value === "~") return env.HOME || homedir();
  if (value.startsWith("~/")) return join(env.HOME || homedir(), value.slice(2));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readStdin(): Promise<string> {
  return process.stdin.isTTY ? "" : await Bun.stdin.text();
}

export async function runCli(): Promise<void> {
  try {
    const output = await runLinearBusPull(await readStdin());
    if (output) process.stdout.write(output + "\n");
  } catch {
    // Fail-safe: emit nothing.
  }
  process.exit(0);
}

if (import.meta.main) {
  await runCli();
}
