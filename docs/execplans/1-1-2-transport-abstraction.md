# Introduce transport abstraction with Electron IPC adapter (roadmap 1.1.2)

## Module header

- Purpose: define and execute roadmap item `1.1.2` by introducing a transport
  abstraction for command invocation and event streams, with an interim
  Electron IPC adapter built on existing RPC wiring.
- Invariants: preserve current runtime behaviour while removing direct
  Electron/RPC coupling from the command layer.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`, and
  `docs/developers-guide.md`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: DRAFT (2026-02-12)

No `PLANS.md` exists at repository root as of 2026-02-12, so this plan is
self-contained.

## Purpose / big picture

Roadmap item `1.1.2` exists to decouple feature work from Electron-specific
transport details so phases 1-5 can ship on Electron while preserving a clean
migration path to Tauri. Success is observable when command invocation still
works end-to-end, but command-layer modules no longer call Electron IPC
primitives directly and instead depend on a transport contract.

This milestone must also establish an event-stream abstraction surface (for
renderer subscriptions to host events) so future host adapters can replace
Electron without changing command/UI modules.

Done criteria for this roadmap item:

- coverage-first gate is complete before transport implementation starts:
  direct unit coverage exists for `lib/command-registry.ts`,
  `lib/utils/rpc.ts`, and `app/rpc.ts`, plus at least one behavioural assertion
  for command-dispatch continuity,
- a transport interface exists for command invocation and event streams,
- an Electron adapter implements that interface using current RPC/IPC wiring,
- command invocation path runs through the adapter end-to-end,
- command-layer modules no longer contain direct Electron calls,
- `docs/developers-guide.md` documents the new development practice,
- `docs/roadmap.md` marks `1.1.2` done only after all required gates pass,
- required gates pass: `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.

## Constraints

- Preserve current command behaviour and keyboard/menu execution semantics for
  this milestone; no user-visible command remapping.
- Keep existing RPC payload/event names intact (`MainEvents`, `RendererEvents`)
  to avoid coupling this task to protocol redesign.
- Keep the implementation compatible with the current migration state where
  runtime code still lives primarily in `lib/` and `app/`.
- Place shared contracts in `shared/` and avoid introducing new direct
  `frontend <-> backend` imports.
- Do not add new third-party dependencies.
- Do not begin transport abstraction refactor edits until the coverage-first
  gate is complete and committed.
- Update `docs/developers-guide.md` for any developer workflow changes created
  by this transport seam.
- Mark roadmap entry `1.1.2` done only after all required gates succeed.
- Use Makefile targets and capture long gate output with `tee`.

## Tolerances (exception triggers)

- Scope: if implementation requires more than 22 files or more than 900 net
  changed lines, stop and escalate.
- Interface: if existing RPC event names or `MainEvents`/`RendererEvents`
  payload shapes must change, stop and escalate.
- Dependencies: if a new package is required, stop and escalate.
- Validation: if any required gate still fails after two focused remediation
  attempts, stop and escalate with logs.
- Ambiguity: if multiple adapter boundary choices are viable and materially
  affect later Tauri migration, stop and present options with trade-offs.

## Risks

- Risk: transport abstraction is defined too narrowly and cannot support Tauri
  or WebSocket transport later.
  Severity: high
  Likelihood: medium
  Mitigation: define contract in `shared/` using host-agnostic terms
  (invoke/subscribe/unsubscribe) and include event-stream methods from day one.

- Risk: migration touches high-fan-out modules in `lib/index.tsx`, creating
  regressions in renderer event wiring.
  Severity: high
  Likelihood: medium
  Mitigation: migrate in small steps, add adapter-focused unit tests first,
  then run fast E2E assertions after command-path migration.

- Risk: command-layer direct imports of `rpc`/`ipcRenderer` remain hidden after
  partial refactor.
  Severity: medium
  Likelihood: high
  Mitigation: add explicit assertions (tests or static checks) that command
  modules import transport modules, not Electron/RPC internals.

- Risk: developers continue adding direct Electron calls in new command code.
  Severity: medium
  Likelihood: medium
  Mitigation: document rule and examples in `docs/developers-guide.md`.

## Progress

- [x] (2026-02-12 00:00Z) Captured roadmap/design/PRD constraints for task
  `1.1.2`.
- [x] (2026-02-12 00:00Z) Mapped current command and IPC wiring in
  `lib/actions/ui.ts`, `lib/command-registry.ts`, `lib/utils/rpc.ts`,
  `lib/index.tsx`, `app/rpc.ts`, and `app/ui/window.ts`.
- [x] (2026-02-12 00:00Z) Drafted this ExecPlan.
- [x] (2026-02-12 00:00Z) Recorded user requirement that IPC/command-registry
  coverage must be in place before any implementation work.
