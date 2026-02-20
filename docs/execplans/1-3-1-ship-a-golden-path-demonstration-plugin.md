# Ship the golden path demonstration plugin (roadmap 1.3.1)

## Module header

- Purpose: deliver roadmap item `1.3.1` by shipping one example plugin that
  demonstrates plugin manifest metadata, settings schema/defaults, command and
  keybinding registration, and deterministic tab decoration output.
- Invariants: introduce the golden-path APIs and JSON5-backed plugin settings
  persistence without retaining legacy JSON-only config compatibility.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`,
  `docs/developers-guide.md`, and `PLUGINS.md`.

This Execution Plan (ExecPlan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: IMPLEMENTED (2026-02-20, approved and executed)

No `PLANS.md` exists at repository root as of 2026-02-20, so this plan is
self-contained.

## Purpose / big picture

Roadmap item `1.3.1` is the first full plugin-runtime demonstration milestone.
It is not only a sample plugin file. It is the proof that the runtime can:

- load plugin metadata with settings schema and defaults,
- accept plugin-contributed command and keybinding registrations,
- expose one tab decoration provider with deterministic merge behaviour, and
- persist plugin settings in JSON5 with enable/disable behaviour and
  event-driven decoration updates.

Success is observable when a developer can enable and disable the example
plugin, restart or live-reload, and see all three behaviours working with
tests proving they do not regress:

- the command is registered and invokable via keybinding,
- settings persist under a plugin namespace in JSON5 config,
- tab decoration output updates from explicit events and remains deterministic.

Completion also requires updating `docs/developers-guide.md`, marking roadmap
item `1.3.1` done in `docs/roadmap.md`, and passing required gates:
`bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Constraints

- Implement against roadmap `1.3.1` scope only. Do not pull forward broader
  plugin-system rewrites that belong to later roadmap items.
- Align runtime contracts with design sections:
  `docs/velocetty-design.md` plugin runtime and tab decoration API.
- Persist plugin settings in JSON5 format and namespaced location compatible
  with the design intent (`plugins.<pluginId>.*`).
- Backwards compatibility for legacy config-file format is explicitly out of
  scope for this milestone.
- Remove existing legacy migration logic in `app/config/migrate.ts` and related
  invocation paths as part of the config-format cut-over.
- Ensure deterministic tab decoration output. No randomness, wall-clock output,
  or non-deterministic provider ordering.
- Drive decoration refresh from explicit runtime events (for example, tab or
  session state updates), not polling loops.
- Keep Makefile-first validation and log capture discipline with `tee`.
- Update `docs/developers-guide.md` for any new required developer workflow
  introduced by this milestone.
- Mark `docs/roadmap.md` item `1.3.1` done only after all required gates pass.

## Tolerances (exception triggers)

- Scope tolerance: if implementation exceeds 18 files or 900 net changed lines,
  stop and escalate with options.
- JSON5 tolerance: if JSON5 persistence cannot be implemented without changing
  unrelated config semantics, stop and split a safe migration strategy.
- Eventing tolerance: if event-driven decoration updates require introducing a
  global polling fallback, stop and escalate.
- Validation tolerance: if any required gate fails after two focused remediation
  attempts, stop and report with log excerpts.
- Ambiguity tolerance: if roadmap/design wording implies incompatible runtime
  contracts, pause and request direction before coding further.

## Risks

- Risk: existing config import/migration paths use `JSON.parse` and
  `JSON.stringify`, so JSON5 syntax is currently unsupported and migration
  removal can create a one-way format transition.
  Severity: high
  Likelihood: high
  Mitigation: centralize parse/stringify helpers for config I/O, switch load and
  write paths together, remove migration entry points in the same change, and
  add tests that cover JSON5-specific syntax.

- Risk: runtime plugin APIs are still Hyper-style hook methods rather than the
  design's explicit plugin context registration surface.
  Severity: medium
  Likelihood: high
  Mitigation: introduce an additive bridge layer so the golden plugin can use
  the new runtime shape without breaking current plugins.

- Risk: tab decorations currently flow through `getTabProps`/`getTabsProps`
  decorators and may not have a first-class provider registry yet.
  Severity: high
  Likelihood: medium
  Mitigation: add a deterministic provider registry wrapper around existing tab
  prop decoration flow, then test provider ordering and event-triggered refresh.

- Risk: no existing focused tests cover plugin manifest/settings/decorations.
  Severity: medium
  Likelihood: high
  Mitigation: add targeted unit tests for runtime integration seams and update
  existing command registry and config-related suites where contracts change.

