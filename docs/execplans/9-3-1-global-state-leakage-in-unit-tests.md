# Eliminate cross-suite global state leakage in unit tests (roadmap 9.3.1)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: DRAFT

## Purpose / big picture

Roadmap item `9.3.1` exists because the repository still relies on
process-level isolation to keep one transport bootstrap test from polluting the
rest of the unit suite. Today `make test` runs two stages: the general unit
suite and then `test/unit/bootstrap-transport-integration.test.ts` in its own
Bun process behind
`VELOCETTY_RUN_BOOTSTRAP_TRANSPORT_INTEGRATION=1`. That is a containment shim,
not the final architecture.

After this work, a developer should be able to run the unit suite without the
dedicated bootstrap quarantine, randomize file order across multiple seeds, and
see no order-dependent failures caused by file-scope `mock.module(...)`,
`window`/`document` mutation, or transport/bootstrap singleton state. The
observable success conditions are:

1. `test/unit/bootstrap-transport-integration.test.ts` no longer needs the
   `VELOCETTY_RUN_BOOTSTRAP_TRANSPORT_INTEGRATION=1` gate or a dedicated Bun
   process because it targets explicit bootstrap seams instead of importing a
   side-effect-only renderer entrypoint.
2. Suites that call `setupHappyDom()` or install renderer/runtime module mocks
   own deterministic teardown in the same file, including `mock.restore()`
   where module mocks are used.
3. Repeated randomized unit runs are stable across at least three explicit
   seeds.
4. `docs/developers-guide.md` describes the new local testing practice, the
   temporary design note in `docs/velocetty-design.md` is retired, and
   `docs/roadmap.md` marks item `9.3.1` done only after all gates succeed.
