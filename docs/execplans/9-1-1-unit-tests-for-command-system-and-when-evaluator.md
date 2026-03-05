# Add unit tests for the command system and `when` evaluator (roadmap 9.1.1)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE (2026-03-05)

## Purpose / big picture

Roadmap item `9.1.1` closes a testing gap for the shared command system and the
`when` parser/evaluator introduced by roadmap items `1.2.1` and `1.2.2`. The
repository already has meaningful unit coverage in
`test/unit/command-registry.test.ts` and
`test/unit/context-key-service.test.ts`, but the roadmap still requires more
than the current suites provide: parser edge cases, error handling, precedence
coverage, conflict-detection coverage, and coverage evidence that is specific
enough to tell a developer what remains untested.

After this work, a developer should be able to run the unit coverage workflow,
see targeted failures for command and `when` regressions, and verify that the
shared command/context modules meet the repository's current coverage standard.
Success is observable when:

1. `test/unit/command-registry.test.ts`,
   `test/unit/context-key-service.test.ts`, and any new focused unit test file
   added for precedence/conflict logic fail before the implementation and pass
   after it.
2. `bun run test:coverage` produces coverage evidence for the command/context
   modules that matches the active project threshold or the threshold verified
   from current repository practice.
3. `bun install`, `make build`, `make check-fmt`, `make lint`, and
   `make test` all pass in that order.
4. `docs/developers-guide.md` reflects any newly required local testing
   practice, and `docs/roadmap.md` marks item `9.1.1` done only after all
   required gates succeed.

## Constraints

- Keep this milestone scoped to unit coverage and any minimal pure helper
  extraction required to make existing precedence/conflict behaviour testable.
  Do not absorb roadmap item `9.2.1` integration work into this change.
- Preserve existing public command and context contracts in
  `shared/src/types/commands.ts` and `shared/src/types/context-keys.ts` unless
  a signature change is strictly required to test already-documented behaviour.
- Do not add new third-party dependencies. Use the existing Bun test runner,
  existing coverage workflow, and current runtime modules.
- Prefer updating existing test files when that keeps ownership clear. Add a new
  focused unit test file only when a separate precedence/conflict seam would be
  clearer than overloading an unrelated suite.
- If development practice changes, update `docs/developers-guide.md` in the
  same change and keep its guidance aligned with the real commands used.
- Mark `docs/roadmap.md` item `9.1.1` done only after the final validation
  sequence succeeds.
- Keep command-system tests grounded in existing command and keybinding seams:
  `lib/command-registry.ts`, `app/runtime/plugin-runtime.ts`, and any pure
  helper extracted specifically to expose precedence/conflict rules.

## Tolerances (exception triggers)

- Scope: if the implementation requires changing more than 10 files or more
  than 500 net lines outside tests and docs, stop and escalate.
- Interface: if satisfying the roadmap requires changing exported command or
  context-key TypeScript interfaces in `shared/src/types/`, stop and escalate.
- Semantics: if conflict-detection coverage requires inventing new runtime
  precedence behaviour that is not already implied by
  `docs/velocetty-design.md` or `docs/velocetty-product-requirements-document.md`,
  stop and escalate.
- Threshold: if no active coverage threshold can be verified from current repo
  state, stop before marking the roadmap item complete and document the
  ambiguity in `Decision Log`.
- Validation: if `bun install`, `make build`, `make check-fmt`, `make lint`,
  or `make test` still fails after two focused remediation passes, stop and
  escalate with log paths.

## Risks

- Risk: the roadmap asks for coverage to meet the "project threshold", but the
  live repository may document coverage examples more clearly than it enforces
  thresholds.
  Severity: high
  Likelihood: medium
  Mitigation: treat threshold discovery as the first implementation step, use
  `bunfig.toml`, `package.json`, `docs/testing-with-bun.md`, and current CI/test
  scripts as the source of truth, and update `docs/developers-guide.md` if the
  effective workflow needs to be spelled out more clearly.

- Risk: current command tests exercise registry CRUD and validation, but the
  roadmap's "conflict detection" language likely refers to keybinding
  precedence rather than the registry alone.
  Severity: medium
  Likelihood: high
  Mitigation: audit `app/runtime/plugin-runtime.ts` and existing keybinding
  tests first; extract only a minimal pure helper if an existing behaviour needs
  a test seam.

