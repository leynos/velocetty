# Implement the settings tab shell and navigation (roadmap 5.1.1)

## Module header

- Purpose: define an implementation-ready execution plan for roadmap item
  `5.1.1`, which delivers a first-class settings tab with search, categories,
  reset-to-default, and inline validation so that core settings are editable
  and validated in the user interface (UI).
- Invariants: `config.json5` stays the single source of truth; every write is
  validated by the main process before it reaches disk; user-authored comments
  and formatting outside the edited property survive every write; a rejected
  edit never changes the file; terminal sessions survive opening, switching to,
  and closing the settings tab.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-product-requirements-document.md`, `docs/developers-guide.md`,
  `docs/documentation-style-guide.md`,
  `docs/adr-006-oxlint-plugin-strategy.md`, `shared/src/types/config.ts`,
  `shared/src/constants/config-reloadability.ts`, `app/config/json5-config.ts`,
  `app/config/import.ts`, `app/runtime/plugin-runtime-json5-roundtrip.ts`,
  `lib/components/restart-required-indicator.tsx`, and
  `lib/hooks/use-config-reloadability.ts`.

This Execution Plan (ExecPlan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT

Approval gate: this plan must be explicitly approved by the user before any
implementation milestone (EP-M0 onwards) begins. Silence is not approval.

## Purpose / big picture

Velocetty is a terminal emulator forked from Hyper. Today, choosing
`Preferences…` from the menu (or pressing `Ctrl+,`, `Cmd+,` on macOS) opens
`config.json5` in an external text editor. The design commits Velocetty to "a
first-class settings user experience" in which settings are a tab, not a modal
and not a text file.

After this work, a user can:

1. Press `Ctrl+,` (or choose `Preferences…`) and see a `Settings` tab appear in
   the tab strip next to their terminal tabs. Their terminals keep running.
2. Browse settings by category (for example `Appearance`, `Cursor`,
   `Colours`, `Terminal`, `Rendering`, `Updates`) from a navigation list.
3. Type into a search box to filter settings by label, key, description, or
   category, and type `@modified` to show only settings they have changed.
4. Change a setting (toggle, select, number, text, or colour) and see it
   apply: live-reloadable settings take effect immediately; restart-required
   settings show the existing restart warning.
5. Enter an invalid value (for example `-3` for scrollback, or `abc` for font
   size) and see an inline error message under the field, with the field marked
   invalid for assistive technology. The file on disk is not changed.
6. Reset a modified setting to its default with one click. The setting's key
   is removed from `config.json5`, so the built-in default applies again.
7. Open `config.json5` in their editor from a button inside the settings tab
   for settings the UI does not cover yet.

Observable success: the deep end-to-end (E2E) test
`test/e2e-deep/settings-tab.e2e.ts` opens the packaged app, presses the
preferences shortcut, changes `fontSize`, enters an invalid scrollback value,
and resets `fontSize`, asserting the UI state and the exact `config.json5`
contents (including a sentinel comment) after each step.

## Constraints

- `config.json5` remains canonical. The settings UI must not introduce a second
  persisted store, a cache that can disagree with the file, or a full-file
  canonical rewrite. Targeted edits only (developers guide, "Configuration
  format practice").
- The main process is the only writer of `config.json5` and the only
  authority on validity. The renderer may pre-check input shape but must never
  treat its own check as sufficient.
- Package boundaries enforced by `scripts/check-package-boundaries.mjs` must
  hold: `lib/` must not import `app/`; `app/` must not import `lib/`;
  `shared/src/` imports neither. `app/` may import only types from `@shared/*`
  at runtime (the main process is compiled to CommonJS without alias
  resolution).
- Pure domain logic lives in `shared/src/settings/` and must not import
  React, Redux, Electron, Node built-ins, or any transport. This is the
  hexagonal "domain" ring; it is enforced by review and by the boundary checker.
- Terminal sessions (`sessions` and `termGroups` Redux slices, and xterm
  instances) must not be unmounted or recreated when the settings tab opens,
  becomes active, becomes inactive, or closes.
- No source file may exceed 400 lines (AGENTS.md). The catalogue and
  translation tables must be split by category if they would exceed it.
- Profile-specific overrides (`profiles[].config`) are out of scope for
  editing. The UI edits the base `config.<key>` only.
- Plugin settings panels (roadmap 5.2.x), settings commands such as
  `settings.open` (roadmap 5.1.2), the keybinding editor (4.2.2), and the
  command dispatcher (4.1.1) are out of scope.
- Comments and documentation use en-GB Oxford spelling
  (`en-gb-oxendict`).
- Tests follow `docs/developers-guide.md` "Tests" and
  `docs/testing-with-bun.md`: no file-scope `mock.module`; inject timers,
  loggers, and file-system seams; use per-test temporary directories; call the
  `setupHappyDom()` cleanup in every component test; suites must pass under
  `bun test --concurrent --isolate`.
- `unicorn/no-null` is deliberately off (ADR 006) because explicit `null` is
  meaningful in config layering; do not "fix" `null` usages in config code.

## Tolerances (exception triggers)

- Scope: if implementation requires changes to more than 60 non-ExecPlan files
  or more than 5,000 net lines of code and other documentation, stop and
  escalate. This ExecPlan file is excluded from both counts. Generated Dafny
  artefacts (`*.dfy.gen`) are excluded from the line count but included in the
  file count.
- Interface: if any existing public plugin-facing API (the `decorate*` /
  `getTabProps` / `getTabsProps` hooks in `lib/utils/plugins.ts`) must change
  its signature, stop and escalate. Adding an optional `tabType` field to
  `ITab` is pre-approved.
- Dependencies: `fast-check` and `lemmascript` are pre-approved development
  dependencies (the task explicitly requires them). Any other new dependency,
  runtime or development, requires escalation.
- Proof tooling: if LemmaScript cannot express either proof target (EP-M0
  prototype) after two restructuring attempts, stop and present options
  (Dafny-only handwritten model with a refinement test, or narrower proof
  scope) rather than silently downgrading to property tests.
- Persistence: if comment-preserving key removal cannot be made to satisfy
  the EP-M2 property suite after three fix iterations, stop and escalate.
- Iterations: if any gate fails three times in a row for the same reason after
  attempted fixes, stop and escalate.
- Time: if a single milestone takes more than one working day of agent time,
  record progress and escalate.
- Ambiguity: if a design question in `Decision log` marked "provisional" is
  contradicted by the expert review or by implementation evidence, stop and
  present the options.

## Risks

- Risk: plugins that decorate tabs (`getTabProps`) assume every tab `uid` is a
  term-group uid and may crash on the settings tab. Severity: medium.
  Likelihood: medium. Mitigation: render the settings tab through the same
  `Tab` component but pass `tabType: 'settings'`; guard the settings uid in
  `changeTab` and `closeTab`; add a test that decorates tabs with a plugin
  double that reads `uid` and asserts no throw.
- Risk: the handwritten JSON5 parser in
  `app/runtime/plugin-runtime-json5-parser.ts` has edge cases (comments between
  key and value, trailing commas, CRLF) that break key removal. Severity: high
  (data loss in user config). Likelihood: medium. Mitigation: EP-M2 property
  tests with a generator that emits comments, trailing commas, quoted and
  unquoted keys, CRLF and LF; refuse to write (return `failed`) whenever the
  edited text does not re-parse to the expected value.
- Risk: the user edits `config.json5` externally while a settings write is in
  flight, and one change is lost. Severity: medium. Likelihood: low.
  Mitigation: the service reads the file fresh for every write and edits only
  the target property, so only a concurrent edit of the same key can be lost;
  writes are serialized in the main process; the renderer refreshes its
  snapshot on every `config change` event.
- Risk: LemmaScript is a tech preview; the pinned version may lack a feature
  the proofs need, or behave differently from the skill notes (written for
  0.5.x; npm reports 0.6.5). Severity: medium. Likelihood: medium. Mitigation:
  EP-M0 is a prototyping milestone that proves a representative function before
  any production module depends on it.
- Risk: Dafny is installed locally (`dafny 4.11.0`) but not in CI.
  Severity: low. Likelihood: high. Mitigation: `make proofs` is a local gate
  and an acceptance criterion; EP-M0 decides whether to add a CI job (the
  LemmaScript reusable workflow or an explicit `dotnet tool install`) and
  records the decision.
- Risk: base-level edits have no visible effect when the default profile
  overrides the same key. Severity: medium (confusing UX). Likelihood: low
  (default config has no profile overrides). Mitigation: the snapshot reports
  keys overridden by the default profile, and the UI shows an informational
  note on those fields.
- Risk: `postcss.config.mjs` may not generate Tailwind utilities (it uses
  `tailwindcss` directly rather than `@tailwindcss/postcss`). Severity: low.
  Likelihood: medium. Mitigation: use CSS Modules with the existing
  `lib/tailwind.css` custom properties, matching every existing component.
- Risk: the deep E2E lane runs only on schedule, so PR CI will not exercise the
  settings E2E. Severity: low. Likelihood: high. Mitigation: behavioural tests
  in `test/unit` cover the full renderer flow against a fake gateway and the
  full main-process service against a temporary directory; run the deep lane
  locally before marking EP-M6 complete.
- Risk: `typescript-json-schema` output for `configOptions` may not carry
  enough constraints (only `webGLRendererMaxContexts` has a minimum today), so
  the authoritative validator accepts nonsense such as `fontSize: -4`.
  Severity: medium. Likelihood: high. Mitigation: EP-M3 adds JSDoc
  `@minimum`/`@maximum`/`@TJS-type integer` tags to the numeric keys the
  catalogue exposes, regenerates the schema with `bun run generate-schema`, and
  extends `test/unit/config-schema-contract.test.ts`.

## Progress

- [x] (2026-10-29) Reconnaissance with a Wyvern agent team: design and PRD
  sections, config system, renderer UI, and tooling.
- [x] (2026-10-29) Prior-art research with Firecrawl: VS Code settings editor
  behaviour, LemmaScript toolchain, JSON5 comment preservation.
- [x] (2026-10-29) First draft of this ExecPlan.
- [ ] Community-of-experts design review and revision.
- [ ] User approval of the plan.
- [ ] EP-M0: proof and property tooling prototype.
- [ ] EP-M1: settings domain core.
- [ ] EP-M2: comment-preserving JSON5 edit operations.
- [ ] EP-M3: main-process settings service and IPC.
- [ ] EP-M4: settings tab shell and navigation.
- [ ] EP-M5: editing, inline validation, and reset flows.
- [ ] EP-M6: end-to-end coverage.
- [ ] EP-M7: documentation, ADR, and roadmap closure.

## Surprises & discoveries

- Observation: the 3.1.2 layering (`app/config/layering.ts`) and reload
  handler (`app/config/reload-handler.ts`) are only used by tests; the live
  path still merges with `lodash/merge` in `app/config/init.ts`. Evidence: grep
  for `resolveConfigLayers` and `createReloadHandler` finds only
  `test/unit/config-layering.test.ts` and
  `test/unit/config-hot-reload.test.ts`. Impact: this plan computes "modified"
  from the user file directly rather than from layer provenance, and does not
  depend on wiring the 3.1.2 modules into production. Wiring them is noted as
  follow-up work in `Outcomes & retrospective`.
- Observation: there is no write path for core settings. The only
  comment-preserving writer patches `config.plugins.<id>`, and it supports
  upsert but not removal. Evidence:
  `app/runtime/plugin-runtime-json5-roundtrip.ts:204-234`. Impact: EP-M2
  generalizes it and adds removal.
- Observation: `validateRawConfig` returns only the first issue, and per-key
  `docHint`/`defaultHint` hints are not wired. Evidence:
  `app/config/json5-config.ts:200-232`. Impact: EP-M3 adds an all-issues
  validator so errors elsewhere in the file do not block, or masquerade as,
  errors on the edited key.
- Observation: the roadmap cites design headings that do not exist verbatim.
  The relevant headings are "Settings tab and plugin settings panels"
  (`docs/velocetty-design.md` around line 1058) and
  `Roadmap 4. Settings tab + schema-driven plugin settings` (around line 2252).
  Impact: EP-M7 corrects the roadmap links.
- Observation: there is no `docs/users-guide.md` and no component
  architecture document. Impact: EP-M7 creates `docs/users-guide.md` and
  `docs/settings-tab-architecture.md`.
- Observation: `fast-check` and LemmaScript are absent; Dafny 4.11.0 and
  .NET 8 are installed on the development host. Impact: EP-M0.

## Decision log

- Decision D1: host settings as a singleton pseudo-tab with the reserved uid
  `velocetty:settings`, held in a new `settingsTab` Redux slice
  (`{isOpen, isActive}`), appended by `getTabs` with `tabType: 'settings'`, and
  rendered by a `SettingsContainer` beside `TermsContainer` in
  `lib/containers/hyper.tsx`. Terminals are hidden with CSS while the settings
  tab is active, never unmounted. Rationale: the design requires
  `tabType = "settings"` rather than a modal; term groups own the
  pseudo-terminal (PTY) lifecycle, so modelling settings as a fake term group
  would couple settings to session teardown. A separate slice keeps
  `lib/reducers/ui.ts` (889 lines) from growing. A full tab model rewrite
  belongs to roadmap 6.1 (vertical tabs). Date/Author: 2026-10-29, planning
  agent. Status: provisional pending expert review.
- Decision D2: the existing `window:preferences` command (menu `Preferences…`,
  `Ctrl+,`/`Cmd+,`) opens the settings tab by emitting a new renderer event
  `settings open` from `app/commands.ts`. The previous behaviour stays
  reachable as a new main-process command `window:openConfigFile`, invoked by
  an "Open config.json5" button inside the settings tab. Rationale: the success
  criterion needs a user-reachable entry point, and 5.1.2 (formal `settings.*`
  commands) depends on the unbuilt dispatcher (4.1.1). Re-targeting the
  existing legacy command keeps one entry point and gives 5.1.2 a single place
  to swap in `settings.open`. Date/Author: 2026-10-29, planning agent. Status:
  provisional pending expert review.
- Decision D3: edits apply per field, immediately: toggles and selects on
  change; text, number, and colour fields on `Enter` or blur. There is no "Save
  all" button. Each write is a targeted, comment-preserving edit of
  `config.<key>`, validated by the main process against the generated JSON
  Schema before writing. A write is rejected without touching disk when any
  diagnostic path is at or below `/config/<key>`. Rationale: matches the VS
  Code settings editor and the hot-reload model (3.1.2); per-field writes keep
  the edit locality property simple and testable. Date/Author: 2026-10-29,
  planning agent.
- Decision D4: reset-to-default removes `config.<key>` from `config.json5`
  rather than writing the default value. "Modified" means "present in the user
  file's `config` object". Rationale: removing the key lets future default
  changes reach the user, makes `@modified` exact, and mirrors VS Code's "Reset
  Setting". Date/Author: 2026-10-29, planning agent.
- Decision D5: the editable surface is a curated catalogue in
  `shared/src/settings/catalogue/` mapping each core key to a category and a
  control descriptor. Every key in `configOptions` must be either in the
  catalogue or in an explicit exclusion list with a reason (complex shapes:
  `colors`, `shellArgs`, `env`, `css`, `termCSS`, `profiles`, `defaultProfile`,
  `plugins`, `modifierKeys`, `windowSize`, and similar). An exhaustive parity
  test enforces this. Rationale: the schema has no grouping metadata and
  several keys need structured editors that are out of scope; an explicit
  exclusion list keeps the gap visible and forces a decision whenever a new key
  is added. Date/Author: 2026-10-29, planning agent.
- Decision D6: search is case-insensitive, splits the query on whitespace, and
  matches a setting when every token is a substring of its searchable text
  (translated label, key, schema description, translated category label). The
  reserved token `@modified` restricts results to modified settings. The
  category list filters the result set; "All settings" is the default. Results
  preserve catalogue order. Rationale: predictable, provable, and consistent
  with VS Code's `@modified` filter. Fuzzy ranking belongs to the command
  palette (4.3.1). Date/Author: 2026-10-29, planning agent.
- Decision D7: the settings editor's transient state (drafts, per-field
  status, query, selected category) lives in a `useReducer` inside
  `lib/settings/hooks/use-settings-editor.ts`, driven by the pure per-field
  state machine in `shared/src/settings/field-state.ts`. Only tab open and
  active state lives in Redux. Rationale: transient form state does not need
  global visibility and should not trigger re-renders of terminal containers.
  Date/Author: 2026-10-29, planning agent.
- Decision D8: field labels and category labels are translation keys in a
  dedicated `lib/settings/i18n/` dictionary (`en`, with `en-gb` and `fr`
  partial overrides falling back to `en`), following the hand-rolled pattern of
  `lib/hooks/use-translation.ts`. Descriptions come from the generated JSON
  Schema `description` (English only for now). Rationale: avoids introducing
  `react-i18next` (an unapproved dependency) and avoids duplicating JSDoc
  descriptions. Localizing descriptions is deferred. Date/Author: 2026-10-29,
  planning agent. Status: provisional pending expert review.
- Decision D9: formal proof (LemmaScript, Dafny backend) covers the two pieces
  of contractual logic: the search filter and the per-field edit state machine.
  `fast-check` covers JSON5 edit operations, input coercion (which is
  float-sensitive and outside LemmaScript's integer model), and a model-based
  test of the editor hook against a fake gateway that reorders responses.
  Rationale: the proofs target logic that is pure, inside LemmaScript's
  fragment, and load-bearing (wrong search hides settings; a wrong state
  machine shows stale errors or loses the latest edit). Date/Author:
  2026-10-29, planning agent.
- Decision D10: pin `lemmascript` to an exact version (the version validated
  in EP-M0) and add `fast-check` with a caret range. Rationale: LemmaScript is
  a tech preview whose generated artefacts change between versions, and the
  committed `.dfy` files must stay in step with the generator; AGENTS.md
  requires a documented justification for anything stricter than caret, and
  this is it. Date/Author: 2026-10-29, planning agent.
- Decision D11: record D1 to D4 in a new ADR,
  `docs/adr-007-settings-tab-hosting-and-persistence.md`, referenced from the
  design document. Rationale: these choices are hard to reverse (tab model,
  persistence semantics) and will be questioned by 5.1.2, 5.2.x, and 6.1.
  Date/Author: 2026-10-29, planning agent.
- Decision D12: the main process accepts `settings:setValue` and
  `settings:resetValue` only for keys that are properties of the
  `configOptions` schema and are not structural (`profiles`, `defaultProfile`,
  `plugins`). Rationale: the IPC channel is a boundary even though the renderer
  is trusted; the main process cannot import the shared catalogue at runtime,
  and the schema is already loaded there. Date/Author: 2026-10-29, planning
  agent.

## Outcomes & retrospective

Not started. To be completed at each milestone boundary and at the end. Known
follow-up candidates already identified: wiring
`resolveConfigLayers`/`createReloadHandler` into the production load path;
per-key `docHint`/`defaultHint` diagnostics; editors for excluded structured
keys; profile-level editing; translated descriptions.

## Context and orientation

Velocetty is an Electron application. The main process lives in `app/` and is
compiled to CommonJS under `dist/app`. The renderer (the React UI) lives in
`lib/`. Shared types, constants, and pure logic live in `shared/src/` and are
imported as `@shared/...`. `frontend/src` and `backend/src` are boundary
markers only.

Configuration:

- Types for every setting are in `shared/src/types/config.ts`
  (`rootConfigOptions`, `profileConfigOptions`, `configOptions`, `rawConfig`)
  with JSDoc descriptions. `bun run generate-schema` turns them into JSON
  Schema at `shared/schemas/schema.json`, copied to `app/config/schema.json`.
- Built-in defaults are in `app/config/config-default.json`.
- The user file is `config.json5` in the config directory resolved by
  `app/config/paths.ts` (`cfgPath`).
- `app/config/json5-config.ts` parses JSON5 and validates with Ajv, producing
  diagnostics of type `configValidationDiagnostic`
  (`{path, message, suggestedFix, docHint?, defaultHint?}`), where `path` is a
  JSON Pointer such as `/config/fontSize`.
- `app/config.ts` loads config at start-up, watches the file with chokidar,
  and notifies subscribers; `app/ui/window.ts` sends a payload-free
  `config change` event to each renderer, which re-reads config through
  `getDecoratedConfig`.
- `shared/src/constants/config-reloadability.ts` classifies every key as
  `live` or `restart`. `lib/hooks/use-config-reloadability.ts` and
  `lib/components/restart-required-indicator.tsx` already provide the restart
  indicator UI the settings tab must use.
- `app/runtime/plugin-runtime-json5-parser.ts` is a handwritten JSON5 lexer
  that reports property offsets;
  `app/runtime/plugin-runtime-json5-roundtrip.ts` uses it to upsert
  `config.plugins.<id>` without disturbing comments.

Renderer:

- `lib/containers/hyper.tsx` renders the header (tab strip) and
  `TermsContainer`. Tabs are derived: `getTabs` in `lib/containers/header.ts`
  maps root term groups to `ITab` objects (`typings/hyper.d.ts`).
  `changeTab`/`closeTab` in `lib/actions/header.ts` assume term-group uids.
- Redux slices are combined in `lib/reducers/index.ts` (`ui`, `sessions`,
  `termGroups`).
- Components use CSS Modules (`*.module.css`) and the custom properties in
  `lib/tailwind.css`. There is no component library.
- Translation is a hand-rolled hook, `lib/hooks/use-translation.ts`.
- Renderer-to-main calls go through `RendererCommandTransport`
  (`shared/src/types/transport.ts`, implemented in `lib/transport/`) typed by
  `IpcCommands` in `shared/src/types/common.ts`; responses are validated with
  zod schemas in `lib/transport/ipc-schemas.ts`. Main-to-renderer events are
  typed by `RendererEvents` and registered in
  `lib/bootstrap/renderer-bootstrap.ts`. `app/clipboard.ts` is the clearest
  precedent for a port plus IPC handler module.
- The legacy command path: the `execCommand` action (`lib/actions/ui.ts`) runs
  a renderer handler if registered, otherwise emits `command` to the main
  process, where `app/commands.ts` handles it.

Tests:

- Unit and behavioural tests live in `test/unit/` and run with
  `bun test --concurrent --isolate test/unit` (`make test`). Behavioural suites
  are distinguished by name, for example `*-behaviour.test.ts`.
- Component tests render with `createRoot` and `act` from React after
  `await setupHappyDom()` from `test/testUtils/happy-dom.ts`. There is no React
  Testing Library.
- E2E: the fast lane `test/e2e/electron.e2e.test.ts` (Bun, every PR, smoke
  only) and the deep lane `test/e2e-deep/*.e2e.ts` (Playwright, scheduled),
  both requiring a packaged build.

Terms used in this plan:

- Catalogue: the curated list of settings the UI can edit, with category and
  control descriptors.
- Snapshot: the main process's answer to "what are the current values?",
  containing user values, defaults, profile-override keys, and file status.
- Gateway: the renderer-side port through which the settings editor reads
  snapshots and requests writes; its adapter uses the IPC transport.
- Coercion: turning raw input text into a typed value (for example `"14"` to
  `14`) and rejecting malformed input before any write is requested.
- Field state machine: the pure function that moves one field between
  `idle`, `invalid`, `saving`, `rejected`, and `failed` in response to edits,
  submissions, resets, and write outcomes.

## Conformance basis

Upstream artefacts (revisions as of commit `40949b2f` on `main`):

- Roadmap `docs/roadmap.md` item 5.1.1 (RM-5.1.1), requiring 3.1.1 (done).
- Product requirements `docs/velocetty-product-requirements-document.md`
  §"4) Settings tab + plugin settings panels": PRD-SET-1 "Settings UI shell
  with search, categories, validation, reset-to-default"; PRD-SET-2 settings
  actions must become commands (deferred to 5.1.2, preserved by D2).
- Technical design `docs/velocetty-design.md` §"Settings tab and plugin
  settings panels": TDD-SET-TAB "settings are a tab type
  (`tabType = "settings"`), not a modal"; §"Hot reload": TDD-HR-UI "the
  settings UI should surface which settings require restart"; §"Validation and
  error reporting": TDD-VAL "structured diagnostics with JSON Pointer paths";
  context keys `settingsOpen` and `tabType` (TDD-CTX-SET).
- Developers guide `docs/developers-guide.md` §"Configuration format
  practice": DG-CFG-RT "preserve user-authored comments and formatting when
  round-tripping `config.json5`; avoid full-file canonical rewrites";
  §"Settings UI integration": DG-SET-UI restart indicators via
  `useConfigReloadability`.
- ADRs: ADR 001 (Bun test), ADR 003 (React 19), ADR 006 (Oxlint strategy).
  No Terms of Reference document exists for this project.
- Governing standards: `AGENTS.md`, `docs/documentation-style-guide.md`.

Trace links:

```plaintext
RM-5.1.1/PRD-SET-1 (categories)      -> TDD-SET-TAB -> D1, D5 -> EP-M1, EP-M4 -> settings-catalogue-parity.test.ts, settings-tab-shell-behaviour.test.tsx
RM-5.1.1/PRD-SET-1 (search)          -> D6 -> EP-M1, EP-M4 -> settings-search.ts proof, settings-search.property.test.ts
RM-5.1.1/PRD-SET-1 (reset)           -> D4 -> EP-M2, EP-M3, EP-M5 -> json5-document-edit.property.test.ts, settings-service-behaviour.test.ts
RM-5.1.1 (inline validation)         -> TDD-VAL, D3 -> EP-M1, EP-M3, EP-M5 -> field-state.ts proof, settings-editing-behaviour.test.tsx
RM-5.1.1 (editable and validated)    -> DG-CFG-RT, D3 -> EP-M2, EP-M3, EP-M6 -> settings-tab.e2e.ts
TDD-HR-UI/DG-SET-UI                  -> EP-M5 -> settings-editing-behaviour.test.tsx (restart warning scenario)
TDD-CTX-SET                          -> EP-M4 -> settings-tab-slice.test.ts (settingsOpen/tabType derivation)
PRD-SET-2                            -> D2 (deferred to 5.1.2) -> EP-M4 -> preferences-opens-settings.test.ts
```

## Verification plan

The implementation is structured so that the riskiest logic is pure and
isolated: search and the field state machine in `shared/src/settings/`, and
text editing in `app/config/json5-document-edit.ts`. Rendering, IPC, and file
I/O are thin adapters around them.

Axioms (trusted, not verified):

- AXIOM-AJV: Ajv correctly validates instances against the generated JSON
  Schema.
- AXIOM-JSON5: `JSON5.parse` from the `json5` package correctly parses JSON5.
- AXIOM-IPC-ORDER: Electron delivers `ipcRenderer.invoke` calls from one
  renderer to `ipcMain.handle` in send order, and values survive structured
  clone.
- AXIOM-FS-RENAME: `fs.rename` within one directory atomically replaces the
  target on Linux, macOS, and Windows (Node uses `MoveFileEx` with
  replace-existing on Windows).
- AXIOM-WATCH: chokidar reports a change after the rename, triggering the
  existing reload path.
- AXIOM-LS-MODEL: LemmaScript's Dafny translation is faithful for the fragment
  used (strings, arrays, records, string-literal unions, integers). Case folding
  (`toLowerCase`) happens outside the verified functions, so its Unicode
  behaviour is not part of the proved model.
- AXIOM-REACT: React 19 `useReducer` applies dispatched actions in dispatch
  order.

Obligations:

- Obligation INV-SEARCH-SOUND: every setting returned by
  `filterSettingIndices` matches every query token and, when `@modified` is
  present, is modified, and belongs to the selected category (or the selection
  is "all"). Method: formal proof (LemmaScript, Dafny backend) plus a mirrored
  `fast-check` property. Rationale: wrong filtering silently hides settings;
  the function is pure string and array logic inside the supported fragment.
  Domain: all arrays of normalized haystack strings, all token arrays, all
  modified-flag arrays of equal length, all category selections. Artefact:
  `shared/src/settings/search.ts` (annotated),
  `shared/src/settings/search.dfy`, and
  `test/unit/settings-search.property.test.ts`. Evidence: `make proofs` reports
  the module verified with zero errors; the property test passes 1,000 runs.
  Non-vacuity: the `requires` clause (equal lengths) is satisfiable by the
  empty and singleton witnesses recorded in the `.dfy` file as `lemma`
  examples; seeded mutation "replace `every` with `some` in the token match"
  must make Dafny report a failing postcondition and the property test produce
  a counterexample; the generator's classification must show at least 20% of
  runs with a non-empty result and at least 20% with a filtered-out element.
- Obligation INV-SEARCH-COMPLETE: every setting that satisfies the match
  predicate is returned. Method, domain, artefacts, and evidence as for
  INV-SEARCH-SOUND (same proof file, separate `ensures` clause). Non-vacuity:
  seeded mutation "stop scanning after the first match" must be rejected.
- Obligation INV-SEARCH-ORDER: returned indices are strictly increasing, so
  results preserve catalogue order and contain no duplicates. Same method and
  artefacts. Non-vacuity: seeded mutation "prepend rather than append matches"
  must be rejected.
- Obligation INV-FIELD-WF: for every field state `s` and event `e`, if
  `wellFormed(s)` then `wellFormed(step(s, e).state)`, where `wellFormed` means:
  `phase === 'saving'` if and only if a pending request id exists; any pending
  id is less than `nextRequestId`; `nextRequestId` never decreases; `errors` is
  non-empty exactly in phases `invalid`, `rejected`, and `failed`. Method:
  formal proof (LemmaScript) plus a `fast-check` model-based test of the hook.
  Domain: all well-formed states, all events. Artefact:
  `shared/src/settings/field-state.ts`, `shared/src/settings/field-state.dfy`,
  `test/unit/settings-field-state.property.test.ts`. Evidence: `make proofs`
  verified; property test 1,000 runs. Non-vacuity: witnesses for each phase are
  constructed in the `.dfy` file; seeded mutation "leave `pendingRequestId` set
  after an `applied` outcome" must be rejected.
- Obligation INV-FIELD-STALE: an outcome event whose request id differs from
  the pending request id leaves the state unchanged and emits no effect.
  Method: formal proof plus model-based test in which the fake gateway resolves
  requests in a generated permutation. Non-vacuity: the model-based test must
  classify at least 10% of runs as containing an out-of-order resolution;
  seeded mutation "accept any outcome while saving" must be rejected by both.
- Obligation INV-FIELD-WRITE-VALID: `step` emits a `write` effect only for a
  `submit` event whose coercion succeeded, and the effect's request id equals
  the new pending id. A `reset` event emits a `reset` effect with the new
  pending id. Method: formal proof. Non-vacuity: seeded mutation "emit write on
  failed coercion" must be rejected.
- Obligation INV-COERCE: for each control kind, `coerceInput` accepts exactly
  the inputs that represent a value admitted by the control descriptor, and
  `coerceInput(formatValue(v)) === {ok: true, value: v}` for every admitted `v`
  (round trip). Method: `fast-check` properties (floating-point input is
  outside the proof fragment) plus a parameterized boundary table (minimum,
  maximum, just outside, empty string, whitespace, `NaN`, `Infinity`, exponent
  notation, leading `+`). Artefact:
  `test/unit/settings-coerce.property.test.ts`. Non-vacuity: generators
  classify admitted and rejected inputs, each at least 25% of runs; seeded
  mutation "use `Number.parseFloat`" (which accepts `"12abc"`) must be rejected
  by the table.
- Obligation INV-EDIT-SET: for every JSON5 document `d` generated with
  comments, trailing commas, quoted and unquoted keys, and LF or CRLF line
  endings, and every key path `p` under `config` and JSON value `v`,
  `JSON5.parse(setPropertyAtPath(d, p, v))` deep-equals
  `setIn(JSON5.parse(d), p, v)`. Method: `fast-check`. Artefact:
  `test/unit/json5-document-edit.property.test.ts`.
- Obligation INV-EDIT-REMOVE: likewise,
  `JSON5.parse(removePropertyAtPath(d, p))` deep-equals
  `deleteIn(JSON5.parse(d), p)`, including removing the first, middle, last,
  and only property of an object.
- Obligation INV-EDIT-LOCALITY: every comment in `d` that lies outside the
  edited property's span appears byte-for-byte in the output, and the text
  before the edited property's start offset is unchanged. Method: `fast-check`
  with generated sentinel comments. Non-vacuity for all three edit obligations:
  classification shows each of first/middle/last/only positions and both
  line-ending styles in at least 10% of runs; seeded mutations "drop the
  trailing comma handling" and "remove the following comment with the property"
  must each produce a counterexample.
- Obligation LEM-SERVICE-NO-WRITE-ON-REJECT: `SettingsService.setValue` never
  calls `ConfigDocumentStore.write` when validation yields a diagnostic at or
  below `/config/<key>`, when the current file fails to parse, or when the
  edited text fails to re-parse to the expected value. Method: parameterized
  behavioural tests plus a `fast-check` property over generated invalid values
  for numeric and enum keys with a recording in-memory store. Artefact:
  `test/unit/settings-service-behaviour.test.ts`. Non-vacuity: the same suite
  includes accepted writes, proving the store double records writes at all;
  seeded mutation "write before validating" must fail the property.
- Obligation INV-CATALOGUE-PARITY: every property of the `configOptions`
  schema appears exactly once in the catalogue or the exclusion list; every
  catalogue control matches the schema type (enum options equal the schema
  enum; number controls only for numeric schema types; integer flag matches
  `type: integer`); every category is non-empty; every catalogue key has a
  translated label in `en`. Method: exhaustive test over the finite schema
  (enumeration is complete, so no sampling is needed). Artefact:
  `test/unit/settings-catalogue-parity.test.ts`. Non-vacuity: the test reads
  the real generated schema and asserts the schema has more than 30 properties
  before checking parity.
- Obligation INV-TAB-SURFACE: across the transitions open, activate,
  activate a terminal tab, create a terminal tab, close settings, and close the
  last terminal tab, exactly one surface is visible (the settings view when
  `isOpen && isActive`, otherwise the active terminal group), and no transition
  removes a term group or session. Method: parameterized transition table plus
  a short `fast-check` sequence property over the reducer. Artefact:
  `test/unit/settings-tab-slice.test.ts`.

Proof hygiene: no `//@ assume` is permitted in the proof files; any
`//@ extern` must be listed in the ADR and the architecture document as a
trusted assumption. `lsc check` enforces that each `.dfy` differs from its
`.dfy.gen` by additions only.

## Plan of work

The work proceeds in eight milestones. Each ends with the full gate sequence,
run sequentially: `make check-fmt`, `make typecheck`, `make lint`, `make test`,
plus `make proofs` from EP-M0 onwards, and `make markdownlint` and `make nixie`
whenever Markdown changes. Changes under `shared/` or `app/` also run
`bun run build:packages` and `bunx tsgo --project app/tsconfig.build.json`,
because the local typecheck gate does not cover those stricter build
configurations (`docs/developers-guide.md`, "Local gates do not cover the whole
build surface"). Every change follows Red-Green-Refactor: write the failing
test, run it and record the failure, make it pass with the smallest change,
then refactor and rerun.

### EP-M0: proof and property tooling prototype (prototyping milestone)

Add `fast-check` (caret) and `lemmascript` (exact pin) as development
dependencies with `bun add -d`. Create `LemmaScript-files.txt` at the
repository root and a `proofs` target in `Makefile` that runs
`bunx lsc check --backend=dafny` over every listed file. Write one throwaway
annotated function, `shared/src/settings/prototype-proof.ts`, that uses the
same constructs the real proofs need: a `string[]` parameter, `includes` on
strings, a `for` loop with invariants, a discriminated union, and a record
type. Run `lsc gen` and `lsc check`. Confirm that Biome, Oxlint, the boundary
checker, `make spelling`, and `tsgo` all accept the generated files (add ignore
entries for `*.dfy` and `*.dfy.gen` to `biome.json` and the Oxlint config if
needed). Write one trivial `fast-check` property under `test/unit/` and confirm
it runs under `--concurrent --isolate`.

Keep-or-discard criteria: keep if `make proofs` verifies the prototype in under
60 seconds and every other gate is clean; then delete the prototype function
and its artefacts (keeping the tooling). Discard and escalate if LemmaScript
cannot handle the constructs after two restructuring attempts. Decide and
record in `Decision log` whether CI gets a proof job; if yes, add a job to
`.github/workflows/nodejs.yml` that installs Dafny 4.11 and runs `make proofs`
on Linux only.

### EP-M1: settings domain core

All files in `shared/src/settings/`, all pure.

1. `catalogue/types.ts`: `SettingKey` (a union of catalogue keys),
   `SettingCategoryId`
   (`'appearance' | 'cursor' | 'colours' | 'terminal' | 'rendering' | 'updates'`),
   `ControlDescriptor` (discriminated union: `toggle`; `select` with `options`;
   `number` with `minimum?`, `maximum?`, `step?`, `integer`; `text` with
   `multiline: false`; `colour`), and `CatalogueEntry`
   (`{key, category, control, labelKey}`).
2. `catalogue/<category>.ts` (one file per category) and `catalogue/index.ts`
   exporting `CORE_SETTINGS_CATALOGUE` in display order and
   `EXCLUDED_CONFIG_KEYS` (key to reason).
3. `search.ts`: `normalizeSearchText(text)` (lower-case, collapse whitespace;
   not verified), `parseSettingsQuery(query)` returning
   `{tokens, isModifiedOnly}`, and the verified core
   `filterSettingIndices(haystacks, tokens, modifiedFlags, isModifiedOnly,
   categoryIndices, selectedCategory)`
   returning matching indices in ascending order.
4. `coerce.ts`: `coerceInput(control, raw)` returning
   `{ok: true, value} | {ok: false, reason}` where `reason` is a discriminated
   union
   (`'empty' | 'not-a-number' | 'not-an-integer' | 'below-minimum' |
   'above-maximum' | 'not-an-option' | 'not-a-colour'`)
   carrying bounds for messages; `formatValue(control, value)` for display.
5. `field-state.ts`: `FieldState`, `FieldEvent`, `FieldEffect`, the pure
   `stepField(state, event)` returning `{state, effect}`, and `wellFormed`.
6. `ports.ts`: the driven-port types `SettingsGateway`, `SettingsSnapshot`,
   and `SettingsWriteOutcome` (types only; shared with the main process via
   `import type`).

Tests (red first): `test/unit/settings-catalogue-parity.test.ts`,
`test/unit/settings-search.test.ts` (named examples),
`test/unit/settings-search.property.test.ts`,
`test/unit/settings-coerce.test.ts` (boundary table),
`test/unit/settings-coerce.property.test.ts`,
`test/unit/settings-field-state.test.ts` (transition table), and
`test/unit/settings-field-state.property.test.ts`. Proofs: annotate `search.ts`
and `field-state.ts`, list them in `LemmaScript-files.txt`, run `lsc gen`, add
helper lemmas and non-vacuity witnesses in the `.dfy` files, and run the seeded
mutations listed in `Verification plan`, recording each Dafny rejection in
`Artefacts and notes` before reverting the mutation.

### EP-M2: comment-preserving JSON5 edit operations

Create `app/config/json5-document-edit.ts` by extracting the generic parts of
`app/runtime/plugin-runtime-json5-roundtrip.ts` (`Json5Document`, `propertyKey`,
`propertyPath`, `upsertObjectProperty`, `ensureObjectPath`,
`getObjectRangeByPath`) and adding `setPropertyAtPath(doc, path, value)` and
`removePropertyAtPath(doc, path)`. Removal deletes the key, its value, the
separating comma (preceding comma when removing the last property), and the
whole line when the property occupied its own line; comments on other lines are
untouched. Both functions return `null` when the path does not resolve to an
object property they can edit. Rewrite `applyPluginSettingsPatches` to call
`setPropertyAtPath`, updating its callers in the same change (no compatibility
shim). Add `test/testUtils/json5-document-arbitrary.ts`, a `fast-check`
generator that builds a JSON object tree and prints it with randomized but
valid JSON5 style choices and sentinel comments. Tests:
`test/unit/json5-document-edit.test.ts` (named examples, including the existing
plugin round-trip cases) and `test/unit/json5-document-edit.property.test.ts`.
The existing `test/unit/plugin-runtime-json5-parser-roundtrip.test.ts` and
`test/unit/runtime-plugin-settings.test.ts` must stay green unchanged.

### EP-M3: main-process settings service and IPC

1. In `app/config/json5-config.ts`, export
   `validateConfigOptions(value): configValidationDiagnostic[]` returning all
   Ajv issues as diagnostics with `/config` prefixed paths. Keep
   `validateRawConfig` behaviour unchanged.
2. Add JSDoc constraints (`@minimum`, `@maximum`, `@TJS-type integer`) for the
   numeric keys the catalogue exposes (`fontSize`, `lineHeight`,
   `letterSpacing`, `scrollback`, `webGLRendererMaxContexts`, and any other
   numeric catalogue entry) in `shared/src/types/config.ts`; run
   `bun run generate-schema`; extend `test/unit/config-schema-contract.test.ts`.
3. `app/settings/settings-service.ts`: `createSettingsService(deps)` where
   `deps` holds the driven ports `ConfigDocumentStore`
   (`read(): Promise<{kind: 'present', text} | {kind: 'missing'}>`,
   `write(text): Promise<void>`), `validateConfigOptions`, `getDefaults()`,
   `isEditableKey(key)`, and an injected logger. It exposes `getSnapshot()`,
   `setValue(key, value)`, and `resetValue(key)`. Writes are serialized with an
   internal promise queue. Each write reads the file, parses it (refusing with
   `{kind: 'failed', reason: 'user-config-unparseable'}` on a parse error),
   applies the edit, re-parses and compares, validates, filters diagnostics to
   the key, and either writes or returns `{kind: 'rejected', diagnostics}`.
4. `app/settings/fs-config-document-store.ts`: the file adapter, writing to a
   sibling temporary file and renaming it over `cfgPath`.
5. `app/settings/settings-ipc.ts`: `registerSettingsIpcHandlers(service)`
   registering `settings:getSnapshot`, `settings:setValue`, and
   `settings:resetValue`, following `app/clipboard.ts`. Wire the call into the
   main-process start-up where `registerClipboardIpcHandlers` is called.
6. Extend `IpcCommands` in `shared/src/types/common.ts` and add zod response
   schemas in `lib/transport/ipc-schemas.ts`; extend
   `test/unit/ipc-schemas.test.ts`.

Tests: `test/unit/settings-service.test.ts` (in-memory store),
`test/unit/settings-service-behaviour.test.ts` (Given/When/Then scenarios,
including the property for LEM-SERVICE-NO-WRITE-ON-REJECT), and
`test/unit/fs-config-document-store.test.ts` (per-test temporary directory).

### EP-M4: settings tab shell and navigation

1. `shared/src/constants/settings-tab.ts`: `SETTINGS_TAB_UID` and action types
   `SETTINGS_TAB_OPEN`, `SETTINGS_TAB_CLOSE`, `SETTINGS_TAB_ACTIVATE`.
2. `lib/reducers/settings-tab.ts`: the `settingsTab` slice; it also handles
   `SESSION_SET_ACTIVE` and term-group activation actions by setting
   `isActive: false`. Register it in `lib/reducers/index.ts` and the
   `HyperState` typings.
3. `lib/actions/settings-tab.ts`: `openSettingsTab()`, `closeSettingsTab()`.
   `changeTab(uid)` and `closeTab(uid)` in `lib/actions/header.ts` branch on
   `SETTINGS_TAB_UID`.
4. `getTabs` in `lib/containers/header.ts` appends the settings tab when open,
   with `tabType: 'settings'` and a translated title. Add optional
   `tabType?: 'terminal' | 'settings'` to `ITab`.
5. `lib/containers/hyper.tsx` renders `SettingsContainer` beside
   `TermsContainer`, and adds a CSS-Modules class that hides terms when the
   settings tab is active.
6. Main process: `app/commands.ts` changes `window:preferences` to emit
   `settings open` to the focused window, and adds `window:openConfigFile`
   calling the existing `openConfig()`. Add `settings open` to `RendererEvents`
   and register it in `lib/bootstrap/renderer-bootstrap.ts`.
7. `lib/settings/components/settings-view.tsx` (pure view):
   header with title, search box (`role="searchbox"`, labelled), category
   navigation (`nav` with a list of buttons, `aria-current` on the selected
   category, match counts), a results region (`role="region"`, labelled), an
   empty-results message, and the "Open config.json5" button. Read-only rows at
   this milestone render label, description, and current value.
8. `lib/settings/hooks/use-settings-editor.ts`: owns query, category,
   snapshot loading via the gateway (with an `AbortController` per load),
   refresh on `config change`, and search via the domain core.
9. `lib/settings/adapters/transport-settings-gateway.ts`: the gateway adapter
   over `RendererCommandTransport`.
10. `lib/settings/i18n/` dictionaries and `useSettingsTranslation`.

Tests: `test/unit/settings-tab-slice.test.ts`,
`test/unit/settings-tab-header.test.tsx` (tab appears, activates, closes, and a
decorating plugin double reading `uid` does not throw),
`test/unit/preferences-opens-settings.test.ts` (main command emits the event),
and `test/unit/settings-tab-shell-behaviour.test.tsx` (search and category
scenarios against a fake gateway).

### EP-M5: editing, inline validation, and reset flows

1. Control components in `lib/settings/components/controls/`: `toggle-field`,
   `select-field`, `number-field`, `text-field`, `colour-field`, each pure and
   accepting
   `{id, label, description, value, draft, status, errors,
   onDraftChange, onSubmit, onReset}`-style
   props grouped into typed objects.
2. `setting-row.tsx`: label, description, control, modified indicator, reset
   button (shown only when modified, labelled "Reset `<label>` to default"),
   inline error list (`id` referenced by the control's `aria-describedby`,
   `aria-invalid` on the control, `role="alert"` only for newly surfaced
   errors), `InlineRestartWarning` for restart-classified keys after a
   successful write, and a profile-override note.
3. Extend `use-settings-editor.ts` to dispatch field events, run coercion,
   pair `write` effects with coerced values, call the gateway, and feed
   outcomes back as events.
4. A file-status banner when the snapshot reports `user-config-unparseable`
   or pre-existing diagnostics on other keys, with the "Open config.json5"
   action.

Tests: `test/unit/settings-editing-behaviour.test.tsx` (scenarios below),
`test/unit/settings-controls.test.tsx`, and
`test/unit/settings-editor-hook.property.test.ts` (model-based, reordering fake
gateway).

### EP-M6: end-to-end coverage

Add `test/e2e-deep/settings-tab.e2e.ts` using the existing deep-lane helpers.
Seed the isolated config directory with a `config.json5` containing a sentinel
comment, launch the packaged app, press the preferences shortcut, and run the
open, edit, invalid, and reset flows, asserting UI state and file contents.
Extend the fast lane `test/e2e/electron.e2e.test.ts` only with a smoke
assertion that the settings tab opens, if that can be done without making the
PR lane slower than 30 seconds; otherwise record the decision. Run locally per
the headless notes in `docs/developers-guide.md` (E2E section).

### EP-M7: documentation, ADR, and roadmap closure

1. `docs/adr-007-settings-tab-hosting-and-persistence.md` (D1 to D4, D12),
   in the style-guide ADR format.
2. `docs/velocetty-design.md` §"Settings tab and plugin settings panels":
   summarize the implemented shell, link ADR 007, and state that profile
   editing and structured editors are deferred.
3. `docs/settings-tab-architecture.md`: component architecture (domain ring,
   ports, adapters, IPC contract, snapshot shape, write algorithm, trusted
   assumptions, proof inventory).
4. `docs/developers-guide.md`: "Settings tab practice" (adding a setting to
   the catalogue, exclusion policy, translation keys, schema constraints) and
   "Property tests and proofs practice" (`fast-check` conventions,
   `LemmaScript-files.txt`, `make proofs`, the regen workflow, no `//@ assume`).
5. `docs/users-guide.md` (new): opening settings, categories, search and
   `@modified`, editing, validation messages, reset, restart-required settings,
   and editing other settings in `config.json5`.
6. `docs/roadmap.md`: fix the 5.1.1 design links and mark 5.1.1 done
   (`[x]` on the item and its sub-bullets).

## Behavioural specification

The behavioural suites use `bun:test` with Given/When/Then test names. There is
no Gherkin runner in the project; the scenarios below are the specification and
map one-to-one to test cases.

```plaintext
Feature: Settings tab shell and navigation
  Scenario: Opening settings from the preferences command
    Given a window with one terminal tab
    When the main process emits "settings open"
    Then a tab titled "Settings" appears after the terminal tab and is active
    And the terminal tab's session is still present

  Scenario: Returning to a terminal
    Given the settings tab is open and active
    When the user activates the terminal tab
    Then the terminal is visible and the settings tab remains in the strip

  Scenario: Browsing a category
    Given the settings tab shows all settings
    When the user selects the "Cursor" category
    Then only cursor settings are listed and "Cursor" is marked current

  Scenario: Searching
    Given the settings tab shows all settings
    When the user types "font size"
    Then "Font size" is listed and "Cursor shape" is not

  Scenario: Showing modified settings
    Given config.json5 sets fontSize to 14
    When the user types "@modified"
    Then exactly "Font size" is listed

  Scenario: No results
    When the user types "zzzz"
    Then a "No settings match" message is shown

Feature: Editing core settings
  Scenario: Valid edit of a live setting
    Given fontSize is not set in config.json5
    When the user enters 16 in "Font size" and presses Enter
    Then the gateway receives setValue("fontSize", 16)
    And the field shows 16 with a modified indicator

  Scenario: Locally invalid input
    When the user enters "abc" in "Font size" and presses Enter
    Then an inline error "Enter a number" is shown
    And the field is marked aria-invalid
    And no write is requested

  Scenario: Schema rejection from the main process
    Given the gateway rejects scrollback with a diagnostic at /config/scrollback
    When the user enters -3 in "Scrollback" and presses Enter
    Then the diagnostic message is shown inline under "Scrollback"

  Scenario: Stale outcome is ignored
    Given a write of fontSize 16 is pending
    When the user submits 18 before the first write resolves
    And the first write resolves as rejected
    Then no error is shown and the field waits for the second outcome

  Scenario: Restart-required setting
    When the user changes "Update channel" to "canary"
    Then the restart-required warning is shown for that field

  Scenario: Reset to default
    Given config.json5 sets fontSize to 14
    When the user activates "Reset Font size to default"
    Then the gateway receives resetValue("fontSize")
    And the field shows the default and no modified indicator

  Scenario: Unparseable user config
    Given config.json5 contains a syntax error
    Then a banner explains that settings cannot be saved until the file is fixed
    And edits are disabled
```

## Milestones and plateaus

- EP-M0 outcome: proof and property tooling installed and proven on a
  prototype; `make proofs` exists. Requirements: enabling work for INV-SEARCH-*
  and INV-FIELD-*. Acceptance: `make proofs` passes; a `fast-check` property
  runs in `make test`. Conformance check:
  - No product requirement is claimed.
  - Design unaffected.
  - Assumption AXIOM-LS-MODEL tested on representative constructs.
  - Only the two pre-approved dependencies added.
  - No trust-boundary or persisted-format change.
  - Trace links unchanged.
  Recovery: revert the dependency and Makefile commit. Remaining gaps: all
  product work. Compatibility decision: none.
- EP-M1 outcome: a pure, proved settings domain with no UI. Requirements:
  PRD-SET-1 (categories, search, validation at the domain level), D5, D6.
  Acceptance: the EP-M1 tests pass; `make proofs` verifies `search.ts` and
  `field-state.ts`; seeded mutations recorded as rejected. Conformance check:
  - Catalogue covers or explicitly excludes every schema key.
  - Domain imports nothing outside `shared/src`.
  - AXIOM-LS-MODEL still holds.
  - No public interface change.
  - No persisted-format change.
  - Trace links for search and validation current.
  Recovery: the domain is unused by production code, so revert freely.
  Remaining gaps: persistence, UI. Compatibility decision: none.
- EP-M2 outcome: generic comment-preserving set and remove on JSON5 text;
  plugin runtime uses it. Requirements: DG-CFG-RT, D4. Acceptance: property
  suite passes 1,000 runs per property; existing plugin round-trip suites
  unchanged and green. Conformance check:
  - DG-CFG-RT satisfied by INV-EDIT-LOCALITY.
  - Design followed.
  - No new assumption.
  - The plugin persistence API changes internally only; callers updated in
    the same commit.
  - Persisted format unchanged (same JSON5 text conventions).
  - Trace links current.
  Recovery: revert; the plugin runtime returns to the old module. Compatibility
  decision: none (private API).
- EP-M3 outcome: the main process can report and change core settings
  through IPC with validation. Requirements: TDD-VAL, D3, D4, D12. Acceptance:
  service behavioural suite green, including the no-write property; schema
  contract test green with new constraints. Conformance check:
  - Rejected writes never reach disk.
  - Main remains sole writer.
  - AXIOM-FS-RENAME and AXIOM-IPC-ORDER recorded.
  - New IPC channels documented in `IpcCommands`.
  - Schema gains constraints only (stricter validation); confirm the default
    config still validates.
  - Trace links current.
  Recovery: revert; nothing in the renderer calls the channels yet.
  Compatibility decision: none. Note that adding schema constraints can make an
  existing user file with out-of-range values fail validation; the existing
  fallback-with-notification behaviour applies, and the ADR records this.
- EP-M4 outcome: the settings tab opens from `Preferences…`, coexists with
  terminals, and offers read-only browsing with search and categories.
  Requirements: TDD-SET-TAB, TDD-CTX-SET (state available for the future
  context keys), PRD-SET-1 (search, categories), D1, D2. Acceptance: EP-M4
  suites green; manual run of `bun run start` (or the packaged app) shows the
  tab. Conformance check:
  - The tab is a tab, not a modal.
  - Terminal sessions untouched.
  - No plugin hook signature change.
  - `window:preferences` behaviour change recorded for the users guide.
  - No persisted-format change.
  - Trace links current.
  Recovery: revert the renderer commits; main-process change reverts with them.
  Compatibility decision: none.
- EP-M5 outcome: core settings are editable and validated in the UI, with
  reset and restart warnings. Requirements: RM-5.1.1 success criterion,
  TDD-HR-UI, DG-SET-UI. Acceptance: editing behavioural suite and the
  model-based hook property green. Conformance check:
  - Every RM-5.1.1 bullet observable in a behavioural test.
  - Restart indicators reuse the existing components.
  - No new dependency.
  - No new trust boundary.
  - Trace links current.
  Recovery: revert to EP-M4's read-only plateau. Compatibility decision: none.
- EP-M6 outcome: E2E evidence of the full flow against a real file.
  Acceptance: `bun run test:e2e:deep` passes locally with the new spec.
  Conformance check:
  - File contents and comments verified end to end.
  - Trace links current.
  Recovery: the spec is additive. Compatibility decision: none.
- EP-M7 outcome: documentation current and roadmap closed. Acceptance:
  `make markdownlint`, `make nixie`, and `make spelling` clean; roadmap shows
  5.1.1 done. Conformance check: every decision in `Decision log` reflected in
  the ADR or design document; every trace link resolves. Compatibility
  decision: none.

## Concrete steps

Run every command from the repository root:
`/home/leynos/.lody/repos/github---leynos---velocetty/worktrees/756edcc7-b386-4ab4-9698-d33a056e9128`
(or the equivalent checkout of branch
`5-1-1-settings-tab-shell-and-navigation`).

Log every gate with `tee` so truncated output can be reviewed:

```bash
set -o pipefail
PROJECT=$(get-project 2>/dev/null || echo velocetty)
BRANCH=$(git branch --show-current | tr '/' '-')
make check-fmt 2>&1 | tee "/tmp/check-fmt-${PROJECT}-${BRANCH}.out"
make typecheck 2>&1 | tee "/tmp/typecheck-${PROJECT}-${BRANCH}.out"
make lint 2>&1 | tee "/tmp/lint-${PROJECT}-${BRANCH}.out"
make test 2>&1 | tee "/tmp/test-${PROJECT}-${BRANCH}.out"
make proofs 2>&1 | tee "/tmp/proofs-${PROJECT}-${BRANCH}.out"
```

For changes under `shared/` or `app/`, also:

```bash
bun run build:packages 2>&1 | tee "/tmp/build-packages-${PROJECT}-${BRANCH}.out"
bunx tsgo --project app/tsconfig.build.json 2>&1 | tee "/tmp/tsgo-app-${PROJECT}-${BRANCH}.out"
git status --short   # remove any untracked generated .js/.d.ts under shared/src before check-fmt
```

For Markdown changes:

```bash
make markdownlint 2>&1 | tee "/tmp/markdownlint-${PROJECT}-${BRANCH}.out"
make nixie 2>&1 | tee "/tmp/nixie-${PROJECT}-${BRANCH}.out"
```

Focused red and green runs for a new suite:

```bash
bun test --concurrent test/unit/settings-search.test.ts
bun test --concurrent --randomize --seed 12345 test/unit/settings-search.property.test.ts
```

Expected red transcript (example, EP-M1 search):

```plaintext
error: Cannot find module '@shared/settings/search'
0 pass
1 fail
```

Proof workflow (EP-M1):

```bash
bunx lsc gen --backend=dafny shared/src/settings/search.ts
bunx lsc check --backend=dafny shared/src/settings/search.ts
# after editing the .ts source, never delete the .dfy; regenerate with:
bunx lsc regen --backend=dafny shared/src/settings/search.ts
```

Expected proof transcript on success (shape, exact counts recorded when run):

```plaintext
Dafny program verifier finished with N verified, 0 errors
```

Deep E2E (EP-M6):

```bash
make build 2>&1 | tee "/tmp/build-${PROJECT}-${BRANCH}.out"
bun run test:e2e:deep 2>&1 | tee "/tmp/e2e-deep-${PROJECT}-${BRANCH}.out"
```

Commit after each green Red-Green-Refactor cycle, gated by the sequence above,
with imperative subject lines.

## Validation and acceptance

Acceptance is behavioural:

- Running `make test` passes; each suite named in `Plan of work` exists, failed
  before its production change (recorded in `Artefacts and notes`), and passes
  after.
- Running `make proofs` reports zero errors for `shared/src/settings/search.ts`
  and `shared/src/settings/field-state.ts`. This is an explicit acceptance
  criterion of EP-M1 and is rerun at every later milestone.
- In the packaged app, `Ctrl+,` opens the settings tab; changing font size to
  16 updates open terminals without restart; entering `abc` shows "Enter a
  number" under the field and leaves `config.json5` unchanged; resetting font
  size removes `fontSize` from `config.json5` while every comment in the file
  remains.
- `bun run test:e2e:deep` passes with `test/e2e-deep/settings-tab.e2e.ts`.

Quality criteria:

- Tests: `make test` green under `--concurrent --isolate`; property suites run
  at least 1,000 cases per property with recorded classification output.
- Verification: every obligation in `Verification plan` discharged as stated,
  with seeded-mutation rejections recorded.
- Lint and typecheck: `make check-fmt`, `make typecheck`, `make lint`,
  `bun run build:packages`, and `bunx tsgo --project app/tsconfig.build.json`
  clean.
- Accessibility: every control has an accessible name; errors are associated
  through `aria-describedby`; category navigation exposes `aria-current`;
  keyboard-only users can reach search, categories, every control, and reset
  (asserted in the behavioural suite by focusing and dispatching key events).
- Security: no new IPC channel accepts a key outside the editable set (D12);
  no write bypasses validation.

Quality method: the gate commands in `Concrete steps`, run sequentially by the
`scrutineer` agent where available, plus the local deep E2E run.

## Idempotence and recovery

All steps are additive or reversible by `git revert`. `lsc gen` must not be
rerun on a file that already has a `.dfy`; use `lsc regen`, which performs a
three-way merge. `bun run generate-schema` is idempotent. The E2E suite uses an
isolated configuration directory and never touches the developer's real
`config.json5`. If a gate fails midway, fix and rerun the whole sequence from
`make check-fmt`.

## Artefacts and notes

To be filled during implementation: red-stage transcripts, proof verifier
summaries, seeded-mutation rejection transcripts, property classification
output, and E2E logs.

## Interfaces and dependencies

New development dependencies: `fast-check` (`^4.10.2` or newer at install time)
and `lemmascript` (exact pin, version chosen in EP-M0; npm currently reports
`0.6.5`). External tool: Dafny 4.11 (already installed locally).

Domain types in `shared/src/settings/` (illustrative; final names recorded here
if they change):

```typescript
export type SettingCategoryId = 'appearance' | 'cursor' | 'colours' | 'terminal' | 'rendering' | 'updates';

export type ControlDescriptor =
  | {kind: 'toggle'}
  | {kind: 'select'; options: readonly string[]}
  | {kind: 'number'; minimum?: number; maximum?: number; step?: number; isInteger: boolean}
  | {kind: 'text'}
  | {kind: 'colour'};

export type CatalogueEntry = {
  key: SettingKey;
  category: SettingCategoryId;
  control: ControlDescriptor;
  labelKey: SettingsTranslationKey;
};

export type FieldPhase = 'idle' | 'invalid' | 'saving' | 'rejected' | 'failed';

export type FieldState = {
  phase: FieldPhase;
  draft: string;
  errors: readonly string[];
  pendingRequestId: number; // -1 when no request is pending
  nextRequestId: number;
};

export type FieldEvent =
  | {kind: 'edit'; draft: string}
  | {kind: 'submit'; isCoercionOk: boolean; errors: readonly string[]}
  | {kind: 'reset'}
  | {kind: 'outcome'; requestId: number; result: 'applied' | 'rejected' | 'failed'; errors: readonly string[]}
  | {kind: 'refresh'; draft: string};

export type FieldEffect = {kind: 'none'} | {kind: 'write'; requestId: number} | {kind: 'reset'; requestId: number};

export const stepField = (state: FieldState, event: FieldEvent): {state: FieldState; effect: FieldEffect} => {
  /* verified */
};

