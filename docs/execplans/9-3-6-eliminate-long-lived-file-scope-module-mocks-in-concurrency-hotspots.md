# Eliminate module-mock hotspot lifetimes (roadmap 9.3.6)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Roadmap item `9.3.6` exists because roadmap item `9.3.2` restored the default
parallel unit-test gate, but three remaining hotspot suites still keep
process-wide mocks or globals alive longer than a single test. The roadmap is
explicit that these suites must stop relying on `afterAll(...)` cleanup for
`mock.module(...)` registrations, temporary `window` installs, and similar
process-global shims:

- `test/unit/runtime-tab-provider-registration.test.ts`
- `test/unit/command-registry-compat.test.ts`
- `test/unit/config-import-json5.test.ts`

After this work, a developer should be able to run the focused hotspot probe
repeatedly and see stable assertions with no suite relying on whole-file
restoration of process-wide mocks or globals:

```bash
bun test --concurrent \
  test/unit/runtime-tab-provider-registration.test.ts \
  test/unit/command-registry-compat.test.ts \
  test/unit/config-import-json5.test.ts
```

Observable success for this milestone means:

1. Each named suite owns its module mocks and global shims at per-test
   lifetime, either through `afterEach(...)` cleanup or a test-owned helper
   that restores state in `finally`.
2. Temporary `window` leases and similar globals are restored after each test,
   not after the whole file.
3. The focused concurrent probe passes repeatedly after the refactor, and the
   full required gate stack passes with durable logs.
4. `docs/developers-guide.md` explains the repository rule that
   concurrency-sensitive unit tests must not keep process-wide module mocks or
   globals alive until `afterAll(...)`.
5. `docs/roadmap.md` is marked done only after the implementation, focused
   stress validation, documentation sync, and required gates all succeed.

Implementation is complete. All gates passed, the 20-run focused concurrent
stress loop is green, and documentation is synchronized.

## Repository orientation

This milestone is narrower than `9.3.5`, but the three named suites do not all
fail for the same reason.

`test/unit/runtime-tab-provider-registration.test.ts` currently re-registers
four `mock.module(...)` hooks in `beforeEach(...)`, shares
`rendererConfigSubscriptions` and `rendererConfig` at file scope, then calls
`mock.restore()` only in `afterAll(...)`. The suite already uses a unique
query-string import for `../../lib/utils/plugins.ts`, so the likely fix is a
per-test harness that installs mocks, imports the module, and restores the
mocked module graph immediately after the test. The risk is that
`lib/utils/plugins.ts` performs import-time runtime-provider registration and
maintains module caches, so this suite may need stronger harness teardown than
simple mock call resets.

`test/unit/command-registry-compat.test.ts` installs its transport mock at
file scope, installs `window.focusActiveTerm` in `beforeAll(...)`, and restores
the window only in `afterAll(...)`. This is a structural violation of the
roadmap even though the current focused concurrent probe passes. The important
detail is that `lib/command-registry.ts` binds the legacy
`window.focusActiveTerm()` call during module evaluation, so the test window
must exist before each dynamic import of that module.

`test/unit/config-import-json5.test.ts` is the highest-risk hotspot. It
creates one shared temporary workspace root, one shared `mockPaths` object, and
three top-level `mock.module(...)` registrations. The suite resets directories
and `console.warn` in `beforeEach(...)`, but `mock.restore()` and final
workspace deletion happen only in `afterAll(...)`. In parallel, the production
module `app/config/import.ts` imports path constants at module scope and keeps
module-level state such as `defaultConfig`, so isolating this suite may require
either a stronger per-test harness or a very small production seam.

Adjacent roadmap work establishes the expected shape of the fix:

- `9.3.2` kept the default gate parallel and pushed hotspot hardening into
  follow-up tasks, so this work must not reintroduce serialized defaults.
