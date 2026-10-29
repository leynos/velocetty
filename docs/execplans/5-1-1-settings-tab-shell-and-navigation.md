# Implement the settings tab shell and navigation (roadmap 5.1.1)

## Module header

- Purpose: define an implementation-ready execution plan for roadmap item
  `5.1.1`, which delivers a first-class settings tab with search, categories,
  reset-to-default, and inline validation so that core settings are editable
  and validated in the user interface (UI).
- Invariants: the user's config file stays the single source of truth; every
  write is validated by the main process before it reaches disk; a write never
  turns a file that loads into one that does not; user-authored comments and
  formatting outside the edited property survive every write; a rejected edit
  never changes the file; terminal sessions are never resized, written to, or
  closed as a side effect of the settings tab.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-product-requirements-document.md`, `docs/developers-guide.md`,
  `docs/documentation-style-guide.md`, `docs/testing-with-bun.md`,
  `docs/adr-006-oxlint-plugin-strategy.md`, `shared/src/types/config.ts`,
  `shared/src/constants/config-reloadability.ts`, `app/config/json5-config.ts`,
  `app/config/import.ts`, `app/config.ts`, `app/runtime/plugin-runtime.ts`,
  `app/runtime/plugin-runtime-json5-roundtrip.ts`, `lib/containers/header.ts`,
  `lib/actions/ui.ts`, `lib/bootstrap/renderer-bootstrap.ts`,
  `lib/components/restart-required-indicator.tsx`, and
  `lib/hooks/use-config-reloadability.ts`.

This Execution Plan (ExecPlan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT (revised after community-of-experts review; awaiting approval)

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
   the tab strip after their terminal tabs, with the search box focused. Their
   terminals keep running, unresized and untouched.
2. Move between terminal tabs and the settings tab with the mouse and with the
   existing tab shortcuts (next, previous, and tab-by-number).
3. Browse settings by category (for example `Appearance`, `Cursor`,
   `Colours`, `Terminal`, `Rendering`, `Updates`) from a navigation list.
4. Type into a search box to filter settings by label, key, description, or
   category, and type `@modified` to show only settings they have changed.
5. Change a setting (toggle, select, number, text, or colour) and see it
   apply: live-reloadable settings take effect immediately; restart-required
   settings show the existing restart warning.
6. Enter an invalid value (for example `-3` for scrollback, or `abc` for font
   size) and see an inline error message under the field, with the field marked
   invalid for assistive technology. The file on disk is not changed.
7. Reset a modified setting to its default with one click. The setting's key
   is removed from the config file, so the built-in default applies again.
8. See, inline, any setting that is already invalid in their file, and fix or
   reset it from the UI.
9. Open the config file in their editor from a button inside the settings tab
   for settings the UI does not cover yet.

Observable success: the deep end-to-end (E2E) test
`test/e2e-deep/settings-tab.e2e.ts` opens the packaged app, presses the
preferences shortcut, changes `fontSize`, enters an invalid scrollback value,
and resets `fontSize`, asserting the UI state and the exact `config.json5`
contents (including a sentinel comment) after each step, and asserting that the
terminal's column and row count did not change.

## Constraints

- The user's config file remains canonical. The settings UI must not introduce
  a second persisted store, a cache that can disagree with the file, or a
  full-file canonical rewrite. Targeted edits only (developers guide,
  "Configuration format practice").
- The main process is the only writer of the config file, and all of its
  read-modify-write sequences go through one module,
  `app/config/config-file-writer.ts`. The main process is the only authority on
  validity. The renderer may pre-check input shape but must never treat its own
  check as sufficient.
- The load path's validation must not become stricter. Stricter, UI-only
  bounds apply at write time only, so no existing user file can start falling
  back to defaults because of this work.
- Package boundaries enforced by `scripts/check-package-boundaries.mjs` must
  hold: `lib/` must not import `app/`; `app/` must not import `lib/`;
  `shared/src/` imports neither and cannot import `shared/schemas/` (its
  `rootDir` is `./src`). `app/` may import only types from `@shared/*` (the
  main process is compiled to CommonJS without alias resolution).
- Pure domain logic lives in `shared/src/settings/` and must not import
  React, Redux, Electron, Node built-ins, or any transport. It lives in
  `shared/` for purity and proof isolation; it never runs in the main process.
- Terminal sessions (`sessions` and `termGroups` Redux slices, xterm
  instances, and their pseudo-terminals (PTYs)) must not be unmounted, resized,
  written to, or closed when the settings tab opens, becomes active, becomes
  inactive, or closes.
- No source file may exceed 400 lines (AGENTS.md). A file that this plan
  substantially changes and that already exceeds the limit is split as a
  separate, behaviour-preserving refactor commit.
- Profile-specific overrides (`profiles[].config`) are out of scope for
  editing. The UI edits the base `config.<key>` only.
- Out of scope: plugin settings panels (roadmap 5.2.x), formal settings
  commands such as `settings.open` (5.1.2), the keybinding editor (4.2.2), the
  command dispatcher (4.1.1), and the tab model rewrite (6.1).
- Comments and documentation use en-GB Oxford spelling (`en-gb-oxendict`).
- Tests follow `docs/developers-guide.md` "Tests" and
  `docs/testing-with-bun.md`: no file-scope `mock.module`; inject timers,
  loggers, and file-system seams; use per-test temporary directories; call the
  `setupHappyDom()` cleanup in every component test; suites must pass under
  `bun test --concurrent --isolate`.
- `unicorn/no-null` is deliberately off (ADR 006) because explicit `null` is
  meaningful in config layering; do not "fix" `null` usages in config code.

## Tolerances (exception triggers)

- Scope: if implementation requires changes to more than 95 non-ExecPlan files
  or more than 8,000 net lines of code and other documentation, stop and
  escalate. This ExecPlan file is excluded from both counts. Generated Dafny
  artefacts (`*.dfy.gen`) are excluded from the line count but included in the
  file count. The estimate at approval time is about 85 files.
- Interface: if an existing plugin-facing hook in `lib/utils/plugins.ts`
  (`decorate*`, `getTabProps`, `getTabsProps`) must change its signature, stop
  and escalate. Adding optional fields (`tabType` on `ITab` and on the tab
  decoration context) is pre-approved.
- Dependencies: `fast-check` and `lemmascript` are pre-approved development
  dependencies (the task explicitly requires them). Any other new dependency,
  runtime or development, requires escalation.
- Proof tooling: if LemmaScript cannot express either proof target (EP-M0
  prototype) after two restructuring attempts, stop and present options rather
  than silently downgrading to property tests.
- Persistence: if the EP-M2 edit property suite or the EP-M3 writer suite
  still fails after three fix iterations, stop and escalate.
- Input routing: if the terminal-command gate (D1) cannot be implemented
  without changing `lib/command-registry.ts` public behaviour for terminal
  tabs, stop and escalate.
- Iterations: if any gate fails three times in a row for the same reason after
  attempted fixes, stop and escalate.
- Time: if a single milestone takes more than one working day of agent time,
  record progress and escalate.
- Ambiguity: if implementation evidence contradicts a decision in
  `Decision log`, stop and present the options.

## Risks

- Risk: plugins decorate tabs and may override the settings tab title or
  assume a term-group uid. Severity: low (plugin throws are caught and shown as
  notifications, `lib/utils/plugins.ts:690-704`). Likelihood: medium.
  Mitigation: pass `tabType` to plugin hooks and to the tab decoration context
  (additive); skip built-in tab decoration providers for the settings tab.
- Risk: the handwritten JSON5 scanner mishandles an edge case (duplicate
  keys, several properties on one line, a trailing same-line comment, CRLF),
  damaging the user's file. Severity: high. Likelihood: medium. Mitigation:
  property tests over generated documents and mutated handwritten fixtures; the
  writer re-parses every candidate and refuses to write unless the result
  equals the intended value and still loads; specific failure reasons for
  duplicate keys and non-object `config`.
- Risk: a write races with another writer and one update is lost.
  Severity: medium. Likelihood: low. Mitigation: every main-process
  read-modify-write runs as one synchronous critical section in
  `config-file-writer.ts`, so in-process writers cannot interleave; only an
  external editor saving the same key at the same instant can win.
- Risk: atomic replacement breaks symlinked configs (dotfile managers), widens
  file permissions, or fails on Windows when another process holds the file.
  Severity: high. Likelihood: medium. Mitigation: resolve the real path before
  writing, copy the file mode, fsync, bounded retry on `EBUSY`, `EPERM`, and
  `EACCES`, a recognizable temporary-file prefix swept at start-up, and a
  writer test suite that runs on every CI operating system.
- Risk: each write triggers a cascade (watcher reload in every window, a
  native "configuration reloaded" notification, a terminal refit) and a late
  watcher refresh overwrites a newer draft. Severity: medium. Likelihood: high.
  Mitigation: a monotonic snapshot revision, `applied` outcomes carrying the
  post-write snapshot, dirty-draft protection in the field state machine, and
  notification suppression for self-written content.
- Risk: LemmaScript is a tech preview (npm reports 0.6.5; the skill notes
  describe 0.5.x) and the proofs rot when nobody runs them. Severity: medium.
  Likelihood: medium. Mitigation: EP-M0 prototype; a Dafny-free freshness check
  in `make lint`; a Linux CI proof job; a documented rot policy.
- Risk: property suites slow the shared `make test` gate on four CI operating
  systems. Severity: low. Likelihood: medium. Mitigation: run counts come from
  `FAST_CHECK_NUM_RUNS` (default 200 in `make test`, 1,000 for milestone
  acceptance runs); model-based tests drive the pure reducer and effect runner
  without React.
- Risk: base-level edits have no visible effect when the default profile
  overrides the same key. Severity: medium. Likelihood: low. Mitigation: the
  snapshot reports profile-overridden keys and the UI shows a note on them.
- Risk: the deep E2E lane runs only on schedule, so PR CI will not exercise the
  settings E2E. Severity: low. Likelihood: high. Mitigation: unit-lane
  integration tests cover the real writer, real chokidar watcher, and real
  service in a temporary directory on every operating system; run the deep lane
  locally before closing EP-M6.

## Progress

- [x] (2026-10-29) Reconnaissance with a Wyvern agent team: design and PRD
  sections, config system, renderer UI, and tooling.
- [x] (2026-10-29) Prior-art research with Firecrawl: VS Code settings editor
  behaviour, LemmaScript toolchain, JSON5 comment preservation.
- [x] (2026-10-29) First draft of this ExecPlan.
- [x] (2026-10-29) Community-of-experts design review (structure and
  contracts; failure modes and cost; alternatives, viability, verification, and
  accessibility). Verdict: proceed with conditions.
- [x] (2026-10-29) Plan revised to address every review finding (see
  `Decision log` D1 to D19 and the revision note).
- [ ] User approval of the plan.
- [ ] EP-M0: proof and property tooling prototype and CI policy.
- [ ] EP-M1: settings domain core and proofs.
- [ ] EP-M2: JSON5 scanner relocation and comment-preserving edit operations.
- [ ] EP-M3: config file writer, settings service, and IPC.
- [ ] EP-M4: settings tab shell, tab strip, input gating, and navigation.
- [ ] EP-M5: editing, inline validation, and reset flows.
- [ ] EP-M6: end-to-end coverage.
- [ ] EP-M7: documentation, ADR, and roadmap closure.

## Surprises & discoveries

- Observation: the 3.1.2 layering (`app/config/layering.ts`) and reload
  handler (`app/config/reload-handler.ts`) are only used by tests; the live
  path still merges with `lodash/merge` in `app/config/init.ts`. Evidence: grep
  for `resolveConfigLayers` and `createReloadHandler` finds only
  `test/unit/config-layering.test.ts` and
  `test/unit/config-hot-reload.test.ts`. Impact: "modified" is computed from
  the user file directly; wiring the 3.1.2 modules into production is follow-up
  work.
- Observation: there is no write path for core settings. The only
  comment-preserving writer patches `config.plugins.<id>`, supports upsert but
  not removal, and the plugin runtime writes the file in place, unqueued
  (`app/runtime/plugin-runtime.ts:212-214`, `:260-264`). Impact: EP-M2 and
  EP-M3 introduce one writer and route the plugin runtime through it.
- Observation: any schema failure in the user file makes
  `loadUserConfig` (`app/config/import.ts:285-310`) replace the whole config,
  including plugins and keymaps, with defaults. Impact: the load-path schema
  must not be tightened (constraint above); the settings UI must treat a
  schema-invalid file specially (D15).
- Observation: `cfgPath` silently becomes the legacy `hyper.json` when
  `config.json5` is absent (`app/config/paths.ts:56-58`). Impact: D14.
- Observation: Mousetrap's `stopCallback` always returns false
  (`lib/containers/hyper.tsx:60-63`), and many keybindings (Ctrl+C, Home, End,
  Ctrl+Backspace, Ctrl+Shift+W) end in writes to, or closure of, the active
  session (`lib/bootstrap/renderer-bootstrap.ts:249-281`). Impact: D1 input
  gating.
- Observation: `display: none` on terminals would fire their
  `ResizeObserver` and refit the PTY (`lib/components/term.tsx:679-684`,
  `:1194-1199`); inactive groups are instead moved offscreen
  (`lib/components/terms.module.css:40-48`). Impact: D1 hiding technique.
- Observation: tab activation, `moveTo`, `moveLeft`, and `moveRight` all
  assume root term groups (`lib/actions/ui.ts:169-234`,
  `lib/containers/header.ts:44`, `lib/components/tab.tsx:36`), and
  `SESSION_ADD` changes `activeRootGroup`
  (`lib/reducers/term-groups.ts:251-266`). Impact: D1 tab-strip selector.
- Observation: `validateRawConfig` exists twice (`app/config/json5-config.ts`
  and an apparently dead zod variant in `shared/src/config/json5-config.ts`)
  and returns only the first issue. Impact: EP-M3 adds an all-issues validator
  in the `app/` module only.
- Observation: `app/runtime/plugin-runtime-json5-parser.ts` is 839 lines,
  above the 400-line limit, and `PropertyKey` is defined twice. Impact: EP-M2
  relocates and splits it.
- Observation: the roadmap cites design headings that do not exist verbatim;
  the relevant headings are "Settings tab and plugin settings panels"
  (`docs/velocetty-design.md` around line 1058) and
  `Roadmap 4. Settings tab + schema-driven plugin settings` (around line 2252).
  Impact: EP-M7 corrects the roadmap links.
- Observation: there is no `docs/users-guide.md` and no component
  architecture document. Impact: EP-M7 creates both.
- Observation: `fast-check` and LemmaScript are absent; Dafny 4.11.0 and
  .NET 8 are installed on the development host. Impact: EP-M0.

## Decision log

- Decision D1 (revised after review): host settings as a singleton pseudo-tab
  with the reserved uid `velocetty:settings`, with an explicit "active surface"
  model. Rationale and shape:
  1. A new `settingsTab` Redux slice holds `{isOpen, isActive, query,
     selectedCategory}` (query and category live here so 5.1.2's
     `settings.search` command can drive them).
  2. One selector, `selectTabStrip(state)`, returns the ordered tab strip
     (root term groups, then the settings tab when open) with exactly one
     active tab; terminal `isActive` is masked while the settings tab is
     active. The header and every tab-movement action (`moveTo`, `moveLeft`,
     `moveRight`) use it, and one action, `activateTab(uid)`, activates either
     kind.
  3. The settings slice deactivates on `SESSION_SET_ACTIVE`, on `SESSION_ADD`,
     and on term-group activation.
  4. While the settings surface is active, terminals are moved offscreen with
     the existing inactive-group technique and marked `inert`; they are never
     set to `display: none`, so no resize fires. Returning to a terminal
     restores focus explicitly.
  5. Input gating: while the settings surface is active, `execCommand` runs
     only commands on an explicit global allow-list (tab creation and
     movement, window commands, zoom, preferences, and similar); every other
     command is ignored without `preventDefault`, so typing, `Home`, `End`,
     and `Ctrl+C` behave natively in inputs and nothing reaches the hidden
     session. `pane:close` closes the settings tab instead.
  6. `SettingsContainer` stays mounted while the tab is open (hidden when
     inactive) and unmounts on close.
  Rationale: the design requires `tabType = "settings"` rather than a modal;
  term groups own the PTY lifecycle; the review showed that naive CSS hiding
  resizes PTYs and leaks keystrokes. A full tab model rewrite belongs to
  roadmap 6.1. Date/Author: 2026-10-29, planning agent after expert review.
- Decision D2 (revised): the existing `window:preferences` command opens the
  settings tab by sending a new renderer event, `settings open req` (matching
  the existing `* req` convention), to the focused window; when no window
  exists (the macOS menu can fire without one), it uses `app.createWindow` and
  sends the event once the window is ready. The previous behaviour stays
  reachable as a new main-process command `window:openConfigFile`, invoked by
  an "Open config file" button inside the settings tab. Rationale: the success
  criterion needs a user-reachable entry point; formal `settings.*` commands
  (5.1.2) depend on the unbuilt dispatcher (4.1.1). Date/Author: 2026-10-29.
- Decision D3 (revised): edits apply per field, immediately: toggles and
  selects on change; text, number, and colour fields on `Enter` or blur;
  `Escape` reverts the draft. Validation at write time is the existing lenient
  load schema plus a write policy of UI-only bounds per key (for example
  `fontSize` 6 to 100). A write is rejected without touching disk when any
  diagnostic path is at or below `/config/<key>`. On Windows, arrow keys on a
  closed `<select>` fire `change` per press; the resulting burst of writes is
  accepted and documented. Rationale: matches VS Code; the review showed that
  tightening the load schema could make existing files fall back to defaults
  wholesale. Date/Author: 2026-10-29.
- Decision D4: reset-to-default removes `config.<key>` from the file rather
  than writing the default value. "Modified" means "present in the user file's
  `config` object". A trailing same-line comment belongs to the removed
  property and is removed with it; comments on other lines are untouched.
  Rationale: future default changes reach the user, `@modified` is exact, and
  it mirrors VS Code's "Reset Setting". Date/Author: 2026-10-29.
- Decision D5 (revised): the UI renders a `SettingsPanelModel` (sections of
  fields, each with an opaque `SettingId`, a `ControlDescriptor`, and a label
  that is either a translation key or a literal). The core catalogue in
  `shared/src/settings/core-catalogue.ts` is one source of that model, using
  ids of the form `core:<key>`; 5.2.1 adds plugin schemas as a second source.
  Every key in `configOptions` must be in the core catalogue or in an explicit
  exclusion list with a reason (complex shapes: `colors`, `shellArgs`, `env`,
  `css`, `termCSS`, `profiles`, `defaultProfile`, `plugins`, `modifierKeys`,
  `windowSize`, and similar); an exhaustive parity test enforces this. The
  catalogue is one file and is split by category only if it passes 400 lines.
  Rationale: the intermediate model is cheap now and avoids reworking the
  search, field state, and IPC contracts for plugin panels. The schema
  annotation alternative (`x-ui` JSDoc tags) is recorded in ADR 007 for 5.2.1.
  Date/Author: 2026-10-29.
- Decision D6 (revised): search splits the normalized query on spaces, ignores
  empty tokens, treats the exact token `@modified` as a filter rather than a
  substring, and matches a field when every remaining token is a substring of
  its normalized searchable text (label, key, description, category label). The
  category list filters the results ("All settings" by default) and shows
  per-category match counts. Results preserve model order. Normalization
  (lower-casing, whitespace folding) happens outside the verified core.
  Date/Author: 2026-10-29.
- Decision D7 (revised): per-field edit state is driven by the pure
  `stepField` machine in `shared/src/settings/field-state.ts`, held in a
  ref-backed store read through `useSyncExternalStore`, with effects (writes,
  resets) run by an effect runner after each step, never inside a reducer.
  Rationale: React 19 StrictMode runs reducers twice in development, which
  would duplicate writes; `useReducer` cannot return effects to the caller.
  Date/Author: 2026-10-29.
- Decision D8 (revised): extract a small `createTranslator(dictionaries)`
  helper from `lib/hooks/use-translation.ts` and reuse it for a settings
  dictionary in `lib/settings/i18n/`. Settings strings ship in `en` only. The
  label dictionary is typed `Record<CoreSettingKey, string>`, so a missing
  label is a compile error. User-facing descriptions are written in the
  dictionary rather than taken from the schema (whose JSDoc descriptions are
  developer notes). The tab title is translated in `HeaderWithTranslation`,
  because selectors cannot call hooks. Rationale: avoids an unapproved
  `react-i18next` dependency and a third handwritten translation copy.
  Date/Author: 2026-10-29.
- Decision D9 (revised): formal proof (LemmaScript, Dafny backend) covers the
  per-field state machine (well-formedness, stale-outcome rejection, no stuck
  saving state, no clobbering of dirty drafts, and that a write carries the
  submitted value) and the composed search (query parsing with `@modified` plus
  filtering: soundness, completeness, order). `fast-check` covers JSON5 edits,
  input coercion (float-sensitive, outside LemmaScript's integer model), search
  metamorphic properties, a convergence model test against the real settings
  service over an in-memory file, and a concurrent-writer property.
  Date/Author: 2026-10-29.
- Decision D10: pin `lemmascript` to an exact version (the version validated
  in EP-M0) and add `fast-check` with a caret range. Rationale: LemmaScript is
  a tech preview whose generated artefacts change between versions, and the
  committed `.dfy` files must stay in step with the generator; this is the
  documented justification AGENTS.md requires for a non-caret range.
  Date/Author: 2026-10-29.
- Decision D11: proof continuous integration (CI) policy, decided now:
  `make lint` gains a Dafny-free freshness check (`lsc gen` into a temporary
  directory, diffed against the committed `.dfy.gen` files); a new Linux-only
  workflow, `.github/workflows/proofs.yml`, installs Dafny 4.11 with
  `dotnet tool install` (cached) and runs `make proofs` on pull requests that
  touch `shared/src/settings/**` or `*.dfy*`. It starts advisory and becomes
  required after two green weeks (owner: repository maintainer). Rot policy: if
  a regeneration merge fails, the pull request author regenerates and repairs
  the proof or files an issue; `//@ assume` is never an acceptable fix.
  Date/Author: 2026-10-29.
- Decision D12 (revised): the main process accepts writes only for keys in an
  explicit allow-list with per-key write bounds,
  `app/settings/settings-write-policy.ts`, kept in step with the core catalogue
  by a parity test (tests may import both `app/` and `shared/`). Rationale: a
  correctness guard, not a security boundary; the renderer already reaches
  `child_process.exec` over IPC. Date/Author: 2026-10-29.
- Decision D13 (new): one writer module, `app/config/config-file-writer.ts`,
  owns every main-process read-modify-write of the config file. Each attempt is
  one synchronous critical section: resolve the real path (following symlinks),
  read fresh, refuse unless the root and `config` are objects, apply the edit,
  re-parse and compare with the intended value, confirm the result still loads
  (`safeParseRawConfig`), validate, write a sibling temporary file with the
  original mode, fsync, rename over the real path, and fsync the directory (not
  on Windows). `EBUSY`, `EPERM`, and `EACCES` trigger up to three asynchronous
  retries with backoff, each re-running the whole critical section. Temporary
  files use the prefix `.velocetty-config-write-` and are swept at start-up.
  The plugin runtime's writes are routed through it in the same change. The
  writer never creates a missing file. Date/Author: 2026-10-29.
- Decision D14 (new): when the active config file is the legacy `hyper.json`,
  the settings tab is read-only with a banner explaining why and offering to
  open the file; the snapshot carries the real file path, which every message
  and button uses. Rationale: emitting JSON5 syntax into a `.json` file would
  break other tools. Date/Author: 2026-10-29.
- Decision D15 (new): when the user file parses but fails schema validation
  (so the app is running on defaults), the snapshot reports
  `fileStatus: invalid` with all diagnostics. Catalogue rows with a diagnostic
  show it inline and allow fix or reset; other rows are disabled with an
  explanation; diagnostics on excluded keys appear in a banner with the
  open-file action. The service enforces the same rule
  (`failed: user-config-invalid` for other keys). Date/Author: 2026-10-29.
- Decision D16 (new): every snapshot carries a monotonic `revision` from the
  main process; `applied` outcomes return the post-write snapshot; the editor
  ignores snapshots older than the newest it has seen. The writer records a
  hash of the text it wrote and the watcher in `app/config.ts` suppresses the
  "configuration reloaded" notification when the reloaded text matches. The
  watcher uses a trailing debounce and also listens for `add` (rename-based
  replacement). Date/Author: 2026-10-29.
- Decision D17 (new): the settings protocol types (`SettingsSnapshot`,
  `SettingsWriteOutcome`, `SettingTarget`) live in
  `shared/src/settings/protocol.ts` and are imported with `import type` by
  `IpcCommands` and the main process. The driven port `SettingsGateway` lives in
  `lib/settings/ports.ts`, owned by the renderer hook. Write calls take no
  `AbortSignal`, because IPC invocations cannot be cancelled and a renderer
  abort would misreport a write the main process still performs. The gateway
  exposes `subscribe(onChanged)` so the hook never touches `ipcRenderer`.
  Renderer and main ship in one build, so the protocol needs no versioning.
  Date/Author: 2026-10-29.
- Decision D18: record D1 to D4, D12 to D17, and the rejected alternatives in a
  new ADR, `docs/adr-007-settings-tab-hosting-and-persistence.md`, referenced
  from the design document. Date/Author: 2026-10-29.
- Decision D19: the plan is delivered on one branch with frequent commits.
  If the reviewer prefers, it can be split at plateau boundaries into a stack
  of pull requests (EP-M0 to EP-M2, EP-M3, EP-M4 to EP-M6, EP-M7) without
  changing the plan. Date/Author: 2026-10-29.

## Outcomes & retrospective

Not started. To be completed at each milestone boundary and at the end. Known
follow-up candidates already identified: wiring
`resolveConfigLayers`/`createReloadHandler` into the production load path;
per-key graceful degradation in `loadUserConfig` instead of whole-file
fallback; per-key `docHint`/`defaultHint` diagnostics; editors for excluded
structured keys; profile-level editing; translated descriptions; migration from
legacy `hyper.json`.

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
- The user file is `config.json5` (or legacy `hyper.json`) in the config
  directory resolved by `app/config/paths.ts` (`cfgPath`).
- `app/config/json5-config.ts` parses JSON5 and validates with Ajv, producing
  diagnostics of type `configValidationDiagnostic`
  (`{path, message, suggestedFix, docHint?, defaultHint?}`), where `path` is a
  JSON Pointer such as `/config/fontSize`.
- `app/config.ts` loads config at start-up, watches the file with chokidar
  3.6, and notifies subscribers; `app/ui/window.ts` sends a payload-free
  `config change` event to each renderer, which re-reads config. A schema
  failure anywhere makes the whole file fall back to defaults
  (`app/config/import.ts`).
- `shared/src/constants/config-reloadability.ts` classifies every key as
  `live` or `restart`. `lib/hooks/use-config-reloadability.ts` and
  `lib/components/restart-required-indicator.tsx` provide the restart indicator
  UI the settings tab must use.
- `app/runtime/plugin-runtime-json5-parser.ts` is a handwritten JSON5 scanner
  that reports property offsets;
  `app/runtime/plugin-runtime-json5-roundtrip.ts` uses it to upsert
  `config.plugins.<id>` without disturbing comments;
  `app/runtime/plugin-runtime.ts` writes the result with `writeFileSync`.

Renderer:

- `lib/containers/hyper.tsx` renders the header (tab strip) and
  `TermsContainer`, and configures Mousetrap so keybindings fire even inside
  inputs. Tabs are derived: `getTabs` in `lib/containers/header.ts` maps root
  term groups to `ITab` objects (`typings/hyper.d.ts`). `changeTab`/`closeTab`
  in `lib/actions/header.ts` and `moveTo`/`moveLeft`/`moveRight` in
  `lib/actions/ui.ts` assume term-group uids.
- Redux slices are combined in `lib/reducers/index.ts` (`ui`, `sessions`,
  `termGroups`).
- Components use CSS Modules (`*.module.css`) and the custom properties in
  `lib/tailwind.css`. There is no component library. Inactive term groups are
  moved offscreen (`lib/components/terms.module.css`), and visibility is
  tracked with an IntersectionObserver (roadmap 2.1.1).
- Translation is a handwritten hook, `lib/hooks/use-translation.ts`.
- Renderer-to-main calls go through `RendererCommandTransport`
  (`shared/src/types/transport.ts`, implemented in `lib/transport/`) typed by
  `IpcCommands` in `shared/src/types/common.ts`; responses are validated with
  zod schemas in `lib/transport/ipc-schemas.ts` (`z.json()` is already used for
  JSON values). Main-to-renderer events are typed by `RendererEvents` and
  registered in `lib/bootstrap/renderer-bootstrap.ts`. `app/clipboard.ts` is
  the precedent for a port plus IPC handler module; it is registered at the top
  level of `app/start.ts`.
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
  both requiring a packaged build. The helpers isolate `XDG_CONFIG_HOME`.

Terms used in this plan:

- Catalogue: the curated list of core settings the UI can edit, with category
  and control descriptors.
- Panel model: the UI-facing structure (sections, fields, controls, labels)
  that the catalogue produces and that plugin schemas will produce later.
- Snapshot: the main process's answer to "what are the current values?",
  containing user values, defaults, profile-override keys, file status,
  diagnostics, file path, and a revision number.
- Gateway: the renderer-side port through which the settings editor reads
  snapshots, requests writes, and subscribes to changes.
- Coercion: turning raw input text into a typed value (for example `"14"` to
  `14`) and rejecting malformed input before any write is requested.
- Field state machine: the pure function that moves one field between
  phases in response to edits, submissions, resets, refreshes, and write
  outcomes.
- Active surface: whichever of the settings view or the active terminal group
  is currently shown and receives input.

## Conformance basis

Upstream artefacts (revisions as of commit `40949b2f` on `main`):

- Roadmap `docs/roadmap.md` item 5.1.1 (RM-5.1.1), requiring 3.1.1 (done).
- Product requirements `docs/velocetty-product-requirements-document.md`
  §"4) Settings tab + plugin settings panels": PRD-SET-1 "Settings UI shell
  with search, categories, validation, reset-to-default"; PRD-SET-2 settings
  actions must become commands (deferred to 5.1.2, prepared by D1 and D2).
- Technical design `docs/velocetty-design.md` §"Settings tab and plugin
  settings panels": TDD-SET-TAB "settings are a tab type
  (`tabType = "settings"`), not a modal"; §"Schema-driven settings panels":
  TDD-SET-PANEL (prepared by D5); §"Hot reload": TDD-HR-UI "the settings UI
  should surface which settings require restart"; §"Validation and error
  reporting": TDD-VAL "structured diagnostics with JSON Pointer paths" and
  "keep last-known-good config"; context keys `settingsOpen` and `tabType`
  (TDD-CTX-SET).
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
RM-5.1.1/PRD-SET-1 (categories) -> TDD-SET-TAB, TDD-SET-PANEL -> D1, D5 -> EP-M1, EP-M4
  evidence: settings-catalogue-parity.test.ts, settings-tab-shell-behaviour.test.tsx
RM-5.1.1/PRD-SET-1 (search) -> D6 -> EP-M1, EP-M4
  evidence: search.ts proof, settings-search.property.test.ts
RM-5.1.1/PRD-SET-1 (reset) -> D4, D13 -> EP-M2, EP-M3, EP-M5
  evidence: json5-document-edit.property.test.ts, settings-service-behaviour.test.ts
RM-5.1.1 (inline validation) -> TDD-VAL, D3, D15 -> EP-M1, EP-M3, EP-M5
  evidence: field-state.ts proof, settings-editing-behaviour.test.tsx
RM-5.1.1 (editable and validated) -> DG-CFG-RT, D13, D16 -> EP-M2, EP-M3, EP-M6
  evidence: settings-convergence.property.test.ts, settings-tab.e2e.ts
TDD-SET-TAB (no side effects) -> D1 -> EP-M4
  evidence: settings-tab-input-gating.test.ts, settings-tab-strip.test.ts
TDD-HR-UI/DG-SET-UI -> EP-M5
  evidence: settings-editing-behaviour.test.tsx (restart warning scenario)
TDD-CTX-SET -> D1 -> EP-M4
  evidence: settings-tab-slice.test.ts (settingsOpen/tabType derivation)
PRD-SET-2 -> D1, D2 (deferred to 5.1.2) -> EP-M4
  evidence: preferences-opens-settings.test.ts
```

## Verification plan

The implementation is structured so that the riskiest logic is pure and
isolated: search and the field state machine in `shared/src/settings/`, text
editing in `app/config/json5/`, and the write algorithm in
`app/config/config-file-writer.ts` behind an injected file-system port.
Rendering, IPC, and Electron are thin adapters around them.

Axioms (trusted, not verified):

- AXIOM-AJV: Ajv correctly validates instances against the generated JSON
  Schema.
- AXIOM-JSON5: `JSON5.parse` from the `json5` package correctly parses JSON5;
  it is the oracle for every edit property.
- AXIOM-IPC-ORDER: Electron delivers `ipcRenderer.invoke` calls from one
  renderer to `ipcMain.handle` in send order, and JSON values survive
  structured clone.
- AXIOM-FS: on one file system, `rename` replaces the target atomically after
  `fsync`; on Windows, a held file can make it fail with `EBUSY` or `EPERM`
  (handled by retry, not assumed away). Exercised by
  `test/unit/config-file-writer-fs.test.ts` on every CI operating system.
- AXIOM-WATCH: chokidar 3.6 reports a rename-based replacement as `change` or
  `add` within the debounce window. Exercised by
  `test/unit/config-watch-integration.test.ts` with a real watcher.
- AXIOM-NODE-SINGLE-THREAD: synchronous code in the main process runs to
  completion without interleaving with other main-process JavaScript, which is
  what makes the writer's critical section exclusive.
- AXIOM-LS-MODEL: LemmaScript's Dafny translation is faithful for the
  fragment used (strings, `split`, `includes`, arrays, records, string-literal
  and discriminated unions, integers). Case folding happens outside the
  verified functions, so its Unicode behaviour is not part of the proved model.
- AXIOM-REACT: `useSyncExternalStore` re-renders after store notifications
  and reads the latest snapshot.

Obligations:

- Obligation INV-SEARCH-SOUND: every field returned by `searchFieldIndices`
  satisfies the query semantics of D6 (every non-empty, non-`@modified` token
  is a substring of its haystack; it is modified when `@modified` is present;
  it is in the selected category unless the selection is "all"). Method: formal
  proof (LemmaScript, Dafny backend) plus mirrored `fast-check` property.
  Rationale: wrong filtering silently hides settings, and the composed
  parse-and-filter is pure string and array logic inside the supported
  fragment. Domain: all query strings, all haystack arrays, all modified-flag
  and category arrays of equal length, all selections. Artefact:
  `shared/src/settings/search.ts` (annotated), `shared/src/settings/search.dfy`,
  `test/unit/settings-search.property.test.ts`. Evidence: `make proofs`
  reports the module verified with zero errors; the property test passes.
  Non-vacuity: equal-length witnesses (empty, singleton, mixed) are recorded as
  Dafny lemmas; seeded mutations "treat `@modified` as an ordinary substring"
  and "replace `every` with `some`" must each make Dafny report a failing
  postcondition and the property test produce a counterexample; generator
  classification must show at least 20% of runs with a non-empty result and at
  least 20% with an excluded element.
- Obligation INV-SEARCH-COMPLETE: every field that satisfies the query
  semantics is returned. Same method and artefacts. Non-vacuity: seeded
  mutation "stop after the first match" must be rejected.
- Obligation INV-SEARCH-ORDER: returned indices are strictly increasing
  (model order, no duplicates). Same method. Non-vacuity: seeded mutation
  "prepend rather than append" must be rejected.
- Obligation PROP-SEARCH-METAMORPHIC: results for the query `a b` equal the
  intersection of results for `a` and for `b`; adding or removing spaces
  between tokens does not change results; per-category counts sum to the "All
  settings" count; `@modified` never matches as a substring. Method:
  `fast-check` (these relate normalization, tokenizing, and counting, which sit
  partly outside the proof). Artefact:
  `test/unit/settings-search.property.test.ts`. Non-vacuity: seeded mutation
  "split on a single space without dropping empty tokens" must fail the
  whitespace property.
- Obligation INV-FIELD-WF: for every field state `s` and event `e`, if
  `wellFormed(s)` then `wellFormed(stepField(s, e).state)`, where `wellFormed`
  means: phase `saving` if and only if a pending request id exists; any pending
  id is less than `nextRequestId`; `nextRequestId` never decreases; `errors` is
  non-empty exactly in phases `invalid`, `rejected`, and `failed`. Events with
  empty error lists are given a fallback reason code by the machine itself, not
  assumed away by a `requires`. Method: formal proof plus model-based test.
  Artefact: `shared/src/settings/field-state.ts`,
  `shared/src/settings/field-state.dfy`,
  `test/unit/settings-field-state.property.test.ts`. Non-vacuity: witnesses for
  each phase constructed in the `.dfy` file; seeded mutation "leave the pending
  id set after an `applied` outcome" must be rejected.
- Obligation INV-FIELD-STALE: an outcome whose request id differs from the
  pending id leaves the state unchanged and emits no effect. Method: proof plus
  model-based test in which the fake gateway resolves requests in a generated
  permutation. Non-vacuity: at least 10% of runs classified as out-of-order;
  seeded mutation "accept any outcome while saving" must be rejected by both.
- Obligation INV-FIELD-NO-STUCK: from every `saving` state, the outcome
  carrying the pending id (any result) leads to a non-`saving` phase. Method:
  proof. Non-vacuity: seeded mutation "stay in saving after `failed`" must be
  rejected.
- Obligation INV-FIELD-NO-CLOBBER: a `refresh` event updates the committed
  value and replaces the draft only when the field is clean (not dirty and no
  request pending); a dirty or saving field keeps its draft. Method: proof plus
  model-based test. Non-vacuity: seeded mutation "always replace the draft on
  refresh" must be rejected; the model test classifies at least 10% of runs
  with a refresh arriving while dirty.
- Obligation INV-FIELD-WRITE-VALUE: `stepField` emits a `write` effect only
  for a `submit` event carrying a successful coercion, and the effect carries
  exactly that coerced value and the new pending id; a `reset` event emits a
  `reset` effect with the new pending id. The value is a type parameter, so the
  proof is generic over values. Method: proof; the end-to-end pairing (sent
  value equals the coercion of the draft at submit time) is covered by
  PROP-CONVERGE. Non-vacuity: seeded mutation "emit the previous draft's value"
  must be rejected.
- Obligation PROP-CONVERGE: for any generated sequence of user actions (edit,
  submit, reset, external file change) on a few fields, with the real
  `createSettingsService` over an in-memory file port and a gateway that delays
  and reorders responses, after all responses settle the file's value for each
  field equals the last successfully coerced submission (or is absent after a
  final reset), and the field displays that value with no error. Method:
  `fast-check` model-based test driving the pure field store and effect runner
  without React. Artefact: `test/unit/settings-convergence.property.test.ts`.
  Non-vacuity: classify runs with reordering, with rejections, and with
  external changes (each at least 10%); seeded mutation "drop the revision
  check" must fail.
- Obligation INV-COERCE: for each control kind, `coerceInput` accepts exactly
  the inputs that represent a value admitted by the control descriptor, and
  `coerceInput(formatValue(v))` returns `v` for every admitted `v`. Method:
  `fast-check` plus a parameterized boundary table (minimum, maximum, just
  outside, empty, whitespace, `NaN`, `Infinity`, exponent notation, leading
  `+`, hex and `rgba(...)` colours). Artefact:
  `test/unit/settings-coerce.property.test.ts`. Non-vacuity: admitted and
  rejected inputs each at least 25% of runs; seeded mutation "use
  `Number.parseFloat`" (accepts `"12abc"`) must be rejected by the table.
- Obligation INV-EDIT-SET: for every JSON5 document `d` and every key path
  `p` under `config` and JSON value `v`,
  `JSON5.parse(setPropertyAtPath(d, p, v))` deep-equals
  `setIn(JSON5.parse(d), p, v)`. Domain: documents from two sources: generated
  trees printed with randomized styles (comments, trailing commas, quoted and
  unquoted keys, LF or CRLF, BOM, several properties per line), and generated
  mutations of handwritten fixtures in `test/fixtures/json5-config/` (comments
  between key and colon, trailing same-line comments, blank lines, odd
  indentation). Method: `fast-check`. Artefact:
  `test/unit/json5-document-edit.property.test.ts`.
- Obligation INV-EDIT-REMOVE: likewise,
  `JSON5.parse(removePropertyAtPath(d, p))` deep-equals
  `deleteIn(JSON5.parse(d), p)`, for first, middle, last, and only properties.
- Obligation INV-EDIT-LOCALITY: every comment outside the edited property's
  span (as defined in D4) appears byte-for-byte in the output; text before the
  span is unchanged; inserted line breaks match the document's line ending
  style. Non-vacuity for all edit obligations: classification shows each
  position and both line-ending styles in at least 10% of runs; seeded
  mutations "ignore the trailing comma", "remove the next line's comment", and
  "insert LF into a CRLF file" must each produce a counterexample.
- Obligation INV-EDIT-REFUSE: when the document has a duplicate key on the
  edited path, or `config` is not an object, the edit returns a specific refusal
  (`duplicate-key`, `config-not-object`) and never a document. Method:
  parameterized tests plus a generator that injects duplicates.
- Obligation LEM-WRITER-SAFE: `writeConfigEdit` never writes when the current
  file fails to parse, when the edit is refused, when the re-parsed result
  differs from the intended value, when the result would no longer load, when
  the write policy or schema yields a diagnostic at or below the edited key, or
  when D14 or D15 forbid the write; and when it writes, the target keeps its
  mode and a symlinked target remains a symlink to the updated file. Method:
  parameterized behavioural tests over an in-memory file port plus a
  `fast-check` property over generated invalid values; real-file-system cases in
  `test/unit/config-file-writer-fs.test.ts` (symlink and mode cases skipped on
  Windows when unprivileged). Non-vacuity: the suite includes accepted writes,
  proving the port double records writes; seeded mutation "write before
  validating" must fail the property.
- Obligation PROP-WRITER-EXCLUSIVE: for any interleaving of settings writes and
  plugin-runtime writes issued in one process, every write's change is present
  in the final file. Method: `fast-check` scheduler (`fc.scheduler`) over the
  writer with an in-memory file port. Non-vacuity: seeded mutation "await
  between read and write" must lose an update and fail.
- Obligation INV-CATALOGUE-PARITY: every property of the `configOptions`
  schema appears exactly once in the catalogue or the exclusion list; every
  control matches the schema type (enum options equal the schema enum; number
  controls only for numeric types; integer flag matches `type: integer`); every
  write-policy entry matches a catalogue entry and vice versa; every category
  is non-empty. Method: exhaustive test over the finite schema. Artefact:
  `test/unit/settings-catalogue-parity.test.ts`. Non-vacuity: the test asserts
  the schema has more than 30 properties before checking parity.
- Obligation INV-TAB-STRIP: across the transitions open, activate settings,
  activate a terminal tab, add a session, move left, move right, move to index,
  close settings, and close the last terminal tab, the strip has exactly one
  active tab, the visible surface matches it, and no transition removes a term
  group or session. Method: parameterized transition table. Artefact:
  `test/unit/settings-tab-strip.test.ts`.
- Obligation INV-TAB-INPUT: while the settings surface is active, no command
  outside the global allow-list reaches a session (no `sendSessionData`, no
  `exitActiveTermGroup`), and such commands do not call `preventDefault`.
  Method: parameterized test over every command in the platform keymaps.
  Artefact: `test/unit/settings-tab-input-gating.test.ts`. Non-vacuity: the
  same table, with the terminal surface active, shows those commands do reach
  the session.
- Obligation INV-TAB-NO-RESIZE: activating and deactivating the settings
  surface never calls the terminal's fit or resize path. Method: component test
  with an injected resize spy. Artefact:
  `test/unit/settings-tab-terminal-preservation.test.tsx`.

Proof hygiene: no `//@ assume` is permitted in the proof files; any
`//@ extern` must be listed in ADR 007 and the architecture document as a
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
build surface"). Milestone acceptance additionally reruns the property suites
with `FAST_CHECK_NUM_RUNS=1000`. Every change follows Red-Green-Refactor: write
the failing test, run it and record the failure, make it pass with the smallest
change, then refactor and rerun.

### EP-M0: proof and property tooling prototype and CI policy (prototyping)

Add `fast-check` (caret) and `lemmascript` (exact pin) as development
dependencies with `bun add -d`. Add `test/testUtils/fast-check-runs.ts`
exporting the run count from `FAST_CHECK_NUM_RUNS` (default 200). Create
`LemmaScript-files.txt` at the repository root, a `proofs` target in the
`Makefile` that runs `bunx lsc check --backend=dafny` over every listed file,
and a `proofs-fresh` target (regenerate `.dfy.gen` into a temporary directory
and diff) invoked by `make lint`. Write one throwaway annotated function,
`shared/src/settings/prototype-proof.ts`, using the constructs the real proofs
need: `split(' ')`, string `includes`, a `for` loop with invariants, a
discriminated union, a record type, and a generic type parameter carried
through a record. Run `lsc gen` and `lsc check`. Confirm that Biome, Oxlint,
the boundary checker, `make spelling`, and `tsgo` accept the generated files
(add ignore entries for `*.dfy` and `*.dfy.gen` where needed). Add
`.github/workflows/proofs.yml` per D11 and confirm `actionlint` passes. Write
one trivial `fast-check` property and confirm it runs under
`--concurrent --isolate`.

Keep-or-discard criteria: keep if `make proofs` verifies the prototype in under
60 seconds, `make proofs-fresh` detects a hand-edited `.dfy.gen`, and every
other gate is clean; then delete the prototype and its artefacts (keeping the
tooling). Discard and escalate if LemmaScript cannot handle the constructs
after two restructuring attempts.

### EP-M1: settings domain core and proofs

All files in `shared/src/settings/`, all pure.

1. `panel-model.ts`: `SettingId` (branded string), `SettingCategoryId`,
   `ControlDescriptor` (discriminated union: `toggle`; `select` with `options`;
   `number` with `minimum`, `maximum`, `step`, `isInteger`; `text`; `colour`),
   `FieldLabel` (`{kind: 'key'; key}` or `{kind: 'literal'; text}`),
   `PanelField`, `PanelSection`, and `SettingsPanelModel`.
2. `core-catalogue.ts`: `CoreSettingKey`, `CORE_SETTINGS_CATALOGUE` in display
   order, `EXCLUDED_CONFIG_KEYS` (key to reason), and `buildCorePanelModel()`.
3. `search.ts`: the verified
   `searchFieldIndices(query, haystacks, modifiedFlags, categoryIndices, selectedCategory)`
   (query parsing with `@modified` plus filtering) and the unverified
   `normalizeSearchText(text)`.
4. `coerce.ts`: `coerceInput(control, raw)` returning
   `{ok: true, value} | {ok: false, reason}` with a discriminated reason
   (`'empty' | 'not-a-number' | 'not-an-integer' | 'below-minimum' |
   'above-maximum' | 'not-an-option' | 'not-a-colour'`)
   carrying bounds for messages; `formatValue(control, value)`. Colours accept
   `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, and `rgba(...)` strings.
5. `field-state.ts`: `FieldState<V>`, `FieldEvent<V>`, `FieldEffect<V>`,
   `stepField`, and `wellFormed`.
6. `protocol.ts`: `SettingTarget` (`{scope: 'core'; key: CoreSettingKey}`),
   `SettingsSnapshot`, and `SettingsWriteOutcome` (types only).

Tests (red first): `test/unit/settings-catalogue-parity.test.ts` (catalogue
half; the write-policy half lands in EP-M3),
`test/unit/settings-search.test.ts` (named examples),
`test/unit/settings-search.property.test.ts`,
`test/unit/settings-coerce.test.ts` (boundary table),
`test/unit/settings-coerce.property.test.ts`,
`test/unit/settings-field-state.test.ts` (transition table), and
`test/unit/settings-field-state.property.test.ts`. Proofs: annotate `search.ts`
and `field-state.ts`, list them in `LemmaScript-files.txt`, run `lsc gen`, add
helper lemmas and non-vacuity witnesses in the `.dfy` files, and run each
seeded mutation listed in `Verification plan`, recording each Dafny rejection in
`Artefacts and notes` before reverting the mutation.

### EP-M2: JSON5 scanner relocation and comment-preserving edit operations

1. Refactor commit (behaviour-preserving): move
   `app/runtime/plugin-runtime-json5-parser.ts` to `app/config/json5/` and
   split it into modules under 400 lines (for example `lexer.ts`,
   `object-scanner.ts`, `parser.ts`), merging the duplicate `PropertyKey`
   types. Update imports in the same commit. Existing suites
   (`test/unit/plugin-runtime-json5-parser-roundtrip.test.ts`,
   `test/unit/runtime-plugin-settings.test.ts`) must pass unchanged.
2. Create `app/config/json5/document-edit.ts` with the generic parts of
   `plugin-runtime-json5-roundtrip.ts` and the new `setPropertyAtPath` and
   `removePropertyAtPath`. Removal deletes the key, value, separating comma
   (the preceding comma when removing the last property), any trailing
   same-line comment, and the whole line when the property occupied its own
   line. Inserted line breaks follow the document's line-ending style. Both
   functions return a discriminated result:
   `{kind: 'edited'; doc} | {kind: 'refused'; reason: 'path-not-found' |
   'duplicate-key' | 'config-not-object'}`.
3. Rewrite `applyPluginSettingsPatches` on top of `setPropertyAtPath`, updating
   callers in the same change (no compatibility shim).
4. Add `test/testUtils/json5-document-arbitrary.ts` (tree-printing generator
   and fixture mutator) and fixtures in `test/fixtures/json5-config/`.

Tests: `test/unit/json5-document-edit.test.ts` (named examples) and
`test/unit/json5-document-edit.property.test.ts`.

### EP-M3: config file writer, settings service, and IPC

1. `app/config/json5-config.ts`: export
   `validateConfigOptions(value): configValidationDiagnostic[]` returning all
   Ajv issues with `/config`-prefixed paths. `validateRawConfig` and the load
   path are unchanged; no schema constraints are added.
2. `app/settings/settings-write-policy.ts`: the editable-key allow-list with
   per-key write bounds, and `checkWritePolicy(key, value)` returning
   diagnostics in the same shape.
3. `app/config/config-file-writer.ts`: `createConfigFileWriter(deps)`
   implementing D13, where `deps` holds a synchronous file-system port
   (`realpath`, `read`, `stat`, `writeTemp`, `fsync`, `rename`, `unlink`,
   `list`), `sleep` for retry backoff, and a logger. It exposes
   `writeConfigEdit(edit, guard)` returning
   `{kind: 'written'; text; revision} | {kind: 'refused'; reason; diagnostics?}`,
   `sweepTemporaryFiles()`, and `lastWrittenTextHash()`. Route
   `app/runtime/plugin-runtime.ts` writes through it in the same change. Add
   `app/config/node-config-file-port.ts`, the Node adapter.
4. `app/settings/settings-service.ts`: `createSettingsService(deps)` with
   `getSnapshot()`, `setValue(target, value)`, and `resetValue(target)`,
   implementing D14 and D15 and building snapshots (user values, defaults,
   profile-overridden keys for the default profile, file status, diagnostics,
   real file path, monotonic revision).
5. `app/config.ts`: trailing debounce, `add` handling, revision increment on
   reload, and notification suppression when the reloaded text hash equals the
   writer's last written hash (D16); call `sweepTemporaryFiles()` in `setup()`.
6. `app/settings/settings-ipc.ts`: `registerSettingsIpcHandlers(service)` for
   `settings:getSnapshot`, `settings:setValue`, and `settings:resetValue`,
   following `app/clipboard.ts`; register it at the top level of `app/start.ts`
   beside `registerClipboardIpcHandlers()`.
7. Extend `IpcCommands` in `shared/src/types/common.ts` and add zod response
   schemas (using `z.json()`) in `lib/transport/ipc-schemas.ts`; extend
   `test/unit/ipc-schemas.test.ts`.

Tests: `test/unit/config-file-writer.test.ts` (in-memory port, including
PROP-WRITER-EXCLUSIVE), `test/unit/config-file-writer-fs.test.ts` (per-test
temporary directory, symlink, mode, read-only, and retry cases),
`test/unit/config-watch-integration.test.ts` (real chokidar: one reload per
write, notification suppressed for self-writes),
`test/unit/settings-service-behaviour.test.ts` (scenarios below, including
legacy and invalid-file cases), `test/unit/settings-catalogue-parity.test.ts`
(write-policy half), and a load-path regression test asserting that a corpus of
plausible user configs (fractional `fontSize`, `lineHeight: 0.95`, negative
`letterSpacing`) still loads without fallback.

### EP-M4: settings tab shell, tab strip, input gating, and navigation

1. `shared/src/constants/settings-tab.ts`: `SETTINGS_TAB_UID` and action types
   (`SETTINGS_TAB_OPEN`, `SETTINGS_TAB_CLOSE`, `SETTINGS_TAB_ACTIVATE`,
   `SETTINGS_QUERY_SET`, `SETTINGS_CATEGORY_SELECT`).
2. `lib/reducers/settings-tab.ts`: the slice (D1 items 1 and 3); register it
   in `lib/reducers/index.ts` and the `HyperState` typings.
3. `lib/selectors/tab-strip.ts`: `selectTabStrip` and `selectActiveSurface`.
   `lib/actions/tab-strip.ts`: `activateTab(uid)`, `openSettingsTab()`, and
   `closeSettingsTab()`. Rework `changeTab`, `closeTab`, `moveTo`, `moveLeft`,
   and `moveRight` to use the strip; update `getTabs` in
   `lib/containers/header.ts` to use `selectTabStrip`. Add optional
   `tabType?: 'terminal' | 'settings'` to `ITab` and the tab decoration
   context; skip built-in decoration providers for the settings tab.
4. Input gating: `lib/settings/surface-command-gate.ts` with the global
   allow-list; `execCommand` in `lib/actions/ui.ts` consults it, and
   `pane:close` closes the settings tab when the settings surface is active.
5. `lib/containers/hyper.tsx`: render `SettingsContainer` beside
   `TermsContainer`; when the settings surface is active, apply the offscreen
   class and `inert` to the terms container; restore terminal focus on return.
6. Main process: `app/commands.ts` changes `window:preferences` per D2 and adds
   `window:openConfigFile`. Add `settings open req` to `RendererEvents` and
   register it in `lib/bootstrap/renderer-bootstrap.ts`.
7. `lib/settings/ports.ts` (`SettingsGateway`),
   `lib/settings/adapters/transport-settings-gateway.ts`, and
   `lib/settings/i18n/` (dictionary plus `useSettingsTranslation`, using the
   extracted `lib/i18n/create-translator.ts`).
8. `lib/settings/components/settings-view.tsx` (pure): title, search box
   (`role="searchbox"`, labelled, focused on open), category navigation (`nav`
   list of buttons with `aria-current` and match counts), results region
   (labelled), empty-results message with a "Clear search and category" button,
   one polite live region for result counts and status messages, the
   file-status banner slot, and the "Open config file" button. Rows are
   read-only at this milestone.
9. `lib/settings/hooks/use-settings-editor.ts`: loads snapshots through the
   gateway (with an `AbortController` per load), subscribes to changes, ignores
   older revisions, and runs search through the domain core.

Tests: `test/unit/settings-tab-slice.test.ts`,
`test/unit/settings-tab-strip.test.ts`,
`test/unit/settings-tab-input-gating.test.ts`,
`test/unit/settings-tab-terminal-preservation.test.tsx`,
`test/unit/settings-tab-header.test.tsx` (tab appears, activates by click and
keyboard, closes; a decorating plugin double sees `tabType`),
`test/unit/preferences-opens-settings.test.ts` (with and without a window),
`test/unit/create-translator.test.ts`, and
`test/unit/settings-tab-shell-behaviour.test.tsx`.

### EP-M5: editing, inline validation, and reset flows

1. `lib/settings/field-store.ts`: the ref-backed store around `stepField`,
   with `subscribe`/`getSnapshot` for `useSyncExternalStore` and an effect
   runner that calls the gateway and feeds outcomes back as events (D7).
2. Control components in `lib/settings/components/controls/`: `toggle-field`,
   `select-field`, `number-field`, `text-field`, and `colour-field` (a text
   input with a swatch preview; a native colour picker only when the value is
   hex). Each is pure, with grouped props.
3. `setting-row.tsx`: label, description, control, modified indicator, reset
   button (shown only when modified, labelled with the setting name; focus
   moves to the control after reset), inline errors (referenced by the control's
   `aria-describedby`, with `aria-invalid` on the control),
   `InlineRestartWarning` for restart-classified keys after a successful write,
   the profile-override note, and the disabled state for D14 and D15.
4. Error messages are produced from reason codes by the view's translation
   layer; main-process diagnostics show their message and suggested fix.

Tests: `test/unit/settings-editing-behaviour.test.tsx` (scenarios below),
`test/unit/settings-controls.test.tsx` (including keyboard: `Enter`, `Escape`,
`Tab` order), and `test/unit/settings-convergence.property.test.ts`.

### EP-M6: end-to-end coverage

Add `test/e2e-deep/settings-tab.e2e.ts` using the deep-lane helpers. Seed the
isolated config directory with a `config.json5` containing a sentinel comment,
launch the packaged app, record the terminal's column and row count, press the
preferences shortcut, and run the open, edit, invalid, and reset flows,
asserting UI state, file contents, the sentinel comment, and the unchanged
terminal size. The fast lane is not extended. Run locally per the headless
notes in `docs/developers-guide.md` (E2E section).

### EP-M7: documentation, ADR, and roadmap closure

1. `docs/adr-007-settings-tab-hosting-and-persistence.md` in the style-guide
   ADR format: D1 to D4, D12 to D17, trusted assumptions, and the rejected
   alternatives (settings window, draft-then-save, all editor state in Redux,
   tightening the load schema, and the schema-annotated `x-ui` catalogue as the
   recommended direction for 5.2.1).
2. `docs/velocetty-design.md` §"Settings tab and plugin settings panels":
   summarize the implemented shell, link ADR 007, and list deferred work.
3. `docs/settings-tab-architecture.md`: component architecture (domain ring,
   ports, adapters, IPC contract, snapshot shape, write algorithm, active
   surface and input gating, trusted assumptions, proof inventory).
4. `docs/developers-guide.md`: "Settings tab practice" (adding a setting,
   exclusion policy, write policy, translation keys, the active-surface
   allow-list, the single config writer rule) and "Property tests and proofs
   practice" (`fast-check` conventions and `FAST_CHECK_NUM_RUNS`,
   `LemmaScript-files.txt`, `make proofs`, `make proofs-fresh`, the regen
   workflow, the rot policy, no `//@ assume`).
5. `docs/users-guide.md` (new): opening settings, moving between tabs,
   categories, search and `@modified`, editing, validation messages, reset,
   restart-required settings, invalid and legacy config files, and editing
   other settings in the config file.
6. `docs/roadmap.md`: fix the 5.1.1 design links and mark 5.1.1 done (`[x]`
   on the item and its sub-bullets).

## Behavioural specification

The behavioural suites use `bun:test` with Given/When/Then test names. There is
no Gherkin runner in the project; the scenarios below are the specification and
map one-to-one to test cases.

```plaintext
Feature: Settings tab shell and navigation
  Scenario: Opening settings from the preferences command
    Given a window with one terminal tab
    When the main process sends "settings open req"
    Then a tab titled "Settings" appears after the terminal tab and is active
    And the search box has focus
    And the terminal tab's session is still present and was not resized

  Scenario: Opening settings with no window (macOS)
    Given no window is open
    When the preferences command runs
    Then a window is created and its settings tab is active

  Scenario: Returning to a terminal
    Given the settings tab is open and active
    When the user clicks the terminal tab
    Then the terminal is visible, focused, and the settings tab remains in the strip

  Scenario: Keyboard tab movement includes settings
    Given two terminal tabs and the settings tab, with the second terminal active
    When the user moves to the next tab
    Then the settings tab is active
    When the user moves to the next tab again
    Then the first terminal tab is active

  Scenario: Terminal keybindings do not leak
    Given the settings tab is active and the search box has focus
    When the user presses Ctrl+C, Home, and Ctrl+Shift+W
    Then no data is sent to any session and no pane closes
    And Ctrl+Shift+W closes the settings tab

  Scenario: Browsing a category
    Given the settings tab shows all settings
    When the user selects the "Cursor" category
    Then only cursor settings are listed and "Cursor" is marked current

  Scenario: Searching
    When the user types "font size"
    Then "Font size" is listed and "Cursor shape" is not
    And the live region announces the number of results

  Scenario: Showing modified settings
    Given config.json5 sets fontSize to 14
    When the user types "@modified"
    Then exactly "Font size" is listed

  Scenario: No results
    When the user types "zzzz"
    Then a "No settings match" message and a "Clear search and category" button are shown

Feature: Editing core settings
  Scenario: Valid edit of a live setting
    Given fontSize is not set in config.json5
    When the user enters 16 in "Font size" and presses Enter
    Then the gateway receives setValue(core fontSize, 16)
    And the field shows 16 with a modified indicator

  Scenario: Escape reverts a draft
    When the user types 20 in "Font size" and presses Escape
    Then the field shows the committed value and no write is requested

  Scenario: Locally invalid input
    When the user enters "abc" in "Font size" and presses Enter
    Then an inline error "Enter a number" is shown
    And the field is marked aria-invalid
    And no write is requested

  Scenario: Rejection from the main process
    Given the gateway rejects scrollback with a diagnostic at /config/scrollback
    When the user enters -3 in "Scrollback" and presses Enter
    Then the diagnostic message and suggested fix are shown inline under "Scrollback"

  Scenario: Stale outcome is ignored
    Given a write of fontSize 16 is pending
    When the user submits 18 before the first write resolves
    And the first write resolves as rejected
    Then no error is shown and the field waits for the second outcome

  Scenario: Refresh does not clobber typing
    Given the user is typing 22 in "Font size" without submitting
    When a config change arrives from another write
    Then the draft 22 is kept

  Scenario: Restart-required setting
    When the user changes "Update channel" to "canary"
    Then the restart-required warning is shown for that field

  Scenario: Reset to default
    Given config.json5 sets fontSize to 14
    When the user activates "Reset Font size to default"
    Then the gateway receives resetValue(core fontSize)
    And the field shows the default with no modified indicator
    And focus moves to the "Font size" control

  Scenario: Unparseable user config
    Given config.json5 contains a syntax error
    Then a banner explains that settings cannot be saved until the file is fixed
    And edits are disabled

  Scenario: Schema-invalid user config
    Given config.json5 sets scrollback to "lots"
    Then "Scrollback" shows the diagnostic inline with a reset button
    And other fields are disabled with an explanation
    When the user resets "Scrollback"
    Then all fields become editable

  Scenario: Legacy hyper.json
    Given the active config file is hyper.json
    Then the tab is read-only and the banner names hyper.json
```

## Milestones and plateaus

- EP-M0 outcome: proof and property tooling installed, proven on a
  prototype, and wired into `make proofs`, `make proofs-fresh`, and the
  advisory CI workflow. Requirements: enabling work for `INV-SEARCH-*` and
  `INV-FIELD-*`. Acceptance: `make proofs` passes; `make lint` runs the
  freshness check; a `fast-check` property runs in `make test`. Conformance
  check:
  - No product requirement is claimed.
  - Design unaffected.
  - AXIOM-LS-MODEL tested on representative constructs.
  - Only the two pre-approved dependencies added.
  - No trust-boundary or persisted-format change.
  - Trace links unchanged.
  Recovery: revert the dependency, Makefile, and workflow commits. Remaining
  gaps: all product work. Compatibility decision: none.
- EP-M1 outcome: a pure, proved settings domain with no UI. Requirements:
  PRD-SET-1 (categories, search, validation at the domain level), D5, D6, D7.
  Acceptance: EP-M1 suites pass; `make proofs` verifies `search.ts` and
  `field-state.ts` (an explicit acceptance criterion); seeded mutations
  recorded as rejected. Conformance check:
  - Catalogue covers or explicitly excludes every schema key.
  - Domain imports nothing outside `shared/src`.
  - AXIOM-LS-MODEL still holds.
  - No public interface change.
  - No persisted-format change.
  - Trace links for search and validation current.
  Recovery: the domain is unused by production code, so revert freely.
  Compatibility decision: none.
- EP-M2 outcome: the JSON5 scanner lives in `app/config/json5/` within the
  size limit, and generic comment-preserving set and remove exist; the plugin
  runtime uses them. Requirements: DG-CFG-RT, D4. Acceptance: property suite
  passes at 1,000 runs; existing plugin round-trip suites unchanged and green.
  Conformance check:
  - DG-CFG-RT satisfied by INV-EDIT-LOCALITY.
  - Design followed.
  - No new assumption.
  - Plugin persistence changes internally only; callers updated in the same
    commit.
  - Persisted format unchanged.
  - Trace links current.
  Recovery: revert; the refactor commit and the feature commit are separate.
  Compatibility decision: none (private API).
- EP-M3 outcome: the main process can report and change core settings through
  IPC, safely, with a single writer. Requirements: TDD-VAL, D3, D4, D12 to D17.
  Acceptance: writer, file-system, watcher-integration, and service suites
  green on Linux locally (and on all CI operating systems once pushed);
  load-path regression corpus green. Conformance check:
  - Rejected writes never reach disk.
  - All main-process writes go through the writer.
  - Load-path validation unchanged.
  - AXIOM-FS and AXIOM-WATCH exercised.
  - New IPC channels documented in `IpcCommands`.
  - Trace links current.
  Recovery: revert; nothing in the renderer calls the channels yet; the plugin
  runtime routing reverts with the writer. Compatibility decision: none.
- EP-M4 outcome: the settings tab opens from `Preferences…`, is part of the
  tab strip, never disturbs terminals, and offers read-only browsing with
  search and categories. Requirements: TDD-SET-TAB, TDD-CTX-SET, PRD-SET-1
  (search, categories), D1, D2, D8. Acceptance: EP-M4 suites green; a manual
  run of the packaged app shows the tab. Conformance check:
  - The tab is a tab, not a modal.
  - INV-TAB-STRIP, INV-TAB-INPUT, and INV-TAB-NO-RESIZE discharged.
  - No plugin hook signature change.
  - `window:preferences` behaviour change recorded for the users guide.
  - No persisted-format change.
  - Trace links current.
  Recovery: revert the renderer and command commits together. Compatibility
  decision: none.
- EP-M5 outcome: core settings are editable and validated in the UI, with
  reset, restart warnings, and invalid-file handling. Requirements: RM-5.1.1
  success criterion, TDD-HR-UI, DG-SET-UI, D15. Acceptance: editing behavioural
  suite and the convergence property green. Conformance check:
  - Every RM-5.1.1 bullet observable in a behavioural test.
  - Restart indicators reuse the existing components.
  - No new dependency.
  - No new trust boundary.
  - Trace links current.
  Recovery: revert to EP-M4's read-only plateau. Compatibility decision: none.
- EP-M6 outcome: E2E evidence of the full flow against a real file.
  Acceptance: `bun run test:e2e:deep` passes locally with the new spec.
  Conformance check:
  - File contents, comments, and terminal size verified end to end.
  - Trace links current.
  Recovery: the spec is additive. Compatibility decision: none.
- EP-M7 outcome: documentation current and roadmap closed. Acceptance:
  `make markdownlint`, `make nixie`, and `make spelling` clean; the roadmap
  shows 5.1.1 done. Conformance check: every decision in `Decision log`
  reflected in the ADR or design document; every trace link resolves.
  Compatibility decision: none.

## Concrete steps

Run every command from the repository root of a checkout of branch
`5-1-1-settings-tab-shell-and-navigation`.

Log every gate with `tee` so truncated output can be reviewed, and check the
exit status rather than the tail of the log:

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

Focused red and green runs for a new suite, and milestone acceptance runs for
property suites:

```bash
bun test --concurrent test/unit/settings-search.test.ts
FAST_CHECK_NUM_RUNS=1000 bun test --concurrent --randomize --seed 12345 test/unit/settings-search.property.test.ts
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

Expected proof transcript on success (shape; exact counts recorded when run):

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
  criterion of EP-M1 and is rerun at every later milestone; `make lint`
  includes the proof freshness check.
- In the packaged app, `Ctrl+,` opens the settings tab with the search box
  focused; changing font size to 16 updates open terminals without restart;
  entering `abc` shows "Enter a number" under the field and leaves
  `config.json5` unchanged; resetting font size removes `fontSize` from
  `config.json5` while every comment elsewhere in the file remains; typing in
  the search box never reaches the shell.
- `bun run test:e2e:deep` passes with `test/e2e-deep/settings-tab.e2e.ts`.

Quality criteria:

- Tests: `make test` green under `--concurrent --isolate`; property suites
  green at `FAST_CHECK_NUM_RUNS=1000` at each milestone boundary, with recorded
  classification output.
- Verification: every obligation in `Verification plan` discharged as stated,
  with seeded-mutation rejections recorded.
- Lint and typecheck: `make check-fmt`, `make typecheck`, `make lint`,
  `bun run build:packages`, and `bunx tsgo --project app/tsconfig.build.json`
  clean.
- Accessibility: every control has an accessible name; errors are associated
  through `aria-describedby`; one polite live region announces result counts
  and save, reset, and error status; category navigation exposes
  `aria-current`; keyboard-only users can reach search, categories, every
  control, and reset; focus is never lost to the document body after reset or
  tab switches.
- Safety: no write bypasses validation or the single writer; no existing user
  config starts falling back to defaults.

Quality method: the gate commands in `Concrete steps`, run sequentially by the
`scrutineer` agent where available, plus the local deep E2E run.

## Idempotence and recovery

All steps are additive or reversible by `git revert`. `lsc gen` must not be
rerun on a file that already has a `.dfy`; use `lsc regen`, which performs a
three-way merge. `bun run generate-schema` is idempotent. The E2E suite uses an
isolated configuration directory and never touches the developer's real
`config.json5`. The writer sweeps its own temporary files at start-up. If a
gate fails midway, fix and rerun the whole sequence from `make check-fmt`.

## Artefacts and notes

To be filled during implementation: red-stage transcripts, proof verifier
summaries, seeded-mutation rejection transcripts, property classification
output, and E2E logs.

Design review summary (2026-10-29), recorded for traceability. Three expert
lenses reviewed the first draft. Blocking findings and their resolutions: naive
CSS hiding would resize PTYs and leak keystrokes to the hidden shell (D1
revised); tab navigation ignored the appended tab (D1 revised); the catalogue
crossed the package boundary (D5, D8 revised); load-time schema bounds could
reset existing configs to defaults (D3 revised, constraint added); a
schema-invalid file made edits appear saved (D15); the plugin runtime was a
second, unqueued writer (D13); atomic rename broke symlinks, permissions, and
Windows locks (D13); legacy `hyper.json` would gain JSON5 syntax (D14). The
strongest alternative, a schema-annotated catalogue with `x-ui` hints, was
deferred to 5.2.1 behind the panel model (D5).

## Interfaces and dependencies

New development dependencies: `fast-check` (`^4.10.2` or newer at install time)
and `lemmascript` (exact pin, version chosen in EP-M0; npm currently reports
`0.6.5`). External tool: Dafny 4.11 (installed locally; installed in CI by
`.github/workflows/proofs.yml`).

Domain and protocol types in `shared/src/settings/` (illustrative; record final
names here if they change):

```typescript
export type SettingId = string & {readonly brand: 'SettingId'};
export type SettingCategoryId = 'appearance' | 'cursor' | 'colours' | 'terminal' | 'rendering' | 'updates';

export type ControlDescriptor =
  | {kind: 'toggle'}
  | {kind: 'select'; options: readonly string[]}
  | {kind: 'number'; minimum: number; maximum: number; step: number; isInteger: boolean}
  | {kind: 'text'}
  | {kind: 'colour'};

export type FieldLabel = {kind: 'key'; key: string} | {kind: 'literal'; text: string};

export type PanelField = {id: SettingId; category: SettingCategoryId; control: ControlDescriptor; label: FieldLabel};

export type FieldPhase = 'idle' | 'invalid' | 'saving' | 'rejected' | 'failed';

export type FieldState<V> = {
  phase: FieldPhase;
  committed: V | undefined; // undefined when the key is absent from the user file
  draft: string;
  isDirty: boolean;
  errors: readonly FieldErrorCode[];
  pendingRequestId: number; // -1 when no request is pending
  nextRequestId: number;
};

export type FieldEvent<V> =
  | {kind: 'edit'; draft: string}
  | {kind: 'revert'}
  | {kind: 'submit'; coercion: {ok: true; value: V} | {ok: false; errors: readonly FieldErrorCode[]}}
  | {kind: 'reset'}
  | {kind: 'outcome'; requestId: number; result: 'applied' | 'rejected' | 'failed'; errors: readonly FieldErrorCode[]}
  | {kind: 'refresh'; committed: V | undefined; draft: string};

export type FieldEffect<V> =
  | {kind: 'none'}
  | {kind: 'write'; requestId: number; value: V}
  | {kind: 'reset'; requestId: number};

export const stepField = <V>(
  state: FieldState<V>,
  event: FieldEvent<V>
): {state: FieldState<V>; effect: FieldEffect<V>} => {
  /* verified */
};

