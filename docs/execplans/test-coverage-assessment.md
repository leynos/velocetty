# Assess coverage gaps and add Bun coverage benchmarking

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises and discoveries`, `Decision log`, and
`Outcomes and retrospective` are maintained as work proceeds.

Status: COMPLETE

## Purpose and big picture

The current repository has a small unit and E2E test surface, but there is no
standardized Bun coverage workflow and several high-branch files are
under-tested. This plan establishes repeatable Bun coverage benchmarking,
documents current gaps, and adds focused tests to close the most important
coverage holes while preserving existing behaviour.

Success is observable when:

- `make build`, `make check-fmt`, `make lint`, `make typecheck`, and
  `make test` all pass.
- A Bun-native coverage command exists and runs cleanly.
- Coverage output demonstrates measurable improvement versus the baseline.
- Unit and E2E suite gaps are documented with specific follow-on test targets.

## Constraints

- Use repository tooling conventions: Bun scripts and Makefile targets.
- Preserve existing runtime behaviour; only test and coverage wiring changes are
  allowed unless a defect is discovered.
- Keep changes atomic and reviewable; avoid broad refactors unrelated to
  testing and coverage.
- Keep documentation aligned with actual commands and outputs.
- Do not introduce new external dependencies.

## Tolerances (exception triggers)

- Scope: if more than 12 files must change, stop and re-evaluate scope.
- Interfaces: if production-facing API signatures must change, stop and
  re-evaluate.
- Dependencies: if a new dependency is required, stop and re-evaluate.
- Iterations: if a target test file still fails after 3 focused fix attempts,
  stop and reassess test strategy.
- Build time: if any required Makefile gate cannot complete under environment
  constraints, capture evidence and continue with the maximum verifiable subset.

## Risks

- Risk: Coverage settings in Bun 1.3.8 may differ from the documentation.
  Severity: medium.
  Likelihood: medium.
  Mitigation: validate with `bun test --help` and trial runs before finalizing
  config.

- Risk: Existing tests rely on module singleton state and can become order
  sensitive.
  Severity: medium.
  Likelihood: medium.
  Mitigation: prefer serial tests where needed and isolate mutable stubs.

- Risk: E2E packaged-app tests are environment-dependent and expensive.
  Severity: low.
  Likelihood: high.
  Mitigation: keep E2E smoke coverage in place, add testable helper-path checks
  in unit tests, and explicitly document any remaining E2E gaps.

## Progress

- [x] 2026-02-05 22:14 UTC: Collected baseline suite and coverage data.
- [x] 2026-02-05 22:14 UTC: Stabilized failing React `act` imports in unit
  tests.
- [x] 2026-02-05 22:18 UTC: Added Bun coverage configuration and scripts
  (`bunfig.toml`, `test:coverage`, `make coverage`).
- [x] 2026-02-05 22:21 UTC: Added targeted tests for branch-heavy modules and
  E2E helper logic.
- [x] 2026-02-05 22:22 UTC: Re-ran coverage and benchmarked baseline vs updated
  metrics.
- [x] 2026-02-05 22:23 UTC: Ran required Makefile gates successfully.

## Surprises and discoveries

- `bun run test:unit` initially failed because the suite used mixed `act`
  import paths; tests are now standardized on React 19's `act` import from
  `react`.
- Baseline `bun test --coverage test/unit` results:
  - Functions: 72.73%
  - Lines: 84.77%
  - Largest uncovered areas:
    - `cli/api.ts`
    - `app/updater.ts`
    - `lib/containers/hyper.tsx`
- Post-change `bun run test:coverage` results:
  - Functions: 82.44%
  - Lines: 89.92%
  - Net improvement:
    - Functions: +9.71 percentage points
    - Lines: +5.15 percentage points
- E2E suite assessment:
  - The only E2E file remains a packaged-build smoke test and is skipped unless
    `RUN_E2E=1`.
  - High-value deterministic branches (launch config paths and timeout handling)
    were extracted into helper utilities and now covered via unit tests.
- Additional repository discovery:
  - `make typecheck` had pre-existing failures caused by `jsx="true"` string
    props in multiple styled-jsx blocks; these were corrected to
    `jsx={true}` / `global={true}` so the requested gates pass.

## Decision log

- Decision: Fix baseline test breakage before coverage expansion.
  Rationale: Coverage metrics are only meaningful once the suite is stable.

- Decision: Target branch-heavy modules first (`cli/api.ts`, `app/updater.ts`,
  `lib/containers/hyper.tsx`).
  Rationale: These files currently account for most uncovered behavioural paths
  and provide better risk reduction than adding shallow tests.

- Decision: Use Bun’s built-in `--coverage` support and wire it through project
  scripts/docs.
  Rationale: Aligns with repository direction and keeps coverage tooling simple.

- Decision: Extract E2E helper logic into a shared module tested in unit tests.
  Rationale: Provides deterministic coverage for E2E branching logic without
  requiring packaged binaries for every branch path.

- Decision: Fix pre-existing type errors in styled-jsx props while validating
  requested gates.
  Rationale: User-required quality gates include `make typecheck`, which could
  not pass without these corrections.

## Outcomes and retrospective

Completed deliverables:

- Added Bun coverage workflow:
  - `bunfig.toml` coverage defaults
  - `bun run test:coverage`
  - `make coverage`
- Expanded unit suite for uncovered branches:
  - `test/unit/cli-api-behaviour.test.ts`
  - `test/unit/hyper-effects.test.ts` (additional branch cases)
  - `test/unit/notification.test.ts` (manual dismiss + ref lifecycle)
  - `test/unit/updater.test.ts` (timers, channel switching, cleanup branches)
  - `test/unit/electron-e2e-helpers.test.ts`
- Extracted E2E helper module:
  - `test/e2e/electron-e2e-helpers.ts`
  - `test/e2e/electron.e2e.test.ts` now imports helper utilities.
- Updated documentation:
  - `docs/testing-with-bun.md`
  - `docs/developers-guide.md`

Validation summary:

- `make check-fmt`: pass
- `make lint`: pass
- `make typecheck`: pass
- `make test`: pass
- `make build`: pass
