#!/usr/bin/env bun
// handler.ts — outreach-people-file-commit enforcement (TypeScript+Bun replacement for HOW.py)
// Unit-of-work commit: update people file fields and git-commit atomically after send

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const SLUG = "outreach-people-file-commit";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

interface ConversationHistory { [key: string]: string }
interface Updates {
  last_contact?: string;
  follow_up?: string;
  conversation_history?: ConversationHistory;
  commitments_made?: string;
  [key: string]: unknown;
}
interface Input {
  people_file?: string;
  career_home?: string;
  updates?: Updates;
  commit_message?: string;
}
interface Output {
  status: string;
  committed: boolean;
  sha: string | null;
  errors: string[];
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  try { appendFileSync(LOG_PATH, JSON.stringify({ ts, rule_slug: SLUG, ...extra }) + "\n"); } catch { /* fail-open */ }
}

function emit(output: Output, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.status, fired: true });
  process.exit(exitCode);
}

function updateFrontmatterField(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^(${key.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}:\\s*)(.+)$`, "m");
  const updated = content.replace(pattern, `$1${value}`);
  if (updated !== content) return updated;
  // Field missing — inject before closing ---
  const end = content.indexOf("\n---", 3);
  if (end !== -1) return content.slice(0, end) + `\n${key}: ${value}` + content.slice(end);
  return content;
}

function updateConversationHistory(content: string, convUpdates: ConversationHistory): string {
  let result = content;
  for (const [subkey, subval] of Object.entries(convUpdates)) {
    const pattern = new RegExp(`^(\\s+${subkey.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}:\\s*)(.+)$`, "m");
    const updated = result.replace(pattern, `$1${subval}`);
    if (updated !== result) result = updated;
  }
  return result;
}

function appendCommitment(content: string, commitment: string, lastContact: string): string {
  const dateStr = lastContact || "unknown date";
  const newEntry = `  - "${commitment} (${dateStr})"\n`;
  // Try to append after existing commitments_made block
  const updated = content.replace(/(commitments_made:\s*\n(?:\s+-[^\n]*\n)*)/, `$1${newEntry}`);
  if (updated !== content) return updated;
  // Handle empty list
  return content.replace(/(commitments_made:\s*)\[\]/, `$1\n  - "${commitment} (${dateStr})"`);
}

function gitCommit(careerHome: string, peopleFile: string, commitMsg: string): { success: boolean; sha: string } {
  const rel = relative(careerHome, peopleFile);
  const addResult = Bun.spawnSync(["git", "-C", careerHome, "add", rel], { stderr: "pipe" });
  if (addResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(addResult.stderr);
    return { success: false, sha: stderr.trim() };
  }
  const commitResult = Bun.spawnSync(["git", "-C", careerHome, "commit", "-m", commitMsg], { stderr: "pipe" });
  if (commitResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(commitResult.stderr);
    if (stderr.includes("nothing to commit") || stderr.includes("nothing added to commit")) {
      return { success: true, sha: "already-clean" };
    }
    return { success: false, sha: stderr.trim() };
  }
  const shaResult = Bun.spawnSync(["git", "-C", careerHome, "rev-parse", "--short", "HEAD"], { stdout: "pipe" });
  const sha = new TextDecoder().decode(shaResult.stdout).trim();
  return { success: true, sha };
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) emit({ status: "block", committed: false, sha: null, errors: ["Usage: handler.ts '<json>'"] }, 1);

  let ctx: Input;
  try { ctx = JSON.parse(raw); }
  catch (e: unknown) {
    emit({ status: "block", committed: false, sha: null, errors: [`Invalid JSON input: ${e instanceof Error ? e.message : String(e)}`] }, 1);
  }

  const errors: string[] = [];
  const { people_file: peopleFile, career_home: careerHome, updates = {}, commit_message: commitMsg = "" } = ctx!;

  if (!peopleFile) errors.push("people_file is required");
  else if (!existsSync(peopleFile)) errors.push(`people_file not found: ${peopleFile}`);

  if (!careerHome) errors.push("career_home is required");
  else if (!existsSync(careerHome)) errors.push(`career_home not found: ${careerHome}`);

  if (!commitMsg) errors.push("commit_message is required — must identify contact + action");
  if (!updates || Object.keys(updates).length === 0) errors.push("updates is empty — nothing to write");

  if (errors.length > 0) emit({ status: "block", committed: false, sha: null, errors }, 1);

  // Validate date formats
  for (const dateField of ["last_contact", "follow_up"] as const) {
    const val = updates![dateField];
    if (val) {
      const datePart = String(val).split("(")[0].trim().split(" ")[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        errors.push(`${dateField} must be ISO date (YYYY-MM-DD), got: ${val}`);
      }
    }
  }
  if (errors.length > 0) emit({ status: "block", committed: false, sha: null, errors }, 1);

  let content: string;
  try { content = readFileSync(peopleFile!, "utf-8"); }
  catch (e: unknown) { emit({ status: "block", committed: false, sha: null, errors: [`Cannot read people file: ${e instanceof Error ? e.message : String(e)}`] }, 1); }

  // Apply updates
  for (const [key, val] of Object.entries(updates!)) {
    if (key === "conversation_history" && typeof val === "object" && val !== null) {
      content = updateConversationHistory(content!, val as ConversationHistory);
    } else if (key === "commitments_made" && typeof val === "string") {
      content = appendCommitment(content!, val, updates!.last_contact ?? "unknown date");
    } else if (typeof val === "string" || typeof val === "number") {
      content = updateFrontmatterField(content!, key, String(val));
    }
  }

  try { writeFileSync(peopleFile!, content!); }
  catch (e: unknown) { emit({ status: "block", committed: false, sha: null, errors: [`Cannot write people file: ${e instanceof Error ? e.message : String(e)}`] }, 1); }

  const { success, sha } = gitCommit(careerHome!, peopleFile!, commitMsg!);
  if (!success) {
    emit({ status: "warn", committed: true, sha: null, errors: [`File updated but git commit failed: ${sha}`] }, 2);
  }

  emit({ status: "ok", committed: true, sha, errors: [] }, 0);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ status: "block", committed: false, sha: null, errors: [`Uncaught: ${err instanceof Error ? err.message : String(err)}`] }) + "\n");
  process.exit(1);
});
