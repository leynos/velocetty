# Implement WebGL Allocation and Fallback Metrics (Roadmap 2.2.1)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Roadmap item `2.2.1` requires WebGL allocation and fallback metrics that are
observable by developers. After this change, developers will be able to see:

- WebGL context usage as current and peak counts.
- Fallback event totals and fallback reasons.
- Metrics in a developer diagnostics surface or log output.

Success is observable when:

1. Renderer lifecycle events update current and peak WebGL context metrics.
2. Fallback paths report reasoned events (for example `context-loss`,
   `pool-evicted`, and `webgl-init-failed`).
3. Diagnostics output renders those metrics without attaching a debugger.
4. Required quality gates pass with durable log evidence:
   `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.
5. Documentation and roadmap entries are synchronized in the same change:
   `docs/developers-guide.md` is updated and roadmap item `2.2.1` is marked
   done.

Implementation started after explicit user approval on `2026-02-27`.

## Repository orientation

The implementation is expected to concentrate in these areas:

- Renderer allocation and fallback flows:
  `lib/components/term.tsx` and `lib/utils/webgl-context-pool.ts`.
- IPC payload contracts for renderer telemetry:
  `shared/src/types/common.ts`.
- Main-process aggregation and diagnostics presentation:
  `app/ui/window.ts`, `app/utils/renderer-utils.ts`, and `app/menus/menu.ts`.
- Existing test coverage to extend:
  `test/unit/webgl-context-pool.test.ts`,
  `test/unit/term-report-renderer.test.ts`,
  `test/unit/renderer-utils.test.ts`, and possibly new focused tests around
  diagnostics output.

Reference sources that define scope and acceptance:

- `docs/roadmap.md` section `2.2.1`.
- `docs/velocetty-design.md` section `Observability`.
- `docs/velocetty-product-requirements-document.md` phase `2`.
- `docs/velocetty-hyper-codebase.md` observability and WebGL capacity sections.
- `docs/developers-guide.md` WebGL rendering and context-loss practice.

## Constraints

- Do not implement any optimization work from roadmap `2.2.2` in this item.
  This scope is instrumentation and diagnostics visibility only.
- Preserve current renderer-allocation behavior and retry policy from `2.1.1`
  and `2.1.2`. This task adds metrics and reporting, not allocator redesign.
- Preserve fallback reason taxonomy and keep reason values deterministic and
  documented.
- Keep telemetry updates deterministic and idempotent under repeated renderer
  reports and session teardown.
- Keep existing test semantics stable and extend tests rather than replacing
  coverage.
- Keep documentation in en-GB-oxendict spelling.
- Do not mark roadmap `2.2.1` as done until:
  - Metrics are observable as required.
  - All required gates pass.
  - `docs/developers-guide.md` changes are merged with implementation.

## Tolerances (exception triggers)

- Scope tolerance:
  - If implementation requires changes outside the renderer/pool/IPC/
    diagnostics/test/doc areas listed above, stop and escalate.
- Interface tolerance:
  - If telemetry contract changes require broad consumer rewrites beyond planned
    renderer and window diagnostics paths, stop and escalate.
- Dependency tolerance:
  - No new third-party dependencies are allowed for this item. If needed, stop
    and escalate.
- Test iteration tolerance:
  - If the same gate fails three consecutive attempts after targeted fixes,
    stop and escalate with log paths and hypotheses.
- Runtime tolerance:
  - If allocation metrics become inconsistent with session teardown (negative
    current, impossible peaks, or non-deterministic reason counts), stop and
    escalate before merging.
- Time tolerance:
  - If a single milestone exceeds one focused work session without green
    milestone-local tests, update `Decision Log` and escalate options.

## Risks

- Risk: metric duplication due to repeated renderer reports from the same
  terminal lifecycle.
  Severity: medium
  Likelihood: medium
  Mitigation: keep deduplication semantics aligned with existing
  `reportRenderer` and validate with focused unit tests.

- Risk: current and peak counts drift from actual pool state under eviction and
  release edge cases.
  Severity: high
  Likelihood: medium
  Mitigation: derive metrics from pool lifecycle methods and add transition
  tests around `acquire`, `release`, and `clear`.

- Risk: diagnostics visibility implemented only in logs and not discoverable by
  developers.
  Severity: medium
  Likelihood: medium
  Mitigation: prefer existing diagnostics view surface first; use logs as
  supplementary evidence.

- Risk: roadmap and developers-guide drift from implementation details.
  Severity: medium
  Likelihood: high
  Mitigation: make doc updates a mandatory milestone before roadmap checkbox
  closure.

- Risk: long gate output truncation hides true failures.
  Severity: high
  Likelihood: medium
  Mitigation: use `set -o pipefail` with per-gate `tee` logs in `/tmp`.

## Milestone 1: Confirm instrumentation contract and failing tests

Create failing or incomplete-test evidence first to enforce red-green-refactor
discipline.

1. Document planned metric schema:
   - WebGL context `current`.
   - WebGL context `peak`.
   - Fallback event totals by reason.
2. Add or update tests that fail before implementation:
   - Pool metric transitions.
   - Renderer fallback reason propagation.
   - Main-process aggregation visibility.
   - Diagnostics rendering or log emission assertions.
3. Capture pre-change test evidence for changed suites.

Expected result: at least one targeted test fails due to missing metrics before
implementation changes.

## Milestone 2: Add renderer and pool metric production

Implement metric production at allocation and fallback boundaries.

1. Extend WebGL pool bookkeeping to provide current and peak context counts.
2. Extend renderer event emission to carry fallback reasons and allocation
   metric data when renderer mode changes.
3. Preserve existing fallback and retry behavior while adding metric updates.
4. Ensure teardown paths (session close, release, clear) keep current count
   accurate and prevent stale metric state.

Expected result: renderer and pool paths emit stable, deterministic metric
updates through existing lifecycle flows.

## Milestone 3: Aggregate and expose metrics in diagnostics

Surface metrics where developers already inspect renderer status.

1. Extend main-process metric aggregation to track current, peak, and fallback
   reason counts.
2. Expose metrics in a developer diagnostics view (preferred existing About
   dialog surface) or structured log output that is enabled in development.
3. Keep diagnostic text and metric ordering deterministic for testability.
4. Validate that the visibility path satisfies roadmap success wording.

Expected result: a developer can open the diagnostics surface or logs and see
current/peak context usage and fallback reason counts.

## Milestone 4: Complete tests and regression coverage

Finalize and pass test coverage around the new metrics.

1. Update and pass pool unit tests for allocation/release/clear transitions.
2. Update and pass renderer tests for fallback reason events across:
   - context loss
   - pool eviction
   - WebGL init failure
3. Add or update diagnostics aggregation and rendering tests.
4. Re-run relevant targeted test suites before full-gate execution.

Expected result: coverage proves metric correctness and diagnostics visibility.

## Milestone 5: Documentation and roadmap synchronization

Update developer-facing docs and close roadmap work only after verified success.

1. Update `docs/developers-guide.md` with development practice for:
   - metric field definitions,
   - diagnostics visibility location,
   - fallback reason handling expectations, and
   - test/doc sync requirements for future renderer changes.
2. Mark roadmap item `2.2.1` and sub-items as done in `docs/roadmap.md` only
   after:
   - metric visibility is verified, and
   - all required gates pass.
3. Keep plan progress and decision sections updated with final evidence.

Expected result: docs reflect implemented behavior and roadmap status is
truthful.

## Milestone 6: Full gates with durable evidence

Run required gates with branch-safe logs. Use this command form exactly:

```bash
set -o pipefail
bun install 2>&1 | tee /tmp/install-$(get-project)-$(git branch --show).out
make build 2>&1 | tee /tmp/build-$(get-project)-$(git branch --show).out
make check-fmt 2>&1 | tee /tmp/check-fmt-$(get-project)-$(git branch --show).out
make lint 2>&1 | tee /tmp/lint-$(get-project)-$(git branch --show).out
make test 2>&1 | tee /tmp/test-$(get-project)-$(git branch --show).out
```

If any command fails, stop and record partial status with exact failing log
path. Do not claim completion.

Expected result: all required commands exit `0` with evidence captured in `/tmp`
logs.

## Evidence capture and reporting format

When implementing this plan, report:

1. Exact files changed.
2. Test and gate commands run.
3. Per-command pass/fail and exit code.
4. Durable log file paths in `/tmp`.
5. Whether roadmap checkbox updates were performed, with justification.

Avoid inferred success claims from truncated output.

## Explicit approval gate

User approval received on `2026-02-27` to proceed with implementation.

## Progress

- [x] (2026-02-27 01:52 UTC) Drafted execplan with required sections, milestones,
  and gate strategy.
- [x] (2026-02-27 01:52 UTC) Integrated roadmap/design/PRD/hyper/developer-guide
  scope constraints.
- [x] (2026-02-27 01:52 UTC) Integrated sub-agent planning outputs for
  requirements, implementation touchpoints, and gate strategy.
- [x] (2026-02-27 02:11 UTC) Received explicit approval to begin
  implementation.
- [x] (2026-02-27 02:11 UTC) Began implementation with an agent team and
  integrated code/test deltas for renderer metrics and diagnostics visibility.
- [x] (2026-02-27 02:13 UTC) Implemented current/peak WebGL metrics in
  `app/utils/renderer-utils.ts` and surfaced metrics in About dialog diagnostics
  output via `app/menus/menu.ts`.
- [x] (2026-02-27 02:13 UTC) Updated
  `docs/developers-guide.md` WebGL guidance for roadmap `2.2.1`.
- [x] (2026-02-27 02:13 UTC) Passed full required gates with durable logs:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.
- [x] (2026-02-27 02:13 UTC) Updated roadmap `2.2.1` and sub-items to done in
  `docs/roadmap.md`.

## Surprises & Discoveries

- Existing docs already define WebGL fallback reason observability and renderer
  reporting conventions from roadmap `2.1.2`, which reduces ambiguity for
  reason taxonomy.
- Existing diagnostics flow appears to have an established developer-facing
  surface (About dialog renderer summary), so roadmap visibility can likely be
  satisfied without creating a new UI surface.
- Test-state resets that delete object keys can invalidate numeric counters and
  produce `NaN` peaks. This was resolved by adding a dedicated
  `resetRendererTracking()` helper for deterministic test setup.
- Running `bun install` regenerates schema artifacts (`app/config/schema.json`
  and `shared/schemas/schema.json`) as part of repository bootstrap hooks.
  These changes were reverted for this feature to keep scope limited to roadmap
  `2.2.1` behavior.

## Decision Log

- Decision: Keep status as `DRAFT` and block implementation pending explicit
  user approval.
  Rationale: ExecPlans skill requires an approval gate before execution.

- Decision: Proceed with a minimal instrumentation implementation by deriving
  current and peak WebGL counts from renderer-type state in
  `app/utils/renderer-utils.ts` and exposing the metrics in the existing About
  dialog diagnostics output.
  Rationale: Satisfies roadmap `2.2.1` observability requirements without
  introducing new renderer allocation behavior or additional IPC contracts.

- Decision: Use current diagnostics surface as primary visibility path, with
  logs as fallback path.
  Rationale: Minimizes scope while satisfying roadmap wording and preserving
  deterministic verification.

- Decision: Require full gate stack even for documentation-adjacent work in the
  final implementation change.
  Rationale: User requirement explicitly names required commands.

- Decision: Build this plan from a multi-agent synthesis using shared
  `context_pack` references.
  Rationale: Improves coverage of requirements, touchpoints, and rollout risk
  while maintaining a single coherent execution document.

- Decision: Keep diagnostics verification in the existing About dialog instead
  of introducing a new diagnostics panel.
  Rationale: Meets roadmap success criteria with lower blast radius and no new
  UI workflow.

- Decision: Revert schema regeneration side effects after gate execution.
  Rationale: Regenerated schema diffs were unrelated to roadmap `2.2.1` and
  would broaden the change beyond requested rendering instrumentation work.

## Outcomes & Retrospective

Delivered behavior summary:

1. Added WebGL allocation metrics (current and peak) by tracking renderer-type
   state changes in `app/utils/renderer-utils.ts`.
2. Preserved and continued fallback reason event counting from
   `RendererFallbackReason` telemetry.
3. Exposed metrics in developer diagnostics output (About dialog) with lines
   for:
   - `WebGL contexts: current <n>, peak <n>`
   - `Renderer fallbacks: total <n>; reasons: ...`
4. Updated developer practice documentation in `docs/developers-guide.md`.
5. Marked roadmap `2.2.1` and sub-items complete in `docs/roadmap.md`.

Gate outcomes:

- `bun install`: pass (exit 0)
  log: `/tmp/install-velocetty-2-2-1-web-gl-allocation-and-fallback-metrics.out`
- `make build`: pass (exit 0)
  log: `/tmp/build-velocetty-2-2-1-web-gl-allocation-and-fallback-metrics.out`
- `make check-fmt`: pass (exit 0)
  log: `/tmp/check-fmt-velocetty-2-2-1-web-gl-allocation-and-fallback-metrics.out`
- `make lint`: pass (exit 0)
  log: `/tmp/lint-velocetty-2-2-1-web-gl-allocation-and-fallback-metrics.out`
- `make test`: pass (exit 0)
  log: `/tmp/test-velocetty-2-2-1-web-gl-allocation-and-fallback-metrics.out`

Targeted verification reruns:

- `bun test test/unit/renderer-utils.test.ts`: pass
- `bun test test/unit/term-report-renderer.test.ts`: pass

Remaining follow-ups / non-goals:

1. This work intentionally does not add frame-timing or PTY batching metrics;
   those remain in roadmap `2.2.2`.

Lessons for roadmap `2.2.2`:

1. Reuse existing diagnostics surfaces and telemetry flow first, then add new
   UI only if existing channels cannot satisfy observability requirements.
2. Keep dedicated state-reset helpers in testable utility modules to avoid
   brittle mutation-based test resets.
