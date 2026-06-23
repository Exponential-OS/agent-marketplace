#!/usr/bin/env bun
// handler.ts — social-content-readiness-check enforcement (TypeScript+Bun replacement for HOW.py)
//
// Two gates fire before any content reaches `status: ready` or publish:
//   Gate 1 — LLM judge panel: 3 parallel cross-family judges (tone/ip_safety/narrative)
//   Gate 2 — metadata completeness (title, platform, audience, surface_coverage_matrix)
//
// Panel rule: ALL judges must return PASS or WARN, AND no more than 1 WARN. Otherwise BLOCK.
// Set SKIP_LLM_JUDGES=1 to bypass Gate 1 in CI (returns WARN for panel).

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "social-content-readiness-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

const SKIP_LLM_JUDGES = !!process.env.SKIP_LLM_JUDGES || process.argv.includes("--ci");

// Cross-family CLI preference per judge (OAuth, no API key needed)
const JUDGE_CLI_PREF: Record<string, string> = {
  tone:      "claude",   // Claude family
  ip_safety: "gemini",   // Google family — cross-family
  narrative: "codex",    // OpenAI family — cross-family
};

const CLI_TIMEOUT: Record<string, number> = {
  claude: 60_000,
  gemini: 20_000,  // fast-fail; can hang on missing key
  codex:  60_000,
};

const SDK_FALLBACK_MODEL = "claude-haiku-4-5-20251001";

const REQUIRED_METADATA_KEYS = ["audience", "surface_coverage_matrix"] as const;

interface JudgeSpec {
  id: string;
  prompt: string;
}

const JUDGES: JudgeSpec[] = [
  {
    id: "tone",
    prompt: [
      "You are a brand-voice judge. The author's authentic voice is direct, specific, intellectually honest, and avoids corporate filler.",
      "Read the draft and return STRICT JSON with this shape: {\"verdict\":\"PASS\"|\"WARN\"|\"BLOCK\",\"reason\":\"...\",\"suggestions\":[\"...\"]}.",
      "PASS = clearly the authentic voice.",
      "WARN = mostly authentic but with one or two corporate-speak / engagement-bait phrases.",
      "BLOCK = generic LinkedIn-influencer voice or hollow inspirational filler — would damage the author's credibility.",
      "Output JSON only — no preamble.",
    ].join(" "),
  },
  {
    id: "ip_safety",
    prompt: [
      "You are an IP / patent firewall judge. Read the draft. Return STRICT JSON:",
      "{\"verdict\":\"PASS\"|\"WARN\"|\"BLOCK\",\"reason\":\"...\",\"suggestions\":[\"...\"]}.",
      "BLOCK = the post discloses unfiled patent claims, internal architecture marked confidential, customer data, or any specific technical method that should be filed before publication.",
      "WARN = the post hints at internal IP without disclosing it but could invite probing questions.",
      "PASS = no IP disclosure risk.",
      "Output JSON only — no preamble.",
    ].join(" "),
  },
  {
    id: "narrative",
    prompt: [
      "You are a narrative-clarity judge. Imagine a reader who has zero prior context about this author or this work.",
      "Read the draft and return STRICT JSON:",
      "{\"verdict\":\"PASS\"|\"WARN\"|\"BLOCK\",\"reason\":\"...\",\"suggestions\":[\"...\"]}.",
      "BLOCK = the hook is unclear, the takeaway is undefined, OR the call-to-action is missing or buried.",
      "WARN = the hook lands but the CTA is implicit / weak.",
      "PASS = a context-free reader gets the hook in one read AND knows what to do next.",
      "Output JSON only — no preamble.",
    ].join(" "),
  },
];

interface JudgeResult {
  judge: string;
  verdict: string;
  reason: string;
  suggestions: string[];
  cli: string;
  cross_family: boolean;
}

interface MetadataResult {
  verdict: string;
  reason: string;
  missing?: string[];
}

interface PanelResult {
  verdict: string;
  reason: string;
  judges: JudgeResult[];
  cli_used: Record<string, string>;
  ci_mode?: boolean;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  try { appendFileSync(LOG_PATH, JSON.stringify({ ts, rule_slug: SLUG, ...extra }) + "\n"); } catch { /* fail-open */ }
}

function emit(output: Record<string, unknown>, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({
    verdict: output.verdict,
    platform: output.platform,
    title: output.title,
    metadata_verdict: (output.metadata_check as MetadataResult)?.verdict,
    panel_verdict: (output.panel as PanelResult)?.verdict,
    fired: true,
  });
  process.exit(exitCode);
}

async function whichCli(cmd: string): Promise<boolean> {
  const result = Bun.spawnSync(["which", cmd], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0;
}

function extractJson(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* try to extract */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
}

function checkMetadata(metadata: Record<string, unknown>, title: string, platform: string): MetadataResult {
  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!platform) missing.push("platform");
  for (const key of REQUIRED_METADATA_KEYS) {
    const value = metadata[key];
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      missing.push(`metadata.${key}`);
    }
  }
  if (missing.length > 0) {
    return {
      verdict: "BLOCK",
      reason: "missing required metadata: " + missing.join(", "),
      missing,
    };
  }
  return { verdict: "PASS", reason: "all required metadata present" };
}

