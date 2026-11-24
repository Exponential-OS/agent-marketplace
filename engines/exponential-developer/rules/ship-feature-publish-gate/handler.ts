#!/usr/bin/env bun
/**
 * handler.ts - ship-feature publish/activation skew gate.
 *
 * Compares installed xos plugin cache versions against the marketplace catalog.
 * A real installed < marketplace skew is a BLOCK because the running swarm is
 * stale and must reinstall + reload before "shipped" can mean activated.
 *
 * Direct input:
 *   { "plugin": "exponential-developer" }
 *   { "plugins": ["exponential-developer", "work-kernel"] }
 *   { "plugin": "all" }
 *
 * Optional test/fixture paths:
 *   { "cache_root": "/tmp/cache/xos", "marketplace_path": "/tmp/marketplace.json" }
 *
 * Exit:
 *   0 PASS
 *   1 BLOCK on detected skew
 *
 * Unexpected handler crashes fail open: log + allow.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";

export const SLUG = "ship-feature-publish-gate";

const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const DEFAULT_CACHE_ROOT = join(homedir(), ".claude", "plugins", "cache", "xos");
/** The only plugin that records its loaded version per session today. Named rather than
 *  assumed: every other plugin would need to write its own session state for this to widen. */
const SESSION_VERSIONED_PLUGIN = "co-dialectic";

function sessionsDir(options: ProcessOptions): string {
  const env = options.env ?? process.env;
  return options.sessionsDir ?? cleanString(env["CODIALECTIC_SESSIONS_DIR"]) ?? join(options.homeDir ?? homedir(), ".codialectic", "sessions");
}

function selfSessionId(options: ProcessOptions): string | null {
  const env = options.env ?? process.env;
  return options.sessionId ?? cleanString(env["CLAUDE_SESSION_ID"]) ?? null;
}
const MARKETPLACE_RELATIVE_PATH = join("agent-marketplace", ".claude-plugin", "marketplace.json");
const INSTALL_REMEDIATION_SUFFIX = "&& /reload-plugins";
const VERSION_KEYS = ["version", "latest", "latestVersion", "currentVersion", "current_version"];
const NAME_KEYS = ["name", "id", "slug", "pluginName", "plugin_name"];

// XOS-444: UNKNOWN exists because PASS was being returned by SIX different "I could not
// check" paths. A publish gate reporting PASS with `checked: []` is quotable as evidence
// that the fleet is current, which is the exact XOS-315 shape this plugin keeps fixing:
// a check whose failure is indistinguishable from success. UNKNOWN is not a softer BLOCK —
// it is the honest third answer, and PASS now requires at least one plugin ACTUALLY compared.
type Verdict = "PASS" | "BLOCK" | "UNKNOWN";
type CheckStatus = "current" | "stale" | "missing_install" | "newer_installed" | "marketplace_missing";

interface HandlerInput {
  plugin?: unknown;
  plugins?: unknown;
  cache_root?: unknown;
  installed_cache_root?: unknown;
  marketplace_path?: unknown;
  cwd?: unknown;
}

interface NormalizedInput {
  plugins: string[] | null;
  cacheRoot?: string;
  marketplacePath?: string;
  cwd: string;
}

export interface PluginCheck {
  plugin: string;
  installedVersion: string | null;
  marketplaceVersion: string | null;
  status: CheckStatus;
  requires_reload?: string;
}

export interface HandlerOutput {
  verdict: Verdict;
  target: string;
  reason: string;
  message: string;
  stale: PluginCheck[];
  checked: PluginCheck[];
  /** XOS-444. Present when session liveness was evaluated. Stale PEERS are REPORTED, not
   *  gated on: blocking a release because somebody else's terminal is old is a product call
   *  Anand owns, not one this handler makes silently. */
  sessions?: SessionLiveness;
}

export interface ProcessOptions {
  installedCacheRoot?: string;
  marketplacePath?: string;
  homeDir?: string;
  cwd?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  logPath?: string;
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
  readDir?: (path: string) => string[];
  isDirectory?: (path: string) => boolean;
  mtimeMs?: (path: string) => number;
  appendText?: (path: string, text: string) => void;
  sessionsDir?: string;
  sessionId?: string;
}

type FileSystemLike = FsOps;

interface FsOps {
  exists(path: string): boolean;
  readText(path: string): string;
  readDir(path: string): string[];
  isDirectory(path: string): boolean;
  mtimeMs(path: string): number;
  appendText(path: string, text: string): void;
}

