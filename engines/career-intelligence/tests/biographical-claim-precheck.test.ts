// Regression tests for the biographical-claim-precheck gate (XOS-34), canonical TS impl.
// Mirrors tests/test_biographical_claim_precheck.py — both the legacy HOW.py and the
// canonical handler.ts must BLOCK fabricated/inflated/JD-bled numbers and PASS grounded ones.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HANDLER = join(import.meta.dir, "..", "rules", "biographical-claim-precheck", "handler.ts");

const CANONICAL = `# Alex Rivera — Experience History
Vantage Systems — Senior Engineering Manager 2019-03 to 2024-11
- Led platform engineering org: 18 engineers across 3 teams
- Owned real-time payments infrastructure processing $2B/year
- Postgres scaling initiative to 1M TPS
- Managed $4.2M annual infra budget
- Grew team from 6 to 18; hired 9 engineers, promoted 4 to senior/staff
- fluxcache: distributed cache library, 2.3k GitHub stars
`;

async function run(draft: string): Promise<{ exit: number; verdict: string }> {
  const dir = mkdtempSync(join(tmpdir(), "claimgate-"));
  const draftPath = join(dir, "draft.md");
  const canonPath = join(dir, "experience-history.md");
  writeFileSync(draftPath, draft);
  writeFileSync(canonPath, CANONICAL);
  const ctx = JSON.stringify({ draft_path: draftPath, canonical_sources: [canonPath], stakes: "T4" });
  const proc = Bun.spawnSync(["bun", HANDLER, ctx]);
  const out = JSON.parse(proc.stdout.toString());
  return { exit: proc.exitCode ?? -1, verdict: out.verdict };
}

test("grounded draft passes", async () => {
  const r = await run("- Owned payments infra processing $2B/year; scaled Postgres to 1M TPS\n- Led 18 engineers; 2.3k GitHub stars\n");
  expect(r.verdict).toBe("PASS");
  expect(r.exit).toBe(0);
});

test("fabricated percentage blocks", async () => {
  const r = await run("- Reduced overhead by 60% and cut MTTR by 45%\n");
  expect(r.verdict).toBe("BLOCK");
});

test("fabricated dollar savings blocks", async () => {
  const r = await run("- Identified $1.1M in savings\n");
  expect(r.verdict).toBe("BLOCK");
});

test("JD-bleed (employer 50M events) blocks", async () => {
  const r = await run("- Handled peak throughput of 50M+ transaction events\n");
  expect(r.verdict).toBe("BLOCK");
});

test("inflated count blocks", async () => {
  const r = await run("- Served 400+ payment corridors\n");
  expect(r.verdict).toBe("BLOCK");
});

test("grounded number beside fabricated still blocks", async () => {
  const r = await run("- Owned payments infra processing $2B/year at 99.99% uptime\n");
  expect(r.verdict).toBe("BLOCK");
});

test("approx career total (10+ years) is exempt", async () => {
  const r = await run("Engineering leader with 10+ years.\n- Owned payments infra processing $2B/year; led 18 engineers\n");
  expect(r.verdict).toBe("PASS");
});

test("lowercase scale unit (180k) is grounded and passes", async () => {
  // 180k isn't in canonical, but 1M is — this draft uses only grounded figures.
  const r = await run("- Scaled Postgres to 1M TPS; managed $4.2M budget\n");
  expect(r.verdict).toBe("PASS");
});

test("precise tenure inflation (25 years) blocks", async () => {
  const r = await run("Engineering leader with 25 years at Vantage.\n");
  expect(r.verdict).toBe("BLOCK");
});
