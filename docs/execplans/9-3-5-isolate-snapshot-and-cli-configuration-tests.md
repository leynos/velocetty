# Isolate snapshot and CLI configuration tests (roadmap 9.3.5)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Roadmap item `9.3.5` exists because roadmap item `9.3.2` restored the default
parallel unit-test gate, but two remaining suites still depend on process-wide
state when Bun is told to run tests explicitly with `--concurrent`.
`test/unit/v8-snapshot-util.test.ts` mutates snapshot bootstrap globals and
depends on a top-level module side effect that patches `Module._load`.
`test/unit/cli-api-behaviour.test.ts` mutates process environment variables,
uses file-scope mutable mock state, and imports `cli/api.ts`, which captures
config-path and memoized plugin state at module evaluation time.

After this work, a developer should be able to run the roadmap's focused
stress command repeatedly and see stable snapshot and CLI assertions with no
cross-test bleed, no stale config-path capture, and no inherited loader state:

```bash
bun test --concurrent \
  test/unit/v8-snapshot-util.test.ts \
  test/unit/cli-api-behaviour.test.ts
```

Observable success for this milestone means:

1. `test/unit/v8-snapshot-util.test.ts` no longer shares runtime globals or a
   patched `Module._load` across overlapping tests.
2. `test/unit/cli-api-behaviour.test.ts` no longer shares config-path,
   plugin-config, request-history, or mocked-module state across overlapping
   tests.
3. `docs/developers-guide.md` documents the concurrency-safe development rules
   that fall out of this fix, including the focused `9.3.5` stress command.
4. `docs/roadmap.md` is marked done only after `bun install`, `make build`,
   `make check-fmt`, `make lint`, and `make test` pass, and the focused
   explicit-concurrency stress loop passes repeatedly with durable logs.

## Repository orientation

This milestone is intentionally narrow. The roadmap names exactly two target
test files and one focused success command, but the root causes cross into two
production modules.

`lib/v8-snapshot-util.ts` is now a top-level bootstrap shim that routes its
import-time side effect through the explicit `bootstrapSnapshotRuntime(...)`
seam. That seam resolves the runtime `require`, patches `Module._load`,
registers snapshot globals, and returns a restoration handle so tests can
prove loader cleanup deterministically. `test/unit/v8-snapshot-util.test.ts`
now uses explicit runtime-host fixtures instead of mutating `globalThis`.

`cli/api.ts` is now built around `createCliApi(...)`, which resolves config
path, memoized config readers, and registry access per API instance instead of
forcing the behaviour suite to share module-evaluation state. The behaviour
suite now builds isolated per-test harnesses with injected filesystem,
registry, and environment state instead of using file-scope `mock.module(...)`
registrations and shared mutable bindings.

Recent adjacent roadmap work provides the expected shape of the fix:

- `docs/execplans/9-3-2-restore-parallel-unit-test-execution.md` already
  established that `--concurrent` is a stricter stress mode than the default
  Bun unit gate, and it specifically named `v8-snapshot-util` and
  `cli-api-behaviour` as the outstanding hotspot suites.
- `docs/execplans/9-3-4-isolate-filesystem-bootstrap-helper-tests.md`
  established the repository rule that concurrency-sensitive tests must use
  per-test fixture ownership instead of file-scope mutable cleanup state.
- `docs/developers-guide.md` already documents the explicit-concurrency probes
  for `9.3.3` and `9.3.4`, so `9.3.5` should extend that section rather than
  inventing a new documentation location.

The most likely implementation surface is:

- `lib/v8-snapshot-util.ts`
- `test/unit/v8-snapshot-util.test.ts`
- `cli/api.ts`
- `test/unit/cli-api-behaviour.test.ts`
- `docs/developers-guide.md`
- `docs/roadmap.md`

`test/testUtils/mock-node-fs.ts` should only be touched if a small helper
adjustment materially reduces duplication in the CLI suite.

## Constraints

- Keep this milestone scoped to roadmap item `9.3.5`. Do not silently absorb
  `9.3.6` or later hotspot cleanups unless the same tiny seam is required to
  complete the named success command.
