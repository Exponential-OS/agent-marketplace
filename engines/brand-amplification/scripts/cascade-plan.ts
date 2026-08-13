export const LINKEDIN_POST_URL_PLACEHOLDER =
  "[LinkedIn post URL - paste after Step 1 is live]";

export const DEFAULT_SPOKES = ["x"] as const;

const DRAFT_STATUS = "DRAFT";
const SCREENSHOT_ID = "substack-source-screenshot";
const GRADUATION_THRESHOLD = 10;

export interface SubstackCascadeSource {
  url: string;
  title: string;
  excerpt: string;
}

export interface CascadePlanOptions {
  configuredSpokes?: string[];
  linkedInPostUrl?: string;
}

export interface ScreenshotReference {
  id: string;
  sourceUrl: string;
  instruction: string;
  reusedBy: string[];
  visualReviewRequired: true;
}

export interface CascadePlanStep {
  id: string;
  order: number;
  platform: string;
  role: "juice" | "spoke";
  status: "DRAFT";
  dependsOn: string[];
  screenshotRef: string;
  visualReviewRequired: true;
  linkPlacement: string;
  linkTarget: string;
  bodyLinkAllowed: boolean;
  draft: string;
  notes: string[];
}

export interface CascadePlan {
  mode: "DRAFT_ONLY";
  source: SubstackCascadeSource;
  screenshot: ScreenshotReference;
  sequence: CascadePlanStep[];
  linkTargetMap: Record<string, string>;
  dependencies: string[];
  approval: {
    ladder: "DRAFT -> approve(~10) -> graduate";
    approveThreshold: number;
    graduation: string;
  };
  guardrails: string[];
}

