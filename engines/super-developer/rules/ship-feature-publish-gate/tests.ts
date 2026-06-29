import { afterEach, expect, test } from "bun:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { marketplaceVersionsFromJson, processInput, type ProcessOptions } from "./handler";

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLER = join(HERE, "handler.ts");
const tempDirs: string[] = [];

interface Fixture {
  root: string;
  cacheRoot: string;
  marketplacePath: string;
  logPath: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ship-feature-publish-gate-"));
  tempDirs.push(root);
  return {
    root,
    cacheRoot: join(root, "cache", "xos"),
    marketplacePath: join(root, "agent-marketplace", ".claude-plugin", "marketplace.json"),
    logPath: join(root, "log.jsonl"),
  };
}

function options(fx: Fixture): ProcessOptions {
  return {
    installedCacheRoot: fx.cacheRoot,
    marketplacePath: fx.marketplacePath,
    homeDir: fx.root,
    cwd: fx.root,
    logPath: fx.logPath,
    now: new Date("2026-06-29T12:00:00Z"),
  };
}

function writeMarketplace(fx: Fixture, value: unknown): void {
  mkdirSync(dirname(fx.marketplacePath), { recursive: true });
  writeFileSync(fx.marketplacePath, JSON.stringify(value, null, 2) + "\n");
}

function install(fx: Fixture, plugin: string, version: string): void {
  mkdirSync(join(fx.cacheRoot, plugin, version), { recursive: true });
}

function decode(pipe: Uint8Array | ArrayBuffer | undefined): string {
  if (!pipe) return "";
  return new TextDecoder().decode(pipe);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("PASS: installed version equals marketplace version", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: { "super-developer": { version: "0.6.0" } } });
  install(fx, "super-developer", "0.6.0");

  const result = processInput({ plugin: "super-developer" }, options(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("current with marketplace");
  expect(result.checked).toEqual([
    {
      plugin: "super-developer",
      installedVersion: "0.6.0",
      marketplaceVersion: "0.6.0",
      status: "current",
    },
  ]);
});

test("version comparison normalizes numeric semver segments", () => {
  const cases = [
    { installed: "1.0", marketplace: "1.0.0", verdict: "PASS", status: "current" },
    { installed: "0.10.0", marketplace: "0.9.0", verdict: "PASS", status: "newer_installed" },
    { installed: "0.5.0", marketplace: "0.6.0", verdict: "BLOCK", status: "stale" },
  ] as const;

  for (const { installed, marketplace, verdict, status } of cases) {
    const fx = fixture();
    writeMarketplace(fx, { plugins: { "super-developer": { version: marketplace } } });
    install(fx, "super-developer", installed);

    const result = processInput({ plugin: "super-developer" }, options(fx));

    expect(result.verdict).toBe(verdict);
    expect(result.checked[0]).toMatchObject({
      plugin: "super-developer",
      installedVersion: installed,
      marketplaceVersion: marketplace,
      status,
    });
    if (status === "stale") {
      expect(result.stale.map((check) => check.plugin)).toEqual(["super-developer"]);
    } else {
      expect(result.stale).toEqual([]);
    }
  }
});

test("BLOCK: installed version below marketplace is loud and lists the plugin", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: { "super-developer": { version: "0.6.0" } } });
  install(fx, "super-developer", "0.5.0");

  const result = processInput({ plugin: "super-developer" }, options(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.message).toContain("WHAT: installed xos plugin cache is behind the marketplace catalog.");
  expect(result.message).toContain("⚠ STALE: super-developer installed 0.5.0 < marketplace 0.6.0");
  expect(result.message).toContain("claude plugin install super-developer && /reload-plugins");
  expect(result.stale.map((check) => check.plugin)).toEqual(["super-developer"]);
});

test("CLI exits non-zero and prints the loud stale list on detected skew", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: { "super-developer": { version: "0.6.0" } } });
  install(fx, "super-developer", "0.5.0");

  const result = Bun.spawnSync(
    [
      "bun",
      HANDLER,
      JSON.stringify({
        plugin: "super-developer",
        cache_root: fx.cacheRoot,
        marketplace_path: fx.marketplacePath,
      }),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  expect(result.exitCode).toBe(1);
  expect(decode(result.stdout)).toContain('"verdict":"BLOCK"');
  expect(decode(result.stderr)).toContain("⚠ STALE: super-developer installed 0.5.0 < marketplace 0.6.0");
});

test("BLOCK: missing install is flagged as stale against marketplace", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: [{ name: "super-developer", version: "0.6.0" }] });

  const result = processInput({ plugin: "super-developer" }, options(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.message).toContain("⚠ STALE: super-developer installed missing < marketplace 0.6.0");
  expect(result.stale[0]?.status).toBe("missing_install");
  expect(result.stale[0]?.requires_reload).toBe("super-developer@0.6.0");
});

test("BLOCK: all-mode reports only stale and missing plugins from a mixed catalog", () => {
  const fx = fixture();
  writeMarketplace(fx, {
    plugins: {
      current: { version: "1.0.0" },
      stale: { version: "2.0.0" },
      newer: { version: "2.0.0" },
      missing: { version: "3.0.0" },
    },
  });
  install(fx, "current", "1.0.0");
  install(fx, "stale", "1.9.0");
  install(fx, "newer", "2.1.0");

  const result = processInput({ plugin: "all" }, options(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.stale.map((check) => check.plugin).sort((a, b) => a.localeCompare(b))).toEqual(["missing", "stale"]);
  expect(result.message).toContain("⚠ STALE: stale installed 1.9.0 < marketplace 2.0.0");
  expect(result.message).toContain("⚠ STALE: missing installed missing < marketplace 3.0.0");
  expect(result.message).not.toContain("current installed");
  expect(result.message).not.toContain("newer installed");
});

test("PASS: injected fixture paths avoid the real home/cache", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: { "super-developer": { version: "0.6.0" } } });
  install(fx, "super-developer", "0.6.0");

  const result = processInput({ plugins: ["super-developer"] }, options(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(fx.marketplacePath);
});

test("marketplace parser accepts common catalog shapes", () => {
  const versions = marketplaceVersionsFromJson(
    JSON.stringify({
      plugins: [
        { name: "array-entry", version: "1.0.0" },
        { id: "nested-manifest", manifest: { version: "2.0.0" } },
      ],
      "mapped-entry": { latestVersion: "3.0.0" },
    })
  );

  expect(versions.get("array-entry")).toBe("1.0.0");
  expect(versions.get("nested-manifest")).toBe("2.0.0");
  expect(versions.get("mapped-entry")).toBe("3.0.0");
});