function isoNow(now = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

function fsOps(options: ProcessOptions): FsOps {
  return {
    exists: options.exists ?? existsSync,
    readText: options.readText ?? ((path: string) => readFileSync(path, "utf8")),
    readDir: options.readDir ?? readdirSync,
    mtimeMs:
      options.mtimeMs ??
      ((path: string) => {
        try {
          return statSync(path).mtimeMs;
        } catch {
          return 0;
        }
      }),
    isDirectory:
      options.isDirectory ??
      ((path: string) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      }),
    appendText: options.appendText ?? appendFileSync,
  };
}

function log(output: HandlerOutput, options: ProcessOptions, extra: Record<string, unknown> = {}): void {
  const path = options.logPath ?? LOG_PATH;
  const rec = {
    ts: isoNow(options.now),
    slug: SLUG,
    rule_slug: SLUG,
    verdict: output.verdict,
    target: output.target,
    reason: output.reason,
    stale: output.stale.map((check) => ({
      plugin: check.plugin,
      installed: check.installedVersion ?? "missing",
      marketplace: check.marketplaceVersion,
    })),
    ...extra,
  };
  try {
    fsOps(options).appendText(path, JSON.stringify(rec) + "\n");
  } catch {
    /* telemetry must not mask the enforcement verdict */
  }
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePluginList(raw: HandlerInput): string[] | null {
  const values: string[] = [];
  const single = cleanString(raw.plugin);
  if (single) values.push(single);
  if (typeof raw.plugins === "string") values.push(raw.plugins);
  if (Array.isArray(raw.plugins)) {
    for (const item of raw.plugins) {
      const cleaned = cleanString(item);
      if (cleaned) values.push(cleaned);
    }
  }

  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) return null;
  if (normalized.some((value) => value === "*" || value.toLowerCase() === "all")) return null;
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function normalizeInput(raw: HandlerInput, options: ProcessOptions): NormalizedInput {
  return {
    plugins: normalizePluginList(raw),
    cacheRoot: cleanString(raw.installed_cache_root) ?? cleanString(raw.cache_root) ?? options.installedCacheRoot,
    marketplacePath: cleanString(raw.marketplace_path) ?? options.marketplacePath,
    cwd: cleanString(raw.cwd) ?? options.cwd ?? process.cwd(),
  };
}

function defaultMarketplacePath(input: NormalizedInput, options: ProcessOptions, fs: FsOps): string {
  const env = options.env ?? process.env;
  const explicit = cleanString(env["XOS_MARKETPLACE_JSON"]) ?? cleanString(env["AGENT_MARKETPLACE_JSON"]);
  if (explicit) return explicit;

  const home = options.homeDir ?? homedir();
  // XOS-444: the marketplace is a SIBLING of the source repo, never a child of it. The old
  // list only tried `cwd/agent-marketplace/...`, so Stage 9 -- which legitimately runs from
  // the source repo -- resolved a path that cannot exist, found nothing, and (with the
  // fail-open below) returned PASS having checked nothing. Walking ancestors covers the
  // sibling at any depth and keeps working from a worktree, instead of hardcoding one layout.
  const ancestors: string[] = [];
  let dir = resolve(input.cwd);
  for (let i = 0; i < 8; i += 1) {
    ancestors.push(join(dir, MARKETPLACE_RELATIVE_PATH));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const candidates = [
    ...ancestors,
    join(home, "aiprojects", MARKETPLACE_RELATIVE_PATH),
    join(home, "cyborg", MARKETPLACE_RELATIVE_PATH),
    join(home, MARKETPLACE_RELATIVE_PATH),
  ];
  return candidates.find((path) => fs.exists(path)) ?? candidates[0];
}

function installedCacheRoot(input: NormalizedInput, options: ProcessOptions): string {
  const env = options.env ?? process.env;
  return input.cacheRoot ?? cleanString(env["XOS_PLUGIN_CACHE_ROOT"]) ?? DEFAULT_CACHE_ROOT;
}

function cleanVersion(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const version = String(value).trim();
  return version.length > 0 ? version : null;
}

function highestVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return versions.slice().sort(compareVersions).at(-1) ?? null;
}

function isObjectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObjectValue(value) && !Array.isArray(value);
}

function directVersionFromObject(value: Record<string, unknown>): string | null {
  for (const key of VERSION_KEYS) {
    const version = cleanVersion(value[key]);
    if (version) return version;
  }
  return null;
}

