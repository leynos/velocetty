# Replace AVA with Bun test runner

This ExecPlan is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as
work proceeds.

Status: DRAFT

No `PLANS.md` file was found in the repository root at plan start.

## Purpose / Big picture

Migrate unit and end-to-end (E2E) tests from AVA to Bun's built-in test
runner so the repository uses a single primary runner, removes AVA
dependencies, and aligns with the Bun-first tooling strategy. Success is
observable when `make check-fmt`, `make lint`, and `make test` all pass,
unit tests run directly under `bun test`, E2E tests run under `bun test`
with Playwright, documentation reflects the new workflow, and the roadmap
entry for AVA removal is marked done.

## Constraints

- Follow `docs/adr-001-replace-ava-with-bun-test.md` and
  `docs/testing-with-bun.md` for runner selection and behaviour.
- Use Bun for JavaScript/TypeScript commands and prefer Makefile targets
  for validation (`make check-fmt`, `make lint`, `make test`).
- Keep the existing test intent, assertions, and coverage; only update
  APIs to Bun equivalents.
- Preserve the Playwright-based E2E coverage and keep E2E tests opt-in so
  `make test` remains fast.
- Keep documentation in `docs/` accurate, updated, and wrapped to 80
  columns, using en-GB-oxendict spelling.
- Do not introduce new external dependencies without explicit approval.

## Tolerances (Exception triggers)

- Scope: if the change exceeds 30 files or 900 net lines, stop and
  escalate.
- Interface: if production APIs or runtime behaviour must change to make
  tests pass, stop and escalate.
- Dependencies: if a new dependency is required, stop and escalate.
- Iterations: if `make test` fails after three focused fix attempts,
  stop and escalate with the failure logs.
- Ambiguity: if AVA-to-Bun mapping is unclear for a test, stop and present
  options with trade-offs.

## Risks

- Risk: Bun's Playwright compatibility may be incomplete for Electron E2E
  tests.
  Severity: high
  Likelihood: medium
  Mitigation: keep E2E tests isolated, gate them behind `RUN_E2E=1`, and
  document any Bun-specific caveats; stop and escalate if Playwright
  fails under Bun.
- Risk: AVA features (serial tests, teardown hooks) may not map 1:1.
  Severity: medium
  Likelihood: medium
  Mitigation: map `test.serial` to Bun's `test.serial` or keep tests
  sequential and use `beforeAll`/`afterAll`/`afterEach` to replace
  `t.teardown`.
