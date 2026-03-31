# Define layering rules and hot-reload semantics (roadmap 3.1.2)

## Module header

- Purpose: define an implementation-ready execution plan for roadmap item
  `3.1.2` to establish config layering rules (defaults → user config → runtime
  overrides) and hot-reload semantics (which settings reload live versus require
  restart), with clear user-facing warnings for non-reloadable changes.
- Invariants: preserve existing startup behaviour, maintain non-fatal fallback
  for invalid config, and ensure UI surfaces restart requirements clearly.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`,
  `docs/developers-guide.md`, `docs/tracking-issues.md`,
  `shared/src/types/config.ts`, `shared/src/constants/config.ts`,
  `app/config/json5-config.ts`, and `app/config/import.ts`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: DRAFT

## Purpose / big picture

Roadmap item `3.1.2` requires explicit layering rules for configuration and
hot-reload semantics that define which settings apply without restart and which
trigger a restart-required warning. After this work:

- Configuration merges predictably through layers:
  built-in defaults → user `config.json5` → optional workspace overrides →
  ephemeral runtime overrides.
- Each setting declares its reload capability: live-reloadable changes apply
  immediately; non-reloadable changes surface a clear warning in the UI.
- The settings UI displays restart-required indicators next to non-reloadable
  settings.

This plan covers only `3.1.2`. It intentionally does not implement the
keybindings layering tracked by `3.2.1` or plugin settings storage tracked by
`3.2.2`.

## Constraints

- Keep changes scoped to roadmap item `3.1.2` and required supporting docs.
- Implementation starts only after explicit user approval.
- Preserve non-fatal startup behaviour for invalid user configuration.
- Maintain backward compatibility with existing config file paths and shapes.
- Do not introduce breaking changes to `configOptions` or `rawConfig` types
  without explicit decision and migration path.
- Layering merge semantics must follow design document specification:
  deep merge for objects, replace for arrays.
- All reloadable/non-reloadable classifications must be documented and
  test-covered.
- Keep documentation and tests updated in the same change set as runtime code.
- Do not mark roadmap `3.1.2` complete until all required gates pass with
  captured logs.
- Required release gates for closure are:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Tolerances (exception triggers)

- Scope: if implementation requires touching more than 16 files, stop and
  reassess scope before continuing.
- Interface: if public config contracts outside 3.1.2 must change, stop and
  escalate.
- Ambiguity: if reloadable versus non-reloadable classification cannot be
  determined for a setting using design document guidance, stop, and request
  explicit direction.
- Dependency: if a new external dependency is required for hot-reload
  implementation, stop and escalate first.
- Iteration: if any one failing gate repeats 3 times without progress, stop,
  and record blocker state.
- Evidence: if any required gate exits non-zero or is interrupted, keep status
  partial and do not mark roadmap item done.

## Risks

- Risk: reloadable setting implementation may require component rearchitecture
  to receive config updates reactively.
  Severity: medium
  Likelihood: medium
  Mitigation: classify borderline settings as non-reloadable initially;
  implement live-reload only where update paths already exist (theme, font,
  keybindings).

- Risk: current config loading happens primarily at startup; runtime override
  persistence may conflict with comment/format retention from 3.1.1.
  Severity: medium
  Likelihood: medium
  Mitigation: reuse existing roundtrip-retention writer from 3.1.1;
  runtime overrides are ephemeral by default and do not write to disk unless
  explicitly persisted.

- Risk: tracking issue CONFIG-001 already documents WebGL renderer hot-reload
  as an open item; overlap with this work must be managed.
  Severity: low
  Likelihood: high
  Mitigation: explicitly defer WebGL renderer hot-reload to CONFIG-001;
  classify `webGLRenderer` as non-reloadable in this milestone.

- Risk: workspace-level overrides may not have a clear resolution path in the
  current codebase.
  Severity: medium
  Likelihood: medium
  Mitigation: treat workspace overrides as a deferred feature;
  implement only built-in defaults → user config → runtime overrides in this
  milestone, with explicit extension point for workspace layer.

- Risk: UI warning surfaces for non-reloadable settings may require new
  components or translation strings.
  Severity: low
  Likelihood: low
  Mitigation: reuse existing notification and settings UI components;
  add simple restart-required indicator icons/labels.

## Context and orientation

Relevant current state:

- `shared/src/types/config.ts` defines `configOptions`, `rawConfig`, and
  `configValidationDiagnostic` types used throughout the application.
- `shared/src/constants/config.ts` defines `CONFIG_LOAD` and `CONFIG_RELOAD`
  action constants for Redux state management.
- `app/config/json5-config.ts` provides JSON5 parsing with structured
  diagnostics and schema validation from 3.1.1.
- `app/config/import.ts` drives config import with fallback to defaults and
  user notification on errors.
- `docs/tracking-issues.md` contains CONFIG-001 tracking WebGL renderer
  hot-reload as a separate deferred item.
- Config is loaded at startup and dispatched via `CONFIG_LOAD`; subsequent
  file changes trigger `CONFIG_RELOAD` but current handling does not
  distinguish live-reloadable from restart-required changes.

Roadmap/design anchors:

- `docs/roadmap.md` lines `234-239` define `3.1.2` success criteria.
- `docs/velocetty-design.md` section `Configuration system: JSON5 and layering`
  (lines `912-1082`) specifies layering rules and hot-reload semantics,
  including which categories are hot-reloadable versus restart-required.
- `docs/velocetty-design.md` section `Hot reload semantics` (lines `1042-1079`)
  explicitly lists:
  - Hot reload: theme/UI appearance, font settings, keybindings, tab decoration
    preferences, plugin enable/disable.
  - Restart required: backend transport settings, update channel settings,
    any backend-owned setting affecting process-level configuration.
- `docs/velocetty-product-requirements-document.md` workstream 2
  (`Configuration: move to JSON5`) calls for layering rules and hot-reload
  semantics as explicit deliverables.

## Plan of work

### Stage A: Scope lock and reload classification (no runtime behaviour changes)

Audit all `configOptions` fields and classify each as `liveReloadable` or
`requiresRestart`, using design document guidance as primary source.

Create a source-of-truth registry in `shared/src/constants/config.ts` that
maps config keys to their reload capability, with explicit classification
rationale in comments.

Add unit tests that verify the classification registry is complete (every
config key has a classification) and consistent (no key appears in both
categories).

Do not proceed to Stage B until classification is documented and red tests
fail for current behaviour.

### Stage B: Layering implementation and merge semantics

Implement explicit layering in the config loading path:

1. Built-in defaults (from `app/config/config-default.json`).
2. User config (`config.json5` parsed with 3.1.1 infrastructure).
3. Runtime overrides (ephemeral, in-memory only, not persisted).

Implement deep merge for objects, replace for arrays as per design spec.
Merge should produce a single resolved `configOptions` shape for consumption.

Add unit tests verifying merge behaviour:
- User values override defaults.
- Nested objects merge deeply rather than replace.
- Arrays in user config replace arrays from defaults.
- Runtime overrides take precedence over user config.

### Stage C: Hot-reload detection and warning system

Implement reload capability checking in the config reload path:

- On `CONFIG_RELOAD`, compare new config against current effective config.
- Identify which changed settings are live-reloadable versus
  restart-required.
- For live-reloadable changes: apply immediately and emit optional
  telemetry.
- For restart-required changes: queue the change (do not apply), emit
  a structured warning diagnostic, and surface UI notification.

Add notification/warning infrastructure:
- Extend `configValidationDiagnostic` or create parallel
  `ConfigReloadDiagnostic` type for restart-required warnings.
- Add restart-required indicator capability to settings UI metadata.

Add unit tests:
- Live-reloadable changes apply without restart warning.
- Restart-required changes trigger warning diagnostics.
- Mixed changes apply live-reloadable subset and warn on remainder.

### Stage D: Settings UI integration

Update settings UI to display restart-required indicators:

- Settings schema metadata includes `requiresRestart: boolean` flag.
- UI renders warning icon or label next to non-reloadable settings.
- When user modifies a non-reloadable setting, inline warning appears
  explaining restart requirement.

Add or update component-level tests verifying restart-required indicators
render correctly.

### Stage E: Documentation, tracking issue alignment, and full gates

Update `docs/developers-guide.md` with:
- Layering rules and merge semantics for config contributors.
- How to classify new settings as live-reloadable or restart-required.
- Warning system behaviour for non-reloadable changes.

Update `docs/tracking-issues.md`:
- Reference CONFIG-001 for WebGL renderer hot-reload deferral.
- Add any new tracking items for deferred workspace-level overrides.

Run full required gates with tee logs.
Only after all gates pass, mark roadmap item `3.1.2` and sub-bullets done.

## Concrete steps

<!-- markdownlint-disable MD029 -->

1. Baseline and scope verification:

```bash
git branch --show
nl -ba docs/roadmap.md | sed -n '234,240p'
nl -ba docs/velocetty-design.md | sed -n '1042,1080p'
```

2. Classification audit and registry creation:

- Audit `shared/src/types/config.ts` `configOptions` fields.
- Create `shared/src/constants/config-reloadability.ts` (or extend
  `shared/src/constants/config.ts`) with reloadability registry.
- Document rationale for each classification in source comments.

3. Add classification completeness tests:

```bash
set -o pipefail
TEST_LOG="/tmp/test-config-reloadability-$(get-project)-$(git branch --show).out"
bun test --max-concurrency=1 test/unit/config-reloadability.test.ts 2>&1 | tee "$TEST_LOG"
```

4. Implement layering and merge semantics:

- Extend `app/config/json5-config.ts` with merge helpers.
- Update `app/config/import.ts` layering resolution order.
- Target files:
  - `app/config/json5-config.ts` (merge implementation)
  - `app/config/import.ts` (layering orchestration)

5. Add layering merge tests:

- `test/unit/config-layering.test.ts` (new file)

6. Implement hot-reload detection:

- Extend config reload action handling in `app/config/` or Redux layer.
- Add diff detection comparing old versus new config.
- Route changes through live-apply or warning-queue paths.
- Target files:
  - `app/config/reload-handler.ts` (new file).
  - Redux reducer handling `CONFIG_RELOAD`.

7. Add hot-reload detection tests:

- `test/unit/config-hot-reload.test.ts` (new file)

8. Implement warning system:

- Extend diagnostic types if needed in `shared/src/types/config.ts`.
- Add notification emission for restart-required changes.

9. Settings UI integration:

- Update settings UI components to consume reloadability metadata.
- Add restart-required indicators (icons, labels, inline warnings).
- Target files:
  - Settings UI components in `lib/components/` or `frontend/`.

10. Update developer guidance:

- `docs/developers-guide.md` (layering and reloadability practice)
- `docs/tracking-issues.md` (CONFIG-001 reference, deferral documentation)

11. Run required full gates with durable logs:

```bash
set -o pipefail
bun install 2>&1 | tee "/tmp/bun-install-$(get-project)-$(git branch --show).out"
make build 2>&1 | tee "/tmp/build-$(get-project)-$(git branch --show).out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-$(get-project)-$(git branch --show).out"
make lint 2>&1 | tee "/tmp/lint-$(get-project)-$(git branch --show).out"
make test 2>&1 | tee "/tmp/test-$(get-project)-$(git branch --show).out"
```

12. If docs changed, run docs gates too:

```bash
set -o pipefail
bunx markdownlint-cli2 "docs/**/*.md" 2>&1 | tee "/tmp/markdownlint-$(get-project)-$(git branch --show).out"
nixie --no-sandbox 2>&1 | tee "/tmp/nixie-$(get-project)-$(git branch --show).out"
```

13. Roadmap closure (only after successful gates):

- Mark `docs/roadmap.md` item `3.1.2` and all child bullets complete.
- Record gate evidence paths in this ExecPlan.

<!-- markdownlint-enable MD029 -->

## Validation and acceptance

Behavioural acceptance:

- All `configOptions` fields have an explicit reloadability classification.
- Layering merges in order: defaults → user config → runtime overrides.
- Object values merge deeply; array values replace.
- Live-reloadable changes (theme, font, keybindings, tab decorations,
  plugin enable/disable) apply without restart.
- Restart-required changes (backend transport, update channel, process-level
  settings) trigger clear warnings and do not apply until restart.
- Settings UI displays restart-required indicators for non-reloadable
  settings.
- Warning diagnostics include setting path, message, and restart requirement.

Required quality gates:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Additional documentation gates when docs change:

- `bunx markdownlint-cli2 "docs/**/*.md"`
- `nixie --no-sandbox`

## Interfaces and dependencies

Planned interface additions/updates:

- `ConfigReloadability` registry type mapping config keys to
  `'live' | 'restart'` classifications.
- `ConfigLayer` type for explicit layering stages (defaults, user, workspace,
  runtime).
- `ConfigReloadResult` type capturing applied changes and queued warnings.
- `ConfigReloadDiagnostic` type for restart-required warnings (may extend
  existing `configValidationDiagnostic`).
- Settings schema metadata extension: `requiresRestart?: boolean`.

Planned dependency posture:

- Reuse existing JSON5 parsing and roundtrip-retention from 3.1.1.
- Reuse existing Redux action infrastructure (`CONFIG_LOAD`, `CONFIG_RELOAD`).
- Reuse existing notification system for warning surfaces.
- No new external dependencies planned.

## Idempotence and recovery

- All steps are re-runnable.
- If a gate fails, fix the issue and rerun only the failing gate first, then
  rerun the full required gate bundle.
- If implementation broadens beyond defined tolerances, stop and update
  `Decision Log` before proceeding.
- Do not mark roadmap done during partial gate states.

## Artifacts and notes

Expected evidence artifacts:

- `/tmp/test-config-reloadability-<project>-<branch>.out`
- `/tmp/bun-install-<project>-<branch>.out`
- `/tmp/build-<project>-<branch>.out`
- `/tmp/check-fmt-<project>-<branch>.out`
- `/tmp/lint-<project>-<branch>.out`
- `/tmp/test-<project>-<branch>.out`
- Optional documentation logs:
  `/tmp/markdownlint-<project>-<branch>.out` and
  `/tmp/nixie-<project>-<branch>.out`.

Classification reference from design document (`velocetty-design.md`):

Hot reload (no restart):

- Theme and UI appearance settings
- Font settings (may require xterm reconfigure but not restart)
- Keybindings
- Tab decoration preferences
- Plugin enable/disable (subject to safe unload)

Restart required:

- Backend transport settings (listening addresses)
- Update channel settings (depending on implementation)
- Any backend-owned setting that affects process-level configuration

Deferred to CONFIG-001:

- `webGLRenderer` hot-reload (explicitly tracked as open)

## Progress

- [ ] (YYYY-MM-DD HH:MMZ) Step template.

## Surprises & discoveries

- Observation: placeholder for unexpected findings during implementation.
  Evidence: none yet.
  Impact: none yet.

## Decision log

- Decision: keep this plan in `DRAFT` status and block implementation until
  explicit user approval.
  Rationale: execplan workflow requires approval gate before execution.
  Date/Author: 2026-03-27 / Codex.

- Decision: explicitly defer WebGL renderer hot-reload to CONFIG-001 rather
  than attempting in this milestone.
  Rationale: CONFIG-001 is already an open tracking item with distinct
  technical challenges (requires terminal session restart handling).
  Date/Author: 2026-03-27 / Codex.

- Decision: treat workspace-level overrides as a deferred feature, implementing
  only three layers (defaults → user → runtime) in this milestone.
  Rationale: workspace override resolution paths are not yet defined in the
  codebase; design document lists them as optional; deferral reduces risk.
  Date/Author: 2026-03-27 / Codex.

- Decision: include both required release gates and documentation gates in this
  plan, while treating roadmap closure as contingent on required release gates.
  Rationale: user requested full release gate success and repository docs rules
  require doc validation when docs change.
  Date/Author: 2026-03-27 / Codex.

## Outcomes & retrospective

Pending implementation completion.

## Revision note

Initial draft created from roadmap/design/codebase evidence.
Status: DRAFT awaiting approval.