function nestedVersionFromObject(value: Record<string, unknown>): string | null {
  for (const key of ["manifest", "plugin", "package"]) {
    const nested = value[key];
    if (isRecord(nested)) {
      const version = versionFromObject(nested);
      if (version) return version;
    }
  }
  return null;
}

function versionFromVersionEntry(item: unknown): string | null {
  return isObjectValue(item) ? versionFromObject(item as Record<string, unknown>) : cleanVersion(item);
}

interface VersionFieldResult {
  handled: boolean;
  version: string | null;
}

function versionFromVersionsField(versions: unknown): VersionFieldResult {
  if (Array.isArray(versions)) {
    const parsed = versions
      .map(versionFromVersionEntry)
      .filter((version): version is string => Boolean(version));
    return { handled: true, version: highestVersion(parsed) };
  }
  if (isObjectValue(versions)) {
    const parsed: string[] = [];
    for (const [key, item] of Object.entries(versions)) {
      const valueVersion = versionFromVersionEntry(item);
      parsed.push(valueVersion ?? key);
    }
    return { handled: true, version: highestVersion(parsed.filter(Boolean)) };
  }
  return { handled: false, version: null };
}

function versionFromReleasesField(releases: unknown): string | null {
  if (!isRecord(releases)) return null;
  return highestVersion(Object.keys(releases));
}

function versionFromObject(value: Record<string, unknown>): string | null {
  const directVersion = directVersionFromObject(value);
  if (directVersion) return directVersion;

  const nestedVersion = nestedVersionFromObject(value);
  if (nestedVersion) return nestedVersion;

  const versions = versionFromVersionsField(value["versions"]);
  if (versions.handled) return versions.version;

  const releases = value["releases"];
  return versionFromReleasesField(releases);
}

function versionFromUnknown(value: unknown): string | null {
  const direct = cleanVersion(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return versionFromObject(value as Record<string, unknown>);
}

function nameFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const name = cleanString(obj[key]);
    if (name) return name;
  }
  return null;
}

function addMarketplaceEntry(map: Map<string, string>, name: string | null, version: string | null): void {
  if (!name || !version) return;
  const current = map.get(name);
  if (!current || compareVersions(current, version) < 0) map.set(name, version);
}

function collectContainerEntries(container: unknown, map: Map<string, string>): void {
  if (Array.isArray(container)) {
    for (const item of container) addMarketplaceEntry(map, nameFromUnknown(item), versionFromUnknown(item));
    return;
  }
  if (!container || typeof container !== "object") return;

  const obj = container as Record<string, unknown>;
  addMarketplaceEntry(map, nameFromUnknown(obj), versionFromUnknown(obj));

  for (const [key, value] of Object.entries(obj)) {
    if (VERSION_KEYS.includes(key) || NAME_KEYS.includes(key)) continue;
    // `$`-prefixed keys are JSON Schema reserved words ($schema, $id, $ref), never plugin
    // names. The real catalog's envelope is {$schema, name, owner, metadata, plugins}, and
    // scanning it collected "$schema" as a plugin whose version was the schema URL. The gate
    // then BLOCKed every run on a plugin that does not exist. Invisible until XOS-444 fixed
    // the path -- the gate had never successfully resolved a catalog to misparse.
    if (key.startsWith("$")) continue;
    addMarketplaceEntry(map, key, versionFromUnknown(value));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      addMarketplaceEntry(map, nameFromUnknown(value), versionFromUnknown(value));
    }
  }
}

export function marketplaceVersionsFromJson(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as unknown;
  const map = new Map<string, string>();

  collectContainerEntries(parsed, map);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["plugins", "entries", "items", "catalog", "marketplace"]) {
      if (key in obj) collectContainerEntries(obj[key], map);
    }
  }

  return map;
}

function splitVersion(version: string): { core: number[]; pre: string | null } {
  const raw = version.trim().replace(/^v/i, "");
  const withoutBuild = raw.split("+")[0] ?? raw;
  const [corePart, prePart] = withoutBuild.split("-", 2);
  const core = (corePart ?? "")
    .split(".")
    .filter((part) => part.length > 0)
    .map((part) => {
      if (!/^\d+$/.test(part)) return 0;
      return Number.parseInt(part, 10);
    });
  return { core, pre: prePart ?? null };
}