function cleanInline(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\|/g, "/")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanDraftText(value: string): string {
  return cleanInline(value)
    .replace(/\bhttps?:\/\/\S+/gi, "[link removed from draft body]")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function compactExcerpt(excerpt: string, maxLength: number): string {
  const cleaned = cleanDraftText(excerpt).replace(/\s+/g, " ");
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizePlatform(platform: string): string {
  const key = cleanInline(platform).toLowerCase().replace(/\s+/g, "-");
  if (["twitter", "x-twitter", "x_post", "x-post"].includes(key)) return "x";
  if (["linkedin", "linkedin-post", "linkedin_post"].includes(key)) return "linkedin";
  if (["substack", "substack-post", "substack_post"].includes(key)) return "substack";
  return key;
}

export function resolveSpokes(configuredSpokes: string[] = []): string[] {
  const seen = new Set<string>();
  const spokes: string[] = [];

  for (const raw of [...DEFAULT_SPOKES, ...configuredSpokes]) {
    const platform = normalizePlatform(raw);
    if (!platform || platform === "linkedin" || platform === "substack") {
      continue;
    }
    if (seen.has(platform)) continue;
    seen.add(platform);
    spokes.push(platform);
  }

  return spokes;
}

function buildLinkedInDraft(source: SubstackCascadeSource): string {
  const title = cleanDraftText(source.title);
  const excerpt = compactExcerpt(source.excerpt, 420);

  return [
    "The useful part is usually underneath the visible artifact.",
    "",
    title,
    "",
    excerpt,
    "",
    "I wrote the longer version because the pattern is starting to matter more than the individual example.",
    "",
    "Full piece is linked in the first comment.",
    "",
    "#TheWhyCyborg #PersonalAgents #AILeadership",
  ].join("\n");
}

function buildXDraft(source: SubstackCascadeSource, linkedInPostUrl: string): string {
  const title = cleanDraftText(source.title);
  const excerpt = compactExcerpt(source.excerpt, 150);

  return [
    "Tweet 1",
    "The screenshot is the artifact. The conversation should happen on LinkedIn.",
    "",
    title,
    "",
    "Reply 1",
    excerpt,
    "",
    "Reply 2",
    `Read the LinkedIn conversation here: ${linkedInPostUrl}`,
    "",
    "#TheWhyCyborg #AI",
  ].join("\n");
}

function buildThreadsDraft(source: SubstackCascadeSource, linkedInPostUrl: string): string {
  const title = cleanDraftText(source.title);
  const excerpt = compactExcerpt(source.excerpt, 260);

  return [
    "The post is longer than this screenshot, but the screenshot is the fastest way in.",
    "",
    title,
    "",
    excerpt,
    "",
    `Join the LinkedIn conversation: ${linkedInPostUrl}`,
  ].join("\n");
}

function buildFacebookDraft(source: SubstackCascadeSource, linkedInPostUrl: string): string {
  const title = cleanDraftText(source.title);
  const excerpt = compactExcerpt(source.excerpt, 320);

  return [
    "I wrote this longer piece and am routing the conversation through LinkedIn first.",
    "",
    title,
    "",
    excerpt,
    "",
    `LinkedIn discussion: ${linkedInPostUrl}`,
  ].join("\n");
}

function buildInstagramDraft(source: SubstackCascadeSource, linkedInPostUrl: string): string {
  const title = cleanDraftText(source.title);

  return [
    "Carousel/caption draft",
    title,
    "",
    "Screenshot from the Substack post goes first.",
    "",
    `Conversation link target for bio/story sticker: ${linkedInPostUrl}`,
    "",
    "#TheWhyCyborg #PersonalAgents #AgenticAI #AILeadership #GenAI",
  ].join("\n");
}

function buildGenericSpokeDraft(
  platform: string,
  source: SubstackCascadeSource,
  linkedInPostUrl: string,
): string {
  const title = cleanDraftText(source.title);
  const excerpt = compactExcerpt(source.excerpt, 240);

  return [
    `${platform} draft`,
    title,
    "",
    excerpt,
    "",
    `Link target: ${linkedInPostUrl}`,
  ].join("\n");
}

function buildSpokeDraft(
  platform: string,
  source: SubstackCascadeSource,
  linkedInPostUrl: string,
): string {
  if (platform === "x") return buildXDraft(source, linkedInPostUrl);
  if (platform === "threads") return buildThreadsDraft(source, linkedInPostUrl);
  if (platform === "facebook") return buildFacebookDraft(source, linkedInPostUrl);
  if (platform === "instagram") return buildInstagramDraft(source, linkedInPostUrl);
  return buildGenericSpokeDraft(platform, source, linkedInPostUrl);
}

function linkPlacementFor(platform: string): string {
  if (platform === "x") return "Reply 2";
  if (platform === "instagram") return "bio or story sticker";
  return "body or first comment, per current platform module";
}

export function buildCascadePlan(
  input: SubstackCascadeSource,
  options: CascadePlanOptions = {},
): CascadePlan {
  const source: SubstackCascadeSource = {
    url: cleanInline(input.url),
    title: cleanInline(input.title),
    excerpt: cleanInline(input.excerpt),
  };
  const linkedInPostUrl =
    cleanInline(options.linkedInPostUrl ?? "") || LINKEDIN_POST_URL_PLACEHOLDER;
  const spokes = resolveSpokes(options.configuredSpokes);
  const reusedBy = ["linkedin", ...spokes];
  const linkTargetMap: Record<string, string> = {
    "linkedin.comment": source.url,
  };

  const linkedInStep: CascadePlanStep = {
    id: "step-1-linkedin",
    order: 1,
    platform: "linkedin",
    role: "juice",
    status: DRAFT_STATUS,
    dependsOn: [],
    screenshotRef: SCREENSHOT_ID,
    visualReviewRequired: true,
    linkPlacement: "first comment only",
    linkTarget: source.url,
    bodyLinkAllowed: false,
    draft: buildLinkedInDraft(source),
    notes: [
      `Screenshot to take: the Substack post at ${source.url}`,
      `COMMENT link target: ${source.url}`,
      "The link goes in the LinkedIn comment, never the body.",
      "VISUAL REVIEW REQUIRED before posting.",
    ],
  };

  const spokeSteps = spokes.map((platform, index): CascadePlanStep => {
    linkTargetMap[platform] = linkedInPostUrl;
    return {
      id: `step-${index + 2}-${platform}`,
      order: index + 2,
      platform,
      role: "spoke",
      status: DRAFT_STATUS,
      dependsOn: [linkedInStep.id],
      screenshotRef: SCREENSHOT_ID,
      visualReviewRequired: true,
      linkPlacement: linkPlacementFor(platform),
      linkTarget: linkedInPostUrl,
      bodyLinkAllowed: true,
      draft: buildSpokeDraft(platform, source, linkedInPostUrl),
      notes: [
        "Reuse the SAME Substack screenshot from Step 1.",
        `Link target: ${linkedInPostUrl}`,
        "Dependency: publish LinkedIn first, then replace the placeholder with the live LinkedIn post URL.",
        "VISUAL REVIEW REQUIRED before posting.",
      ],
    };
  });

  return {
    mode: "DRAFT_ONLY",
    source,
    screenshot: {
      id: SCREENSHOT_ID,
      sourceUrl: source.url,
      instruction: `Take one screenshot of the Substack post at ${source.url}. Reuse this same screenshot for LinkedIn and every spoke.`,
      reusedBy,
      visualReviewRequired: true,
    },
    sequence: [linkedInStep, ...spokeSteps],
    linkTargetMap,
    dependencies: [
      "Step 1 LinkedIn must be posted before any spoke can use the LinkedIn post URL.",
      "Spoke drafts keep the LinkedIn URL placeholder until Step 1 exists.",
    ],
    approval: {
      ladder: "DRAFT -> approve(~10) -> graduate",
      approveThreshold: GRADUATION_THRESHOLD,
      graduation:
        "Graduation requires an explicit human decision in a future turn. Never auto-graduate from approval counts alone.",
    },
    guardrails: [
      "DRAFT-only planner: no posting, no scheduling, no browser automation, no screenshot capture, and no network calls.",
      "Irreversible-Action Invariant: every step remains DRAFT until a human approves and later explicitly graduates the workflow.",
      "Visual-Asset Review Invariant: every screenshot-bearing step requires visual review before posting.",
      "LinkedIn body-link forbidden: Substack link belongs in the LinkedIn comment only.",
      "Spokes link one rung up to LinkedIn, never directly to Substack.",
      "Honor section 1-only and no-outside-work-disclosure constraints from the source long-form.",
    ],
  };
}

function renderStep(step: CascadePlanStep): string {
  return [
    `Step ${step.order}: ${step.platform} (${step.role})`,
    `Status: ${step.status}`,
    `Depends on: ${step.dependsOn.length ? step.dependsOn.join(", ") : "none"}`,
    `Screenshot: ${step.screenshotRef}`,
    "VISUAL REVIEW REQUIRED before posting.",
    `Link placement: ${step.linkPlacement}`,
    `Link target: ${step.linkTarget}`,
    `Body link allowed: ${step.bodyLinkAllowed ? "yes" : "no"}`,
    "",
    "Draft",
    step.draft,
    "",
    "Notes",
    ...step.notes.map((note) => `- ${note}`),
  ].join("\n");
}

export function renderCascadePlan(plan: CascadePlan): string {
  const lines = [
    "Cascade plan",
    "",
    "Mode: DRAFT_ONLY",
    "Nothing posts. Nothing captures screenshots. Nothing calls the network.",
    `Confidence ladder: ${plan.approval.ladder}`,
    plan.approval.graduation,
    "",
    "Source",
    `Substack URL: ${plan.source.url}`,
    `Title: ${plan.source.title}`,
    `Excerpt: ${plan.source.excerpt}`,
    "",
    "Reusable screenshot",
    `Screenshot ID: ${plan.screenshot.id}`,
    plan.screenshot.instruction,
    `Reused by: ${plan.screenshot.reusedBy.join(", ")}`,
    "VISUAL REVIEW REQUIRED before posting anywhere.",
    "",
    "Sequence and dependencies",
    ...plan.sequence.map((step) => {
      const dependency = step.dependsOn.length
        ? `depends on ${step.dependsOn.join(", ")}`
        : "no prior dependency";
      return `${step.order}. ${step.platform} -> ${dependency}`;
    }),
    ...plan.dependencies.map((dependency) => `- ${dependency}`),
    "",
    "Link-target map",
    ...Object.entries(plan.linkTargetMap).map(([from, to]) => `${from} -> ${to}`),
    "",
    "Guardrails",
    ...plan.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    ...plan.sequence.flatMap((step, index) => [
      renderStep(step),
      ...(index === plan.sequence.length - 1 ? [] : [""]),
    ]),
  ];

  return lines.join("\n").replace(/\|/g, "/");
}

function parseCliArgs(args: string[]): {
  source: Partial<SubstackCascadeSource>;
  options: CascadePlanOptions;
} {
  const source: Partial<SubstackCascadeSource> = {};
  const options: CascadePlanOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--url") {
      source.url = args[++i] ?? "";
    } else if (arg === "--title") {
      source.title = args[++i] ?? "";
    } else if (arg === "--excerpt") {
      source.excerpt = args[++i] ?? "";
    } else if (arg === "--spokes") {
      options.configuredSpokes = (args[++i] ?? "")
        .split(",")
        .map((platform) => platform.trim())
        .filter(Boolean);
    } else if (arg === "--linkedin-url") {
      options.linkedInPostUrl = args[++i] ?? "";
    }
  }

  return { source, options };
}

function assertCliSource(source: Partial<SubstackCascadeSource>): asserts source is SubstackCascadeSource {
  if (!source.url || !source.title || !source.excerpt) {
    throw new Error(
      "Usage: bun scripts/cascade-plan.ts --url <substack-url> --title <title> --excerpt <excerpt> [--spokes x,threads,facebook] [--linkedin-url <url>]",
    );
  }
}

if (import.meta.main) {
  try {
    const { source, options } = parseCliArgs(process.argv.slice(2));
    assertCliSource(source);
    console.log(renderCascadePlan(buildCascadePlan(source, options)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