- [ ] Await explicit approval to begin implementation.
- [ ] Stage A complete: add and commit coverage-first IPC/registry tests.
- [ ] Stage B complete: finalise transport boundary and migration map.
- [ ] Stage C complete: add shared transport contracts.
- [ ] Stage D complete: implement Electron transport adapter.
- [ ] Stage E complete: migrate command path and event subscriptions.
- [ ] Stage F complete: documentation updates, full gates, roadmap status, and
  final commits.

## Surprises & discoveries

- Observation: runtime package boundaries are established, but active renderer
  and main-process implementation still resides in `lib/` and `app/`.
  Evidence: `frontend/src/index.ts` and `backend/src/index.ts` are boundary
  markers, while command/RPC wiring remains in legacy roots.
  Impact: this milestone should introduce transport seam without forcing a
  full module relocation.

- Observation: command invocation currently spans two mechanisms in renderer
  code: `rpc.emit('command', ...)` and direct `ipcRenderer.invoke(...)` for
  decorated keymaps.
  Evidence: `lib/actions/ui.ts` and `lib/command-registry.ts`.
  Impact: adapter design must support both fire-and-forget command dispatch and
  request/response calls.

- Observation: there is currently no direct unit test coverage for
  `lib/utils/rpc.ts`, `app/rpc.ts`, or concrete behaviour in
  `lib/command-registry.ts`; existing coverage mocks the registry surface.
  Evidence: `test/unit/hyper-effects.test.ts` mocks
  `../../lib/command-registry`, and test searches show no direct unit tests
  targeting `lib/utils/rpc.ts` or `app/rpc.ts`.
  Impact: continuity risk is too high for a refactor unless the coverage-first
  gate is implemented before transport changes.

## Decision log

- Decision: define transport contracts in `shared/` and implement the Electron
  adapter in renderer-facing runtime modules.
  Rationale: keeps contracts host-agnostic while limiting blast radius in the
  current migration phase.
  Date/Author: 2026-02-12 / Codex

- Decision: prioritise command-layer decoupling first, then widen event-stream
  adoption in bootstrap wiring as a separate stage within this milestone.
  Rationale: directly satisfies success criteria while reducing regression risk.
  Date/Author: 2026-02-12 / Codex

- Decision: keep existing RPC event names and payload contracts unchanged.
  Rationale: roadmap `1.1.2` targets abstraction, not protocol redesign.
  Date/Author: 2026-02-12 / Codex

- Decision: enforce coverage-first sequencing so targeted IPC/registry tests are
  added and committed before any transport refactor edits.
  Rationale: user requirement and current coverage gap indicate continuity risk
  if refactor work starts first.
  Date/Author: 2026-02-12 / Codex

## Outcomes & retrospective

Not implemented yet. This section will be updated once implementation starts
and validation evidence is available.

## Context and orientation

Current command invocation path:

- Keybindings resolve via `lib/command-registry.ts`.
- `lib/containers/hyper.tsx` dispatches `uiActions.execCommand(...)`.
- `lib/actions/ui.ts` calls `rpc.emit('command', command)` when no local
  command handler exists.
- Main process handles `rpc.on('command', ...)` in `app/ui/window.ts` and then
  executes `app/commands.ts::execCommand`.

Current event-stream path:

- `lib/index.tsx` subscribes to renderer events via `rpc.on(...)` for session,
  UI, and updater flows.
- `app/ui/window.ts` emits those events over `app/rpc.ts` server wiring.

Current direct Electron access in command-adjacent code:

- `lib/command-registry.ts` imports `ipcRenderer` through `lib/utils/ipc.ts`
  for `getDecoratedKeymaps`.

Key files expected in this milestone:

- `shared/src/types/common.ts` and new `shared/src/types/transport.ts`
  (transport contract definitions).
- `lib/utils/rpc.ts`, `lib/rpc.ts`, and new `lib/transport/*`
  (Electron adapter implementation).
- `lib/command-registry.ts` and `lib/actions/ui.ts`
  (command-layer migration to transport).
- `lib/index.tsx` (event-stream usage via transport wrapper where practical).
- `test/unit/*` (transport and command-path regression tests).
- `docs/developers-guide.md` and `docs/roadmap.md`.

## Plan of work

Stage A: Coverage-first hardening gate (no transport refactor edits).

Add direct unit tests for:

- `lib/command-registry.ts` (`getRegisteredKeys`, handler registration, and
  role-command prevention),
- `lib/utils/rpc.ts` (init handshake, cached `window.__rpcId` path, emit
  readiness guard, listener cleanup),
- `app/rpc.ts` (channel wiring, destroyed-window emit guard, and destroy
  cleanup),
- one behavioural assertion that validates command dispatch continuity through
  command surface plumbing.

Commit this test-only change first after full gates pass.

Stage B: Transport boundary definition and migration map (no behaviour changes).

Define the minimal host-agnostic interfaces needed now: command invocation,
request/response invocation, and event subscription lifecycle. Document which
existing modules will depend on the new transport contract and which stay
unchanged in this milestone.

Stage C: Shared contract scaffolding.

Add transport interfaces to `shared/` with explicit typed methods that map to
existing `MainEvents`, `RendererEvents`, and IPC command contracts. Export these
contracts via `shared/src/index.ts`.

