import { afterEach, expect, test } from "bun:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
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
  writeMarketplace(fx, { plugins: { "exponential-developer": { version: "0.6.0" } } });
  install(fx, "exponential-developer", "0.6.0");

  const result = processInput({ plugin: "exponential-developer" }, options(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("current with marketplace");
  expect(result.checked).toEqual([
    {
      plugin: "exponential-developer",
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
    writeMarketplace(fx, { plugins: { "exponential-developer": { version: marketplace } } });
    install(fx, "exponential-developer", installed);

    const result = processInput({ plugin: "exponential-developer" }, options(fx));

    expect(result.verdict).toBe(verdict);
    expect(result.checked[0]).toMatchObject({
      plugin: "exponential-developer",
      installedVersion: installed,
      marketplaceVersion: marketplace,
      status,
    });
    if (status === "stale") {
      expect(result.stale.map((check) => check.plugin)).toEqual(["exponential-developer"]);
    } else {
      expect(result.stale).toEqual([]);
    }
  }
});

test("BLOCK: installed version below marketplace is loud and lists the plugin", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: { "exponential-developer": { version: "0.6.0" } } });
  install(fx, "exponential-developer", "0.5.0");

  const result = processInput({ plugin: "exponential-developer" }, options(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.message).toContain("WHAT: installed xos plugin cache is behind the marketplace catalog.");
  expect(result.message).toContain("⚠ STALE: exponential-developer installed 0.5.0 < marketplace 0.6.0");
  expect(result.message).toContain("claude plugin install exponential-developer && /reload-plugins");
  expect(result.stale.map((check) => check.plugin)).toEqual(["exponential-developer"]);
});

test("CLI exits non-zero and prints the loud stale list on detected skew", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: { "exponential-developer": { version: "0.6.0" } } });
  install(fx, "exponential-developer", "0.5.0");

  const result = Bun.spawnSync(
    [
      "bun",
      HANDLER,
      JSON.stringify({
        plugin: "exponential-developer",
        cache_root: fx.cacheRoot,
        marketplace_path: fx.marketplacePath,
      }),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  expect(result.exitCode).toBe(1);
  expect(decode(result.stdout)).toContain('"verdict":"BLOCK"');
  expect(decode(result.stderr)).toContain("⚠ STALE: exponential-developer installed 0.5.0 < marketplace 0.6.0");
});

