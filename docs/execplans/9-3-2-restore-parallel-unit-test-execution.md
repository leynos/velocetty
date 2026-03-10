# Restore parallel unit-test execution (roadmap 9.3.2)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Roadmap item `9.3.2` exists because roadmap item `9.3.1` fixed the worst
cross-suite global-state leaks, but the repository still keeps the default Bun
unit-test path serialized with `--max-concurrency=1`. That guardrail was a
deliberate temporary safety belt while the isolation work was landing. It is
not the target steady state described by `docs/roadmap.md`.

After this work, a developer should be able to run the normal local and CI test
gates and get the repository's intended Bun parallel unit-test behaviour
without cross-file interference, timeout regressions, or a second hidden
serial path in the default scripts. The first implementation task is to verify
whether that target mode is Bun's no-flag default in `1.3.8` or an explicit
`--concurrent` default without `--max-concurrency=1`. The observable success
conditions are:

1. Default unit-test entry points no longer pin `--max-concurrency=1` in
   `package.json`, `Makefile`, or the default CI lane, and they are explicit
   about whether parallelism comes from Bun's no-flag behaviour or from an
   intentional `--concurrent` repository default.
2. CI and local default test gates run the shared unit suite with Bun's default
   concurrency policy for this repository and pass without file-order or
   cross-file interference failures.
3. The repository still provides an explicit, non-default reproduction path for
   seeded or serialized flake hunting when needed.
4. `docs/developers-guide.md` documents the new default workflow and any
   retained diagnostic commands, and any related Bun-testing guidance stays
   accurate.
5. `docs/roadmap.md` marks `9.3.2` done only after `bun install`,
   `make build`, `make check-fmt`, `make lint`, and `make test` all pass, with
   additional concurrency-focused stress runs captured in log files.

## Repository orientation

The default unit-test concurrency policy is currently controlled from a small
set of files:

- `package.json` defines `test:unit:run`,
  `test:unit:shuffled`, and `test:unit:shuffled:watch` with
  `--max-concurrency=1`.
- `Makefile` routes `make test` through `bun run test:unit:run`, so any
  serialization in the script affects both local defaults and CI.
- `.github/workflows/nodejs.yml` runs `make lint` and `make test` in the main
  CI matrix, so it inherits the same default behaviour instead of passing Bun
  concurrency flags directly.
- `docs/developers-guide.md` currently teaches the post-`9.3.1` workflow as a
  serialized default with seeded serialized reruns.
- `docs/testing-with-bun.md` explains Bun's concurrency model and may need a
  targeted wording update if repository guidance currently implies that the
  default local gate is intentionally serialized.

The highest-risk code for this milestone is not the scripts themselves. It is
the set of unit-test helpers and suites that still mutate shared globals, rely
on `mock.module(...)`, or take exclusive ownership of DOM-like globals:

- `test/testUtils/happy-dom.ts`
- `test/testUtils/global-window.ts`
- `test/unit/runtime-tab-provider-registration.test.ts`
- `test/unit/hyper-transport.test.ts`
- `test/unit/hyper-effects.test.ts`
- `test/unit/notification.test.ts`
- `test/unit/tabs-decoration-updates.test.ts`
- `test/unit/term-report-renderer.test.ts`
- `test/unit/updater.test.ts`
- `test/unit/command-registry-compat.test.ts`
- `test/unit/config-import-json5.test.ts`
- other suites that reassign `globalThis` timers, `window`, `document`, or
  `navigator`, or that depend on `mock.restore()` for cleanup

Roadmap item `9.3.1` already established an important baseline: renderer
bootstrap assertions now run through dependency-injected seams rather than a
dedicated bootstrap quarantine, and `setupHappyDom()` already serializes its
global setup/teardown internally. This plan builds on that baseline rather than
re-solving the earlier isolation problem.

## Constraints

