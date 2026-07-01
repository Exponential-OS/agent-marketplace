import { readFileSync } from "fs";
import { emitEvent, ts, type EmitEventOptions, type EmitEventResult, type TelemetryEvent } from "../telemetry/events";

export const MILESTONE_BRAND_SUGGESTED_EVENT = "milestone_brand_suggested";

export const NOTABLE_STAGES = new Set([
  "screen",
  "phone_screen",
  "recruiter_screen",
  "advancing",
  "interview",
  "interviewing",
  "in_process",
  "panel_interview",
  "onsite",
  "final_round",
  "awaiting_decision",
  "offer",
  "offered",
  "new_role",
  "shipped",
]);

export interface DetectShareableMilestonesOptions {
  notableStages?: ReadonlySet<string> | readonly string[];
}

export interface MilestoneBrandMoment {
  company: string;
  role: string;
  ref: string;
  stage: string;
  angle?: string;
}

export interface MilestoneBrandSuggestedEvent extends TelemetryEvent {
  event: typeof MILESTONE_BRAND_SUGGESTED_EVENT;
  count: number;
  stage_breakdown: Record<string, number>;
  ts: string;
}

export interface MilestoneBrandTelemetryOptions extends EmitEventOptions {
  now?: Date;
}

export function detectShareableMilestones(
  pipeline: unknown,
  opts: DetectShareableMilestonesOptions = {},
): MilestoneBrandMoment[] {
  const notableStages = normalizedStageSet(opts.notableStages ?? NOTABLE_STAGES);
  const moments: MilestoneBrandMoment[] = [];
  const seen = new Set<string>();

  for (const entry of extractStageData(pipeline)) {
    if (!isRecord(entry)) continue;

    const company = stringField(entry.company ?? entry.company_name);
    const role = stringField(entry.role ?? entry.title);
    if (!company || !role) continue;

    const ref = refForEntry(entry, company, role);
    const entryStage = normalizeStage(entry.stage);
    const entryAngle = angleField(entry);

    addIfShareable({
      moments,
      seen,
      notableStages,
      company,
      role,
      ref,
      stage: entryStage,
      shareable: isExplicitlyShareable(entry),
      angle: entryAngle,
    });

    for (const milestone of milestoneObjects(entry)) {
      const stage = normalizeStage(milestone.stage ?? milestone.type ?? milestone.name ?? entry.stage);
      addIfShareable({
        moments,
        seen,
        notableStages,
        company,
        role,
        ref,
        stage,
        shareable: isExplicitlyShareable(milestone),
        angle: angleField(milestone) ?? entryAngle,
      });
    }
  }

  return moments;
}

export function buildBrandMomentPrompt(milestone: MilestoneBrandMoment): string {
  const lines = [
    `Milestone: ${milestone.role} at ${milestone.company} reached ${displayStage(milestone.stage)}.`,
    "Draft a brand post with the campaign engine?",
    `Reference: ${milestone.ref}`,
    `Starter angle: ${milestone.angle ?? defaultStarterAngle(milestone.stage)}`,
    "Gate: PRE-GATE suggestion — opt-in shareability only. Before surfacing/drafting you MUST (1) run the Company Action Gate (company-flags filter, action=apply/follow_up — suppress deprioritized/flagged companies) and (2) confirm it is firewall-safe (no AI-Fund / no-outside-work-disclosure exposure). Nothing publishes automatically; the human-approved publishing gate still applies.",
  ];

  return lines.join("\n");
}

export function buildMilestoneBrandSuggestedEvent(
  milestones: readonly MilestoneBrandMoment[],
  now: Date = new Date(),
): MilestoneBrandSuggestedEvent {
  return {
    event: MILESTONE_BRAND_SUGGESTED_EVENT,
    count: milestones.length,
    stage_breakdown: stageBreakdown(milestones),
    ts: ts(now),
  };
}

export function emitMilestoneBrandSuggested(
  milestones: readonly MilestoneBrandMoment[],
  options: MilestoneBrandTelemetryOptions = {},
): EmitEventResult<MilestoneBrandSuggestedEvent> {
  const event = buildMilestoneBrandSuggestedEvent(milestones, options.now);
  return emitEvent(event, options);
}

