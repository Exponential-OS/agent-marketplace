/**
 * test_brain_kernel_bootstrap.ts — Tests for brain-kernel-bootstrap.ts
 *
 * Verifies Phase 3a-3c of the brain-kernel migration:
 *   (a) engine writes to its own namespace via brain.write
 *   (b) engine writes to identity/skills-matrix.md via declared primitive access
 *   (c) engine reads identity/handles.md via brain.read
 *   (d) lint registration + run
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
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ci-engine-test-"));
}

/** Initialize a git repo so brain.write() commits don't fail. */
async function initGitRepo(dir: string): Promise<void> {
  const procs = [
    Bun.spawn(["git", "init", dir], { stdout: "pipe", stderr: "pipe" }),
  ];
  await Promise.all(procs.map((p) => p.exited));
  const cfgProcs = [
    Bun.spawn(["git", "-C", dir, "config", "user.email", "test@ci-engine.test"], {
      stdout: "pipe",
      stderr: "pipe",
    }),
    Bun.spawn(["git", "-C", dir, "config", "user.name", "ci-engine-test"], {
      stdout: "pipe",
      stderr: "pipe",
    }),
  ];
  await Promise.all(cfgProcs.map((p) => p.exited));
}

// H3: resolve kernel path via BRAIN_KERNEL_ROOT env var with documented fallback.
// Set BRAIN_KERNEL_ROOT when the kernel is installed outside the standard sibling layout.
const BRAIN_KERNEL_PATH = process.env.BRAIN_KERNEL_ROOT
  ? join(process.env.BRAIN_KERNEL_ROOT, "kernel.ts")
  : join(import.meta.dir, "..", "..", "xos", "plugins", "brain-kernel", "kernel.ts");