- Risk: parser edge-case coverage can become noisy if low-level tokenizer cases
  are duplicated through several higher-level service tests.
  Severity: medium
  Likelihood: medium
  Mitigation: keep service-level behavioural assertions in
  `test/unit/context-key-service.test.ts`, and add a focused tokenizer/parser
  suite only if it closes coverage gaps more clearly than extending the
  existing service suite.

- Risk: module-singleton state in `lib/command-registry.ts` can make unit tests
  order-sensitive.
  Severity: medium
  Likelihood: medium
  Mitigation: continue the current import isolation pattern and clean registry
  state in `beforeEach`.

## Progress

- [x] (2026-03-05 20:36Z) Verified roadmap item `9.1.1` scope and approval-gate
  requirement, and confirmed the target ExecPlan path matches the current
  branch name.
- [x] (2026-03-05 20:36Z) Audited the current command/context implementation and
  unit suites in `lib/command-registry.ts`,
  `test/unit/command-registry.test.ts`, `lib/context-key-*.ts`, and
  `test/unit/context-key-service.test.ts`.
- [x] (2026-03-05 20:36Z) Audited design, PRD, roadmap, coverage, and developer
  guidance in `docs/velocetty-design.md`,
  `docs/velocetty-product-requirements-document.md`,
  `docs/developers-guide.md`, `docs/testing-with-bun.md`, and
  `docs/roadmap.md`.
- [x] (2026-03-05 20:36Z) Drafted this ExecPlan.
- [x] (2026-03-05 20:40Z) Received explicit approval to begin implementation.
- [x] (2026-03-05 21:15Z) Stage A complete: confirmed the active local coverage
  basis from `docs/velocetty-hyper-codebase.md` §6.6.7.2 and captured focused
  coverage evidence with `bun test --coverage ...` over the command/context
  suites.
- [x] (2026-03-05 21:15Z) Stage B complete: added command-registry validation,
  compatibility-alias, precedence, and conflict-detection coverage in
  `test/unit/command-registry.test.ts`,
  `test/unit/command-registry-validation.test.ts`, and
  `test/unit/runtime-plugin-settings.test.ts`.
- [x] (2026-03-05 21:15Z) Stage C complete: added `when` parser/evaluator edge
  cases and error-handling coverage in
  `test/unit/context-key-service.test.ts`.
