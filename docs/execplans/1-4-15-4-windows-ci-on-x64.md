# Stabilize Windows x64 CI and resolve Windows aarch64 lane feasibility

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept current as work
proceeds.

Status: DONE (2026-02-25)

No `PLANS.md` exists in this repository, so this plan stands alone.

Implementation is complete in this turn, including workflow stabilization,
documentation updates, roadmap closure, and CI verification evidence.

## Purpose / big picture

Roadmap item `1.4.15` requires cross-architecture CI reliability for host
platforms. Linux aarch64 and macOS aarch64 sub-items are already marked done.
The remaining scope is:

- Stabilize Windows CI on x64.
- Add a Windows aarch64 lane if runner and toolchain support is available.
- If Windows aarch64 is not available, document the blocker and create a
  tracked follow-up item with explicit ownership.

Success is observable when:

- `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  pass on the implementation branch with `tee` logs.
- `nodejs.yml` is green for Windows x64.
- Windows aarch64 is either running in CI or explicitly tracked as blocked with
  a mitigation path and named owner.
- `docs/developers-guide.md` reflects any changed developer practice.
- `docs/roadmap.md` marks the relevant `1.4.15` entries done.

## Scope and non-goals

In scope:

- Workflow and script updates needed to make Windows x64 CI deterministic.
- Windows aarch64 feasibility testing and either lane enablement or blocker
  tracking.
- Documentation updates in `docs/developers-guide.md` and
  `docs/tracking-issues.md` as required by the chosen path.
- Roadmap checkbox updates in `docs/roadmap.md` when evidence is complete.

Out of scope:

- Reopening Linux aarch64 or macOS aarch64 implementation unless a shared fix
  is strictly required for Windows reliability.
- New product features unrelated to CI/release reliability.

## Context and orientation

Primary files and why they matter:

- `docs/roadmap.md` (`1.4.15`): exact Windows checklist and success criteria.
- `docs/adr-004-update-electron-40.md` (Phase 3): Electron 40 validation
  guardrail.
- `docs/developers-guide.md` (`Electron runtime alignment`): required runtime,
  Node, and native-module alignment, plus existing Linux/macOS CI baselines.
- `.github/workflows/nodejs.yml`: current matrix contains `windows-latest` and
  Linux aarch64, but no Windows aarch64 lane.
- `.github/actions/build-packaged-app/action.yml`: packaging entry point used in
  CI; must remain supply-chain-safe.
- `electron-builder.json`: Windows target already lists `x64` and `arm64`,
  which supports a Windows aarch64 packaging lane once CI/runtime support
  exists.
- `docs/tracking-issues.md`: canonical place for blocker follow-up items with
  explicit status and ownership.
- `docs/velocetty-design.md`, `docs/velocetty-hyper-codebase.md`, and
  `docs/velocetty-product-requirements-document.md`: architecture and quality
  rationale that CI lanes must satisfy.

## Constraints

- Keep roadmap semantics exact for `1.4.15`; do not mark an item done before
  evidence exists.
- Keep Electron runtime alignment coherent (`electron`, `@types/node`, CI
  `NODE_VERSION`, node-gyp/Python wiring) when touching CI install flow.
- Preserve supply-chain hygiene: pin Actions by SHA, avoid ad hoc remote
  installers, and keep native rebuild tool paths deterministic.
- Keep `Makefile` targets and existing entry points (`make build`, `make lint`,
  `make test`) intact.
- Do not mark the parent `1.4.15` item done until Windows bullets and success
  criteria are satisfied.
- Use en-GB-oxendict spelling and 80-column Markdown wrapping.

## Tolerances (exception triggers)

- Scope: if implementation needs more than 10 files or 550 net lines, stop and
  escalate with options.
- Interface: if application runtime behaviour must change outside CI/release
  tooling to stabilize Windows x64, stop and escalate.
- Dependencies: if a new third-party dependency is required, stop and escalate
  before adding it.
- Validation: if required local gates fail after two focused remediation passes,
  stop and escalate with failing logs.
- Feasibility ambiguity: if Windows aarch64 support cannot be proven supported
  or blocked with concrete evidence, stop and escalate before updating roadmap
  checkboxes.

## Risks

- Risk: Windows x64 failures are intermittent (native rebuild, signing, or E2E)
  and difficult to reproduce locally.
  Severity: high
  Likelihood: medium
  Mitigation: capture failing CI logs first, then implement narrow fixes and
  rerun targeted Windows workflows before broad changes.

- Risk: Windows aarch64 hosted runner/toolchain support is unavailable in this
  repository context.
  Severity: high
  Likelihood: high
  Mitigation: run a feasibility probe, capture hard evidence, and document the
  blocker with a tracked follow-up and explicit owner.

- Risk: roadmap closure without ownership on blocker follow-up.
  Severity: high
  Likelihood: medium
  Mitigation: require non-TBD owner in `docs/tracking-issues.md` before marking
  blocker handling done.

- Risk: Windows lane changes regress Linux/macOS behaviour.
  Severity: medium
  Likelihood: medium
  Mitigation: keep edits scoped to Windows-specific conditions and rerun the
  full required local gate stack.

## Plan of work

### Stage A: Baseline and failure capture (no code changes)

- Confirm branch and working tree state.
- Capture latest Windows x64 CI failures from `nodejs.yml` and isolate failing
  step(s): install, build, lint, test, packaging, or E2E.
- Confirm current absence of Windows aarch64 lane in workflow.
- Record evidence in `Surprises & discoveries`.

Go/no-go gate:

- Proceed only when at least one concrete Windows x64 failure signature (or a
  confirmed flaky pattern with run IDs) is documented.

### Stage B: Stabilize Windows x64 lane

- Apply focused fixes in `.github/workflows/nodejs.yml` and/or helper scripts.
- Keep `bun install` first for native-module validation, with deterministic
  `PYTHON`, `npm_config_python`, and `npm_config_node_gyp` wiring where needed.
- Keep Windows-specific changes guarded by `runner.os == 'Windows'` unless a
  shared fix is required.
- Re-run CI to verify Windows x64 lane green.

Go/no-go gate:

- Proceed only when Windows x64 is green in CI for the implementation commit.

### Stage C: Windows aarch64 feasibility branch

Path A (supported):

- Add a Windows aarch64 lane (dedicated job or matrix include).
- Ensure install/build/lint/test behaviour is equivalent to other host lanes.
- Ensure packaging target and artefact naming are unambiguous for arm64.
- Verify CI success and capture evidence.

Path B (blocked):

- Capture blocker evidence (runner unavailability, missing toolchain support,
  or unrecoverable infrastructure limitation).
- Update `docs/developers-guide.md` with Windows aarch64 blocker context and
  mitigation path.
- Add a tracked issue in `docs/tracking-issues.md` with:
  - status,
  - explicit owner (not `TBD`),
  - mitigation/exit criteria,
  - link to issue ticket if available.

Go/no-go gate:

- Continue to Stage D only when Path A or Path B is fully evidenced.

### Stage D: Documentation and roadmap closure

- Update `docs/developers-guide.md` under Electron runtime alignment with
  Windows baseline changes introduced by this work.
- Update `docs/roadmap.md` under `1.4.15`:
  - mark Windows x64 stabilization line done,
  - mark blocker-documentation line done when applicable,
  - mark success-criteria line done once all criteria are evidenced.
- Keep wording aligned with the existing roadmap style.

### Stage E: Validation and closure evidence

- Run required local gates with `tee` log files.
- Confirm CI outcomes for changed lanes.
- Update this ExecPlan sections (`Progress`, `Decision log`,
  `Outcomes & retrospective`) and set status accordingly.

## Concrete steps

Run from the repository root.

1. Baseline commands:

```bash
git branch --show
git status --short --branch
nl -ba .github/workflows/nodejs.yml | sed -n '1,280p'
```

Expected baseline signal:

```plaintext
Current branch is the task branch; workflow shows windows-latest in matrix and
no Windows aarch64 lane.
```

1. Recommended CI evidence collection (if `gh` is available):

```bash
gh run list --workflow nodejs.yml --limit 20
gh run view <run-id> --log-failed
```

Fallback: gather the same evidence from the GitHub Actions web UI.

1. Required local gates with repository log naming convention:

```bash
set -o pipefail
PROJECT_NAME="$(get-project 2>/dev/null || basename "$PWD")"
BRANCH_NAME="$(git branch --show)"
BRANCH_SAFE="$(printf '%s' "$BRANCH_NAME" | tr '/:' '--')"

