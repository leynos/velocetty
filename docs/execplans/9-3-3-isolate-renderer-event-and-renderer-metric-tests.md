# Isolate renderer event and renderer-metric tests (roadmap 9.3.3)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Roadmap item `9.3.3` exists because roadmap item `9.3.2` restored the default
parallel unit-test gate, but two renderer-sensitive suites still rely on
mutable file-scope fixtures that are safe only when tests in those files do
not overlap. The repository now expects shared-suite testing, not dedicated
quarantines or a return to serialized defaults.

After this work, a developer should be able to run the focused renderer stress
command
`bun test --concurrent test/unit/rpc-client.test.ts test/unit/term-report-renderer.test.ts`
repeatedly and see stable call counts, no leaked listeners, and no transport or
metric assertions polluted by a neighbouring test. The observable success
conditions are:

1. `test/unit/rpc-client.test.ts` no longer shares channel listener state,
   `window.__rpcId`, imported client instances, or mock call history across
   tests when Bun runs the file under explicit `--concurrent`.
2. `test/unit/term-report-renderer.test.ts` no longer shares `Term`
   constructor/module state, `Term.reportRenderer` deduplication cache,
   transport mock call history, or Happy DOM teardown handles across tests when
   Bun runs the file under explicit `--concurrent`.
3. Repeated focused concurrent runs pass with no call-count leakage between
   tests.
4. `docs/developers-guide.md` documents the focused concurrent stress command
   for this renderer isolation workflow without changing the default test gate
   established by roadmap item `9.3.2`.
5. `docs/roadmap.md` marks `9.3.3` done only after `bun install`,
   `make build`, `make check-fmt`, `make lint`, and `make test` all pass in
   that order, and after the focused concurrent stress loop has passed.

## Repository orientation

This milestone is intentionally narrow. The roadmap only names two suites and
one focused validation command.

`test/unit/rpc-client.test.ts` currently keeps the following mutable state at
file scope:

- `channelListeners`, a shared `Map<string, IpcListener[]>`
- `onMock`, `sendMock`, and `removeAllListenersMock`
- `Client`, imported once in `beforeAll()`
- `restoreWindow`, reassigned in `beforeEach()`

That structure is acceptable for sequential tests but fragile for explicit
concurrency because one test can clear or replace shared fixture state while
another test still depends on it. The production class in `lib/utils/rpc.ts`
also deserves inspection during implementation because `destroy()` currently
delegates to `ipc.removeAllListeners(this.id)`. If concurrent overlap reveals
that the production client needs a more precise listener-unsubscribe path, that
change belongs inside this milestone as long as the public behaviour remains
unchanged.

`test/unit/term-report-renderer.test.ts` already tries to isolate imports by
loading `../../lib/components/term.tsx` with a query-string suffix in
`beforeEach()`, but the suite still keeps key mutable handles at file scope:

- `transportMock` and `resetTransportMock()` from
  `test/testUtils/transport-mock.ts`
- `Term`, reassigned in `beforeEach()`
- `cleanupHappyDom`, reassigned in `beforeEach()`
- `moduleInstanceCounter`

The production component in `lib/components/term.tsx` uses static
`Term.rendererTypes` for renderer deduplication and routes renderer telemetry
through `Term.reportRenderer(...)`. That contract must remain intact because
`docs/developers-guide.md` and `app/utils/renderer-utils.ts` treat it as the
canonical source for renderer mode events and runtime-metric aggregation.

`shared/src/constants/runtime-telemetry.ts` also owns a process-level
timestamp map for runtime-metric correlation. The current
`term-report-renderer` suite does not explicitly reset that state, so the
implementation must verify whether focused concurrent isolation requires an
explicit cleanup step there as well.

The implementation will likely touch these files:

- `test/unit/rpc-client.test.ts`
- `test/unit/term-report-renderer.test.ts`
- `test/testUtils/transport-mock.ts` if the existing helper needs a per-test
  factory or stronger listener cleanup affordances
- `lib/utils/rpc.ts` only if a precise unsubscribe fix is needed
- `docs/developers-guide.md`
- `docs/roadmap.md`

## Constraints

- Keep this milestone scoped to isolating
  `test/unit/rpc-client.test.ts` and
  `test/unit/term-report-renderer.test.ts` for explicit `--concurrent` runs.
  Do not silently absorb unrelated hotspots from roadmap items `9.3.4` through
  `9.3.7`.