- Do not restore serialized defaults, add `test.serial(...)` to the target
  suites, or weaken the roadmap success command. The point is explicit
  `--concurrent` safety, not hiding the race.
- Preserve the user-visible behaviour of `lib/v8-snapshot-util.ts` and
  `cli/api.ts`. The fix may refactor how bootstrap/config state is obtained or
  reset, but it must not change snapshot semantics, plugin install semantics,
  JSON5 parsing behaviour, or config-path resolution rules.
- Prefer explicit seams over hidden mutable state. For snapshot code, that
  means a way to bootstrap and restore the loader deterministically. For CLI
  config code, that means resolving config-path and parsed-config state from a
  runtime context or test-controlled factory rather than from module
  evaluation.
- Keep the snapshot tests proving both behaviours: virtual modules must resolve
  through `customRequire`, and native modules must still fall back to the
  original loader.
- Keep the CLI suite proving both config-path branches (`config.json5` and
  `hyper.json`), JSON5 plugin parsing, npm existence checks, install, and
  uninstall behaviour.
- Update `docs/developers-guide.md` in the same implementation with the exact
  development rules that prevent this class of flake from returning.
- Update `docs/roadmap.md` only after all implementation and validation steps
  pass.
- Use tee'd logs under `/tmp/` for the focused concurrency loop and each
  required top-level gate.
- Implementation may proceed only after explicit approval. Approval was
  received on 2026-03-14 before the code changes in this document landed.

## Tolerances (exception triggers)

- Scope: if isolating `9.3.5` requires touching more than roughly 7 files or
  450 net new lines, stop and re-evaluate whether the work should be split or
  whether a broader architecture discussion is needed.
- Production semantics: if fixing either suite requires changing the public
  contract of `cli/api.ts` consumers or altering runtime snapshot behaviour in
  a user-visible way, stop and escalate with options and trade-offs.
- Dependencies: if a new third-party test helper or runtime dependency is
  required, stop and escalate.
- Test strategy: if the only apparent fix is to serialize the file, skip
  assertions, or add timing sleeps, stop and escalate instead of shipping a
  brittle workaround.
- Validation: if the focused `--concurrent` stress loop still fails after two
  focused remediation passes, stop and report the remaining failure signatures
  and log paths.
- Breadth: if adjacent suites such as `test/unit/cli-api.test.ts` begin
  failing because the CLI module refactor changes an implicit contract, stop
  and decide whether that fallout remains within `9.3.5` or belongs in a
  follow-up milestone.

## Risks

- Risk: the snapshot suite's visible failure is caused by both global cleanup
  gaps and by a top-level loader patch that outlives the test import.
  Severity: high
  Likelihood: high
  Mitigation: first capture the current failing signatures, then refactor the
  bootstrap logic to return or expose a restoration path that the tests can
  assert directly.

- Risk: `cli/api.ts` may have more consumers than the target behaviour suite,
  and moving from module-evaluation state to runtime-resolved state could
  affect neighbouring tests.
  Severity: medium
  Likelihood: medium
  Mitigation: keep the refactor narrow, prefer an internal factory or resolver
  seam, and reverify `test/unit/cli-api.test.ts` if `cli/api.ts` changes.

- Risk: file-scope `mock.module(...)` registrations and shared mutable bindings
  inside `test/unit/cli-api-behaviour.test.ts` can still race even if
  `cli/api.ts` is partially improved.
  Severity: high
  Likelihood: high
  Mitigation: make each test own its mocked state and environment, and restore
  module mocks after each test rather than only at file end or never.

- Risk: the explicit-concurrency command may pass once and still be flaky.
  Severity: high
  Likelihood: medium
  Mitigation: require a repeated focused loop, not a single passing run, before
  calling the roadmap item done.

