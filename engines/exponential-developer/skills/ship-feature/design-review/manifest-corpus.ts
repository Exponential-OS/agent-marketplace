/**
 * Adversarial corpus for Gate-A.7 (XOS-415). Preserve reported strings verbatim.
 * Attempt 1 passed tests and mutants but falsely blocked editorial prose; attempt 2
 * fit BENIGN 22/22 and CODE 9/9 yet again failed cross-family review in both directions.
 * The finding is that prose detectors are the wrong design, not that they need tuning.
 * These cases now test the explicit-claim contract: BENIGN skips only when marked;
 * every unmarked case requires review; marked CODE still requires review wherever an
 * existing guard applies. A claim is necessary, never sufficient, and is not diff proof.
 */

/** Manifests that MUST skip WHEN MARKED and require review when unmarked. Real editorial English, deliberately including every shape
 *  that broke the first implementation. */
export const BENIGN_MANIFESTS: ReadonlyArray<readonly [string, string]> = [
  // ── The six the cross-family panel found. Permanent fixtures, verbatim. ──
  ["judge/type_annotation", "~ modified  README.md — add a note: Windows paths"],
  ["judge/function_signature", "~ modified  README.md — fix typo(s) in the install section"],
  ["judge/import_export", "~ modified  README.md — correct a typo in the PDF export instructions"],
  ["judge/csv_export", "~ modified  docs/guide.md — document the CSV export flow"],
  ["judge/data_import", "~ modified  docs/guide.md — clarify the data import steps"],
  ["judge/section_plural", "~ modified  README.md — see Section(s) 3 and 4"],

  // ── Ordinary docs work. If any of these blocks, the gate is a tax. ──
  ["plain/typo", "~ modified  README.md — fix a typo in the install section"],
  ["plain/wording", "~ modified  README.md — clarify the wording in the Gate-A.7 section"],
  ["plain/changelog", "~ modified  CHANGELOG.md — note the 1.5.0 release"],
  ["plain/lockfile", "~ modified  bun.lockb — dependency bump"],
  ["plain/heading", "~ modified  docs/setup.md — split the Prerequisites heading in two"],
  ["plain/link", "~ modified  README.md — the install link pointed at the old repo"],
  ["plain/screenshot", "~ modified  docs/guide.md — replace the outdated screenshot"],

  // ── Prose that legitimately contains code-adjacent English. The hard cases. ──
  ["prose/export_verb", "~ modified  docs/guide.md — explain how users export their data"],
  ["prose/import_verb", "~ modified  docs/guide.md — the import wizard needs a note about CSV"],
  ["prose/colon_list", "~ modified  README.md — add a section: Troubleshooting"],
  ["prose/colon_proper", "~ modified  docs/faq.md — answer: Yes, Windows is supported"],
  ["prose/parens_plural", "~ modified  README.md — mention the flag(s) users most often need"],
  ["prose/parens_aside", "~ modified  docs/guide.md — note (briefly) why the default changed"],
  ["prose/version", "~ modified  CHANGELOG.md — 1.5.0 adds the fallback order"],
  ["prose/source_file_named", "~ modified  SKILL.md — document the run.ts fallback order"],
  ["prose/acronym", "~ modified  docs/api.md — spell out what API means on first use"],
];

/** Manifests that MUST be reviewed when unmarked (and when marked if another guard applies). Real code work, including the exact shape that was
 *  waved through and started this ticket. */
export const CODE_MANIFESTS: ReadonlyArray<readonly [string, string]> = [
  // ── The reported case, verbatim. The gate skipped this and declined to review a
  //    rewrite of its own reviewer control flow. ──
  [
    "reporter/symbols_only_md",
    `+ added     resolveReviewerCandidates(env): string[] — returns the fallback chain
~ changed   callPrimaryReviewer — loops candidates instead of taking a single model
~ modified  SKILL.md — document the fallback order`,
  ],

  // ── A code path named outright. The easy case; must stay caught. ──
  ["path/explicit_ts", "~ modified  skills/ship-feature/design-review/run.ts — rewrite the budget"],
  ["path/explicit_py", "~ modified  hooks/scripts/audit-people-schema.py — add a field"],
  ["path/explicit_sh", "~ modified  install.sh — resolve the plugin root before copying"],

  // ── Symbols described in prose, only docs paths listed. The dangerous window. ──
  ["symbol/signature_return", "~ modified  SKILL.md — document parseStructuredVerdict(stdout): Verdict | null"],
  ["symbol/camel_call", "~ modified  SKILL.md — describe how sanitizedEnv(env) strips credentials"],
  ["symbol/snake_call", "~ modified  README.md — explain what git_sync_push(root, branch) does"],
  ["symbol/exported_fn", "~ modified  SKILL.md — note the newly exported function resolveTotalBudgetMs"],
  ["symbol/typed_field", "~ modified  SKILL.md — the record gains elapsed_ms: number | null"],
];

/** Historical accepted false negatives, retained verbatim. They now require review
 *  when unmarked. A false affirmative claim can still skip when no other guard applies;
 *  the design makes that assertion visible, rather than pretending to understand prose. */
export const ACCEPTED_FALSE_NEGATIVES: ReadonlyArray<readonly [string, string]> = [
  ["fn/pure_prose", "~ modified  SKILL.md — explain the new ordering\n+ added     a step before the build runs"],
];

/** Wrap a manifest body in the fenced block the extractor expects. */
export function asManifest(body: string): string {
  return `## Change manifest\n\n\`\`\`\n${body}\n\`\`\`\n`;
}

/**
 * XOS-415's OWN spec manifest, verbatim, as a FIXTURE rather than a file read.
 * The test previously read it from `../../../../../../docs/plans/` -- correct in the
 * source repo and broken the moment the plugin is vendored, where up-six escapes the
 * marketplace entirely (`ENOENT ... /Users/.../aiprojects/docs/plans/...`). Found by
 * running the vendored suite, not the source suite: 55 pass / 1 fail where source was 56/0.
 * A plugin that ships to customers must carry its own fixtures -- a test that reaches
 * outside the plugin root is testing the repo, not the plugin.
 * This section documents the marker and must NOT read as claiming it.
 */
export const OWN_SPEC_MANIFEST = `## Change manifest

\`\`\`
~ modified  plugins/cross/exponential-developer/skills/ship-feature/design-review/run.ts
            - DELETE codeWorkSignals() and all three detector regexes (~40 lines)
            - shouldSkip gains a required explicit marker; absent -> { skip:false,
              blockedBy:"no_mechanical_claim" }
            - the four existing guards stay and still run AFTER the marker is found, so a
              marked change that is large / declares public surface / lists a non-mechanical
              path is STILL reviewed. The marker is necessary, never sufficient.
~ modified  .../design-review/manifest-corpus.ts
            - repurposed: BENIGN cases must skip WHEN MARKED; CODE cases must be reviewed
              WHEN UNMARKED; and the new property — CODE cases must STILL be reviewed even
              when marked, wherever another guard applies
~ modified  .../design-review/run.test.ts
~ modified  .../ship-feature/SKILL.md          document the marker and when to use it
~ modified  plugins/cross/exponential-developer/CHANGELOG.md
~ modified  .../.claude-plugin/plugin.json     1.5.0 -> 1.6.0
~ modified  .github/workflows/test.yml         FLOOR resynced
- removed   the detector approach entirely
@ migrated  specs written before this change carry no marker, so they now get REVIEWED
            rather than skipped. That is the correct direction for a fail-closed gate and
            needs no migration — nothing silently changes verdict from blocking to passing.
\`\`\`

new-public-surface: true
behavior-change: true`;