bun install 2>&1 | tee "/tmp/install-${PROJECT_NAME}-${BRANCH_SAFE}.out"
make build 2>&1 | tee "/tmp/build-${PROJECT_NAME}-${BRANCH_SAFE}.out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-${PROJECT_NAME}-${BRANCH_SAFE}.out"
make lint 2>&1 | tee "/tmp/lint-${PROJECT_NAME}-${BRANCH_SAFE}.out"
make test 2>&1 | tee "/tmp/test-${PROJECT_NAME}-${BRANCH_SAFE}.out"
```

Expected gate signal:

```plaintext
All five commands exit 0; logs exist under /tmp with the branch-safe names.
```

## Validation and acceptance

Functional acceptance:

- Windows x64 CI lane passes install/build/lint/test for the implementation
  commit.
- Windows aarch64 outcome is complete through one of:
  - lane enabled and green, or
  - documented blocker with tracked follow-up and explicit owner.

Documentation acceptance:

- `docs/developers-guide.md` reflects changed Windows CI/runtime practice.
- `docs/tracking-issues.md` contains a Windows aarch64 follow-up item with a
  named owner when blocked.
- `docs/roadmap.md` `1.4.15` checklist state matches actual evidence.

Command acceptance:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

## Idempotence and recovery

- Workflow and docs edits are idempotent and safe to reapply.
- If a CI run fails, capture run ID and failing step, patch minimally, and rerun
  only affected lanes before rerunning full validation.
- If a blocker path is chosen, do not partially mark roadmap success criteria;
  first land tracking documentation with explicit ownership.
- If branch drift occurs, `git pull --rebase`, re-run required gates, and
  refresh roadmap/doc status based on latest evidence.

## Interfaces and dependencies

Files expected to change during implementation:

- `.github/workflows/nodejs.yml` (Windows lane stability and optional aarch64
  lane wiring).
- Optional `.github/scripts/*` helper(s) only if required for deterministic
  Windows setup.
- `docs/developers-guide.md` (Windows CI/runtime baseline updates).
- `docs/tracking-issues.md` (Windows aarch64 blocker follow-up when needed).
- `docs/roadmap.md` (`1.4.15` checklist updates).

Dependencies and contracts to preserve:

- Existing Bun and Node baselines in CI (`NODE_VERSION`, `bun-version`).
- `make` gate contract and existing workflow step order.
- Action pinning by commit SHA for supply-chain hygiene.

## Progress

- [x] (2026-02-25 15:40Z) Confirmed branch
  `1-4-15-4-windows-ci-on-x64-md` and clean working tree.
- [x] (2026-02-25 15:40Z) Collected roadmap, ADR, developers-guide, workflow,
  Makefile, and architecture references for `1.4.15` Windows scope.
- [x] (2026-02-25 15:40Z) Ran a planning agent team (requirements, CI state,
  documentation impact) and consolidated findings into this ExecPlan.
- [x] (2026-02-25 15:40Z) Drafted this ExecPlan at the user-requested path.
- [x] (2026-02-25 16:13Z) Moved this plan to in-progress execution status.
- [x] (2026-02-25 16:13Z) Captured Bun release evidence for Windows aarch64
  feasibility: latest release `bun-v1.3.9` (published 2026-02-08) includes
  `bun-windows-x64*` assets and no Windows arm64 asset.
- [x] (2026-02-25) Captured Windows CI failure run `22405749378`: step
  `Install (Windows)` failed during `bun install` with
  `Executable not found in $PATH: "node-gyp.cmd"`.
- [x] (2026-02-25) Captured a second Windows native rebuild failure signature:
  node-gyp header tar extraction `EINVAL` when `bin/rebuild-node-pty.cjs`
  launches node-gyp using Bun `process.execPath`.
- [x] (2026-02-25) Captured CI run `22408893713` after the Node-runtime patch:
  `Install (Windows)` progressed past `rebuild-node-pty`, but
  `Run Makefile lint and unit-test gates` failed on CRLF-formatted JSON files.
- [x] (2026-02-25) Captured CI run `22409492277`: Windows lint still failed on
  CRLF conversion for `.cjs`, `.mjs`, and `.jsonc` files; Ubuntu test failures
  were traced to non-deterministic Electron mock ordering in Bun unit tests.
- [x] (2026-02-25) Captured PR run `22410017452` with all required lanes green
  (`build (windows-latest)`, `build (ubuntu-latest)`, `build (macos-latest)`,
  and `build-linux-aarch64`).
- [x] Implement Stage B Windows x64 stabilization.
- [x] Implement Stage C Windows aarch64 supported-or-blocked path (Path B:
  documented blocker with explicit ownership).
- [x] Update docs and roadmap based on evidence.
- [x] (2026-02-25) Ran required local gates and collected logs:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  using `/tmp/*-velocetty-1-4-15-4-windows-ci-on-x64-md.out`.
- [x] Finalize outcomes and retrospective.

## Surprises & discoveries

- Observation: the current CI matrix includes `windows-latest` plus Linux/macOS,
  and has a dedicated Linux aarch64 job, but no Windows aarch64 lane.
  Evidence: `.github/workflows/nodejs.yml` matrix and jobs.
  Impact: Windows aarch64 needs an explicit decision branch (enable or track
  blocker), not just a routine matrix tweak.

- Observation: packaging configuration already includes Windows `x64` and
  `arm64` targets.
  Evidence: `electron-builder.json` Windows target arch list.
  Impact: packaging config is not the main blocker; runner/toolchain feasibility
  is the critical gate.

- Observation: current Windows CI install reliability uses a dedicated Windows
  temp directory and explicit node-gyp path wiring.
  Evidence: `.github/workflows/nodejs.yml` Windows-only install preparation and
  `npm_config_node_gyp`/`TMP`/`TEMP`/`npm_config_tmp` environment settings.
  Impact: these constraints must be documented as the Windows x64 baseline to
  prevent regression from shared cross-OS simplifications.

- Observation: a new Windows x64 install failure mode appeared in CI run
  `22405749378` on 2026-02-25.
  Evidence: `Install (Windows)` failed in `bun install` with
  `Executable not found in $PATH: "node-gyp.cmd"` during native rebuild.
  Impact: Stage B needs an extra Windows-specific pre-install bootstrap that
  installs a pinned workspace `node-gyp` package and prepends
  `node_modules/.bin` so `node-gyp.cmd` resolves on `PATH`.

- Observation: replacing the bootstrap with `npm install` regressed in CI run
  `22406276433` on 2026-02-25.
  Evidence: `Install (Windows)` failed before `bun install` with
  `npm error Override without name: @electron/rebuild>node-gyp`.
  Impact: Stage B must keep the bootstrap on Bun tooling (`bun add --no-save`)
  to avoid npm override resolution failures in this repository.

- Observation: Bun bootstrap alone still regressed in CI run `22406525103` on
  2026-02-25.
  Evidence: `bun add --no-save --ignore-scripts node-gyp@10.3.1` succeeded, but
  `Install (Windows)` still failed before `bun install` because
  `node_modules/.bin/node-gyp.cmd` was missing.
  Impact: Stage B needs an explicit Windows `node-gyp.cmd` shim after Bun
  bootstrap so native rebuild helpers that spawn `node-gyp.cmd` can resolve.

- Observation: the first launcher-shim attempt regressed in CI run
  `22407440178` on 2026-02-25.
  Evidence: `Install (Windows)` failed with
  `"printf: '~': invalid format character"` when writing `%~dp0` in the batch
  file template.
  Impact: Stage B needs literal-string `printf` arguments (or escaped `%`)
  while generating `node-gyp.cmd`.

- Observation: latest Bun upstream release does not provide a Windows arm64
  runtime artefact.
  Evidence: GitHub API query to `oven-sh/bun` latest release on 2026-02-25:
  `bun-v1.3.9` (published 2026-02-08) lists `bun-windows-x64*` assets and no
  Windows arm64 asset.
  Impact: Windows aarch64 lane enablement remains blocked in this repository
  until Bun publishes an arm64 Windows artefact and setup support.

- Observation: `bin/rebuild-node-pty.cjs` used Bun `process.execPath` to run
  node-gyp whenever CI invoked the script with Bun.
  Evidence: script implementation and Windows CI `node-gyp` header extraction
  failures with tar `EINVAL` during Bun-driven rebuild execution.
  Impact: Windows reliability requires launching node-gyp with a Node runtime
  binary (`NODE` env override or `node` from `PATH`), while keeping existing
  node-gyp arguments unchanged.

- Observation: CI rerun `22407832513` changed failure signatures before the
  Node-runtime patch reached CI.
  Evidence: Windows advanced past `install-app-deps` but failed in
  `rebuild-node-pty` with node-gyp tar extraction `EINVAL`; Ubuntu failed in
  `make test` with Electron import/environment errors.
  Impact: this branch needed a deterministic node-gyp runtime fix and a fresh
  post-push CI rerun for final Stage B verification evidence.

- Observation: post-patch CI run `22408893713` still failed Windows in the lint
  phase due JSON line-ending drift.
  Evidence: `Run Makefile lint and unit-test gates` reported Biome formatter
  diffs where repository JSON files were checked out with CRLF (`␍`) on
  Windows.
  Impact: Stage B also requires repository-level JSON EOL normalization so
  Windows checkout line endings do not create formatting-only failures.

- Observation: CI run `22409492277` still failed the Windows lint phase after
  JSON-only normalization.
  Evidence: failed formatter files were `.markdownlint-cli2.jsonc`, multiple
  `bin/*.cjs`, and `scripts/*.mjs`, all showing CRLF (`␍`) diffs.
  Impact: Stage B needs LF normalization widened to the full script/config
  extension set checked by Biome, not JSON alone.

- Observation: Ubuntu failures in run `22409492277` were test-order dependent,
  not platform-native-module regressions.
  Evidence: `runtime-plugin-settings.test.ts` fails when run alone with
  `TypeError: Not running in an Electron environment!`; full-suite runs can
  pass when earlier files leave Electron mocks registered.
  Impact: Stage B stabilization needs deterministic Electron mock registration
  in unit tests so Linux CI does not depend on file ordering or prior mocks.

- Observation: `registerElectronMock()` used an internal `isRegistered` guard
  that survived `mock.restore()` calls from other test files.
  Evidence: Bun `mock.restore()` clears module mocks globally, but the helper's
  guard prevented re-registering Electron later in the same process.
  Impact: suites that call `registerElectronMock()` after a restore can fail
  with `app`/`ipcMain` export errors unless the helper always re-registers.

## Decision log

- Decision: move this ExecPlan to `Status: IN PROGRESS` and execute the
  documentation path now.
  Rationale: implementation for this branch is underway, scoped to docs updates
  requested in-thread.
  Date/Author: 2026-02-25 / Codex

- Decision: structure implementation as a two-path Windows aarch64 branch
  (supported vs blocked).
  Rationale: roadmap requires either operational lane or explicit blocker
  tracking with ownership.
  Date/Author: 2026-02-25 / Codex

- Decision: require explicit non-TBD owner for blocker follow-up.
  Rationale: roadmap text requires explicit ownership for blocked Windows
  aarch64.
  Date/Author: 2026-02-25 / Codex

- Decision: select Stage C Path B (blocked) for Windows aarch64 in this turn.
  Rationale: latest Bun release evidence confirms no Windows arm64 runtime
  artefact, so lane enablement cannot be completed without upstream support.
  Date/Author: 2026-02-25 / Codex

- Decision: defer local gates until workflow and documentation edits are
  reconciled in one validation pass.
  Rationale: running the full gate stack once at the end provides a single
  evidence set aligned to the final diff.
  Date/Author: 2026-02-25 / Codex

- Decision: remediate run `22405749378` by adding a Windows-only bootstrap step
  that installs a pinned workspace `node-gyp` package before `bun install`.
  Rationale: the failed `Install (Windows)` step shows `node-gyp.cmd` is not
  guaranteed to exist on `PATH` during native rebuild.
  Date/Author: 2026-02-25 / Codex

- Decision: implement the Windows bootstrap with
  `bun add --no-save --ignore-scripts node-gyp@10.3.1`, not `npm install`.
  Rationale: CI run `22406276433` proves npm bootstrap fails on the repository
  override graph before the install lane starts.
  Date/Author: 2026-02-25 / Codex

- Decision: after Bun bootstrap, generate `node_modules/.bin/node-gyp.cmd`
  when it is absent and point it at `..\node-gyp\bin\node-gyp.js`.
  Rationale: CI run `22406525103` shows Bun can install `node-gyp` without the
  `.cmd` launcher expected by Windows native rebuild scripts.
  Date/Author: 2026-02-25 / Codex

- Decision: generate the Windows launcher via
  `printf '%s\r\n' ...` literal lines instead of `%`-formatted templates.
  Rationale: CI run `22407440178` failed because `%~dp0` was parsed as a format
  sequence by `printf`.
  Date/Author: 2026-02-25 / Codex

- Decision: in `bin/rebuild-node-pty.cjs`, run node-gyp through the Node
  executable (`process.env.NODE || 'node'`) instead of `process.execPath`.
  Rationale: CI invokes this script via Bun; Bun-driven node-gyp execution on
  Windows can fail in header tar extraction with `EINVAL`.
  Date/Author: 2026-02-25 / Codex

- Decision: enforce `*.json text eol=lf` in `.gitattributes`.
  Rationale: CI run `22408893713` shows Windows checkout line-ending conversion
  can trigger formatting failures unrelated to functional changes.
  Date/Author: 2026-02-25 / Codex

- Decision: expand LF enforcement in `.gitattributes` to include
  `*.jsonc`, `*.cjs`, and `*.mjs` alongside existing JS/TS/JSON rules.
  Rationale: CI run `22409492277` shows Windows lint failures in those
  extensions after JSON-only normalization.
  Date/Author: 2026-02-25 / Codex

- Decision: make `registerElectronMock()` always register mocks and remove the
  stale in-memory registration guard.
  Rationale: `mock.restore()` clears mocks process-wide; the prior guard made
  later re-registration attempts no-op and caused order-dependent failures.
  Date/Author: 2026-02-25 / Codex

- Decision: load `app/runtime/plugin-runtime` in
  `runtime-plugin-settings.test.ts` only after registering the Electron mock.
  Rationale: that module imports `app/config/paths` at module init time and can
  fail outside Electron unless the mock is active first.
  Date/Author: 2026-02-25 / Codex

## Outcomes & retrospective

Implementation is complete.

Current outcomes:

- Updated `docs/developers-guide.md` with the Windows x64 CI stabilization
  baseline (Windows-specific node-gyp Python/bootstrap and temp-directory
  wiring).
- Updated `bin/rebuild-node-pty.cjs` to execute node-gyp with the Node runtime
  (`NODE` override or `node` on `PATH`) instead of Bun `process.execPath`.
- Added a Windows runtime-alignment note in `docs/developers-guide.md` for this
  Node runtime-selection requirement in `rebuild-node-pty`.
- Updated `.gitattributes` to enforce LF for script/config extensions used by
  Biome (`*.json`, `*.jsonc`, `*.js`, `*.cjs`, `*.mjs`, `*.ts`, `*.tsx`) and
  documented this as part of the Windows reliability baseline.
- Updated `test/testUtils/electron-path.ts` so `registerElectronMock()` can
  re-register Electron after any `mock.restore()` call in the same Bun
  process.
- Updated `test/unit/runtime-plugin-settings.test.ts` to register Electron
  mocks before importing `app/runtime/plugin-runtime`, removing test-order
  coupling in Linux CI.
- Added `WINARM64-001` to `docs/tracking-issues.md` with explicit ownership
  (`@leynos`), blocker context, and mitigation/exit criteria.
- Updated `docs/roadmap.md` item `1.4.15` to mark Windows x64 stabilization,
  blocker documentation, and success criteria complete with tracked blocker
  reference.
- Recorded Bun upstream blocker evidence in this plan:
  `bun-v1.3.9` (2026-02-08) has no Windows arm64 artefact.
- Completed the required local quality-gate stack for this task:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

Closure evidence:

- PR run `22410017452` completed successfully on 2026-02-25 with all required
  host-platform lanes green, including Windows x64.
- Required local gates passed on this branch:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Revision note

- 2026-02-25: Initial draft created from roadmap `1.4.15`, ADR-004 Phase 3,
  developers-guide runtime alignment guidance, and current CI/workflow state.
  Remaining work is implementation and verification after explicit approval.
- 2026-02-25: Moved to in-progress implementation, recorded Bun Windows arm64
  blocker evidence, updated developer/tracking/roadmap docs for Stage C Path B,
  and queued one full validation pass after workflow reconciliation.
- 2026-02-25: Recorded CI run `22405749378` (`Install (Windows)` failure:
  `Executable not found in $PATH: "node-gyp.cmd"`) and set Stage B remediation
  direction to bootstrap a pinned workspace `node-gyp` package and
  `node_modules/.bin` `PATH` override before Windows `bun install`.
- 2026-02-25: Recorded CI run `22406276433` (`Install (Windows)` npm bootstrap
  failure: `Override without name: @electron/rebuild>node-gyp`) and switched
  the bootstrap command to
  `bun add --no-save --ignore-scripts node-gyp@10.3.1`.
- 2026-02-25: Recorded CI run `22406525103` (Bun bootstrap succeeded but
  `node-gyp.cmd` missing), and added a Windows launcher shim step for
  `node_modules/.bin/node-gyp.cmd` before `bun install`.
- 2026-02-25: Recorded CI run `22407440178` (`printf` format parsing on `%~dp0`)
  and switched launcher generation to literal-line `printf '%s\r\n'` output.
- 2026-02-25: Recorded the Windows `node-gyp` tar `EINVAL` discovery and
  decided to launch node-gyp from `bin/rebuild-node-pty.cjs` with Node
  (`process.env.NODE || 'node'`) instead of Bun `process.execPath`.
- 2026-02-25: Completed local gate verification with
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  (logs under `/tmp/*-velocetty-1-4-15-4-windows-ci-on-x64-md.out`).
- 2026-02-25: Captured PR run `22408893713` where Windows advanced through
  `Install (Windows)` after the Node-runtime fix and then failed on CRLF JSON
  formatting diffs; added `*.json text eol=lf` to `.gitattributes`.
- 2026-02-25: Captured PR run `22409492277` where Windows still failed lint on
  CRLF in `.jsonc`/`.cjs`/`.mjs` files and Ubuntu exposed order-dependent
  Electron mock failures; expanded `.gitattributes` LF rules and hardened
  Electron test mock registration.
- 2026-02-25: Captured PR run `22410017452` with all primary host-platform CI
  lanes green and marked Stage B/retrospective closure complete.