- Risk: documentation drift can leave future contributors reintroducing
  file-scope mutable mock state or module-evaluation capture in new tests.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/developers-guide.md` with concrete repository rules
  tied to the exact stress command and failure class for `9.3.5`.

## Implementation outline

### Stage A: capture and preserve the failing baseline

Start by reproducing the exact roadmap command with durable logs. The current
branch already fails repeatedly, and the plan should preserve at least one log
that shows the real failure signatures before any edits are made.

Use a loop such as:

```bash
set -o pipefail
for run in $(seq 1 10); do
  echo "== 9.3.5 concurrent probe run ${run} =="
  bun test --concurrent \
    test/unit/v8-snapshot-util.test.ts \
    test/unit/cli-api-behaviour.test.ts
  echo
done | tee /tmp/concurrent-9-3-5-velocetty-$(git branch --show).out
```

Today that probe already shows the roadmap's failure classes:

- snapshot assertions receive native module results for `virtual:*` lookups
  instead of `custom:*`
- the missing-require snapshot test resolves instead of rejecting
- CLI config-path assertions see the repository's real `config.json5` path
  instead of the per-test XDG path
- CLI request-history and plugin-state expectations accumulate values from
  overlapping tests
- some runs end in widespread CLI timeouts after shared mock state wedges the
  suite

Record the baseline log path in the eventual implementation notes.

### Stage B: isolate snapshot bootstrap from process-global loader state

Refactor `lib/v8-snapshot-util.ts` so the bootstrap side effect can be applied
and restored deterministically. The preferred shape is a tiny internal helper
or exported bootstrap/reset seam that:

1. resolves the runtime `require`
2. captures the original `Module._load`
3. installs the snapshot-aware `_load` wrapper
4. returns enough information to restore the original loader

Keep the runtime import behaviour unchanged for production callers. If the
production module must still execute on import, keep that top-level path, but
route it through the new seam so the tests can directly exercise install and
restore behaviour.

Update `test/unit/v8-snapshot-util.test.ts` so each test owns all state it
installs:

- runtime globals (`snapshotResult`, `require`, `window`, `document`)
- any bootstrap handle or loader restore callback
- any module import or seam invocation used for the specific assertion

Do not rely on file-wide `afterEach(...)` as the only protection if tests in
the file can overlap. Prefer per-test `try/finally` cleanup or a small helper
that returns `{restore, ...state}` to the test.

Strengthen the suite enough to prove cleanup, not just behaviour. In addition
to preserving the current assertions, add a direct proof that the original
`Module._load` is restored after each bootstrap run so later tests cannot
inherit a stale wrapper.

### Stage C: isolate CLI config tests from module-evaluation capture

Refactor `cli/api.ts` to remove the pieces of state that are frozen too early:

- `applicationDirectory`
- `fileName`
- the exported `configPath`
- memoized file/config/plugin lookups that outlive a specific test context

The safest shape is a runtime resolver or internal factory that computes the
config path and memoized readers from the current environment and a dependency
set. The production exports can keep the same surface area, but they should
delegate to a current context instead of sharing hidden file-scope state across
tests.

Refactor `test/unit/cli-api-behaviour.test.ts` so each test has its own state
container instead of mutating file-scope bindings. A good target shape is a
per-test harness that creates:

- config data and saved-config capture
- request history
- `got` response/error state
- filesystem existence and file-content state
- environment overrides
- module mocks tied to that harness only

The critical rule is that a mock closure must read only from that test's
private state, never from a file-scope mutable binding shared with other
tests.

Restore `mock.module(...)` state and environment variables after each test.
Query-string cache busting can remain useful, but it becomes a secondary guard,
not the primary isolation mechanism.

### Stage D: update developer guidance

Extend the existing concurrency-isolation section in `docs/developers-guide.md`
with the exact `9.3.5` stress command:

```bash
bun test --concurrent \
  test/unit/v8-snapshot-util.test.ts \
  test/unit/cli-api-behaviour.test.ts
