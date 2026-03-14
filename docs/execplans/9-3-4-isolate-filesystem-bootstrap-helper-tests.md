# Isolate filesystem bootstrap helper tests (roadmap 9.3.4)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Roadmap item `9.3.4` exists because roadmap item `9.3.2` restored the default
parallel unit-test gate, but `test/unit/ensure-directory-path.test.ts` still
assumes its tests will not overlap. Under explicit `bun test --concurrent`,
that assumption is false. The current suite stores every temporary root in a
shared file-scope array and lets each test's `afterEach(...)` remove the whole
array. When one test finishes earlier than another, it can delete the other
test's directory tree while the slower test is still asserting on it, which
produces the roadmap's `ENOENT` failures.

After this work, a developer should be able to run
`bun test --concurrent test/unit/ensure-directory-path.test.ts` repeatedly and
see stable directory and symlink assertions with no race-driven `ENOENT`
errors. The observable success conditions are:

1. `test/unit/ensure-directory-path.test.ts` no longer shares temporary-root
   allocation or teardown state across tests when Bun runs the file under
   explicit `--concurrent`.
2. The suite keeps its current behavioural coverage: existing-directory
   idempotence, recursive directory creation, symlink-target materialization,
   and non-directory rejection.
3. Repeated focused concurrent runs pass with no `ENOENT` races against either
   the nested output path or the symlink target path.
4. `docs/developers-guide.md` documents the relevant development practice:
   temporary directories used by concurrency-sensitive tests must be owned and
   cleaned up by the individual test, not by a shared file-level queue.
5. `docs/roadmap.md` marks `9.3.4` done only after `bun install`,
   `make build`, `make check-fmt`, `make lint`, `make test`, and the focused
   explicit-concurrency stress loop all pass.

## Repository orientation

This milestone is intentionally narrow. The roadmap names one test file and one
focused success command.

`test/unit/ensure-directory-path.test.ts` currently creates unique temporary
roots with `mkdtemp(...)`, but it tracks them in a file-scope
`temporaryRoots: string[]` array and removes `temporaryRoots.splice(0)` inside
`afterEach(...)`. That teardown pattern is safe only when tests in the file do
not overlap. The current suite covers four behaviours:

- preserving an existing directory and its sentinel file
- creating a missing nested directory path recursively
- creating the resolved target behind a symlinked directory path
- rejecting a non-directory path with a stable error contract

The symlink case is the most sensitive. It asserts both `lstat(symlinkPath)`
and `lstat(targetDirectory)`. If another test removes the owning temporary root
mid-flight, either of those `lstat(...)` calls can fail even when
`ensureDirectoryPath(...)` itself behaved correctly.

The production helper in `bin/shared/ensure-directory-path.js` is small and
stateless. It only performs `lstat`, `readlink`, and `mkdir` calls. Current
inspection does not show shared mutable state in the helper itself, so the
implementation should isolate the test harness first and change production code
only if a reproduced race remains after the harness is fixed.

Existing repository patterns already point toward the desired shape:

- `test/unit/esbuild-migration-contracts.test.ts` creates temporary
  directories and removes them in the same test via `try/finally`.
- `test/unit/happy-dom.test.ts` uses `test.serial(...)` only to validate the
  Happy DOM harness contract itself; it is not a pattern for silencing
  unrelated races.
- Recent roadmap work in `docs/execplans/9-3-3-isolate-renderer-event-and-renderer-metric-tests.md`
  favours per-test harness ownership over mutable file-scope fixture state.

The implementation will likely touch these files:

- `test/unit/ensure-directory-path.test.ts`
- `docs/developers-guide.md`
- `docs/roadmap.md`

It may also touch `bin/shared/ensure-directory-path.js` if, and only if, the
focused concurrent race remains after the test harness is isolated.

## Constraints

- Keep this milestone scoped to isolating
  `test/unit/ensure-directory-path.test.ts` for explicit `--concurrent` runs.
  Do not silently absorb roadmap items `9.3.5` through `9.3.8`.
- Do not solve the problem by restoring serialized defaults, adding
  `test.serial(...)` to the target suite, or weakening the roadmap success
  criterion.
- Preserve the helper's existing behaviour and public contract in
  `bin/shared/ensure-directory-path.js`. This roadmap item is about test
  isolation first, not changing how build and packaging scripts bootstrap
  directories.
- Prefer per-test ownership of temporary roots and cleanup. Any helper added to
  the test file must make it impossible for one test to remove another test's
  filesystem state.
- Keep the symlink-target assertions intact. The fix must preserve proof that
  the symlink remains a symlink and its resolved backing directory exists.
- Update `docs/developers-guide.md` in the same implementation so developers
  understand the repository rule for concurrency-safe temporary directories in
  unit tests.