Stage D: Electron adapter implementation.

Implement an Electron adapter that delegates to existing renderer RPC client and
`ipcRenderer.invoke` wiring. The adapter must satisfy the shared transport
interface and keep runtime behaviour unchanged.

Stage E: Command-layer and event-stream integration.

Migrate command-layer modules to consume the transport adapter instead of direct
`rpc` or `ipcRenderer` imports. Update bootstrap event wiring to consume the
transport event stream abstraction where this can be done safely in this
milestone.

Stage F: Documentation, validation, roadmap completion, and commits.

Run required gates with logged output, resolve any failures, and only then mark
roadmap entry `1.1.2` done. Record outcomes in this ExecPlan and keep commits
atomic.

## Concrete steps

1. Add and commit coverage-first tests before any transport refactor:

   - direct unit tests for `lib/command-registry.ts`,
   - direct unit tests for `lib/utils/rpc.ts`,
   - direct unit tests for `app/rpc.ts`,
   - one behavioural assertion for command-dispatch continuity.

2. Create shared transport contracts in `shared/src/types/transport.ts` and
   export them from `shared/src/index.ts`.

3. Implement `ElectronIpcTransport` in a renderer transport module (for
   example `lib/transport/electron-ipc-transport.ts`) by composing existing
   `lib/rpc.ts` and `lib/utils/ipc.ts` capabilities behind the new interface.

4. Replace direct command-layer transport usage:

   - update `lib/actions/ui.ts::execCommand` to call adapter command invocation,
   - update `lib/command-registry.ts::getRegisteredKeys` to call adapter
     request/response invocation,
   - ensure these modules no longer import `../rpc` or `./utils/ipc` directly.

5. Migrate selected renderer bootstrap subscriptions in `lib/index.tsx` to use
   adapter event-stream methods, keeping event names/payloads unchanged.

6. Update documentation:

   - add transport seam guidance to `docs/developers-guide.md`,
   - mark roadmap item `1.1.2` done in `docs/roadmap.md` only after gates pass.

7. Run required gates with logs:

    bun install |& tee /tmp/install-velocetty-$(git branch --show).out
    make build |& tee /tmp/build-velocetty-$(git branch --show).out
    make check-fmt |& tee /tmp/check-fmt-velocetty-$(git branch --show).out
    make lint |& tee /tmp/lint-velocetty-$(git branch --show).out
    make test |& tee /tmp/test-velocetty-$(git branch --show).out

8. Because this work changes docs, run documentation quality checks:

    bunx markdownlint-cli2 "docs/**/*.md" |& \
      tee /tmp/markdownlint-velocetty-$(git branch --show).out
    nixie --no-sandbox |& tee /tmp/nixie-velocetty-$(git branch --show).out

9. Commit strategy (atomic):

   - Commit 1: coverage-first IPC/command-registry tests only.
   - Commit 2: shared transport contracts + Electron adapter scaffold.
   - Commit 3: command-layer migration to transport abstraction.
   - Commit 4: docs updates + roadmap check-off + final gate evidence updates.

## Validation and acceptance

Roadmap `1.1.2` is complete when all of the following are true:

- Coverage-first gate passed before refactor start:
  - direct unit tests exist for `lib/command-registry.ts`,
    `lib/utils/rpc.ts`, and `app/rpc.ts`,
  - behavioural command-dispatch continuity assertion exists and passes.
- Transport interface exists for command invocation and event streams.
- Electron adapter implements that interface using existing RPC/IPC plumbing.
- Command invocation still works end-to-end from renderer command dispatch to
  main-process command execution.
- Command-layer modules contain no direct Electron calls.
- `docs/developers-guide.md` reflects the new transport-coupling rule.
- `docs/roadmap.md` item `1.1.2` is marked done.
- Required gates pass:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`

Additional observable checks:

- existing fast E2E path remains green,
- no regressions in session creation, split, or keybinding-triggered commands.

## Idempotence and recovery

All implementation and validation steps are safe to rerun.
If a gate fails:

- inspect the corresponding `/tmp/*.out` log,
- apply the smallest focused fix,
- rerun only the failed gate,
- rerun the full required gate sequence before roadmap check-off.

If event wiring migration in `lib/index.tsx` introduces regressions, revert to
adapter-backed command migration only, keep event-stream interfaces in place,
and record the deferred event migration in `Decision log`.

## Artifacts and notes

- Primary artifact: `docs/execplans/1-1-2-transport-abstraction.md`.
- Expected implementation artifacts: new shared transport contract file,
  renderer Electron adapter module, command-layer updates, tests, and doc
  updates.
- Keep this plan updated during execution, especially `Progress`,
  `Surprises & discoveries`, and `Decision log`.

## Revision note

- 2026-02-12: Initial draft created from roadmap `1.1.2` context and current
  codebase wiring.
- 2026-02-12: Revised sequencing to enforce coverage-first gate before any
  transport abstraction implementation work, per user requirement.
