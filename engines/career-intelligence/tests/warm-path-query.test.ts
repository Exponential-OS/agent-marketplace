import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  findWarmPathsToCompany,
  loadWarmPathGraph,
  type WarmPathEvent,
} from "../src/network/warm-path-graph";
import { warmPathsToCompany } from "../src/network/warm-path-query";

const NOW = new Date("2026-06-27T00:00:00Z");
const roots: string[] = [];

function makePeopleDir(): string {
  const root = mkdtempSync(join(tmpdir(), "warm-path-test-"));
  roots.push(root);
  const peopleDir = join(root, "network", "people");
  mkdirSync(peopleDir, { recursive: true });
  return peopleDir;
}

function writePerson(peopleDir: string, slug: string, record: Record<string, unknown>): void {
  writeFileSync(join(peopleDir, `${slug}.json`), JSON.stringify(record, null, 2));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("warm path query", () => {
  test("happy: self to Alice to Bob at TargetCo returns exactly one depth-2 path", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OriginCo"],
      role: "Engineering Manager",
      relationship: "former colleague",
      warmth: "warm professional",
      last_contact: "2026-06-01",
      they_told_us: {
        hiring: "Bob Target is leading infra hiring at TargetCo.",
      },
    });
    writePerson(peopleDir, "bob", {
      name: "Bob Target",
      companies: ["TargetCo"],
      role: "VP Engineering",
    });

    const result = warmPathsToCompany("TargetCo", { peopleDir, now: NOW });
    const depth2 = result.paths.filter((path) => path.path_length === 2);

    expect(depth2).toHaveLength(1);
    expect(depth2[0].intermediary).toEqual({ id: "person:alice", name: "Alice Example" });
    expect(depth2[0].target_person).toMatchObject({
      id: "person:bob",
      name: "Bob Target",
      role: "VP Engineering",
      company: "TargetCo",
    });
    expect(depth2[0].warmth_score).toBeGreaterThan(0);
    expect(depth2[0].evidence.length).toBeGreaterThan(0);
    expect(depth2[0].evidence).toContain("they_told_us mentions Bob Target");
  });

  test("boundary: no path returns an empty paths array", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OtherCo"],
      role: "Engineering Manager",
    });

    const result = warmPathsToCompany("TargetCo", { peopleDir, now: NOW });

    expect(result.paths).toEqual([]);
  });

  test("boundary: depth-1-only path has null intermediary and company variant matches", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "taylor", {
      name: "Taylor Target",
      companies: ["TargetCo (current - VP)"],
      role: "VP Product",
      warmth: "strong",
    });

    const result = warmPathsToCompany("TargetCo", { peopleDir, now: NOW });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].path_length).toBe(1);
    expect(result.paths[0].intermediary).toBeNull();
    expect(result.paths[0].target_person).toMatchObject({
      id: "person:taylor",
      name: "Taylor Target",
      company: "TargetCo",
    });
  });

  test("environmental: malformed JSON is skipped and missing optional fields stay neutral", () => {
    const peopleDir = makePeopleDir();
    writeFileSync(join(peopleDir, "broken.json"), "{not valid json");
    writePerson(peopleDir, "no-company", {
      name: "No Company",
      role: "Advisor",
      unknown_field: { ignored: true },
    });
    writePerson(peopleDir, "casey", {
      name: "Casey Target",
      companies: ["TargetCo"],
      role: "Director",
      extra_unmodeled_field: ["ignored"],
    });

    const events: WarmPathEvent[] = [];
    const graph = loadWarmPathGraph(peopleDir, { eventSink: (event) => events.push(event), now: NOW });
    const noCompany = graph.nodes.get("person:no-company");
    const noCompanyEdges = graph.edges.filter(
      (edge) => edge.from === "person:no-company" && edge.type === "company_affiliation",
    );
    const result = findWarmPathsToCompany(graph, "TargetCo");
    const direct = result.paths.find((path) => path.target_person.id === "person:casey");

    expect(events.some((event) => event.type === "people_file_skipped" && String(event.reason).startsWith("invalid_json"))).toBe(true);
    expect(noCompany?.company).toBeNull();
    expect(noCompanyEdges).toHaveLength(0);
    expect(direct?.warmth_score).toBe(3);
    expect(direct?.strength_label).toBe("moderate");
  });

  test("inferred shared-company links are classified as ask candidate evidence", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["PastCo"],
      role: "Engineering Manager",
      warmth: "warm professional",
    });
    writePerson(peopleDir, "bob", {
      name: "Bob Target",
      companies: ["TargetCo", "PastCo"],
      role: "Staff Engineer",
    });

    const result = warmPathsToCompany("TargetCo", { peopleDir, now: NOW });
    const depth2 = result.paths.find((path) => path.path_length === 2);

    expect(depth2?.intermediary).toEqual({ id: "person:alice", name: "Alice Example" });
    expect(depth2?.evidence.some((item) => item.startsWith("ask candidate: shared company: PastCo"))).toBe(true);
    expect(depth2?.strength_label).toBe("weak");
  });

  test("inferred shared-cohort links are classified as ask candidate, not confirmed", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OriginCo"],
      role: "Engineering Manager",
      cohort: "Texas Guaranteed 2009",
    });
    writePerson(peopleDir, "bob", {
      name: "Bob Target",
      companies: ["TargetCo"],
      role: "Staff Engineer",
      cohort: "Texas Guaranteed 2009",
    });

    const graph = loadWarmPathGraph(peopleDir, { now: NOW });
    const edge = graph.edges.find(
      (item) => item.from === "person:alice" && item.to === "person:bob" && item.type === "person_person",
    );
    const result = findWarmPathsToCompany(graph, "TargetCo");
    const depth2 = result.paths.find((path) => path.path_length === 2);

    expect(edge?.relationship_kind).toBe("ask_candidate");
    expect(edge?.strength_label).toBe("weak");
    expect(edge?.evidence).toContain("ask candidate: shared cohort: texas guaranteed 2009");
    expect(edge?.evidence).not.toContain("shared cohort: texas guaranteed 2009");
    expect(depth2?.strength_label).toBe("weak");
  });

  test("former target-company employees are excluded from current live paths", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OriginCo"],
      role: "Engineering Manager",
      they_told_us: "Morgan Former used to work at TargetCo.",
    });
    writePerson(peopleDir, "morgan", {
      name: "Morgan Former",
      companies: ["CurrentCo", "TargetCo (prior - Staff Engineer)"],
      role: "Staff Engineer",
    });

    const result = warmPathsToCompany("TargetCo", { peopleDir, now: NOW });

    expect(result.paths).toEqual([]);
  });

  test("object-shaped cohort is extracted and relationship_strength scores direct edges", () => {
    const peopleDir = makePeopleDir();
    writePerson(peopleDir, "alice", {
      name: "Alice Example",
      companies: ["OriginCo"],
      role: "Engineering Manager",
      relationship_strength: {
        score: 5,
        label: "Inner Circle",
      },
      cohort: {
        name: "texas-guaranteed-2009",
        members: ["alice", "bob"],
        origin_company: "Texas Guaranteed",
        period: "2009-2010",
      },
    });
    writePerson(peopleDir, "bob", {
      name: "Bob Target",
      companies: ["TargetCo"],
      role: "Staff Engineer",
      cohort: {
        name: "texas-guaranteed-2009",
        origin_company: "Texas Guaranteed",
        period: "2009-2010",
      },
    });

    const graph = loadWarmPathGraph(peopleDir, { now: NOW });
    const direct = graph.edges.find(
      (item) => item.from === "self" && item.to === "person:alice" && item.type === "self_person",
    );
    const cohortEdge = graph.edges.find(
      (item) => item.from === "person:alice" && item.to === "person:bob" && item.type === "person_person",
    );
    const result = findWarmPathsToCompany(graph, "TargetCo");
    const depth2 = result.paths.find((path) => path.path_length === 2);

    expect(direct?.weight).toBe(5);
    expect(direct?.strength_label).toBe("very_strong");
    expect(direct?.evidence).toContain("relationship strength: 5");
    expect(cohortEdge?.relationship_kind).toBe("ask_candidate");
    expect(cohortEdge?.evidence).toContain("ask candidate: shared cohort: texas-guaranteed-2009");
    expect(depth2?.warmth_score).toBe(2);
    expect(depth2?.strength_label).toBe("weak");
  });
});