export type SettingTarget = {scope: 'core'; key: CoreSettingKey};

export type SettingsFileStatus =
  | {kind: 'ok'}
  | {kind: 'missing'}
  | {kind: 'unparseable'; diagnostics: configValidationDiagnostic[]}
  | {kind: 'invalid'; diagnostics: configValidationDiagnostic[]}
  | {kind: 'legacy-json'};

export type SettingsSnapshot = {
  revision: number;
  filePath: string;
  fileStatus: SettingsFileStatus;
  userValues: Readonly<Record<string, JsonValue>>;
  defaultValues: Readonly<Record<string, JsonValue>>;
  profileOverriddenKeys: readonly string[];
};

export type SettingsWriteFailure =
  | 'user-config-unparseable'
  | 'user-config-invalid'
  | 'legacy-json-config'
  | 'config-file-missing'
  | 'not-editable'
  | 'duplicate-key'
  | 'config-not-object'
  | 'edit-failed'
  | 'read-only'
  | 'io-error';

export type SettingsWriteOutcome =
  | {kind: 'applied'; snapshot: SettingsSnapshot}
  | {kind: 'rejected'; diagnostics: configValidationDiagnostic[]}
  | {kind: 'failed'; reason: SettingsWriteFailure; detail?: string};
```

Renderer port in `lib/settings/ports.ts`:

```typescript
export type SettingsGateway = {
  getSnapshot(signal: AbortSignal): Promise<SettingsSnapshot>;
  setValue(target: SettingTarget, value: JsonValue): Promise<SettingsWriteOutcome>;
  resetValue(target: SettingTarget): Promise<SettingsWriteOutcome>;
  subscribe(onChanged: () => void): () => void;
};
```

IPC additions to `IpcCommands` in `shared/src/types/common.ts`:

```typescript
'settings:getSnapshot': () => SettingsSnapshot;
'settings:setValue': (target: SettingTarget, value: JsonValue) => SettingsWriteOutcome;
'settings:resetValue': (target: SettingTarget) => SettingsWriteOutcome;
```

Main-process edit operations in `app/config/json5/document-edit.ts`:

```typescript
export type DocumentEditResult =
  | {kind: 'edited'; doc: Json5Document}
  | {kind: 'refused'; reason: 'path-not-found' | 'duplicate-key' | 'config-not-object'};