5. `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
   all pass in that order.

## Repository orientation

The current leakage problem is concentrated in the renderer bootstrap and a
small set of DOM-heavy unit suites.

`lib/index.tsx` is the critical production file. On import it immediately:

- creates the Redux store,
- binds `window.store`, `window.rpc`, `window.config`, and `window.plugins`,
- loads config and subscribes to config changes,
- registers every `transport.on(...)` listener,
- mounts the React root, and
- wires plugin reload behaviour.

That design forces `test/unit/bootstrap-transport-integration.test.ts` to mock
transport, Electron, React DOM, config, store creation, action modules, plugin
helpers, and the `Hyper` container before dynamically importing
`../../lib/index.tsx`. The test is isolated today only because `package.json`
and `Makefile` run it in a separate Bun process.

The other highest-risk suites already identified by code inspection are:

- `test/unit/hyper-transport.test.ts`
- `test/unit/hyper-effects.test.ts`
- `test/unit/tabs-decoration-updates.test.ts`
- `test/unit/term-report-renderer.test.ts`
- `test/unit/runtime-tab-provider-registration.test.ts`

Shared helpers already exist and should be reused instead of duplicating new
inline mocks:

- `test/testUtils/happy-dom.ts`
- `test/testUtils/transport-mock.ts`
- `test/testUtils/plugins-mock.ts`

## Constraints

- Keep this milestone scoped to unit-test isolation and deterministic teardown.
  Do not absorb roadmap item `9.3.2` by promising fully parallel Bun execution
  in default gates. Random-order stability is required here; concurrency
  restoration belongs to the next roadmap item.
- Preserve current runtime behaviour in `lib/index.tsx`, `lib/containers/hyper`,
  `lib/components/term`, and related transport/config paths. The goal is to
  expose injectable seams without changing user-visible behaviour.
- Keep production files under the repository's size guidance. If extracting
  bootstrap helpers from `lib/index.tsx`, split them into small focused modules
  instead of moving all top-level logic into one other large file.
- Reuse existing test helper modules where possible. Extend
  `test/testUtils/transport-mock.ts` or `test/testUtils/plugins-mock.ts` before
  introducing new bespoke mock factories.
- Any suite that calls `setupHappyDom()` must own both DOM cleanup and module
  mock restoration in the same file before this roadmap item can be closed.
- Update `docs/developers-guide.md` for developer-facing test-practice changes
  in the same implementation.
- Update `docs/velocetty-design.md` and `docs/roadmap.md` when the temporary
  bootstrap-quarantine note becomes stale.
- The roadmap checkbox for `9.3.1` must remain open until the final validation
  sequence passes.

## Tolerances (exception triggers)

- Scope: if removing the bootstrap quarantine requires a broader renderer
  architecture rewrite than extracting testable bootstrap helpers and updating
  directly related suites, stop and escalate.
- Size: if the implementation grows beyond roughly 12 touched files or 700 net
  new lines outside tests and docs, stop and re-evaluate the decomposition
  before proceeding.
- Interface: if a clean seam would require changing shared public contracts
  under `shared/src/types/` or transport event payload shapes, stop and
  escalate.
- Semantics: if randomized runs reveal failures outside the renderer/bootstrap
  isolation surfaces listed in this plan, document them in `Decision Log` and
  stop before expanding scope silently.
- Validation: if `bun install`, `make build`, `make check-fmt`, `make lint`, or
  `make test` still fails after two focused remediation passes, stop and report
  the failing log paths instead of forcing closure.

## Risks

- Risk: `lib/index.tsx` may be more tightly coupled than it first appears, so a
  dependency-injection seam could accidentally change initialization order.
  Severity: high
  Likelihood: medium
  Mitigation: extract helpers that preserve the existing call order exactly,
  keep `lib/index.tsx` as the thin composition entrypoint, and add or update
  tests that assert the current `ready -> init -> session add -> session data`
  bootstrap flow.

- Risk: Bun module mocks can leak even when DOM cleanup is correct, especially
  in suites that register file-scope `mock.module(...)` and never call
  `mock.restore()`.
  Severity: high
  Likelihood: high
  Mitigation: audit every DOM-heavy or renderer-runtime suite named in this
  plan, add same-file restoration, and prefer imports that happen after
  suite-local mock registration when a module must be mocked.

- Risk: randomized runs may not fail on the first seed even though the design is
  still fragile, which can create false confidence.
  Severity: medium
  Likelihood: high
  Mitigation: use at least three fixed seeds, capture the exact commands and
  logs, and treat the three-seed pass requirement as mandatory rather than
  anecdotal.

- Risk: changing package scripts or `Makefile` too early can hide regressions by
  removing the quarantine before the new bootstrap seam is ready.
  Severity: medium
  Likelihood: medium
  Mitigation: keep the dedicated bootstrap stage in place until the new
  bootstrap tests pass in the general suite, then remove the quarantine and
  rerun the full gate sequence.

## Progress

- [x] (2026-03-06 23:53Z) Verified the branch name matches the requested
  ExecPlan path and confirmed roadmap item `9.3.1` is still open.
- [x] (2026-03-06 23:53Z) Audited roadmap, design, developers-guide, package
  scripts, `Makefile`, and the highest-risk unit suites.
- [x] (2026-03-06 23:53Z) Used an agent team to inspect the bootstrap
  quarantine and the DOM/mock-leak hotspots.
- [x] (2026-03-06 23:53Z) Drafted this ExecPlan.
- [ ] Await explicit approval before implementation.
- [ ] Stage A: reproduce or at least probe current same-process order
  sensitivity and record the baseline.
- [ ] Stage B: extract explicit bootstrap dependency-injection seams from
  `lib/index.tsx` while preserving runtime order.
- [ ] Stage C: rewrite bootstrap and renderer isolation tests to use those
  seams and deterministic mock teardown.
- [ ] Stage D: remove the quarantine from `package.json`, `Makefile`, and
  developer/design docs once the same-process suite is stable.
- [ ] Stage E: run the full validation sequence and mark roadmap item `9.3.1`
  done.

## Surprises & Discoveries

- Observation: part of roadmap item `9.3.1` is already complete.
  Evidence: `package.json` defines `test:unit:bootstrap-transport`, `Makefile`
  runs it as a second `make test` stage, and `docs/developers-guide.md`
  documents that quarantine explicitly.
  Impact: the implementation must preserve the current shim until the new
  bootstrap seam is proven, then remove it deliberately rather than treating it
  as dead code from the start.

- Observation: `test/unit/bootstrap-transport-integration.test.ts` already owns
  Happy DOM cleanup and `mock.restore()` locally, but its file-scope mock graph
  is still far broader than the roadmap intends.
  Evidence: the suite mocks transport, Electron, React DOM, store creation,
  action modules, config/file helpers, plugins, and the `Hyper` container
  before dynamically importing `../../lib/index.tsx`.
  Impact: the real fix is not a smaller cleanup block inside the test; it is an
  injectable bootstrap seam in production code.

- Observation: `test/unit/hyper-transport.test.ts`,
  `test/unit/hyper-effects.test.ts`, and
  `test/unit/tabs-decoration-updates.test.ts` all register file-scope module
  mocks and mutate DOM globals, but not all of them restore module mocks.
  Evidence: these files call `setupHappyDom()` and register mocks via
  `mock.module(...)` or helper wrappers, while only
  `test/unit/term-report-renderer.test.ts` and the bootstrap integration suite
  currently call `mock.restore()`.
  Impact: Stage C must normalize same-file lifecycle ownership before claiming
  the randomized-order success criteria.

## Decision Log

- Decision: keep this plan focused on a narrow bootstrap-extraction and
  test-isolation refactor, not a full renderer bootstrap redesign.
  Rationale: roadmap `9.3.1` is about leakage and deterministic teardown, and
  the production code already has a natural decomposition boundary at
  `lib/index.tsx`.
  Date/Author: 2026-03-06 / Codex

- Decision: treat the bootstrap quarantine as a temporary guardrail that remains
  in place until the refactored same-process tests pass.
  Rationale: deleting the guardrail early would make the repository less safe
  during the implementation instead of safer.
  Date/Author: 2026-03-06 / Codex

- Decision: the extracted bootstrap seams should separate transport listener
  registration, config initialization/subscription, and React mounting.
  Rationale: those three responsibilities are currently tangled in
  `lib/index.tsx` and map directly to the test blast radius observed in the
  bootstrap integration suite.
  Date/Author: 2026-03-06 / Codex

## Implementation plan

Stage A establishes the baseline and failure shield. First verify that the
prerequisite roadmap items `1.1.2` and `9.1.1` remain done in
`docs/roadmap.md`. Then run the current unit suite in a way that places the
bootstrap integration file back into the same Bun process as the rest of
`test/unit`:

```bash
set -o pipefail && VELOCETTY_RUN_BOOTSTRAP_TRANSPORT_INTEGRATION=1 \
  bun test --max-concurrency=1 --randomize --seed 2444615283 test/unit \
  | tee /tmp/test-baseline-$(get-project)-$(git branch --show).out
