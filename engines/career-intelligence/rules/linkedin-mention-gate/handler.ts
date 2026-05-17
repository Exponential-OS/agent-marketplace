#!/usr/bin/env bun
/**
 * handler.ts — linkedin-mention-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "person": "Exact LinkedIn Display Name",
 *   "name_verified": true,              // confirmed from people file or human
 *   "mention_picker_attempted": true,   // type_text "@Name" was used (not execCommand)
 *   "mention_picker_result": "found|not_found|skipped",
 *   "human_confirmed_fallback": false   // human explicitly said "go ahead plain text"
 * }
 *
 * Exits: 0=PASS, 1=BLOCK
 */

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "linkedin-mention-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

interface InputContext {
  person?: string;
  name_verified?: boolean;
  mention_picker_attempted?: boolean;
  mention_picker_result?: string;
  human_confirmed_fallback?: boolean;
}

interface OutputResult {
  verdict: string;
  reason?: string;
  remediation?: string;
  person?: string;
  mention_picker_result?: string;
  [key: string]: unknown;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rec = { ts, rule_slug: SLUG, ...extra };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
  } catch {
    // Fail-open on logging errors
  }
}

function emit(output: OutputResult, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw =
    argVal === undefined || argVal === "-"
      ? (await Bun.stdin.text()).trim()
      : argVal;

  if (!raw) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          "No input. Pass JSON with person/name_verified/mention_picker_attempted/mention_picker_result fields.",
      },
      1
    );
  }

  let ctx: InputContext;
  try {
    ctx = JSON.parse(raw);
  } catch (e: unknown) {
    emit(
      {
        verdict: "BLOCK",
        reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
      1
    );
  }

  const person = ctx!.person ?? "(unknown)";
  const nameVerified = ctx!.name_verified ?? false;
  const pickerAttempted = ctx!.mention_picker_attempted ?? false;
  const pickerResult = ctx!.mention_picker_result ?? "skipped";
  const humanConfirmed = ctx!.human_confirmed_fallback ?? false;

  // Gate 1: name must be verified before touching the picker
  if (!nameVerified) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          `Name for '${person}' not verified. Check their people file for exact LinkedIn ` +
          "display name, or ask human: 'What is [person]'s exact name on LinkedIn?' " +
          "Never type a guessed name into the picker.",
        remediation:
          "Read brain/network/people/<slug>.json → use 'name' field. If file missing → ask human.",
      },
      1
    );
  }

  // Gate 2: picker must be attempted (not bypassed with execCommand/insertText)
  if (!pickerAttempted) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          `@mention picker not attempted for '${person}'. Must use type_text tool with ` +
          "'@Name' to trigger LinkedIn's resolver — not document.execCommand or insertText, " +
          "which bypass the picker and produce plain text only.",
        remediation:
          "Use type_text '@{verified_name}' into focused LinkedIn editor, then wait for picker dropdown.",
      },
      1
    );
  }

  // Gate 3: if picker found nothing, must have human confirmation before posting plain text
  if (pickerResult === "not_found" && !humanConfirmed) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          `LinkedIn mention picker could not find '${person}' (likely 3rd+ connection or ` +
          "no recent engagement with the post). STOP — do NOT post plain text silently.",
        remediation:
          `Ask human: 'I can't find ${person} in the LinkedIn mention picker ` +
          "(likely 3rd+ connection with no recent engagement). Can you provide their " +
          "LinkedIn profile URL so I can @tag them correctly?' " +
          "Wait for URL or explicit 'go ahead plain text' before proceeding.",
      },
      1
    );
  }

  emit(
    {
      verdict: "PASS",
      person,
      mention_picker_result: pickerResult,
    },
    0
  );
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "BLOCK",
      reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
