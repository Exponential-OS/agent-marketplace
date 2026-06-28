import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  scoreIntroStrength,
  surfaceIntroOpportunitiesForTrackedRole,
  type IntroOpportunitySurfacedEvent,
} from "../src/network/surface-intros";
import type { StrengthLabel, WarmPath, WarmPathEvent } from "../src/network/warm-path-graph";

const roots: string[] = [];

function makePeopleDir(): string {
  const root = mkdtempSync(join(tmpdir(), "surface-intros-test-"));
  roots.push(root);
  const peopleDir = join(root, "network", "people");
  mkdirSync(peopleDir, { recursive: true });
  return peopleDir;
}

function writePerson(peopleDir: string, slug: string, record: Record<string, unknown>): void {
  writeFileSync(join(peopleDir, `${slug}.json`), JSON.stringify(record, null, 2));
}

function warmPathFixture(strength_label: StrengthLabel, index = 0): WarmPath {
  const id = `person:${strength_label}-${index}`;
  const name = `Target ${index}`;
  return {
    path_nodes: [
      { id: "self", name: "Self", company: null, role: null },
      { id, name, company: "TargetCo", role: null },
    ],
    path_length: 1,
    intermediary: null,
    target_person: { id, name, role: null, company: "TargetCo" },
    evidence: [],
    warmth_score: 0,
    strength_label,
    stale: false,
    last_contact: null,
  };
}

function askCandidateWarmPathFixture(strength_label: StrengthLabel, index = 0): WarmPath {
  return {
    ...warmPathFixture(strength_label, index),
    evidence: [`ask candidate: shared company: PastCo ${index}`],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scoreIntroStrength", () => {
  test("1 strong path scores 80 with a singular Strong badge", () => {
    expect(scoreIntroStrength([warmPathFixture("strong")])).toEqual({
      path_count: 1,
      confirmed_count: 1,
      ask_candidate_count: 0,
      score: 80,
      strength_label: "strong",
      badge: "1 warm intro · Strong",
    });
  });

  test("5 paths with best very_strong cap at 100 with a plural Very Strong badge", () => {
    expect(
      scoreIntroStrength([
        warmPathFixture("very_strong", 0),
        warmPathFixture("strong", 1),
        warmPathFixture("moderate", 2),
        warmPathFixture("weak", 3),
        warmPathFixture("weak", 4),
      ]),
    ).toEqual({
      path_count: 5,
      confirmed_count: 5,
      ask_candidate_count: 0,
      score: 100,
      strength_label: "very_strong",
      badge: "5 warm intros · Very Strong",
    });
  });

  test("0 paths returns Cold", () => {
    expect(scoreIntroStrength([])).toEqual({
      path_count: 0,
      confirmed_count: 0,
      ask_candidate_count: 0,
      score: 0,
      strength_label: "cold",
      badge: "Cold",
    });
  });

  test("very_strong plus weak caps at 100", () => {
    expect(scoreIntroStrength([warmPathFixture("very_strong"), warmPathFixture("weak", 1)])).toEqual({
      path_count: 2,
      confirmed_count: 2,
      ask_candidate_count: 0,
      score: 100,
      strength_label: "very_strong",
      badge: "2 warm intros · Very Strong",
    });
  });

  test("moderate plus weak scores 60 with a Moderate badge", () => {
    expect(scoreIntroStrength([warmPathFixture("moderate"), warmPathFixture("weak", 1)])).toEqual({
      path_count: 2,
      confirmed_count: 2,
      ask_candidate_count: 0,
      score: 60,
      strength_label: "moderate",
      badge: "2 warm intros · Moderate",
    });
  });

  test("confirmed-only paths keep scoring and badge counts on confirmed paths", () => {
    expect(scoreIntroStrength([warmPathFixture("strong"), warmPathFixture("moderate", 1)])).toEqual({
      path_count: 2,
      confirmed_count: 2,
      ask_candidate_count: 0,
      score: 85,
      strength_label: "strong",
      badge: "2 warm intros · Strong",
    });
  });

  test("ask-candidate-only paths do not produce warm intro strength", () => {
    expect(
      scoreIntroStrength([
        askCandidateWarmPathFixture("very_strong", 0),
        askCandidateWarmPathFixture("strong", 1),
      ]),
    ).toEqual({
      path_count: 2,
      confirmed_count: 0,
      ask_candidate_count: 2,
      score: 0,
      strength_label: "cold",
      badge: "2 ask-candidates",
    });
  });

  test("mixed paths score from confirmed paths and surface ask-candidates separately", () => {
    expect(
      scoreIntroStrength([
        warmPathFixture("strong", 0),
        askCandidateWarmPathFixture("very_strong", 1),
        askCandidateWarmPathFixture("strong", 2),
        askCandidateWarmPathFixture("moderate", 3),
        askCandidateWarmPathFixture("weak", 4),
      ]),
    ).toEqual({
      path_count: 5,
      confirmed_count: 1,
      ask_candidate_count: 4,
      score: 80,
      strength_label: "strong",
      badge: "1 warm intro · Strong · +4 ask-candidates",
    });
  });
});