export function compareVersions(a: string, b: string): number {
  if (a === b) return 0;
  const left = splitVersion(a);
  const right = splitVersion(b);
  const width = Math.max(left.core.length, right.core.length, 3);

  for (let i = 0; i < width; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (left.pre && !right.pre) return -1;
  if (!left.pre && right.pre) return 1;
  if (left.pre && right.pre) {
    const preDiff = left.pre.localeCompare(right.pre, undefined, { numeric: true, sensitivity: "base" });
    if (preDiff !== 0) return preDiff;
  }

  return 0;
}

function installedVersions(cacheRoot: string, plugin: string, fs: FsOps): string[] {
  const pluginDir = join(cacheRoot, plugin);
  if (!fs.exists(pluginDir)) return [];
  return fs.readDir(pluginDir).filter((entry) => fs.isDirectory(join(pluginDir, entry)));
}

function checkPlugin(cacheRoot: string, plugin: string, marketplaceVersion: string | null, fs: FsOps): PluginCheck {
  if (!marketplaceVersion) {
    return { plugin, installedVersion: null, marketplaceVersion: null, status: "marketplace_missing" };
  }

  const installedVersion = highestVersion(installedVersions(cacheRoot, plugin, fs));
  if (!installedVersion) {
    return {
      plugin,
      installedVersion: null,
      marketplaceVersion,
      status: "missing_install",
      requires_reload: `${plugin}@${marketplaceVersion}`,
    };
  }

  const cmp = compareVersions(installedVersion, marketplaceVersion);
  if (cmp < 0) {
    return {
      plugin,
      installedVersion,
      marketplaceVersion,
      status: "stale",
      requires_reload: `${plugin}@${marketplaceVersion}`,
    };
  }
  if (cmp > 0) return { plugin, installedVersion, marketplaceVersion, status: "newer_installed" };
  return { plugin, installedVersion, marketplaceVersion, status: "current" };
}


// ─────────────────────────────────────────────────────────────────────────────
// XOS-444 — SESSION LIVENESS. Anand, 2026-11-23: "there should be a gate that verifies
// that it has loaded itself and others loaded as well. that is the codification of the prose."
//
// The checks above compare FILES: catalog version vs installed version. The prose promises an
// outcome about SESSIONS. Both files can agree perfectly while the fleet runs week-old code,
// because a plugin binds at session start and never rebinds (XOS-405). Measured 2026-11-23
// with 4.47.5 installed and the catalog agreeing: FOUR versions live at once — 4.47.5, 4.47.4,
// 4.47.0 and a 4.36.0 session touched twelve seconds earlier. merged != installed != LOADED.
//
// ~/.codialectic/sessions/<id>.json already carries `version` (what that session actually
// loaded) and mtime (whether anyone is still there), so this needs no new telemetry.
// ─────────────────────────────────────────────────────────────────────────────

/** A session id must be a UUID. Benchmarking has twice polluted this directory with synthetic
 *  ids (verify-1/2/3), and a gate that counts those reports a fleet that does not exist. */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A READ BOUND, not a judgement. Files older than this are never opened, because parsing 2,621
 * sessions to answer a question about the recent ones cost 1,211ms. Which sessions COUNT as
 * live is decided by the data (see findActivityGap), not by this number.
 */
const SESSION_READ_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A gap must be this many times the age below it to count as a real boundary rather than
 *  ordinary spacing. 4x is conservative: the observed gap is 29x (10.5m -> 305m). */
const ACTIVITY_GAP_RATIO = 4;

/**
 * THE THRESHOLD WAS NEVER DOING THE WORK. Measured ages in minutes, youngest first:
 *
 *   0.3 1.5 2.3 4.8 7.5 7.6 8.2 8.3 9.1 9.5 10.5 | 305 306 307 310 362 429 ... 2423
 *
 * Buckets: <7m = 8 · 7-30m = 2 · 30m-2h = ZERO · 2h-8h = 12 · 24h-7d = 170 · >7d = 2,432.
 *
 * Every cutoff between 10 and 305 minutes produces an IDENTICAL report. 30m, 2h and 4h are the
 * same number against this data. Moving 30m -> 24h did not widen the net gradually; it did
 * nothing until it crossed 305 and swallowed a second cluster whole, which is why the report
 * went 3 -> 22 with no useful value in between. That is not tuning a dial, it is choosing which
 * side of a chasm to stand on — and whichever side you pick, you picked it by hand and nobody
 * revisits it.
 *
 * So the number is gone. The data clusters itself: find the largest multiplicative gap and cut
 * there. Stays correct whether the directory holds 20 files or 20,000, and when no real gap
 * exists it SAYS SO (`gapFound: false`) rather than silently reverting to a threshold.
 *
 * ⛔ The failure this avoids is not hypothetical and not about correctness. `cyborg/rules/
 * branch-hygiene` shipped with 12 tests and took a repo from 612 branches to 117 on its first
 * run. Deleted 2026-11-13 (bd5b0852c). The Constitution records why in its own words: it was
 * "accurate noise, reporting 164 local / 46 unpushed branches on every single turn whether or
 * not anyone could act on it." Anand: "they are too annoying." It did not die of being wrong.
 * A 22-row peer list on every publish is that same artifact. When a report's LENGTH tracks
 * population size rather than how much is ACTIONABLE, it gets skimmed — and a skipped report
 * is worth exactly what a gate that passes having checked nothing is worth.
 */
export function findActivityGap(ages: number[]): { cut: number; gapFound: boolean } {
  // No non-null assertions: indexed access is checked rather than asserted away. `!` tells the
  // compiler to stop looking; it does not make the access safe, and a gate is the wrong place
  // to silence a check.
  const noGap = { cut: Number.POSITIVE_INFINITY, gapFound: false };
  const sorted = [...ages].sort((a, b) => a - b);
  if (sorted.length < 2) return noGap;
  let bestCut = Number.POSITIVE_INFINITY;
  let bestRatio = 0;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const lower = sorted[i];
    const upper = sorted[i + 1];
    if (typeof lower !== "number" || typeof upper !== "number") continue;
    if (lower <= 0) continue; // age 0 would divide by zero; it also cannot be a boundary
    const ratio = upper / lower;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestCut = lower;
    }
  }
  return bestRatio >= ACTIVITY_GAP_RATIO ? { cut: bestCut, gapFound: true } : noGap;
}

