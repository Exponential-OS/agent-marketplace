#!/usr/bin/env bun
/**
 * proactive-daemon.ts — XOS-108 Phase-1 polling daemon.
 *
 * A Bun/TypeScript polling loop that monitors the Linear bus and the cyborg
 * substrate SHA. On a genuine fire-condition it spawns a claude session via
 * `claude --dangerously-skip-permissions -p <prompt>`. Writes a heartbeat per
 * XOS-120 on every cycle.
 *
 * BUILD vs DEPLOY split
 * ---------------------
 * This file is the BUILD artifact. It is NOT installed, activated, or started
 * by this PR. Three HUMAN DEPLOY DECISIONS (HOST / COST MODEL / SECURITY
 * BLAST-RADIUS) must be resolved before a human runs:
 *
 *   launchctl load ~/Library/LaunchAgents/com.thewhyman.proactive-daemon.plist
 *
 * See docs/plans/xos-108-phase1-proactive-daemon.md for the full decision table.
 *
 * Configuration (via environment variables)
 * -----------------------------------------
 *   DAEMON_POLL_INTERVAL_MS   Poll cadence in ms   Default: 300_000 (5 min)
 *   DAEMON_SPAWN_RATE_CEILING Max claude spawns/hr Default: 3
 *   DAEMON_SESSION_ID         Stable daemon id     Default: proactive-daemon
 *   DAEMON_ROLE               Role label           Default: cyborg
 *   DAEMON_HOST               Host label           Default: hostname
 *   DAEMON_LOG_PATH           Log file             Default: ~/.cyborg-state/daemon/daemon.log
 *   DAEMON_LOG_MAX_BYTES      Log rotation limit   Default: 1_000_000 (1 MB)
 *   LINEAR_API_KEY            Required for Linear queries
 *   CYBORG_REPO               Path to cyborg repo  Default: ~/cyborg
 *   CAREER_OS_REPO            Path for SHA cache   Default: ~/anand-career-os
 *
 * Fail-safe invariants
 * --------------------
 * - Any error inside the loop is caught, logged, and the loop continues.
 * - Never spawn on empty fire-condition set.
 * - Never crash the process from within the loop.
 * - Spawn-rate ceiling is enforced BEFORE each spawn.
 *
 * Reuses from the coordination engine
 * ------------------------------------
 * - queryLinearBusDelta() + hasLinearDelta() from linear-bus.ts (XOS-119)
 * - writeSessionHeartbeat() from session-roles.ts (XOS-120)
 * - Substrate SHA-diff pattern from scripts/substrate-rehydrate-check.ts (XOS-112)
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hasLinearDelta, queryLinearBusDelta, resolveLinearConfig } from "./linear-bus.ts";
import { resolveSessionDataRoot, writeSessionHeartbeat } from "./session-roles.ts";

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function home(): string {
  return process.env.HOME ?? "/tmp";
}

function resolveConfig(): DaemonConfig {
  const pollMs = parseInt(process.env.DAEMON_POLL_INTERVAL_MS ?? "300000", 10);
  const spawnCeiling = parseInt(process.env.DAEMON_SPAWN_RATE_CEILING ?? "3", 10);
  const sessionId = process.env.DAEMON_SESSION_ID ?? "proactive-daemon";
  const role = process.env.DAEMON_ROLE ?? "cyborg";
  const host = process.env.DAEMON_HOST ?? hostname();
  const stateDir = join(resolveSessionDataRoot(), "daemon");
  const logPath =
    process.env.DAEMON_LOG_PATH ?? join(home(), ".cyborg-state", "daemon", "daemon.log");
  const logMaxBytes = parseInt(process.env.DAEMON_LOG_MAX_BYTES ?? "1000000", 10);
  const cyborgRepo = resolve(process.env.CYBORG_REPO ?? join(home(), "cyborg"));
  const careerOsRepo = resolve(process.env.CAREER_OS_REPO ?? join(home(), "anand-career-os"));

  return {
    pollMs: Number.isFinite(pollMs) && pollMs >= 60_000 ? pollMs : 300_000,
    spawnCeiling: Number.isFinite(spawnCeiling) && spawnCeiling >= 1 ? spawnCeiling : 3,
    sessionId,
    role,
    host,
    stateDir,
    logPath,
    logMaxBytes: Number.isFinite(logMaxBytes) && logMaxBytes >= 10_000 ? logMaxBytes : 1_000_000,
    cyborgRepo,
    careerOsRepo,
  };
}

export interface DaemonConfig {
  pollMs: number;
  spawnCeiling: number;
  sessionId: string;
  role: string;
  host: string;
  stateDir: string;
  logPath: string;
  logMaxBytes: number;
  cyborgRepo: string;
  careerOsRepo: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function log(logPath: string, logMaxBytes: number, level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    // Rotate if over limit
    if (existsSync(logPath)) {
      const size = statSync(logPath).size;
      if (size > logMaxBytes) {
        // Archive and start fresh
        writeFileSync(`${logPath}.1`, readFileSync(logPath));
        writeFileSync(logPath, "");
      }
    }
    appendFileSync(logPath, line);
  } catch {
    // Last-resort: stderr only, never crash
    process.stderr.write(line);
  }
}

// ---------------------------------------------------------------------------
// Spawn-rate ceiling
// ---------------------------------------------------------------------------

const SPAWN_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Reads spawn timestamps from the state dir, prunes entries older than 1 hr,
 * and returns the count of spawns within the window.
 */