- Do not solve the problem by restoring serialized defaults, adding a new
  dedicated-process quarantine, or weakening the roadmap success criterion.
- Preserve the renderer telemetry contract in `lib/components/term.tsx`.
  `Term.reportRenderer(...)` must remain the path that emits renderer mode and
  runtime-metric updates.
- Preserve the renderer RPC client contract in `lib/utils/rpc.ts`. Any fix in
  production code must keep the current ready/init/event-forwarding behaviour
  intact.
- Prefer per-test fixture factories over global mutable state. Any suite-local
  state required for concurrency safety must be created inside a helper that
  each test owns independently.
- Keep production and test files within the repository size guidance. Extract
  small helpers instead of inflating already large files.
- Update `docs/developers-guide.md` in the same implementation so developers
  know when to use the focused concurrent stress command.
- Update `docs/roadmap.md` only after all validation steps pass.

## Tolerances (exception triggers)

- Scope: if isolating these two suites requires a broader redesign of renderer
  bootstrap, shared Happy DOM leasing, or unrelated test infrastructure, stop
  and escalate.
- Surface area: if the implementation grows beyond roughly 8 files or 500 net
  new lines, stop and re-evaluate the decomposition before proceeding.
- Production impact: if concurrency safety appears to require changes to shared
  transport event schemas or public types under `shared/`, stop and escalate.
- Validation: if the focused concurrent stress command still fails after two
  focused remediation passes, stop and report the remaining bleed surfaces with
  log paths instead of forcing closure.
- Behaviour: if the only viable fix is to add `test.serial()` or remove
  assertions that currently verify listener or metric behaviour, stop and
  escalate before weakening the suite.

## Risks

- Risk: `rpc-client.test.ts` may hide a production unsubscribe defect as well
  as a test-harness defect.
  Severity: high
  Likelihood: medium
  Mitigation: first isolate the test harness so each test owns its own
  listener registry and `window` state, then rerun the focused concurrent
  command. Only change `lib/utils/rpc.ts` if the production listener lifecycle
  still bleeds after the harness is isolated.

- Risk: `term-report-renderer.test.ts` may still share module-level state even
  though it imports `Term` with a unique query-string suffix.
  Severity: high
  Likelihood: high
  Mitigation: move `Term`, Happy DOM cleanup, transport mocks, and any module
  instance counters behind a per-test harness that returns isolated handles to
  the calling test rather than mutating file-scope variables in `beforeEach()`.

- Risk: the transport mock helper may accumulate listeners or mock call history
  in ways that only become visible under explicit concurrent scheduling.
  Severity: medium
  Likelihood: medium
  Mitigation: verify whether `test/testUtils/transport-mock.ts` should create a
  fully isolated mock instance per test and whether it needs a stricter reset
  or disposal contract.

- Risk: documentation could drift and incorrectly imply that explicit
  `--concurrent` runs are now the default repository gate.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/developers-guide.md` to describe the focused
  concurrent stress command as a targeted renderer-isolation check layered on
  top of the default `9.3.2` workflow, not a replacement for it.

## Implementation outline

### Stage A: capture the focused concurrent baseline

Start by proving the current failure mode with durable logs. Use `set -o
pipefail` and tee output to a branch-specific path under `/tmp/`.

```bash
set -o pipefail
for run in $(seq 1 10); do
  echo "== focused concurrent run ${run} =="
  bun test --concurrent \
    test/unit/rpc-client.test.ts \
    test/unit/term-report-renderer.test.ts