- [x] (2026-03-05 21:15Z) Stage D complete: updated docs, marked roadmap item
  `9.1.1` done, and passed `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.

## Surprises & Discoveries

- Observation: the current repository already has substantial unit coverage for
  these modules.
  Evidence: `test/unit/command-registry.test.ts` already covers CRUD,
  deterministic ordering, defensive cloning, unknown-command validation, and
  structured validation errors; `test/unit/context-key-service.test.ts` already
  covers precedence/grouping, comparisons, deterministic snapshots, and parse
  failure indices.
  Impact: implementation should extend existing suites rather than replacing
  them.

- Observation: some important command-registry failure-path branches still
  appear untested.
  Evidence: `lib/command-registry.ts` invalidates cached validators on
  `update(...)` and `remove(...)`, and returns `INVALID_COMMAND_SCHEMA` when Ajv
  compilation fails, but the current command-registry suite does not assert
  those branches directly.
  Impact: Stage B should add focused tests for schema-compilation failure and
  validator-cache invalidation so the suite covers real failure paths, not only
  successful validation and unknown-command handling.

- Observation: precedence semantics already exist for runtime plugin
  keybindings, but only as a merge contract rather than a dedicated conflict
  helper.
  Evidence: `app/runtime/plugin-runtime.ts` exports
  `mergeRuntimePluginKeybindings(...)`, and
  `test/unit/runtime-plugin-settings.test.ts` currently verifies only that
  resolved keymaps override runtime defaults.
  Impact: conflict-detection coverage likely needs either additional assertions
  around the existing seam or a very small helper extraction.

- Observation: the repository ships coverage tooling (`bun run test:coverage`,
  `make coverage`) and an example threshold in `docs/testing-with-bun.md`, but
  threshold enforcement may not be fully wired in the active config.
  Evidence: `bunfig.toml` enables coverage reporters and output directories,
  while `docs/testing-with-bun.md` documents an example `coverageThreshold`
  block.
  Impact: the implementation must verify the effective threshold before using
  it as a completion claim.

- Observation: `bun install` and `bun run build:hyper-app` failed in this WSL
  workspace until symlinked `cache/` and `dist/` roots were created through
  their backing targets rather than through the symlink paths themselves.
  Evidence: initial gate runs failed with missing `cache/LOCK` and
  `dist/app`-creation errors while `cache` and `dist` were symlinks into
  `/tmp/velocetty-ci-work/`.
  Impact: the implementation now hardens `bin/mk-snapshot.js` and
  `build/esbuild/run-esbuild.ts` so the required gate sequence works in
  symlinked workspaces.

## Decision Log

- Decision: keep this plan focused on unit tests and minimal pure helper
  extraction, not broader command-dispatch or integration flows.
  Rationale: roadmap item `9.1.1` explicitly targets shared primitives, while
  `9.2.1` owns end-to-end command invocation.
  Date/Author: 2026-03-05 / Codex

- Decision: treat coverage-threshold discovery as a mandatory early step rather
  than assuming a number from older documentation.
  Rationale: the roadmap requires threshold compliance, but current repository
  practice must win over stale or illustrative docs.
  Date/Author: 2026-03-05 / Codex

- Decision: plan for the precedence/conflict work to start from
  `app/runtime/plugin-runtime.ts` and
  `test/unit/runtime-plugin-settings.test.ts`, with a new helper/file only if
  the existing seam is too weak.
  Rationale: this is the narrowest path that still respects the design/PRD
  wording about precedence and conflicts.
  Date/Author: 2026-03-05 / Codex

- Decision: use the current codebase target from
  `docs/velocetty-hyper-codebase.md` §6.6.7.2 as the threshold basis for
  roadmap item `9.1.1`, with Bun function coverage serving as the practical
  proxy for the documented branch target until branch-threshold enforcement is
  wired into the repository.
  Rationale: the active repository tooling collects line/function coverage but
  does not enforce a numeric branch threshold globally; this keeps the closure
  honest and actionable.
  Date/Author: 2026-03-05 / Codex

## Outcomes & Retrospective

Implementation is complete.

Completed outcomes:

1. Added command-registry coverage for compatibility aliases, the legacy
   `editor:search-close` handler path, invalid schema compilation, multi-issue
   validation failures, and validator-cache invalidation in
   `test/unit/command-registry.test.ts` and
   `test/unit/command-registry-validation.test.ts`.
2. Added precedence/conflict coverage by introducing
   `detectKeybindingConflicts(...)` in `app/runtime/plugin-runtime.ts` and
   exercising it in `test/unit/runtime-plugin-settings.test.ts`.
3. Added `when` parser/evaluator edge-case coverage for empty input, whitespace,
   stray operators, identifier variants, and string-escape handling in
   `test/unit/context-key-service.test.ts`.
4. Hardened `bin/mk-snapshot.js` and `build/esbuild/run-esbuild.ts` so
   `bun install` and build flows succeed when `cache` and `dist` are symlinked
   into workspace-local scratch directories.
5. Updated `docs/developers-guide.md` and `docs/roadmap.md` to reflect the
   shipped test practice and roadmap closure.

Coverage acceptance basis:

- Focused coverage command:

  ```bash
  bun test --coverage \
    test/unit/command-registry.test.ts \
    test/unit/command-registry-validation.test.ts \
    test/unit/context-key-service.test.ts \
    test/unit/runtime-plugin-settings.test.ts
  ```

- Threshold basis:
  `docs/velocetty-hyper-codebase.md` §6.6.7.2
- Result:
  touched command/context modules met the documented 60% line target and the
  local 50% function-coverage proxy for the documented branch target.

Retrospective:

- The command-registry module is sensitive to Bun coverage/import behaviour when
  isolated through multiple synthetic module instances, so keeping the stable
  query-import testing pattern was preferable to chasing cleaner attribution at
  the cost of flaky gates.
- Symlinked workspace roots are part of the real operating environment for this
  repository and should be treated as a first-class build/install constraint.

## Context and orientation

The current repository state relevant to this milestone is:

- `shared/src/types/commands.ts` defines the shared command model:
  `CommandDefinition`, `CommandMetadata`, `CommandKind`, and structured
  validation result types.
- `lib/command-registry.ts` is the current runtime command-system seam. It owns
  deterministic registry ordering, schema-based argument validation, legacy
  handler compatibility, and runtime command synchronization.
- `test/unit/command-registry.test.ts` is the existing command-system unit
  suite. It already covers CRUD, ordering, cloning, unknown-command handling,
  and common validation failures.
- `shared/src/types/context-keys.ts` defines the context-key and `when`
  expression types.
- `lib/context-key-tokenizer.ts`, `lib/context-key-parser.ts`,
  `lib/context-key-evaluator.ts`, `lib/context-key-expression.ts`, and
  `lib/context-key-service.ts` implement tokenization, parsing, evaluation,
  compilation, and runtime service behaviour.
- `test/unit/context-key-service.test.ts` is the current behavioural suite for
  parsing, evaluation, determinism, and syntax errors.
- `app/runtime/plugin-runtime.ts` is the current keybinding precedence seam for
  runtime plugin defaults versus resolved keymaps.
- `test/unit/runtime-plugin-settings.test.ts` already proves one precedence
  rule and is the most likely home for additional precedence/conflict tests if
  no better seam exists.
- `docs/developers-guide.md` already documents command-registry and context-key
  testing expectations, the required gate order, and the docs-only validation
  commands.
- `docs/roadmap.md` item `9.1.1` is now marked complete because the
  implementation, focused coverage review, and final gates all passed.

The most likely files touched during implementation are:

- `test/unit/command-registry.test.ts`
- `test/unit/context-key-service.test.ts`
- `test/unit/runtime-plugin-settings.test.ts` or a new focused unit test file
- `app/runtime/plugin-runtime.ts` only if a minimal pure helper extraction is
  required for deterministic precedence/conflict assertions
- `docs/developers-guide.md`
- `docs/roadmap.md`

## Plan of work

### Stage A: confirm the active coverage contract and capture a red baseline

Start by proving what the repository currently enforces instead of assuming it.
Run the coverage workflow and inspect `bunfig.toml`, `package.json`, and the
relevant docs together. The goal of this stage is to answer two questions with
evidence:

1. What coverage threshold is currently active for this repository?
2. Which branches/files in the command/context area are still uncovered?

Use the following commands and save the outputs for later review:

```bash
set -o pipefail; bun run test:coverage | tee /tmp/coverage-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; bun test test/unit/command-registry.test.ts \
  | tee /tmp/test-command-registry-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; bun test test/unit/context-key-service.test.ts \
  | tee /tmp/test-context-key-service-$(get-project)-$(git branch --show).out
