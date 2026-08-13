---
name: audience-preview
description: >
  Shows which warm contacts from the local people graph are likely to see a
  draft post based on topic alignment and relationship warmth. Advisory only.
  Use before publishing when the user asks who will see this, who this post is
  for, likely warm audience, or whether to target or tag contacts.
triggers:
  - who will see this
  - audience preview
  - likely audience
  - warm contacts for this post
  - who is this post for
  - target this post
---

# Audience Preview - Career OS Skill

## Purpose

Before publishing a draft post, show which warm contacts from the local people
graph are likely to notice it. The preview is advisory only. It helps the user
target, tag, or tune the post before publishing. It does not post, schedule,
open social surfaces, scrape, browse, or call any external service.

## Output Format

Output plain text only. Do not use markdown tables or pipe characters.

Always start with:

```text
Career OS: Audience Preview
```

Then print the helper output:

```text
Warm contacts likely to see this post:
```

End with a short note:

```text
Advisory only. No post was published.
```

## Workflow

1. Get the draft post from the user or from the local draft context already in
   the session.
2. Extract 3 to 6 themes as short keywords or topics. Prefer concrete nouns and
   expertise lanes from the draft, such as AI systems, platform engineering,
   hiring, founder sales, infra, or career transitions.
3. Read local people records from `network/people/`. Prefer JSON files. Skip
   unreadable, malformed, or non-object files. Do not fail the whole preview
   because one contact is malformed.
4. Pass the extracted themes and the parsed people array to `scoreAudience`.
5. Print `formatAudiencePreview(ranked, { limit: 10 })`.
6. Emit local PII-free telemetry with `audience_count` and the top score only.

Use only local files or brain-readable local data. Do not retrieve LinkedIn,
social feeds, websites, remote profiles, or analytics.

## Helper Contract

```ts
import {
  formatAudiencePreview,
  scoreAudience,
} from "$CLAUDE_PLUGIN_ROOT/src/pipeline/audience-preview";
import { emitAudiencePreviewViewed } from "$CLAUDE_PLUGIN_ROOT/src/telemetry/events";

const themes = ["AI", "systems", "platform"];
const people = [
  {
    name: "Jane",
    company: "Acme",
    their_expertise: "AI systems architecture",
    warmth: "5 - close collaborator",
  },
];

const ranked = scoreAudience(themes, people);
console.log(formatAudiencePreview(ranked, { limit: 10 }));
emitAudiencePreviewViewed({
  audience_count: ranked.length,
  top_score: ranked[0]?.score ?? 0,
});
```

The helper tolerates messy `warmth` values:

- number values are clamped to 1 through 5
- strings with a leading integer use that integer
- strings without a leading integer default to 2
- null or missing warmth defaults to 1

## Privacy And Safety

Telemetry event: `audience_preview_viewed`.

The telemetry payload is local-only, gated by `XOS_98_TELEMETRY`, and written
through the shared local JSONL emitter. It must contain only:

- audience count
- top score bucket
- timestamp

Do not include names, companies, roles, expertise text, post text, matched
themes, people file paths, or other PII in telemetry.