- `9.3.3`, `9.3.4`, and `9.3.5` all converged on the same repository rule:
  per-test ownership beats file-scope mutable cleanup state in suites that are
  supposed to survive explicit `--concurrent` runs.
- `docs/developers-guide.md` already has a dedicated concurrency-hardening
  section for `9.3.2` through `9.3.5`, so `9.3.6` should extend that section
  rather than invent a new documentation location.

The most likely implementation surface is:

- `test/unit/runtime-tab-provider-registration.test.ts`
- `test/unit/command-registry-compat.test.ts`
- `test/unit/config-import-json5.test.ts`
- `docs/developers-guide.md`
- `docs/roadmap.md`

The following files may need narrow changes only if the test harnesses cannot
be isolated cleanly without them:

- `test/testUtils/global-window.ts`
- `lib/utils/plugins.ts`
- `lib/command-registry.ts`
- `app/config/import.ts`

## Constraints

- Keep this milestone scoped to roadmap item `9.3.6`. Do not silently absorb
  timer or logger seam work from `9.3.7`, and do not promote `--concurrent` to
  the default unit-test gate from `9.3.8`.
- Do not solve this by restoring serialized defaults, adding `test.serial(...)`
  to the hotspot files, weakening assertions, or hiding the global lifetime
  problem behind broader file-level cleanup.
- Prefer test-harness lifetime fixes first. Production code should change only
  when a named suite cannot be isolated without a small, behaviour-preserving
  seam.
- Preserve existing user-visible and test-visible behaviour in
  `lib/utils/plugins.ts`, `lib/command-registry.ts`, and `app/config/import.ts`.
  This roadmap item is about isolation and cleanup lifetime, not about changing
  renderer plugin, command-registry, or JSON5 config semantics.
- Keep the default `make test` workflow unchanged. Focused
  `bun test --concurrent ...` probes are supplemental stress checks, not a new
  default gate.
- Update `docs/developers-guide.md` in the same implementation with the exact
  repository rule that prevents this class of hotspot from returning.
- Update `docs/roadmap.md` only after the focused stress loop and the required
  gate stack succeed.
- Capture every focused probe and required gate with `tee` under `/tmp/` so the
  branch has durable evidence.
- Implementation may proceed only after explicit user approval of this plan.

## Tolerances (exception triggers)

- Scope: if isolating `9.3.6` requires touching more than roughly 8 files or
  500 net new lines, stop and re-evaluate whether the milestone should be
  split.
- Production impact: if any hotspot requires a broader redesign of renderer
  plugin registration, command-registry semantics, or config-loader ownership,
  stop and escalate with concrete options.
- Interfaces: if a public API or user-facing runtime contract must change, stop
  and escalate instead of silently broadening the milestone.
- Dependencies: if a new third-party helper or runtime dependency is required,
  stop and escalate.
- Validation: if the focused concurrent stress loop still fails after two
  remediation passes, stop and report the remaining failure signatures and log
  paths.
- Ambiguity: if the right `9.3.6` fix for `config-import-json5` is unclear
  between a test-only harness change and a small production seam, stop and
  present the trade-offs before implementing the broader path.
- External blockers: if `bun install`, `make build`, `make check-fmt`,
  `make lint`, or `make test` fail for reasons unrelated to this milestone, do
  not mark the roadmap item done.

## Risks

- Risk: the hotspot suites are structurally non-compliant with the roadmap even
  when the focused concurrent probe happens to pass.
  Severity: high
  Likelihood: high
  Mitigation: treat inspection findings as first-class evidence. Do not use a
  green probe as justification to skip the cleanup lifetime refactor.

- Risk: `lib/utils/plugins.ts` performs import-time provider registration and
  keeps caches that can outlive a single test import.
  Severity: medium
  Likelihood: medium
  Mitigation: isolate the runtime-tab-provider suite with a per-test import
  harness first; touch production code only if teardown cannot be made
  deterministic from the test side.