## Progress

- [x] (2026-02-20 00:00Z) Verified branch context and plan target path:
  `1-3-1-ship-a-golden-path-demonstration-plugin`.
- [x] (2026-02-20 00:00Z) Confirmed roadmap `1.3.1` checklist and success
  criteria in `docs/roadmap.md`.
- [x] (2026-02-20 00:00Z) Mapped design constraints for plugin runtime,
  settings persistence, and tab decoration APIs in `docs/velocetty-design.md`.
- [x] (2026-02-20 00:00Z) Mapped PRD workstream expectations for golden path
  plugin deliverables in `docs/velocetty-product-requirements-document.md`.
- [x] (2026-02-20 00:00Z) Audited current runtime seams in
  `app/plugins.ts`, `lib/utils/plugins.ts`, `lib/command-registry.ts`, and
  `app/config/import.ts`.
- [x] (2026-02-20 00:00Z) Drafted this ExecPlan.
- [x] (2026-02-20 19:00Z) Received explicit approval to proceed with
  implementation.
- [x] (2026-02-20 19:30Z) Executed Stage A contracts/scaffolding by adding
  runtime plugin manifest contracts and tab-decoration provider registry seams.
- [x] (2026-02-20 19:35Z) Executed Stage B by switching config read/write
  paths to JSON5 and removing legacy migration logic.
- [x] (2026-02-20 19:40Z) Executed Stage C by wiring runtime command and
  keybinding contributions through main/renderer command flow.
- [x] (2026-02-20 19:45Z) Executed Stage D by wiring deterministic tab
  decoration providers with explicit event-driven refresh subscriptions.
- [x] (2026-02-20 20:00Z) Executed Stage E by updating docs, marking roadmap
  item `1.3.1` done, and running required gates with captured logs.

## Surprises & Discoveries

- Observation: current config import and migration are JSON-only.
  Evidence: `app/config/import.ts` parses defaults, keymaps, and user config
  with `JSON.parse`; `app/config/migrate.ts` writes migrated config with
  `JSON.stringify`.
  Impact: roadmap success criteria requiring JSON5 persistence are currently not
  met and need implementation work in this milestone.

- Observation: plugin runtime currently supports legacy decoration hooks and
  keymap decoration, but has no explicit plugin manifest/settings contract.
  Evidence: `app/plugins/extensions.ts`, `app/plugins.ts`, and
  `lib/utils/plugins.ts` load and execute hook-based APIs.
  Impact: we need an additive manifest/settings layer and one golden plugin that
  exercises it without breaking old hooks.

- Observation: command registration is currently achieved via renderer-side
  `registerCommands` plumbing and keymaps from `getDecoratedKeymaps`.
  Evidence: `lib/components/terms.tsx`, `lib/command-registry.ts`,
  `lib/containers/hyper.tsx`.
  Impact: the golden-path command/keybinding path should integrate with these
  seams, then be gradually aligned toward the design runtime contract.

- Observation: `make build` can generate transient compiled JS/`d.ts` artefacts
  under `shared/src` that are not tracked source files.
  Evidence: build run created untracked files such as
  `shared/src/runtime/golden-path-demo.js` and `shared/src/types/common.d.ts`.
  Impact: clean these generated artefacts before `make check-fmt` so formatter
  gates run only on repository source files.

## Decision Log

- Decision: treat this as a planning-only turn and keep implementation blocked
  until explicit user approval.
  Rationale: ExecPlan workflow requires a draft and approval gate.
  Date/Author: 2026-02-20 / Codex

- Decision: structure implementation as additive compatibility layers rather
  than runtime replacement.
  Rationale: minimises blast radius and keeps existing plugin ecosystem working.
  Date/Author: 2026-02-20 / Codex

- Decision: run implementation with a small agent team and clearly owned
  workstreams.
  Rationale: the milestone crosses backend config I/O, plugin runtime, renderer
  command/keybinding paths, decoration logic, tests, and docs.
  Date/Author: 2026-02-20 / Codex

- Decision: intentionally drop legacy config-format backward compatibility and
  remove migration logic.
  Rationale: user direction states backward compatibility is not a goal for this
  milestone.
  Date/Author: 2026-02-20 / User/Codex

- Decision: represent plugin enablement as `config.plugins.<pluginId>.enabled`
  and gate runtime command/keybinding/decorations from that setting.
  Rationale: this keeps enable/disable behaviour deterministic and directly
  observable in JSON5 config persistence tests.
  Date/Author: 2026-02-20 / Codex