export function recentSpawnCount(stateDir: string, nowMs: number = Date.now()): number {
  const spawnLog = join(stateDir, "spawn-log.json");
  if (!existsSync(spawnLog)) return 0;
  try {
    const raw: unknown = JSON.parse(readFileSync(spawnLog, "utf8"));
    if (!Array.isArray(raw)) return 0;
    const cutoff = nowMs - SPAWN_WINDOW_MS;
    return (raw as unknown[]).filter(
      (t) => typeof t === "number" && t >= cutoff,
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Records a spawn timestamp to the spawn log (prunes entries > 2 hours old).
 */
export function recordSpawn(stateDir: string, nowMs: number = Date.now()): void {
  mkdirSync(stateDir, { recursive: true });
  const spawnLog = join(stateDir, "spawn-log.json");
  let timestamps: number[] = [];
  if (existsSync(spawnLog)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(spawnLog, "utf8"));
      if (Array.isArray(raw)) {
        const cutoff = nowMs - 2 * SPAWN_WINDOW_MS;
        timestamps = (raw as unknown[]).filter(
          (t) => typeof t === "number" && t >= cutoff,
        ) as number[];
      }
    } catch { /* ignore */ }
  }
  timestamps.push(nowMs);
  writeFileSync(spawnLog, JSON.stringify(timestamps));
}

// ---------------------------------------------------------------------------
// Substrate SHA check (reuses XOS-112 pattern)
// ---------------------------------------------------------------------------

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * Reads the cached remote SHA written by sync-watcher.sh.
 * Falls back to a live git fetch if cache is stale (> 2 min).
 * Returns null on any failure (fail-open).
 */
export async function readRemoteSubstrateSha(
  cyborgRepo: string,
  careerOsRepo: string,
): Promise<string | null> {
  const remoteShaFile = join(careerOsRepo, ".agents", ".cyborg-last-remote-sha");
  try {
    if (existsSync(remoteShaFile)) {
      const mtime = statSync(remoteShaFile).mtimeMs;
      if (Date.now() - mtime < 120_000) {
        const sha = readFileSync(remoteShaFile, "utf8").trim();
        if (SHA_PATTERN.test(sha)) return sha;
      }
    }
  } catch { /* fall through to live fetch */ }

  try {
    const fetch = Bun.spawn(
      ["git", "-C", cyborgRepo, "fetch", "--quiet", "origin", "+main:refs/remotes/origin/main"],
      { stdout: "ignore", stderr: "ignore" },
    );
    await fetch.exited;
    const revParse = Bun.spawn(["git", "-C", cyborgRepo, "rev-parse", "origin/main"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    await revParse.exited;
    const sha = (await new Response(revParse.stdout).text()).trim();
    if (SHA_PATTERN.test(sha)) return sha;
  } catch { /* fail open */ }

  return null;
}

/**
 * Reads the locally stored baseline SHA for this daemon session.
 */
export function readBaselineSha(stateDir: string): string | null {
  const stateFile = join(stateDir, "substrate-baseline.json");
  if (!existsSync(stateFile)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(stateFile, "utf8"));
    if (!isRecord(raw) || typeof raw.baseline_sha !== "string") return null;
    return SHA_PATTERN.test(raw.baseline_sha) ? raw.baseline_sha : null;
  } catch {
    return null;
  }
}

/**
 * Persists the new baseline SHA so the next cycle can compare.
 */
export function writeBaselineSha(stateDir: string, sha: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "substrate-baseline.json"), JSON.stringify({ baseline_sha: sha }));
}

// ---------------------------------------------------------------------------
// Fire-condition evaluation
// ---------------------------------------------------------------------------

