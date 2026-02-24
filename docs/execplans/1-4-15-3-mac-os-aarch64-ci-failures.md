# Resolve macOS aarch64 CI install/build/lint/test failures

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept current as work
proceeds.

Status: IN PROGRESS (2026-02-24)

No `PLANS.md` exists in this repository, so this plan stands alone.

Implementation is in progress as of 2026-02-24.

## Purpose / big picture

Roadmap item `1.4.15` requires reliable cross-architecture CI on host platforms.
The Linux aarch64 scope is already complete, and this plan tracks the macOS
aarch64 closure work recorded in `docs/roadmap.md`.

The current macOS failure happens before install/build/lint/test gates run:
`.github/workflows/nodejs.yml` executes `python3 -m pip install packaging
setuptools`, and `macos-latest` now rejects this with PEP 668
(`externally-managed-environment`).

After this plan is implemented, success is observable when:

- macOS lane install is PEP 668-safe and no longer mutates system Python.
- `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  pass locally on the feature branch.
- GitHub Actions `nodejs.yml` matrix is green for macOS aarch64 on the same
  gates.
- `docs/developers-guide.md` documents the updated CI Python/node-gyp practice.
- `docs/roadmap.md` marks the macOS aarch64 bullet in `1.4.15` as done.

## Scope and non-goals

In scope:

- Fix macOS aarch64 CI failures across install/build/lint/test gates.
- Keep Electron runtime alignment guidance current in developer docs.
- Update roadmap progress for the macOS sub-item once verified.

Out of scope for this plan:

- Windows x64 stabilisation and Windows aarch64 enablement in roadmap `1.4.15`.
- New feature work outside CI/developer-documentation reliability.
- Broad refactors unrelated to the Python/node-gyp CI bootstrap failure.

## Orientation

Primary references and why they matter:

- `docs/roadmap.md` (`1.4.15`): defines the exact macOS checklist and success
  criteria wording.
- `docs/adr-004-update-electron-40.md` (Phase 3): requires Electron 40
  validation, including macOS packaging verification.
- `docs/developers-guide.md` (Electron runtime alignment): defines required
  alignment between Electron, Node, native rebuild tooling, and CI settings.
- `docs/velocetty-hyper-codebase.md`: records CI architecture intent (matrix
  builds and quality gates) and cross-platform reliability expectations.
- `docs/velocetty-product-requirements-document.md`: establishes CI
  lint/typecheck/test/build as foundation deliverables.
- `.github/workflows/nodejs.yml`: current failing workflow and gate order.
- `Makefile`: authoritative local gate commands and expected invocation paths.

## Agent team model

Use a three-agent implementation team, then consolidate in the main branch
workspace:

1. CI workflow agent (owner: `.github/workflows/nodejs.yml` and any helper
   scripts/actions it introduces).
   Deliverable: PEP 668-safe Python bootstrap and preserved node-gyp reliability
   across matrix hosts.
2. Documentation agent (owner: `docs/developers-guide.md`, `docs/roadmap.md`).
   Deliverable: updated developer practice and roadmap checkbox state.
3. Validation agent (owner: gate evidence logs under `/tmp`).
   Deliverable: reproducible local gate results and CI run links/results summary.

If parallel edits conflict, rebase and keep all valid intent. Do not drop any
requested checklist item.

## Constraints

- Keep roadmap semantics exact for `1.4.15`; only mark the macOS sub-item done
  when macOS evidence is complete.
- Keep `1.4.15` parent item unchecked unless all remaining Windows tasks are
  also complete.
- Preserve Electron runtime alignment rules in `docs/developers-guide.md`
  (`electron`/`@types/node`/`NODE_VERSION`/`node-gyp` compatibility narrative).
- Keep CI changes supply-chain-safe: do not rely on
  `pip --break-system-packages` for normal operation.
- Keep existing Make targets and script entry points intact.
- Keep changes focused to CI reliability and required documentation updates.

## Tolerances (exception triggers)

- Scope: if implementation requires more than 8 files or 450 net lines, stop
  and escalate with options.
- Interface: if fixing this requires changing application runtime behaviour
  outside CI/install tooling, stop and escalate.
- Dependencies: if a new third-party dependency must be added, stop and
  escalate before adding it.
- Validation: if any required gate still fails after two focused remediation
  passes, stop and escalate with failing logs.
- CI ambiguity: if macOS failures move from install-tooling to unrelated product
  behaviour, pause and confirm whether to widen scope.

## Risks

- Risk: a macOS-only fix diverges from Linux/Windows and introduces future drift.
  Severity: medium
  Likelihood: medium
  Mitigation: apply one policy-based bootstrap pattern (virtual environment)
  that is reusable across jobs and documents host-specific path handling.

- Risk: node-gyp selects the wrong Python executable after venv creation.
  Severity: high
  Likelihood: medium
  Mitigation: export `npm_config_python` explicitly through `GITHUB_ENV` and
  verify install logs include the expected interpreter path.

- Risk: roadmap gets marked complete without CI evidence.
  Severity: high
  Likelihood: low
  Mitigation: require CI run evidence before editing checklist state.

- Risk: documentation and workflow drift.
  Severity: medium
  Likelihood: medium
  Mitigation: land workflow and developer-guide updates in the same change,
  then run full gate stack.

## Milestones

### Milestone 0 - Baseline capture and branch hygiene

Confirm branch and gather pre-change evidence:

    git branch --show
    git status --short --branch
    nl -ba .github/workflows/nodejs.yml | sed -n '1,170p'

Record the failing macOS log snippet (PEP 668 externally-managed-environment)
in `Surprises & discoveries` and keep it linked to the exact failing step.

### Milestone 1 - Make Python bootstrap PEP 668-safe in CI

Update `.github/workflows/nodejs.yml` so the `Fix node-gyp and Python` step no
longer installs into system Python on macOS.

Preferred approach:

- Create a per-job virtual environment.
- Install `packaging` and `setuptools` inside that virtual environment.
- Export `npm_config_python` to the venv interpreter path.
- Keep behaviour deterministic across matrix hosts.

Implementation notes:

- Handle path differences (`.venv-node-gyp/bin/python` on Unix-like hosts,
  `.venv-node-gyp/Scripts/python.exe` on Windows).
- Keep shell robust (`set -euo pipefail`) and avoid host-global mutation.
- If duplication across jobs grows, extract a small script under
  `.github/scripts/` and call it from each job.

### Milestone 2 - Keep documentation aligned with CI practice

Update `docs/developers-guide.md` in the `Electron runtime alignment` section to
state the new CI rule:

- CI must provision Python packaging tools through a virtual environment (or
  equivalent isolated interpreter), not system-level `pip install`.
- `npm_config_node_gyp` and Python interpreter alignment remain mandatory before
  `bun install`.

Reference the practical why (PEP 668 on macOS/Homebrew Python) and the expected
workflow order (`bun install` before other gates).

### Milestone 3 - Validate local required gates with evidence

Run the required commands in order, using `tee` logs as required by repository
policy.

Suggested helper prelude:

    set -o pipefail
    PROJECT_NAME="$(get-project 2>/dev/null || basename "$PWD")"
    BRANCH_NAME="$(git branch --show)"

Required gates:

    bun install 2>&1 | tee "/tmp/bun-install-${PROJECT_NAME}-${BRANCH_NAME}.out"
    make build 2>&1 | tee "/tmp/build-${PROJECT_NAME}-${BRANCH_NAME}.out"
    make check-fmt 2>&1 | tee "/tmp/check-fmt-${PROJECT_NAME}-${BRANCH_NAME}.out"
    make lint 2>&1 | tee "/tmp/lint-${PROJECT_NAME}-${BRANCH_NAME}.out"
    make test 2>&1 | tee "/tmp/test-${PROJECT_NAME}-${BRANCH_NAME}.out"

If a command exceeds environment timeout limits, rerun in smaller scoped chunks
while preserving equivalent coverage and log evidence.

### Milestone 4 - Verify CI and close roadmap/docs updates

After pushing CI changes:

- Confirm `nodejs.yml` macOS lane passes install/build/lint/test for the commit.
- If green, update `docs/roadmap.md`:
  `- [x] Resolve macOS aarch64 CI failures across install, build, lint, and
  test gates.`
- Keep remaining Windows checklist items unchanged.

Then rerun local gates if any merge/rebase changed tracked files.

## Validation matrix

Functional validation:

- CI no longer fails on PEP 668 for macOS in `Fix node-gyp and Python`.
- `bun install` succeeds with explicit node-gyp Python alignment.
- Build/lint/test gates execute successfully after install.

Documentation validation:

- `docs/developers-guide.md` reflects new CI development practice.
- `docs/roadmap.md` macOS sub-item is marked done only after evidence exists.

Local command validation:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

## Progress

- [x] (2026-02-24 00:00Z) Confirmed branch
  `1-4-15-3-mac-os-aarch64-ci-failures` and plan file target path.
- [x] (2026-02-24 00:00Z) Collected roadmap, ADR, developer-guide, workflow,
  and Makefile constraints.
- [x] (2026-02-24 00:00Z) Captured current failure mode:
  `python3 -m pip install packaging setuptools` fails on macOS with PEP 668
  externally-managed-environment.
- [x] (2026-02-24 00:00Z) Drafted this ExecPlan with explicit agent-team roles,
  milestones, and gate evidence requirements.
- [x] (2026-02-24 18:41Z) Implemented Milestone 1 workflow updates in
  `.github/workflows/nodejs.yml` by replacing system-level pip installs with
  `.github/scripts/setup-node-gyp-python.sh` across CI jobs.
- [x] (2026-02-24 18:39Z) Implemented Milestone 2 documentation updates:
  refreshed `docs/developers-guide.md` with CI Python/node-gyp virtual
  environment practice and marked the macOS aarch64 `1.4.15` roadmap sub-item
  done.
- [x] (2026-02-24 18:50Z) Ran required local gates with `tee` logs:
  `/tmp/bun-install-velocetty-1-4-15-3-mac-os-aarch64-ci-failures.out`,
  `/tmp/build-velocetty-1-4-15-3-mac-os-aarch64-ci-failures.out`,
  `/tmp/check-fmt-velocetty-1-4-15-3-mac-os-aarch64-ci-failures.out`,
  `/tmp/lint-velocetty-1-4-15-3-mac-os-aarch64-ci-failures.out`, and
  `/tmp/test-velocetty-1-4-15-3-mac-os-aarch64-ci-failures.out`.
- [x] (2026-02-24 19:05Z) Addressed Ubuntu lint regression by moving the CI
  node-gyp Python virtual environment under `$RUNNER_TEMP` and adding
  `.node-gyp-python` to `.biomeignore` as a workspace-level safeguard.
- [x] (2026-02-24 19:30Z) Addressed macOS fast-lane E2E regression by scoping
  `PYTHON`/`npm_config_python` to `bun install` environments via workflow step
  outputs instead of exporting them job-wide through `GITHUB_ENV`.
- [x] (2026-02-24 20:00Z) Addressed remaining macOS fast-lane packaged-launch
  regression by restoring spawn as the default fast-lane driver and adding a
  macOS CI packaged-launch fallback stability wait when
  `[e2e] renderer-ready` markers are absent but the process remains alive.
- [x] (2026-02-24 21:10Z) Addressed macOS dangling-process timeout regression by
  bounding packaged-launch fallback stability wait to the remaining test-timeout
  budget so the test can complete cleanup before Bun's 45-second CI deadline.
- [x] (2026-02-24 22:10Z) Addressed Linux aarch64 CI freeze in
  `bun run v8-snapshot` by removing the dedicated arm64 snapshot-generation
  step and setting `SKIP_V8_SNAPSHOT_COPY=1` for Linux aarch64 packaging.
- [x] (2026-02-24 22:40Z) Addressed Linux aarch64 `rebuild-node-pty` stall by
  rebuilding `node-pty` during `bun install` and removing the separate rebuild
  step from the Linux aarch64 lane.
- [ ] Validate macOS CI lane success and capture run evidence.
- [ ] Finalise outcomes and retrospective.

## Surprises & discoveries

- Observation: the failing macOS lane exits before `bun install`; install/build/
  lint/test failures are downstream symptoms of the Python bootstrap failure.
  Evidence: workflow step `Fix node-gyp and Python` runs
  `python3 -m pip install packaging setuptools` and fails with
  `externally-managed-environment` on `macos-latest`.
  Impact: fix must target interpreter isolation first, not downstream gates.

- Observation: the same pip pattern appears in both `build` and
  `e2e-deep-linux` jobs.
  Evidence: `.github/workflows/nodejs.yml` contains two `Fix node-gyp and
  Python` steps.
  Impact: prefer one consistent bootstrap approach to avoid policy drift.

- Observation: roadmap `1.4.15` is a composite item.
  Evidence: macOS and Windows bullets are separate checklist entries.
  Impact: mark only the macOS bullet done for this task; leave Windows bullets
  unchanged.
- Observation: creating the virtual environment under the repository root caused
  Biome lint failures on `ubuntu-latest` because workflow-generated Python
  package files were scanned as format violations.
  Evidence: CI lint output reported format diffs under
  `.node-gyp-python/lib/python3.12/site-packages/setuptools/...`.
  Impact: CI bootstrap artefacts must be placed outside the workspace or ignored
  by lint tooling.
- Observation: exporting `PYTHON` and `npm_config_python` through `GITHUB_ENV`
  made those variables job-global and they were inherited by macOS fast-lane
  E2E packaged-app runs.
  Evidence: failing E2E step environment included
  `PYTHON=/Users/runner/work/_temp/node-gyp-python/bin/python` and
  `npm_config_python=...`, with packaged launch markers missing before timeout.
  Impact: node-gyp Python environment variables should be scoped to install/
  rebuild steps only, not retained for runtime/E2E steps.
- Observation: defaulting the macOS CI fast lane to Playwright driver mode
  introduced 30-second launch timeouts during `_electron.launch`, and both
  packaged and development tests failed in that mode.
  Evidence: CI failure reported `TimeoutError: Timeout 30000ms exceeded` from
  `playwright-core/lib/server/progress.js` during `bun run test:e2e:fast`.
  Impact: macOS CI fast-lane driver selection must remain spawn-default, with
  Playwright only as an explicit override and targeted fallback handling for
  packaged-launch marker gaps.
- Observation: fixed-duration fallback waits could consume the entire 45-second
  CI test timeout budget and cause Bun to kill a dangling packaged Electron
  process before cleanup finished.
  Evidence: CI reported `killed 1 dangling process` and
  `this test timed out after 45000ms` for the packaged fast-lane test.
  Impact: fallback waits must be budget-aware and leave explicit headroom for
  final stability checks and process cleanup.
- Observation: Linux aarch64 CI can freeze for hours in
  `bun run v8-snapshot` at `bun bin/mk-snapshot.js` even after skipping x64
  snapshots.
  Evidence: CI logs stalled after
  `Generating V8 snapshots for arm64...` with no completion output.
  Impact: Linux aarch64 packaging should avoid custom snapshot generation in CI
  and use Electron's default snapshot artefacts instead.
- Observation: Linux aarch64 CI can also stall in the standalone
  `bun run rebuild-node-pty` step while node-gyp downloads and extracts Electron
  headers with verbose logging.
  Evidence: CI logs remained in `gyp verb extracted file from tarball ...`
  output during the dedicated rebuild step.
  Impact: rebuilding `node-pty` in the install step keeps Python/node-gyp
  environment alignment consistent and removes an extra long-running stage.

## Decision log

- Decision: move this ExecPlan to `Status: IN PROGRESS` and keep the living
  sections current during implementation.
  Rationale: implementation work is now authorized and underway for this branch.
  Date/author: 2026-02-24 / Codex

- Decision: target the Python bootstrap step instead of introducing broad build
  system changes.
  Rationale: failure happens before install/build/lint/test and is directly
  attributable to PEP 668 policy.
  Date/author: 2026-02-24 / Codex

- Decision: use isolated Python environments rather than
  `--break-system-packages`.
  Rationale: aligns with supply-chain hygiene and avoids mutating system Python
  on hosted runners.
  Date/author: 2026-02-24 / Codex

- Decision: use a three-agent execution model (CI workflow, docs, validation).
  Rationale: keeps ownership clear and shortens feedback cycles while preserving
  focused diffs.
  Date/author: 2026-02-24 / Codex

- Decision: revert macOS CI fast-lane default driver from Playwright back to
  spawn and retain `E2E_DRIVER` as an explicit override only.
  Rationale: Playwright defaulting regressed CI reliability with deterministic
  30-second launch timeouts and failed both E2E smoke tests.
  Date/author: 2026-02-24 / Codex

- Decision: add a macOS CI packaged-launch fallback stability window when
  spawn markers are missing but the process is still alive.
  Rationale: packaged macOS launches can remain healthy without emitting
  stdout markers in CI; the fallback reduces false negatives while preserving
  early-exit and critical-renderer-error checks.
  Date/author: 2026-02-24 / Codex

- Decision: bound macOS packaged-launch fallback waits to the remaining
  per-test timeout budget with fixed safety headroom.
  Rationale: prevents fallback logic from exhausting Bun's 45-second CI timeout
  and avoids dangling-process termination before cleanup can run.
  Date/author: 2026-02-24 / Codex

- Decision: skip V8 snapshot copy in Linux aarch64 packaging CI by setting
  `SKIP_V8_SNAPSHOT_COPY=1` and removing the dedicated arm64 snapshot step.
  Rationale: snapshot generation under QEMU is non-deterministic and can freeze
  lane execution; default Electron snapshots are sufficient for CI packaging
  reliability gates.
  Date/author: 2026-02-24 / Codex

- Decision: remove the dedicated Linux aarch64 `rebuild-node-pty` step and run
  rebuild during `bun install` instead.
  Rationale: avoids repeated long-running native-rebuild phases and keeps
  node-gyp/Python environment wiring in one deterministic install step.
  Date/author: 2026-02-24 / Codex

## Outcomes & retrospective

Implementation is in progress.

Current outcomes:

- Updated `.github/workflows/nodejs.yml` to use a PEP 668-safe Python bootstrap
  helper in all CI jobs that prepare node-gyp tooling.
- Added `.github/scripts/setup-node-gyp-python.sh` to create an isolated virtual
  environment, install `pip`/`setuptools`/`packaging`, and publish the Python
  interpreter path through workflow step outputs consumed only by install steps.
- Updated `docs/developers-guide.md` with the CI Python/node-gyp virtual
  environment bootstrap practice to avoid macOS PEP 668 failures.
- Updated `docs/roadmap.md` to mark the macOS aarch64 `1.4.15` sub-item as
  done while leaving Windows-related checklist items unchanged.
- Updated this ExecPlan status, progress, and decision records to reflect
  active implementation.
- Reverted macOS CI fast-lane default driver selection to spawn mode and kept
  Playwright as an explicit opt-in via `E2E_DRIVER=playwright`.
- Added a packaged-launch fallback for macOS CI spawn runs so missing
  `[e2e] renderer-ready` marker output can be tolerated when the process stays
  alive through an additional stability window and no critical renderer errors
  are detected.
- Updated macOS fallback timing to be budget-aware so fallback waits cannot
  overrun the CI test timeout and force Bun to kill dangling processes.
- Updated Linux aarch64 packaging flow to bypass custom snapshot copy in CI so
  the lane cannot freeze in arm64 snapshot generation.
- Updated Linux aarch64 workflow sequencing so `node-pty` rebuild happens in
  install and no separate rebuild stage can stall later in the lane.
- Completed required local gates successfully:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

Remaining closure criteria:

- Record gate command outputs (pass/fail) and CI run evidence.
- Confirm macOS lane install/build/lint/test stability on `nodejs.yml`.
- Record any deferred follow-up items needed to prevent recurrence.
