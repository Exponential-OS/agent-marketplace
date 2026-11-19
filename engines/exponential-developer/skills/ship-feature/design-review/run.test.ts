import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  classifyAdjustment,
  parseStructuredVerdict,
  resolvePrimaryReviewerModel,
  resolveReviewerCandidates,
  runDesignReview,
  sanitizedEnv,
  sha256Text,
  shouldSkip,
  sidecarPathForSpec,
  type ReviewerCommand,
} from "./run";
import { hasValidVerdict } from "../../../rules/design-review-gate/handler";

const tempDirs: string[] = [];

interface Fixture {
  root: string;
  specPath: string;
  sidecarPath: string;
}

function fixture(manifest = "+ added     src/feature.ts          - new behavior\n~ modified  src/index.ts            - route behavior\n"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "design-review-run-"));
  tempDirs.push(root);
  const specPath = join(root, "docs", "plans", "feature.md");
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(
    specPath,
    [
      "# Feature",
      "status: design",
      "slug: feature",
      "",
      "## What",
      "Build a visible feature with observable behavior.",
      "",
      "## Acceptance criteria",
      "- [ ] The user can complete the feature flow.",
      "",
      "## Test plan",
      "- [ ] Run the feature test.",
      "",
      "## Change manifest",
      manifest,
      "",
    ].join("\n")
  );
  return { root, specPath, sidecarPath: sidecarPathForSpec(specPath) };
}

function reviewer(stdout: string, ok = true): ReviewerCommand {
  return () => ({ ok, stdout, stderr: ok ? "" : "unreachable", exitCode: ok ? 0 : 1, model: "claude-fable-5", family: "anthropic" });
}

