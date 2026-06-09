---
name: campaign-dashboard
description: >
  Brand amplification home screen for BAE customers. Shows INITIATIVES
  (strategic themes) rolled up with their member CAMPAIGNS (individual ship
  events) and SPOKES (per-platform posts). Read-only — never writes; routes
  edits to campaign-engine and distribution-analytics-engine.
triggers:
  - campaigns
  - show campaigns
  - campaign dashboard
  - campaign status
  - initiative status
  - initiatives
  - show initiatives
  - social pulse
  - what's live
  - whats live
  - distribution status
  - sde dashboard
  - my campaigns
  - my initiatives
---

# Campaign Dashboard — Social Distribution Home Screen

## Output Format

Always start with:

```
━━━ Brand Amplification · Campaign Dashboard ━━━
```

## Purpose

The user views their social-distribution state. The dashboard is **read-only** — it shows initiatives → campaigns → spokes, plus per-initiative KPIs and per-campaign status. All writes go through `campaign-engine` (planner/builder), `distribution-analytics-engine` (KPI updates), or `social-distribution-engine` (orchestrator). This skill never writes files.

## The Hierarchy

```
INITIATIVE  (strategic theme — months/quarters)
   └── CAMPAIGN  (single ship event — one source + spokes — days/weeks)
          └── SPOKE  (one platform post — hub / honey-pot / X / Reddit / etc.)
```

- **Initiative** is the parent. Owns audience, outcome goals, channel topology, time horizon.
- **Campaign** is one ship event under an initiative. Owns source content + spokes.
- **Spoke** is one platform's post. Owns the platform-native asset + status.

A user can have many initiatives running. Each initiative has many campaigns. Each campaign has many spokes.

## Storage Convention

### Brain API (brain-kernel >= 1.0.0)

All reads go through `brain.read(path)` / `brain.list(prefix)`. The new-initiative
sub-flow writes via `brain.write()`. Direct filesystem writes are FORBIDDEN.

Initiatives live at:
```
brain.read("brand-amplification/campaigns/initiatives/<initiative-slug>/initiative.json")
brain.list("brand-amplification/campaigns/initiatives/")
```

Each initiative.json conforms to the schema at:
```
$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/social-distribution-engine/campaign-schema/initiative.schema.json 2>/dev/null | tail -1)
```

Campaigns live under their initiative:
```
brain.read("brand-amplification/campaigns/initiatives/<initiative-slug>/campaigns/<campaign-slug>/campaign.json")
```

(A campaign.json can reference its parent via `meta.initiative_id`.)

## What the Dashboard Shows

### Section 1 — Active Initiatives (default view)

For every initiative with `status: active`:

```
[ICON] {initiative.title}
       {tagline}
       Audience: {audience.primary}
       Goal: {first outcome_goal: target} (current: {current ?? '—'})
       Campaigns: {N total} · {N live} live · {N drafting} drafting · {N planning} planning
       Time: started {started} · expected {expected_end}
```

Icons: 🟢 active, 🟡 paused, ⚪ planning, ✅ complete, ❌ abandoned.

### Section 2 — Recent Campaigns (last 14 days)

Pull from each initiative's `campaigns[]` array. Filter to `ship_date` in the last 14 days OR `status` in {drafting, ready_for_review, scheduled, live, measuring}. Show:

```
{ICON} {campaign.title}            ({initiative.title})
       Status: {campaign.status}   Ship: {ship_date}
       Spokes: {live}/{total} live
```

### Section 3 — Stale Campaigns (need attention)

Surface campaigns that:
- `status: drafting` for > 14 days (stale draft)
- `status: scheduled` past the ship_date (missed window)
- `status: measuring` for > 7 days without KPI update (measurement gap)

### Section 4 — Quick Actions

Show the 4-6 most common next moves based on dashboard state:
- "new campaign for [active initiative]" — route to `campaign-engine`
- "distribute campaign [name]" — route to `social-distribution-engine`
- "measure campaign [name]" — route to `distribution-analytics-engine`
- "new initiative" — route to onboarding-for-initiative (see below)
- "audit initiative [name]" — route to `distribution-analytics-engine` (rollup mode)

## Routing (this skill DISPATCHES, never writes)