```

Document the development rules that this roadmap item establishes:

- snapshot/bootstrap tests must restore any patched loader state and all
  installed globals within the test that created them
- query-string import busting alone is not isolation if the imported module
  still captures process-global state or if mocks and env are shared
- CLI/config tests must avoid file-scope mutable mock state and shared
  `process.env` mutation when they are expected to survive explicit
  `--concurrent` runs

If the implementation materially clarifies the design-level testing contract,
consider a small wording update in `docs/velocetty-design.md` too, but keep
that optional unless the plan discovers real ambiguity during implementation.

### Stage E: validate, close the roadmap item, and preserve evidence

After code and docs are updated, run the required gate stack in order with
durable logs:

```bash
set -o pipefail
bun install | tee /tmp/bun-install-velocetty-$(git branch --show).out
make build | tee /tmp/build-velocetty-$(git branch --show).out
make check-fmt | tee /tmp/check-fmt-velocetty-$(git branch --show).out
make lint | tee /tmp/lint-velocetty-$(git branch --show).out
make test | tee /tmp/test-velocetty-$(git branch --show).out
```

Then rerun the focused concurrency stress loop until there is strong evidence
the flake is gone. Ten clean iterations is a reasonable floor:

```bash
set -o pipefail
for run in $(seq 1 10); do
  echo "== 9.3.5 verification run ${run} =="
  bun test --concurrent \
    test/unit/v8-snapshot-util.test.ts \
    test/unit/cli-api-behaviour.test.ts
  echo
done | tee /tmp/concurrent-9-3-5-verify-velocetty-$(git branch --show).out
```

If `cli/api.ts` changes in a way that could affect adjacent tests, also run the
neighbouring CLI suite explicitly before closing the roadmap item:

```bash
bun test test/unit/cli-api.test.ts
```

Only after all of the above pass should `docs/roadmap.md` mark `9.3.5` done.

## Validation checklist

The implementation is complete only when all of the following are true:

1. The focused `--concurrent` command above passes repeatedly with stable
   snapshot and CLI expectations.
2. `test/unit/v8-snapshot-util.test.ts` proves loader restoration as well as
   snapshot behaviour.
3. `test/unit/cli-api-behaviour.test.ts` no longer uses shared file-scope
   mutable state as the source of truth for mocks and environment.
4. `docs/developers-guide.md` documents the new concurrency-safe development
   practice for this hotspot.
5. `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
   all succeed with tee'd logs.
6. `docs/roadmap.md` marks `9.3.5` done only after those validations succeed.

## Progress

- [x] (2026-03-14 15:23Z) Verified the current branch name is
  `9-3-5-isolate-snapshot-and-cli-configuration-tests`, which matches the
  requested ExecPlan path.
- [x] (2026-03-14 15:28Z) Loaded the governing repo instructions, the execplans
  and leta skills, the roadmap entry, the design testing section, and the
  adjacent `9.3.2` and `9.3.4` execplans.
- [x] (2026-03-14 15:31Z) Created a shared context pack and dispatched an agent
  team to inspect snapshot and CLI concurrency bleed separately.
- [x] (2026-03-14 15:36Z) Reproduced the roadmap failure with repeated focused
  `bun test --concurrent` runs and captured the baseline log at
  `/tmp/concurrent-9-3-5-velocetty-$(git branch --show)-probe.out`.
- [x] (2026-03-14 15:39Z) Drafted this ExecPlan with explicit implementation,
  validation, and documentation requirements.
- [x] (2026-03-14 16:07Z) Received explicit approval to begin implementation.
- [x] (2026-03-14 16:31Z) Refactored `lib/v8-snapshot-util.ts` around the
  explicit `bootstrapSnapshotRuntime(...)` seam and rewrote
  `test/unit/v8-snapshot-util.test.ts` to use test-owned runtime hosts and
  loader restoration assertions.
- [x] (2026-03-14 16:36Z) Refactored `cli/api.ts` around `createCliApi(...)`
  and rewrote `test/unit/cli-api-behaviour.test.ts` to use isolated per-test
  harnesses instead of shared module mocks and shared environment mutation.
- [x] (2026-03-14 16:39Z) Updated `docs/developers-guide.md` with the focused
  `9.3.5` stress command and the new snapshot/bootstrap and CLI-config test
  isolation rules.
- [x] (2026-03-14 16:48Z) Ran `bun install`, `make build`, `make check-fmt`,
  `make lint`, `make test`, `bun test test/unit/cli-api.test.ts`, and a
  ten-run focused `bun test --concurrent` verification loop with tee'd logs;
  all passed.
