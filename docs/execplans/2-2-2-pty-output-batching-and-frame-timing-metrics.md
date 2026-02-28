# Add PTY output batching and frame timing metrics (Roadmap 2.2.2)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE (implemented and validated)

## Purpose / big picture

Roadmap item `2.2.2` requires rendering instrumentation that proves the terminal
path remains responsive under bursty PTY output. After this work, developers
must be able to inspect and validate:

- Input latency from keystroke ingress to terminal write.
- Long-frame counts for renderer frame timing.
- PTY batching thresholds that still mirror current semantics (`16ms` /
  `200KB`).
- Synthetic-load benchmark results showing stable frame timing.

Success is observable when:

1. Metrics are emitted and aggregated deterministically.
2. Diagnostics expose those metrics in an existing developer-visible surface.
3. Benchmarks under synthetic load provide repeatable frame-time evidence.
4. Required gates pass with durable logs: `bun install`, `make build`,
   `make check-fmt`, `make lint`, and `make test`.
5. Documentation and roadmap updates are included in the same implementation
   change (`docs/developers-guide.md`, `docs/roadmap.md`).

## Repository orientation

This roadmap item primarily touches existing PTY and renderer telemetry seams:

- `app/session.ts`: PTY data batching contract and flush behaviour.
- `lib/index.tsx`: renderer-side decode of batched PTY payloads.
- `lib/components/term.tsx` and `lib/containers/terms.ts`: input ingress and
  frame loop hooks.
- `lib/actions/sessions.ts` and `lib/store/write-middleware.ts`: PTY action
  timing and terminal write path.
- `shared/src/types/common.ts`: IPC telemetry contract definitions.
- `app/ui/window.ts`, `app/utils/renderer-utils.ts`, `app/menus/menu.ts`:
  main-process aggregation and diagnostics presentation.
- `test/unit/bootstrap-transport-integration.test.ts` and
  `test/e2e-deep/terminal-input-path.e2e.ts`: closest current synthetic-load
  and input-path validation harnesses.

Source documents that define scope and acceptance:

- `docs/roadmap.md` section `2.2.2`.
- `docs/velocetty-design.md` sections `Render scheduling` and `Observability`.
- `docs/velocetty-product-requirements-document.md` instrumentation baseline.
- `docs/velocetty-hyper-codebase.md` batching and performance SLA references.
- `docs/developers-guide.md` gate order and docs synchronization expectations.

## Constraints

- Preserve batching semantics in the PTY path (`16ms` / `200KB`) unless an
  explicit follow-up roadmap item approves a behaviour change.
- Do not redesign renderer fallback or context-pool behaviour for this item.
  Scope is instrumentation, observability, and benchmark baselining.
- Keep telemetry deterministic and idempotent across repeated events.
- Do not introduce third-party dependencies for metrics or benchmarks.
- Keep diagnostics output machine-comparable and testable.
- Keep documentation in en-GB-oxendict spelling.
- Do not mark roadmap `2.2.2` as done until:
  all metrics are observable,
  benchmark evidence is captured,
  required gates pass,
  and `docs/developers-guide.md` is updated where practice changes.

## Tolerances (exception triggers)

- Scope tolerance:
  stop and escalate if implementation requires changes outside
  `app/session.ts`, `lib/**`, `shared/src/types/common.ts`, `app/ui/window.ts`,
  `app/utils/renderer-utils.ts`, `app/menus/menu.ts`, `test/**`, and `docs/**`.
- Interface tolerance:
  stop and escalate if an IPC contract change would require broad rewrites
  outside renderer/main-process telemetry callsites.
- Behaviour tolerance:
  stop and escalate if preserving `16ms` / `200KB` semantics proves impossible.
- Test tolerance:
  stop and escalate after three consecutive failures of the same gate with no
  new hypothesis.
- Benchmark tolerance:
  stop and escalate if synthetic-load results are non-deterministic across
  three consecutive local runs with unchanged inputs.

## Risks

- Risk: input-latency timestamps capture the wrong boundaries and report numbers
  that look plausible but are not actionable.
  Severity: high
  Likelihood: medium
  Mitigation: lock metric boundaries in code comments and tests before wiring
  diagnostics.

- Risk: long-frame counting adds overhead that distorts the very metric being
  measured.
  Severity: medium
  Likelihood: medium
  Mitigation: keep measurement cheap (`requestAnimationFrame` delta tracking)
  and validate overhead with synthetic-load comparisons.

- Risk: benchmark harness is flaky in CI or machine-dependent enough to be
  misleading.
  Severity: high
  Likelihood: medium
  Mitigation: define deterministic synthetic workload, fixed run duration,
  explicit acceptance thresholds, and repeat-run variance checks.

- Risk: telemetry shape drift between renderer and main process breaks
  diagnostics silently.
  Severity: medium
  Likelihood: medium
  Mitigation: update shared types first and add contract-level tests.

- Risk: roadmap/docs drift from implementation.
  Severity: medium
  Likelihood: high
  Mitigation: make docs and roadmap closure a mandatory final milestone.

## Explicit approval gate