function echoModelReviewer(models: string[]): ReviewerCommand {
  return (_prompt, context) => {
    models.push(context.model);
    return {
      ok: true,
      stdout: '{"verdict":"YELLOW","findings":[{"severity":"YELLOW","lens":"cost-routing","fix":"Keep the model selection explicit."}]}',
      stderr: "",
      exitCode: 0,
      model: context.model,
      family: context.family,
    };
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("reviewer unreachable records UNREACHABLE and gate would BLOCK", async () => {
  const fx = fixture();
  const result = await runDesignReview(fx.specPath, {
    reviewer: reviewer("", false),
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(result.exitCode).toBe(1);
  expect(result.record.verdict).toBe("UNREACHABLE");
  expect(existsSync(fx.sidecarPath)).toBe(true);

  const gate = hasValidVerdict(fx.specPath);
  expect(gate.ok).toBe(false);
  expect(gate.reason).toContain("unreachable");
});

test("verdict parse happy path extracts structured JSON", () => {
  const parsed = parseStructuredVerdict(
    'review complete\n```json\n{"verdict":"YELLOW","findings":[{"severity":"YELLOW","lens":"simplicity","fix":"Clarify the rollout note."}]}\n```'
  );

  expect(parsed).toEqual({
    verdict: "YELLOW",
    findings: [{ severity: "YELLOW", lens: "simplicity", fix: "Clarify the rollout note." }],
  });
});

test("primary reviewer model defaults to claude-fable-5 when DESIGN_REVIEW_MODEL is unset", async () => {
  const fx = fixture();
  const models: string[] = [];
  const result = await runDesignReview(fx.specPath, {
    env: {},
    reviewer: echoModelReviewer(models),
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(resolvePrimaryReviewerModel({})).toBe("claude-fable-5");
  expect(models).toEqual(["claude-fable-5"]);
  expect(result.record.reviewer_model).toBe("claude-fable-5");
});

test("DESIGN_REVIEW_MODEL overrides the primary reviewer model and sidecar record", async () => {
  const fx = fixture();
  const models: string[] = [];
  const result = await runDesignReview(fx.specPath, {
    env: { DESIGN_REVIEW_MODEL: "claude-sonnet-4-20250514" },
    reviewer: echoModelReviewer(models),
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(models).toEqual(["claude-sonnet-4-20250514"]);
  expect(result.record.reviewer_model).toBe("claude-sonnet-4-20250514");
});

test("sanitizedEnv preserves DESIGN_REVIEW_MODEL while stripping API keys", () => {
  const clean = sanitizedEnv({
    DESIGN_REVIEW_MODEL: "claude-sonnet-4-20250514",
    OPENAI_API_KEY: "secret",
    KEEP_ME: "1",
  });

  expect(clean.DESIGN_REVIEW_MODEL).toBe("claude-sonnet-4-20250514");
  expect(clean.KEEP_ME).toBe("1");
  expect(clean.OPENAI_API_KEY).toBeUndefined();
});

test("default reviewer spawn receives resolved model and sanitized DESIGN_REVIEW_MODEL env", async () => {
  const fx = fixture();
  let command: string[] = [];
  let childEnv: Record<string, string> = {};
  const result = await runDesignReview(fx.specPath, {
    env: {
      DESIGN_REVIEW_MODEL: "claude-opus-4-20250514",
      OPENAI_API_KEY: "secret",
      KEEP_ME: "1",
    },
    commandRunner: (cmd, options) => {
      command = cmd;
      childEnv = options.env;
      return {
        ok: true,
        stdout: '{"verdict":"YELLOW","findings":[{"severity":"YELLOW","lens":"cost-routing","fix":"Keep the configured reviewer model visible."}]}',
        stderr: "",
        exitCode: 0,
      };
    },
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(command.slice(0, 3)).toEqual(["claude", "--model", "claude-opus-4-20250514"]);
  expect(childEnv.DESIGN_REVIEW_MODEL).toBe("claude-opus-4-20250514");
  expect(childEnv.KEEP_ME).toBe("1");
  expect(childEnv.OPENAI_API_KEY).toBeUndefined();
  expect(result.record.reviewer_model).toBe("claude-opus-4-20250514");
});

test("classifyAdjustment returns A, B, and ambiguous defaults to B", () => {
  expect(classifyAdjustment("Clarify the wording in the rollback note.")).toBe("A");
  expect(classifyAdjustment("Clarify that existing behavior is unchanged.")).toBe("A");
  expect(classifyAdjustment("Remove a required acceptance criterion from the DoD.")).toBe("B");
  expect(classifyAdjustment("No behavior change, but remove a requirement.")).toBe("B");
  expect(classifyAdjustment("Tighten the thing so it feels better.")).toBe("B");
});

test("second RED writes escalation artifact and parks", async () => {
  const fx = fixture();
  writeFileSync(
    fx.sidecarPath,
    JSON.stringify(
      {
        verdict: "RED",
        findings: [{ severity: "RED", lens: "theater", fix: "Add a real behavior change." }],
        spec_sha256: sha256Text(readFileSync(fx.specPath, "utf8")),
        manifest_sha256: sha256Text("manifest"),
        reviewer_model: "claude-fable-5",
        reviewer_family: "anthropic",
        cross_family: { status: "not_required" },
        cycle: 1,
        timestamp: "2026-07-03T10:00:00Z",
      },
      null,
      2
    ) + "\n"
  );

  const result = await runDesignReview(fx.specPath, {
    reviewer: reviewer('{"verdict":"RED","findings":[{"severity":"RED","lens":"verifiability","fix":"Make the DoD objectively testable."}]}'),
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(result.exitCode).toBe(1);
  expect(result.parked).toBe(true);
  expect(result.record.cycle).toBe(2);
  expect(result.record.escalation_artifact).toBe(result.escalationPath);
  expect(result.escalationPath).toBeTruthy();
  expect(existsSync(result.escalationPath!)).toBe(true);
  expect(readFileSync(result.escalationPath!, "utf8")).toContain("second RED");
});

test("skip-rule fires on mechanical manifest", async () => {
  const mechanical = [
    "+ added     docs/usage.md          - docs only",
    "~ modified  CHANGELOG.md           - version note",
    "~ modified  .claude-plugin/plugin.json - version bump",
  ].join("\n");
  expect(shouldSkip(mechanical)).toEqual({ skip: true, rule: "mechanical-manifest:file_count<=5" });

  const fx = fixture(mechanical);
  const result = await runDesignReview(fx.specPath, {
    reviewer: () => {
      throw new Error("reviewer should not be called for mechanical skip");
    },
    now: new Date("2026-07-03T12:00:00Z"),
  });
  expect(result.record.verdict).toBe("SKIPPED");
  expect(result.exitCode).toBe(0);
});

test("skip-rule does not fire on a feature manifest", () => {
  const featureManifest = [
    "+ added     src/feature.ts          - new behavior",
    "~ modified  src/index.ts            - public route",
    "new_public_surface: true",
    "behavior_flag: true",
  ].join("\n");

  expect(shouldSkip(featureManifest)).toEqual({ skip: false });
});

// XOS-204: source-bound diagnostics and budget regressions.
import { spyOn } from "bun:test";
import { resolveReviewerTimeoutMs, resolveTotalBudgetMs, type ReviewerCliResult } from "./run";

const yellowOutput = '{"verdict":"YELLOW","findings":[]}';

test("reviewer timeout parsing honors usable intent", () => {
  for (const [value, expected] of [
    [undefined, 300000], ["450000", 450000], ["1000000", 900000],
    // Under-range clamps UP to the minimum usable call (90s), not to some lower bound.
    // 30_000 used to be legal here while the runtime floor demanded 90_000, so an
    // in-range config produced a call that could not finish and then reported
    // reason:"timeout". One constant now governs both, so that is unconfigurable.
    ["1000", 90000], ["30000", 90000], ["89999", 90000], ["90000", 90000],
    ["0", 300000], ["-5000", 300000], ["abc", 300000], ["", 300000], ["Infinity", 300000],
  ] as const) expect(resolveReviewerTimeoutMs({ DESIGN_REVIEW_TIMEOUT_MS: value })).toBe(expected);
});

test("no configurable budget can be smaller than one usable call", () => {
  // The property, not the instances: whatever an operator writes, neither resolver can
  // hand back a budget too small to complete a measured 87-190s reviewer call. A doomed
  // call that reports "timeout" is the D1 defect wearing a different hat.
  for (const v of ["1", "1000", "30000", "59999", "89999", "0", "-1", "abc", ""]) {
    expect(resolveReviewerTimeoutMs({ DESIGN_REVIEW_TIMEOUT_MS: v })).toBeGreaterThanOrEqual(90000);
    expect(resolveTotalBudgetMs({ DESIGN_REVIEW_TOTAL_BUDGET_MS: v })).toBeGreaterThanOrEqual(90000);
  }
});

test("probe keeps its own budget at all three reviewer call sites", async () => {
  for (const available of ["gemini", "codex"]) {
    const calls: Array<[string, number | undefined]> = [];
    await runDesignReview(fixture().specPath, {
      tier: "T3", env: { DESIGN_REVIEW_TIMEOUT_MS: "450000" }, monotonicNow: () => 0,
      commandRunner: (cmd, options) => {
        calls.push([cmd[0], options.timeout]);
        // ok and exitCode must agree -- a real runner sets ok = (exitCode === 0), so
        // {ok:false, exitCode:0} is a shape no runner can produce. An absent CLI is
        // `command -v` exiting 1.
        const found = cmd[0] !== "sh" || cmd[2].includes(available);
        return cmd[0] === "sh"
          ? { ok: true, stdout: `XOSPROBE:${found ? 0 : 1}`, exitCode: 0 }
          : { ok: true, stdout: yellowOutput, exitCode: 0 };
      },
    });
    expect(calls).toEqual(available === "gemini"
      ? [["claude", 450000], ["sh", 5000], ["gemini", 450000]]
      : [["claude", 450000], ["sh", 5000], ["sh", 5000], ["codex", 450000]]);
  }
});

async function blocked(result: ReviewerCliResult) {
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, { env: {}, commandRunner: () => result });
  const disk = JSON.parse(readFileSync(fx.sidecarPath, "utf8"));
  expect(disk).toEqual(run.record);
  expect(run.exitCode).toBe(1);
  expect(disk.verdict).toBe("UNREACHABLE");
  expect(hasValidVerdict(fx.specPath).ok).toBe(false);
  return disk;
}

test("timeout reason preserves runner evidence and blocks", async () => {
  const record = await blocked({ ok: false, stdout: "", exitCode: null, timedOut: true, elapsedMs: 300123 });
  expect(record.reason).toBe("timeout");
  expect(record.elapsed_ms).toBe(300123);
  expect(record.exit_code).toBeNull();
});

test("unreachable reasons are distinguishable", async () => {
  const reasons: string[] = [];
  for (const [result, reason] of [
    [{ ok: false, stdout: "", exitCode: null, timedOut: true }, "timeout"],
    [{ ok: false, stdout: "", exitCode: 127, timedOut: false }, "cli_missing"],
    [{ ok: false, stdout: "", exitCode: 3, timedOut: false }, "nonzero_exit"],
    [{ ok: true, stdout: "I think this is fine", exitCode: 0, timedOut: false }, "unparseable"],
  ] as const) {
    const record = await blocked(result);
    expect(record.reason).toBe(reason);
    reasons.push(record.reason);
  }
  expect(new Set(reasons).size).toBe(4);

  // Exercise the real adapter, not just injected normalized results.
  //
  // `advance` is how much wall clock the spawn consumes, injected through
  // monotonicNow so this runs in milliseconds instead of burning the real 285s
  // threshold. It is the whole point of the pair of SIGTERM rows below:
  //
  //   SIGTERM at the full budget  -> OUR timeout killed it          -> "timeout"
  //   SIGTERM after 1s            -> something else killed it       -> "unknown"
  //
  // A signal alone cannot establish why a process terminated, and neither can
  // elapsed time alone. Claiming "timeout" on an external kill is a confident wrong
  // label, which is the exact defect (D1) this whole change exists to remove.
  // expected calls == 1 + retries; only nonzero_exit advances the ladder (XOS-413).
  // The count is a PROPERTY OF THE REASON, not a constant: a timeout proves the model is
  // reachable and the work is slow, so advancing would multiply wall-clock rather than
  // find a working model.
  for (const [exitCode, signalCode, advance, expected, calls] of [
    [null, "SIGTERM", 300_000, "timeout", 1],
    [null, "SIGTERM", 1_000, "unknown", 1],
    [127, undefined, 40, "cli_missing", 1],
    [3, undefined, 900, "nonzero_exit", 3],
  ] as const) {
    let now = 0;
    const spawn = spyOn(Bun, "spawnSync").mockImplementation((() => {
      now += advance;
      return { exitCode, signalCode, stdout: new Uint8Array(), stderr: new Uint8Array() };
    }) as typeof Bun.spawnSync);
    try {
      const run = await runDesignReview(fixture().specPath, { env: {}, monotonicNow: () => now });
      expect(run.record.reason).toBe(expected);
      expect(run.record.signal).toBe(signalCode ?? null); // evidence preserved either way
      expect(run.exitCode).toBe(1);
      expect(spawn).toHaveBeenCalledTimes(calls);
    } finally { spawn.mockRestore(); }
  }
});

test("stderr tail retains the last line and bounds the record", async () => {
  const record = await blocked({ ok: false, stdout: "", stderr: "x".repeat(50000) + "\nLAST ERROR", exitCode: 3 });
  expect(record.stderr_tail.length).toBeGreaterThan(0);
  expect(record.stderr_tail.length).toBeLessThanOrEqual(2000);
  expect(record.stderr_tail.endsWith("LAST ERROR")).toBe(true);
});

test("ANTHROPIC_API_KEY is stripped", () => {
  expect(sanitizedEnv({ ANTHROPIC_API_KEY: "sk-ant-x" }).ANTHROPIC_API_KEY).toBeUndefined();
});

test("any _API_KEY is stripped by property, binding the header claim", () => {
  const env = { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x", GEMINI_API_KEY: "x", GOOGLE_API_KEY: "x",
    FUTURE_PROVIDER_API_KEY: "x", DESIGN_REVIEW_MODEL: "model", KEEP_ME: "yes" };
  const clean = sanitizedEnv(env);
  for (const key of Object.keys(env).filter(key => /_API_KEY$/.test(key))) expect(clean[key]).toBeUndefined();
  expect(clean).toEqual({ DESIGN_REVIEW_MODEL: "model", KEEP_ME: "yes" });
});

test("ANTHROPIC_AUTH_TOKEN is stripped while OAuth survives", () => {
  expect(sanitizedEnv({ ANTHROPIC_AUTH_TOKEN: "paid", CLAUDE_CODE_OAUTH_TOKEN: "subscription" }))
    .toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "subscription" });
});

test("unknown reason preserves a null exit code and blocks", async () => {
  const record = await blocked({ ok: false, stdout: "", exitCode: null, timedOut: false });
  expect(record.reason).toBe("unknown");
  expect(record.exit_code).toBeNull();
});

test("total budget limits each call and prevents a doomed retry", async () => {
  let clock = 0;
  const calls: number[] = [];
  const run = await runDesignReview(fixture().specPath, {
    env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "200000" }, monotonicNow: () => clock,
    commandRunner: (_cmd, options) => {
      calls.push(options.timeout!);
      clock += 195000;
      return calls.length === 1 ? { ok: true, stdout: "prose", exitCode: 0, elapsedMs: 195000 }
        : { ok: false, stdout: "", exitCode: null, timedOut: true, elapsedMs: 5000 };
    },
  });
  expect(calls).toEqual([200000]);
  expect(run.record.reason).toBe("budget_exhausted");
  expect(run.record.elapsed_ms).toBe(195000);
  expect(run.exitCode).toBe(1);
  expect(hasValidVerdict(run.sidecarPath.replace(/\.design-review\.json$/, ".md")).ok).toBe(false);
});

test("total budget includes probes and reaches the exact usable floor", async () => {
  for (const spent of [99999, 100000, 100001]) {
    let clock = 0;
    const calls: Array<[string, number | undefined]> = [];
    const run = await runDesignReview(fixture().specPath, {
      tier: "T3", env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "200000", DESIGN_REVIEW_TIMEOUT_MS: "150000" },
      monotonicNow: () => clock,
      commandRunner: (cmd, options) => {
        calls.push([cmd[0], options.timeout]);
        if (cmd[0] === "claude") clock += spent;
        if (cmd[0] === "sh") clock += 10000;
        // A probe must emit the sentinel to count as having RUN; gemini reports present.
        return cmd[0] === "sh"
          ? { ok: true, stdout: "XOSPROBE:0", exitCode: 0 }
          : { ok: true, stdout: yellowOutput, exitCode: 0 };
      },
    });
    expect(calls).toEqual(spent <= 100000
      ? [["claude", 150000], ["sh", 5000], ["gemini", 190000 - spent]]
      : [["claude", 150000], ["sh", 5000]]);
    if (spent > 100000) {
      expect(run.record.cross_family).toMatchObject({ status: "unavailable", reason: "budget_exhausted" });
      expect(run.record.verdict).toBe("YELLOW");
      expect(run.record.reason).toBeUndefined();
      expect(run.exitCode).toBe(0);
    }
  }
});

test("documented invocation explicitly budgets the enclosing Bash call", () => {
  const skill = readFileSync(join(import.meta.dir, "..", "SKILL.md"), "utf8");
  const line = skill.split("\n").find(line => line.startsWith("**Enforcement.**") && line.includes("design-review/run.ts"))!;
  const timeout = line.match(/timeout:\s*(\d+)/);
  expect(timeout).not.toBeNull();
  expect(Number(timeout![1])).toBe(600000);
  expect(Number(timeout![1])).toBeGreaterThan(resolveTotalBudgetMs({}));
  expect(line).toContain("120_000");
  expect(line).toContain("outer kill writes no sidecar");
});

test("total budget parsing shares fallback and clamping semantics", () => {
  for (const [value, expected] of [
    [undefined, 540000], ["200000", 200000], ["4000000", 3600000],
    // Same unified minimum: a TOTAL below one usable call would guarantee
    // budget_exhausted on the first call, which is a budget that cannot be spent.
    // The TOTAL minimum is 120_000, deliberately ABOVE the 90_000 per-call floor: the
    // clock starts at ReviewBudget construction, so spec loading and prompt building
    // spend before the first call is admitted. A total of exactly 90_000 would
    // budget_exhaust before placing any call -- legal, and guaranteed to fail.
    ["1000", 120000], ["90000", 120000], ["119999", 120000], ["120000", 120000],
    ["0", 540000], ["-5000", 540000], ["abc", 540000], ["", 540000], ["Infinity", 540000],
  ] as const) expect(resolveTotalBudgetMs({ DESIGN_REVIEW_TOTAL_BUDGET_MS: value })).toBe(expected);
});

/**
 * Drives the REAL defaultCommandRunner (no injected commandRunner), so the timeout
 * classification is exercised through the adapter rather than around it.
 *
 * The clock is injected via monotonicNow rather than by spying on performance.now:
 * the runner takes `options.monotonicNow ?? (() => performance.now())`, so an
 * explicit injection is what it actually reads, and a global spy would be silently
 * overridden by any monotonicNow the caller passes. Same clock feeds ReviewBudget,
 * which is correct -- a call that burned 300s really did consume 300s of the total.
 */
async function adapterFailure(signalCode: string | undefined, elapsed: number, exitCode: number | null = null) {
  let clock = 0;
  const spawn = spyOn(Bun, "spawnSync").mockImplementation((() => {
    clock += elapsed;
    return { exitCode, signalCode, stdout: new Uint8Array(), stderr: new Uint8Array() };
  }) as typeof Bun.spawnSync);
  try {
    const fx = fixture();
    const run = await runDesignReview(fx.specPath, { env: {}, monotonicNow: () => clock });
    expect(run.exitCode).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    const disk = JSON.parse(readFileSync(fx.sidecarPath, "utf8"));
    expect(disk).toEqual(run.record);
    return disk;
  } finally { spawn.mockRestore(); }
}

test("external SIGTERM stays unknown and preserves signal evidence", async () => {
  for (const elapsed of [1, 284999]) {
    const record = await adapterFailure("SIGTERM", elapsed);
    expect(record.reason).toBe("unknown");
    expect(record.signal).toBe("SIGTERM");
    expect(record.elapsed_ms).toBe(elapsed);
    expect(record.exit_code).toBeNull();
  }
});

test("ordinary timeout requires SIGTERM and elapsed at granted budget tolerance", async () => {
  for (const elapsed of [285000, 300123]) {
    const record = await adapterFailure("SIGTERM", elapsed);
    expect(record.reason).toBe("timeout");
    expect(record.signal).toBe("SIGTERM");
  }
});

test("elapsed alone cannot prove timeout even for a missing CLI", async () => {
  for (const elapsed of [1, 300123]) {
    const record = await adapterFailure(undefined, elapsed, 127);
    expect(record.reason).toBe("cli_missing");
    expect(record.signal).toBeNull();
  }
});

test("unknown elapsed is null while measured zero stays zero", async () => {
  for (const elapsedMs of [undefined, 0, 123]) {
    const record = await blocked({ ok: false, stdout: "", exitCode: null, elapsedMs });
    expect(record.elapsed_ms).toBe(elapsedMs ?? null);
  }
});

test("exhausted spot-check preserves a clean GREEN primary", async () => {
  let clock = 0;
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, {
    env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "200000" }, monotonicNow: () => clock,
    reviewer: () => { clock = 110001; return { ok: true, stdout: '{"verdict":"GREEN","findings":[]}' }; },
    crossFamilyReviewer: () => { throw new Error("doomed spot-check must not run"); },
  });
  expect(run.record.verdict).toBe("GREEN");
  expect(run.record.findings).toEqual([]);
  expect(run.record.cross_family).toMatchObject({ status: "unavailable", reason: "budget_exhausted" });
  expect(run.exitCode).toBe(0);
  expect(hasValidVerdict(fx.specPath).ok).toBe(true);
});

test("probe denial reports budget exhaustion, never a missing CLI", async () => {
  // The distinction this asserts: `commandAvailable` returning false has two possible
  // causes, and they call for opposite responses from an operator.
  //
  //   remaining <  PROBE_TIMEOUT_MS -> we could not afford to look -> budget_exhausted
  //   remaining >= PROBE_TIMEOUT_MS -> we looked, nothing is there -> CLI genuinely missing
  //
  // Collapsing both into the exitCode-127 "no cross-family reviewer CLI available" branch
  // sends someone to install a CLI that is already installed. That is D1 reappearing in
  // the probe path, and an earlier version of this very test asserted the wrong answer.
  for (const [remaining, expectedReason, probes] of [
    [0, "budget_exhausted", 0],      // could not afford to look at all
    [4999, "budget_exhausted", 0],   // one probe short of affordable
    [5000, "budget_exhausted", 1],   // probed gemini, then could not afford codex --
                                     // we do NOT know codex is missing, so we must not say so
    [10000, "no cross-family reviewer CLI available", 2], // probed BOTH, neither is there
  ] as const) {
    let clock = 0;
    const calls: Array<[string, number | undefined]> = [];
    const run = await runDesignReview(fixture().specPath, {
      tier: "T3", env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "200000" }, monotonicNow: () => clock,
      commandRunner: (cmd, options) => {
        calls.push([cmd[0], options.timeout]);
        if (cmd[0] === "claude") {
          clock = 200000 - remaining;
          return { ok: true, stdout: yellowOutput, exitCode: 0 };
        }
        clock += 5000;
        return { ok: true, stdout: "XOSPROBE:1", exitCode: 0 }; // probe ran, found nothing
      },
    });
    expect(calls).toEqual([["claude", 200000], ...Array.from({ length: probes }, () => ["sh", 5000])]);
    expect(run.record.cross_family).toMatchObject({ status: "unavailable", reason: expectedReason });
    // The primary verdict survives either way -- neither cause may discard a completed review.
    expect(run.record.verdict).toBe("YELLOW");
    expect(run.exitCode).toBe(0);
  }
});

test("an inconclusive probe never claims the CLI is absent", async () => {
  // `command -v` exits 1 when the target is missing -- that is evidence. Anything else
  // (the probe timing out, the shell itself failing with 127) is NOT evidence, and the
  // earlier code turned it into "no cross-family reviewer CLI available" anyway.
  for (const [probeResult, expected] of [
    [{ ok: true, stdout: "XOSPROBE:1", exitCode: 0 }, "no cross-family reviewer CLI available"],
    // Both candidates are probed before any conclusion: an inconclusive gemini probe must
    // not cost us a codex review that might have been available.
    [{ ok: false, stdout: "", exitCode: 127 }, "cross-family reviewer undetermined: gemini probe did not complete (exit 127); codex probe did not complete (exit 127)"],
    [{ ok: false, stdout: "", exitCode: null, timedOut: true }, "cross-family reviewer undetermined: gemini probe timed out; codex probe timed out"],
  ] as const) {
    const run = await runDesignReview(fixture().specPath, {
      tier: "T3", env: {},
      commandRunner: (cmd) =>
        cmd[0] === "claude" ? { ok: true, stdout: yellowOutput, exitCode: 0 } : { ...probeResult },
    });
    expect(run.record.cross_family).toMatchObject({ status: "unavailable", reason: expected });
    // Inconclusive or absent, the completed primary review survives either way.
    expect(run.record.verdict).toBe("YELLOW");
    expect(run.exitCode).toBe(0);
  }
});

test("one flaky probe does not cost a reviewer the next candidate could have given", async () => {
  // gemini's probe is inconclusive, codex is present. Abandoning the loop on the first
  // inconclusive result would throw away a real cross-family review for no reason.
  const seen: string[] = [];
  const run = await runDesignReview(fixture().specPath, {
    tier: "T3", env: {},
    commandRunner: (cmd) => {
      // Name the probed binary, not the tail of the shell snippet -- `cmd[2]` now ends
      // with the sentinel printf, so splitting on the last token picks up `"$?"`.
      seen.push(cmd[0] === "sh" ? `probe:${/command -v (\S+)/.exec(cmd[2])?.[1]}` : cmd[0]);
      if (cmd[0] === "claude") return { ok: true, stdout: yellowOutput, exitCode: 0 };
      if (cmd[0] === "sh") return cmd[2].includes("gemini")
        ? { ok: false, stdout: "", exitCode: null, timedOut: true }    // never completed
        : { ok: true, stdout: "XOSPROBE:0", exitCode: 0 };              // codex present
      return { ok: true, stdout: yellowOutput, exitCode: 0 };
    },
  });
  expect(seen).toEqual(["claude", "probe:gemini", "probe:codex", "codex"]);
  expect(run.record.cross_family).toMatchObject({ status: "available", reviewer: "codex-local" });
});

test("usable floor rejects a retry just below 90s and admits its boundary", async () => {
  for (const remaining of [89999, 90000, 90001]) {
    let clock = 0;
    const calls: number[] = [];
    const run = await runDesignReview(fixture().specPath, {
      env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "200000" }, monotonicNow: () => clock,
      commandRunner: (_cmd, options) => {
        calls.push(options.timeout!);
        clock = 200000 - remaining;
        return { ok: true, stdout: calls.length === 1 ? "prose" : yellowOutput, exitCode: 0 };
      },
    });
    expect(calls).toEqual(remaining < 90000 ? [200000] : [200000, remaining]);
    expect(run.record.verdict).toBe(remaining < 90000 ? "UNREACHABLE" : "YELLOW");
    expect(run.record.reason).toBe(remaining < 90000 ? "budget_exhausted" : undefined);
    expect(run.exitCode).toBe(remaining < 90000 ? 1 : 0);
  }
});

// XOS-413: primary reviewer availability ladder. All commands are injected; no network.
test("explicit model", () => {
  for (const model of ["x", "claude-fable-5", "claude-sonnet-5"]) {
    expect(resolveReviewerCandidates({ DESIGN_REVIEW_MODEL: model })).toEqual([model]);
  }
  expect(resolveReviewerCandidates({ DESIGN_REVIEW_MODEL: "  x  " })).toEqual(["x"]);
});

test("explicit model never retries", async () => {
  const model = "claude-fable-5";
  const spawn = spyOn(Bun, "spawnSync").mockImplementation((() => ({
    exitCode: 3,
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
  })) as typeof Bun.spawnSync);
  try {
    const run = await runDesignReview(fixture().specPath, {
      env: { DESIGN_REVIEW_MODEL: model },
      monotonicNow: () => 0,
    });
    expect(run.record.reason).toBe("nonzero_exit");
    expect(run.exitCode).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0].slice(0, 3)).toEqual(["claude", "--model", model]);
    expect(run.record.models_tried).toHaveLength(1);
    expect(run.record.models_tried).toEqual([model]);
  } finally { spawn.mockRestore(); }
});

test("ladder order", () => {
  const expected = ["claude-fable-5", "claude-sonnet-5", "claude-haiku-4-5"];
  for (const env of [{}, { DESIGN_REVIEW_MODEL: "" }, { DESIGN_REVIEW_MODEL: "   " }]) {
    expect(resolveReviewerCandidates(env)).toEqual(expected);
  }
  const candidates = resolveReviewerCandidates({});
  candidates.reverse();
  expect(resolveReviewerCandidates({})).toEqual(expected);
});

test("advances on nonzero_exit", async () => {
  const models: string[] = [];
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, {
    env: {}, monotonicNow: () => 0,
    commandRunner: cmd => {
      expect(cmd[0]).toBe("claude");
      models.push(cmd[2]);
      return models.length === 1
        ? { ok: false, stdout: "", stderr: "model unavailable", exitCode: 3 }
        : { ok: true, stdout: yellowOutput, exitCode: 0 };
    },
  });
  expect(models).toEqual(["claude-fable-5", "claude-sonnet-5"]);
  expect(run.exitCode).toBe(0);
  expect(run.record.verdict).toBe("YELLOW");
  expect(run.record.reviewer_model).toBe("claude-sonnet-5");
  expect(run.record.reason).toBeUndefined();
  expect(JSON.parse(readFileSync(fx.sidecarPath, "utf8"))).toEqual(run.record);
  expect(hasValidVerdict(fx.specPath).ok).toBe(true);
});