function addIfShareable(input: {
  moments: MilestoneBrandMoment[];
  seen: Set<string>;
  notableStages: ReadonlySet<string>;
  company: string;
  role: string;
  ref: string;
  stage: string;
  shareable: boolean;
  angle?: string;
}): void {
  if (!input.shareable || !input.notableStages.has(input.stage)) return;

  const key = `${input.ref}\0${input.stage}`;
  if (input.seen.has(key)) return;
  input.seen.add(key);

  input.moments.push({
    company: input.company,
    role: input.role,
    ref: input.ref,
    stage: input.stage,
    ...(input.angle ? { angle: input.angle } : {}),
  });
}

function extractStageData(pipeline: unknown): unknown[] {
  if (Array.isArray(pipeline)) return pipeline;
  if (!isRecord(pipeline) || !Array.isArray(pipeline.stage_data)) return [];
  return pipeline.stage_data;
}

function milestoneObjects(entry: Record<string, unknown>): Record<string, unknown>[] {
  const values = [entry.milestone, entry.brand_milestone, entry.milestones, entry.brand_milestones];
  const out: Record<string, unknown>[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      out.push(...value.filter(isRecord));
    } else if (isRecord(value)) {
      out.push(value);
    }
  }

  return out;
}

function isExplicitlyShareable(value: Record<string, unknown>): boolean {
  return value.shareable === true || value.brand_shareable === true;
}

function normalizedStageSet(stages: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  const values = stages instanceof Set ? [...stages] : stages;
  return new Set(values.map(normalizeStage).filter(Boolean));
}

function normalizeStage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function displayStage(stage: string): string {
  return normalizeStage(stage).replace(/_/g, " ") || "milestone";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function primitiveRef(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function refForEntry(entry: Record<string, unknown>, company: string, role: string): string {
  const trackerId = primitiveRef(entry.tracker_id);
  if (trackerId !== undefined) return `#${trackerId}`;

  const id = primitiveRef(entry.id);
  if (id !== undefined) return String(id);

  const slug = stringField(entry.slug);
  if (slug) return slug;

  return `${company} - ${role}`;
}

function angleField(value: Record<string, unknown>): string | undefined {
  return stringField(
    value.angle
      ?? value.brand_angle
      ?? value.starter_angle
      ?? value.brand_post_angle
      ?? value.milestone_angle,
  );
}

function defaultStarterAngle(stage: string): string {
  const normalized = normalizeStage(stage);
  if (normalized === "offer" || normalized === "offered") {
    return "Share the career lesson or decision criteria without disclosing private process details.";
  }
  if (normalized.includes("interview") || normalized === "screen" || normalized === "phone_screen") {
    return "Share a useful preparation insight without revealing private job-search details.";
  }
  if (normalized === "shipped") {
    return "Share the customer problem, tradeoff, or lesson behind the shipped work.";
  }
  return "Share the durable lesson behind this milestone without disclosing sensitive details.";
}

function stageBreakdown(milestones: readonly MilestoneBrandMoment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const milestone of milestones) {
    const stage = normalizeStage(milestone.stage);
    if (!stage) continue;
    counts[stage] = (counts[stage] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCliArgs(argv: string[]): { pipelinePath?: string; prompts: boolean } {
  const args: { pipelinePath?: string; prompts: boolean } = { prompts: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pipeline") {
      args.pipelinePath = argv[i + 1];
      i += 1;
    } else if (arg === "--prompts") {
      args.prompts = true;
    }
  }
  return args;
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.pipelinePath) {
    console.error("usage: bun src/pipeline/milestone-brand.ts --pipeline <job-pipeline.json> [--prompts]");
    process.exit(2);
  }

  let pipeline: unknown;
  try {
    pipeline = JSON.parse(readFileSync(args.pipelinePath, "utf-8")) as unknown;
  } catch {
    pipeline = {};
  }

  const milestones = detectShareableMilestones(pipeline);
  if (args.prompts) {
    // These prompts are PRE-GATE: opt-in shareability is enforced here, but the
    // Company Action Gate (company-flags) + firewall check are applied by the
    // milestone-brand skill, NOT this helper. Never post raw CLI output.
    console.error(
      "⚠ PRE-GATE output — apply the Company Action Gate (company-flags) + firewall check + human publishing approval before surfacing or drafting. Do not post raw.",
    );
    console.log(milestones.map(buildBrandMomentPrompt).join("\n\n"));
  } else {
    console.log(JSON.stringify(milestones, null, 2));
  }
}
