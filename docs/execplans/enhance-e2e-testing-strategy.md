# Implement ADR-005 Option C layered end-to-end strategy

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` are maintained as work proceeds.

Status: Complete (Option C implemented and validated locally)

## Purpose and big picture

Architecture Decision Record 005 (ADR-005) selected Option C: keep a fast pull
request end-to-end (E2E) lane and add a deeper behavioural lane for scheduled
and release validation. The repository currently has only one Bun-driven
packaged-app smoke test with limited renderer coverage.

This change introduces a layered test strategy with explicit continuous
integration (CI) policy,
interaction-path coverage, and standard diagnostics so that:

- pull requests keep fast E2E feedback,
- release branches get deeper confidence,
- failures are actionable with artefacts.

Success is observable when:

- fast lane verifies renderer readiness and fails on critical renderer console
  errors,
- deep lane runs under Playwright Test on Node.js,
- deep lane is triggered on schedule, manual dispatch, and pushes to
  `master`/`canary`,
- `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  all pass,
- `docs/developers-guide.md` and roadmap tracking are updated.

## Constraints

- Preserve Bun as the default unit and integration test runner.
- Keep existing packaged-build smoke checks in the fast lane.
- Preserve `E2E_DRIVER=playwright|spawn` compatibility for fast-lane smoke.
- Implement deep lane with Playwright's Node-first test runner.
- Keep CI and local commands additive; do not remove existing test entry points.
- Keep documentation aligned with actual commands and workflow behaviour.

## Tolerances (exception triggers)

- Scope: if implementation requires more than 16 file changes, pause and
  re-evaluate scope.
- Runtime: if deep lane pushes expected CI time above acceptable limits,
  document mitigation options before enabling strict policy.
- Flake threshold: if deep lane remains nondeterministic after two focused
  stabilization attempts, stop and redesign selectors/waits before proceeding.
- Interface drift: if existing command names must be removed instead of aliased,
  stop and redesign with backwards compatibility.

## Risks

- Risk: renderer selectors in deep lane become brittle.
  Severity: medium.
  Likelihood: medium.
  Mitigation: use stable mount and terminal selectors plus bounded polling.

- Risk: console-error gating creates noise from benign messages.
  Severity: medium.
  Likelihood: low.
  Mitigation: filter known low-signal messages and keep allowlist narrow.

- Risk: artefact retention increases CI storage usage.
  Severity: low.
  Likelihood: medium.
  Mitigation: retain full artefacts on failure-only paths for screenshots and
  traces while still collecting textual diagnostics.

## Progress

- [x] 2026-02-07: Branch confirmed as `enhance-e2e-testing-strategy`.
- [x] 2026-02-07: ADR-005 and referenced design/spec docs reviewed.
- [x] 2026-02-07: Baseline validation completed (`bun install`, `make build`,
  `make check-fmt`, `make lint`, `make test`).
- [x] 2026-02-07: Fast-lane renderer readiness and console gating implemented.
- [x] 2026-02-07: Deep Playwright lane scaffolding and first interaction test
  implemented.
- [x] 2026-02-07: CI workflow updated with schedule and manual trigger plus
  deep-lane Linux job.
- [x] 2026-02-07: Docs and roadmap updates implemented.
- [x] 2026-02-07: Required repository gates validated
  (`bun install`, `make build`, `make check-fmt`, `make lint`, `make test`).
- [x] 2026-02-07: Deep-lane interaction-path assertion stabilized and validated.

## Surprises & discoveries

- `grepai` indexing intermittently returned `unexpected EOF`; targeted file reads
  were used for affected exploration steps.
- There was no existing Playwright Test configuration, so deep lane setup is
  entirely additive.
- Existing CI workflow did not permit manual trigger; `workflow_dispatch` needed
  to be introduced at workflow level.
- Packaged renderer startup initially exposed React module-resolution drift in
  packaged mode; normalizing React/Redux externals and adding missing runtime
  dependencies in `app/package.json` resolved the invalid-hook failure.

## Decision log

- Decision: Use terminal input/output as the first deep-lane scenario.
  Rationale: it validates renderer readiness and interactive behaviour with high
  product value for minimal initial scope.

- Decision: Treat deep-lane failures on `master` and `canary` as
  release-blocking.
  Rationale: ADR intent is deeper confidence before release cut.

- Decision: Start deep lane on Linux only.
  Rationale: balance deterministic coverage and CI cost; keep fast lane
  cross-platform for launch confidence.

- Decision: Enable manual deep-lane invocation via `workflow_dispatch`.
  Rationale: supports ad-hoc release validation and debugging without new code
  pushes.

## Implementation details

### 1. Fast lane hardening

Update `test/e2e/electron.e2e.test.ts` and shared helpers in
`test/e2e/electron-e2e-helpers.ts` to:

- wait for renderer readiness markers (`#mount` populated + terminal UI
  selectors),
- capture and evaluate renderer console error events,
- fail on critical console errors,
- retain driver compatibility for `playwright` and `spawn`.

### 2. Deep lane implementation

Add:

- `playwright.e2e.config.ts` for Playwright Test under Node.js,
- `test/e2e-deep/terminal-input-path.e2e.ts` for the first mandatory
  interaction path.

The deep test validates:

- packaged app launch,
- renderer readiness,
- terminal input of a sentinel command,
- rendered terminal output includes the sentinel.

It captures and attaches:

- process stdout/stderr,
- renderer console logs,
- failure screenshot (plus Playwright trace/video configuration).

### 3. CI and policy wiring

Update `.github/workflows/nodejs.yml` to:

- add `schedule` and `workflow_dispatch` triggers,
- run fast-lane E2E in the existing multi-platform build job with
  `E2E_DRIVER=playwright`,
- add `e2e-deep-linux` job for scheduled/manual/master/canary validation,
- upload deep-lane artefacts from `test-results/e2e-deep/` and
  `playwright-report/e2e-deep/`.

### 4. Developer workflow updates

Update `docs/developers-guide.md` and `docs/testing-with-bun.md` to document:

- fast vs deep lane commands and purpose,
- Node-runner requirement for deep Playwright lane,
- manual trigger support,
- deep-lane release-blocking policy.

### 5. Roadmap tracking

Update `docs/roadmap.md` with a completed ADR-005 tracking entry under section
9.2.

## Validation and acceptance

Mandatory gates:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Documentation gates (docs changed):

- `bunx markdownlint-cli "docs/**/*.md"`
- `nixie --no-sandbox`

Feature-specific checks:

- `bun run test:e2e:fast`
- `bun run test:e2e:deep`

All command outputs are captured with `tee` logs under `/tmp/` using the
project/branch naming convention.

## Outcomes & retrospective

Implemented and validated:

- fast-lane renderer readiness checks and renderer console error capture,
- deep-lane Playwright Test scaffolding and interaction-path test suite,
- CI schedule/manual/deep-lane workflow wiring,
- roadmap and developer documentation updates,
- required repository quality gates.

Final outcome:

- Fast-lane and deep-lane E2E checks now both pass in this environment, and the
  previously surfaced packaged renderer startup failure has been resolved.