test("BLOCK: missing install is flagged as stale against marketplace", () => {
  const fx = fixture();
  writeMarketplace(fx, { plugins: [{ name: "exponential-developer", version: "0.6.0" }] });

  const result = processInput({ plugin: "exponential-developer" }, options(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.message).toContain("⚠ STALE: exponential-developer installed missing < marketplace 0.6.0");
  expect(result.stale[0]?.status).toBe("missing_install");
  expect(result.stale[0]?.requires_reload).toBe("exponential-developer@0.6.0");
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
  writeMarketplace(fx, { plugins: { "exponential-developer": { version: "0.6.0" } } });
  install(fx, "exponential-developer", "0.6.0");

  const result = processInput({ plugins: ["exponential-developer"] }, options(fx));

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

// ── XOS-444 session-liveness helpers ─────────────────────────────────────────
const NOW = new Date("2026-06-29T12:00:00Z");
const SELF = "41fd91de-50e7-4d8e-9a6f-a3ad60c99628";
const PEER = "5dea2fc2-caf9-4bf6-885c-1fe49c334822";

function session(fx: Fixture, id: string, version: string | null, ageMinutes: number): void {
  const dir = join(fx.root, "sessions");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  writeFileSync(file, JSON.stringify(version === null ? { session_id: id } : { session_id: id, version }));
  const when = new Date(NOW.getTime() - ageMinutes * 60_000);
  utimesSync(file, when, when);
}

/** A publish-ready fixture: catalog and cache agree, so ONLY session state can change the verdict. */
function filesAgree(fx: Fixture): void {
  writeMarketplace(fx, { plugins: { "exponential-developer": { version: "1.0.0" } } });
  install(fx, "exponential-developer", "1.0.0");
  install(fx, "co-dialectic", "4.47.5");
}

function sessionOptions(fx: Fixture, sessionId: string | null): ProcessOptions {
  return { ...options(fx), sessionsDir: join(fx.root, "sessions"), sessionId: sessionId ?? undefined, now: NOW };
}

test("BLOCK: the publishing session itself has not loaded the installed plugin", () => {
  // Anand, 2026-11-23: "there should be a gate that verifies that it has loaded itself and
  // others loaded as well. that is the codification of the prose."
  // The file checks all PASS here on purpose -- catalog 1.0.0 == cache 1.0.0 -- so this test
  // fails for exactly one reason: the session is running code it did not load from disk.
  // Measured live before this was written: four co-dialectic versions in flight at once while
  // catalog and cache both read 4.47.5.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.0", 1);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("BLOCK");
  expect(result.message).toContain("has NOT loaded the installed plugin");
  // The remediation must name THIS session, not advise that "someone" should reload.
  expect(result.message).toContain(`claude --resume ${SELF}`);
  expect(result.sessions?.selfStale).toBe(true);
});

test("PASS: the publishing session has loaded the installed plugin", () => {
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("PASS");
  expect(result.sessions?.selfStale).toBe(false);
  expect(result.sessions?.self?.version).toBe("4.47.5");
});

test("an unknown self session does not block: absent evidence is not evidence of staleness", () => {
  // No session id, or a session file that was never written, must not fabricate a verdict.
  // This is the fail-open that IS correct -- the gate has nothing to say about self, and says so.
  const fx = fixture();
  filesAgree(fx);
  session(fx, PEER, "4.47.5", 1);

  expect(processInput({ plugin: "exponential-developer" }, sessionOptions(fx, null)).verdict).toBe("PASS");
  expect(processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF)).sessions?.self).toBeNull();
});

test("synthetic session ids are not sessions", () => {
  // Benchmarking has twice polluted ~/.codialectic/sessions with ids like verify-1/2/3, and a
  // retracted XOS-436 claim came from counting them. A fleet measurement that counts test
  // artifacts reports a fleet that does not exist.
  const fx = fixture();
  filesAgree(fx);
  session(fx, "verify-1", "4.36.0", 1);
  session(fx, "verify-2", "4.36.0", 1);
  session(fx, "x", "4.36.0", 1);
  session(fx, SELF, "4.47.5", 1);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("PASS");
  expect(result.sessions?.stalePeers).toEqual([]);
  expect(result.sessions?.livePeers).toBe(0);
});

test("a stale PEER is reported, never gated on", () => {
  // Deliberate product boundary: blocking Anand's release because someone else's terminal is
  // old is a call he owns, so the handler surfaces the peer and keeps the verdict PASS.
  // If that policy changes, this test is the thing that must change with it.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  session(fx, PEER, "4.36.0", 2);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("PASS");
  expect(result.sessions?.stalePeers.map((entry) => entry.sessionId)).toEqual([PEER]);
  expect(result.sessions?.stalePeers[0]?.version).toBe("4.36.0");
});

test("an abandoned session is not a stale peer", () => {
  // 30 minutes, matching the SDLC WORK-CLAIM invariant's existing staleness threshold rather
  // than inventing a second definition of "live" for the same swarm.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  session(fx, PEER, "4.36.0", 31);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.sessions?.stalePeers).toEqual([]);
  expect(result.sessions?.livePeers).toBe(0);
});

test("a session file with no version is not counted as stale", () => {
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, null, 1);
  session(fx, PEER, null, 1);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("PASS");
  expect(result.sessions?.selfStale).toBe(false);
  expect(result.sessions?.stalePeers).toEqual([]);
});