```

Repeat with two more fixed seeds. If none fail, still keep the code-inspection
findings from this plan as the justification for the refactor, but do not skip
the final three-seed validation requirement.

Stage B extracts explicit bootstrap seams from `lib/index.tsx` while preserving
today's runtime order. Keep `lib/index.tsx` as the composition boundary that
imports real dependencies and invokes extracted helpers. The extracted helpers
may live under `lib/bootstrap/` if that keeps files cohesive. The minimum seams
this plan expects are:

1. a helper that initializes config state and subscription wiring,
2. a helper that registers transport listeners against injected store/actions,
   and
3. a helper that mounts the React root against injected DOM/root-render
   dependencies.

The extraction is successful when the bootstrap transport test can exercise the
transport-listener wiring without mocking unrelated renderer modules such as the
real React root, file I/O helpers, or plugin globals unless that dependency is
directly under test.

Stage C rewrites the highest-risk suites to own lifecycle state cleanly. Start
with `test/unit/bootstrap-transport-integration.test.ts`, replacing the
dynamic-import-plus-file-scope-mock pattern with tests that call the extracted
bootstrap helpers directly. Then normalize the other hotspot suites:

- `test/unit/hyper-transport.test.ts`
- `test/unit/hyper-effects.test.ts`
- `test/unit/tabs-decoration-updates.test.ts`
- `test/unit/term-report-renderer.test.ts`
- `test/unit/runtime-tab-provider-registration.test.ts`

Each suite must meet the same rule: if it calls `setupHappyDom()`, it also owns
cleanup in the same file, and if it registers module mocks, it restores them in
the same file. Prefer shared helper factories in `test/testUtils/` over new
inline mock graphs.

Stage D removes the dedicated-process quarantine only after the refactored
tests pass inside the ordinary unit suite. Update:

- `package.json` to remove the bootstrap-only environment-gated script if it is
  no longer required,
- `Makefile` so `make test` no longer depends on a second bootstrap-only stage,
- `docs/developers-guide.md` to describe the new single-suite workflow and the
  randomized-seed replay command,
- `docs/velocetty-design.md` to remove the temporary process-isolated bootstrap
  note, and
- `docs/roadmap.md` to mark `9.3.1` done only after validation completes.

Do not change `--max-concurrency=1` guardrails as part of this roadmap item
unless the work is strictly required for the new same-process stability proof.
Parallel execution belongs to `9.3.2`.

Stage E runs the required gates with durable logs. Use the repository-preferred
order and log naming convention:

```bash
set -o pipefail && bun install \
  | tee /tmp/bun-install-$(get-project)-$(git branch --show).out