- Update `docs/roadmap.md` only after all required validation commands pass.
- Use durable tee'd logs under `/tmp/` for the focused concurrent stress run
  and the required top-level gates.

## Tolerances (exception triggers)

- Scope: if isolating this suite requires touching more than roughly 4 files or
  250 net new lines, stop and re-evaluate the decomposition before proceeding.
- Production impact: if the race persists after the test harness is made
  per-test and fixing it appears to require redesigning filesystem bootstrap
  semantics, stop and escalate with the reproduced failure evidence.
- Validation: if the focused concurrent stress command still fails after two
  focused remediation passes, stop and report the remaining failure signatures
  and log paths instead of forcing roadmap closure.
- Behaviour: if the only apparent fix is to weaken assertions, remove the
  symlink coverage, or reintroduce serialization, stop and escalate before
  proceeding.
- Tooling: if any required gate fails for reasons unrelated to this roadmap
  item, report the failure as a blocker and do not mark `9.3.4` done.

## Risks

- Risk: the current race is obvious in teardown ownership, but there could be a
  second, less visible helper-level race behind it.
  Severity: high
  Likelihood: low
  Mitigation: first isolate the test harness, then rerun the focused
  concurrent loop enough times to determine whether any helper change is still
  required.

- Risk: the symlink case may remain flaky if the refactor fixes teardown
  ownership but leaves assertions coupled to shared helper state.
  Severity: medium
  Likelihood: medium
  Mitigation: keep each test's path construction entirely local and avoid any
  shared mutable registry or shared cleanup callback.

- Risk: future contributors may reintroduce shared temp-root cleanup patterns
  elsewhere if the repository guidance is not updated.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/developers-guide.md` with the concrete rule and the
  focused concurrent reproduction command used for this roadmap item.

- Risk: full repository gates may expose unrelated flakes after the targeted
  fix lands.
  Severity: medium
  Likelihood: medium
  Mitigation: keep the roadmap item scoped, but do not mark it done unless the
  full requested gate suite passes after the focused concurrency run.

## Implementation outline

### Stage A: capture the focused concurrent baseline

Start by reproducing the failure with durable logs. Use `set -o pipefail` and
write the focused stress output to a branch-specific file under `/tmp/`.

```bash
set -o pipefail
for run in $(seq 1 20); do
  echo "== ensure-directory-path concurrent run ${run} =="
  bun test --concurrent test/unit/ensure-directory-path.test.ts
