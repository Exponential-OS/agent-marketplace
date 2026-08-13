import { describe, expect, test } from "bun:test";
import {
  LINKEDIN_POST_URL_PLACEHOLDER,
  buildCascadePlan,
  renderCascadePlan,
  resolveSpokes,
} from "../scripts/cascade-plan";

const source = {
  url: "https://example.substack.com/p/the-operating-system-underneath-ai",
  title: "The operating system underneath AI work",
  excerpt:
    "The useful artifact is not the announcement. It is the repeatable system that makes the announcement obvious.",
};

describe("cascade planner", () => {
  test("builds the exact link-target map for LinkedIn comment and spokes", () => {
    const plan = buildCascadePlan(source, {
      configuredSpokes: ["threads", "facebook"],
    });

    expect(plan.linkTargetMap).toEqual({
      "linkedin.comment": source.url,
      x: LINKEDIN_POST_URL_PLACEHOLDER,
      threads: LINKEDIN_POST_URL_PLACEHOLDER,
      facebook: LINKEDIN_POST_URL_PLACEHOLDER,
    });

    const linkedIn = plan.sequence[0];
    expect(linkedIn.platform).toBe("linkedin");
    expect(linkedIn.linkPlacement).toBe("first comment only");
    expect(linkedIn.linkTarget).toBe(source.url);
    expect(linkedIn.draft).not.toContain(source.url);
    // Comment-only is LinkedIn-specific: LinkedIn forbids body links...
    expect(linkedIn.bodyLinkAllowed).toBe(false);

    for (const step of plan.sequence.slice(1)) {
      expect(step.linkTarget).toBe(LINKEDIN_POST_URL_PLACEHOLDER);
      expect(step.notes.join("\n")).toContain("Reuse the SAME Substack screenshot");
      // ...but spokes intentionally carry the LinkedIn link in their body/reply to climb the funnel.
      expect(step.bodyLinkAllowed).toBe(true);
    }
  });

  test("orders LinkedIn before every spoke and records dependencies", () => {
    const plan = buildCascadePlan(source, {
      configuredSpokes: ["facebook", "threads"],
    });

    expect(plan.sequence.map((step) => step.platform)).toEqual([
      "linkedin",
      "x",
      "facebook",
      "threads",
    ]);
    expect(plan.sequence[0].dependsOn).toEqual([]);

    for (const step of plan.sequence.slice(1)) {
      expect(step.dependsOn).toEqual(["step-1-linkedin"]);
    }

    expect(plan.dependencies.join("\n")).toContain(
      "LinkedIn must be posted before any spoke",
    );
  });

  test("represents one screenshot reused by LinkedIn and all spokes", () => {
    const plan = buildCascadePlan(source, {
      configuredSpokes: ["threads", "x", "linkedin", "substack"],
    });

    expect(resolveSpokes(["threads", "x", "linkedin", "substack"])).toEqual([
      "x",
      "threads",
    ]);
    expect(plan.screenshot.id).toBe("substack-source-screenshot");
    expect(plan.screenshot.sourceUrl).toBe(source.url);
    expect(plan.screenshot.reusedBy).toEqual(["linkedin", "x", "threads"]);
    expect(new Set(plan.sequence.map((step) => step.screenshotRef))).toEqual(
      new Set(["substack-source-screenshot"]),
    );
    expect(plan.sequence.every((step) => step.visualReviewRequired)).toBe(true);
  });

  test("renders a plain-text paste-safe plan without pipe characters", () => {
    const plan = buildCascadePlan(
      {
        ...source,
        title: "No tables | no body links",
        excerpt: "This excerpt has a pipe | and a URL https://example.com/path.",
      },
      {
        configuredSpokes: ["threads"],
        linkedInPostUrl: "https://www.linkedin.com/posts/example-activity-123",
      },
    );

    const rendered = renderCascadePlan(plan);

    expect(rendered).not.toContain("|");
    expect(rendered).toContain("Mode: DRAFT_ONLY");
    expect(rendered).toContain(`${source.url}`);
    expect(rendered).toContain(
      "linkedin.comment -> https://example.substack.com/p/the-operating-system-underneath-ai",
    );
    expect(rendered).toContain(
      "x -> https://www.linkedin.com/posts/example-activity-123",
    );
    expect(rendered).toContain(
      "threads -> https://www.linkedin.com/posts/example-activity-123",
    );
    expect(rendered).toContain("Body link allowed: no");
    expect(rendered).toContain("Body link allowed: yes");
    expect(rendered).toContain("VISUAL REVIEW REQUIRED before posting");
  });

  test("keeps the planner draft-only with no transport fields", () => {
    const plan = buildCascadePlan(source);
    const serialized = JSON.stringify(plan).toLowerCase();

    expect(plan.mode).toBe("DRAFT_ONLY");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("webhook");
    expect(serialized).not.toContain("transport");
  });
});