export interface FireCondition {
  kind: "linear-delta" | "substrate-change";
  description: string;
}

export interface PollResult {
  fires: FireCondition[];
  warn?: string;
  /** Updated substrate SHA to persist as new baseline (may be null if check failed) */
  newSubstrateSha: string | null;
  /** Linear high-watermark for the next poll's `since` param (null = no update) */
  newLinearWatermark: string | null;
}

/**
 * Run one poll cycle. Reads from Linear and substrate SHA.
 * Never throws. Always returns a PollResult.
 */
export async function pollOnce(opts: {
  since: string;
  baselineSha: string | null;
  config: DaemonConfig;
  linearConfig?: Parameters<typeof queryLinearBusDelta>[1];
}): Promise<PollResult> {
  const fires: FireCondition[] = [];
  let warn: string | undefined;
  let newSubstrateSha: string | null = null;
  let newLinearWatermark: string | null = null;

  // --- Check 1: Linear urgent/assigned delta ---
  try {
    const linearConfig = opts.linearConfig ?? resolveLinearConfig();
    const result = await queryLinearBusDelta(opts.since, linearConfig);

    if (result.ok && result.delta) {
      if (result.warn) warn = result.warn;
      const delta = result.delta;

      // Only fire on URGENT issues (priority = 1) that are new since `since`
      if (delta.urgentIssues.length > 0) {
        fires.push({
          kind: "linear-delta",
          description: `${delta.urgentIssues.length} urgent issue(s) assigned since ${opts.since}: ${delta.urgentIssues.map((i) => i.identifier).join(", ")}`,
        });
      }

      // Update watermark for the next poll
      const wm = getLinearHighWatermark(delta);
      if (wm) newLinearWatermark = wm;
    } else if (!result.ok) {
      warn = `linear-bus: ${result.err ?? "query failed"}`;
    }
  } catch (err) {
    warn = `linear-bus exception: ${String(err)}`;
  }

  // --- Check 2: substrate SHA change ---
  try {
    const remoteSha = await readRemoteSubstrateSha(opts.config.cyborgRepo, opts.config.careerOsRepo);
    if (remoteSha) {
      newSubstrateSha = remoteSha;
      if (opts.baselineSha && opts.baselineSha !== remoteSha) {
        fires.push({
          kind: "substrate-change",
          description: `cyborg substrate advanced ${opts.baselineSha.slice(0, 7)}..${remoteSha.slice(0, 7)}`,
        });
      }
    }
  } catch (err) {
    if (!warn) warn = `substrate-check exception: ${String(err)}`;
  }

  return { fires, warn, newSubstrateSha, newLinearWatermark };
}