- Keep this milestone scoped to restoring parallel execution in default unit
  test gates after the `9.3.1` hardening. Do not fold in unrelated test,
  renderer, or architecture refactors.
- Preserve the current shared-unit-suite architecture from `9.3.1`. Do not
  reintroduce dedicated-process quarantines, hidden opt-in environment gates,
  or a split default-vs-CI unit-suite definition.
- Do not change the required top-level validation contract. This roadmap item
  closes only after `bun install`, `make build`, `make check-fmt`, `make lint`,
  and `make test` pass in that order.
- Keep a reproducible flake-hunting path. Removing default serialization does
  not mean deleting every seeded or serialized diagnostic command; it means
  those commands must stop being the default gates.
- Resolve the Bun-mode ambiguity with observed local evidence before changing
  scripts. `bun test --help` in this repository shows `--concurrent` as the
  switch that promotes all tests to concurrent execution, while
  `--max-concurrency` only caps concurrent work. Do not assume that removing
  `--max-concurrency=1` alone restores the roadmap's intended parallelism.
- Update `docs/developers-guide.md` in the same implementation. Update
  `docs/testing-with-bun.md` as well if any repository-specific wording becomes
  stale after the script changes.
- Update `docs/roadmap.md` only after all implementation and validation steps
  are complete.
- Keep Markdown wrapped to 80 columns and use tee'd log files under `/tmp/`
  with branch-specific names.

## Tolerances (exception triggers)

- Scope: if restoring default concurrency requires touching more than roughly
  14 files or 800 net new lines, stop and re-evaluate the decomposition before
  proceeding.
- Architecture: if a clean fix appears to require redesigning the Happy DOM
  helper, rewriting large renderer surfaces, or introducing a new test runtime,
  stop and escalate.
- Dependencies: if a new third-party dependency is required to stabilize Bun
  concurrency, stop and escalate.
- Validation: if parallel default runs still fail after two focused remediation
  passes, stop and report the exact failing suites and log paths instead of
  re-serializing the default gates.
- Behaviour: if Bun default concurrency causes persistent timeouts that can
  only be avoided by globally lowering concurrency or restoring
  `--max-concurrency=1`, stop and escalate with evidence and trade-offs.
- Ambiguity: if CI requires a different concurrency policy than local defaults,
  stop and escalate instead of silently diverging the workflows.

## Risks

- Risk: helper-level global serialization may still hide races that only appear
  once multiple suites start together under Bun's default concurrency.
  Severity: high
  Likelihood: medium
  Mitigation: establish a concurrency-focused baseline before script changes,
  then rerun the suite under multiple seeds after enabling default
  parallelism.

- Risk: `test/testUtils/happy-dom.ts` serializes access to `window`,
  `document`, and `navigator`, which may keep correctness but still trigger
  timeouts if too many DOM-heavy files queue behind the lease.
  Severity: high
  Likelihood: medium
  Mitigation: include timeout-focused stress runs in the validation plan and
  treat timeout regressions as defects to fix in helpers or suites, not as a
  reason to restore default serialization.

- Risk: file-scope `mock.module(...)` use or incomplete `mock.restore()`
  cleanup can still leak across files even after `9.3.1`.
  Severity: high
  Likelihood: medium
  Mitigation: audit the remaining global-mutation suites before flipping the
  default scripts and add same-file cleanup wherever concurrency runs expose
  residual bleed.