export interface SessionState {
  sessionId: string;
  version: string | null;
  ageMs: number;
}

export interface SessionLiveness {
  self: SessionState | null;
  selfStale: boolean;
  installedVersion: string | null;
  stalePeers: SessionState[];
  livePeers: number;
  /** True when the ages clustered cleanly. False means report the ages and say so, rather
   *  than pretending a hand-picked cutoff found something. */
  gapFound: boolean;
  /** Sessions beyond the activity cluster but still within the read window. */
  dormantCount: number;
  /** Sessions never opened at all, counted by stat alone. Cheap, and it is the line that
   *  tells a reader there is history they do NOT have to think about. */
  archivedCount: number;
}

/**
 * STAT FIRST, PARSE ONLY WHAT IS IN SCOPE. This read and JSON-parsed every file in the
 * directory and filtered afterwards: 2,621 files, 1,211ms, to use 19 of them. Same shape as
 * the gigabyte-transcript read this plugin's sibling just fixed -- load everything, need
 * almost none -- and a publish gate costing a second of wall clock per call is a reason not
 * to wire it. mtime is a stat; version requires opening the file.
 *
 * `alwaysInclude` keeps SELF exempt from the window: a session evaluating itself is live by
 * definition and must be read however old its last heartbeat looks.
 */
export function readSessions(
  dir: string,
  fs: FileSystemLike,
  now: number,
  opts: { maxAgeMs?: number; alwaysInclude?: string | null } = {},
): { sessions: SessionState[]; skipped: number } {
  const maxAgeMs = opts.maxAgeMs ?? SESSION_READ_WINDOW_MS;
  if (!fs.exists(dir)) return { sessions: [], skipped: 0 };
  const out: SessionState[] = [];
  let skipped = 0;
  for (const name of fs.readDir(dir)) {
    if (!name.endsWith(".json")) continue;
    const sessionId = name.slice(0, -5);
    if (!SESSION_ID_PATTERN.test(sessionId)) continue;
    const full = join(dir, name);
    const ageMs = now - fs.mtimeMs(full);
    if (ageMs > maxAgeMs && sessionId !== opts.alwaysInclude) {
      skipped += 1;
      continue;
    }
    let version: string | null = null;
    try {
      const parsed = JSON.parse(fs.readText(full)) as Record<string, unknown>;
      version = cleanVersion(parsed["version"]);
    } catch {
      version = null;
    }
    out.push({ sessionId, version, ageMs });
  }
  return { sessions: out, skipped };
}