| User intent | Route to | Trigger examples |
|---|---|---|
| Create / plan a new campaign | `campaign-engine` | "new campaign", "plan campaign for X" |
| Create a new initiative | `campaign-dashboard.new-initiative` (this skill's sub-flow) | "new initiative", "start an initiative" |
| Edit/update a campaign | `campaign-engine` | "update campaign X", "change spoke Y" |
| Distribute a ready campaign | `social-distribution-engine` | "distribute campaign X", "ship campaign X" |
| Measure / pull KPIs | `distribution-analytics-engine` | "measure X", "kpis for X", "how did X perform" |
| Show a single campaign in detail | this skill (campaign-detail sub-view) | "show campaign X", "details of X" |
| Pause / resume an initiative | `campaign-engine` | "pause initiative X", "resume X" |
| Mark initiative complete | `campaign-engine` | "complete initiative X", "wrap initiative X" |

## Sub-flow: new-initiative

When the user says "new initiative" or equivalent:

1. Read via `brain.read("brand-amplification/identity/professional-brand.md")` for audience defaults.
2. Read via `brain.read("brand-amplification/strategy/brand-spec.json")` for channel defaults (hub, honey_pot, spokes).
3. Ask the user (one at a time):
   - "What's the strategic theme of this initiative? (one phrase)"
   - "Who is it for? (primary audience)"
   - "What outcome are you optimizing for? (metric + target)"
   - "When does it start? (default: today) When does it end? (default: 6 months)"
   - "Use your default channels (hub={brand.hub}, honey_pot={brand.honey_pot}), or override?"
4. Generate the slug from the title (kebab-case, ≤ 40 chars).
5. Show the proposed `initiative.json` and ask for confirmation.
6. On confirm:
   ```
   brain.write("brand-amplification/campaigns/initiatives/<slug>/initiative.json", content, {
     provenance: { who: "brand-amplification", why: "new initiative created", source: "campaign-dashboard" },
     engine_id: "brand-amplification"
   })
   ```
   brain.write() creates parent dirs automatically — no separate mkdir needed.
7. Suggest the next move: "new campaign under this initiative".

## How to Implement (agent instructions)

The agent rendering this dashboard:

1. **Resolve workspace root** — brain-kernel resolves this automatically; no `$CAREER_HOME` env dependency.
2. **Discover initiatives:** `brain.list("brand-amplification/campaigns/initiatives/")` and filter to paths ending in `initiative.json` (skip if list returns empty — render empty state with "no initiatives yet" + offer "new initiative").
3. **Parse each `initiative.json`** with `jq`. Validate against schema (warn on missing fields; do not block).
4. **For each initiative, scan `campaigns/*.json`** under it. Build the rollup counts.
5. **Render the four sections** above (active initiatives, recent campaigns, stale, quick actions).
6. **Wait for user input.** Route per the table above.

### Empty state

If no initiatives exist:
```
━━━ Brand Amplification · Campaign Dashboard ━━━

You haven't started any initiatives yet.

An INITIATIVE is a strategic theme that contains multiple campaigns.
Examples: "Cyborg series" · "AI thought leadership" · "Consulting pivot Q3"

Type `new initiative` to start, or `show channels` to review your hub/spoke setup first.
```

## Plain-text discipline

The dashboard renders in markdown for terminal display. If the user asks for content to copy-paste (e.g., "give me the campaign summary for Slack"), strip markdown formatting per the Plain-Text Invariant (no pipes, no bold, no code blocks).

## What this skill does NOT do

- Never writes campaign.json (campaign-engine owns that)
- Never publishes to platforms (social-distribution-engine owns that)
- Never edits initiative.json *content* except via the new-initiative sub-flow (and even then it asks for confirmation)
- Never pulls platform engagement data live (distribution-analytics-engine owns the analytics surface)

## Relationship to mission-control

Mission-control is the top-level home screen for the WHOLE Career OS (job-search + BAE). Campaign-dashboard is the BAE-focused home screen — invoked from mission-control via the `campaigns` / `campaign dashboard` triggers, or directly.

For BAE-only customers (career-intelligence-onboarding not run), mission-control short-circuits and shows campaign-dashboard as the default view.
