#!/usr/bin/env bun
// handler.ts — warm-contact-outreach-dedup enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: before suggesting or drafting outreach to a named contact, check their people file
// for existing recent outreach. BLOCK if outreach was sent within the lookback window (default 14 days).

import { appendFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const SLUG = "warm-contact-outreach-dedup";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CAREER_HOME = process.env.CAREER_HOME ?? process.env.CAREER_OS_HOME ?? null;
const DEFAULT_PEOPLE_DIR = CAREER_HOME ? join(CAREER_HOME, "brain/network/people") : null;
const DEFAULT_LOOKBACK_DAYS = 14;

interface InputCtx {
  contact_name: string;
  people_dir?: string;
  lookback_days?: number;
}

type OutputPass = { verdict: "PASS" };
type OutputBlock = {
  verdict: "BLOCK";
  reason: string;
  last_contact: string;
  days_since_outreach: number;
  people_file: string;
};
type Output = OutputPass | OutputBlock;

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

function findPeopleFile(contactName: string, peopleDir: string): string | null {
  const nameParts = contactName.toLowerCase().split(/\s+/).filter(Boolean);
  let candidates: string[];
  try {
    candidates = readdirSync(peopleDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(peopleDir, f));
  } catch {
    return null;
  }

  // Filename match (slug form): replace "-" with " " and check all name parts present
  for (const filePath of candidates) {
    const stem = basename(filePath, ".md").replace(/-/g, " ").toLowerCase();
    if (nameParts.every((part) => stem.includes(part))) {
      return filePath;
    }
  }

  // Frontmatter / heading match: check first 20 lines
  for (const filePath of candidates) {
    try {
      const lines = readFileSync(filePath, "utf-8").split("\n").slice(0, 20);
      for (const line of lines) {
        if (nameParts.every((part) => line.toLowerCase().includes(part))) {
          return filePath;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractLastContact(text: string): string | null {
  const lines = text.split("\n");
  // Primary: last_contact frontmatter field (first 30 lines)
  for (const line of lines.slice(0, 30)) {
    const m = line.trim().match(/^last_contact:\s*(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  // Fallback: last_message_sent (first 50 lines)
  for (const line of lines.slice(0, 50)) {
    const m = line.trim().match(/^last_message_sent:\s*(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return null;
}

function extractFollowUp(text: string): string | null {
  for (const line of text.split("\n").slice(0, 30)) {
    const m = line.trim().match(/^follow_up:\s*(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return null;
}

function extractLatestOutreachEntry(text: string): string {
  let logSection = false;
  const entries: string[] = [];
  for (const line of text.split("\n")) {
    if (/## outreach log/i.test(line)) {
      logSection = true;
      continue;
    }
    if (logSection) {
      if (line.startsWith("## ")) break;
      if (/^\s*-\s*\*\*\d{4}-\d{2}-\d{2}/.test(line)) {
        entries.push(line.trim().replace(/^-\s*/, ""));
      }
    }
  }
  return entries.length > 0 ? entries[entries.length - 1] : "";
}

function check(d: InputCtx): OutputBlock | null {
  const contactName = (d.contact_name ?? "").trim();
  if (!contactName) {
    return { verdict: "BLOCK", reason: "contact_name is required", last_contact: "", days_since_outreach: 0, people_file: "" };
  }

  const peopleDir = d.people_dir ?? DEFAULT_PEOPLE_DIR;
  const lookbackDays = Number(d.lookback_days ?? DEFAULT_LOOKBACK_DAYS);

  if (!existsSync(peopleDir)) {
    return null; // Can't check — fail open
  }

  const peopleFile = findPeopleFile(contactName, peopleDir);
  if (!peopleFile) {
    return null; // No file → no prior outreach on record
  }

  let text: string;
  try {
    text = readFileSync(peopleFile, "utf-8");
  } catch {
    return null;
  }

  const lastContactStr = extractLastContact(text);
  if (!lastContactStr) return null;

  let lastContact: Date;
  try {
    lastContact = new Date(lastContactStr);
    if (isNaN(lastContact.getTime())) return null;
  } catch {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  lastContact.setHours(0, 0, 0, 0);
  const daysAgo = Math.floor((today.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24));

  if (daysAgo <= lookbackDays) {
    const summary = extractLatestOutreachEntry(text);
    const followUp = extractFollowUp(text);
    const parts: string[] = [
      `Outreach to ${contactName} already sent ${daysAgo}d ago (${lastContactStr}).`,
      summary ? `Most recent: ${summary}` : "",
      followUp ? `Follow-up scheduled: ${followUp}` : "",
      "Check for a reply instead of re-suggesting outreach.",
    ].filter(Boolean);

    return {
      verdict: "BLOCK",
      reason: parts.join(" "),
      last_contact: lastContactStr,
      days_since_outreach: daysAgo,
      people_file: peopleFile,
    };
  }

  return null;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "PASS" }, 0);
  }

  let d: InputCtx;
  try {
    d = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "BLOCK", reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, last_contact: "", days_since_outreach: 0, people_file: "" }, 1);
  }

  const blockResult = check(d);
  if (blockResult) {
    emit(blockResult, 1);
  }

  emit({ verdict: "PASS" }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "BLOCK",
      reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
      last_contact: "",
      days_since_outreach: 0,
      people_file: "",
    }) + "\n"
  );
  process.exit(1);
});
