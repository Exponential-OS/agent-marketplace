import Bun from "bun";

const LIVE_STATUSES = new Set(["published", "live", "sent"]);
const PENDING_STATUSES = new Set(["pending", "draft", "ready", "ready_for_review", "ready_to_publish", "scheduled"]);

interface CampaignContext {
  campaign_file: string;
  target?: string;
}

interface OutResponse {
  status: "pass" | "block" | "warn";
  target: string;
  blocking_deps: Record<string, string>[];
  message: string;
}

async function logToEnforcementLog(entry: Record<string, unknown>) {
  const logPath = `${process.env.HOME}/.career-os-enforcement-log.jsonl`;
  const line = JSON.stringify(entry) + "\n";
  await Bun.write(logPath, line, { append: true });
}

function out(
  code: 0 | 1 | 2,
  status: "pass" | "block" | "warn",
  target: string,
  blocking_deps: Record<string, string>[],
  message: string
): never {
  const response: OutResponse = { status, target, blocking_deps, message };
  console.log(JSON.stringify(response));

  logToEnforcementLog({
    timestamp: new Date().toISOString(),
    status,
    target,
    blocking_deps,
    message,
    rule: "flywheel-sequence-guard",
  }).catch(() => {});

  process.exit(code);
}

function getStatus(obj: Record<string, unknown> | undefined): string {
  if (!obj) return "";
  const s = obj.status;
  if (typeof s !== "string") return "";
  return s.toLowerCase().trim();
}

function isLive(obj: Record<string, unknown> | undefined): boolean {
  return LIVE_STATUSES.has(getStatus(obj));
}

async function main() {
  let argVal = Bun.argv[2];

  // Handle stdin sentinel
  if (argVal === undefined || argVal === "-") {
    const stdinText = await new Response(Bun.stdin).text();
    argVal = stdinText.trim();
  }

  if (!argVal) {
    out(2, "warn", "", [], "No input provided.");
  }

  let ctx: CampaignContext;
  try {
    ctx = JSON.parse(argVal!);
  } catch (e) {
    out(1, "block", "", [], `Invalid JSON: ${String(e)}`);
  }

  const campaign_file = ctx.campaign_file || "";
  const target_id = ctx.target || "";

  if (!campaign_file) {
    out(2, "warn", "", [], "campaign_file is required.");
  }

  let campaign: Record<string, unknown>;
  try {
    const campaignContent = await Bun.file(campaign_file).text();
    campaign = JSON.parse(campaignContent);
  } catch (e) {
    out(2, "warn", "", [], `Cannot parse campaign.json: ${String(e)}`);
  }

  const source = (campaign.source as Record<string, unknown>) || {};
  const hub = (campaign.hub as Record<string, unknown>) || {};
  const spokes = (campaign.spokes as Record<string, unknown>[]) || [];

  // Index spokes by id and role
  const spoke_by_id: Record<string, Record<string, unknown>> = {};
  let post_hub: Record<string, unknown> | null = null;

  for (const s of spokes) {
    const id = s.id as string;
    if (id) spoke_by_id[id] = s;
    if (s.role === "post_hub") {
      post_hub = s;
    }
  }

  // Define the dependency chain
  function check_source() {
    return [];
  }

  function check_hub() {
    if (!isLive(source as Record<string, unknown>)) {
      return [
        {
          id: "source",
          platform: (source.platform as string) || "substack",
          status: getStatus(source as Record<string, unknown>),
          reason: "Substack (source) must publish first — LinkedIn Article body links to it.",
        },
      ];
    }
    return [];
  }

  function check_post_hub() {
    const deps: Record<string, string>[] = [];
    if (!isLive(source as Record<string, unknown>)) {
      deps.push({
        id: "source",
        platform: (source.platform as string) || "substack",
        status: getStatus(source as Record<string, unknown>),
        reason: "Substack must be live before Post Hub.",
      });
    }
    if (!isLive(hub as Record<string, unknown>)) {
      deps.push({
        id: "hub",
        platform: (hub.platform as string) || "linkedin",
        type: (hub.type as string) || "article",
        status: getStatus(hub as Record<string, unknown>),
        reason: "LinkedIn Article must publish BEFORE Post Hub — first-comment needs Article URL.",
      });
    }
    return deps;
  }

  function check_spoke(spoke: Record<string, unknown>) {
    const spoke_id = spoke.id as string;
    const role = spoke.role as string;
    if (role === "post_hub") {
      return check_post_hub();
    }
    // All non-hub spokes need post_hub live
    const deps = check_post_hub();
    if (post_hub && !isLive(post_hub)) {
      const ph_id = (post_hub.id as string) || "spoke-linkedin-post";
      const ph_status = getStatus(post_hub);
      if (!deps.some((d) => d.id === ph_id)) {
        deps.push({
          id: ph_id,
          platform: "linkedin",
          type: "post",
          status: ph_status,
          reason: `LinkedIn Post Hub must be live before ${spoke_id} — all spokes drive to it.`,
        });
      }
    }
    return deps;
  }

  // Determine what to check
  if (!target_id) {
    // Check overall readiness
    const seen_dep_ids: Record<string, Record<string, string>> = {};

    function add_deps(deps: Record<string, string>[]) {
      for (const d of deps) {
        const did = d.id;
        if (did && !seen_dep_ids[did]) {
          seen_dep_ids[did] = d;
        }
      }
    }

    add_deps(check_hub());
    if (post_hub) {
      add_deps(check_post_hub());
    }
    for (const spoke of spokes) {
      if ((spoke.role as string) === "post_hub") {
        continue;
      }
      add_deps(check_spoke(spoke));
    }

    const unsatisfied = Object.values(seen_dep_ids);
    if (unsatisfied.length > 0) {
      out(
        1,
        "block",
        "all",
        unsatisfied,
        `BLOCK — ${unsatisfied.length} unsatisfied dependencies. Publish in Estate order: Substack → LinkedIn Article → LinkedIn Post → Spokes.`
      );
    } else {
      out(0, "pass", "all", [], "PASS — All dependency constraints satisfied. Publish in Estate order.");
    }
  } else if (target_id === "source") {
    const blocking = check_source();
    if (blocking.length > 0) {
      out(1, "block", target_id, blocking, `BLOCK — ${target_id} has unsatisfied dependencies.`);
    }
    out(0, "pass", target_id, [], `PASS — ${target_id} has no dependencies. Safe to publish.`);
  } else if (target_id === "hub") {
    const blocking = check_hub();
    if (blocking.length > 0) {
      out(1, "block", target_id, blocking, "BLOCK — LinkedIn Article cannot publish yet. Substack must publish first.");
    }
    out(0, "pass", target_id, [], "PASS — Substack is live. Safe to publish LinkedIn Article.");
  } else if (target_id in spoke_by_id) {
    const spoke = spoke_by_id[target_id];
    const blocking = check_spoke(spoke);
    if (blocking.length > 0) {
      out(1, "block", target_id, blocking, `BLOCK — ${target_id} cannot publish yet. Unsatisfied dependencies.`);
    }
    out(0, "pass", target_id, [], `PASS — All dependencies for ${target_id} are live.`);
  } else {
    out(
      2,
      "warn",
      target_id,
      [],
      `Unknown target '${target_id}'. Valid: 'source', 'hub', or a spoke id from campaign.json.`
    );
  }
}

main().catch((e) => {
  out(2, "warn", "", [], `Unexpected error: ${String(e)}`);
});