test("timeout does not advance", async () => {
  const models: string[] = [];
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, {
    env: {}, monotonicNow: () => 0,
    commandRunner: cmd => {
      models.push(cmd[2]);
      return { ok: false, stdout: "", exitCode: 143, timedOut: true, elapsedMs: 300000 };
    },
  });
  expect(models).toEqual(["claude-fable-5"]);
  expect(run.exitCode).toBe(1);
  expect(run.record).toMatchObject({ verdict: "UNREACHABLE", reason: "timeout", models_tried: models });
  expect(hasValidVerdict(fx.specPath).ok).toBe(false);
});

test("unparseable does not advance", async () => {
  const models: string[] = [];
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, {
    env: {}, monotonicNow: () => 0,
    commandRunner: cmd => {
      models.push(cmd[2]);
      return { ok: true, stdout: "not a verdict", exitCode: 0 };
    },
  });
  // The pre-existing parse retry stays on the same candidate.
  expect(models).toEqual(["claude-fable-5", "claude-fable-5"]);
  expect(run.exitCode).toBe(1);
  expect(run.record).toMatchObject({ verdict: "UNREACHABLE", reason: "unparseable", models_tried: ["claude-fable-5"] });
  expect(hasValidVerdict(fx.specPath).ok).toBe(false);
});