- Risk: documentation drift can leave developers using the wrong reproduction
  commands or assuming that seeded serialized runs are still the default gates.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/developers-guide.md` and any touched Bun-testing
  guidance in the same change, and keep the roadmap checkbox open until the doc
  text matches the shipped scripts.

- Risk: CI may pass on one runner family while local Linux or macOS runs expose
  timing-sensitive interference.
  Severity: medium
  Likelihood: medium
  Mitigation: validate both the default gate and a small matrix of seeded
  shuffled runs locally before closing the roadmap item.

## Progress

- [x] (2026-03-09 23:31Z) Verified the branch name is
  `9-3-2-restore-parallel-unit-test-execution` and matches the requested
  ExecPlan path.
- [x] (2026-03-09 23:36Z) Audited roadmap item `9.3.2`, the relevant design
  testing note, current package scripts, `Makefile`, CI workflow, and current
  developer/testing documentation.
- [x] (2026-03-09 23:42Z) Created a shared context pack and used an agent team
  to inspect default guardrails and remaining concurrency-sensitive unit-test
  surfaces.
- [x] (2026-03-09 23:45Z) Drafted this ExecPlan.
- [x] (2026-03-10 00:03Z) Received explicit approval to begin implementation.
- [x] (2026-03-10 00:18Z) Captured the current baseline for `bun test --help`,
  the serialized default gate, the no-flag randomized default mode, and the
  stricter `--concurrent` stress mode.
- [x] (2026-03-10 00:24Z) Removed the serialized default guardrail from
  `package.json`, preserved explicit serialized diagnostic scripts, and updated
  developer-facing documentation plus stale test-module usage comments.
- [x] (2026-03-10 00:35Z) Ran `bun install`, `make build`, `make check-fmt`,
  `make lint`, `make test`, and the three no-pin seeded reruns
  (`2444615283`, `1337`, `20260306`) with tee'd logs; all passed.
- [x] (2026-03-10 00:37Z) Updated `docs/roadmap.md` to mark `9.3.2` done after
  the required validation evidence was in hand.

## Surprises & discoveries

- Observation: `9.3.1` already removed the old dedicated bootstrap-process
  quarantine from the default `make test` path.
  Evidence: `docs/execplans/9-3-1-global-state-leakage-in-unit-tests.md`
  records the quarantine removal as complete, and the current scripts route the
  full unit suite through one shared Bun invocation.
  Impact: `9.3.2` is narrower than `9.3.1`; it should focus on default
  concurrency restoration and any residual helper cleanup that the restored
  concurrency reveals.

- Observation: the remaining default serialization now lives in scripts and
  docs, not in the high-level CI workflow.
  Evidence: `.github/workflows/nodejs.yml` calls `make test`, while
  `Makefile` calls `bun run test:unit:run`, and `package.json` is the file that
  still pins `--max-concurrency=1`.
  Impact: one script change can correctly affect local and CI defaults, but it
  also means validation must check both environments' expectations carefully.

- Observation: `test/testUtils/happy-dom.ts` already assumes Bun may execute
  test files in parallel and serializes its own setup/teardown with an internal
  lease.
  Evidence: the helper comment explicitly says Bun may execute files in
  parallel, and the helper owns a shared promise-based lease for DOM globals.
  Impact: the plan should preserve this helper-level protection unless the
  restored default concurrency proves it is the bottleneck causing timeouts.

- Observation: some remaining suites still hold process-global mutations longer
  than ideal for parallel execution.
  Evidence: `test/unit/runtime-tab-provider-registration.test.ts`,
  `test/unit/command-registry-compat.test.ts`, and
  `test/unit/config-import-json5.test.ts` still rely on file-scope
  `mock.module(...)` plus `afterAll` cleanup, while
  `test/unit/notification.test.ts` and `test/unit/updater.test.ts` override
  process-global timer functions during each test.
  Impact: Stage C should prioritize these suites in the hotspot audit before
  assuming the old DOM-heavy files are still the main blocker.

- Observation: the repository's default no-flag Bun unit-test path is already
  sufficient for this roadmap item once `--max-concurrency=1` is removed, but
  explicit `--concurrent` remains a stronger stress mode that still fails.
  Evidence: `bun test --randomize --seed 2444615283 test/unit` passed before
  and after the script change, while
  `bun test --concurrent --randomize --seed 2444615283 test/unit` failed in
  `rpc-client`, `term-report-renderer`, `ensure-directory-path`,
  `v8-snapshot-util`, and `cli-api-behaviour`.
  Impact: `9.3.2` closes on the repository's default Bun concurrency path,
  not on full `--concurrent` promotion of every test. The stricter mode remains
  useful follow-up evidence, but fixing it would exceed this milestone's scope.

## Decision log

- Decision: treat this document as a draft only and do not implement until the
  user explicitly approves it.
  Rationale: the repository instructions and the execplans skill both require
  an approval gate before execution.
  Date/Author: 2026-03-09 / Codex.

- Decision: keep explicit serialized or seeded reproduction commands, but make
  them non-default diagnostics rather than the repository's default gate.
  Rationale: roadmap `9.3.2` requires removing serialized guardrails from the
  default lint/test gates, not removing all flake-reproduction tools.
  Date/Author: 2026-03-09 / Codex.

- Decision: validate concurrency restoration by first measuring the current
  serialized baseline, then changing scripts, then running both top-level gates
  and focused stress runs.
  Rationale: this sequence isolates whether failures come from the script flip
  itself or from latent suite interference that the old guardrail masked.
  Date/Author: 2026-03-09 / Codex.

- Decision: remove `--max-concurrency=1` from the default unit-test scripts but
  do not make `--concurrent` the new repository default.
  Rationale: the roadmap item requires default Bun concurrency in local and CI
  gates, and the no-flag runner passed all required validation runs once the
  guardrail was removed. The stricter `--concurrent` mode still exposes
  unrelated within-file/global-state issues that should be treated as follow-up
  hardening rather than silently broadening this milestone.
  Date/Author: 2026-03-10 / Codex.

## Outcomes & retrospective

Roadmap item `9.3.2` is complete. The shipped change removes the
`--max-concurrency=1` guardrail from the repository's default unit-test script,
preserves explicit serialized scripts as debugging tools, updates the
developer-facing testing guidance, and marks the roadmap item done only after
the requested validation sequence passed.

The final delivered behaviour is:

- `bun run test:unit`, `make test`, and CI's inherited `make test` path now run
  `bun test test/unit` without the serialized guardrail.
- `bun run test:unit:serialized` and
  `bun run test:unit:serialized:shuffled` remain available for targeted
  diagnosis when a serialized repro is still useful.
- `docs/developers-guide.md` and `docs/testing-with-bun.md` now distinguish the
  repository's default gate from stricter opt-in stress modes.
- `docs/roadmap.md` marks `9.3.2` done.

## Implementation plan

Stage A: Record the current baseline and identify the exact files that enforce
serialized default execution, then resolve the Bun-mode ambiguity with direct
evidence.

Run the current default gates and targeted stress commands with tee'd logs
before changing scripts. Capture at least:

```bash
set -o pipefail && bun run test:unit:run \
  2>&1 | tee /tmp/test-unit-default-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --help \
  2>&1 | tee /tmp/test-help-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --randomize --seed 2444615283 test/unit \
  2>&1 | tee /tmp/test-unit-parallel-seed-2444615283-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --randomize --seed 1337 test/unit \
  2>&1 | tee /tmp/test-unit-parallel-seed-1337-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --randomize --seed 20260306 test/unit \
  2>&1 | tee /tmp/test-unit-parallel-seed-20260306-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --concurrent --randomize --seed 2444615283 test/unit \
  2>&1 | tee /tmp/test-unit-concurrent-seed-2444615283-velocetty-9-3-2-restore-parallel-unit-test-execution.out
