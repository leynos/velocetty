# Implement pane visibility detection and WebGL context pooling (roadmap 2.1.1)

## Module header

- Purpose: implement roadmap item `2.1.1` by introducing a visibility model
  and a WebGL context pool that allocates contexts only to visible panes.
- Invariants: hidden panes must render through Canvas, and WebGL allocations
  must never exceed the configured maximum.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`, and
  `docs/developers-guide.md`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: COMPLETE (2026-02-25)

No `PLANS.md` exists at repository root as of 2026-02-25, so this plan is
self-contained.

## Purpose / big picture

Roadmap item `2.1.1` requires visible-only WebGL rendering with explicit
allocation control. The current renderer selection in `lib/components/term.tsx`
chooses WebGL or Canvas once at mount time and does not coordinate context
usage across panes. That permits hidden panes to retain WebGL and gives no
global cap enforcement.

After this change, visible panes should request WebGL from a shared pool while
hidden panes fall back to Canvas. Visibility must be derived from the active
tab, layout bounds, and occlusion checks, matching design constraints.
Success is observable when:

- hidden panes report Canvas renderer usage;
- visible panes can obtain WebGL up to the configured maximum;
- when the limit is reached, LRU eviction reclaims WebGL from less-recently
  visible panes, so the cap is never exceeded.

## Constraints

- Implement `2.1.1` only; do not mark `2.1.2` done in this pass.
- Keep renderer telemetry surface stable through `Term.reportRenderer(...)` so
  `app/ui/window.ts` and `app/menus/menu.ts` continue working.
- Define visibility using all required signals:
  - active tab state;
  - non-zero layout bounds;
  - occlusion detection.
- Introduce a shared WebGL context pool with LRU eviction.
- Enforce a configurable maximum for pooled WebGL contexts.
- Preserve existing transparent-background and unsupported-WebGL fallbacks.
- Update `docs/developers-guide.md` with any new development practices.
- Mark roadmap item `2.1.1` complete only after required gates pass:
  `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.

## Tolerances (exception triggers)

- Scope: if changes exceed 14 files or 850 net lines, stop and re-scope.
- Contract: if plugin-facing `getTermProps` / `getTermGroupProps` hooks require
  breaking changes, stop and escalate.
- Runtime: if dynamic renderer switching causes term re-creation or session
  loss, stop and escalate.
- Gates: if any required gate fails after two focused remediation passes, stop
  and escalate with log excerpts.
- Ambiguity: if design and roadmap requirements conflict on visibility signals
  or max-context behaviour, stop and request direction.

## Risks

- Risk: dynamic addon switching can leak renderer addons or attach duplicates.
  Severity: high
  Likelihood: medium
  Mitigation: centralize attach/detach logic, hold explicit addon references,
  and dispose before replacement.

- Risk: occlusion heuristics can misclassify panes as hidden.
  Severity: medium
  Likelihood: medium
  Mitigation: combine root-group active signal with bounds and
  `elementFromPoint` checks rather than relying on one signal.

- Risk: introducing a new config option may drift between schema, runtime
  reducer, and typings.
  Severity: medium
  Likelihood: medium
  Mitigation: update `shared/src/types/config.ts`, `app/config/schema.json`,
  `app/config/config-default.json`, reducer wiring, and typings in one pass.

- Risk: pool eviction policy may violate max-cap under rapid visibility churn.
  Severity: high
  Likelihood: low
  Mitigation: make pool state transitions atomic and cover with dedicated unit
  tests for acquire/release/evict behaviour.

## Progress

- [x] (2026-02-25 22:00Z) Confirmed roadmap `2.1.1` scope and success criteria
  in `docs/roadmap.md`.
- [x] (2026-02-25 22:01Z) Mapped design constraints for visibility model and
  WebGL context pool in `docs/velocetty-design.md`.
- [x] (2026-02-25 22:02Z) Mapped current rendering/config wiring in
  `lib/components/term.tsx`, `lib/components/terms.tsx`,
  `lib/components/term-group.tsx`, `lib/containers/terms.ts`,
  `lib/reducers/ui.ts`, and `typings/hyper.d.ts`.
- [x] (2026-02-25 22:03Z) Drafted this ExecPlan.
- [x] (2026-02-25 22:10Z) Implemented visibility model + WebGL context pool
  with LRU allocation and Canvas fallback wiring.
- [x] (2026-02-25 22:11Z) Added unit tests for pool and visibility helpers:
  `test/unit/webgl-context-pool.test.ts` and
  `test/unit/pane-visibility.test.ts`.
- [x] (2026-02-25 22:30Z) Updated `docs/developers-guide.md` with
  visible-only WebGL development practice.
- [x] (2026-02-25 22:30Z) Marked roadmap item `2.1.1` complete in
  `docs/roadmap.md`.
- [x] (2026-02-25 22:33Z) Ran required gates and confirmed success:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and
  `make test`.

## Surprises & discoveries