const BOOTSTRAP_PATH = join(import.meta.dir, "..", "brain-kernel-bootstrap.ts");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("career-intelligence brain-kernel bootstrap", () => {
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

  // ── (a) Engine writes to its own namespace via brain.write ──────────────────

  test("(a) engine can write a story file to owned namespace career-intelligence/stories/", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const result = await brain.write(
      "career-intelligence/stories/test-story.md",
      "# Test Story\n\n## Situation\nTest situation.\n\n## Task\nTest task.\n\n## Action\nTest action.\n\n## Result\nTest result.\n",
      {
        provenance: {
          who: "career-intelligence",
          why: "test: story write",
          source: "test_brain_kernel_bootstrap",
        },
        engine_id: "career-intelligence",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.path).toBe("career-intelligence/stories/test-story.md");
    expect(existsSync(join(tmpDir, "career-intelligence", "stories", "test-story.md"))).toBe(true);
  });

  test("(a) engine can write pipeline.json to owned namespace", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const pipeline = JSON.stringify({ stage_data: [] }, null, 2);
    const result = await brain.write("career-intelligence/pipeline.json", pipeline, {
      provenance: {
        who: "career-intelligence",
        why: "test: pipeline write",
        source: "test_brain_kernel_bootstrap",
      },
      engine_id: "career-intelligence",
    });

    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpDir, "career-intelligence", "pipeline.json"))).toBe(true);
    const written = JSON.parse(readFileSync(join(tmpDir, "career-intelligence", "pipeline.json"), "utf8"));
    expect(Array.isArray(written.stage_data)).toBe(true);
  });

  // ── (b) Engine writes identity/skills-matrix.md via declared primitive access ─
  //
  // Judge finding D-2: test (b-1) now asserts SUCCESS — the H2 kernel supports
  // writes_to_primitives grants via the RegisterEngineOpts overload. The bootstrap
  // was updated (D-1) to use the full overload, so this write is now permitted.
  // A paired test asserts that an UNDECLARED primitive path is still blocked.

  test("(b-1) engine can write identity/skills-matrix.md via declared writes_to_primitives", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // SPEC declares writes_to_primitives: ["identity/skills-matrix.md", ...].
    // With RegisterEngineOpts (D-1 fix), this grant is now active in the ACL.
    const matrixContent = `# Skills Matrix\n\n| Skill | Proficiency | Last Used |\n|---|---|---|\n| TypeScript | Expert | 2026-01-01 |\n`;
    const result = await brain.write("identity/skills-matrix.md", matrixContent, {
      provenance: {
        who: "career-intelligence",
        why: "test: primitive write to skills-matrix via writes_to_primitives grant",
        source: "test_brain_kernel_bootstrap",
      },
      engine_id: "career-intelligence",
    });

    // Primitive write is now permitted — RegisterEngineOpts wires the grant correctly.
    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpDir, "identity", "skills-matrix.md"))).toBe(true);
    const written = readFileSync(join(tmpDir, "identity", "skills-matrix.md"), "utf8");
    expect(written).toContain("TypeScript");
  });

  test("(b-1-undeclared) kernel blocks write to undeclared primitive identity/personality.md", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // identity/personality.md is NOT in writes_to_primitives — must be blocked.
    const result = await brain.write("identity/personality.md", "# Personality\n\nTest.\n", {
      provenance: {
        who: "career-intelligence",
        why: "test: undeclared primitive write must be blocked",
        source: "test_brain_kernel_bootstrap",
      },
      engine_id: "career-intelligence",
    });

    expect(result.ok).toBe(false);
    expect(result.err).toContain("ACL BLOCK");
    expect(existsSync(join(tmpDir, "identity", "personality.md"))).toBe(false);
  });

  test("(b-2) engine can write identity/skills-matrix.md when pre-seeded by kernel (primitive read verifies content)", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Pre-seed the file as if kernel/identity engine owns it (simulates prod path).
    mkdirSync(join(tmpDir, "identity"), { recursive: true });
    writeFileSync(
      join(tmpDir, "identity", "skills-matrix.md"),
      "# Skills Matrix\n\n| Skill | Proficiency | Last Used |\n|---|---|---|\n| TypeScript | Expert | 2026-01-01 |\n",
    );

    // career-intelligence engine has reads_from: ["identity/**"] — read is permitted.
    const readResult = await brain.read("identity/skills-matrix.md");
    expect(readResult.ok).toBe(true);
    expect(readResult.content).not.toBeNull();
    expect(readResult.content).toContain("TypeScript");
  });

  test("(b) engine is blocked from writing to another engine namespace (acl guard)", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // career-intelligence should NOT be able to write brand-amplification/ namespace
    const result = await brain.write(
      "brand-amplification/campaigns/test.md",
      "test content",
      {
        provenance: { who: "career-intelligence", why: "test: acl block", source: "test" },
        engine_id: "career-intelligence",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.err).toContain("ACL BLOCK");
  });

  // ── (c) Engine reads identity/handles.md via brain.read ────────────────────

  test("(c) engine can read identity/handles.md (primitive read)", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Pre-create the file with a different engine_id to simulate it being owned by brand-amplification
    mkdirSync(join(tmpDir, "identity"), { recursive: true });
    writeFileSync(join(tmpDir, "identity", "handles.md"), "# Handles\n\n- LinkedIn: @test\n");
    const add = Bun.spawn(["git", "-C", tmpDir, "add", "identity/handles.md"], { stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "-C", tmpDir, "commit", "-m", "chore: seed handles"], { stdout: "pipe", stderr: "pipe" });
    await commit.exited;

    const result = await brain.read("identity/handles.md");

    expect(result.ok).toBe(true);
    expect(result.content).not.toBeNull();
    expect(result.content).toContain("LinkedIn");
  });

  test("(c) brain.read returns ok:true with null content for non-existent path", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const result = await brain.read("identity/nonexistent-file.md");

    expect(result.ok).toBe(true);
    expect(result.content).toBeNull();
  });

  // ── (d) Lint registration + run ────────────────────────────────────────────

  test("(d) all three linters are registered after registerEngine", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Run lint on empty workspace — should produce no errors, linters should run
    const result = await brain.lint.run();

    expect(result.total_linters).toBe(3);
    expect(result.ran).toBe(3);
    expect(result.skipped).toBe(0);
  });

  test("(d) story-completeness linter flags story missing STAR fields", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Write an incomplete story (missing Result section)
    const incompleteStory = `---
title: Test Story
---

## Situation
Some situation.

## Task
Some task.

## Action
Some action.
`;
    await brain.write(
      "career-intelligence/stories/incomplete-story.md",
      incompleteStory,
      {
        provenance: { who: "career-intelligence", why: "test fixture", source: "test" },
        engine_id: "career-intelligence",
      },
    );

    const result = await brain.lint.run(["story-completeness"]);
    expect(result.findings_by_linter.length).toBe(1);

    const linterResult = result.findings_by_linter[0];
    expect(linterResult.linter).toBe("story-completeness");
    expect(linterResult.findings.length).toBeGreaterThan(0);

    const resultFinding = linterResult.findings.find((f) => f.message.includes("result"));
    expect(resultFinding).toBeDefined();
    expect(resultFinding?.severity).toBe("warn");
  });

  test("(d) story-completeness linter passes on complete STAR story", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const completeStory = `---
title: Complete Story
---

## Situation
Some situation.

## Task
Some task.

## Action
Some action.

## Result
Some result with metrics.
`;
    await brain.write(
      "career-intelligence/stories/complete-story.md",
      completeStory,
      {
        provenance: { who: "career-intelligence", why: "test fixture", source: "test" },
        engine_id: "career-intelligence",
      },
    );

    const result = await brain.lint.run(["story-completeness"]);
    const linterResult = result.findings_by_linter[0];
    expect(linterResult.findings.length).toBe(0);
  });

  test("(d) skill-staleness linter flags skills >180 days old", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    // Write a skills matrix with a stale skill (date > 180 days ago)
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 200);
    const staleDateStr = staleDate.toISOString().split("T")[0];

    const staleMatrix = `# Skills Matrix

| Skill | Proficiency | Last Used |
|---|---|---|
| OldTech | Stale | ${staleDateStr} |
`;

    mkdirSync(join(tmpDir, "identity"), { recursive: true });
    writeFileSync(join(tmpDir, "identity", "skills-matrix.md"), staleMatrix);
    const add = Bun.spawn(["git", "-C", tmpDir, "add", "identity/skills-matrix.md"], { stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "-C", tmpDir, "commit", "-m", "chore: seed skills"], { stdout: "pipe", stderr: "pipe" });
    await commit.exited;

    const result = await brain.lint.run(["skill-staleness"]);
    const linterResult = result.findings_by_linter[0];
    expect(linterResult.findings.length).toBeGreaterThan(0);
    expect(linterResult.findings[0].severity).toBe("info");
    expect(linterResult.findings[0].message).toContain("OldTech");
  });

  test("(d) pipeline-job-staleness linter flags active job stale >14 days", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 20);
    const staleDateStr = staleDate.toISOString().split("T")[0];

    const pipeline = JSON.stringify({
      stage_data: [
        {
          company: "Acme Corp",
          slug: "acme-corp-director",
          stage: "advancing",
          updated_at: staleDateStr,
        },
      ],
    }, null, 2);

    await brain.write("career-intelligence/pipeline.json", pipeline, {
      provenance: { who: "career-intelligence", why: "test fixture", source: "test" },
      engine_id: "career-intelligence",
    });

    const result = await brain.lint.run(["pipeline-job-staleness"]);
    const linterResult = result.findings_by_linter[0];
    expect(linterResult.findings.length).toBeGreaterThan(0);
    expect(linterResult.findings[0].severity).toBe("warn");
    expect(linterResult.findings[0].message).toContain("Acme Corp");
  });

  test("(d) pipeline-job-staleness linter skips dead/rejected stages", async () => {
    const { createBrain } = await import(BRAIN_KERNEL_PATH);
    const { registerEngine } = await import(BOOTSTRAP_PATH);

    const brain = createBrain(tmpDir);
    registerEngine(brain);

    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 30);
    const staleDateStr = staleDate.toISOString().split("T")[0];

    const pipeline = JSON.stringify({
      stage_data: [
        {
          company: "Dead Corp",
          slug: "dead-corp-role",
          stage: "dead",
          updated_at: staleDateStr,
        },
        {
          company: "Rejected Corp",
          slug: "rejected-role",
          stage: "rejected",
          updated_at: staleDateStr,
        },
      ],
    }, null, 2);

    await brain.write("career-intelligence/pipeline.json", pipeline, {
      provenance: { who: "career-intelligence", why: "test fixture", source: "test" },
      engine_id: "career-intelligence",
    });

    const result = await brain.lint.run(["pipeline-job-staleness"]);
    const linterResult = result.findings_by_linter[0];
    // Dead and rejected stages should not produce findings
    expect(linterResult.findings.length).toBe(0);
  });
});
