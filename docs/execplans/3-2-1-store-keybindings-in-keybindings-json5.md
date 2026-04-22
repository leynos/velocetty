# Store keybindings in `keybindings.json5` (roadmap 3.2.1)

## Module header

- Purpose: define an implementation-ready execution plan for roadmap item
  `3.2.1` so Velocetty stores user keybinding overrides in a separate
  `keybindings.json5`, provides validated read/write and import/export
  utilities, and keeps keybinding edits hot-reloadable.
- Invariants: preserve existing core default keymaps in `app/keymaps/`,
  preserve plugin-contributed default keybindings, keep JSON5 diagnostics
  structured, and keep the renderer key rebinding path working after on-disk
  edits.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`,
  `docs/developers-guide.md`, `app/config.ts`, `app/config/import.ts`,
  `app/config/init.ts`, `app/config/paths.ts`, `app/config/open.ts`,
  `app/plugins.ts`, `app/runtime/plugin-runtime.ts`,
  `app/runtime/plugin-runtime-json5-roundtrip.ts`,
  `lib/command-registry.ts`, `lib/containers/hyper.tsx`,
  `shared/src/types/config.ts`, `shared/src/constants/config-reloadability.ts`,
  `test/unit/config-import-json5.test.ts`,
  `test/unit/config-hot-reload.test.ts`,
  `test/unit/command-registry.test.ts`,
  `test/unit/runtime-plugin-settings.test.ts`, and
  `test/unit/cli-api-behaviour.test.ts`.
- Skills signposts: use `execplans` to keep this document live during
  execution, `leta` for symbol-level navigation and refactoring, and `grepai`
  as the primary intent-based exploration tool before falling back to exact
  text search.
- Agent-team signpost: the main agent owns edits, sequential gates, and commit
  hygiene. Explorer sub-agents may gather context and compare file surfaces,
  but they must not run tests or mutate the branch.

This ExecPlan is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: DRAFT (2026-04-22)

## Purpose / big picture

Roadmap item `3.2.1` requires Velocetty to stop storing user keybinding
overrides inside `config.json5` and instead persist them in a separate
`keybindings.json5`. After this work, Velocetty must still layer keybindings
deterministically as `core defaults -> plugin defaults -> user overrides`,
must accept JSON5 comments and trailing commas, and must keep the current
hot-reload experience where editing the file on disk causes the renderer to
pick up the new bindings without restarting the application.

This plan deliberately treats `3.2.1` as a storage and hot-reload foundation
milestone, not as the full keybinding-engine or keybinding-editor milestone.
The expected observable outcomes are:

- Velocetty creates and reads `keybindings.json5` in the config directory.
- Existing user keybindings are migrated or bootstrapped safely from the old
  `config.json5` `keymaps` field into the new file.
- Parse or schema errors keep the last-known-good keybindings in memory,
  surface a non-blocking notification, and log structured diagnostics.
- Import and export utilities read and write the same JSON5 shape used by the
  persisted file.
- The roadmap entry for `3.2.1` is marked done only after the required gates
  pass and the developer documentation explains the new practice.

## Constraints

- Keep scope limited to roadmap item `3.2.1` plus required supporting docs and
  tests. Do not silently absorb roadmap item `3.2.2` (plugin settings
  persistence) or roadmap item `4.2.x` (keybinding engine/editor UI).
- Implementation starts only after explicit user approval of this plan.
- Preserve the existing platform default keymap files in `app/keymaps/`; they
  remain the bundled core defaults.
- Preserve plugin-contributed default keybindings and current precedence over
  core defaults but below user overrides.
- Treat workspace keybinding overrides as deferred for this milestone unless
  the user explicitly widens scope. The plan assumes `core defaults -> plugin
  defaults -> user overrides` only.
- Preserve JSON5 semantics: comments and trailing commas must parse cleanly,
  and diagnostics must remain structured with `path`, `message`, and
  `suggestedFix` as required fields.
- Preserve last-known-good effective keybindings in memory if
  `keybindings.json5` fails to parse or validate.
- Keep keybinding changes live-reloadable and routed through the existing
  renderer rebinding path rather than introducing a parallel shortcut system.
- Prefer existing repository dependencies and existing JSON5 roundtrip helper
  patterns; do not add a new external dependency without explicit escalation.
- Update `docs/developers-guide.md` and `docs/roadmap.md` in the same change
  set as the runtime and test changes.
- Required closure gates are `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`, run sequentially with tee logs.
- Sub-agents may assist with analysis, but they must not run tests, format
  checks, or other build-cache-heavy gates.

## Tolerances (exception triggers)

- Scope: if implementation requires changes to more than 18 files, stop and
  reassess whether work is leaking into `3.2.2`, `4.1.x`, or `4.2.x`.
- Interface: if meeting `3.2.1` requires breaking plugin-facing keybinding
  contribution APIs or changing public IPC contracts, stop and escalate before
  proceeding.
- Migration: if existing `config.json5` `keymaps` data cannot be extracted or
  bootstrapped safely into `keybindings.json5` without risking user data loss,
  stop and escalate instead of shipping a lossy migration.
- Retention: if required writes to `keybindings.json5` cannot preserve
  user-authored comments and formatting for unchanged regions with current
  helper patterns, stop and escalate before locking in a full-file rewrite.
- Watchers: if supporting a second watched file requires a broad rewrite of the
  config watcher architecture instead of a focused extension, stop and
  document options in `Decision Log`.
- Dependencies: if a new dependency appears necessary for import/export,
  validation, or roundtrip-safe writes, stop and escalate first.
- Iteration: if any required gate fails 3 times without clear progress, stop
  and record blocker state rather than thrashing.
- Evidence: if any required gate exits non-zero or is interrupted, keep status
  partial and do not mark roadmap `3.2.1` done.

## Risks

- Risk: current runtime still stores user keymaps inside `rawConfig.keymaps` in
  `config.json5`, so moving to `keybindings.json5` needs a compatibility or
  migration path.
  Severity: high
  Likelihood: high
  Mitigation: implement an explicit bootstrap path that seeds
  `keybindings.json5` from existing user `keymaps` when present and records the
  decision in tests and `Decision Log`.

- Risk: the main-process config watcher currently watches only `cfgPath`, so a
  second file can silently fail the “hot-reload cleanly” success criterion.
  Severity: high
  Likelihood: high
  Mitigation: extend the watcher model deliberately and add tests that prove
  on-disk keybinding edits propagate to the renderer rebinding flow.

- Risk: import/export is required by the roadmap and design docs, but current
  app code exposes only config opening through `window:preferences`.
  Severity: medium
  Likelihood: medium
  Mitigation: define `3.2.1` import/export scope narrowly as validated utility
  APIs plus any command plumbing that fits without widening into the command
  system roadmap items.

- Risk: only the runtime plugin settings path currently demonstrates
  comment-preserving JSON5 patching, so keybinding writes could regress user
  formatting if they reuse full `stringifyJson5` rewrites.
  Severity: medium
  Likelihood: medium
  Mitigation: reuse or adapt the existing roundtrip helper pattern from
  `app/runtime/plugin-runtime-json5-roundtrip.ts`, and add write-focused tests.

- Risk: repository docs describe Velocetty config directories, but runtime path
  code and some tests still use legacy Hyper naming and `hyper.json`
  compatibility.
  Severity: medium
  Likelihood: high
  Mitigation: call the drift out explicitly, keep path renaming out of scope
  for `3.2.1`, and avoid widening into a broader config-path migration.

## Context and orientation

Relevant current state:

- `docs/roadmap.md` defines `3.2.1` at lines `243-248`: store keybindings in
  `keybindings.json5`, provide read/write utilities with schema validation,
  support export/import in the same format, and make keybinding edits persist
  and hot-reload cleanly.
- `docs/velocetty-design.md` defines `keybindings.json5` as a separate JSON5
  file, places it in the config directory, and describes keybinding layering as
  `core defaults -> plugin defaults -> user overrides -> optional workspace
  overrides`.
- `docs/velocetty-design.md` also states that JSON5 parsing must accept
  comments and trailing commas, diagnostics must remain structured, and
  keybindings are live-reloadable.
- `shared/src/types/config.ts` still models user keymaps inside
  `rawConfig.keymaps`.
- `app/config/import.ts` loads the bundled default config, injects platform
  defaults from `app/keymaps/*.json`, then merges user overrides from
  `config.json5`.
- `app/config/paths.ts` knows only about `config.json5`, `hyper.json`, the
  schema path, and platform default keymap files.
- `app/config.ts` watches only `cfgPath` and triggers subscriber callbacks on
  config changes.
- `app/plugins.ts` and `app/runtime/plugin-runtime.ts` already centralize
  effective keymap assembly: resolved base keymaps plus runtime plugin
  keybindings, then decoration and normalization.
- `lib/command-registry.ts` and `lib/containers/hyper.tsx` already provide the
  rebinding path the implementation should preserve rather than replace.
- `app/runtime/plugin-runtime-json5-roundtrip.ts` is the best local precedent
  for comment-preserving JSON5 writes.

## Documentation and skill signposts

Before implementation begins, review these documents in this order:

1. `docs/roadmap.md` for the exact `3.2.1` success criteria and the explicit
   boundary with `3.2.2`.
2. `docs/velocetty-design.md` sections `Keybinding system design` and
   `Configuration system: JSON5 and layering` for precedence, export/import,
   file-location, and hot-reload requirements.
3. `docs/velocetty-product-requirements-document.md` Phase 3 and Settings
   command requirements for the broader product intent.
4. `docs/velocetty-hyper-codebase.md` for the current platform-keymap and
   config-system inventory.
5. `docs/developers-guide.md` for current JSON5 practice, reloadability
   guidance, and the tests that must move with the feature.

Use these skills during execution:

- `execplans`: keep this file live as milestones complete or assumptions change.
- `leta`: inspect symbol definitions and references before refactoring runtime
  code or tests.
- `grepai`: perform behaviour-driven code discovery first; use exact text
  search only for literals, file paths, or precise strings.

## Agent-team execution model

The implementation phase should use a small, controlled agent team:

- Main agent: owns the branch, writes code, updates this ExecPlan, runs all
  sequential gates, commits, and reports final evidence.
- Explorer agent 1: verifies documentation requirements, roadmap wording, and
  developer-guide fallout.
- Explorer agent 2: verifies config/keymap/runtime code surfaces, migration
  touch points, and likely tests.

Sub-agents are analysis-only helpers. They must not run `bun install`,
`make build`, `make check-fmt`, `make lint`, `make test`, or other heavy gates.

## Plan of work

### Stage A: lock scope, confirm migration policy, and write failing tests

Start by turning the required behaviour into failing tests before touching the
runtime path. The first decision is explicit: `3.2.1` implements separate
persisted user overrides in `keybindings.json5`, keeps plugin default
keybindings in memory/runtime contributions, and defers workspace overrides.

Add or update tests that prove the intended behaviour:

- path resolution exposes `keybindings.json5` alongside `config.json5`;
- boot-time import reads platform defaults plus user overrides from the new
  file rather than from `config.json5`;
- existing `config.json5` `keymaps` can bootstrap the new file safely when the
  new file does not yet exist;
- invalid `keybindings.json5` preserves last-known-good keymaps and emits
  structured diagnostics;
- editing `keybindings.json5` on disk causes the renderer binding flow to
  refresh without restart;
- export/import utilities roundtrip the same JSON5 shape used on disk.

Do not proceed to Stage B until those tests fail for the current tree.

### Stage B: introduce dedicated keybinding-path and keybinding-IO helpers

Create a focused keybinding storage surface rather than burying more logic in
`config.json5` handling. The likely shape is a dedicated module under
`app/config/` that owns:

- locating `keybindings.json5`;
- parsing and validating user keybinding overrides;
- serializing keybinding overrides as JSON5;
- import and export utility entry points using the same schema;
- bootstrapping a missing file from existing legacy `config.json5` keymaps when
  present.

This stage should leave bundled platform defaults in `app/keymaps/*.json`
untouched and should not yet change the plugin contribution path.

### Stage C: rewire config import, normalization, and migration boundaries

Update the import pipeline so user keybinding overrides come from the new file
instead of `rawConfig.keymaps` in `config.json5`. Keep config loading
non-fatal, and ensure the effective keymap calculation still reaches
`mapKeys({...coreDefaults, ...userOverrides})` before plugin contributions are
merged later in `app/plugins.ts`.

At this stage, make a deliberate compatibility decision:

- `config.json5` keeps application config and plugin settings.
- `keybindings.json5` becomes the sole persisted home for user keybinding
  overrides.
- legacy `config.json5` `keymaps` are read only as a bootstrap source when
  `keybindings.json5` is missing, then written to the new file so the user
  keeps their data.

If the implementation keeps `rawConfig.keymaps` temporarily for compatibility,
document the reason and the retirement plan in `Decision Log`.

### Stage D: extend watch and reload semantics to a second file

Modify the config watcher path so `keybindings.json5` changes trigger the same
observable rebinding flow users already get from `config.json5` edits. This
stage is successful only if:

- the main process watches both relevant files;
- parse or schema failure for `keybindings.json5` keeps the last-known-good
  keymaps active;
- successful edits emit the same subscriber/update path that eventually causes
  `Hyper` to re-read registered keys and rebind handlers;
- notifications and logs remain non-blocking and structured.

Avoid inventing a second, parallel renderer shortcut update channel unless the
existing one proves insufficient and the user approves the wider change.

### Stage E: wire import/export and any narrowly required command plumbing

Implement validated import/export helpers that read and write the same JSON5
shape as `keybindings.json5`. The narrow interpretation for `3.2.1` is:

- import/export utility functions are required;
- opening the keybindings file from the app is desirable if it can reuse the
  current `openConfig` pattern cheaply;
- keybinding editor UI, conflict-resolution UI, and command-palette exposure
  remain deferred to later milestones unless they are strictly required to
  satisfy the roadmap wording without widening scope.

If small command plumbing is added, keep it limited to direct file operations
such as `settings.openKeybindings` or `keybindings.export`, and do not widen
into full command-palette work.

### Stage F: documentation, roadmap closure, and full validation

Update `docs/developers-guide.md` so contributors know:

- user keybinding overrides now live in `keybindings.json5`;
- the precedence order for core defaults, plugin defaults, and user overrides;
- how bootstrapping from legacy `config.json5` `keymaps` works;
- how hot-reload and diagnostics behave for the second file;
- which tests must be extended when keybinding storage changes.

After runtime and test work is complete, update `docs/roadmap.md` to mark
`3.2.1` and its child bullets done, then run the required sequential gates
with durable logs before committing.

## Concrete steps

<!-- markdownlint-disable MD029 -->

1. Baseline and scope verification:

```bash
git branch --show
nl -ba docs/roadmap.md | sed -n '241,249p'
nl -ba docs/velocetty-design.md | sed -n '918,1088p'
nl -ba docs/developers-guide.md | sed -n '168,320p'
```

2. Add or update focused failing tests first:

```bash
set -o pipefail
TEST_LOG="/tmp/test-keybindings-json5-$(get-project)-$(git branch --show).out"
bun test --max-concurrency=1 \
  test/unit/config-import-json5.test.ts \
  test/unit/config-hot-reload.test.ts \
  test/unit/command-registry.test.ts \
  test/unit/runtime-plugin-settings.test.ts \
  test/unit/cli-api-behaviour.test.ts 2>&1 | tee "$TEST_LOG"
```

3. Implement the dedicated keybinding storage path in the app config layer.

Likely touched files:

- `app/config/paths.ts`
- `app/config/import.ts`
- `app/config/init.ts`
- `app/config.ts`
- `app/config/open.ts`
- one new dedicated helper under `app/config/` for keybinding JSON5 storage
- `shared/src/types/config.ts` only as needed for the migration boundary

4. Reuse or adapt existing JSON5 roundtrip helper patterns for any
   comment-preserving writes:

- `app/runtime/plugin-runtime-json5-roundtrip.ts`
- any new `app/config/*keybindings*` helper introduced for this milestone

5. Extend runtime integration and hot reload without widening plugin scope:

- `app/plugins.ts`
- `app/runtime/plugin-runtime.ts`
- `lib/command-registry.ts`
- `lib/containers/hyper.tsx`

6. Update the documentation required for this milestone:

- `docs/developers-guide.md`
- `docs/roadmap.md`
- this ExecPlan’s `Progress`, `Surprises & Discoveries`, and `Decision Log`

7. Run required gates sequentially with tee logs:

```bash
set -o pipefail
bun install 2>&1 | tee "/tmp/bun-install-$(get-project)-$(git branch --show).out"
make build 2>&1 | tee "/tmp/build-$(get-project)-$(git branch --show).out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-$(get-project)-$(git branch --show).out"
make lint 2>&1 | tee "/tmp/lint-$(get-project)-$(git branch --show).out"
make test 2>&1 | tee "/tmp/test-$(get-project)-$(git branch --show).out"
```

8. Because docs will change, run docs validation after the required gates:

```bash
set -o pipefail
bunx markdownlint-cli2 "docs/**/*.md" 2>&1 | tee "/tmp/markdownlint-$(get-project)-$(git branch --show).out"
nixie --no-sandbox 2>&1 | tee "/tmp/nixie-$(get-project)-$(git branch --show).out"
```

9. Close the milestone only after successful validation:

- mark `docs/roadmap.md` item `3.2.1` and its child bullets done;
- record exact log paths and gate outcomes in this ExecPlan;
- commit the completed change set with a message that names `3.2.1`.

<!-- markdownlint-enable MD029 -->

## Validation and acceptance

Behavioural acceptance:

- Starting from a clean config directory bootstraps both `config.json5` and
  `keybindings.json5` in the expected locations.
- If the user already has `keymaps` inside `config.json5` and no
  `keybindings.json5`, Velocetty seeds the new file without losing the
  existing bindings.
- Valid `keybindings.json5` comments and trailing commas parse correctly.
- Invalid `keybindings.json5` does not clear active keybindings; the app keeps
  the last-known-good bindings and emits structured diagnostics.
- Editing `keybindings.json5` on disk causes shortcut bindings to refresh
  cleanly without application restart.
- Import and export utilities read and write the same JSON5 shape as the file
  persisted on disk.
- Runtime plugin default keybindings still layer beneath user overrides.

Evidence acceptance:

- `test/unit/config-import-json5.test.ts` covers bootstrap, parsing, and
  migration from legacy `config.json5` keymaps.
- `test/unit/config-hot-reload.test.ts` covers second-file reload behaviour and
  last-known-good fallback.
- `test/unit/command-registry.test.ts` or adjacent renderer tests prove the
  rebinding path still consumes the updated effective keymaps.
- `test/unit/runtime-plugin-settings.test.ts` still proves precedence and
  conflict behaviour after the storage split.
- Required gates `bun install`, `make build`, `make check-fmt`, `make lint`,
  and `make test` pass sequentially with tee logs recorded in this document.

## Progress

- [x] 2026-04-22 23:03Z: Reviewed roadmap, design, PRD, developers guide, and
  current config/keybinding code surfaces using the main agent plus two
  explorer sub-agents.
- [x] 2026-04-22 23:03Z: Drafted this ExecPlan with explicit scope boundaries
  for `3.2.1`, including migration, watcher, and import/export decisions.
- [ ] Await explicit user approval before implementation.
- [ ] Add failing tests that lock in `keybindings.json5` storage semantics.
- [ ] Implement dedicated keybinding storage, migration, and reload wiring.
- [ ] Update documentation, run all gates, and mark roadmap item `3.2.1` done.

## Surprises & Discoveries

- The current tree already has the main pieces needed for the feature, but they
  are split across old assumptions: user keymaps still live in
  `config.json5`, while runtime plugin settings already have a separate JSON5
  roundtrip-safe writer.
- The current watcher architecture is single-file only. Meeting the roadmap’s
  hot-reload success criterion depends more on watcher integration than on
  parser work.
- The current codebase appears not to expose keybinding import/export commands
  yet, even though the design docs mention them. The implementation should keep
  that gap visible instead of quietly widening scope.

## Decision Log

- 2026-04-22: Interpret roadmap item `3.2.1` as the storage and hot-reload
  foundation for keybindings, not as the full keybinding engine or editor UI.
  Rationale: the roadmap itself separates `3.2.1` from `4.2.1` and `4.2.2`.

- 2026-04-22: Defer workspace keybinding overrides for this milestone.
  Rationale: the design docs mention optional workspace overrides, but the
  developers guide still treats workspace config overrides as deferred, and the
  roadmap item does not require workspace storage.

- 2026-04-22: Require an explicit compatibility path from legacy
  `config.json5` `keymaps` into `keybindings.json5`.
  Rationale: the current runtime stores user keymaps there, so shipping the new
  file without bootstrap or migration would risk silent user data loss.

- 2026-04-22: Keep the main agent responsible for edits, gates, and commits,
  with explorer sub-agents limited to read-only context gathering.
  Rationale: repo instructions explicitly forbid sub-agents from running tests,
  and the branch needs one owner for the sequential validation loop.

## Outcomes & Retrospective

Implementation has not started. This section should be completed only after the
plan is approved and executed, and must summarize:

- what shipped;
- which files changed and why at a high level;
- which risks materialized and how they were resolved;
- exact gate outcomes and log paths;
- any deferred follow-up work that remains outside roadmap item `3.2.1`.