async function callJudgeCli(judgeId: string, systemPrompt: string, content: string): Promise<JudgeResult> {
  const preferred = JUDGE_CLI_PREF[judgeId] ?? "claude";
  const order = preferred === "claude" ? ["claude"] : [preferred, "claude"];
  const fullPrompt = `${systemPrompt}\n\nDRAFT TO EVALUATE:\n${content}`;

  for (const cli of order) {
    if (!(await whichCli(cli))) continue;
    const timeout = CLI_TIMEOUT[cli] ?? 60_000;
    try {
      let result;
      if (cli === "claude") {
        result = Bun.spawnSync(["claude", "-p", fullPrompt], { stdout: "pipe", stderr: "pipe", timeout });
      } else if (cli === "gemini") {
        result = Bun.spawnSync(["gemini", "-p", systemPrompt, "--yolo"], {
          stdout: "pipe", stderr: "pipe", timeout,
          stdin: new TextEncoder().encode(content),
        });
      } else {
        result = Bun.spawnSync(["codex", "exec", fullPrompt], { stdout: "pipe", stderr: "pipe", timeout });
      }
      const body = new TextDecoder().decode(result.stdout).trim();
      if (!body) continue;
      const parsed = extractJson(body);
      if (!parsed) continue;
      return {
        judge: judgeId,
        verdict: String(parsed.verdict ?? "WARN").toUpperCase(),
        reason: String(parsed.reason ?? ""),
        suggestions: (parsed.suggestions as string[]) ?? [],
        cli,
        cross_family: cli !== "claude",
      };
    } catch { continue; }
  }

  // Try SDK fallback if ANTHROPIC_API_KEY present
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const response = await client.messages.create({
        model: SDK_FALLBACK_MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content }],
      });
      let body = "";
      for (const block of response.content) {
        if (block.type === "text") body += block.text;
      }
      const parsed = extractJson(body.trim());
      if (parsed) {
        return {
          judge: judgeId,
          verdict: String(parsed.verdict ?? "WARN").toUpperCase(),
          reason: String(parsed.reason ?? ""),
          suggestions: (parsed.suggestions as string[]) ?? [],
          cli: "sdk",
          cross_family: false,
        };
      }
    } catch { /* fall through */ }
  }

  return {
    judge: judgeId,
    verdict: "WARN",
    reason: `no CLI reachable for judge '${judgeId}'; human review required`,
    suggestions: [],
    cli: "none",
    cross_family: false,
  };
}

async function runJudgePanel(text: string, title: string, platform: string): Promise<PanelResult> {
  if (SKIP_LLM_JUDGES) {
    return {
      verdict: "WARN",
      reason: "LLM judges skipped (SKIP_LLM_JUDGES=1 or --ci flag); human review required before ship",
      judges: [],
      cli_used: {},
      ci_mode: true,
    };
  }

  const payloadForJudge = `PLATFORM: ${platform}\nTITLE: ${title}\n\nDRAFT:\n---\n${text}\n---`;

  // Run all 3 judges in parallel
  const results = await Promise.all(
    JUDGES.map(({ id, prompt }) => callJudgeCli(id, prompt, payloadForJudge))
  );

  const verdicts = results.map(r => r.verdict);
  const blocks = verdicts.filter(v => v === "BLOCK").length;
  const warns = verdicts.filter(v => v === "WARN").length;

  let panelVerdict: string;
  let reason: string;

  if (blocks > 0 || warns > 1) {
    panelVerdict = "BLOCK";
    reason = `panel BLOCK: ${blocks} blocking, ${warns} warning verdicts (rule: 0 BLOCK and <=1 WARN required to ship)`;
  } else if (warns === 1) {
    panelVerdict = "WARN";
    reason = "panel WARN: 1 warning verdict; review before ship";
  } else {
    panelVerdict = "PASS";
    reason = "panel PASS: all judges returned PASS";
  }

  const cliUsed: Record<string, string> = {};
  for (const r of results) cliUsed[r.judge] = r.cli;

  return {
    verdict: panelVerdict,
    reason,
    judges: results,
    cli_used: cliUsed,
  };
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({
      verdict: "BLOCK",
      reason: 'missing context JSON. Pass: {"text":"...","platform":"...","title":"...","metadata":{...}}',
    }, 1);
  }

  let ctx: {
    text?: string;
    platform?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };
  try { ctx = JSON.parse(raw); }
  catch (e: unknown) {
    emit({ verdict: "BLOCK", reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 1);
  }

  const text = (ctx!.text ?? "").trim();
  const platform = (ctx!.platform ?? "").trim().toLowerCase();
  const title = (ctx!.title ?? "").trim();
  const metadata = ctx!.metadata ?? {};

  if (!text) {
    emit({
      verdict: "BLOCK",
      platform,
      title,
      reason: "text field is required and must be non-empty",
    }, 1);
  }

  // Gate 1: LLM judge panel + Gate 2: metadata — run in parallel
  const [panelResult, metadataResult] = await Promise.all([
    runJudgePanel(text, title, platform),
    Promise.resolve(checkMetadata(metadata, title, platform)),
  ]);

  const componentVerdicts = [
    metadataResult.verdict,
    panelResult.verdict,
  ];

  let verdict: string;
  let exitCode: number;

  if (componentVerdicts.some(v => v === "BLOCK")) {
    verdict = "BLOCK";
    exitCode = 1;
  } else if (componentVerdicts.some(v => v === "WARN")) {
    verdict = "WARN";
    exitCode = 2;
  } else {
    verdict = "PASS";
    exitCode = 0;
  }

  emit({
    verdict,
    platform,
    title,
    metadata_check: metadataResult,
    panel: panelResult,
    next_action: verdict === "PASS"
      ? "ship"
      : verdict === "BLOCK"
        ? "review-and-rewrite"
        : "human-review-before-ship",
  }, exitCode);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    verdict: "BLOCK",
    reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
  }) + "\n");
  process.exit(1);
});