- [x] (2026-03-14 16:50Z) Updated `docs/roadmap.md` to mark `9.3.5` done
  after the validation evidence was in hand.

## Surprises & discoveries

- Observation: the two target suites do not merely interfere with each other;
  each suite can also fail under `--concurrent` on its own.
  Evidence: agent-team probes and the focused baseline both showed intra-suite
  races, including snapshot missing-require false positives and CLI timeout
  cascades.
  Impact: the fix must isolate per-test state inside each file, not only avoid
  cross-file collisions.

- Observation: `lib/v8-snapshot-util.ts` currently patches `Module._load`
  during module evaluation and never restores it.
  Evidence: the module captures `originalLoad`, replaces `_load`, and only
  calls `snapshotResult.setGlobals(...)`; there is no restoration path.
  Impact: snapshot test isolation likely requires a production-code seam, not
  just more aggressive test cleanup.

- Observation: `cli/api.ts` freezes config-path and memoized config readers at
  import time.
  Evidence: `applicationDirectory`, `fileName`, and the exported `configPath`
  are derived at module scope, and `memoize(...)` backs `getFileContents`,
  `getParsedFile`, `getPlugins`, and `getLocalPlugins`.
  Impact: cache-busting imports help, but they are not sufficient while tests
  still race on shared env and mock state.

- Observation: the existing developers-guide section already establishes the
  pattern for hotspot-specific concurrency probes.
  Evidence: `docs/developers-guide.md` already documents the `9.3.3` and
  `9.3.4` focused `bun test --concurrent` commands.
  Impact: `9.3.5` should extend that section with a concrete new rule rather
  than adding disconnected prose elsewhere.

- Observation: the snapshot seam could stay production-safe while still
  becoming testable by returning a restoration handle from the same code path
  the import-time bootstrap uses.
  Evidence: `bootstrapSnapshotRuntime(...)` now powers both the top-level
  import path and the focused unit tests without duplicating loader-patching
  logic.
  Impact: the test no longer needs query-string import busting or
  `globalThis` mutation to validate the snapshot contract.

- Observation: the CLI hotspot did not need per-test `mock.module(...)`
  registration once the production module exposed a per-instance factory.
  Evidence: `createCliApi(...)` now accepts injected filesystem, registry, and
  environment dependencies, and the rewritten behaviour suite passes under
  repeated `--concurrent` runs without any module mocking.
  Impact: the suite is simpler, faster, and no longer depends on Bun's
  process-global mock lifetime rules.

## Decision log

- Decision: keep this document as a draft and stop after planning.
  Rationale: the user explicitly requested a plan first and said the plan must
  be approved before implementation.
  Date/Author: 2026-03-14 / Codex.

- Decision: plan around explicit seams in production modules rather than trying
  to force the tests to tiptoe around module-evaluation state.
  Rationale: both hotspot suites are failing because production modules freeze
  process-global state too early. Purely test-side workarounds would be brittle
  and would likely leave the roadmap success command flaky.
  Date/Author: 2026-03-14 / Codex.

- Decision: require repeated focused stress runs, not a single pass.
  Rationale: the current failure mode is race-sensitive, and single-run success
  would not be credible evidence for roadmap closure.
  Date/Author: 2026-03-14 / Codex.

- Decision: use a per-instance CLI factory instead of trying to make the
  existing module-scope exports test-local through more elaborate mock
  orchestration.
  Rationale: the bug was caused by hidden module-evaluation capture. A factory
  removes that capture directly and keeps the public default exports intact for
  existing consumers.
  Date/Author: 2026-03-14 / Codex.

## Outcomes & retrospective

Roadmap item `9.3.5` is complete. The snapshot bootstrap path now exposes a
deterministic restore handle through `bootstrapSnapshotRuntime(...)`, the CLI
behaviour path now runs through isolated `createCliApi(...)` instances, the
developers guide documents the new concurrency-safe testing rules, and the
focused `--concurrent` hotspot command passed ten consecutive verification
runs after the required top-level gates succeeded.