- Decision: keep tab-decoration updates event-driven through provider
  subscriptions and config change events, with no polling fallback.
  Rationale: this satisfies roadmap success criteria and aligns with design
  guidance for explicit event-driven runtime behaviour.
  Date/Author: 2026-02-20 / Codex

## Outcomes & Retrospective

Delivered behaviour matches roadmap `1.3.1` scope:

- Added a built-in golden-path runtime plugin manifest with settings schema and
  defaults, one command, one keybinding, and one deterministic tab-decoration
  provider.
- Added runtime plugin settings persistence helpers under
  `config.plugins.<pluginId>` using JSON5 parse/stringify semantics.
- Removed legacy config migration logic by deleting `app/config/migrate.ts`
  and removing migration-path dependencies from config bootstrap.
- Wired renderer and backend command/keybinding paths to include runtime plugin
  contributions only when enabled.
- Added a deterministic tab-decoration provider registry with explicit
  subscription-driven update notifications and bounded merged decoration slots.
- Added/updated focused unit tests for JSON5 config import, runtime plugin
  settings persistence, runtime command registration, provider ordering, and
  event-driven tab re-render updates.

Validation evidence (all passed in this implementation turn):

- `bun install`:
  `/tmp/install-velocetty-1-3-1-ship-a-golden-path-demonstration-plugin.out`
- `make build`:
  `/tmp/build-velocetty-1-3-1-ship-a-golden-path-demonstration-plugin.out`
- `make check-fmt`:
  `/tmp/check-fmt-velocetty-1-3-1-ship-a-golden-path-demonstration-plugin.out`
- `make lint`:
  `/tmp/lint-velocetty-1-3-1-ship-a-golden-path-demonstration-plugin.out`
- `make test`:
  `/tmp/test-velocetty-1-3-1-ship-a-golden-path-demonstration-plugin.out`

## Context and orientation

Current repository state relevant to this milestone:

- Roadmap scope and success criteria are defined in `docs/roadmap.md` under
  section `1.3.1`.
- Design defines the target plugin runtime contract and settings persistence in
  JSON5 in `docs/velocetty-design.md`.
- Design defines tab decoration provider contracts and deterministic merge rules
  in `docs/velocetty-design.md`.
- PRD requires a golden path plugin as a deliverable under foundation
  workstream `0` in
  `docs/velocetty-product-requirements-document.md`.
- Existing plugin loader and decorator orchestration live in `app/plugins.ts`
  and `lib/utils/plugins.ts`.
- Existing command/keybinding execution seam lives in
  `lib/command-registry.ts`, `lib/components/terms.tsx`, and
  `lib/containers/hyper.tsx`.
- Existing config import and migration paths are in `app/config/import.ts` and
  `app/config/migrate.ts`.

Likely files touched during implementation:

- `shared/src/types/config.ts` and `shared/schemas/schema.json`
- `shared/src/types/common.ts` and `lib/transport/ipc-schemas.ts`
- `app/config/import.ts`, `app/config/migrate.ts`, and related config helpers
- `app/plugins.ts`, `app/plugins/extensions.ts`, and
  `lib/utils/plugins.ts`
- new golden-path plugin files under a repository-local plugin fixture path
  (final path confirmed in Stage A)
- tests under `test/unit/` for plugin runtime, config JSON5 persistence,
  command/keybinding registration, and deterministic tab decoration behaviour
- `docs/developers-guide.md`
- `docs/roadmap.md`

## Agent team execution model

Execution will use the following team topology. The primary agent keeps
integration ownership and review responsibility.

- Explorer agent: continuously validates roadmap/design/PRD constraints and
  updates implementation notes when surprises occur.
- Worker A (backend/config): owns JSON5 config parsing/writing, namespaced
  plugin settings persistence, and IPC contract updates.
- Worker B (plugin runtime): owns manifest loading, plugin enable/disable
  behaviour, command/keybinding registration plumbing, and golden plugin code.
- Worker C (renderer decorations/tests/docs): owns tab decoration provider
  registry and event-driven refresh path, plus test and docs updates.
- Integrator (primary): resolves merge conflicts, aligns contracts across
  workers, runs gates, writes commits, and updates this ExecPlan.

If a worker discovers tolerance breaches, work stops and returns to integrator
for escalation instead of ad hoc scope growth.

## Plan of work

### Stage A: establish contracts and scaffolding

Goal: introduce explicit plugin-manifest and decoration-provider scaffolding
without breaking existing plugin hooks.

Implementation outline:

