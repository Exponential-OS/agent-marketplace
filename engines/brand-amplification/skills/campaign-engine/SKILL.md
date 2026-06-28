---
name: campaign-engine
description: >
  The Master Planner. Initiates campaigns, defines the core thesis, builds the 
  Surface Coverage Matrix, and delegates the actual drafting and sequencing to the 
  Platform-Specific Modules to ensure algorithmic rules are decentralized.
triggers:
  - create campaign
  - build campaign
  - draft campaign
  - start campaign
---

# Campaign Engine

## Purpose

The Campaign Engine is the upstream planner. Rather than acting as a monolithic brain that knows every platform's rules, it acts as the **General Contractor**. It defines the core message and delegates the actual drafting and timing (e.g., "first-hour self-comment on LinkedIn") to the platform-specific modules. This ensures platform knowledge remains perfectly encapsulated.

## Capabilities

### Brain API (brain-kernel >= 1.0.0)

All reads go through `brain.read(path)` / `brain.list(prefix)`. Campaign package
state is written via `brain.write()`. Direct filesystem writes are FORBIDDEN.

### 1. Campaign Initialization
**Triggers:** "create campaign [topic/thesis]"
- Defines the core thesis, the Honey Pot (source material), and the target audience.
- Builds the **Surface Coverage Matrix** by reading `brain.read("identity/handles.md")` (primitive read — reads_from_primitives declared) to ensure no platforms are silently skipped.

### 2. Relevance Gate (post-algorithm)
Runs before drafting or distribution. Source rubric: `skills/social-distribution-engine/content-flywheel.md` → "Post-Algorithm Reset (March 2026): Relevance > Volume".

Compute `relevance_score` as a 0-100 weighted score from the core thesis against the defined target audience:
- **Topic-audience fit (~40 points):** the thesis directly matches what the named target segment cares about.
- **Audience specificity (~30 points):** the campaign is written for a named segment, such as a company's hiring managers or a warm-contact cohort, not a generic audience.
- **Signal-over-vanity intent (~30 points):** the post invites a meaningful response from a target person instead of optimizing for likes from strangers.

**Threshold:** `relevance_score >= 70` to proceed. Below 70 returns the largest gap plus a sharpening suggestion, usually narrow the audience or sharpen the topic, and does **not** advance the campaign to drafting/distribution.

When this gate runs, emit exactly one local event if and only if `XOS_98_TELEMETRY` is enabled. The event is append-style JSONL via `brain.read()` + `brain.write()` to `brand-amplification/telemetry/events.jsonl`; direct filesystem writes are forbidden.

```ts
const passed = relevance_score >= 70;

const telemetryValue =
  (process.env.XOS_98_TELEMETRY ?? "").trim().toLowerCase();
const telemetryEnabled = ["1", "true", "yes", "on"].includes(telemetryValue);

if (telemetryEnabled) {
  const path = "brand-amplification/telemetry/events.jsonl";
  const priorResult = await brain.read(path);
  const prior = priorResult.ok && priorResult.content ? priorResult.content : "";
  const line = JSON.stringify({
    event: "content_strategy_applied",
    relevance_score,
    audience,
    passed,
    ts: new Date().toISOString(),
  });

  await brain.write(path, `${prior}${line}\n`, {
    provenance: {
      who: "brand-amplification",
      why: "content strategy relevance gate applied",
      source: "campaign-engine",
    },
    engine_id: "brand-amplification",
  });
}
```

### 3. Delegation (Drafting & Sequencing)
The Campaign Engine does **NOT** draft the LinkedIn or X posts directly. 
Instead, it invokes the Platform Modules in "Drafting Mode":
- Sends the core thesis to `linkedin-distribution-module`. The LinkedIn module applies its invisible rules (e.g., plans a comment cascade, schedules a T+15 min self-comment) and returns the draft + execution plan.
- Sends the core thesis to `reddit-distribution-module`. The Reddit module applies its anti-promotion rules and returns a highly technical case-study draft.

### 4. Campaign Package Generation
- Aggregates the drafts and execution plans from all modules.
- Generates the canonical machine-readable `campaign.json` under the parent initiative via:
  ```
  brain.write("brand-amplification/campaigns/initiatives/<initiative-slug>/campaigns/<campaign-slug>/campaign.json", content, {
    provenance: { who: "brand-amplification", why: "campaign package generated", source: "campaign-engine" },
    engine_id: "brand-amplification"
  })
  ```
- Uses the schema at `skills/social-distribution-engine/campaign-schema/campaign.schema.json`.
- Writes draft Markdown payloads as content files referenced by `campaign.json`; the JSON is the state machine read by dashboard and preflight gates.
- Updates the parent `initiative.json` campaign reference if the initiative tracks `campaigns[]`.

### 5. Ground Zero Verification
- Enforces the **Visual-Asset Review Invariant**. It prevents the campaign from moving to the `social-distribution-engine` until a human or secondary reviewer has explicitly verified the visual assets for the generated drafts.