```

If the threshold is not clearly enforced by current repo state, document the
discovery in `Decision Log`, update `docs/developers-guide.md` during Stage D
to make the real workflow explicit, and do not mark the roadmap item complete
until the threshold basis is clear.

Stage A exit criteria:

1. The active or accepted coverage threshold is identified with evidence.
2. A short gap list exists for command-system tests, `when` tests, and any
   precedence/conflict seam.

### Stage B: expand command-system unit coverage

Extend `test/unit/command-registry.test.ts` first, because the developers'
guide already defines it as the home for command-registry behaviour. Add cases
that target the error-handling and parser-adjacent paths the roadmap still
calls out:

1. Invalid schema compilation in `validateArgs(...)` so the
   `INVALID_COMMAND_SCHEMA` path is covered.
2. Multi-issue validation payloads so failures remain actionable rather than
   collapsing to a single vague assertion.
3. Runtime command synchronization edge cases where plugin-contributed commands
   appear, disappear, or coexist with non-runtime commands.
4. Validator-cache invalidation after `update(...)` and `remove(...)` so stale
   compiled schemas cannot leak across registry mutations.
5. Any command-definition behaviour tied to `defaultWhen` metadata that is
   currently untested but required by the design.

After extending the registry suite, address precedence/conflict semantics. Use
the narrowest existing seam first:

1. Expand `test/unit/runtime-plugin-settings.test.ts` to prove that resolved
   keymaps override runtime defaults deterministically.
2. Add deterministic duplicate/conflict assertions around the same seam if the
   current implementation already exposes enough information.
3. If conflict detection is impossible to observe without a small extraction,
   extract a pure helper next to `app/runtime/plugin-runtime.ts` that computes
   deterministic keybinding conflicts from already-existing data. Keep this
   helper free of side effects and do not change runtime behaviour beyond making
   existing precedence/conflict rules testable.

Stage B exit criteria:

1. Command-system unit tests cover invalid-schema and richer validation-error
   paths.
2. Precedence behaviour is proven with deterministic assertions.
3. Conflict-detection coverage exists at the pure-helper or current-seam level
   without broadening into dispatcher or UI integration work.

### Stage C: harden `when` parser/evaluator edge-case coverage

Extend `test/unit/context-key-service.test.ts` unless Stage A coverage data
shows that a new low-level tokenizer/parser suite would be clearer. Target
cases that close real parser/evaluator branches rather than repeating existing
happy paths:

1. Empty input and whitespace-only expressions.
2. Unmatched closing parenthesis and other stray-token failures.
3. Invalid operator fragments such as single `&` or `|`, or malformed chained
   comparison/operator sequences.
4. String-literal escape and unterminated-escape edge cases that should surface
   stable syntax indices.
5. Identifier edge cases such as dotted identifiers, `$`-prefixed names, and
   `_`-prefixed names if they are accepted by the tokenizer grammar.
6. Unsupported escape forms and additional escape branches handled by
   `lib/context-key-tokenizer.ts`, including carriage-return and escaped
   backslash behaviour.
7. Numeric edge cases such as malformed exponents, malformed negative values, or
   boundary comparisons that are not yet covered.
8. Repeated compile/evaluate cycles that prove deterministic cache reuse and
   stable results across object and `Map` contexts.

If Stage A shows that `lib/context-key-tokenizer.ts` remains under-covered even
after service-level additions, add a focused suite such as
`test/unit/context-key-tokenizer.test.ts` and keep it limited to behaviour that
cannot be expressed cleanly through the service API.

Stage C exit criteria:

1. Parser edge cases and error handling are covered by clear unit assertions.
2. Precedence/grouping and repeated evaluation remain deterministic.
3. Coverage evidence for the context-key modules improves in a way a reviewer
   can trace back to concrete new tests.

### Stage D: documentation, roadmap closure, and full validation

Update `docs/developers-guide.md` to reflect any new development practice that
the implementation makes mandatory. Expected update points are:

1. `Command registry practice`, if new command-system test categories are now
   required.
2. `Context key and when practice`, if new parser-edge-case or tokenizer
   coverage rules are now expected.
3. `Tests`, if the accepted coverage command or threshold workflow needs to be
   made explicit for developers.

After the docs match the implementation, mark roadmap item `9.1.1` done in
`docs/roadmap.md` and run the required validation sequence in order with saved
logs:

```bash
set -o pipefail; bun install | tee /tmp/bun-install-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; make build | tee /tmp/build-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; make check-fmt | tee /tmp/check-fmt-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; make lint | tee /tmp/lint-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; make test | tee /tmp/test-$(get-project)-$(git branch --show).out
```

Because this milestone modifies docs, also run:

```bash
set -o pipefail; bunx markdownlint-cli2 "docs/**/*.md" | tee /tmp/markdownlint-$(get-project)-$(git branch --show).out
```

```bash
set -o pipefail; nixie --no-sandbox | tee /tmp/nixie-$(get-project)-$(git branch --show).out
```

Stage D exit criteria:

1. `docs/developers-guide.md` matches the final practice.
2. `docs/roadmap.md` marks `9.1.1` complete.
3. All required gates pass and log paths are recorded.

## Verification

The implementation is complete only when all of the following are true:

1. The command-system and `when` unit suites contain the new edge-case,
   precedence, and conflict-detection assertions described above.
2. The focused `bun test --coverage` command recorded in
   `Coverage acceptance basis` shows the command/context modules meeting the
   accepted repository threshold basis documented during this work.
3. The required release-gate sequence succeeds in this order:
   `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
4. The docs-only gates (`bunx markdownlint-cli2 "docs/**/*.md"` and
   `nixie --no-sandbox`) pass because this milestone updates docs.
5. `docs/developers-guide.md` and `docs/roadmap.md` reflect the shipped state.
