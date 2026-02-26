# Add context-loss recovery and fallback instrumentation (roadmap 2.1.2)

## Module header

- Purpose: capture the execution plan for roadmap item `2.1.2`, including
  WebGL context-loss fallback and retry instrumentation updates.
- Invariants: context loss must fall back to Canvas immediately; retries must
  be controlled and observable through existing renderer instrumentation.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/developers-guide.md`, `lib/components/term.tsx`, and
  `lib/utils/webgl-context-pool.ts`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE (2026-02-26)

No `PLANS.md` exists at repository root as of 2026-02-26, so this plan is
self-contained.

## Purpose / big picture

Roadmap item `2.1.2` requires context-loss recovery behaviour on top of the
visible-only WebGL allocation work from `2.1.1`. The change must keep terminal
rendering stable when a WebGL context is lost, recover by switching to Canvas,
and retry WebGL attachment later when resources are available.

Success is observable when:

- context-loss paths do not crash renderer terminals;
- terminals fall back to Canvas immediately after loss events;
- retry behaviour is bounded and routed through visibility/pool resync paths;
- renderer-mode and fallback behaviour remains visible via instrumentation.

## Scope and non-goals

In scope:

- Document `2.1.2` implementation constraints and validation steps.
- Update developer practice notes for context-loss fallback instrumentation and
  retry semantics.
- Mark roadmap `2.1.2` and its sub-bullets complete.

Out of scope:

- New rendering features outside context-loss recovery and retry behaviour.
- Broad refactors outside `2.1.2` documentation and roadmap tracking.

## Constraints

- Keep updates scoped to roadmap item `2.1.2`.
- Preserve immediate context-loss fallback in `Term`:
  detach WebGL, attach Canvas, and schedule visibility resync.
- Keep retry logic bounded by the existing cooldown and failure-threshold
  controls in `lib/components/term.tsx`.
- Preserve instrumentation surfaces already used for renderer observability:
  context-loss warning logs and `Term.reportRenderer(...)` transport events.
- Keep documentation wrapped to 80 columns and preserve repository style.
- Do not claim gate success in documentation until those commands have run and
  produced evidence.
- Required gates for closure remain:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Tolerances (exception triggers)

- Scope: if required updates exceed the three owned documentation files, stop
  and confirm expanded scope.
- Behaviour: if documenting `2.1.2` requires changing runtime contracts or IPC
  event names, stop and escalate.
- Evidence: if gate evidence is missing, keep status as in progress and do not
  state completion.
- Tooling: if required tooling for source verification is unavailable, record
  fallback approach in `Surprises & Discoveries`.

## Risks

- Risk: docs overstate observability beyond implemented surfaces.
  Severity: medium
  Likelihood: medium
  Mitigation: anchor guidance to concrete behaviour in `term.tsx`,
  `window.ts`, and renderer utility wiring.

- Risk: roadmap marks `2.1.2` done while validation evidence is not captured in
  this update pass.
  Severity: medium
  Likelihood: medium
  Mitigation: keep gate status explicitly pending in this ExecPlan.

- Risk: retry guidance drifts from runtime constants and thresholds.
  Severity: medium
  Likelihood: low
  Mitigation: document current cooldown/threshold semantics and require docs
  updates alongside future tuning changes.

## Orientation

Primary references and implementation surfaces:

- `lib/components/term.tsx`: context-loss callback, fallback attach/detach, and
  retry cooldown/threshold logic.
- `lib/utils/webgl-context-pool.ts`: capped allocation and LRU eviction
  behaviour that determines retry opportunities.
- `app/ui/window.ts` and `app/utils/renderer-utils.ts`: renderer event handling
  used by About-dialog observability.
- `docs/velocetty-design.md` (`WebGL context pool`, `Observability`):
  normative roadmap intent for fallback and instrumentation.

## Milestones

### Milestone 0 - Baseline and constraints capture

Confirm branch and current roadmap/developer-guide state before edits:

```bash
git branch --show
nl -ba docs/roadmap.md | sed -n '146,170p'
nl -ba docs/developers-guide.md | sed -n '130,220p'
```

### Milestone 1 - Update this ExecPlan (living document)

Create/update `docs/execplans/2-1-2-add-context-loss-recovery.md` with:

- mandatory living sections;
- explicit `IN PROGRESS` status;
- concrete gate commands and evidence paths;
- truthful pending-state notes where validation is not yet run.

### Milestone 2 - Update developer practice guidance

Add context-loss recovery guidance to `docs/developers-guide.md`, covering:

- immediate fallback behaviour (`onContextLoss` -> Canvas);
- bounded retry/cooldown behaviour and threshold semantics;
- instrumentation expectations (`console.warn` fallback signal and
  `Term.reportRenderer(...)` event flow).

### Milestone 3 - Mark roadmap item 2.1.2 done

Update `docs/roadmap.md` so `2.1.2` and all sub-bullets are checked.

### Milestone 4 - Required gate replay with durable logs

Run required gates in order with `tee` logs:

```bash
set -o pipefail
PROJECT_NAME="$(get-project 2>/dev/null || basename "$PWD")"
BRANCH_NAME="$(git branch --show)"