1. Define or extend shared types for plugin manifest and plugin settings schema
   defaults, including plugin `id`, `enabledByDefault`, and one settings object
   contract.
2. Add runtime representation for registered tab decoration providers with
   deterministic ordering metadata (`id`, `priority`, and stable tie-breaks).
3. Add initial unit tests for deterministic provider ordering and manifest
   parsing defaults before runtime wiring.

Observable check:

- tests prove deterministic ordering and defaults pass before runtime integration
  begins.

### Stage B: JSON5 config and plugin settings persistence

Goal: satisfy roadmap success criteria for JSON5 persistence of plugin settings.

Implementation outline:

1. Switch config read/write helpers from plain JSON to JSON5 parse/stringify
   where user config is loaded and persisted.
2. Introduce namespaced plugin settings storage under `plugins.<pluginId>`.
3. Remove legacy migration logic (`app/config/migrate.ts` and its invocation
   path) so startup no longer performs old-format migration.
4. Add runtime helpers that allow getting and setting plugin settings while
   preserving existing config merge/default behaviour.
5. Add tests covering:
   comments/trailing commas in config,
   namespaced plugin defaults,
   plugin enable/disable persistence path,
   and startup behaviour without migration fallback.

Observable check:

- editing settings for the golden plugin persists to JSON5 and survives reload.

### Stage C: golden plugin command and keybinding path

Goal: ship one real plugin that demonstrates command and keybinding
registration.

Implementation outline:

1. Add the golden plugin fixture/module with manifest, defaults, and one command
   ID.
2. Register one keybinding mapping that invokes the plugin command through the
   existing command-registry and keymap flow.
3. Ensure plugin enable/disable controls whether registration is active.
4. Add or update unit/integration tests for command handler registration and
   keybinding lookup when plugin is enabled vs disabled.

Observable check:

- when enabled, the command appears in registry lookup path and keybinding
  dispatch invokes it; when disabled, neither registration is active.

### Stage D: tab decoration provider and event-driven updates

Goal: deliver one deterministic tab decoration provider path with event-driven
refresh semantics.

Implementation outline:

1. Register one tab decoration provider from the golden plugin runtime.
2. Wire provider output into tab props rendering with deterministic merge rules.
3. Trigger decoration recomputation from explicit tab/session events (for
   example session activity, title updates, active tab changes), not polling.
4. Add tests proving:
   deterministic output ordering,
   event-triggered update execution,
   no updates when no relevant events occur.

Observable check:

- synthetic event tests show decoration changes only after subscribed events and
  output remains stable for equal inputs.

### Stage E: docs, roadmap, commits, and full validation

Goal: finish the milestone with documentation parity, roadmap state update, and
clean validation evidence.

Implementation outline:

1. Update `docs/developers-guide.md` with any new developer practice introduced
   by the golden plugin runtime and JSON5 settings path.
2. Mark roadmap item `1.3.1` as done in `docs/roadmap.md` only after all gates
   pass.
3. Commit in atomic slices, gating each commit per repository policy.
4. Run required commands with `tee` logs:
   `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
5. Run documentation gates if docs changed:
   `bunx markdownlint-cli2 "docs/**/*.md"` and `nixie --no-sandbox`.

Observable check:

- all required gates exit successfully and roadmap checkbox is updated to done.

## Validation and evidence capture

Use branch-safe log files for every gate run:

    BRANCH_SAFE="$(git branch --show | tr '/' '-')"
    PROJECT_NAME="$(get-project)"
    bun install 2>&1 | tee "/tmp/bun-install-${PROJECT_NAME}-${BRANCH_SAFE}.out"
    make build 2>&1 | tee "/tmp/build-${PROJECT_NAME}-${BRANCH_SAFE}.out"
    make check-fmt 2>&1 | tee "/tmp/check-fmt-${PROJECT_NAME}-${BRANCH_SAFE}.out"
    make lint 2>&1 | tee "/tmp/lint-${PROJECT_NAME}-${BRANCH_SAFE}.out"
    make test 2>&1 | tee "/tmp/test-${PROJECT_NAME}-${BRANCH_SAFE}.out"

If `get-project` is unavailable, replace `PROJECT_NAME` with a static project
token (`velocetty`) while keeping log naming stable.

## Rollback and recovery

If a stage regresses runtime behaviour:

1. Revert the stage-local commit only (do not reset unrelated changes).
2. Re-run focused tests for affected seam.
3. Re-apply a narrower patch and continue from the same stage.

If JSON5 cut-over introduces parse regressions, fix parser/writer behaviour
without reintroducing legacy-format migration paths.