export function assessSessions(
  sessions: SessionState[],
  installedVersion: string | null,
  selfSessionId: string | null,
  archivedCount = 0,
): SessionLiveness {
  const self = selfSessionId ? (sessions.find((entry) => entry.sessionId === selfSessionId) ?? null) : null;
  const behind = (entry: SessionState) =>
    installedVersion !== null && entry.version !== null && compareVersions(entry.version, installedVersion) < 0;
  const peers = sessions.filter((entry) => entry.sessionId !== selfSessionId);
  const { cut, gapFound } = findActivityGap(peers.map((entry) => entry.ageMs));
  const live = peers.filter((entry) => entry.ageMs <= cut);
  return {
    self,
    selfStale: self !== null && behind(self),
    installedVersion,
    stalePeers: live.filter(behind).sort((a, b) => a.ageMs - b.ageMs),
    livePeers: live.length,
    gapFound,
    dormantCount: peers.length - live.length,
    archivedCount,
  };
}

export function sessionRemediation(entry: SessionState, installedVersion: string | null): string {
  return `⚠ ${entry.sessionId} loaded ${entry.version ?? "unknown"} < installed ${installedVersion} — claude --resume ${entry.sessionId}`;
}

function staleLine(check: PluginCheck): string {
  const installed = check.installedVersion ?? "missing";
  return `⚠ STALE: ${check.plugin} installed ${installed} < marketplace ${check.marketplaceVersion} — claude plugin install ${check.plugin} ${INSTALL_REMEDIATION_SUFFIX}`;
}

function unknown(target: string, what: string, how: string): HandlerOutput {
  return {
    verdict: "UNKNOWN",
    target,
    reason: what,
    message: [`WHAT: ${what}`, `HOW: ${how}`].join("\n"),
    stale: [],
    checked: [],
  };
}

function pass(target: string, reason: string, checked: PluginCheck[] = []): HandlerOutput {
  if (checked.length === 0) {
    // DEFENSE IN DEPTH, and unreachable by any current input -- stated plainly rather than
    // left to look load-bearing. Every present "cannot check" path calls unknown() directly,
    // and removing this guard alone fails no test. It exists for the NEXT pass() call site:
    // if someone adds one that has compared nothing, this converts it to UNKNOWN instead of
    // minting the quotable green this ticket was filed for. Do not delete it as dead code;
    // do not count it as tested either.
    return unknown(target, "publish gate reported PASS without comparing any plugin", reason);
  }
  return {
    verdict: "PASS",
    target,
    reason,
    message: "PASS: " + reason,
    stale: [],
    checked,
  };
}

function block(target: string, reason: string, checked: PluginCheck[]): HandlerOutput {
  const stale = checked.filter((check) => check.status === "stale" || check.status === "missing_install");
  return {
    verdict: "BLOCK",
    target,
    reason,
    message: ["WHAT: installed xos plugin cache is behind the marketplace catalog.", "HOW: reinstall stale plugins and reload this session:", ...stale.map(staleLine)].join("\n"),
    stale,
    checked,
  };
}