test("UNKNOWN, never PASS, when the gate could not check anything", () => {
  // The defect this ticket was filed for: `verdict: PASS, checked: []`. A publish gate that
  // cannot find its reference data reported a green a caller could quote as evidence.
  // PASS with an empty `checked` is now unrepresentable, not merely discouraged.
  const fx = fixture();
  const result = processInput({ plugin: "exponential-developer" }, options(fx));

  expect(result.verdict).toBe("UNKNOWN");
  expect(result.checked).toEqual([]);
  expect(result.message).toContain("WHAT:");
  expect(result.message).toContain("HOW:");
  expect(result.message).toContain("SIBLING");
});

test("the marketplace is found as a SIBLING of the repo, not a child of it", () => {
  // handler.ts resolved only `cwd/agent-marketplace/...`. Stage 9 legitimately runs from the
  // source repo, where that path cannot exist -- so the gate found nothing, checked nothing,
  // and (with the old fail-open) returned PASS.
  const fx = fixture();
  // The marketplace is a TRUE sibling: workspace/{xos,agent-marketplace}, cwd inside xos.
  // homeDir points somewhere with NO marketplace, so the home fallback cannot rescue this --
  // the first version of this test set homeDir=fx.root, where writeMarketplace had already
  // put a catalog, so it passed via the fallback and proved nothing about the walk.
  const workspace = join(fx.root, "workspace");
  const repo = join(workspace, "xos", "plugins", "cross", "exponential-developer");
  const sibling = join(workspace, "agent-marketplace", ".claude-plugin", "marketplace.json");
  mkdirSync(repo, { recursive: true });
  mkdirSync(dirname(sibling), { recursive: true });
  writeFileSync(sibling, JSON.stringify({ plugins: { "exponential-developer": { version: "1.0.0" } } }));
  install(fx, "exponential-developer", "1.0.0");
  const emptyHome = join(fx.root, "empty-home");
  mkdirSync(emptyHome, { recursive: true });

  const result = processInput(
    { plugin: "exponential-developer", cwd: repo },
    { installedCacheRoot: fx.cacheRoot, homeDir: emptyHome, logPath: fx.logPath, now: NOW, sessionsDir: join(fx.root, "sessions") },
  );

  expect(result.verdict).toBe("PASS");
  expect(result.target).toBe(sibling);
  expect(result.checked).toHaveLength(1);
});

test("the catalog envelope is not a plugin", () => {
  // Found by DOGFOODING the installed 1.10.0 against the real catalog, not by a unit test:
  // the gate BLOCKed with `⚠ STALE: $schema installed missing < marketplace
  // https://anthropic.com/claude-code/marketplace.schema.json`. The root object is an
  // envelope -- {$schema, name, owner, metadata, plugins} -- and scanning it turned a JSON
  // Schema reserved key into a plugin that can never be installed, so every run blocked.
  // Latent until XOS-444 fixed path resolution: the gate had never resolved a catalog to
  // misparse one.
  const parsed = marketplaceVersionsFromJson(
    JSON.stringify({
      $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
      name: "agent-marketplace",
      owner: { name: "Exponential-OS" },
      plugins: [{ name: "exponential-developer", version: "1.10.0" }],
    }),
  );

  expect([...parsed.keys()]).toEqual(["exponential-developer"]);
  expect(parsed.get("exponential-developer")).toBe("1.10.0");
});

test("a catalog envelope does not make the gate block", () => {
  // The end-to-end shape of the same bug: verdict, not just the parse.
  const fx = fixture();
  writeMarketplace(fx, {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "agent-marketplace",
    plugins: [{ name: "exponential-developer", version: "1.0.0" }],
  });
  install(fx, "exponential-developer", "1.0.0");
  install(fx, "co-dialectic", "4.47.5");
  session(fx, SELF, "4.47.5", 1);

  const result = processInput({}, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("PASS");
  expect(result.stale).toEqual([]);
});