set -o pipefail && make build \
  | tee /tmp/build-$(get-project)-$(git branch --show).out
set -o pipefail && make check-fmt \
  | tee /tmp/check-fmt-$(get-project)-$(git branch --show).out
set -o pipefail && make lint \
  | tee /tmp/lint-$(get-project)-$(git branch --show).out
set -o pipefail && make test \
  | tee /tmp/test-$(get-project)-$(git branch --show).out
```

After the gate sequence passes, prove the roadmap success criterion explicitly
with at least three seeded randomized runs, for example:

```bash
set -o pipefail && bun test --max-concurrency=1 --randomize --seed 2444615283 test/unit \
  | tee /tmp/test-seed-2444615283-$(get-project)-$(git branch --show).out
set -o pipefail && bun test --max-concurrency=1 --randomize --seed 1337 test/unit \
  | tee /tmp/test-seed-1337-$(get-project)-$(git branch --show).out
set -o pipefail && bun test --max-concurrency=1 --randomize --seed 20260306 test/unit \
  | tee /tmp/test-seed-20260306-$(get-project)-$(git branch --show).out
```

If all three pass, update the roadmap checkbox, keep the developers guide and
design notes synchronized with the new practice, and only then consider the
milestone complete.

## Validation and acceptance evidence

The implementation is acceptable only when all of the following are true:

1. The bootstrap integration coverage runs in the normal `test/unit` suite
   without `VELOCETTY_RUN_BOOTSTRAP_TRANSPORT_INTEGRATION=1`.
2. No hotspot suite named in this plan relies on leaked file-scope mocks across
   files.
3. `docs/developers-guide.md` tells developers how to replay randomized unit
   runs after this change.
4. `docs/velocetty-design.md` and `docs/roadmap.md` no longer describe a
   bootstrap quarantine that no longer exists.
5. The gate logs and three seed logs exist under `/tmp/` with the exact command
   evidence used to close the roadmap item.

## Outcomes & Retrospective

Not started. This section must be rewritten during implementation with the
actual extracted seams, files changed, gate evidence, and lessons learned.
