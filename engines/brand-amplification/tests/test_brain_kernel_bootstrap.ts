/**
 * test_brain_kernel_bootstrap.ts — Tests for brain-kernel-bootstrap.ts
 *
 * Verifies Phase 3a-3c of the brain-kernel migration for brand-amplification:
 *   (a) BAE writes to its own namespace via brain.write
 *   (b) BAE writes to identity/handles.md via brain.write (kernel ACL allows
 *       per writes_to_primitives — verifies the ACL Gap Fix is honored)
 *   (c) BAE reads from network/companies/acme.md via brain.read
 *   (d) Lint registration + at least one lint run
 *
 * Uses Bun's built-in test runner. All tests use ephemeral temp dirs.
 * No network calls. Git operations use a local init-only repo.
 *
 * Run: bun test tests/test_brain_kernel_bootstrap.ts
 */

import { test, expect, describe, beforeEach } from "bun:test";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "bae-engine-test-"));
}

/** Initialize a git repo so brain.write() commits don't fail. */
async function initGitRepo(dir: string): Promise<void> {
  const init = Bun.spawn(["git", "init", dir], { stdout: "pipe", stderr: "pipe" });
  await init.exited;
  const cfgProcs = [
    Bun.spawn(["git", "-C", dir, "config", "user.email", "test@bae-engine.test"], {
      stdout: "pipe",
      stderr: "pipe",
    }),
    Bun.spawn(["git", "-C", dir, "config", "user.name", "bae-engine-test"], {
      stdout: "pipe",
      stderr: "pipe",
    }),
  ];
  await Promise.all(cfgProcs.map((p) => p.exited));
}