describe("surface intro opportunities", () => {
  test("happy: tracked company with a depth-2 warm path surfaces a tracker display string", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OriginCo"],
      role: "Engineering Manager",
      warmth: "strong",
      they_told_us: "Bob Target is leading infra hiring at TargetCo.",
    });
    writePerson(peopleDir, "bob", {
      name: "Bob Target",
      companies: ["TargetCo"],
      role: "VP Engineering",
      relationship: "cold",
    });

    const events: WarmPathEvent[] = [];
    const record = surfaceIntroOpportunitiesForTrackedRole(
      { tracker_id: "123", company: "TargetCo", role: "VP Engineering" },
      { peopleDir, eventSink: (event) => events.push(event) },
    );
    const surfaced = events.find((event) => event.type === "intro_opportunity_surfaced") as
      | IntroOpportunitySurfacedEvent
      | undefined;
    const topPath = record.paths[0];
    if (!topPath) throw new Error("expected at least one surfaced intro path");

    expect(record.target_company).toBe("TargetCo");
    expect(record.role).toBe("VP Engineering");
    expect(record.tracker_id).toBe("123");
    expect(record.path_count).toBeGreaterThanOrEqual(1);
    expect(topPath.intermediary).toEqual({ id: "person:alice", name: "Alice Example" });
    expect(topPath.strength_label).toBe("strong");
    expect(record.warm_path_display).not.toBe("Cold");
    expect(record.warm_path_display.split("\n")[0]).toBe(
      `${record.path_count} warm ${record.path_count === 1 ? "intro" : "intros"} · Strong`,
    );
    expect(record.warm_path_display).toContain("via Alice Example (strong)");
    expect(surfaced).toMatchObject({
      type: "intro_opportunity_surfaced",
      target_company: "TargetCo",
      role: "VP Engineering",
      tracker_id: "123",
      path_count: record.path_count,
      top_strength_label: "strong",
      surfaced_in: "pipeline-view",
      sink: "local",
    });
  });

  test("boundary: no path returns Cold and emits no local surfaced event", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OtherCo"],
      role: "Engineering Manager",
    });

    const events: WarmPathEvent[] = [];
    const record = surfaceIntroOpportunitiesForTrackedRole(
      { company: "TargetCo", role: "Staff Engineer" },
      { peopleDir, eventSink: (event) => events.push(event) },
    );

    expect(record.path_count).toBe(0);
    expect(record.paths).toEqual([]);
    expect(record.warm_path_display).toBe("Cold");
    expect(events.some((event) => event.type === "intro_opportunity_surfaced")).toBe(false);
  });

  test("integration: ask_candidate-only path is flagged and topN is respected", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["PastCo"],
      role: "Engineering Manager",
      warmth: "strong",
    });
    writePerson(peopleDir, "bob", {
      name: "Bob Target",
      companies: ["TargetCo", "PastCo"],
      role: "Staff Engineer",
      relationship: "cold",
    });
    writePerson(peopleDir, "casey", {
      name: "Casey Connector",
      companies: ["SchoolCo"],
      role: "Director Engineering",
      warmth: "strong",
    });
    writePerson(peopleDir, "brooke", {
      name: "Brooke Target",
      companies: ["TargetCo", "SchoolCo"],
      role: "Product Lead",
      relationship: "cold",
    });

    const record = surfaceIntroOpportunitiesForTrackedRole(
      { company: "TargetCo" },
      { peopleDir, topN: 1 },
    );

    expect(record.paths).toHaveLength(1);
    expect(record.path_count).toBe(1);
    const topPath = record.paths[0];
    if (!topPath) throw new Error("expected one surfaced intro path");
    expect(topPath.ask_candidate).toBe(true);
    expect(topPath.evidence.some((item) => item.startsWith("ask candidate:"))).toBe(true);
    expect(record.warm_path_display.split("\n")[0]).toBe("1 ask-candidate");
    expect(record.warm_path_display.split("\n")[0]).not.toContain("warm intro");
    expect(record.warm_path_display.split("\n")[0]).not.toContain("Weak");
    expect(record.warm_path_display).toContain("(ask candidate)");
  });

  test("integration: mixed confirmed and ask-candidate badge counts confirmed intros only", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "direct-target", {
      name: "Direct Target",
      companies: ["TargetCo"],
      role: "VP Engineering",
      warmth: "strong",
    });

    for (let i = 0; i < 4; i += 1) {
      writePerson(peopleDir, `connector-${i}`, {
        name: `Connector ${i}`,
        companies: [`PastCo ${i}`],
        role: "Engineering Manager",
        warmth: "strong",
      });
      writePerson(peopleDir, `ask-target-${i}`, {
        name: `Ask Target ${i}`,
        companies: ["TargetCo", `PastCo ${i}`],
        role: "Staff Engineer",
        relationship: "cold",
      });
    }

    const record = surfaceIntroOpportunitiesForTrackedRole(
      { company: "TargetCo" },
      { peopleDir, topN: 5 },
    );

    expect(record.paths).toHaveLength(5);
    expect(record.path_count).toBe(5);
    expect(record.paths.filter((path) => path.ask_candidate)).toHaveLength(4);
    expect(record.warm_path_display.split("\n")[0]).toBe(
      "1 warm intro · Strong · +4 ask-candidates",
    );
    expect(record.warm_path_display.split("\n")[0]).not.toContain("5 warm intros");
    expect(record.warm_path_display.split("\n")[0]).not.toContain("Very Strong");
  });
});