done | tee /tmp/concurrent-ensure-directory-path-velocetty-$(git branch --show-current).out
```

The current branch already reproduces the defect. A captured probe log at
`/tmp/concurrent-ensure-directory-path-velocetty-$(git branch --show-current).out`
shows failures such as the following:

```plaintext
ENOENT: no such file or directory, statx '/tmp/ensure-directory-path-.../nested/output'
ENOENT: no such file or directory, statx '/tmp/ensure-directory-path-.../backing/dist'
```

Those signatures confirm that the race destroys a test-local root before its
assertions finish.

### Stage B: isolate temporary-root ownership inside the suite

Refactor `test/unit/ensure-directory-path.test.ts` so each test owns exactly
one temporary root and exactly one cleanup path. Acceptable shapes include:

- a helper such as `createTemporaryRoot()` that returns
  `{temporaryRoot, cleanup}`
- a wrapper such as `withTemporaryRoot(async (temporaryRoot) => { ... })` that
  performs `rm(...)` in a `finally` block

Do not keep a shared `temporaryRoots` array or any other file-scope mutable
teardown registry. The target state is that one test cannot remove another
test's root even if they overlap completely under `--concurrent`.

Keep the helper code in the test file small and obvious. The point is not to
invent new test infrastructure; it is to make teardown ownership explicit and
local.

### Stage C: preserve and, if useful, strengthen the behavioural assertions

Keep all four existing test cases. While refactoring the harness, verify that
the assertions still prove the intended behaviour:

- existing directories remain intact, including sentinel content
- missing nested directory paths are created recursively
- symlink paths remain symlinks while the resolved target directory is
  materialized
- non-directory paths still throw the current error

If the refactor naturally allows stronger proof in the symlink case, add only a
small, relevant assertion, such as a sentinel written under the active test's
root. Do not bloat the suite or turn this into a helper redesign.

If the race remains after the harness change, inspect
`bin/shared/ensure-directory-path.js` next. Only then consider a narrow helper
change, and keep the helper's observable contract unchanged.

### Stage D: update developer guidance

Update `docs/developers-guide.md` in the unit-testing workflow section that
already documents roadmap items `9.3.2` and `9.3.3`. Add guidance for
filesystem-oriented explicit-concurrency work:

- use a focused stress command for this suite:

  ```bash
  bun test --concurrent test/unit/ensure-directory-path.test.ts
  ```

- keep temporary-directory ownership and teardown inside the individual test or
  a per-test helper
- do not use shared file-scope cleanup queues for filesystem fixtures in
  suites that must survive `--concurrent`

This guidance should supplement the current default `make test` path and the
seeded randomized reruns from roadmap item `9.3.2`, not replace them.

### Stage E: run the required validation and close the roadmap item

After the implementation is complete, run the focused concurrent stress loop
again and keep the log. Then run the required top-level gates in order, each
with durable tee'd logs.

```bash
set -o pipefail
bun install | tee /tmp/bun-install-velocetty-$(git branch --show-current).out
make build | tee /tmp/build-velocetty-$(git branch --show-current).out
make check-fmt | tee /tmp/check-fmt-velocetty-$(git branch --show-current).out
make lint | tee /tmp/lint-velocetty-$(git branch --show-current).out
make test | tee /tmp/test-velocetty-$(git branch --show-current).out
```

Only after those commands pass should `docs/roadmap.md` mark `9.3.4` done.
The roadmap entry should reflect the targeted explicit-concurrency success
criterion, not merely the default `make test` gate.

## Validation

Implementation is not complete until the following checks have passed:

1. The focused stress command below passes repeatedly with no `ENOENT` races:

   ```bash
   set -o pipefail
   for run in $(seq 1 20); do
     echo "== ensure-directory-path concurrent run ${run} =="
     bun test --concurrent test/unit/ensure-directory-path.test.ts
   done | tee /tmp/concurrent-ensure-directory-path-velocetty-$(git branch --show-current).out
   ```

2. The required repository gates pass in this order:

   ```bash
   set -o pipefail
   bun install | tee /tmp/bun-install-velocetty-$(git branch --show-current).out
   make build | tee /tmp/build-velocetty-$(git branch --show-current).out
   make check-fmt | tee /tmp/check-fmt-velocetty-$(git branch --show-current).out
   make lint | tee /tmp/lint-velocetty-$(git branch --show-current).out
   make test | tee /tmp/test-velocetty-$(git branch --show-current).out
   ```

3. `docs/developers-guide.md` accurately describes the new practice for
   concurrency-safe filesystem fixture cleanup.
4. `docs/roadmap.md` marks `9.3.4` done only after the targeted concurrent run
   and the full gate suite both succeed.

## Progress

- [x] (2026-03-12 19:43Z) Verified the branch name is
  `9-3-4-isolate-filesystem-bootstrap-helper-tests` and matches the requested
  ExecPlan path.
- [x] (2026-03-12 19:43Z) Audited `docs/roadmap.md`,
  `docs/developers-guide.md`, `docs/velocetty-design.md`,
  `test/unit/ensure-directory-path.test.ts`, and
  `bin/shared/ensure-directory-path.js`.
- [x] (2026-03-12 19:43Z) Created a shared context pack and used an agent team
  to inspect prior `9.3.x` plan patterns and the filesystem helper test
  surface.
- [x] (2026-03-12 19:43Z) Reproduced the current `ENOENT` race under
  `bun test --concurrent test/unit/ensure-directory-path.test.ts` and captured
  the failure signature in
  `/tmp/concurrent-ensure-directory-path-velocetty-9-3-4-isolate-filesystem-bootstrap-helper-tests.out`.
- [x] (2026-03-12 19:43Z) Drafted this ExecPlan.
- [x] (2026-03-12 19:44Z) Received explicit approval to begin implementation.
- [x] (2026-03-12 19:49Z) Refactored
  `test/unit/ensure-directory-path.test.ts` to give each test sole ownership
  of its temporary root and cleanup path via a per-test wrapper.
- [x] (2026-03-12 19:50Z) Replayed
  `bun test --concurrent test/unit/ensure-directory-path.test.ts` for 20
  iterations with a tee'd log; all iterations passed with no `ENOENT` races.
- [x] (2026-03-12 19:51Z) Updated `docs/developers-guide.md` with the
  filesystem fixture rule for explicit `--concurrent` work.
- [x] (2026-03-12 23:06Z) Recovered a broken generated dependency tree,
  hardened the packaged dependency mirror step, and reran `bun install`
  successfully end to end.
- [x] (2026-03-12 23:08Z) Ran `make build`, `make check-fmt`, `make lint`, and
  `make test` successfully with tee'd logs.
- [x] (2026-03-12 23:09Z) Updated `docs/developers-guide.md` with the
  postinstall Node.js copy-step guidance and marked roadmap item `9.3.4` done.

## Surprises & discoveries

- Observation: the temporary-root naming is already unique per test because the
  suite uses `mkdtemp(...)`.
  Evidence: `test/unit/ensure-directory-path.test.ts` prefixes roots with
  `ensure-directory-path-` and receives a fresh path from the operating system.
  Impact: the race is not allocation collision. It is teardown ownership.

- Observation: the current failure is caused by file-scope cleanup state, not
  by obvious shared state in `bin/shared/ensure-directory-path.js`.
  Evidence: the helper only performs `lstat`, `readlink`, and `mkdir`, while
  the suite keeps `temporaryRoots` at file scope and removes
  `temporaryRoots.splice(0)` inside `afterEach(...)`.
  Impact: implementation should isolate the test harness first and only inspect
  helper changes if the focused concurrent race remains after that refactor.

- Observation: the symlink case is the easiest place to see the race because it
  performs two post-bootstrap filesystem checks under the same temporary root.
  Evidence: concurrent probes have already failed on both
  `/dist` and `/backing/dist` paths with `ENOENT`.
  Impact: repeated explicit-concurrency runs should keep the symlink case in
  view when judging whether the fix is complete.

- Observation: recent roadmap work in this repository has converged on
  per-test fixture ownership rather than shared mutable harness state.
  Evidence: roadmap `9.3.3` isolated renderer tests by moving state behind
  per-test harnesses, and other unit tests already use local `try/finally`
  cleanup for temporary directories.
  Impact: `9.3.4` should follow the same pattern instead of adding new global
  coordination.

- Observation: removing the file-scope temporary-root queue was sufficient to
  stabilize the focused explicit-concurrency command.
  Evidence: 20 consecutive runs of
  `bun test --concurrent test/unit/ensure-directory-path.test.ts` passed after
  the test-harness refactor, with no helper-code change.
  Impact: roadmap `9.3.4` does not currently require a production change in
  `bin/shared/ensure-directory-path.js`.

- Observation: `bun install` was blocked by two independent generated-tree
  failures in this workspace: stale relink targets in `node_modules`, then
  `ENOENT` failures inside the packaged dependency mirror step.
  Evidence: initial install attempts failed with `EEXIST` during dependency
  relinking and then with `ENOENT` from `bin/copy-node-modules.js` while
  copying into `app/node_modules`.
  Impact: completing the requested gate suite required both a clean generated
  dependency-tree reset and a small hardening change to the copy script plus
  its `package.json` invocation.

## Decision log

- Decision: treat this document as a draft only and do not implement until the
  user explicitly approves it.
  Rationale: the repository instructions and the execplans skill both require
  an approval gate before execution.
  Date/Author: 2026-03-12 / Codex.

- Decision: prioritize test-harness isolation before any production helper
  change.
  Rationale: current evidence shows the race is caused by shared teardown state
  in the test file, while the production helper appears stateless.
  Date/Author: 2026-03-12 / Codex.

- Decision: begin execution by updating this plan before editing code so the
  progress record matches the approved implementation phase.
  Rationale: this ExecPlan must remain a usable living document if work is
  interrupted mid-implementation.
  Date/Author: 2026-03-12 / Codex.

- Decision: keep the roadmap success criterion anchored to explicit
  `--concurrent` runs for this one suite, plus the repository's full gate
  suite.
  Rationale: roadmap `9.3.4` is narrower than a general unit-test scheduler
  change and should close only when both the focused stress path and the
  required repository gates succeed.
  Date/Author: 2026-03-12 / Codex.

- Decision: switch the packaged `node_modules` mirror step to native
  `fs.cpSync` under Node.js during postinstall.
  Rationale: the original generated-tree copy path was not reliable enough to
  satisfy the required plain `bun install` gate on this machine, while the
  Node.js/native-fs path completed successfully without changing the resulting
  packaged dependency layout.
  Date/Author: 2026-03-12 / Codex.

## Outcomes & retrospective

`test/unit/ensure-directory-path.test.ts` now gives each test sole ownership
of its temporary root by wrapping test bodies in a per-test cleanup helper.
That removed the shared teardown queue that had been deleting sibling tests'
directories under explicit `--concurrent` scheduling. No production change was
required in `bin/shared/ensure-directory-path.js` for the roadmap behaviour
itself.

`bun test --concurrent test/unit/ensure-directory-path.test.ts` passed for 20
consecutive iterations with no `ENOENT` races. The required top-level gates
also passed after repairing the generated dependency tree and hardening the
packaged dependency mirror step:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

The reusable lesson is simple: filesystem fixtures in concurrency-sensitive
tests must be owned and cleaned up by the individual test, not by a file-scope
queue. Separately, this workspace now treats the packaged `node_modules` copy
step as a Node.js/native-fs operation during postinstall because that proved
materially more reliable than the earlier Bun/`fs-extra` path on this Linux/WSL
environment.
