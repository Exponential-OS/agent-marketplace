import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECK_PATH = join(
  import.meta.dir,
  "..",
  "rules",
  "reddit-prepost-viability",
  "check.py",
);
const SEED_PATH = join(
  import.meta.dir,
  "..",
  "rules",
  "reddit-prepost-viability",
  "reddit-surface-history.seed.json",
);

type GateResult = {
  gate: string;
  verdict: "PASS" | "BLOCK" | "WARN";
  [key: string]: unknown;
};

type GateOutput = {
  verdict: "PASS" | "BLOCK" | "WARN";
  subreddit: string;
  offline: boolean;
  gates: GateResult[];
  summary: { passes: number; warns: number; blocks: number };
};

const history = [
  {
    subreddit: "r/LocalLLaMA",
    date: "2026-08-13",
    outcome: "removed",
    removed_by: "moderator",
    title: "Building got free, so the moat moved",
  },
  {
    subreddit: "r/PromptEngineering",
    date: "2026-05-09",
    outcome: "survived",
    removed_by: null,
    title: "Eval harness, 50 seeded artifacts",
  },
  {
    subreddit: "r/LocalLLaMA",
    date: "2026-04-29",
    outcome: "removed",
    removed_by: "moderator",
    title: "Co-Dialectic v4",
  },
];

function makeFixture(): {
  dir: string;
  ledgerPath: string;
  researchPath: string;
  missingLedgerPath: string;
  missingResearchPath: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "reddit-prepost-viability-test-"));
  const ledgerPath = join(dir, "reddit-surface-history.json");
  const researchPath = join(dir, "50-subreddits-ai-citation-index-2026.md");
  writeFileSync(
    ledgerPath,
    JSON.stringify({ handle: "thewhyman007", updated: "2026-08-13", entries: history }),
  );
  writeFileSync(
    researchPath,
    [
      "| Rank | Subreddit | Category | Engines |",
      "|---:|---|---|---|",
      "| 1 | r/AskReddit | How-to & Technical | All engines |",
      "| 12 | r/PromptEngineering | AI Engineering | ChatGPT, Perplexity |",
      "| 17 | r/LocalLLaMA | Open Models | All engines |",
      "| **22** | **r/Entrepreneur** | Professional & B2B | ChatGPT |",
      "| 28 | r/MachineLearning | ML Research | All engines |",
    ].join("\n"),
  );
  return {
    dir,
    ledgerPath,
    researchPath,
    missingLedgerPath: join(dir, "missing-ledger.json"),
    missingResearchPath: join(dir, "missing-research.md"),
  };
}