done | tee /tmp/concurrent-focus-velocetty-$(git branch --show).out
```

If the failure does not reproduce in 10 runs, keep the log and continue with
the harness audit anyway, because the roadmap item exists specifically to
remove this class of latent bleed.

Current probe evidence already shows the likely signatures to expect:

- `rpc-client.test.ts` cached-id assertions can observe a later test's RPC id
  such as `per-event-rpc-id` instead of `cached-rpc-id`.
- `term-report-renderer.test.ts` call-count assertions like
  `toHaveBeenCalledTimes(1)` can climb in even increments (`2`, `4`, `6`, ...)
  because concurrent tests are resetting and reusing the same shared transport
  mock.

### Stage B: isolate `rpc-client.test.ts`

Replace the file-scope mutable fixture pattern with a per-test harness. Each
test should obtain its own:

- listener registry
- IPC mock functions
- `window` installation and restore callback
- dynamically imported `Client` constructor or factory
- explicit cleanup path for client instances created during the test

The goal is that no test mutates shared file-scope fixture state after its body
starts. A straightforward pattern is an async helper such as
`createRpcClientHarness()` that registers the module mock, imports the client
module for that test instance, and returns helper methods like `emitChannel()`,
`createClient()`, and `cleanup()`.

During this stage, verify whether `lib/utils/rpc.ts` needs a more precise
unsubscribe path than `removeAllListeners(this.id)`. If the test harness alone
solves the focused concurrent failures, keep production code unchanged. If not,
change production code narrowly and add assertions that prove listener cleanup
is instance-specific rather than channel-global.

### Stage C: isolate `term-report-renderer.test.ts`

Convert the suite from file-scope shared state to a per-test renderer harness.
Each test should own:

- a fresh transport mock instance
- a fresh Happy DOM session and cleanup callback
- a fresh dynamic import of `Term`
- any query-string or module-instance bookkeeping needed to force a unique
  import

Do not rely on `beforeEach()` assigning shared `let Term` or shared
`cleanupHappyDom` state. Under explicit concurrent scheduling that pattern lets
one test replace another test's active module or cleanup handle.

The implementation should make it impossible for one test to clear another
test's `transportMock.emit` history or `Term.rendererTypes` cache. If that
requires enhancing `test/testUtils/transport-mock.ts`, keep the helper change
generic and small so other suites can reuse it later.

While doing this, audit whether any runtime-metric helper state in
`shared/src/constants/runtime-telemetry.ts` needs an explicit per-test reset so
renderer-metric assertions cannot inherit stale timestamps from a neighbouring
test.

Retain the current assertions around:

- first renderer emission
- deduplication by `uid`
- fallback reasons such as `context-loss`, `pool-evicted`, and
  `webgl-init-failed`
- runtime-metric flushes during teardown

The point is isolation, not reducing behavioural coverage.

### Stage D: update developer guidance

Update `docs/developers-guide.md` where the post-`9.3.2` unit-test workflow is
documented. Add a short renderer-isolation note that gives developers the exact
focused concurrent stress command:

```bash
bun test --concurrent \
  test/unit/rpc-client.test.ts \
  test/unit/term-report-renderer.test.ts
```

Make the wording explicit that:

1. the default `make test` gate remains the normal repository path,
2. seeded randomized reruns remain the general order-dependence check, and
3. this focused concurrent command is the stress path for renderer event and
   renderer-metric isolation work.

### Stage E: validate and close the roadmap item

Run the required gates in order, capturing each command to its own durable log.

```bash
set -o pipefail
bun install 2>&1 | tee /tmp/bun-install-velocetty-$(git branch --show).out
```

```bash
set -o pipefail
make build 2>&1 | tee /tmp/build-velocetty-$(git branch --show).out
```

```bash
set -o pipefail
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-$(git branch --show).out
```

```bash
set -o pipefail
make lint 2>&1 | tee /tmp/lint-velocetty-$(git branch --show).out
```

```bash
set -o pipefail
make test 2>&1 | tee /tmp/test-velocetty-$(git branch --show).out
```

Then rerun the focused concurrent stress loop and keep the log:

```bash
set -o pipefail
for run in $(seq 1 10); do
  echo "== focused concurrent run ${run} =="
  bun test --concurrent \
    test/unit/rpc-client.test.ts \
    test/unit/term-report-renderer.test.ts
