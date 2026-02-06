# Architectural decision record (ADR) 005: enhance end-to-end testing strategy

## Status

Proposed (2026-02-05: Adopt a layered E2E strategy with fast pull request
checks and deeper scheduled coverage).

## Date

2026-02-05

## Context and problem statement

The current end-to-end (E2E) suite is intentionally narrow. It validates that
a packaged Electron binary can launch, and it can run in Playwright mode or
spawn mode, but it does not assert enough renderer behaviour after startup. As
a result, it is possible to pass E2E checks while still regressing critical
user-visible flows in the user interface (UI) layer.[^1]

Two competing needs must be balanced:

- Fast feedback on pull requests.
- Deeper behavioural confidence before releases.

Bun is now the default test runtime for unit and integration testing in this
repository, but deeper Playwright capabilities remain most reliable when run
with Playwright's own runner under Node.js.[^2][^3]
This ADR proposes a structured split that keeps pull request checks fast while
raising behavioural confidence in scheduled and release-time E2E runs.

## Decision drivers

- Improve confidence in renderer correctness, not only process launch.
- Keep pull request feedback loops fast and predictable.
- Preserve cross-platform packaged-build verification.
- Improve debuggability of E2E failures with consistent artefact capture.
- Align with existing Bun-first tooling while using Playwright where it is
  strongest.

## Requirements

### Functional requirements

- Verify packaged app launch behaviour on supported platforms.
- Verify renderer readiness and at least one interactive user path.
- Capture diagnostics on failure (logs and screenshots at minimum).

### Technical requirements

- Keep pull request E2E execution lightweight.
- Support deeper E2E checks in a separate lane without slowing every pull
  request.
- Maintain deterministic tests by extracting testable helper logic where
  practical.

## Options considered

### Option A: keep a smoke-only E2E suite

Retain only the current startup smoke checks in Bun. This is cheap to run, but
it provides limited confidence in renderer behaviour.

### Option B: expand all E2E checks inside the Bun test runner

Implement richer Playwright interactions while still running all E2E through
`bun test`. This keeps runtime consistency, but it risks weaker compatibility
with advanced Playwright features compared with Playwright's Node-first test
runner.[^4]

### Option C: layered strategy (recommended)

Use two E2E lanes:

- A fast pull request lane that keeps smoke checks and adds renderer readiness
  assertions.
- A deeper scheduled lane driven by Playwright's test runner under Node.js for
  richer interaction and diagnostics.

For screen readers: The following table compares trade-offs between the three
strategy options, including confidence, speed, and operational complexity.

| Topic | Option A | Option B | Option C |
| --- | --- | --- | --- |
| Pull request speed | Fast | Medium | Fast |
| Behavioural confidence | Low | Medium | High |
| Playwright feature reliability | Low | Medium | High |
| Operational complexity | Low | Medium | Medium |
| Failure diagnostics quality | Low | Medium | High |

_Table 1: Trade-offs across E2E strategy options._

## Decision outcome / proposed direction

Adopt Option C. Implement a layered E2E strategy that keeps a fast lane for
pull requests and a deeper lane for scheduled or release validation.

The proposed direction is:

- Keep Bun-driven packaged-app smoke checks.
- Add renderer-readiness assertions to the fast lane.
- Add interaction-path E2E tests in a Playwright Node-runner lane.
- Standardize failure artefacts (stdout, stderr, renderer console, screenshot,
  and Playwright traces where available).

## Goals and non-goals

### Goals

- Catch regressions where the app launches, but the renderer is not usable.
- Validate at least one user interaction flow end-to-end.
- Preserve quick pull request signal while improving release confidence.

### Non-goals

- Replacing Bun as the default unit and integration runner.
- Building exhaustive UI E2E coverage for every surface in one iteration.
- Refactoring unrelated runtime architecture to support E2E.

## Migration plan

### Phase 1: fast-lane hardening

- Extend the existing E2E smoke check to assert renderer readiness.
- Fail on critical renderer console errors during startup.
- Preserve `E2E_DRIVER=spawn|playwright` compatibility in the fast lane.

### Phase 2: deeper behavioural lane

- Add Playwright-runner suites under a dedicated command and CI job.
- Cover at least one interaction path, such as opening a tab or invoking a
  command flow.
- Record structured artefacts (screenshots, logs, and traces) on failures.

### Phase 3: CI policy and governance

- Keep fast-lane checks required for pull requests.
- Run deeper lane on a schedule and before release cut branches.
- Reassess scope quarterly and expand high-value paths incrementally.

## Known risks and limitations

- Additional CI jobs increase infrastructure cost and maintenance burden.
- Interaction-path tests can become flaky without careful selector strategy and
  deterministic waits.
- Cross-platform packaged builds still introduce environment-specific variance.

## Outstanding decisions

- Which interaction flow should be the first required deep-lane scenario?
- Whether deep-lane failures should block releases immediately or operate as a
  temporary warning gate.
- Which artefacts are mandatory in Continuous Integration (CI) retention
  policies?

## Architectural rationale

This direction aligns with Velocetty's Bun-first development workflow, while
acknowledging that Playwright's deeper browser automation features are best
supported in Playwright's own runner. The layered approach improves confidence
where risk is highest, without forcing every pull request through a slow,
high-variance E2E path.[^2][^3]

[^1]: [Developers' guide](developers-guide.md)
[^2]: <https://bun.com/docs/test>
[^3]: <https://playwright.dev/docs/test-intro>
[^4]: <https://www.browserstack.com/guide/bun-playwright>
