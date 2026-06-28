import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  INTERVIEW_PREP_SURFACED_EVENT,
  interviewPrepRelativePath,
  surfaceInterviewPrepOnStatusChange,
} from "../src/interview-prep/autosurface";

const NOW = new Date("2026-06-28T12:00:00Z");
const roots: string[] = [];

function makeCareerHome(): string {
  const root = mkdtempSync(join(tmpdir(), "interview-prep-autosurface-"));
  roots.push(root);
  return root;
}

function baseInput() {
  return {
    company: "Acme AI",
    role: "Engineering Manager",
    tracker_id: 105,
    status_updated_at: "2026-06-28",
    status: "INTERVIEWING",
    stage: "panel_interview",
    interviewers: ["Ada Lovelace", "Grace Hopper"],
    date: "2026-07-01",
    jd_path: "brain/reference/jd-samples/acme-ai.pdf",
  };
}

function readEvents(careerHome: string): unknown[] {
  const path = join(careerHome, "brain", "sessions", "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function writeSurfacedEvent(careerHome: string): void {
  const path = join(careerHome, "brain", "sessions", "events.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      event: INTERVIEW_PREP_SURFACED_EVENT,
      trigger: "status_change",
      company: "Acme AI",
      role: "Engineering Manager",
      tracker_id: "105",
      status_updated_at: "2026-06-28",
      prep_doc_path: "career-intelligence/projects/interview-prep/prep-Acme AI.md",
      dedupe_key: "105:Acme AI:Engineering Manager:2026-06-28",
      ts: "2026-06-28T12:00:00Z",
    }) + "\n",
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("interview-prep autosurface", () => {
  test("first status-change surface emits the gated local event with canonical shape", () => {
    const careerHome = makeCareerHome();
    const result = surfaceInterviewPrepOnStatusChange(baseInput(), {
      careerHome,
      env: { XOS_98_TELEMETRY: "1" },
      now: NOW,
    });

    expect(result.action).toBe("invoke_interview_prep");
    expect(result.event_emitted).toBe(true);
    expect(result.prep_doc_path).toBe("career-intelligence/projects/interview-prep/prep-Acme AI.md");
    expect(result.dedupe_key).toBe("105:Acme AI:Engineering Manager:2026-06-28");
    expect(result.confirmation).toBe(
      "Interview prep surfaced: career-intelligence/projects/interview-prep/prep-Acme AI.md",
    );
    expect(result.invocation).toEqual({
      skill: "interview-prep",
      payload: {
        company: "Acme AI",
        role: "Engineering Manager",
        stage: "panel_interview",
        interviewers: ["Ada Lovelace", "Grace Hopper"],
        date: "2026-07-01",
        jd_path: "brain/reference/jd-samples/acme-ai.pdf",
      },
    });
    expect(readEvents(careerHome)).toEqual([
      {
        event: "interview_prep_surfaced",
        trigger: "status_change",
        company: "Acme AI",
        role: "Engineering Manager",
        tracker_id: "105",
        status_updated_at: "2026-06-28",
        prep_doc_path: "career-intelligence/projects/interview-prep/prep-Acme AI.md",
        dedupe_key: "105:Acme AI:Engineering Manager:2026-06-28",
        ts: "2026-06-28T12:00:00Z",
      },
    ]);
  });

  test("telemetry defaults off while still returning the interview-prep invocation", () => {
    const careerHome = makeCareerHome();
    const result = surfaceInterviewPrepOnStatusChange(baseInput(), {
      careerHome,
      env: {},
      now: NOW,
    });

    expect(result.action).toBe("invoke_interview_prep");
    expect(result.event_emitted).toBe(false);
    expect(readEvents(careerHome)).toEqual([]);
  });

  test("explicit interview transition invokes exactly once before dedupe skips repeat", () => {
    const careerHome = makeCareerHome();
    const opts = { careerHome, env: { XOS_98_TELEMETRY: "1" }, now: NOW };

    const first = surfaceInterviewPrepOnStatusChange(baseInput(), opts);
    const second = surfaceInterviewPrepOnStatusChange(baseInput(), opts);

    expect(first.action).toBe("invoke_interview_prep");
    expect(first.invocation).toBeDefined();
    expect(first.event_emitted).toBe(true);
    expect(second).toMatchObject({
      action: "skip",
      reason: "already_surfaced",
      event_emitted: false,
    });
    expect(second.invocation).toBeUndefined();
    expect(second.event_emitted).toBe(false);
    expect(readEvents(careerHome)).toHaveLength(1);
  });

  test("already-surfaced dedupe skips even when the prep doc is absent", () => {
    const careerHome = makeCareerHome();
    writeSurfacedEvent(careerHome);

    const result = surfaceInterviewPrepOnStatusChange(baseInput(), {
      careerHome,
      env: { XOS_98_TELEMETRY: "1" },
      now: NOW,
    });

    expect(existsSync(join(careerHome, interviewPrepRelativePath("Acme AI")))).toBe(false);
    expect(result).toMatchObject({
      action: "skip",
      reason: "already_surfaced",
      event_emitted: false,
    });
    expect(result.invocation).toBeUndefined();
    expect(result.confirmation).toBeUndefined();
    expect(readEvents(careerHome)).toHaveLength(1);
  });

  test("missing status and stage do not assume an interview transition", () => {
    const careerHome = makeCareerHome();
    const result = surfaceInterviewPrepOnStatusChange({
      company: "Acme AI",
      role: "Engineering Manager",
      tracker_id: 105,
      status_updated_at: "2026-06-28",
    }, {
      careerHome,
      env: { XOS_98_TELEMETRY: "1" },
      now: NOW,
    });

    expect(result).toMatchObject({
      action: "skip",
      reason: "not_interview_transition",
      event_emitted: false,
    });
    expect(result.invocation).toBeUndefined();
    expect(result.confirmation).toBeUndefined();
    expect(readEvents(careerHome)).toEqual([]);
  });

  test("existing canonical prep doc skips silently and writes no event", () => {
    const careerHome = makeCareerHome();
    const prepPath = join(careerHome, interviewPrepRelativePath("Acme AI"));
    mkdirSync(dirname(prepPath), { recursive: true });
    writeFileSync(prepPath, "# Existing prep\n");

    const result = surfaceInterviewPrepOnStatusChange(baseInput(), {
      careerHome,
      env: { XOS_98_TELEMETRY: "1" },
      now: NOW,
    });

    expect(result).toMatchObject({
      action: "skip",
      reason: "prep_doc_exists",
      event_emitted: false,
    });
    expect(result.invocation).toBeUndefined();
    expect(result.confirmation).toBeUndefined();
    expect(readEvents(careerHome)).toEqual([]);
  });
});