test("cli_missing aborts", async () => {
  const models: string[] = [];
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, {
    env: {}, monotonicNow: () => 0,
    commandRunner: cmd => {
      models.push(cmd[2]);
      return { ok: false, stdout: "", exitCode: 127 };
    },
  });
  expect(models).toEqual(["claude-fable-5"]);
  expect(run.exitCode).toBe(1);
  expect(run.record).toMatchObject({ verdict: "UNREACHABLE", reason: "cli_missing", models_tried: models });
  expect(hasValidVerdict(fx.specPath).ok).toBe(false);
});

test("all exhausted", async () => {
  const models: string[] = [];
  const fx = fixture();
  const run = await runDesignReview(fx.specPath, {
    env: {}, monotonicNow: () => 0,
    commandRunner: cmd => {
      models.push(cmd[2]);
      return { ok: false, stdout: "", stderr: `${cmd[2]} unavailable`, exitCode: 3 };
    },
  });
  expect(models).toEqual(["claude-fable-5", "claude-sonnet-5", "claude-haiku-4-5"]);
  expect(run.exitCode).toBe(1);
  expect(run.record).toMatchObject({
    verdict: "UNREACHABLE", reason: "nonzero_exit", models_tried: models,
    reviewer_model: "claude-haiku-4-5", exit_code: 3, stderr_tail: "claude-haiku-4-5 unavailable",
  });
  expect(JSON.parse(readFileSync(fx.sidecarPath, "utf8"))).toEqual(run.record);
  expect(hasValidVerdict(fx.specPath).ok).toBe(false);
});

