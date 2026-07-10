rubric-version: 1

# Gate-A.7 Design-Reasoning Review Lenses

Review only the provided spec and Change Manifest. Do not use prior conversation,
unstated intent, or implementation details that are not in the inputs.

## 1. right-problem

Checks whether the plan solves the user's actual problem and preserves the stated
outcome instead of optimizing an adjacent concern.

Failure class: RED by definition.

## 2. missing-requirements

Checks for missing edge cases, unstated constraints, incomplete migration paths,
or acceptance criteria that are necessary to make the feature complete.

Failure class: YELLOW unless the gap makes the outcome impossible or unverifiable.

## 3. theater

Checks whether the proposal creates visible work without changing the behavior
that must change. A cosmetic, logging-only, or paper-only solution to a behavior
requirement is theater.

Failure class: RED by definition.

## 4. simplicity

Checks whether the design is overbuilt, underbuilt, too coupled, or missing a
smaller direct path that would satisfy the same acceptance criteria.

Failure class: YELLOW unless complexity prevents delivery of the stated outcome.

## 5. reinvention

Checks whether the plan unnecessarily recreates existing local patterns,
libraries, rules, or platform primitives that should be reused.

Failure class: YELLOW unless reinvention creates a fatal correctness or safety
gap.

## 6. forward-failure

Checks whether rollout, rollback, migration, activation, or downstream failure
modes are accounted for before implementation starts.

Failure class: YELLOW unless the omission makes the feature unsafe or impossible
to recover.

## 7. verifiability

Checks whether the acceptance criteria and test plan can actually prove the
feature works. A vague, subjective, or non-observable DoD is not buildable.

Failure class: RED by definition.

## Verdict Semantics

GREEN means no lens finds a required change.

YELLOW means bounded lens-2/4/5/6 findings that do not hit the RED bar. Each
finding must include a concrete fix. Class-A fixes may be additive or clarifying
only; Class-B fixes change scope, requirements, behavior, or DoD and must remain
for human review.

RED means a right-problem, theater, or verifiability failure, or any other design
failure severe enough that Stage 4 must not start.

For scoped RED re-review, judge only whether the prior RED findings were
addressed. A new finding keeps RED only if it meets the RED bar. Never downgrade
a still-valid RED finding to YELLOW.

## JSON Output Contract

Emit exactly one JSON object and no prose:

```json
{"verdict":"GREEN|YELLOW|RED","findings":[{"severity":"...","lens":"...","fix":"..."}]}
```

Rules:

- `verdict` must be one of `GREEN`, `YELLOW`, or `RED`.
- `findings` must be an array.
- For GREEN, `findings` must be empty.
- For YELLOW or RED, every finding must include `severity`, `lens`, and `fix`.
- Use the lens slug exactly as written above.
