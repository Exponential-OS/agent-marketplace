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
import { join, resolve } from "path";

export const SLUG = "ship-feature-publish-gate";

const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const DEFAULT_CACHE_ROOT = join(homedir(), ".claude", "plugins", "cache", "xos");
const MARKETPLACE_RELATIVE_PATH = join("agent-marketplace", ".claude-plugin", "marketplace.json");
const INSTALL_REMEDIATION_SUFFIX = "&& /reload-plugins";
const VERSION_KEYS = ["version", "latest", "latestVersion", "currentVersion", "current_version"];
const NAME_KEYS = ["name", "id", "slug", "pluginName", "plugin_name"];

type Verdict = "PASS" | "BLOCK";
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
  appendText?: (path: string, text: string) => void;
}

interface FsOps {
  exists(path: string): boolean;
  readText(path: string): string;
  readDir(path: string): string[];
  isDirectory(path: string): boolean;
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
  const candidates = [
    join(input.cwd, MARKETPLACE_RELATIVE_PATH),
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

function staleLine(check: PluginCheck): string {
  const installed = check.installedVersion ?? "missing";
  return `⚠ STALE: ${check.plugin} installed ${installed} < marketplace ${check.marketplaceVersion} — claude plugin install ${check.plugin} ${INSTALL_REMEDIATION_SUFFIX}`;
}

function pass(target: string, reason: string, checked: PluginCheck[] = []): HandlerOutput {
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
    const output = pass(target, "WARNING: marketplace catalog unavailable; publish gate fail-open");
    log(output, options, { fail_open: true, marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  const marketplace = marketplaceVersionsFromJson(fs.readText(marketplacePath));
  const plugins = input.plugins ?? Array.from(marketplace.keys()).sort((a, b) => a.localeCompare(b));

  if (plugins.length === 0 || marketplace.size === 0) {
    const output = pass(target, "WARNING: marketplace catalog had no plugin versions; publish gate fail-open");
    log(output, options, { fail_open: true, marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  const checked = plugins.map((plugin) => checkPlugin(cacheRoot, plugin, marketplace.get(plugin) ?? null, fs));
  const stale = checked.filter((check) => check.status === "stale" || check.status === "missing_install");
  if (stale.length > 0) {
    const output = block(target, `${stale.length} stale plugin install(s) detected`, checked);
    log(output, options, { marketplace_path: marketplacePath, cache_root: cacheRoot });
    return output;
  }

  const missingMarketplace = checked.filter((check) => check.status === "marketplace_missing");
  const reason =
    missingMarketplace.length > 0
      ? "no stale plugin installs detected; requested plugin(s) missing from marketplace: " + missingMarketplace.map((check) => check.plugin).join(", ")
      : "installed xos plugin cache is current with marketplace";
  const output = pass(target, reason, checked);
  log(output, options, { marketplace_path: marketplacePath, cache_root: cacheRoot });
  return output;
}

export function processInput(raw: HandlerInput, options: ProcessOptions = {}): HandlerOutput {
  try {
    return processInputUnsafe(raw, options);
  } catch (err) {
    const target = options.marketplacePath ?? process.cwd();
    const output = pass(resolve(target), "ship-feature-publish-gate crashed; fail-open: " + String(err instanceof Error ? err.message : err));
    log(output, options, { fail_open: true, error: String(err instanceof Error ? err.message : err) });
    return output;
  }
}

function emit(output: HandlerOutput): void {
  process.stdout.write(JSON.stringify(output) + "\n");
  if (output.verdict === "BLOCK") process.stderr.write(output.message + "\n");
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
    const output = pass("", "invalid JSON; fail-open: " + String(err));
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
    const output = pass("", "ship-feature-publish-gate crashed before emit; fail-open: " + String(err));
    log(output, {}, { fail_open: true, error: String(err) });
    emit(output);
    process.exit(0);
  });
}
