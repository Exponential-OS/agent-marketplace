/**
 * session-start-roles.ts — Optional SessionStart hook for coordination engine.
 *
 * Writes the initial heartbeat for this session so sibling sessions detect
 * it quickly. Currently Claude Code does not expose a distinct SessionStart
 * hook event, so this is exported for future wiring and can also be called
 * directly from setup.py bootstrap.
 *
 * Fail-safe: never throws; errors are silently swallowed.
 */

import { hostname } from "node:os";
import {
  resolveSessionDataRoot,
  writeSessionHeartbeat,
} from "../session-roles.ts";

type Env = Record<string, string | undefined>;

export interface SessionStartInput {
  session_id: string;
  host?: string;
  cwd?: string;
}

/**
 * Write the initial heartbeat for this session.
 * allRoles defaults to ["*"] (generalist) unless LINEAR_SESSION_ROLES is set.
 */
export async function writeInitialHeartbeat(
  input: SessionStartInput,
  env: Env = process.env,
): Promise<void> {
  try {
    const allRoles = resolveAllRoles(env);
    const dataRoot = resolveSessionDataRoot(env);
    await writeSessionHeartbeat({
      sessionId: input.session_id,
      host: input.host ?? hostname(),
      allRoles,
      env,
      dataRoot,
    });
  } catch {
    // Fail-safe: never throw from a hook
  }
}

function resolveAllRoles(env: Env): string[] {
  const raw = env.LINEAR_SESSION_ROLES?.trim();
  if (!raw) return ["*"];
  const roles = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.length > 0 ? roles : ["*"];
}

async function readStdin(): Promise<string> {
  return process.stdin.isTTY ? "" : await Bun.stdin.text();
}

export async function runCli(): Promise<void> {
  try {
    const raw = await readStdin();
    let input: SessionStartInput = { session_id: "unknown" };
    if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "session_id" in parsed &&
          typeof (parsed as Record<string, unknown>).session_id === "string"
        ) {
          input = parsed as SessionStartInput;
        }
      } catch {
        // ignore parse errors
      }
    }
    await writeInitialHeartbeat(input);
  } catch {
    // Fail-safe: emit nothing.
  }
  process.exit(0);
}

if (import.meta.main) {
  await runCli();
}
