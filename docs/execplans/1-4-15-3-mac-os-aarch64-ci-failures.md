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
- [ ] Implement Milestone 1 workflow updates.
- [x] (2026-02-24 18:39Z) Implemented Milestone 2 documentation updates:
  refreshed `docs/developers-guide.md` with CI Python/node-gyp virtual
  environment practice and marked the macOS aarch64 `1.4.15` roadmap sub-item
  done.
- [ ] Run required local gate stack and collect `/tmp` logs.
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

## Outcomes & retrospective

Implementation is in progress.

Current outcomes:

- Updated `docs/developers-guide.md` with the CI Python/node-gyp virtual
  environment bootstrap practice to avoid macOS PEP 668 failures.
- Updated `docs/roadmap.md` to mark the macOS aarch64 `1.4.15` sub-item as
  done while leaving Windows-related checklist items unchanged.
- Updated this ExecPlan status, progress, and decision records to reflect
  active implementation.

Remaining closure criteria:

- Record gate command outputs (pass/fail) and CI run evidence.
- Confirm macOS lane install/build/lint/test stability on `nodejs.yml`.
- Record any deferred follow-up items needed to prevent recurrence.
