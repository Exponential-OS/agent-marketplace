#!/usr/bin/env bun
// handler.ts — campaign-estate-quality-check enforcement (TypeScript+Bun replacement for HOW.py)
// Semantic gate: evaluates the full campaign package against the SDE Estate Model distribution thesis.
// Uses OAuth CLI (claude → gemini → codex fallback). Set SKIP_LLM_JUDGES=1 to bypass in CI.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";

const SLUG = "campaign-estate-quality-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(SCRIPT_DIR, "PROMPT.md");

const SKIP_LLM_JUDGES = !!process.env.SKIP_LLM_JUDGES || process.argv.includes("--ci");

const CLI_ORDER = ["claude", "gemini", "codex"] as const;
const CLI_TIMEOUT: Record<string, number> = { claude: 120_000, gemini: 30_000, codex: 120_000 };

const STATUS_MAP: Record<string, string> = { PASS: "pass", WARN: "warn", BLOCK: "block" };
const EXIT_MAP: Record<string, number> = { pass: 0, block: 1, warn: 2 };

interface Campaign {
  meta?: Record<string, unknown>;
  review?: Record<string, unknown>;
  source?: Record<string, unknown>;
  hub?: Record<string, unknown>;
  spokes?: Array<Record<string, unknown>>;
  comment_cascade?: unknown;
  [key: string]: unknown;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  try { appendFileSync(LOG_PATH, JSON.stringify({ ts, rule_slug: SLUG, ...extra }) + "\n"); } catch { /* fail-open */ }
}

function out(exitCode: number, result: Record<string, unknown>): never {
  process.stdout.write(JSON.stringify(result) + "\n");
  log({ verdict: result.status ?? result.verdict, fired: true });
  process.exit(exitCode);
}

function readContentFile(path: string, campaignDir: string): string {
  const resolved = isAbsolute(path) ? path : join(campaignDir, path);
  if (!existsSync(resolved)) return `[MISSING: ${path}]`;
  try { return readFileSync(resolved, "utf-8"); } catch { return `[ERROR: could not read ${path}]`; }
}