test("explicit model failure", async () => {
  for (const model of ["x", "claude-fable-5"]) {
    const models: string[] = [];
    const fx = fixture();
    const run = await runDesignReview(fx.specPath, {
      env: { DESIGN_REVIEW_MODEL: model }, monotonicNow: () => 0,
      commandRunner: cmd => {
        models.push(cmd[2]);
        return { ok: false, stdout: "", exitCode: 3 };
      },
    });
    expect(models).toEqual([model]);
    expect(run.exitCode).toBe(1);
    expect(run.record).toMatchObject({ verdict: "UNREACHABLE", reason: "nonzero_exit", models_tried: [model] });
    expect(hasValidVerdict(fx.specPath).ok).toBe(false);
  }
});

test("budget shared across ladder", async () => {
  let clock = 0;
  const calls: Array<[string, number | undefined]> = [];
  const run = await runDesignReview(fixture().specPath, {
    env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "240000", DESIGN_REVIEW_TIMEOUT_MS: "200000" },
    monotonicNow: () => clock,
    commandRunner: (cmd, options) => {
      calls.push([cmd[2], options.timeout]);
      clock += calls.length === 1 ? 60000 : 45000;
      return calls.length < 3
        ? { ok: false, stdout: "", exitCode: 3 }
        : { ok: true, stdout: yellowOutput, exitCode: 0 };
    },
  });
  expect(calls).toEqual([["claude-fable-5", 200000], ["claude-sonnet-5", 180000], ["claude-haiku-4-5", 135000]]);
  expect(run.exitCode).toBe(0);
  expect(run.record.verdict).toBe("YELLOW");
  expect(run.record.reviewer_model).toBe("claude-haiku-4-5");
});

