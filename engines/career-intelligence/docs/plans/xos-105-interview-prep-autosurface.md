# Interview-Prep Auto-Surface on Status→Interview
status: design
slug: xos-105-interview-prep-autosurface
ticket: XOS-105
repo: ~/aiprojects/career-intelligence-engine

## What
When an application's status transitions to Interview (apply-tracker `Screen → Interview`, status `INTERVIEWING` + stage `panel_interview`), automatically surface the existing `interview-prep` skill with company context pre-loaded — idempotently — so the user never has to remember to prep.

## Why (NSM)
Higher interview→offer conversion on applications already in the pipeline = more wins per application effort already spent (compounds existing pipeline value).

## Scope
- **In:**
  - **Pre-req — resolve prep-doc path drift:** reconcile to the single canonical path `career-intelligence/projects/interview-prep/prep-{company}.md` (the dominant/actual write path — `interview-prep/SKILL.md:63,102,172`). Fix the two drifted refs: `interview-prep/SKILL.md:68` and `schemas/shared-structures.md` (`brain/interview-prep/prep-{slug}.md`) → the canonical path. The idempotency check depends on one known path.
  - **apply-tracker `Screen → Interview` transition** (`SKILL.md:154-176`, alongside the v0.27 `interviewer-research` invocation): auto-invoke `interview-prep` with `{company, role, stage:"panel_interview", interviewers, date, jd_path}` (reuse the `interviewer-research` payload shape) — **only if** `career-intelligence/projects/interview-prep/prep-{company}.md` does not already exist (idempotent; dedupe key `tracker_id:company:role:status_updated_at`). Surface a one-line confirmation.
  - **Local event:** emit `interview_prep_surfaced` `{event, trigger:"status_change", company, role, tracker_id, status_updated_at, prep_doc_path, dedupe_key, ts}` to `brain/sessions/events.jsonl`, gated behind `XOS_98_TELEMETRY` (default off), **no phone-home** (follow the `appendFileSync`+stdout pattern in `rules/biographical-claim-precheck/handler.ts`). Reserve `trigger:"calendar"`.
- **Out:**
  - **Calendar trigger** — NO calendar integration exists in the repo (only a roadmap note). Scope to `status_change` only; calendar is a follow-on once a calendar/event-ingest skill exists. Mark reserved.
  - Any outbound telemetry (XOS-98-gated).
  - Re-surfacing on every run (idempotency guard prevents it).

## Acceptance criteria
- [ ] prep-doc path is single + canonical across `interview-prep/SKILL.md` + `schemas/shared-structures.md` (no `brain/interview-prep/...` drift remains).
- [ ] On `Screen → Interview`, interview-prep auto-invokes with pre-loaded company context when no prep doc exists; skips silently when it does (idempotent).
- [ ] `interview_prep_surfaced` event appended to local JSONL only when `XOS_98_TELEMETRY` set; never a network call.
- [ ] Existing suite green (`tests/run-all.sh`); `status:"INTERVIEWING"` still valid; no unrelated changes.

## Test plan
- [ ] Status detection: `pipeline-query.py --status INTERVIEWING` returns the row, no crash.
- [ ] Schema: `validate-tracker-json.py` accepts `INTERVIEWING`.
- [ ] First invocation: APPLIED→INTERVIEWING, no prep doc → prep doc created + 1 event.
- [ ] Idempotency: re-run same transition → no second event, no second doc.
- [ ] Event shape: JSONL has all required fields, `trigger="status_change"`.
- [ ] Regression: `tests/run-all.sh` green.

## Rollback
SKILL.md spec additions + a path reconciliation + a guarded local event. No outbound behavior. Revert the branch to undo; auto-surface is inert until a real Screen→Interview transition fires.
