#!/usr/bin/env bun
// handler.ts - local-only interview-prep autosurface event helper.
// JSON argv/stdin in, JSON stdout out. Appends brain/sessions/events.jsonl only
// when XOS_98_TELEMETRY is set.

import {
  surfaceInterviewPrepOnStatusChange,
  type InterviewPrepAutosurfaceInput,
  type InterviewPrepAutosurfaceResult,
} from "../../src/interview-prep/autosurface";

interface HandlerInput extends InterviewPrepAutosurfaceInput {
  career_home?: string;
}

interface ErrorOutput {
  action: "error";
  error: string;
  event_emitted: false;
}

function emit(output: InterviewPrepAutosurfaceResult | ErrorOutput, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ action: "error", error: "JSON input is required", event_emitted: false }, 1);
  }

  let ctx: HandlerInput;
  try {
    ctx = JSON.parse(raw) as HandlerInput;
  } catch (e: unknown) {
    emit({
      action: "error",
      error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      event_emitted: false,
    }, 1);
  }

  try {
    emit(
      surfaceInterviewPrepOnStatusChange(ctx!, {
        careerHome: ctx!.career_home,
      }),
      0,
    );
  } catch (e: unknown) {
    emit({
      action: "error",
      error: e instanceof Error ? e.message : String(e),
      event_emitted: false,
    }, 1);
  }
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      action: "error",
      error: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
      event_emitted: false,
    }) + "\n",
  );
  process.exit(1);
});