export const setPropertyAtPath = (doc: Json5Document, path: PropertyPath, value: JsonValue): DocumentEditResult => {
  /* ... */
};
export const removePropertyAtPath = (doc: Json5Document, path: PropertyPath): DocumentEditResult => {
  /* ... */
};
```

Skills and references the implementer should load: `execplans` (this plan's
format), `typescript-router` then `react-and-accessible-ui`,
`typescript-boundaries-and-validation`, `typescript-data-and-state`,
`electron-and-ipc`, `node-bun-and-processes` (writer and file system),
`typescript-testing`, `typescript-verification`, `fast-check`, `lemmascript`,
`hexagonal-architecture`, `codegraph-mcp` (navigation), `biome-typescript` and
`typescript-quality-tools` (lint fixes), and `en-gb-oxendict-style`
(documentation). Documentation to read first: `docs/developers-guide.md`
(package boundaries, configuration practice, settings UI integration, tests),
`docs/testing-with-bun.md`, and `docs/adr-006-oxlint-plugin-strategy.md`.

## Revision note

2026-10-29: initial draft, produced from Wyvern reconnaissance and Firecrawl
prior-art research.

2026-10-29: revised after a community-of-experts review (structure and
contracts; failure modes and cost; alternatives, viability, verification, and
accessibility). Changes: D1 now defines an active-surface model with a single
tab-strip selector, offscreen hiding, `inert`, and command gating; D2 handles
the windowless macOS menu; D3 moves UI bounds to a write-time policy and keeps
the load schema unchanged; D5 introduces the panel model with opaque ids; D7
replaces `useReducer` with a ref-backed store and effect runner; D8 extracts a
shared translator and keeps labels in `lib/`; D9 adds no-stuck, no-clobber,
write-value, convergence, and writer-exclusivity obligations and replaces the
near-tautological write-valid proof; D11 decides the proof CI policy now; D12
becomes an explicit allow-list; D13 to D17 add the single durable writer, legacy
`hyper.json` handling, invalid-file handling, revisions and notification
suppression, and the protocol and port placement. EP-M2 gains the scanner
relocation and split; EP-M3 gains the writer, watcher changes, and the
load-path regression corpus; the fast-lane E2E extension and the per-category
catalogue files were dropped. Tolerances were raised to 95 files and 8,000
lines to match the revised estimate. Remaining work is unchanged in order:
EP-M0 to EP-M7, after user approval.
