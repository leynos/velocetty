# Replace AVA with Bun test runner

## Module header

- Purpose: Track execution steps, risks, and decisions for migrating tests to
  Bun.
- Invariants: Keep progress, risks, and decision log current during execution.
- Cross-links: [ADR 001](../adr-001-replace-ava-with-bun-test.md),
  [Testing with Bun](../testing-with-bun.md), and
  [Developers' guide](../developers-guide.md).

This ExecPlan is a living document. The sections `Constraints`,
`Tolerances (exception triggers)`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, and `Outcomes & retrospective`
must be kept up to date as work proceeds.

Status: IN PROGRESS

No `PLANS.md` file was found in the repository root at plan start.

## Purpose / Big picture

Migrate unit and end-to-end (E2E) tests from AVA to Bun's built-in test
runner, so the repository uses a single primary runner, removes AVA
dependencies, and aligns with the Bun-first tooling strategy. Success is
observable when `make check-fmt`, `make lint`, and `make test` all pass,
unit tests run directly under `bun test`, E2E tests run under `bun test`
with Playwright, documentation reflects the new workflow, and the roadmap
entry for AVA removal is marked done.

## Constraints

- Follow `../adr-001-replace-ava-with-bun-test.md` and
  `../testing-with-bun.md` for runner selection and behaviour.
- Use Bun for JavaScript/TypeScript commands and prefer Makefile targets
  for validation (`make check-fmt`, `make lint`, `make test`).
- Keep the existing test intent, assertions, and coverage; only update
  APIs to Bun equivalents.
- Preserve the Playwright-based E2E coverage and keep E2E tests opt-in so
  `make test` remains fast.
- Keep documentation in `docs/` accurate, updated, and wrapped to 80
  columns, using en-GB-oxendict spelling.
- Do not introduce new external dependencies without explicit approval.

## Tolerances (exception triggers)

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
  document any Bun-specific warnings; stop and escalate if Playwright
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
  Mitigation: update `../velocetty-hyper-codebase.md` sections that
  describe the test runner, config files, and scripts; add a developer
  guide entry for the new workflow.

## Progress

- [x] (2026-02-01 14:54Z) Draft the ExecPlan and confirm scope with the
  user.
- [x] (2026-02-01 15:11Z) Receive approval to proceed with implementation.
- [x] (2026-02-01 16:05Z) Inventory AVA usage, test file locations, and
  scripts to update.
- [x] (2026-02-01 16:20Z) Convert unit and E2E tests to `bun:test` and
  rename files for Bun discovery.
- [x] (2026-02-01 16:24Z) Remove AVA config, bridge tests, and dependencies.
- [x] (2026-02-01 16:33Z) Update documentation and roadmap entries.
- [x] (2026-02-01 18:05Z) Run format, lint, and test gates; fix any issues;
  commit changes.

## Surprises & discoveries

- Observation: `bun install` runs the full postinstall pipeline (V8
  snapshots, packaging prep, and native rebuilds), which is time-intensive.
  Evidence: The install triggered `v8-snapshot`, `electron-builder` app
  dependency installation, and `node-pty` rebuild steps.
  Impact: Allow additional time for dependency updates and avoid repeating
  installs unless necessary.
- Observation: `proxyquire` does not reliably intercept ESM imports under
  Bun's test runner.
  Evidence: Bun test runs failed when proxyquire injected stubs for ESM
  modules, leaving mocks undefined.
  Impact: Replace proxyquire usage with Bun `mock.module()` and remove the
  dependency.

## Decision log

- Decision: Plan to replace AVA tests with `bun:test` and keep E2E tests
  gated behind `RUN_E2E=1` to preserve fast default runs.
  Rationale: Matches existing E2E gating while moving the runner to Bun.
  Date/Author: 2026-02-01 14:54Z, Codex.
- Decision: Proceed with implementation after user approval.
  Rationale: User approved the plan and requested execution.
  Date/Author: 2026-02-01 15:11Z, Codex.
- Decision: Keep E2E setup and teardown inside the Bun test body with an
  explicit timeout.
  Rationale: Ensures the per-test timeout covers packaged app startup and
  avoids relying on implicit hook timeouts.
  Date/Author: 2026-02-01 16:22Z, Codex.
- Decision: Remove `bunfig.toml` after dropping the AVA preload.
  Rationale: The file only existed to shim AVA under Bun and is no longer
  required.
  Date/Author: 2026-02-01 16:25Z, Codex.
- Decision: Replace proxyquire stubs with Bun `mock.module()`.
  Rationale: Bun's ESM loader does not support proxyquire's CommonJS
  interception.
  Date/Author: 2026-02-01 17:20Z, Codex.

## Outcomes & retrospective

- Completed the AVA-to-Bun migration, including module mocks via Bun
  `mock.module()`, and removed legacy AVA/proxyquire artefacts.
- Gates passed: `make check-fmt`, `make lint`, `make test`.
- Remaining note: Bun tests emit React `act(...)` warnings in Happy DOM,
  but all assertions pass.

## Context and orientation

The repository previously used AVA for unit tests and a Bun bridge test to
run AVA under `bun test`. The migration replaces that with Bun's built-in
test runner. Unit tests now live under `test/unit/` as `*.test.ts` files, and
the E2E smoke test lives in `test/e2e/electron.e2e.test.ts` with
`RUN_E2E=1` gating. Module mocking now uses Bun `mock.module()` stubs
instead of proxyquire. AVA config and bridge files have been removed, and
`package.json` scripts now invoke `bun test` directly. The roadmap entry
`1.4.4` tracks the AVA removal and is marked done once the migration is
complete.

## Plan of work

Stage A: Inventory and mapping (no code changes). Confirm all AVA usage
via `rg` searches, review test files in `test/unit/` and
`test/e2e/electron.e2e.test.ts`, and map AVA constructs (`test.serial`,
`test.before`, `t.teardown`, `t.true`, `t.false`, `t.is`, `t.deepEqual`,
`t.fail`) to Bun's `test`, hook helpers, and `expect` equivalents. Decide
on new filenames matching Bun discovery patterns.

Stage B: Test runner migration. Rename unit test files from `*.ava.ts` to
`*.test.ts` (or `*.spec.ts`) and update imports to `bun:test`. Replace AVA
assertions with `expect` assertions, convert teardown to `afterEach` or
`try/finally`, and keep serial semantics via `test.serial` or by avoiding
concurrency. Move or rename the E2E test to a `*.test.ts` filename,
convert its hooks to `beforeAll`/`afterAll`, and keep it gated behind
`RUN_E2E=1`. Validate unit tests with `bun test` before removing AVA.

Stage C: Remove AVA artefacts and update scripts. Delete `ava.config.js`,
`ava-e2e.config.js`, `test/bun-ava-bridge.test.js`, and
`test/bun-test-preload.js`. Remove `bunfig.toml` if it only exists for the
AVA preload. Update `package.json` scripts to run `bun test` directly for
unit and E2E suites, and remove AVA-related devDependencies (`ava`,
`@ava/babel`, `@ava/typescript`). Update `bun.lock` accordingly.

Stage D: Documentation and roadmap updates. Create or update
`../developers-guide.md` to describe the Bun test workflow (unit, E2E,
opt-in E2E via `RUN_E2E=1`, and the Makefile commands). Update
`../velocetty-hyper-codebase.md` sections that mention AVA, its config
files, and test scripts to reflect Bun. Update any other documentation
references to AVA found via `rg` searches. Mark roadmap entry `1.4.4` as
`[x]` once AVA is fully removed (confirm no Yarn references if this
roadmap item requires it). Run Markdown linting and formatting tools for
documentation changes.

## Concrete steps

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
   - Remove `bunfig.toml` if it only exists for the AVA preload.

5. Update `package.json` scripts and dependencies:

   - Update `test:unit:run` to `bun test test/unit` (or the new unit test
     directory path).
   - Update `test:e2e:run` to `RUN_E2E=1 bun test test/e2e` (or the new
     E2E path).
   - Remove AVA devDependencies.

6. Update documentation:

   - Create or update `../developers-guide.md` with the new testing
     workflow.
   - Update `../velocetty-hyper-codebase.md` AVA references and test
     script tables.
   - Update any other doc references to AVA found in step 1.
   - Mark roadmap entry `1.4.4` as done in `../roadmap.md`.

7. Run validation commands with logs captured via `tee`:

    make check-fmt | tee /tmp/check-fmt-velocetty-$(git branch --show).out
    make lint | tee /tmp/lint-velocetty-$(git branch --show).out
    make test | tee /tmp/test-velocetty-$(git branch --show).out
    bunx markdownlint-cli2 "docs/**/*.md" | \\
      tee /tmp/markdownlint-velocetty-$(git branch --show).out
    nixie --no-sandbox | tee /tmp/nixie-velocetty-$(git branch --show).out

8. If E2E is expected to pass in this environment, run:

    bun run test:e2e | tee /tmp/test-e2e-velocetty-$(git branch --show).out

9. Commit changes with a descriptive message after all gates pass.

## Validation and acceptance

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

## Idempotence and recovery

The steps are safe to re-run. File renames and deletions are deterministic.
If a test fails after conversion, revert only the affected test file to the
last working commit and re-apply the conversion carefully. If E2E tests
fail due to Bun/Playwright incompatibilities, stop and escalate rather than
adding workarounds that change production code.

## Artifacts and notes

Expected file changes include:

- Removed: `ava.config.js`, `ava-e2e.config.js`,
  `test/bun-ava-bridge.test.js`, `test/bun-test-preload.js`,
  `bunfig.toml`.
- Renamed: `test/unit/*.ava.ts` to `test/unit/*.test.ts` (or `.spec.ts`).
- Renamed/moved: `test/index.ts` to `test/e2e/electron.e2e.test.ts`.
- Updated: `package.json`, `bun.lock`, `../developers-guide.md`,
  `../velocetty-hyper-codebase.md`, `../roadmap.md`.

## Interfaces and dependencies

- Test runner API: `bun:test` (`test`, `describe`, `beforeAll`,
  `afterAll`, `afterEach`, `expect`).
- E2E automation: `playwright`'s Electron API (`_electron.launch`).
- Test utilities: Bun `mock.module()` for dependency injection, Happy DOM
  helpers in `test/testUtils/happy-dom.ts`.

## Revision note

- 2026-02-01 15:11Z: Status set to IN PROGRESS and approval recorded. No
  implementation steps completed yet.
- 2026-02-01 16:36Z: Progress, context, and decisions updated to reflect the
  Bun migration work, including removal of the AVA preload and E2E timeout
  handling.
- 2026-02-01 17:20Z: Documented proxyquire removal and switch to Bun module
  mocks.