bun install 2>&1 | tee "/tmp/bun-install-${PROJECT_NAME}-${BRANCH_NAME}.out"
make build 2>&1 | tee "/tmp/build-${PROJECT_NAME}-${BRANCH_NAME}.out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-${PROJECT_NAME}-${BRANCH_NAME}.out"
make lint 2>&1 | tee "/tmp/lint-${PROJECT_NAME}-${BRANCH_NAME}.out"
make test 2>&1 | tee "/tmp/test-${PROJECT_NAME}-${BRANCH_NAME}.out"
```

Build currently emits generated artefacts in `shared/src/` that can break
`make check-fmt`. Clean those generated files between build and format gates:

```bash
git clean -f \
  shared/src/constants/sessions.js \
  shared/src/constants/sessions.js.map \
  shared/src/constants/term-groups.js \
  shared/src/constants/term-groups.js.map \
  shared/src/index.js \
  shared/src/index.js.map \
  shared/src/types/common.d.ts \
  shared/src/types/common.js \
  shared/src/types/common.js.map \
  shared/src/types/transport.js \
  shared/src/types/transport.js.map
```

### Milestone 5 - Close out outcomes and status

After gate evidence is captured, update this file with:

- final status;
- gate outcomes and log paths;
- retrospective notes and follow-up items, if any.

## Validation matrix

Documentation validation:

- `docs/execplans/2-1-2-add-context-loss-recovery.md` exists and stays
  self-contained.
- `docs/developers-guide.md` includes 2.1.2 fallback/retry instrumentation
  guidance.
- `docs/roadmap.md` marks `2.1.2` and all sub-items as complete.

Gate validation (required for final closure):

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

## Progress

- [x] (2026-02-26 00:00Z) Confirmed branch
  `2-1-2-add-context-loss-recovery` and scoped owned files.
- [x] (2026-02-26 00:00Z) Captured roadmap `2.1.2` checklist and design
  requirements for context-loss recovery and observability.
- [x] (2026-02-26 00:00Z) Verified runtime behaviour references in
  `lib/components/term.tsx`, `lib/utils/webgl-context-pool.ts`,
  `app/ui/window.ts`, and `app/utils/renderer-utils.ts`.
- [x] (2026-02-26 00:00Z) Authored this ExecPlan with mandatory living sections
  and required gate commands.
- [x] (2026-02-26 00:00Z) Updated `docs/developers-guide.md` with `2.1.2`
  development-practice guidance.
- [x] (2026-02-26 00:00Z) Marked roadmap item `2.1.2` and sub-bullets done in
  `docs/roadmap.md`.
- [x] (2026-02-26 00:00Z) Ran required gates and captured evidence logs:
  `/tmp/bun-install-velocetty-2-1-2-add-context-loss-recovery.out`,
  `/tmp/build-velocetty-2-1-2-add-context-loss-recovery.out`,
  `/tmp/check-fmt-velocetty-2-1-2-add-context-loss-recovery.out`,
  `/tmp/lint-velocetty-2-1-2-add-context-loss-recovery.out`, and
  `/tmp/test-velocetty-2-1-2-add-context-loss-recovery.out`.
- [x] (2026-02-26 00:00Z) Finalized outcomes and retrospective after gate
  evidence capture.

## Surprises & Discoveries

- Observation: `docs/execplans/2-1-2-add-context-loss-recovery.md` did not
  exist and needed creation for roadmap `2.1.2`.
  Evidence: `nl` reported file-not-found during baseline inspection.
  Impact: this pass includes first-version plan authoring.

- Observation: running `make build` produced generated files in `shared/src/`
  (`*.js`, `*.js.map`, and `common.d.ts`) that caused `make check-fmt` to fail.
  Evidence: initial `make check-fmt` failed with six Biome formatting errors in
  generated `shared/src` artefacts; cleaning those files restored format-gate
  success.
  Impact: gate replay now includes `git clean -f` for those generated files
  before `make check-fmt`.

- Observation: renderer observability currently depends on renderer-type events
  and fallback warning logs rather than a dedicated fallback metrics sink.
  Evidence: `Term.reportRenderer(...)` emits `info renderer`; context-loss path
  uses `console.warn(...)`.
  Impact: developer guidance must describe this current instrumentation path
  accurately.

## Decision Log

- Decision: mark plan status as `COMPLETE` after all required gate commands
  succeeded with durable logs.
  Rationale: roadmap/docs/code updates are in place and validation evidence is
  present.
  Date/Author: 2026-02-26 / Codex.

- Decision: document context-loss instrumentation using current renderer event
  and warning-log surfaces only.
  Rationale: this remains truthful to implemented behaviour and avoids claiming
  unimplemented metrics.
  Date/Author: 2026-02-26 / Codex.

- Decision: mark roadmap `2.1.2` and sub-bullets done after implementation and
  carry explicit gate evidence in this plan.
  Rationale: roadmap closure and gate evidence must stay synchronized to avoid
  false completion signalling.
  Date/Author: 2026-02-26 / Codex.

## Outcomes & Retrospective

Current outcome:

- Runtime behaviour for roadmap `2.1.2` is implemented:
  context-loss fallback, deterministic retry, and fallback-reason
  instrumentation.
- `docs/execplans/2-1-2-add-context-loss-recovery.md`,
  `docs/developers-guide.md`, and `docs/roadmap.md` are updated and aligned
  with delivered behaviour.
- Required gates succeeded with durable logs:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

Retrospective:

- Anchoring practice guidance to concrete runtime symbols reduces drift risk.
- Keeping gate status explicit prevents false completion signalling.
- Build artefact spillover (`shared/src` generated files) must be cleaned before
  format gates in this repository.

## Revision note

- 2026-02-26: finalized plan to `COMPLETE`, added full gate evidence, documented
  the build-artefact cleanup step needed before format checks, and reconciled
  outcomes with implemented code and docs.