- Observation: `Terms` already moves inactive root groups offscreen using CSS
  (`left: -9999em`), but this is not represented in the renderer allocation
  logic.
  Evidence: `lib/components/terms.tsx`.
  Impact: active-tab information must be propagated explicitly to the term-level
  visibility model.

- Observation: WebGL fallback on context loss exists, but there is no
  centralized allocator.
  Evidence: `lib/components/term.tsx` current direct `WebglAddon` use.
  Impact: pool service is needed before visibility-based allocation can be
  deterministic.

- Observation: `bun install` can fail in this workspace when the symlinked
  cache path (`/tmp/velocetty-ci-work/cache`) does not exist.
  Evidence: failed installation with `OpenError` on `cache/LOCK`.
  Impact: gate replay required creating cache/dist directories before rerunning
  required commands.

- Observation: `make build` emits untracked `shared/src/*.js` and
  `shared/src/types/*.d.ts` files, and `make check-fmt` validates them when they
  are present.
  Evidence: `make check-fmt` failed with Biome format errors for generated
  shared JS/d.ts outputs until they were formatted.
  Impact: formatting normalization was required between build and check-fmt in
  this workspace.

## Decision log

- Decision: add a new config option for maximum WebGL contexts rather than
  hard-coding `16` only.
  Rationale: roadmap success criteria references the configured maximum, and
  design calls out a default with configurability.
  Date/Author: 2026-02-25 / Codex.

- Decision: model occlusion using viewport hit-testing
  (`document.elementFromPoint`) combined with active-tab and bounds checks.
  Rationale: this captures modal overlays without introducing new global UI
  state contracts in this milestone.
  Date/Author: 2026-02-25 / Codex.

- Decision: treat `webGLRendererMaxContexts` as a positive integer and fall
  back to default when invalid values are encountered.
  Rationale: the pool requires an integer capacity and roadmap success criteria
  depend on deterministic cap enforcement.
  Date/Author: 2026-02-25 / Codex.

## Outcomes & retrospective

Implementation is complete. Outcomes:

- panes now use a shared visibility model based on active tab, bounds, and
  occlusion;
- WebGL allocation is pooled and capped by `webGLRendererMaxContexts` with LRU
  eviction;
- hidden panes detach WebGL and fall back to Canvas;
- configuration, schema, reducer state, and typings are aligned for the new
  context-cap setting;
- roadmap item `2.1.1` and its sub-checklist are marked complete;
- developers guide now documents the new rendering practice.

Retrospective:

- Keeping visibility and pool logic in dedicated utility modules simplified test
  coverage and reduced risk in `Term` lifecycle code.
- Running gate stacks with log files remained essential because `bun install`
  and build-generated artefacts introduced environment-specific and
  formatting-related failures that needed explicit remediation.

## Context and orientation

Primary implementation surfaces:

- `lib/components/term.tsx`: renderer attach/detach, context-loss handling, and
  per-pane visibility sync.
- `lib/utils/webgl-context-pool.ts` (new): shared pool state and LRU policy.
- `lib/utils/pane-visibility.ts` (new): active-tab/bounds/occlusion visibility
  helper.
- `lib/components/terms.tsx` and `lib/components/term-group.tsx`: propagate
  active-root visibility signal to each terminal pane.
- `lib/containers/terms.ts`, `lib/reducers/ui.ts`, `typings/hyper.d.ts`,
  `shared/src/types/config.ts`, `app/config/config-default.json`, and
  `app/config/schema.json`: configuration/type plumbing for max context count.
- `test/unit/webgl-context-pool.test.ts` and
  `test/unit/pane-visibility.test.ts` (new): deterministic behavioural tests.

## Plan of work

1. Add config/type plumbing for WebGL context max:
   - introduce a `webGLRendererMaxContexts` config field with default `16`;
   - wire it through schema, reducer, UI state, and terminal props.
2. Implement renderer pool and visibility helpers:
   - add a shared pool utility with `acquire`, `release`, and LRU eviction;
   - add a pane visibility helper based on active tab, bounds, and occlusion.
3. Refactor `Term` renderer lifecycle:
   - extract attach/detach helpers for WebGL and Canvas;
   - synchronize renderer mode on mount/update/resize and on visibility
     transitions;
   - release pooled WebGL allocation when panes become hidden or unmount.
4. Validate behaviour with unit tests:
   - pool tests cover acquisition cap and LRU eviction;
   - visibility tests cover active-tab, zero-bounds, and occlusion outcomes.
5. Update documentation and roadmap state:
   - document new development practice in `docs/developers-guide.md`;
   - mark `2.1.1` checkbox and sub-items complete in `docs/roadmap.md`.
6. Run required gates:
   - `bun install`
   - `make build`
   - `make check-fmt`
   - `make lint`
   - `make test`

## Validation and evidence

The change is complete only when all required gates pass in this order:

```bash
bun install
make build
make check-fmt
make lint
make test
```

Evidence should capture:

- pool unit tests proving capped allocation and LRU eviction;
- visibility unit tests proving active-tab + bounds + occlusion semantics;
- renderer telemetry still emitting through `Term.reportRenderer`;
- roadmap and developer-guide updates present in final diff.
