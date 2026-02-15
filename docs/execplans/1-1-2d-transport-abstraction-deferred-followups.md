# Transport abstraction deferred follow-ups (roadmap 1.1.2d)

## Module header

- Purpose: complete the deferred follow-ups from roadmap item `1.1.2`:
  migrate remaining `window.rpc` UI subscriptions behind the transport
  abstraction and add bootstrap regression coverage for high-frequency
  streams.
- Invariants: preserve current runtime behaviour; keep existing Remote
  Procedure Call (RPC) event names and payload shapes unchanged.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`
  (sections: Host migration: Electron to Tauri, Testing),
  `docs/execplans/1-1-2-transport-abstraction.md`,
  `lib/TRANSPORT_MIGRATION_MAP.md`, `docs/developers-guide.md`.

This execution plan (ExecPlan) is a living document. The sections Constraints,
Tolerances, Risks, Progress, Surprises & discoveries, Decision log,
and Outcomes & retrospective must be kept up to date as work proceeds.

Status: COMPLETE (2026-02-14)

## Context

Roadmap item `1.1.2` introduced the transport abstraction
(`RendererCommandTransport` in `shared/src/types/transport.ts`) and an
Electron Inter‑Process Communication (IPC) adapter
(`lib/transport/electron-ipc-transport.ts`). The
command layer and bootstrap event wiring in `lib/index.tsx` were
migrated to use the transport barrel (`lib/transport/index.ts`).

The following follow-ups were explicitly deferred:

1. `lib/containers/hyper.tsx` (line 82) still subscribes to
   `'term selectAll'` via `window.rpc.on(...)` / `window.rpc.off(...)`.
2. `lib/components/term.tsx` (line 167) still emits
   `'info renderer'` via `window.rpc.emit(...)`.
3. Bootstrap regression test coverage for high-frequency streams was
   flagged but not implemented.

Both events already have typed contracts:

- `RendererEvents['term selectAll']` (type `never`) in
  `shared/src/types/common.ts:97`.
- `MainEvents['info renderer']` (type `{uid: SessionId; type: string}`)
  in `shared/src/types/common.ts:55`.

The transport adapter already supports `on`, `off`, and `emit` for
these event types, so the migration is a mechanical replacement.

## Purpose / big picture

Complete the deferred follow-ups so that no internal Velocetty renderer
module uses `window.rpc` directly. After this work, `window.rpc`
exists only for backward-compatible plugin API access (set by
`lib/index.tsx:33` and `app/ui/window.ts:471`).

Additionally, harden the bootstrap transport integration test with
ordered-sequence and high-frequency stream assertions to defend against
transport-swap regressions in future host migration work.

## Constraints

- Preserve all runtime behaviour; these are pure internal wiring
  changes.
- Keep `window.rpc` available globally for plugin API compatibility;
  only remove its use in internal modules.
- No new third-party dependencies.
- Keep file sizes under 400 lines per AGENTS.md guidance.
- Use en-GB-oxendict spelling in comments/docs.
- Update `docs/developers-guide.md` for any development practice
  changes.
- Mark roadmap entries done only after all gates pass.

## Tolerances (exception triggers)

- Scope: if more than 10 files or more than 200 net changed lines,
  stop and escalate.
- If any event type signature mismatch prevents mechanical replacement,
  stop and escalate.
- If any required gate fails after two focused remediation attempts,
  stop and escalate with logs.

## Risks

- Risk: transport type mismatch for `never`-typed event listeners.
  Severity: low. Likelihood: low.
  Mitigation: the existing bootstrap wiring (`lib/index.tsx`) already
  uses `transport.on('ready', () => {...})` where
  `RendererEvents['ready']` is `never`, confirming this pattern
  compiles.

- Risk: component-level transport mocking adds fragile test coupling.
  Severity: medium. Likelihood: medium.
  Mitigation: keep component transport tests focused on method call
  verification, not internal component rendering behaviour.

## Plan of work

### Stage A: Migrate remaining `window.rpc` usage

- `lib/containers/hyper.tsx`: replace `window.rpc.on/off` with
  `transport.on/off` for `'term selectAll'`.
- `lib/components/term.tsx`: replace `window.rpc.emit` with
  `transport.emit` for `'info renderer'`.

### Stage B: Component-level transport tests

- `test/unit/term-report-renderer.test.ts`: verify
  `Term.reportRenderer` emits via transport and respects deduplication.
- `test/unit/hyper-transport.test.ts`: verify `Hyper` subscribes and
  unsubscribes via transport lifecycle.

### Stage C: Bootstrap regression coverage

- Ordered bootstrap sequence assertion.
- High-frequency `session data` throughput test.
- Bootstrap path regression guard (`ready` prerequisite).

### Stage D: Documentation and roadmap updates

- `lib/TRANSPORT_MIGRATION_MAP.md`: mark items complete.
- `docs/developers-guide.md`: update transport practice guidance.
- `docs/roadmap.md`: mark deferred follow-ups done.
- `docs/execplans/1-1-2-transport-abstraction.md`: update follow-up
  status.

### Stage E: Validation and commit

- Run all required gates.
- Atomic commits per stage grouping.

## Progress

- [x] (2026-02-14) Drafted this ExecPlan.
- [x] (2026-02-14) Stage A: migrated `window.rpc` in hyper.tsx and
  term.tsx.
- [x] (2026-02-14) Stage B: added component-level transport tests
  (`term-report-renderer.test.ts`, `hyper-transport.test.ts`). Updated
  existing `hyper-effects.test.ts` to mock transport module.
- [x] (2026-02-14) Stage C: added bootstrap regression tests (ordered
  sequence, high-frequency throughput, ready prerequisite).
- [x] (2026-02-14) Stage D: updated TRANSPORT_MIGRATION_MAP.md,
  developers-guide.md, roadmap.md, and 1-1-2 execplan.
- [x] (2026-02-14) Stage E: all gates pass; three atomic commits
  created.

## Surprises & discoveries

- Observation: Bun's `mock.module` for `../../lib/utils/plugins`
  must provide a superset of named exports when multiple test files
  mock the same module in the same process. The `hyper-effects.test.ts`
  mock originally only provided `connect`, causing
  `term-report-renderer.test.ts` to fail when run in the same Bun
  process (cross-test mock leakage per roadmap `9.3.1`).
  Impact: added `decorate` to the `hyper-effects.test.ts` plugins
  mock and `connect` to the `term-report-renderer.test.ts` mock.

- Observation: `make build` generates untracked `.js`/`.d.ts` files
  in `shared/src/` that are not ignored by `.biomeignore` or
  `.gitignore`, causing stale formatting check failures.
  Impact: cleaned up build artefacts before gate runs; not actionable
  for this milestone but worth noting for future `.gitignore` hygiene.

## Decision log

- Decision: add both `connect` and `decorate` to all plugins mock
  definitions in test files that mock `../../lib/utils/plugins`.
  Rationale: avoids cross-test mock leakage when Bun runs test files
  sequentially in the same process (`--max-concurrency=1`).
  Date/Author: 2026-02-14 / agent

## Outcomes & retrospective

Completed in this milestone:

- Migrated `lib/containers/hyper.tsx` from `window.rpc.on/off` to
  `transport.on/off` for `'term selectAll'`.
- Migrated `lib/components/term.tsx` from `window.rpc.emit` to
  `transport.emit` for `'info renderer'`.
- Added `test/unit/term-report-renderer.test.ts` (transport emit
  and deduplication verification).
- Added `test/unit/hyper-transport.test.ts` (transport subscription
  lifecycle verification).
- Updated `test/unit/hyper-effects.test.ts` to mock transport module.
- Added three bootstrap regression tests: ordered sequence,
  high-frequency throughput (100 events), and ready prerequisite.
- Updated all documentation: roadmap, migration map, developers'
  guide, and parent execplan.
- All gates pass: `make check-fmt`, `make typecheck`, `make lint`,
  `make test`, and `markdownlint`.

## Validation and acceptance

Roadmap `1.1.2` deferred follow-ups are complete when:

- No internal Velocetty renderer module uses `window.rpc` directly
  (`window.rpc` only remains as a plugin API global).
- Transport-path tests exist for both migrated component surfaces.
- Bootstrap regression tests include ordered sequence and
  high-frequency stream assertions.
- Documentation reflects updated transport practice.
- All required gates pass: `bun install`, `make build`,
  `make check-fmt`, `make typecheck`, `make lint`, `make test`.
- `docs/roadmap.md` marks all 1.1.2 outstanding concerns as done.

## Idempotence and recovery

All implementation and validation steps are safe to rerun. If a gate
fails:

- Inspect the log output.
- Apply the smallest focused fix.
- Rerun only the failed gate.
- Rerun the full gate sequence before roadmap check-off.