- Risk: `lib/command-registry.ts` captures `window.focusActiveTerm()` at module
  evaluation time, so a file-scope `window` lease can mask the real lifetime
  problem.
  Severity: medium
  Likelihood: high
  Mitigation: require the test-owned window install to happen before each
  import and restore it after each test.

- Risk: `app/config/import.ts` imports path constants at module scope and keeps
  module-level state, while the current suite also shares one workspace root.
  Severity: high
  Likelihood: high
  Mitigation: give each test its own temporary workspace and module-mock
  lifetime first; if that is still not enough, introduce the smallest possible
  production seam and document why it was necessary.

- Risk: documentation drift could leave future contributors copying the
  forbidden pattern back into new tests.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/developers-guide.md` in the same change with a
  concrete rule and the exact focused stress command for `9.3.6`.

## Implementation outline

### Stage A: preserve the current baseline and confirm the live debt

The branch already has a captured five-run focused probe at:

```plaintext
/tmp/concurrent-9-3-6-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out
```

That probe passed across all five runs on 2026-03-22. This is a discovery, not
an exit condition. The roadmap item is still live because file inspection shows
that the suites continue to rely on long-lived process-wide mocks and globals.

When implementation begins, preserve this baseline in the plan notes, then
rerun the same probe after each meaningful harness change. Because the current
failure mode is structural rather than consistently red, use a repeated loop
after the refactor rather than relying on one green run.

### Stage B: isolate `runtime-tab-provider-registration` to per-test mock lifetimes

Refactor `test/unit/runtime-tab-provider-registration.test.ts` so each test
owns all of the following:

- renderer config state
- config subscription collection
- `subscribeRendererConfigMock`
- module-mock registration for config, notify, remote-plugins, and
  `ipc-child-process`
- the imported `lib/utils/plugins.ts` instance
- the matching mock restore path

The preferred shape is an async helper such as
`createRuntimeTabProviderHarness()` that:

1. allocates test-local renderer state
2. registers the four `mock.module(...)` hooks
3. imports `../../lib/utils/plugins.ts` with a unique query-string suffix
4. returns the imported module plus helper methods for toggling config and
   running cleanup

The key outcome is that `mock.restore()` is no longer deferred to `afterAll`.
If per-test import isolation still leaves provider-registration residue, inspect
`lib/utils/plugins.ts` and add only the smallest seam needed for deterministic
teardown.

### Stage C: isolate `command-registry-compat` lifetimes

Refactor `test/unit/command-registry-compat.test.ts` so the transport mock and
the temporary `window.focusActiveTerm` shim are both installed and restored per
test.

The likely shape is an async helper such as
`createCommandRegistryCompatHarness()` that:

1. installs a test-local `window` using `installTestWindow(...)`
2. registers the transport `mock.module(...)` hook before import
3. imports `../../lib/command-registry.ts` with a unique query-string suffix
4. returns the registry exports and test-local mocks
5. restores `window` and module mocks during cleanup

Keep the current behavioural assertions intact:

- undefined handler registration does not mutate the registry
- compatibility aliases still point at the same primary functions
- the legacy `editor:search-close` handler still dispatches the expected action
  and focuses the active terminal

If `test/testUtils/global-window.ts` needs a tiny helper extension to simplify
per-test cleanup, keep that change narrow and local to the same lifetime goal.

### Stage D: isolate `config-import-json5` lifetimes

Refactor `test/unit/config-import-json5.test.ts` so each test owns:

- its temporary workspace root
- the derived `mockPaths` object
- `notifyMock`, `initMock`, and the module mocks for `paths`, `init`, and
  `notify`
- any `console.warn` override
- the imported `../../app/config/import.ts` module instance
- the cleanup path for both mocks and filesystem state

The preferred shape is a per-test loader helper, for example
`createConfigImportHarness()`, that:

1. creates a unique temporary workspace root
2. builds a test-local `mockPaths` object
3. registers the three module mocks
4. imports `../../app/config/import.ts` with a unique query-string suffix
5. returns the imported module plus fixture state and cleanup

Do not keep one shared `workspaceRoot` for the whole file. Resetting a shared
directory tree is weaker than test ownership because the tests still target the
same paths and share the same imported dependency graph.

If the suite still cannot be isolated after moving workspace ownership and
mock lifetimes per test, inspect `app/config/import.ts`. The smallest
acceptable production change would be a seam that allows the tests to avoid
long-lived path capture or cached config state without changing runtime
semantics.

### Stage E: update documentation only after the behaviour is truly isolated

Extend the existing concurrency-hardening section in `docs/developers-guide.md`
with a dedicated `9.3.6` paragraph and focused probe command.

That guidance should say, in repository-specific terms:

- explicit `--concurrent` hotspot probes supplement `make test`
- suites expected to survive those probes must not keep `mock.module(...)`
  registrations alive at file scope
- temporary `window` installs and other process-global shims must be restored
  after each test, not in `afterAll(...)`
- per-test harness helpers that return cleanup callbacks are the preferred
  pattern

Update `docs/roadmap.md` only after the implementation and validation are both
complete.

### Stage F: validate the hotspot fix and then run the required gates

Once the harness changes are in place, run the focused probe repeatedly with
durable logs:

```bash
set -o pipefail
for run in $(seq 1 20); do
  echo "== 9.3.6 focused concurrent probe run ${run} =="
  bun test --concurrent \
    test/unit/runtime-tab-provider-registration.test.ts \
    test/unit/command-registry-compat.test.ts \
    test/unit/config-import-json5.test.ts
  echo