Runtime implementation was blocked until explicit user approval for full-scope
execution. Approval was received on 2026-02-27, and full scope is now complete.

## Milestone 1: Lock metric definitions and create failing tests

Define exact measurement boundaries first, then add failing tests.

1. Define metric semantics in code-adjacent documentation:
   input latency start/end, long-frame threshold, and batching parity checks.
2. Add failing tests for:
   batching threshold parity (`16ms` / `200KB`),
   input-latency capture path,
   long-frame count accumulation,
   and diagnostics serialization of new metrics.
3. Capture pre-change failure evidence for touched suites.

Expected result: at least one targeted test fails before implementation, proving
coverage is sensitive to missing instrumentation.

## Milestone 2: Instrument PTY and frame-timing paths

Implement low-overhead metric collection at existing seams.

1. Keep `DataBatcher` thresholds unchanged and expose read-only parity checks.
2. Add input-latency measurement hooks from keystroke ingress to terminal write
   path.
3. Add frame-timing sampling using `requestAnimationFrame` deltas and maintain
   long-frame counters.
4. Extend shared IPC telemetry contracts as needed for metric transport.

Expected result: runtime paths emit stable telemetry without behaviour regressions
in batching or rendering.

## Milestone 3: Aggregate and expose diagnostics

Reuse existing diagnostics surfaces to keep developer workflow consistent.

1. Extend main-process telemetry aggregation (`app/utils/renderer-utils.ts` or
   adjacent module) with:
   input-latency summaries,
   long-frame counts,
   and batching-parity status.
2. Surface metrics in the About diagnostics output (`app/menus/menu.ts`) and/or
   equivalent existing developer diagnostics output.
3. Ensure output formatting is deterministic for testing.

Expected result: developers can inspect metrics without attaching a debugger.

## Milestone 4: Build synthetic-load benchmark baseline

Add a reproducible benchmark path that validates frame-time stability.

1. Implement a synthetic PTY-output workload harness using existing test
   infrastructure (unit/integration/e2e helper reuse is preferred).
2. Record frame-time metrics and long-frame counts during the synthetic load.
3. Define pass criteria aligned with design targets (for example, stable frame
   timing around the 60fps budget and bounded long-frame growth).
4. Add benchmark invocation to documented developer workflow with an explicit
   evidence path contract:
   `/tmp/benchmark-<project>-<branch>-pty-frame-timing-synthetic-load.json`.

Expected result: synthetic-load benchmark can be rerun locally and demonstrates
stable, explainable frame-timing behaviour.

## Milestone 5: Documentation and roadmap synchronization

Update project documentation and roadmap state only after verified behaviour.

1. Update `docs/developers-guide.md` with any new development practice for:
   running the benchmark,
   interpreting latency/frame metrics,
   and preserving batching-parity checks.
2. Mark roadmap `2.2.2` and its sub-items done in `docs/roadmap.md` after
   metrics and benchmark evidence are complete.
3. Update this ExecPlan `Progress`, `Decision Log`, and
   `Outcomes & Retrospective` with final evidence.

Expected result: documentation, implementation, and roadmap status remain
synchronized.

## Milestone 6: Full gates with durable evidence

Run required gates with branch-safe `tee` logging.

```bash
set -o pipefail
project_name="$(get-project 2>/dev/null || basename "$(git rev-parse --show-toplevel)")"
branch_name="$(git branch --show-current)"
if [ -z "$branch_name" ]; then
  branch_name="detached-head"
fi
safe_project_name="${project_name//\//-}"
safe_branch_name="${branch_name//\//-}"
safe_project_name="$(printf '%s' "$safe_project_name" | tr -cs 'A-Za-z0-9._-' '-')"
safe_branch_name="$(printf '%s' "$safe_branch_name" | tr -cs 'A-Za-z0-9._-' '-')"
if [ -z "$safe_project_name" ]; then
  safe_project_name="project"
fi
if [ -z "$safe_branch_name" ]; then
  safe_branch_name="branch"
fi
bun install 2>&1 | tee "/tmp/install-${safe_project_name}-${safe_branch_name}.out"
make build 2>&1 | tee "/tmp/build-${safe_project_name}-${safe_branch_name}.out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-${safe_project_name}-${safe_branch_name}.out"
make lint 2>&1 | tee "/tmp/lint-${safe_project_name}-${safe_branch_name}.out"
make test 2>&1 | tee "/tmp/test-${safe_project_name}-${safe_branch_name}.out"
bun run benchmark:pty-frame-timing -- \
  --evidence-path "/tmp/benchmark-${safe_project_name}-${safe_branch_name}-pty-frame-timing-synthetic-load.json" \
  2>&1 | tee "/tmp/benchmark-${safe_project_name}-${safe_branch_name}.out"
```

For documentation edits in this milestone, also run:

```bash
bunx markdownlint-cli2 "docs/**/*.md"
nixie --no-sandbox
```

Expected result: all required commands exit `0` and log paths are captured in
implementation reporting.

## Evidence capture and reporting format

When implementing this plan, report the following in the completion handoff:

1. Exact files changed.
2. Commands run, in execution order.
3. Exit code per command.
4. `/tmp` log path per gate command.
5. Benchmark command output and acceptance-threshold evaluation.
6. Benchmark evidence JSON path (explicitly include the synthetic-load path).
7. Explicit roadmap checkbox status (`2.2.2` and sub-items).

Do not infer success from truncated output.

## Progress

- [x] (2026-02-27 22:17 UTC) Drafted initial execplan with required living
  sections and explicit approval gate.
- [x] (2026-02-27 22:17 UTC) Integrated roadmap/design/PRD/hyper-codebase
  requirements for `2.2.2`.
- [x] (2026-02-27 22:17 UTC) Integrated multi-agent discovery findings for
  code touchpoints, tolerances, and evidence workflow.
- [x] (2026-02-27 23:05 UTC) Received user approval for validation/docs-only
  implementation within owned files.
- [x] (2026-02-27 23:05 UTC) Added synthetic-load benchmark helper command
  (`bun run benchmark:pty-frame-timing`) and default evidence-path contract.
- [x] (2026-02-27 23:05 UTC) Added validation coverage for benchmark evidence
  generation and runtime batching-contract parity checks.
- [x] (2026-02-27 23:05 UTC) Updated docs (`developers-guide`, `roadmap`, and
  this plan) with benchmark evidence-path and partial closure status.
- [x] (2026-02-28 00:02 UTC) Implemented runtime telemetry ingestion and
  reporting across renderer and main-process paths:
  `lib/components/term.tsx`, `lib/actions/sessions.ts`, `app/ui/window.ts`,
  `app/utils/renderer-utils.ts`, `app/menus/menu.ts`, and
  `shared/src/types/common.ts`.
- [x] (2026-02-28 00:15 UTC) Added and wired shared telemetry constants in
  `shared/src/constants/runtime-telemetry.ts`, and updated PTY batching in
  `app/session.ts` to consume shared batching constants.
- [x] (2026-02-28 00:44 UTC) Updated `.gitignore` for generated TypeScript
  intermediate artefacts and cleaned generated `.js/.d.ts/.js.map` files from
  source trees.
- [x] (2026-02-28 01:07 UTC) Fixed fallback regression assertion in
  `test/unit/term-report-renderer.test.ts` for `runtimeMetrics` payloads.
- [x] (2026-02-28 01:23 UTC) Replayed required gates successfully with durable
  logs:
  `bun install`,
  `make build`,
  `make check-fmt`,
  `make lint`,
  `make test`.
- [x] (2026-02-28 01:26 UTC) Marked roadmap item `2.2.2` and sub-items done
  after implementation and green-gate evidence.

## Surprises & Discoveries

- Existing code already enforces the required batching thresholds via
  `shared/src/constants/runtime-telemetry.ts` as consumed in `app/session.ts`
  (`16ms` and `200KB`), so this item can focus on parity verification plus
  instrumentation.
- A deterministic synthetic benchmark helper can be introduced without touching
  runtime modules by deriving batching constants from `app/session.ts` and
  `shared/src/constants/runtime-telemetry.ts`, then generating evidence JSON
  under `/tmp`.
- Existing About-dialog diagnostics from `2.2.1` provide a low-risk surface to
  extend instead of introducing a new diagnostics UI path.

## Decision Log

- Decision: Initially kept plan status as `DRAFT` and included a hard approval
  gate before implementation.
  Rationale: User requirement stated implementation must not begin before
  approval.

- Decision: Reuse existing telemetry/diagnostics seams (`info renderer`,
  renderer-utils aggregation, About dialog) unless milestone 1 proves they are
  insufficient.
  Rationale: Minimizes integration risk and aligns with prior roadmap `2.2.1`
  practice.

- Decision: Make synthetic-load benchmark evidence mandatory for roadmap closure.
  Rationale: Roadmap `2.2.2` success criteria explicitly require stable
  frame-time demonstration under synthetic load.

- Decision: Implement validation/docs-only scope before runtime instrumentation.
  Rationale: Current user assignment explicitly limits ownership to tests,
  benchmark helper/script wiring, and documentation files.

- Decision: Standardize synthetic-load evidence output under `/tmp/benchmark-`
  `<project>-<branch>-pty-frame-timing-synthetic-load.json`.
  Rationale: Branch-safe deterministic paths align with gate evidence workflows
  and make multi-agent handoff predictable.

- Decision: Keep generated TypeScript intermediates ignored and cleaned from
  source trees after gate runs (`bun install`, `make build`) regenerate them.
  Rationale: avoids artefact churn in reviews while preserving deterministic
  gate behaviour.

## Outcomes & Retrospective

All roadmap `2.2.2` deliverables are complete:

- Runtime input-latency and frame-timing metrics are emitted, aggregated, and
  surfaced in About diagnostics.
- PTY batching thresholds are centralized in shared runtime telemetry constants
  and parity-checked in diagnostics and benchmark output.
- Synthetic benchmark evidence is generated through
  `bun run benchmark:pty-frame-timing`.
- `docs/developers-guide.md`, `docs/roadmap.md`, and this ExecPlan are aligned
  with the implementation.
- Required gate sequence completed successfully with durable logs in `/tmp`.