function buildJudgePackage(campaign: Campaign, campaignDir: string): string {
  const lines: string[] = [];

  lines.push("=== CAMPAIGN META ===");
  lines.push(JSON.stringify(campaign.meta ?? {}, null, 2));

  lines.push("\n=== REVIEW FLAGS ===");
  lines.push(JSON.stringify(campaign.review ?? {}, null, 2));

  const source = (campaign.source ?? {}) as Record<string, unknown>;
  lines.push(`\n=== SOURCE (${source.platform ?? "substack"}) ===`);
  lines.push(`Status: ${source.status ?? "unknown"}`);
  if (source.content_file) {
    lines.push(`--- content (${source.content_file}) ---`);
    lines.push(readContentFile(String(source.content_file), campaignDir));
  }

  const hub = (campaign.hub ?? {}) as Record<string, unknown>;
  lines.push(`\n=== HUB (${hub.platform ?? "linkedin"} / ${hub.type ?? "article"}) ===`);
  lines.push(`Status: ${hub.status ?? "unknown"}`);
  if (hub.content_file) {
    lines.push(`--- content (${hub.content_file}) ---`);
    lines.push(readContentFile(String(hub.content_file), campaignDir));
  }

  for (const spoke of (campaign.spokes ?? []) as Array<Record<string, unknown>>) {
    const sid = spoke.id ?? "unknown";
    lines.push(`\n=== SPOKE: ${sid} (${spoke.platform ?? "unknown"} / ${spoke.role ?? "spoke"}) ===`);
    lines.push(`Status: ${spoke.status ?? "unknown"}`);
    if (spoke.content_file) {
      lines.push(`--- content (${spoke.content_file}) ---`);
      lines.push(readContentFile(String(spoke.content_file), campaignDir));
    }
  }

  const cascade = campaign.comment_cascade;
  if (cascade) {
    lines.push("\n=== COMMENT CASCADE ===");
    if (typeof cascade === "object" && !Array.isArray(cascade)) {
      const c = cascade as Record<string, unknown>;
      if (c.content_file) lines.push(readContentFile(String(c.content_file), campaignDir));
      for (const dayKey of ["day_1_targets", "day_2_targets"]) {
        const targets = (c[dayKey] as unknown[]) ?? [];
        if (targets.length > 0) {
          lines.push(`\n-- ${dayKey} (${targets.length} entries) --`);
          for (const t of targets.slice(0, 3)) {
            if (typeof t === "object" && t !== null) {
              const te = t as Record<string, unknown>;
              lines.push(`  platform: ${te.platform ?? "?"}, text: ${String(te.text ?? "").slice(0, 120)}`);
            }
          }
        }
      }
    } else if (Array.isArray(cascade)) {
      for (const entry of cascade) {
        if (typeof entry === "object" && entry !== null) {
          const e = entry as Record<string, unknown>;
          lines.push(`\n-- Cascade target: ${e.target ?? "unknown"} --`);
          if (e.content_file) lines.push(readContentFile(String(e.content_file), campaignDir));
        }
      }
    }
  }

  return lines.join("\n");
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

async function callCli(prompt: string, pkg: string): Promise<Record<string, unknown> | null> {
  const fullPrompt = `${prompt}\n\n${pkg}`;

  for (const cli of CLI_ORDER) {
    if (!(await whichCli(cli))) continue;
    const timeout = CLI_TIMEOUT[cli] ?? 60_000;
    try {
      let result;
      if (cli === "claude") {
        result = Bun.spawnSync(["claude", "-p", fullPrompt], { stdout: "pipe", stderr: "pipe", timeout });
      } else if (cli === "gemini") {
        result = Bun.spawnSync(["gemini", "-p", prompt, "--yolo"], {
          stdout: "pipe", stderr: "pipe", timeout,
          stdin: new TextEncoder().encode(pkg),
        });
      } else {
        result = Bun.spawnSync(["codex", "exec", fullPrompt], { stdout: "pipe", stderr: "pipe", timeout });
      }
      const body = new TextDecoder().decode(result.stdout).trim();
      if (!body) continue;
      const parsed = extractJson(body);
      if (parsed && "verdict" in parsed) {
        parsed._cli_used = cli;
        return parsed;
      }
    } catch { continue; }
  }
  return null;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) out(2, { status: "warn", message: "No input provided." });

  let ctx: { campaign_file?: string };
  try { ctx = JSON.parse(raw); }
  catch (e: unknown) { out(1, { status: "block", message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }); }

  const campaignFile = ctx!.campaign_file ?? "";
  if (!campaignFile) out(2, { status: "warn", message: "campaign_file is required." });
  if (!existsSync(campaignFile)) out(2, { status: "warn", message: `campaign.json not found: ${campaignFile}` });

  let campaign: Campaign;
  try { campaign = JSON.parse(readFileSync(campaignFile, "utf-8")); }
  catch (e: unknown) { out(2, { status: "warn", message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}` }); }

  const campaignId = (campaign!.meta as Record<string, unknown>)?.id ?? dirname(campaignFile).split("/").pop() ?? "unknown";
  const campaignDir = dirname(campaignFile);

  if (SKIP_LLM_JUDGES) {
    log({ verdict: "warn", campaign_id: campaignId, findings_count: 0 });
    out(2, {
      status: "warn",
      message: "WARN — LLM judge skipped (SKIP_LLM_JUDGES=1); human review of Estate model packaging required before ship.",
      ci_mode: true,
      campaign_id: campaignId,
    });
  }

  if (!existsSync(PROMPT_FILE)) {
    out(2, { status: "warn", message: `PROMPT.md not found at ${PROMPT_FILE}` });
  }

  const prompt = readFileSync(PROMPT_FILE, "utf-8");
  const pkg = buildJudgePackage(campaign!, campaignDir);
  const judgeResult = await callCli(prompt, pkg);

  if (judgeResult === null) {
    log({ verdict: "warn", campaign_id: campaignId, findings_count: 0 });
    out(2, {
      status: "warn",
      message: "WARN — no CLI available (claude/gemini/codex not on PATH); human review required.",
      campaign_id: campaignId,
    });
  }

  const verdict = String(judgeResult!.verdict ?? "WARN").toUpperCase();
  const status = STATUS_MAP[verdict] ?? "warn";
  const findings = (judgeResult!.findings as unknown[]) ?? [];
  const blockFindings = findings.filter((f: unknown) => (f as Record<string,unknown>).severity === "block");
  const warnFindings = findings.filter((f: unknown) => (f as Record<string,unknown>).severity === "warn");

  let message: string;
  if (status === "pass") {
    message = `PASS — Estate model correctly implemented. ${findings.length} findings (0 blocks, 0 warns).`;
  } else if (status === "warn") {
    message = `WARN — ${warnFindings.length} advisory finding(s). Review before ship. ${judgeResult!.reason ?? ""}`;
  } else {
    message = `BLOCK — ${blockFindings.length} Estate model violation(s). ${judgeResult!.reason ?? ""}`;
  }

  log({ verdict: status, campaign_id: campaignId, findings_count: findings.length });
  out(EXIT_MAP[status] ?? 2, {
    status,
    message,
    campaign_id: campaignId,
    verdict,
    reason: judgeResult!.reason ?? "",
    findings,
    strengths: judgeResult!.strengths ?? [],
    suggestions: judgeResult!.suggestions ?? [],
    cli_used: judgeResult!._cli_used ?? "unknown",
  });
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    status: "block",
    message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
  }) + "\n");
  process.exit(1);
});