export type SettingsSnapshot = {
  fileStatus: {kind: 'ok'} | {kind: 'missing'} | {kind: 'unparseable'; diagnostics: configValidationDiagnostic[]};
  userValues: Readonly<Record<string, JsonValue>>;
  defaultValues: Readonly<Record<string, JsonValue>>;
  profileOverriddenKeys: readonly string[];
  otherDiagnostics: readonly configValidationDiagnostic[];
};

export type SettingsWriteOutcome =
  | {kind: 'applied'}
  | {kind: 'rejected'; diagnostics: configValidationDiagnostic[]}
  | {kind: 'failed'; reason: 'user-config-unparseable' | 'not-editable' | 'edit-failed' | 'io-error'};

export type SettingsGateway = {
  getSnapshot(signal: AbortSignal): Promise<SettingsSnapshot>;
  setValue(request: {key: SettingKey; value: JsonValue}, signal: AbortSignal): Promise<SettingsWriteOutcome>;
  resetValue(request: {key: SettingKey}, signal: AbortSignal): Promise<SettingsWriteOutcome>;
};
```

IPC additions to `IpcCommands` in `shared/src/types/common.ts`:

```typescript
'settings:getSnapshot': () => SettingsSnapshot;
'settings:setValue': (key: string, value: JsonValue) => SettingsWriteOutcome;
'settings:resetValue': (key: string) => SettingsWriteOutcome;
```

Main-process edit operations in `app/config/json5-document-edit.ts`:

```typescript
export const setPropertyAtPath = (doc: Json5Document, path: PropertyPath, value: JsonValue): Json5Document | null => {
  /* ... */
};
export const removePropertyAtPath = (doc: Json5Document, path: PropertyPath): Json5Document | null => {
  /* ... */
};
```

Skills and references the implementer should load: `execplans` (this plan's
format), `typescript-router` then `react-and-accessible-ui`,
`typescript-boundaries-and-validation`, `electron-and-ipc`,
`typescript-testing`, `fast-check`, `lemmascript`, `hexagonal-architecture`,
`codegraph-mcp` (navigation), `biome-typescript` and `typescript-quality-tools`
(lint fixes), and `en-gb-oxendict-style` (documentation). Documentation to read
first: `docs/developers-guide.md` (package boundaries, configuration practice,
settings UI integration, tests), `docs/testing-with-bun.md`, and
`docs/adr-006-oxlint-plugin-strategy.md`.

## Revision note

2026-10-29: initial draft, produced from Wyvern reconnaissance and Firecrawl
prior-art research. Awaiting community-of-experts review.
