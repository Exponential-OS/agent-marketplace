import { afterEach, expect, test } from "bun:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
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

test("the peer window is a day's work, not the work-claim's 30 minutes", () => {
  // This was 30 minutes, copied from SDLC WORK-CLAIM. Sharing a word is not sharing a
  // definition: that invariant answers "may I steal this ticket" (wrong => you reclaim from
  // someone active, so SHORT is right), this answers "whose terminal runs stale code" (wrong
  // => a peer runs old code all day unreported, so short is exactly backwards).
  // Measured: of 14 stale sessions here, 30 minutes reported THREE. A peer sat at 23 minutes
  // while mid-build -- the Stop hook stamps only when a turn COMPLETES, so reading rather
  // than running tools looks identical to being dead.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  session(fx, PEER, "4.36.0", 90); // would have been invisible at 30 minutes

  const within = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));
  expect(within.sessions?.stalePeers.map((entry) => entry.sessionId)).toEqual([PEER]);
});

test("a session abandoned for more than a day is not a peer", () => {
  // Unbounded is wrong too, which only the full population shows: 2,621 session files exist
  // on this machine, 2,432 of them older than a week. Reporting those is noise, and parsing
  // them is the 1,211ms this gate used to spend per invocation.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  session(fx, PEER, "4.36.0", 25 * 60);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.sessions?.stalePeers).toEqual([]);
  expect(result.sessions?.livePeers).toBe(0);
});

test("SELF is exempt from the window entirely", () => {
  // A session evaluating ITSELF is live by definition -- the window is about judging other
  // people's terminals. A long-running session whose last turn completed days ago must still
  // be told it is running stale code, which means it must be READ despite its mtime.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.0", 40 * 24 * 60); // 40 days of quiet, still this session

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("BLOCK");
  expect(result.sessions?.selfStale).toBe(true);
  expect(result.sessions?.self?.version).toBe("4.47.0");
});

test("files outside the window are never opened, only stat-ed", () => {
  // The perf half, asserted structurally rather than by timing. 2,621 files were being read
  // and JSON-parsed to use 19 -- the same load-everything shape as the gigabyte-transcript
  // read fixed in the sibling plugin. A publish gate that costs a second per call is a reason
  // not to wire it.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  session(fx, PEER, "4.36.0", 25 * 60);

  const opened: string[] = [];
  const base = sessionOptions(fx, SELF);
  const result = processInput(
    { plugin: "exponential-developer" },
    {
      ...base,
      readText: (path: string) => {
        opened.push(path);
        return readFileSync(path, "utf8");
      },
    },
  );

  expect(result.verdict).toBe("PASS");
  const sessionReads = opened.filter((path) => path.includes("sessions"));
  expect(sessionReads.some((path) => path.includes(SELF))).toBe(true);
  expect(sessionReads.some((path) => path.includes(PEER))).toBe(false);
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

test("a stale plugin does not hide a stale session", () => {
  // Session state used to be computed AFTER the stale-plugin early return, so whenever any
  // plugin was stale the session check silently did not run. The caller fixed the plugin,
  // re-ran, and only then learned their session was stale too -- one problem per round trip,
  // which is this ticket's own defect class wearing a different hat. Observed live: `jury`
  // missing from the cache meant `sessions` came back undefined on a real run.
  const fx = fixture();
  writeMarketplace(fx, {
    plugins: [
      { name: "exponential-developer", version: "1.0.0" },
      { name: "jury", version: "0.2.0" },
    ],
  });
  install(fx, "exponential-developer", "1.0.0");
  install(fx, "co-dialectic", "4.47.5");
  // jury deliberately NOT installed -> stale, triggering the early return.
  session(fx, SELF, "4.47.0", 1);

  const result = processInput({}, sessionOptions(fx, SELF));

  expect(result.verdict).toBe("BLOCK");
  expect(result.stale.map((check) => check.plugin)).toEqual(["jury"]);
  // ...and the session problem is reported in the SAME pass, not discovered on the next one.
  expect(result.sessions?.selfStale).toBe(true);
  expect(result.sessions?.self?.version).toBe("4.47.0");
});

test("the data picks the boundary, not a hand-chosen number", () => {
  // Real ages here, in minutes: 0.3 1.5 2.3 4.8 7.5 7.6 8.2 8.3 9.1 9.5 10.5 | 305 306 ... 2423
  // EVERY cutoff between 10 and 305 produces an identical report, so 30m and 2h and 4h were
  // the same number. Moving 30m -> 24h did nothing until it crossed 305 and swallowed a whole
  // second cluster, which is why the report jumped 3 -> 22 with nothing useful in between.
  // That is choosing a side of a chasm by hand, and nobody revisits a hand-picked number.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  const near = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"];
  const far = ["bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002"];
  for (const id of near) session(fx, id, "4.36.0", 5);
  for (const id of far) session(fx, id, "4.36.0", 300);

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.sessions?.gapFound).toBe(true);
  // localeCompare, not bare .sort(): the default sorts by UTF-16 code unit, which is not the
  // alphabetical order the assertion claims to check. Caught by SonarCloud S2871 as a
  // reliability bug, and it is one -- a comparator-less sort works until the data changes.
  expect(result.sessions?.stalePeers.map((entry) => entry.sessionId).sort((a, b) => a.localeCompare(b))).toEqual(near);
  expect(result.sessions?.dormantCount).toBe(2);
});

test("when ages are continuous it says so instead of inventing a cut", () => {
  // The honest-degradation half. If the gap ever closes, the report must admit there is no
  // natural boundary rather than silently reverting to a threshold nobody revisits.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  const ids = [
    "cccccccc-0000-4000-8000-000000000001",
    "cccccccc-0000-4000-8000-000000000002",
    "cccccccc-0000-4000-8000-000000000003",
  ];
  ids.forEach((id, i) => session(fx, id, "4.36.0", 10 + i * 5)); // 10, 15, 20 -- no 4x step

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  expect(result.sessions?.gapFound).toBe(false);
  expect(result.sessions?.stalePeers).toHaveLength(3);
  expect(result.sessions?.dormantCount).toBe(0);
});

test("the report's length does not track the size of history", () => {
  // ⛔ cyborg/rules/branch-hygiene shipped with 12 tests and took a repo from 612 branches to
  // 117 on its first run. Deleted 2026-11-13 (bd5b0852c) because it was, in the Constitution's
  // words, "accurate noise, reporting 164 local / 46 unpushed branches on every single turn
  // whether or not anyone could act on it." Anand: "they are too annoying." It did not die of
  // being WRONG. A report whose length tracks population rather than actionability gets
  // skimmed, and a skimmed report is worth what a gate that checked nothing is worth.
  const fx = fixture();
  filesAgree(fx);
  session(fx, SELF, "4.47.5", 1);
  session(fx, PEER, "4.36.0", 5);
  for (let i = 0; i < 60; i += 1) {
    session(fx, `dddddddd-0000-4000-8000-${String(i).padStart(12, "0")}`, "4.36.0", 40 * 24 * 60);
  }

  const result = processInput({ plugin: "exponential-developer" }, sessionOptions(fx, SELF));

  // One actionable row, and a COUNT for the 60 that are not.
  expect(result.sessions?.stalePeers).toHaveLength(1);
  expect(result.sessions?.archivedCount).toBe(60);
});