/** Extracts the latest timestamp across all delta entries */
function getLinearHighWatermark(delta: Parameters<typeof hasLinearDelta>[0]): string | null {
  const dates: string[] = [];
  for (const issue of delta.urgentIssues ?? []) {
    if (issue.createdAt) dates.push(issue.createdAt);
    if (issue.updatedAt) dates.push(issue.updatedAt);
  }
  for (const issue of delta.assignedIssues ?? []) {
    if (issue.updatedAt) dates.push(issue.updatedAt);
  }
  for (const comment of delta.recentComments ?? []) {
    if (comment.updatedAt) dates.push(comment.updatedAt);
  }
  let max = 0;
  for (const d of dates) {
    const parsed = Date.parse(d);
    if (!Number.isNaN(parsed) && parsed > max) max = parsed;
  }
  return max > 0 ? new Date(max).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the context prompt for a spawned claude session.
 * Never includes secrets or personal data — only fire-condition summaries.
 */
export function buildPrompt(fires: FireCondition[], since: string): string {
  const lines = [
    "# Proactive daemon wake",
    `Conditions detected at ${new Date().toISOString()} (Linear polled since ${since}):`,
    "",
    ...fires.map((f) => `- [${f.kind}] ${f.description}`),
    "",
    "Instructions:",
    "1. Pull ~/cyborg origin/main before acting.",
    "2. Read ~/cyborg/active-goals/ and the Linear bus (XOS-119 hook fires on first prompt).",
    "3. Address each fire condition via the normal /ship-feature pipeline.",
    "4. Post a Linear comment with your findings on the relevant issue.",
    "5. Keep the blast-radius minimal. Prefer read → plan → ask over act.",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Spawn gate
// ---------------------------------------------------------------------------

export interface SpawnResult {
  spawned: boolean;
  /** "ok" | "rate-limited" | "dry-run" | "no-fires" */
  reason: string;
  pid?: number;
}

/**
 * Spawns a claude session if rate ceiling allows.
 * dryRun=true (default in tests) short-circuits the actual spawn.
 */
export async function spawnClaudeSession(opts: {
  fires: FireCondition[];
  prompt: string;
  config: DaemonConfig;
  dryRun?: boolean;
}): Promise<SpawnResult> {
  if (opts.fires.length === 0) {
    return { spawned: false, reason: "no-fires" };
  }

  const count = recentSpawnCount(opts.config.stateDir);
  if (count >= opts.config.spawnCeiling) {
    return { spawned: false, reason: "rate-limited" };
  }

  if (opts.dryRun) {
    return { spawned: true, reason: "dry-run" };
  }

  try {
    const proc = Bun.spawn(
      ["claude", "--dangerously-skip-permissions", "-p", opts.prompt],
      {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
        // Detach so the daemon doesn't block on the child
        detached: true,
      },
    );
    recordSpawn(opts.config.stateDir);
    return { spawned: true, reason: "ok", pid: proc.pid };
  } catch (err) {
    throw new Error(`spawn failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Liveness file
// ---------------------------------------------------------------------------

/**
 * Writes a liveness file so external monitoring can detect a stalled daemon.
 * Format: JSON with last_poll_at, last_spawn_at, last_fire_condition.
 */
export function writeLivenessFile(
  stateDir: string,
  opts: {
    lastPollAt: string;
    lastSpawnAt: string | null;
    lastFireCondition: string | null;
    spawnCount: number;
    spawnCeiling: number;
  },
): void {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "liveness.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        last_poll_at: opts.lastPollAt,
        last_spawn_at: opts.lastSpawnAt,
        last_fire_condition: opts.lastFireCondition,
        spawn_count_last_hour: opts.spawnCount,
        spawn_ceiling: opts.spawnCeiling,
      },
      null,
      2,
    ) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/** State persisted across poll cycles */
interface DaemonState {
  linearSince: string;
  baselineSha: string | null;
  lastSpawnAt: string | null;
  lastFireCondition: string | null;
}

/**
 * Run the daemon poll loop.
 *
 * `signal` is used to stop the loop in tests (pass an AbortSignal and call
 * signal.abort()). In production this runs forever until the process exits.
 */
export async function runDaemon(opts: {
  config?: DaemonConfig;
  /** Injected for tests — replace real I/O with mocks */
  overrides?: {
    pollOnce?: typeof pollOnce;
    spawnClaudeSession?: typeof spawnClaudeSession;
    writeSessionHeartbeat?: typeof writeSessionHeartbeat;
    writeLivenessFile?: typeof writeLivenessFile;
    writeBaselineSha?: typeof writeBaselineSha;
    log?: typeof log;
  };
  signal?: AbortSignal;
}): Promise<void> {
  const config = opts.config ?? resolveConfig();
  const impl = {
    pollOnce: opts.overrides?.pollOnce ?? pollOnce,
    spawnClaudeSession: opts.overrides?.spawnClaudeSession ?? spawnClaudeSession,
    writeSessionHeartbeat: opts.overrides?.writeSessionHeartbeat ?? writeSessionHeartbeat,
    writeLivenessFile: opts.overrides?.writeLivenessFile ?? writeLivenessFile,
    writeBaselineSha: opts.overrides?.writeBaselineSha ?? writeBaselineSha,
    log: opts.overrides?.log ?? log,
  };

  const doLog = (level: "INFO" | "WARN" | "ERROR", msg: string) =>
    impl.log(config.logPath, config.logMaxBytes, level, msg);

  // Initialize daemon state
  mkdirSync(config.stateDir, { recursive: true });
  const state: DaemonState = {
    linearSince: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // last 5 min on first boot
    baselineSha: readBaselineSha(config.stateDir),
    lastSpawnAt: null,
    lastFireCondition: null,
  };

  doLog("INFO", `proactive-daemon started (poll=${config.pollMs}ms ceiling=${config.spawnCeiling}/hr session=${config.sessionId})`);

  while (!opts.signal?.aborted) {
    const cycleStart = Date.now();
    const cycleTs = new Date(cycleStart).toISOString();

    // Declared outside try so finally can access them regardless of errors.
    let pollResult: PollResult | null = null;
    // spawnOk tracks whether the cycle resolved cleanly enough to advance the
    // substrate baseline. True when: no fires (nothing to spawn), spawn
    // succeeded (spawned=true), or spawn was skipped by ceiling/no-fires.
    // False when pollOnce throws OR spawnClaudeSession throws.
    let spawnOk = false;

    try {
      // 1. Write heartbeat (XOS-120) — always, before poll
      const hbResult = await impl.writeSessionHeartbeat({
        sessionId: config.sessionId,
        host: config.host,
        allRoles: [config.role],
      });
      if (!hbResult.ok || hbResult.warn) {
        doLog("WARN", `heartbeat: ${hbResult.warn ?? "failed"}`);
      }

      // 2. Poll for fire conditions
      pollResult = await impl.pollOnce({
        since: state.linearSince,
        baselineSha: state.baselineSha,
        config,
      });

      if (pollResult.warn) doLog("WARN", `poll: ${pollResult.warn}`);

      // 3. Update Linear high-watermark (safe — just a timestamp, not fire-dependent)
      if (pollResult.newLinearWatermark) {
        state.linearSince = pollResult.newLinearWatermark;
      }

      // 4. Spawn if fires detected
      const fires = pollResult.fires;
      if (fires.length > 0) {
        doLog("INFO", `fires: ${fires.map((f) => `${f.kind}:${f.description}`).join(" | ")}`);

        const prompt = buildPrompt(fires, state.linearSince);
        const spawnResult = await impl.spawnClaudeSession({ fires, prompt, config });
        // Mark cycle resolved: spawn either ran (ok/dry-run) or was intentionally
        // skipped (rate-limited/no-fires). Only an exception leaves spawnOk=false.
        spawnOk = true;

        if (spawnResult.spawned) {
          const spawnAt = new Date().toISOString();
          state.lastSpawnAt = spawnAt;
          state.lastFireCondition = fires[0]?.kind ?? null;
          doLog(
            "INFO",
            `spawned claude session (reason=${spawnResult.reason}${spawnResult.pid != null ? ` pid=${spawnResult.pid}` : ""})`,
          );
        } else {
          doLog("INFO", `spawn skipped (${spawnResult.reason})`);
        }
      } else {
        // No fires → cycle resolved successfully with nothing to do
        spawnOk = true;
        doLog("INFO", `poll cycle: no fires`);
      }
    } catch (err) {
      // Fail-safe: log + continue — never crash the loop.
      // spawnOk remains false, so baseline is NOT advanced this cycle (retry next).
      doLog("ERROR", `cycle error (continuing): ${String(err)}`);
    } finally {
      // Always write liveness — even on error cycles — so external monitoring
      // can detect a stalled daemon (liveness-not-per-cycle-on-error fix).
      try {
        impl.writeLivenessFile(config.stateDir, {
          lastPollAt: cycleTs,
          lastSpawnAt: state.lastSpawnAt,
          lastFireCondition: state.lastFireCondition,
          spawnCount: recentSpawnCount(config.stateDir),
          spawnCeiling: config.spawnCeiling,
        });
      } catch { /* liveness write failure is non-fatal */ }

      // Advance substrate baseline only after cycle resolved cleanly (baseline-before-
      // spawn-risk fix). If spawnOk=false (poll or spawn threw), retain the old
      // baseline so the same fire conditions retrigger on the next cycle — self-healing.
      if (pollResult?.newSubstrateSha) {
        if (!state.baselineSha) {
          // First boot: always initialize baseline (no fire was generated for first-run SHA)
          state.baselineSha = pollResult.newSubstrateSha;
          impl.writeBaselineSha(config.stateDir, pollResult.newSubstrateSha);
          doLog("INFO", `substrate baseline initialized: ${pollResult.newSubstrateSha.slice(0, 7)}`);
        } else if (spawnOk) {
          // Cycle resolved: advance baseline so we don't re-fire on same SHA
          state.baselineSha = pollResult.newSubstrateSha;
          impl.writeBaselineSha(config.stateDir, pollResult.newSubstrateSha);
        }
        // else: spawnOk=false → retain old baseline, substrate-change will retrigger
      }
    }

    // Wait for next cycle (respect abort signal)
    await waitMs(config.pollMs, opts.signal);
  }

  doLog("INFO", "proactive-daemon stopped (signal aborted)");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      done = true;
      resolve();
    }, ms);
    signal?.addEventListener("abort", () => {
      if (!done) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Entry point (production: bun run proactive-daemon.ts)
// ---------------------------------------------------------------------------

const isMain = import.meta.main ?? false;
if (isMain) {
  const config = resolveConfig();
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  runDaemon({ config }).catch((err) => {
    process.stderr.write(`FATAL: ${String(err)}\n`);
    process.exit(1);
  });
}
