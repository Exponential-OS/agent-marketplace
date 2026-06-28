#!/usr/bin/env bun
// handler.ts - warm-path-query local query handler.
// JSON argv/stdin in, JSON stdout out. No network calls; append-only local log only.

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { warmPathsToCompany } from "../../src/network/warm-path-query";
import type { WarmPathEvent, WarmPathQueryResult } from "../../src/network/warm-path-query";

const SLUG = "warm-path-query";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

interface InputCtx {
  company?: string;
  target_company?: string;
  people_dir?: string;
  event_log_path?: string;
}

interface ErrorOutput {
  target_company: string;
  paths: [];
  error: string;
}

type Output = WarmPathQueryResult | ErrorOutput;

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rec = { ts, rule_slug: SLUG, ...extra };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
  } catch {
    /* fail-open */
  }
}

function localJsonlSink(path: string): (event: WarmPathEvent) => void {
  return (event: WarmPathEvent): void => {
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    try {
      appendFileSync(path, JSON.stringify({ ts, rule_slug: SLUG, ...event }) + "\n");
    } catch {
      /* fail-open */
    }
  };
}

function emit(output: Output, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({
    verdict: "pass",
    target_company: output.target_company,
    path_count: output.paths.length,
    error: "error" in output ? output.error : undefined,
    fired: true,
  });
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ target_company: "", paths: [], error: "company field is required" }, 1);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({
      target_company: "",
      paths: [],
      error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    }, 1);
  }

  const company = (ctx.company ?? ctx.target_company ?? "").trim();
  if (!company) {
    emit({ target_company: "", paths: [], error: "company field is required" }, 1);
  }

  const result = warmPathsToCompany(company, {
    peopleDir: ctx.people_dir,
    eventSink: ctx.event_log_path ? localJsonlSink(ctx.event_log_path) : undefined,
  });

  emit(result, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      target_company: "",
      paths: [],
      error: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n",
  );
  process.exit(1);
});