- Risk: Documentation references to AVA become inconsistent.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/velocetty-hyper-codebase.md` sections that
  describe the test runner, config files, and scripts; add a developer
  guide entry for the new workflow.

## Progress

- [ ] (2026-02-01 14:54Z) Draft the ExecPlan and confirm scope with the
  user.
- [ ] Inventory AVA usage, test file locations, and scripts to update.
- [ ] Convert unit and E2E tests to `bun:test` and rename files for Bun
  discovery.
- [ ] Remove AVA config, bridge tests, and dependencies.
- [ ] Update documentation and roadmap entries.
- [ ] Run format, lint, and test gates; fix any issues; commit changes.

## Surprises & Discoveries

- Observation: None yet.
  Evidence: N/A.
  Impact: N/A.

## Decision Log

- Decision: Plan to replace AVA tests with `bun:test` and keep E2E tests
  gated behind `RUN_E2E=1` to preserve fast default runs.
  Rationale: Matches existing E2E gating while moving the runner to Bun.
  Date/Author: 2026-02-01 14:54Z, Codex.

## Outcomes & Retrospective

- Pending. Populate after implementation.

## Context and Orientation

The repository currently uses AVA for unit tests and an AVA bridge test to
run both unit and E2E suites under Bun. AVA configuration lives in
`ava.config.js` and `ava-e2e.config.js`, and the bridge is
`test/bun-ava-bridge.test.js`. Unit tests live under `test/unit/` with
`.ava.ts` filenames, and the E2E test is `test/index.ts`. The Bun config
(`bunfig.toml`) preloads `test/bun-test-preload.js`, which exists only to
support AVA under Bun. `package.json` scripts route `test:unit` and
`test:e2e` through the bridge. The roadmap entry `1.4.4` mentions removing
AVA; this plan completes that requirement and marks the entry done once
AVA is removed.

## Plan of Work

Stage A: Inventory and mapping (no code changes). Confirm all AVA usage
via `rg` searches, review test files in `test/unit/` and `test/index.ts`,
and map AVA constructs (`test.serial`, `test.before`, `t.teardown`,
`t.true`, `t.false`, `t.is`, `t.deepEqual`, `t.fail`) to Bun's `test`,
`beforeAll`, `afterAll`, `afterEach`, and `expect` equivalents. Decide on
new filenames matching Bun discovery patterns.

Stage B: Test runner migration. Rename unit test files from `*.ava.ts` to
`*.test.ts` (or `*.spec.ts`) and update imports to `bun:test`. Replace AVA
assertions with `expect` assertions, convert teardown to `afterEach` or
`try/finally`, and keep serial semantics via `test.serial` or by avoiding
concurrency. Move or rename the E2E test to a `*.test.ts` filename,
convert its hooks to `beforeAll`/`afterAll`, and keep it gated behind
`RUN_E2E=1`. Validate unit tests with `bun test` before removing AVA.

Stage C: Remove AVA artefacts and update scripts. Delete `ava.config.js`,
`ava-e2e.config.js`, `test/bun-ava-bridge.test.js`, and
`test/bun-test-preload.js`. Update `bunfig.toml` to remove the AVA preload
and add any new preloads if needed for Happy DOM. Update `package.json`
scripts to run `bun test` directly for unit and E2E suites, and remove
AVA-related devDependencies (`ava`, `@ava/babel`, `@ava/typescript`).
Update `bun.lock` accordingly.

Stage D: Documentation and roadmap updates. Create or update
`docs/developers-guide.md` to describe the Bun test workflow (unit, E2E,
opt-in E2E via `RUN_E2E=1`, and the Makefile commands). Update
`docs/velocetty-hyper-codebase.md` sections that mention AVA, its config
files, and test scripts to reflect Bun. Update any other documentation
references to AVA found via `rg` searches. Mark roadmap entry `1.4.4` as
`[x]` once AVA is fully removed (confirm no Yarn references if this
roadmap item requires it). Run Markdown linting and formatting tools for
documentation changes.

## Concrete Steps

1. Audit current AVA usage and test layout:

    rg -n "\\bava\\b" test docs package.json
    rg -n "\\.ava\\.ts" test

2. Rename and update unit tests to `bun:test` and rename to
   `*.test.ts` (for example, `test/unit/cli-api.test.ts`). Convert AVA
   assertions to `expect` and replace AVA hooks with Bun hooks.

3. Convert the E2E test to `bun:test`, rename to a Bun-discovered file
   (for example, `test/e2e/electron.e2e.test.ts`), and gate with
   `RUN_E2E=1`. Use `beforeAll`/`afterAll` only when E2E is enabled.

4. Remove AVA bridge/config files and update Bun config:

   - Delete `ava.config.js`, `ava-e2e.config.js`,
     `test/bun-ava-bridge.test.js`, and `test/bun-test-preload.js`.
   - Update `bunfig.toml` to remove the AVA preload and add any new
     preloads if required.

5. Update `package.json` scripts and dependencies:

   - Update `test:unit:run` to `bun test test/unit` (or the new unit test
     directory path).
   - Update `test:e2e:run` to `RUN_E2E=1 bun test test/e2e` (or the new
     E2E path).
   - Remove AVA devDependencies.

6. Update documentation:

   - Create or update `docs/developers-guide.md` with the new testing
     workflow.
   - Update `docs/velocetty-hyper-codebase.md` AVA references and test
     script tables.
   - Update any other doc references to AVA found in step 1.
   - Mark roadmap entry `1.4.4` as done in `docs/roadmap.md`.

7. Run validation commands with logs captured via `tee`:

    make check-fmt | tee /tmp/check-fmt-velocetty-$(git branch --show).out
    make lint | tee /tmp/lint-velocetty-$(git branch --show).out
    make test | tee /tmp/test-velocetty-$(git branch --show).out
    bunx markdownlint-cli "docs/**/*.md" | \\
      tee /tmp/markdownlint-velocetty-$(git branch --show).out
    nixie --no-sandbox | tee /tmp/nixie-velocetty-$(git branch --show).out

8. If E2E is expected to pass in this environment, run:

    bun run test:e2e | tee /tmp/test-e2e-velocetty-$(git branch --show).out

9. Commit changes with a descriptive message after all gates pass.

## Validation and Acceptance

Quality criteria (done means all of the following):

- `make check-fmt`, `make lint`, and `make test` succeed.
- Unit tests run directly under Bun with no AVA bridge or AVA config.
- E2E tests run under Bun when `RUN_E2E=1` is set (if E2E execution is
  supported in this environment).
- AVA dependencies and config files are removed from the repository.
- Documentation and roadmap reflect the Bun test workflow and AVA removal.

Quality method (how we check):

- Run the Makefile gates listed above and inspect logs for failures.
- Run `bun run test:unit` and `bun run test:e2e` as needed.
- Verify `rg -n "\\bava\\b"` returns no AVA usage except historical
  references that are intentionally retained in ADRs.

## Idempotence and Recovery

The steps are safe to re-run. File renames and deletions are deterministic.
If a test fails after conversion, revert only the affected test file to the
last working commit and re-apply the conversion carefully. If E2E tests
fail due to Bun/Playwright incompatibilities, stop and escalate rather than
adding workarounds that change production code.

## Artifacts and Notes

Expected file changes include:

- Removed: `ava.config.js`, `ava-e2e.config.js`,
  `test/bun-ava-bridge.test.js`, `test/bun-test-preload.js`.
- Renamed: `test/unit/*.ava.ts` to `test/unit/*.test.ts` (or `.spec.ts`).
- Renamed/moved: `test/index.ts` to a Bun-discovered E2E test filename.
- Updated: `package.json`, `bunfig.toml`, `bun.lock`,
  `docs/developers-guide.md`, `docs/velocetty-hyper-codebase.md`,
  `docs/roadmap.md`.

## Interfaces and Dependencies

- Test runner API: `bun:test` (`test`, `describe`, `beforeAll`,
  `afterAll`, `afterEach`, `expect`).
- E2E automation: `playwright`'s Electron API (`_electron.launch`).
- Test utilities: `proxyquire` for dependency injection, Happy DOM helpers
  in `test/testUtils/happy-dom.ts`.

## Revision note

- 2026-02-01 14:54Z: Initial ExecPlan drafted for AVA-to-Bun migration.
  No implementation started yet.