done | tee /tmp/concurrent-focus-final-velocetty-$(git branch --show).out
```

Only after all of those commands pass should `docs/roadmap.md` mark `9.3.3`
done.

## Acceptance evidence

The final implementation report should cite all of the following:

1. the exact log path for the initial focused concurrent baseline
2. the exact log paths for `bun install`, `make build`, `make check-fmt`,
   `make lint`, and `make test`
3. the exact log path for the final focused concurrent stress loop
4. the file paths updated in `docs/developers-guide.md` and `docs/roadmap.md`
5. a short explanation of whether `lib/utils/rpc.ts` required a production
   unsubscribe fix or whether the solution remained test-only

## Progress

- [x] (2026-03-10 18:41Z) Verified the branch name is
  `9-3-3-isolate-renderer-event-and-renderer-metric-tests` and matches the
  requested ExecPlan path.
- [x] (2026-03-10 18:41Z) Audited roadmap item `9.3.3`,
  `docs/velocetty-design.md`, `docs/developers-guide.md`, the previous
  `9.3.1` and `9.3.2` execplans, the target test files, and the directly
  relevant production files.
- [x] (2026-03-10 18:41Z) Used an agent team to inspect documentation context
  and the two target suites while drafting the plan.
- [x] (2026-03-10 18:41Z) Drafted this ExecPlan.
- [x] (2026-03-10 18:47Z) Received explicit approval to begin implementation.
- [x] (2026-03-10 18:50Z) Captured the focused concurrent baseline in
  `/tmp/concurrent-focus-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`;
  the first run failed immediately with cached RPC id leakage in
  `rpc-client.test.ts` and steadily increasing `transportMock.emit` call counts
  in `term-report-renderer.test.ts`.
- [x] (2026-03-10 18:57Z) Reworked `test/unit/rpc-client.test.ts` into a
  per-test harness and narrowed `lib/utils/rpc.ts` onto injected IPC/window
  dependencies plus precise `removeListener(...)` cleanup on destroy.
- [x] (2026-03-10 19:01Z) Reworked
  `test/unit/term-report-renderer.test.ts` into an async per-test harness that
  owns the Happy DOM lease, transport mock, dynamic `Term` import, and
  renderer-metric cleanup, and confirmed one focused concurrent rerun passes at
  `/tmp/focused-check-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`.
- [x] (2026-03-10 19:10Z) Ran `bun install`, `make build`,
  `make check-fmt`, `make lint`, and `make test` with tee'd logs under
  `/tmp/`; all passed on the final tree.
- [x] (2026-03-10 19:16Z) Replayed the focused concurrent stress loop for
  10 runs at
  `/tmp/concurrent-focus-final-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`;
  all runs passed with stable call counts.
- [x] (2026-03-10 19:17Z) Updated `docs/roadmap.md` to mark `9.3.3` complete
  after the required validation evidence was captured.
- [x] (2026-03-10 19:01Z) Captured the focused concurrent baseline at
  `/tmp/concurrent-focus-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`;
  the cached-RPC-id test observed `per-event-rpc-id`, and the renderer metric
  suite showed shared `transportMock.emit` counts climbing across tests.
- [x] (2026-03-10 19:01Z) Reworked `test/unit/rpc-client.test.ts` around a
  per-test harness and updated `lib/utils/rpc.ts` so tests can inject IPC,
  window state, and deferred-ready scheduling without importing Electron IPC at
  module load.
- [x] (2026-03-10 19:01Z) Reworked
  `test/unit/term-report-renderer.test.ts` around a per-test renderer harness
  with isolated transport mocks, isolated `Term` imports, and explicit runtime
  telemetry resets.
- [x] (2026-03-10 19:01Z) Updated `docs/developers-guide.md` with the focused
  renderer `--concurrent` stress command while preserving the `9.3.2` default
  gate description.
- [ ] Run `bun install`, `make build`, `make check-fmt`, `make lint`, and
  `make test`, then rerun the focused concurrent stress loop before updating
  `docs/roadmap.md` and closing the item.

## Surprises & discoveries

- Observation: `test/unit/rpc-client.test.ts` does not merely share mocks; it
  shares the imported `Client` constructor, the channel listener registry, and
  the mutable `window` fixture through file-scope variables.
  Impact: resetting state in `beforeEach()` is not enough under explicit
  concurrent scheduling because another test can still clear or replace the
  shared fixture mid-run.

- Observation: `test/unit/term-report-renderer.test.ts` already tries to force
  fresh `Term` imports with a query-string suffix, but it still publishes the
  imported module and cleanup handles through shared file-scope variables.
  Impact: the correct fix is not "reset more aggressively"; it is to stop
  storing per-test renderer harness state in shared `let` bindings.

- Observation: renderer-metric paths may involve more than `Term.rendererTypes`
  and the transport mock.
  Evidence: `shared/src/constants/runtime-telemetry.ts` owns a global
  timestamp map used by runtime-metric helpers, and the current suite does not
  explicitly reset it.
  Impact: Stage C must verify whether that map needs an explicit per-test reset
  as part of the final hardening.

- Observation: the RPC client cleanup path benefits from precise listener
  removal instead of dropping an entire IPC channel.
  Evidence: the current implementation now uses
  `this.ipc.removeListener(this.id, this.ipcListener)` during `destroy()`.
  Impact: the suite can assert instance-specific teardown without sharing or
  deleting unrelated channel listeners.

- Observation: `lib/utils/rpc.ts` was also hard to import safely in a unit test
  because it pulled in Electron IPC at module load.
  Evidence: once the suite stopped using `mock.module('../../lib/utils/ipc')`,
  `bun test --concurrent test/unit/rpc-client.test.ts` failed before running
  assertions because importing the module tried to resolve Electron IPC
  immediately.
  Impact: Stage B needed a narrow production seam so the test could inject a
  mock IPC bridge without any module-level mocking.

- Observation: `docs/developers-guide.md` already documents the `9.3.2`
  transition away from serialized defaults and keeps serialized scripts only as
  diagnostic tools.
  Impact: this milestone's documentation update must be framed as a focused
  concurrent stress path, not as a change to the default gate.

## Decision log

- Decision: keep the plan tightly scoped to the two roadmap-named suites and
  the developer guidance required to exercise them.
  Rationale: roadmap item `9.3.3` is a focused follow-on from `9.3.2`, not a
  general retest of every concurrency hotspot.

- Decision: prefer per-test harness factories over global `beforeEach()` state
  resets as the primary remediation pattern.
  Rationale: explicit `--concurrent` failures are caused by overlapping access
  to shared mutable bindings, and a factory per test removes that overlap
  rather than trying to sequence it indirectly.

- Decision: treat any production-code change in `lib/utils/rpc.ts` as
  conditional rather than assumed.
  Rationale: the current evidence proves the test harness is unsafe under
  concurrency, but it does not yet prove that the production unsubscribe path
  is wrong once the harness is isolated.

- Decision: add a narrow production seam to `lib/utils/rpc.ts` after the test
  harness rewrite exposed module-load coupling to Electron IPC.
  Rationale: injecting IPC, window state, and deferred ready registration lets
  the unit suite avoid module mocks entirely, which is a stronger concurrency
  fix than trying to coordinate shared mock state across overlapping tests.

- Decision: require durable tee'd logs for both the focused concurrent stress
  loop and the standard repository gates.
  Rationale: the user expects exact artefact paths and repeatable evidence for
  any roadmap closure.

- Decision: keep `test/unit/term-report-renderer.test.ts` concurrency-safe by
  serializing access to Happy DOM through a per-test harness, not by weakening
  the tests with `test.serial()`.
  Rationale: `setupHappyDom()` already owns the cross-file lease that protects
  browser-like globals, so the missing piece was to stop sharing harness state
  through file-scope variables.

- Decision: resolve `ipcRenderer` lazily through `window.require('electron')`
  only when constructor injection is absent.
  Rationale: this preserves production runtime behaviour, keeps the test-only
  injection seam, and avoids bundling the `createRequire(import.meta.url)` path
  that produced an IIFE build warning.

## Outcomes & retrospective

Roadmap item `9.3.3` is complete.

`test/unit/rpc-client.test.ts` now uses a per-test harness with its own IPC
listener registry, deferred-ready queue, and `windowHost` instead of shared
file-scope mocks and global `window` mutation. `lib/utils/rpc.ts` now supports
that isolation through constructor injection and removes only the instance's
IPC listener during `destroy()`.

`test/unit/term-report-renderer.test.ts` now uses an async per-test harness
that holds the Happy DOM lease for the full test, creates a fresh transport
mock and dynamic `Term` import per test, and explicitly resets renderer-metric
helper state during cleanup. The suite retains its original behavioural
coverage while removing shared call-count and cache bleed.

Validation evidence:

- `bun install`:
  `/tmp/bun-install-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`
- `make build`:
  `/tmp/build-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`
- `make check-fmt`:
  `/tmp/check-fmt-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`
- `make lint`:
  `/tmp/lint-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`
- `make test`:
  `/tmp/test-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`
- focused concurrent loop:
  `/tmp/concurrent-focus-final-velocetty-9-3-3-isolate-renderer-event-and-renderer-metric-tests.out`

Lesson for later roadmap items `9.3.4` through `9.3.7`: when Bun's explicit
concurrency reveals leakage, the stable fix is usually to move every mutable
fixture and cleanup handle behind a per-test harness rather than adding more
aggressive `beforeEach()` resets around shared file-scope state.
