#!/usr/bin/env bun
// handler.ts — company-flags-filter enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: prevents deprioritized or flagged companies from appearing in dashboard action items.
// A 92% score on a deprioritized company must never surface as "apply now" — the flag wins.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "company-flags-filter";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

interface DeprioritizedEntry {
  company: string;
  reason?: string;
  re_evaluate_if?: string;
  [key: string]: unknown;
}

interface FlaggedEntry {
  company: string;
  action?: string;
  flag?: string;
  note?: string;
  [key: string]: unknown;
}

interface WarmReferralEntry {
  company: string;
  status?: string;
  contact?: string;
  follow_up?: string;
  [key: string]: unknown;
}

interface FlagsFile {
  deprioritized?: DeprioritizedEntry[];
  flagged?: FlaggedEntry[];
  warm_referral_active?: WarmReferralEntry[];
  [key: string]: unknown;
}

interface InputCtx {
  company: string;
  action?: string;
  flags_file: string;
}

interface Output {
  verdict: "pass" | "block" | "warn";
  reason: string;
  re_evaluate_if: string | null;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rec = { ts, rule_slug: SLUG, ...extra };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
  } catch {
    /* fail-open */
  }
}

function emit(output: Output, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function loadFlags(flagsFile: string): FlagsFile {
  try {
    return JSON.parse(readFileSync(flagsFile, "utf-8")) as FlagsFile;
  } catch {
    // If flags file missing or unreadable, PASS (don't block on missing config)
    return {};
  }
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "pass", reason: "no input — defaulting to pass", re_evaluate_if: null }, 0);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "block", reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, re_evaluate_if: null }, 1);
  }

  const company = (ctx.company ?? "").trim();
  const action = ctx.action ?? "apply";
  const flagsFile = ctx.flags_file ?? "";

  if (!company) {
    emit({ verdict: "block", reason: "company field is required", re_evaluate_if: null }, 1);
  }

  if (!flagsFile) {
    emit({ verdict: "block", reason: "flags_file path is required", re_evaluate_if: null }, 1);
  }

  const flags = loadFlags(flagsFile);
  const companyLc = normalize(company);

  // Check deprioritized list
  for (const entry of flags.deprioritized ?? []) {
    if (normalize(entry.company ?? "") === companyLc) {
      const reason = entry.reason ?? "Company deprioritized";
      const reEval = entry.re_evaluate_if ?? null;
      emit({ verdict: "block", reason: `DEPRIORITIZED: ${reason}`, re_evaluate_if: reEval }, 1);
    }
  }

  // Check flagged list
  for (const entry of flags.flagged ?? []) {
    if (normalize(entry.company ?? "") === companyLc) {
      const flagAction = entry.action ?? "";
      if (flagAction === "do_not_apply" && (action === "apply" || action === "referral")) {
        const reason = entry.note ?? `Company flagged: ${entry.flag ?? "unknown"}`;
        emit({
          verdict: "block",
          reason: `FLAGGED (${entry.flag ?? ""}): ${reason}`,
          re_evaluate_if: null,
        }, 1);
      }
    }
  }

  // Check warm_referral_active — if referral in flight, surface status not new ask
  for (const entry of flags.warm_referral_active ?? []) {
    if (normalize(entry.company ?? "") === companyLc) {
      const status = entry.status ?? "unknown";
      const contact = entry.contact ?? "unknown";
      const followUp = entry.follow_up ?? "unknown";
      emit({
        verdict: "warn",
        reason: `Referral already in flight via ${contact} (status: ${status}, follow_up: ${followUp}). Surface referral status instead of new action.`,
        re_evaluate_if: `After ${followUp}`,
      }, 2);
    }
  }

  // No flags — action is allowed
  emit({ verdict: "pass", reason: "No active flags", re_evaluate_if: null }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "block",
      reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
      re_evaluate_if: null,
    }) + "\n"
  );
  process.exit(1);
});