function processInputUnsafe(raw: HandlerInput, options: ProcessOptions): HandlerOutput {
  const fs = fsOps(options);
  const input = normalizeInput(raw, options);
  const marketplacePath = input.marketplacePath ?? defaultMarketplacePath(input, options, fs);
  const cacheRoot = installedCacheRoot(input, options);
  const target = resolve(marketplacePath);

  if (!fs.exists(marketplacePath)) {
    const output = unknown(target, `marketplace catalog not found at ${marketplacePath}`, "the marketplace is a SIBLING of the source repo — clone/pull Exponential-OS/agent-marketplace, or pass XOS_MARKETPLACE_JSON=/abs/path/to/.claude-plugin/marketplace.json");
    log(output, options, { fail_open: true, marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  const marketplace = marketplaceVersionsFromJson(fs.readText(marketplacePath));
  const plugins = input.plugins ?? Array.from(marketplace.keys()).sort((a, b) => a.localeCompare(b));

  if (plugins.length === 0 || marketplace.size === 0) {
    const output = unknown(target, `marketplace catalog at ${marketplacePath} lists no plugin versions`, "the catalog parsed but is empty or malformed — check .claude-plugin/marketplace.json has a populated `plugins` array with `version` fields");
    log(output, options, { fail_open: true, marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  // XOS-444 SESSION LIVENESS. Files agreeing is necessary and not sufficient: a plugin binds
  // at session start (XOS-405), so the catalog and the cache can both be current while the
  // session doing the publishing is running code from nine releases ago.
  const read = readSessions(sessionsDir(options), fs, (options.now ?? new Date()).getTime(), {
    alwaysInclude: selfSessionId(options),
  });
  const sessions = assessSessions(
    read.sessions,
    highestVersion(installedVersions(cacheRoot, SESSION_VERSIONED_PLUGIN, fs)),
    selfSessionId(options),
    read.skipped,
  );

  const checked = plugins.map((plugin) => checkPlugin(cacheRoot, plugin, marketplace.get(plugin) ?? null, fs));
  const stale = checked.filter((check) => check.status === "stale" || check.status === "missing_install");
  if (stale.length > 0) {
    // Session state rides along on EVERY outcome. It used to be computed after this early
    // return, so whenever any plugin was stale the session check silently did not run -- and
    // the caller fixed the plugin, re-ran, and only then learned their session was stale too.
    // A gate that reveals one problem per round trip is the defect class this ticket is about.
    const output = { ...block(target, `${stale.length} stale plugin install(s) detected`, checked), sessions };
    log(output, options, { marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  if (sessions.selfStale) {
    const output: HandlerOutput = {
      verdict: "BLOCK",
      target,
      reason: `publishing session loaded ${sessions.self?.version} but ${sessions.installedVersion} is installed`,
      message: [
        "WHAT: the session running this publish has NOT loaded the installed plugin.",
        "      The catalog and the cache can both be current while this session runs old code,",
        "      because a plugin binds once at session start and never rebinds (XOS-405).",
        "HOW:  reload, then re-run the publish:",
        "      " + sessionRemediation(sessions.self!, sessions.installedVersion),
      ].join("\n"),
      stale: [],
      checked,
      sessions,
    };
    log(output, options, { marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  const missingMarketplace = checked.filter((check) => check.status === "marketplace_missing");
  const reason =
    missingMarketplace.length > 0
      ? "no stale plugin installs detected; requested plugin(s) missing from marketplace: " + missingMarketplace.map((check) => check.plugin).join(", ")
      : "installed xos plugin cache is current with marketplace";
  const output = { ...pass(target, reason, checked), sessions };
  log(output, options, { marketplace_path: marketplacePath, cache_root: cacheRoot });
  return output;
}

export function processInput(raw: HandlerInput, options: ProcessOptions = {}): HandlerOutput {
  try {
    return processInputUnsafe(raw, options);
  } catch (err) {
    const target = options.marketplacePath ?? process.cwd();
    const output = unknown(resolve(target), "ship-feature-publish-gate crashed: " + String(err instanceof Error ? err.message : err), "this is a gate defect — file it against exponential-developer; do NOT read this as a clean publish");
    log(output, options, { fail_open: true, error: String(err instanceof Error ? err.message : err) });
    return output;
  }
}

function emit(output: HandlerOutput): void {
  process.stdout.write(JSON.stringify(output) + "\n");
  if (output.verdict !== "PASS") process.stderr.write(output.message + "\n");
}

async function readInput(): Promise<string> {
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== "-") {
    if (args.length === 1 && args[0].trim().startsWith("{")) return args[0];
    return JSON.stringify({ plugins: args });
  }

  const stdin = process.stdin.isTTY ? "" : (await Bun.stdin.text()).trim();
  return stdin || "{}";
}

export async function runCli(): Promise<void> {
  const raw = await readInput();
  let input: HandlerInput;
  try {
    input = JSON.parse(raw) as HandlerInput;
  } catch (err) {
    const output = unknown("", "handler input was not valid JSON: " + String(err), "pass a JSON object, e.g. '{\"cwd\":\"/path/to/repo\"}', or no argument at all");
    log(output, {}, { fail_open: true });
    emit(output);
    process.exit(0);
  }

  const output = processInput(input);
  emit(output);
  process.exit(output.verdict === "BLOCK" ? 1 : 0);
}

if (import.meta.main) {
  runCli().catch((err) => {
    const output = unknown("", "ship-feature-publish-gate crashed before emit: " + String(err), "this is a gate defect — file it against exponential-developer; do NOT read this as a clean publish");
    log(output, {}, { fail_open: true, error: String(err) });
    emit(output);
    process.exit(0);
  });
}