test("budget exhausted mid-ladder", async () => {
  // Both full exhaustion and just below the usable-call floor deny the next candidate.
  for (const spent of [110001, 200000]) {
    let clock = 0;
    const models: string[] = [];
    const fx = fixture();
    const run = await runDesignReview(fx.specPath, {
      env: { DESIGN_REVIEW_TOTAL_BUDGET_MS: "200000" }, monotonicNow: () => clock,
      commandRunner: cmd => {
        models.push(cmd[2]);
        clock += spent;
        return { ok: false, stdout: "", exitCode: 3 };
      },
    });
    expect(models).toEqual(["claude-fable-5"]);
    expect(run.exitCode).toBe(1);
    expect(run.record).toMatchObject({
      verdict: "UNREACHABLE", reason: "budget_exhausted", models_tried: models,
      elapsed_ms: spent, exit_code: null,
    });
    expect(JSON.parse(readFileSync(fx.sidecarPath, "utf8"))).toEqual(run.record);
    expect(hasValidVerdict(fx.specPath).ok).toBe(false);
  }
});

test("fallback success records the candidates attempted", async () => {
  // A GREEN produced by a downgraded reviewer must not look like a GREEN produced by the
  // first choice. reviewer_model names WHO reviewed; models_tried shows what refused first.
  let call = 0;
  const reviewer = async (_p: string, c: ReviewerContext) => {
    call += 1;
    return call === 1
      ? { ok: false, stdout: "", stderr: "refused", exitCode: 3, timedOut: false, model: c.model, family: c.family }
      : { ok: true, stdout: JSON.stringify({ verdict: "GREEN", findings: [] }), stderr: "", exitCode: 0, timedOut: false, model: c.model, family: c.family };
  };
  const run = await runDesignReview(fixture().specPath, { env: {}, reviewer });
  expect(run.exitCode).toBe(0);
  expect(run.record.verdict).toBe("GREEN");
  expect(run.record.reviewer_model).toBe("claude-sonnet-5");       // who actually reviewed
  expect(run.record.models_tried).toEqual(["claude-fable-5", "claude-sonnet-5"]); // and what refused
});