```

The first command proves the starting behaviour. The seeded runs reveal whether
parallel execution already passes, fails, or times out before any script
changes. The `--help` output resolves the runner semantics in the repository's
actual Bun version, and the explicit `--concurrent` run proves whether the
roadmap target requires adding that flag to the default scripts. If any seeded
run fails, identify the exact failing suites before moving to Stage B.

Stage B: Remove serialized guardrails from default gates while preserving
explicit diagnostics.

Update `package.json` so the default unit-test scripts stop passing
`--max-concurrency=1`. If Stage A shows that `bun test test/unit` is still
sequential in practice, update the default scripts to use `--concurrent`
without a pinned `--max-concurrency` override. Keep dedicated diagnostic
scripts for seeded or serialized reproduction if they remain useful, but rename
or document them so they are clearly non-default. Update `Makefile` only if
needed to keep `make test` aligned with the new default script entry point. Do
not add CI-only special cases.

The target steady state is:

1. `bun run test:unit` and `make test` use Bun's default concurrency.
2. Any retained serialized or seeded scripts are opt-in diagnostics with names
   and documentation that make that status obvious.
3. `test:coverage` remains unchanged unless the new default scripts expose a
   concrete coverage-related issue that must be fixed.

Stage C: Fix residual concurrency defects exposed by the new defaults.

If Stage A or Stage B reveals failures, fix the smallest real source of shared
state instead of restoring broad serialization. Audit and update only the
helpers or suites named in the baseline failures. Prioritize:

1. suites that mutate `globalThis` timers or other process-global APIs,
2. suites using file-scope `mock.module(...)` with `afterAll` cleanup,
3. helpers whose cleanup is correct under serial execution but too slow or too
   coarse under concurrent file starts

Candidate touch points include `test/testUtils/happy-dom.ts`,
`test/testUtils/global-window.ts`,
`test/unit/runtime-tab-provider-registration.test.ts`,
`test/unit/notification.test.ts`, `test/unit/updater.test.ts`, and the
DOM-heavy renderer unit suites already hardened in `9.3.1`.

Any fix in this stage must preserve the `9.3.1` design choice: the shared unit
suite remains the only default path, and concurrency bugs are fixed at the
suite/helper level.

Stage D: Update developer-facing documentation to match the shipped workflow.

Update `docs/developers-guide.md` so the default unit-test commands no longer
imply serialized execution. Preserve a short, explicit section describing when
to use seeded or serialized diagnostics for flake hunting. Review
`docs/testing-with-bun.md` and update any repository-specific wording that
would otherwise contradict the shipped scripts. Keep the docs concrete about
which commands are defaults and which are debugging tools.

Stage E: Run the full validation sequence and only then close the roadmap item.

Run the requested gates in order with tee'd logs:

```bash
set -o pipefail && bun install \
  2>&1 | tee /tmp/bun-install-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && make build \
  2>&1 | tee /tmp/build-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && make check-fmt \
  2>&1 | tee /tmp/check-fmt-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && make lint \
  2>&1 | tee /tmp/lint-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && make test \
  2>&1 | tee /tmp/test-velocetty-9-3-2-restore-parallel-unit-test-execution.out
```

Then run at least three focused post-change stress checks with default Bun
concurrency and explicit seeds:

```bash
set -o pipefail && bun test --randomize --seed 2444615283 test/unit \
  2>&1 | tee /tmp/test-seed-2444615283-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --randomize --seed 1337 test/unit \
  2>&1 | tee /tmp/test-seed-1337-velocetty-9-3-2-restore-parallel-unit-test-execution.out
set -o pipefail && bun test --randomize --seed 20260306 test/unit \
  2>&1 | tee /tmp/test-seed-20260306-velocetty-9-3-2-restore-parallel-unit-test-execution.out
```

If Stage A proves that explicit `--concurrent` is required to achieve the
roadmap's intended parallel mode, rerun the same stress matrix with
`--concurrent` and record those logs alongside the default-gate evidence. In
that case, the documentation updates must say plainly that repository defaults
intentionally opt into concurrent Bun execution.

If documentation was edited, run the repository's Markdown-quality checks that
apply to the touched files before finalizing. Only after all logs are clean
should `docs/roadmap.md` be updated to mark `9.3.2` done.