// Paths to kernel and bootstrap relative to this engine repo
const BRAIN_KERNEL_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "xos",
  "plugins",
  "brain-kernel",
  "kernel.ts",
);
const BOOTSTRAP_PATH = join(import.meta.dir, "..", "brain-kernel-bootstrap.ts");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("brand-amplification brain-kernel bootstrap", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    await initGitRepo(tmpDir);
    // Create the xOS version file. Set default_push_policy to "deferred" so
    // brain.write() commits locally only — tests run without a git remote.
    mkdirSync(join(tmpDir, "xOS"), { recursive: true });
    writeFileSync(
      join(tmpDir, "xOS", "version.json"),
      JSON.stringify({
        kernel: "brain-kernel",
        version: "1.0.0",
        installed_at: new Date().toISOString(),
        schema_version: "1",
        default_push_policy: "deferred",
      }),
    );
    // Commit the version file so git is not in an empty state
    const add = Bun.spawn(["git", "-C", tmpDir, "add", "."], { stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(
      ["git", "-C", tmpDir, "commit", "-m", "chore: init test workspace"],
      { stdout: "pipe", stderr: "pipe" },
    );
    await commit.exited;
  });

  // ── (a) BAE writes to its own namespace via brain.write ────────────────────

  test("(a) BAE can write a campaign master to owned namespace brand-amplification/campaigns/", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const content = [
      "# Campaign: AI Thought Leadership",
      "",
      "## Surface Coverage Matrix",
      "",
      "| Platform | Status | Reason |",
      "|---|---|---|",
      "| LinkedIn | in-scope | primary hub |",
      "| Substack | in-scope | honey pot |",
      "| Reddit | in-scope | r/MachineLearning spoke |",
      "| X | out-of-scope | low ROI this campaign |",
      "",
      "## Thesis",
      "AI agents compound — here's the evidence.",
    ].join("\n");

    const result = await brain.write(
      "brand-amplification/campaigns/ai-thought-leadership/master.md",
      content,
      {
        provenance: {
          who: "brand-amplification",
          why: "test: campaign master write",
          source: "test_brain_kernel_bootstrap",
        },
        engine_id: "brand-amplification",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.path).toBe("brand-amplification/campaigns/ai-thought-leadership/master.md");
    expect(
      existsSync(
        join(tmpDir, "brand-amplification", "campaigns", "ai-thought-leadership", "master.md"),
      ),
    ).toBe(true);
  });

  test("(a) BAE can write to voice-strategies owned namespace", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const flywheel = [
      "# Content Flywheel",
      "",
      "hub: linkedin",
      "honey_pot: substack",
      "spokes:",
      "  - reddit",
      "  - x",
      "",
      "## IP Firewall",
      "NEVER mention: competitors, client names, salary details",
    ].join("\n");

    const result = await brain.write(
      "brand-amplification/voice-strategies/content-flywheel.md",
      flywheel,
      {
        provenance: {
          who: "brand-amplification",
          why: "test: voice strategy write",
          source: "test_brain_kernel_bootstrap",
        },
        engine_id: "brand-amplification",
      },
    );

    expect(result.ok).toBe(true);
    expect(
      existsSync(
        join(tmpDir, "brand-amplification", "voice-strategies", "content-flywheel.md"),
      ),
    ).toBe(true);
    const written = readFileSync(
      join(tmpDir, "brand-amplification", "voice-strategies", "content-flywheel.md"),
      "utf8",
    );
    expect(written).toContain("hub: linkedin");
  });

  test("(a) BAE can write local content strategy telemetry through brain.write", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const event = {
      event: "content_strategy_applied",
      relevance_score: 82,
      audience: "Acme hiring managers",
      passed: true,
      ts: "2026-06-28T00:00:00.000Z",
    };

    const result = await brain.write(
      "brand-amplification/telemetry/events.jsonl",
      `${JSON.stringify(event)}\n`,
      {
        provenance: {
          who: "brand-amplification",
          why: "test: local relevance telemetry write",
          source: "test_brain_kernel_bootstrap",
        },
        engine_id: "brand-amplification",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.path).toBe("brand-amplification/telemetry/events.jsonl");
    const written = readFileSync(
      join(tmpDir, "brand-amplification", "telemetry", "events.jsonl"),
      "utf8",
    );
    const lines = written.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toEqual(event);
  });

  // ── (b) BAE writes to identity/handles.md via writes_to_primitives ─────────
  //
  // This test verifies that the ACL Gap Fix (brain-kernel commit d665f01) is
  // honored: brand-amplification declares writes_to_primitives: ["identity/handles.md"]
  // in its RegisterEngineOpts, and the kernel's checkWithKind() now grants
  // cross-namespace writes to declared primitive paths.
  //
  // This is the KEY difference from the career-intelligence bootstrap (725fa6b)
  // which documented the ACL block as SPEC-CLARIFICATION-NEEDED. The ACL fix
  // means BAE can write identity/handles.md without kernel rejection.

  test("(b) BAE can write identity/handles.md via writes_to_primitives — ACL gap fix honored", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const handlesContent = [
      "# Handles",
      "",
      "- LinkedIn: https://linkedin.com/in/testuser",
      "- Substack: https://testuser.substack.com",
      "- X: @testuser",
      "- Reddit: u/testuser",
    ].join("\n");

    const result = await brain.write(
      "identity/handles.md",
      handlesContent,
      {
        provenance: {
          who: "brand-amplification",
          why: "test: primitive write to identity/handles.md",
          source: "test_brain_kernel_bootstrap",
        },
        engine_id: "brand-amplification",
      },
    );

    // ACL should ALLOW this write (primitive-write via writes_to_primitives)
    expect(result.ok).toBe(true);
    expect(result.path).toBe("identity/handles.md");
    expect(existsSync(join(tmpDir, "identity", "handles.md"))).toBe(true);
    const written = readFileSync(join(tmpDir, "identity", "handles.md"), "utf8");
    expect(written).toContain("LinkedIn");
    expect(written).toContain("Substack");
  });

  test("(b) BAE is blocked from writing another engine's namespace (acl guard)", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // BAE should NOT be able to write career-intelligence/ namespace
    const result = await brain.write(
      "career-intelligence/pipeline.json",
      '{"stage_data":[]}',
      {
        provenance: { who: "brand-amplification", why: "test: acl block", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.err).toContain("ACL BLOCK");
  });

  test("(b) BAE is blocked from writing identity/skills-matrix.md (not in writes_to_primitives)", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // skills-matrix.md is NOT in writes_to_primitives for brand-amplification
    const result = await brain.write(
      "identity/skills-matrix.md",
      "# Skills\n",
      {
        provenance: { who: "brand-amplification", why: "test: acl block for undeclared primitive", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.err).toContain("ACL BLOCK");
  });

  // ── (c) BAE reads from network/companies via brain.read ────────────────────

  test("(c) BAE can read network/companies/acme.md via brain.read (primitive read)", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Pre-seed the file (simulating another engine or user creating it)
    mkdirSync(join(tmpDir, "network", "companies"), { recursive: true });
    writeFileSync(
      join(tmpDir, "network", "companies", "acme.md"),
      "# Acme Corp\n\nIndustry: Technology\nSize: 1000+\n",
    );
    const add = Bun.spawn(["git", "-C", tmpDir, "add", "network/companies/acme.md"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await add.exited;
    const commit = Bun.spawn(
      ["git", "-C", tmpDir, "commit", "-m", "chore: seed company profile"],
      { stdout: "pipe", stderr: "pipe" },
    );
    await commit.exited;

    const result = await brain.read("network/companies/acme.md");

    expect(result.ok).toBe(true);
    expect(result.content).not.toBeNull();
    expect(result.content).toContain("Acme Corp");
    expect(result.content).toContain("Technology");
  });

  test("(c) brain.read returns ok:true with null content for non-existent path", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const result = await brain.read("network/people/nonexistent-person.md");

    expect(result.ok).toBe(true);
    expect(result.content).toBeNull();
  });

  // ── (d) Lint registration + lint runs ─────────────────────────────────────

  test("(d) all three linters are registered after registerEngine", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Run lint on empty workspace — linters should run without error
    const result = await brain.lint.run();

    expect(result.total_linters).toBe(3);
    expect(result.ran).toBe(3);
    expect(result.skipped).toBe(0);
    // No errors from linters themselves (findings may be 0 on empty workspace)
    for (const linterResult of result.findings_by_linter) {
      expect(linterResult.error).toBeUndefined();
    }
  });

  test("(d) campaign-completeness linter blocks campaign master missing Surface Coverage Matrix", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Write an incomplete campaign master (no Surface Coverage Matrix)
    const incompleteMaster = [
      "# Campaign: Test Campaign",
      "",
      "## Thesis",
      "Here is the thesis without a surface coverage matrix.",
      "",
      "## LinkedIn Post",
      "Draft content here.",
    ].join("\n");

    await brain.write(
      "brand-amplification/campaigns/test-campaign/master.md",
      incompleteMaster,
      {
        provenance: { who: "brand-amplification", why: "test fixture", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    const result = await brain.lint.run(["campaign-completeness"]);
    expect(result.findings_by_linter.length).toBe(1);

    const linterResult = result.findings_by_linter[0];
    expect(linterResult.linter).toBe("campaign-completeness");
    expect(linterResult.findings.length).toBeGreaterThan(0);
    expect(linterResult.findings[0].severity).toBe("block");
    expect(linterResult.findings[0].message).toContain("Surface Coverage Matrix");
  });

  test("(d) campaign-completeness linter passes on campaign master with Surface Coverage Matrix", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const completeMaster = [
      "# Campaign: Complete Campaign",
      "",
      "## Surface Coverage Matrix",
      "",
      "| Platform | Status | Reason |",
      "|---|---|---|",
      "| LinkedIn | in-scope | hub |",
      "| Substack | in-scope | honey pot |",
      "",
      "## Thesis",
      "Full thesis here.",
    ].join("\n");

    await brain.write(
      "brand-amplification/campaigns/complete-campaign/master.md",
      completeMaster,
      {
        provenance: { who: "brand-amplification", why: "test fixture", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    const result = await brain.lint.run(["campaign-completeness"]);
    const linterResult = result.findings_by_linter[0];
    expect(linterResult.findings.length).toBe(0);
  });

  test("(d) surface-coverage linter warns when handles.md platform not in latest campaign", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Seed identity/handles.md with LinkedIn + Reddit + X
    mkdirSync(join(tmpDir, "identity"), { recursive: true });
    writeFileSync(
      join(tmpDir, "identity", "handles.md"),
      [
        "# Handles",
        "- LinkedIn: @testuser",
        "- Reddit: u/testuser",
        "- X/Twitter: @testuser",
      ].join("\n"),
    );
    const add = Bun.spawn(["git", "-C", tmpDir, "add", "identity/handles.md"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await add.exited;
    const commit = Bun.spawn(
      ["git", "-C", tmpDir, "commit", "-m", "chore: seed handles"],
      { stdout: "pipe", stderr: "pipe" },
    );
    await commit.exited;

    // Write a campaign master that only mentions LinkedIn (missing Reddit and X)
    const partialMaster = [
      "# Campaign: Partial Coverage",
      "",
      "## Surface Coverage Matrix",
      "",
      "| Platform | Status |",
      "|---|---|",
      "| LinkedIn | in-scope |",
      "",
      "## Thesis",
      "LinkedIn-only campaign.",
    ].join("\n");

    await brain.write(
      "brand-amplification/campaigns/partial-campaign/master.md",
      partialMaster,
      {
        provenance: { who: "brand-amplification", why: "test fixture", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    const result = await brain.lint.run(["surface-coverage"]);
    const linterResult = result.findings_by_linter[0];
    expect(linterResult.linter).toBe("surface-coverage");
    // Reddit or X should appear as a warning (not present in the campaign)
    const missingPlatformFindings = linterResult.findings.filter(
      (f) => f.message.includes("reddit") || f.message.includes("x") || f.message.includes("twitter"),
    );
    expect(missingPlatformFindings.length).toBeGreaterThan(0);
    expect(missingPlatformFindings[0].severity).toBe("warn");
  });

  test("(d) voice-drift linter flags forbidden phrase in post draft", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Write a voice strategy declaring forbidden phrases
    const voiceStrategy = [
      "# Content Flywheel",
      "",
      "## IP Firewall",
      "NEVER use: competitors",
      "NEVER mention: client names",
      "DO NOT include: salary details",
    ].join("\n");

    await brain.write(
      "brand-amplification/voice-strategies/content-flywheel.md",
      voiceStrategy,
      {
        provenance: { who: "brand-amplification", why: "test fixture", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    // Write a post draft that violates the voice strategy (uses "competitors")
    const driftedPost = [
      "# LinkedIn Post",
      "",
      "Unlike our competitors, we do things differently.",
      "Here is our unique approach to AI agents.",
    ].join("\n");

    await brain.write(
      "brand-amplification/campaigns/test-campaign/platforms/linkedin-post.md",
      driftedPost,
      {
        provenance: { who: "brand-amplification", why: "test fixture", source: "test" },
        engine_id: "brand-amplification",
      },
    );

    const result = await brain.lint.run(["voice-drift"]);
    const linterResult = result.findings_by_linter[0];
    expect(linterResult.linter).toBe("voice-drift");
    expect(linterResult.findings.length).toBeGreaterThan(0);
    const driftFinding = linterResult.findings.find((f) =>
      f.message.includes("competitors"),
    );
    expect(driftFinding).toBeDefined();
    expect(driftFinding?.severity).toBe("warn");
  });
});