done | tee /tmp/concurrent-9-3-6-velocetty-$(git branch --show).out
```

If the focused probe is stable, run the required gate stack in order:

```bash
set -o pipefail
bun install | tee /tmp/install-velocetty-$(git branch --show).out
make build | tee /tmp/build-velocetty-$(git branch --show).out
make check-fmt | tee /tmp/check-fmt-velocetty-$(git branch --show).out
make lint | tee /tmp/lint-velocetty-$(git branch --show).out
make test | tee /tmp/test-velocetty-$(git branch --show).out
```

Because this milestone edits Markdown, also run the repository's Markdown
validation after the docs are updated:

```bash
set -o pipefail
bunx markdownlint-cli2 "docs/**/*.md" | tee /tmp/markdownlint-velocetty-$(git branch --show).out
```

Do not mark `9.3.6` done until:

- the focused concurrent loop is green
- all required gates are green
- the docs are synchronized
- the roadmap entry is updated in the same change set

## Progress

- [x] 2026-03-22 03:00Z: Reviewed roadmap item `9.3.6`, the current
  developers-guide concurrency guidance, and adjacent `9.3.2` through `9.3.5`
  execplans.
- [x] 2026-03-22 03:07Z: Inspected the three named hotspot suites plus the
  directly related helpers and production modules to identify the current
  long-lived mock and global lifetimes.
- [x] 2026-03-22 03:10Z: Captured a five-run focused concurrent baseline at
  `/tmp/concurrent-9-3-6-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`;
  all runs passed, confirming that the remaining work is structural cleanup
  debt rather than a reliably red probe.
- [x] 2026-03-22 03:12Z: Collected agent-team findings on roadmap boundaries,
  existing developer guidance, and per-suite lifetime risks.
- [x] 2026-03-22 11:03Z: User explicitly requested implementation of this
  approved execplan, so work moved from draft planning into execution.
- [x] 2026-03-22 11:49Z: Refactored the three hotspot suites so cleanup is
  test-owned. `runtime-tab-provider-registration` now uses a per-test module
  harness, `command-registry-compat` now uses an injected command-registry
  factory instead of transport/window module mocks, and
  `config-import-json5` now uses an injected config-import factory instead of
  file-scope mocked paths/init/notify modules.
- [x] 2026-03-22 11:57Z: Updated `docs/developers-guide.md` with the `9.3.6`
  concurrency rule and focused probe command. Roadmap sync remains pending
  until validation is complete.
- [x] 2026-03-22 12:06Z: Completed the 20-run focused concurrent stress loop
  and captured green results in
  `/tmp/concurrent-9-3-6-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`.
- [x] 2026-03-22 12:15Z: Completed the required gate stack with durable logs:
  `/tmp/install-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`,
  `/tmp/build-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`,
  `/tmp/check-fmt-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`,
  `/tmp/lint-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`,
  `/tmp/test-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`,
  and
  `/tmp/markdownlint-velocetty-9-3-6-eliminate-long-lived-file-scope-module-mocks-in-concurrency-hotspots.out`.
- [x] 2026-03-22 12:17Z: Marked `docs/roadmap.md` item `9.3.6` complete after
  the focused stress loop, required gates, and docs sync all succeeded.

## Surprises & discoveries

- The current focused concurrent probe passed across five runs on 2026-03-22.
  That does not invalidate the roadmap item. It means `9.3.6` is primarily
  about removing latent lifetime debt that still violates the documented
  concurrency rules.
- `lib/command-registry.ts` binds `window.focusActiveTerm()` during module
  evaluation, so the command-registry compatibility suite must install its test
  window before importing the module under test.
- `test/unit/config-import-json5.test.ts` has two overlapping lifetime issues:
  file-scope module mocks and a shared temporary workspace root. Fixing only
  one of those is unlikely to satisfy the roadmap intent.
- `lib/utils/plugins.ts` performs import-time runtime-provider registration, so
  the runtime-tab-provider suite may need a fuller per-test import harness than
  the other two files.
- Bun's `mock.module(...)` lifetime is still process-global enough that naive
  per-test `mock.restore()` cleanup can race inside the same hotspot file.
  `command-registry-compat` and `config-import-json5` both needed narrow
  production factories so tests could inject transport, focus, path, init, and
  notify dependencies without sharing module mocks across tests.

## Decision log

- 2026-03-22 03:06Z: Use a plan-only pass. The user explicitly requested an
  ExecPlan and reminded that implementation requires prior approval, so this
  document stays in `DRAFT` status and no implementation work starts now.
- 2026-03-22 03:09Z: Treat `9.3.6` as a structural cleanup milestone even if
  the focused concurrent probe is currently green. The roadmap requirement is
  about lifetime ownership, not only about reproducing a red failure.
- 2026-03-22 03:11Z: Prefer test-harness ownership changes first and reserve
  production seams for the cases where import-time module state makes a
  harness-only fix insufficient.
- 2026-03-22 03:12Z: Keep `docs/developers-guide.md` as the primary developer
  guidance update for this milestone and do not expand documentation scope
  unless implementation reveals a conflicting source of truth.
- 2026-03-22 03:13Z: Set the post-fix focused stress loop to 20 runs. The
  current baseline already passed 5 runs, so a stronger repeated check is
  needed to prove that the refactor did not merely preserve a lucky streak.
- 2026-03-22 11:24Z: Escalate from harness-only changes to narrow
  behaviour-preserving production seams after confirming that Bun's
  process-global module-mock restoration still leaked across tests in the same
  hotspot files during explicit `--concurrent` runs.
- 2026-03-22 11:43Z: Keep the production seam narrow by injecting only the
  dependencies that were previously being mocked globally:
  `command-registry` now accepts transport invocation and focus callbacks for
  test-created instances, and `config/import` now exposes a factory for
  paths/init/notify dependencies while leaving the default exports unchanged.

## Outcomes & retrospective

Implementation completed. The hotspot suites now use test-owned cleanup, the
required narrow production factories are in place where Bun's module-mock
lifetime still leaked across tests, the 20-run focused concurrent probe is
green, the required gate stack is green, and the roadmap/docs are synchronized
in the same change set.