async function runGate(input: Record<string, unknown>): Promise<{
  code: number;
  output: GateOutput;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["python3", CHECK_PATH, JSON.stringify(input)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  return { code, output: JSON.parse(lines[0]), stdout, stderr };
}

function gate(output: GateOutput, name: string): GateResult {
  const result = output.gates.find((candidate) => candidate.gate === name);
  expect(result, `missing required gate ${name}`).toBeDefined();
  if (!result) throw new Error(`missing required gate ${name}`);
  return result;
}

const answeringBody =
  "How do you measure retrieval quality? In my testing, we measured 50 samples and compared the results.";

describe("reddit-prepost-viability", () => {
  test("bundled workspace seed preserves the five verified XOS-236 history rows", () => {
    const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));

    expect(seed.handle).toBe("thewhyman007");
    expect(seed.updated).toBe("2026-08-13");
    expect(seed.entries).toEqual([
      {
        subreddit: "r/LocalLLaMA",
        date: "2026-08-13",
        outcome: "removed",
        removed_by: "moderator",
        title: "Building got free, so the moat moved",
      },
      {
        subreddit: "r/TechSEO",
        date: "2026-07-24",
        outcome: "removed",
        removed_by: "automod",
        title: "AI engines comparison",
      },
      {
        subreddit: "r/PromptEngineering",
        date: "2026-05-09",
        outcome: "survived",
        removed_by: null,
        title: "Eval harness, 50 seeded artifacts",
      },
      {
        subreddit: "r/LocalLLaMA",
        date: "2026-04-29",
        outcome: "removed",
        removed_by: "moderator",
        title: "Co-Dialectic v4",
      },
      {
        subreddit: "r/MachineLearning",
        date: "2026-04-29",
        outcome: "removed",
        removed_by: "moderator",
        title: "Co-Dialectic v4",
      },
    ]);
  });

  test("previously removed r/LocalLLaMA blocks and names both removal dates", async () => {
    const fixture = makeFixture();
    const result = await runGate({
      subreddit: "LocalLLaMA",
      body: answeringBody,
      ledger_path: fixture.ledgerPath,
      research_path: fixture.researchPath,
      handle: "thewhyman007",
    });

    expect(result.stderr).toBe("");
    expect(result.code).toBe(1);
    expect(result.output.verdict).toBe("BLOCK");
    expect(result.output.subreddit).toBe("r/LocalLLaMA");
    const historyGate = gate(result.output, "surface_history");
    expect(historyGate.verdict).toBe("BLOCK");
    expect(historyGate.reason).toContain("2026-08-13 (moderator)");
    expect(historyGate.reason).toContain("2026-04-29 (moderator)");
    expect(historyGate.removals).toHaveLength(2);
  });

  test("survived r/PromptEngineering does not block on history", async () => {
    const fixture = makeFixture();
    const result = await runGate({
      subreddit: "r/PromptEngineering",
      body: answeringBody,
      ledger_path: fixture.ledgerPath,
      research_path: fixture.researchPath,
      handle: "thewhyman007",
    });

    expect(result.code).toBe(0);
    expect(result.output.verdict).toBe("PASS");
    const historyGate = gate(result.output, "surface_history");
    expect(historyGate.verdict).toBe("PASS");
    expect(historyGate.prior_removals).toBe(0);
  });

  test("subreddit outside the top 50 blocks with Rule 1 reasoning", async () => {
    const fixture = makeFixture();
    const result = await runGate({
      subreddit: "r/TinyUnindexedAI",
      body: answeringBody,
      submission_history: [],
      research_path: fixture.researchPath,
    });

    expect(result.code).toBe(1);
    expect(result.output.verdict).toBe("BLOCK");
    const top50 = gate(result.output, "top50_citation_index");
    expect(top50.verdict).toBe("BLOCK");
    expect(top50.reason).toContain("outside the top-50");
    expect(top50.reason).toContain("~80%");
    expect(top50.reason).toContain("~40%");
  });

  test("subreddit inside the top 50 passes gate 2 and reports rank/category", async () => {
    const fixture = makeFixture();
    const result = await runGate({
      subreddit: "Entrepreneur",
      body: answeringBody,
      submission_history: history,
      research_path: fixture.researchPath,
    });

    expect(result.code).toBe(0);
    const top50 = gate(result.output, "top50_citation_index");
    expect(top50.verdict).toBe("PASS");
    expect(top50.rank).toBe(22);
    expect(top50.category).toBe("Professional & B2B");
  });

  test("em dash blocks with offsets while the same text with commas passes", async () => {
    const fixture = makeFixture();
    const base = {
      subreddit: "r/PromptEngineering",
      submission_history: history,
      research_path: fixture.researchPath,
    };
    const blocked = await runGate({
      ...base,
      title: "A measured result — with a failure mode",
      body: `${answeringBody} The outcome — 42 percent better.`,
    });
    const passed = await runGate({
      ...base,
      title: "A measured result, with a failure mode",
      body: `${answeringBody} The outcome, 42 percent better.`,
    });

    expect(blocked.code).toBe(1);
    const blockedDash = gate(blocked.output, "em_dash");
    expect(blockedDash.verdict).toBe("BLOCK");
    expect(blockedDash.em_dash_offsets).toHaveLength(2);
    expect(blockedDash.remediation).toContain("comma");

    expect(passed.code).toBe(0);
    expect(passed.output.verdict).toBe("PASS");
    const passedDash = gate(passed.output, "em_dash");
    expect(passedDash.verdict).toBe("PASS");
    expect(passedDash.em_dash_offsets).toEqual([]);
  });

  test("announcing copy warns while answering copy does not", async () => {
    const fixture = makeFixture();
    const base = {
      subreddit: "r/PromptEngineering",
      submission_history: history,
      research_path: fixture.researchPath,
    };
    const announcing = await runGate({
      ...base,
      title: "Introducing PromptForge v2",
      body: "I'm excited to share my new tool. I built it last week. Check out https://example.com now.",
    });
    const answering = await runGate({ ...base, body: answeringBody });

    expect(announcing.code).toBe(2);
    expect(announcing.output.verdict).toBe("WARN");
    const announcingFormat = gate(announcing.output, "format_class");
    expect(announcingFormat.verdict).toBe("WARN");
    expect(announcingFormat.classification).toBe("announcing");
    expect((announcingFormat.score as { announcing: number }).announcing).toBeGreaterThan(0);
    expect(
      (announcingFormat.matched_signals as { announcing: unknown[] }).announcing.length,
    ).toBeGreaterThanOrEqual(4);

    expect(answering.code).toBe(0);
    const answeringFormat = gate(answering.output, "format_class");
    expect(answeringFormat.verdict).toBe("PASS");
    expect(answeringFormat.classification).toBe("answering");
    expect(
      (answeringFormat.score as { answering: number }).answering,
    ).toBeGreaterThan(0);
  });

  test("missing ledger warns instead of passing silently", async () => {
    const fixture = makeFixture();
    const result = await runGate({
      subreddit: "r/PromptEngineering",
      body: answeringBody,
      ledger_path: fixture.missingLedgerPath,
      research_path: fixture.researchPath,
    });

    expect(result.code).toBe(2);
    expect(result.output.verdict).toBe("WARN");
    const historyGate = gate(result.output, "surface_history");
    expect(historyGate.verdict).toBe("WARN");
    expect(historyGate.reason).toContain("missing");
    expect(historyGate.remediation).toContain("Create");
  });

  test("missing research warns instead of blocking", async () => {
    const fixture = makeFixture();
    const result = await runGate({
      subreddit: "r/PromptEngineering",
      body: answeringBody,
      submission_history: history,
      research_path: fixture.missingResearchPath,
    });

    expect(result.code).toBe(2);
    expect(result.output.verdict).toBe("WARN");
    expect(result.output.summary.blocks).toBe(0);
    const top50 = gate(result.output, "top50_citation_index");
    expect(top50.verdict).toBe("WARN");
    expect(top50.reason).toContain("missing");
    expect(top50.reason).not.toContain("outside the top-50");
  });

  test("exit code contract is 0 pass, 1 block, 2 warn", async () => {
    const fixture = makeFixture();
    const pass = await runGate({
      subreddit: "r/PromptEngineering",
      body: answeringBody,
      submission_history: history,
      research_path: fixture.researchPath,
    });
    const block = await runGate({
      subreddit: "r/LocalLLaMA",
      body: answeringBody,
      submission_history: history,
      research_path: fixture.researchPath,
    });
    const warn = await runGate({
      subreddit: "r/PromptEngineering",
      body: "I built my new tool and just shipped it.",
      submission_history: history,
      research_path: fixture.researchPath,
    });

    expect([pass.code, block.code, warn.code]).toEqual([0, 1, 2]);
    expect([pass.output.verdict, block.output.verdict, warn.output.verdict]).toEqual([
      "PASS",
      "BLOCK",
      "WARN",
    ]);
  });
});
