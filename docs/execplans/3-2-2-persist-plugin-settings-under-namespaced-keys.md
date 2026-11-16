# 3.2.2 Persist plugin settings under namespaced keys

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, `Outcomes & retrospective`, `Conformance basis`, and
`Verification plan` must be kept up to date as work proceeds.

Status: DRAFT (awaiting user approval; implementation must not begin)

Branch: `3-2-2-persist-plugin-settings-under-namespaced-keys`

Roadmap item: `3.2.2` in `docs/roadmap.md`.

## Purpose / big picture

Velocetty is a terminal emulator derived from Hyper. It is an Electron
application: a main process (`app/`) owns files and configuration, and a
renderer process (`lib/`) draws the user interface (UI). Plugins can contribute
commands, keybindings, tab decorations, and *settings*. A plugin setting is a
named value, such as the prefix that a plugin writes in front of tab titles,
that the user may change and that must still be there after Velocetty
restarts.

Roadmap item `1.3.1` shipped a first, bundled "golden path" demonstration
plugin with the identifier `velocetty.golden-path-demo`. It already reads
settings from `config.json5` under `config.plugins["<plugin-id>"]`. That first
cut has five defects that this plan fixes:

1. Nothing defines what a plugin identifier may look like, so nothing stops two
   plugins sharing a namespace, an identifier such as `__proto__` reaching
   object-key code, or `Foo.Bar` and `foo.bar` being treated as different
   plugins.
2. At every start-up, `ensureRuntimePluginSettingsPersisted` in
   `app/runtime/plugin-runtime.ts` rewrites the user's `config.json5` to copy
   the plugin's default values into it. The user never asked for that write.
   Copied defaults also freeze: if a later version of the plugin changes a
   default, users who have never touched the setting keep the old value.
3. The main process and the renderer apply defaults differently. The main
   process deep-merges with `lodash/merge`, and the renderer
   (`resolveRuntimePluginSettings` in `lib/utils/plugins.ts`) spreads
   shallowly. The same file can therefore produce two different answers.
4. One malformed plugin entry, such as `"velocetty.golden-path-demo": true`,
   fails schema validation for the whole of `config.json5`. Every setting then
   falls back to the bundled defaults, not just that plugin's settings.
5. The only programmatic writer, `setRuntimePluginEnabledPersisted`, has no
   production caller. It writes with a plain `writeFileSync`, so a crash during
   the write can leave a truncated configuration file.

After this change:

- A plugin identifier is a lowercase, dotted, reverse-DNS-style name such as
  `velocetty.golden-path-demo` or `com.example.git-branch`. Velocetty rejects
  any other identifier with a diagnostic and leaves the stored text alone.
- Plugin settings live in `config.json5` at
  `config.plugins["<plugin-id>"].<setting>`. Only the values the user (or a
  future settings UI) changed are stored. Defaults come from the plugin's
  manifest each time settings are read, and Velocetty never writes them into
  the file.
- When a stored value has a different JSON kind from the declared default (for
  example, a number where a string is expected), Velocetty uses the default for
  that one setting and reports it. The rest of that plugin's settings, and
  every other plugin's settings, are unaffected.
- The main process resolves settings once. The renderer receives the resolved
  values with the configuration it already gets, so both processes always
  agree.
- A host-side service gives each plugin a handle scoped to its own namespace.
  The handle has `get`, `set`, and `reset`. A plugin's handle cannot name
  another plugin. A `set` patches only that value in `config.json5`, keeps
  comments and formatting, and writes atomically: it writes a temporary file,
  flushes it to disk, and then renames it over the original. The value is
  still there after a restart.

A user can observe the change. Start Velocetty with a `config.json5` that has
no `plugins` entry: the golden-path tab prefix shows its default, `GP`, and
the file's bytes and modification time stay the same. Set
`config.plugins["velocetty.golden-path-demo"].tabPrefix` to `"ZZ"` and the
prefix becomes `ZZ`, live, and is still `ZZ` after a restart. Set it to `42`
and the prefix falls back to `GP` with a notification that names the setting.
A plugin-settings write never changes the bytes of another plugin's entry.

Behaviour that is preserved: the top-level `plugins` and `localPlugins` arrays
(the npm plugin lists inherited from Hyper), the legacy `decorateConfig`
plugin hook, keybinding storage in `keybindings.json5`, and the start-up
creation of `config.json5` when it is missing.

Behaviour that deliberately changes: start-up no longer writes plugin defaults
into `config.json5`; malformed plugin entries no longer invalidate the whole
file; and the renderer no longer merges defaults itself.

This plan closes the design gap that `docs/velocetty-design.md`
§Plugin settings persistence leaves open: it shows the namespace as a
top-level `plugins` object, which collides with Hyper's top-level `plugins`
array. It also gives roadmap `5.2.1` (schema-to-UI rendering for plugin
settings) the storage and default contract that `5.2.1` declares it
`Requires`.

## Constraints

- Implementation begins only after the user explicitly approves this plan.
- Do not change the meaning or shape of the top-level `plugins` and
  `localPlugins` arrays in `config.json5`, the `rawConfig` fields
  `plugins?: string[]` and `localPlugins?: string[]` in
  `shared/src/types/config.ts`, or any consumer of those arrays (`app/plugins.ts`,
  `cli/api.ts`, `lib/transport/ipc-schemas.ts`).
- The plugin settings namespace stays at `config.plugins` (inside the `config`
  block). No top-level object named `plugins` may be introduced.
- Do not change the legacy Hyper plugin API (`decorateConfig`,
  `getDecoratedConfig`, and other `decorate*` hooks). Legacy npm plugins run
  with Node.js access. The isolation in this plan is an API-level guarantee of
  the runtime plugin contract, not a security sandbox against them.
- `keybindings.json5` storage, `app/config/keybindings-policy.ts`, and its proof
  must keep their behaviour. The only permitted change in the keybindings area
  is the behaviour-preserving extraction of the atomic text-file write in
  `EP-M4`, guarded by the existing keybindings store tests.
- Start-up and reload must never write `config.json5` to apply plugin
  defaults. The only plugin-settings writes are explicit `set` and `reset`
  calls.
- A plugin-settings write must refuse, without touching the file, when
  `config.json5` is missing, unreadable, or fails to parse.
- Keep pure policy modules free of Electron, filesystem, clock, and logger
  imports, as `app/config/keybindings-policy.ts` is (hexagonal separation:
  policy, then ports, then adapters).
- `app/` main-process modules must not take runtime value imports from
  `@shared/*`. Use `import type` only (`docs/developers-guide.md`,
  "Package boundaries"; enforced by `bun run check:boundaries`). The renderer
  (`lib/`) must not import `app/`, except where
  `scripts/check-package-boundaries.mjs` already allow-lists it.
- No code file may exceed 400 lines (`AGENTS.md`). New modules must be sized
  to that limit. Files already over it (`lib/utils/plugins.ts`,
  `app/plugins.ts`, `app/runtime/plugin-runtime-json5-parser.ts`) must not
  grow in net lines.
- Do not add a dependency. `fast-check` `^4.10.2`, `lemmascript` `0.6.5`,
  `json5`, and `ajv` (already a runtime import of `app/config/json5-config.ts`)
  are sufficient.
- `bin/prove.sh` admits exactly one trust construct,
  `function {:axiom} emptyUserKeymaps()`. The new proof must need no new axiom
  or `extern`. If it does, stop: changing the admission guard requires
  approval.
- Tests must obey the concurrent-suite rules in `docs/developers-guide.md`
  (Testing): no `mock.module`, no file-scope mutable mocks, no `process.env`
  mutation, per-test temporary directories, and injected seams for the
  filesystem, clock, and logger.
- Documentation uses en-GB-oxendict spelling and
  `docs/documentation-style-guide.md`. Do not edit completed historical
  ExecPlans.
- Compatibility: every affected interface is application-internal and
  pre-1.0, so callers change together in the same milestone, with no aliases
  or shims. The persisted format changes compatibly: files that already hold
  materialized defaults remain valid and are read as ordinary user values (see
  `D-6`).

## Tolerances (exception triggers)

Exclude this ExecPlan file from every count. The comparison base is the merge
base with `origin/main` (`9c2d84ba` at drafting time). Count with:

```bash
base=$(git merge-base HEAD origin/main)
git diff --numstat "$base" -- . ':!docs/execplans/*' ':!**/*.dfy.gen' \
  ':!shared/schemas/*.json' ':!app/config/schema.json'
git diff --name-only "$base" -- . ':!docs/execplans/*' | wc -l
```

Classification is by whole file:

- *Code* covers `app/**`, `lib/**`, `shared/src/**`, `cli/**`, `bin/**`,
  `scripts/**`, `test/**`, `typings/**`, and the hand-maintained proof file
  `app/config/plugin-settings-policy.dfy`.
- *Configuration* covers `LemmaScript-files.txt`, `package.json`,
  `biome.json`, `tsconfig*.json`, `.github/**`, and `typos.local.toml`.
- *Documentation* covers `docs/**` (other than ExecPlans), `PLUGINS.md`, and
  `README.md`.
- *Generated, and excluded from line counts but included in the file count*:
  `*.dfy.gen`, `shared/schemas/schema.json`, and `app/config/schema.json`.
  Regenerate these, never hand-edit them.

The thresholds, each enforced independently:

- Files: more than 48 changed non-ExecPlan files.
- Code (production and test): more than 3,200 net lines. Within that, a
  production sub-limit (code excluding `test/**` and the `.dfy` file) of more
  than 1,100 net lines also triggers.
- Configuration: more than 60 net lines.
- Documentation: more than 900 net lines.
- Interface: any change to a constrained interface listed in `Constraints`.
- Dependencies: any new package, or any version change.
- Architecture: placing settings resolution anywhere other than the main
  process's configuration composition, or requiring a new axiom in
  `bin/prove.sh`.
- Iterations: a gate still fails after three fix attempts.
- Time: `EP-M0` takes more than 3 hours, or any other milestone more than 6
  hours.
- Ambiguity: any point where two readings of the roadmap or design change the
  persisted format.

Budget survey. Live code that changes: `app/runtime/plugin-runtime.ts` (280
lines, two functions removed and the rest re-pointed),
`app/runtime/plugin-runtime-json5-roundtrip.ts` (245, brand replaced and one
path setter added), `app/plugins.ts` (start-up hook removed),
`lib/utils/plugins.ts` (renderer merge removed), `app/config/init.ts` or the
composition in `app/config.ts` (resolution added),
`app/config/reloadability-registry.ts` (one entry),
`shared/src/types/config.ts` (namespace type), `app/config/keybindings-store.ts`
(extraction), and `app/e2e-entry.mts` (probe). There are about eight new
production modules of 60 to 250 lines each (about 1,000 lines), offset by
about 150 deleted. Tests are about 1,800 lines: unit, behavioural, property,
coverage-guard, contract tests on a real temporary directory, and E2E. The
hand-maintained proof is about 300 lines. Documentation is about 650 lines:
ADR 009 (about 200), the design document (about 60), the users' guide (about
110), the developers' guide (about 120), the configuration architecture (about
90), `PLUGINS.md` (about 30), the tracking issues (about 20), and the roadmap
(about 6).

History. The nearest precedent is
`docs/execplans/3-2-1-store-keybindings-in-keybindings-json5.md`. It set one
combined budget of 58 files and 3,500 net lines of code and documentation, and
recorded a single exception: the delivered diff touched 90 files and 8,234 net
lines (7,692 without generated artefacts). It was within budget without tests
(3,447) and over budget with tests, which added 4,245 lines. That plan combined
categories and under-counted tests. This plan therefore counts tests inside the
code budget, sets production and test expectations separately, and sizes the
code budget at about 1.25 times the estimate. Roadmap `1.3.1` recorded no
comparable budget revision.

## Risks

- Risk: LemmaScript `0.6.5` may not lower the namespace map operations
  (`Record` spread updates and key iteration) without an `extern`. Severity:
  high. Likelihood: medium. Mitigation: the `EP-M0` probe decides this before
  any production code. LemmaScript's `SPEC.md` lists `{...map, [k]: v}`,
  `const {[k]: _, ...rest} = map`, `Object.entries` loops, and `forall` for
  the Dafny backend. On a no-go, stop and escalate with the options recorded in
  `D-10`.
- Risk: the programmatic `set` triggers the configuration watcher, which
  re-imports and shows "Configuration updated". Severity: low. Likelihood:
  high. Mitigation: the reload is the mechanism that makes the value live.
  Suppress only the toast, through the existing self-write stamp mechanism in
  `app/config/watched-file-stamp.ts` (`createWatchedFileReconciler`). If that
  cannot be done without changing watcher behaviour, accept the toast and
  record it in `Decision log`.
- Risk: a read-modify-write race when the user edits `config.json5` in an
  editor while `set` runs. Severity: medium. Likelihood: low. Mitigation:
  re-read the file text immediately before patching, refuse when the read
  fails, and write by rename. Last writer wins. Document the race in the ADR's
  known limitations.
- Risk: removing the start-up default write changes behaviour for existing
  files. Severity: low. Likelihood: certain. Mitigation: previously
  materialized values are equal to the defaults, so the plugin behaves the
  same. The users' guide explains that deleting a key returns it to the live
  default.
- Risk: the profile merge (`getProfileConfig` in
  `app/config/config-queries.ts`) could let a profile override
  `config.plugins`. Severity: medium. Likelihood: low. Mitigation: `EP-M3` adds
  a test that pins the profile override key set (`profileConfigOptions`) as
  excluding `plugins`, so plugin settings are profile-independent.
- Risk: relaxing the namespace schema from "object per plugin" to "any JSON
  value" might let editors stop flagging a typo. Severity: low. Likelihood:
  medium. Mitigation: the policy reports a non-object entry by name, and the
  schema keeps a `description` that says entries must be objects.
- Risk: `cli/api.ts` `save` rewrites the whole `config.json5` canonically and
  drops comments. Severity: low (out of scope). Likelihood: medium.
  Mitigation: record `CONFIG-CLI-001` in `docs/tracking-issues.md`. The CLI
  does not read `config.plugins`, so it cannot materialize defaults.
- Risk: the E2E lane needs a working local Electron. Severity: medium.
  Likelihood: medium. Mitigation: follow the headless recipe in
  `docs/developers-guide.md` (E2E) and the 3.2.1 lessons: probe values that no
  default produces, and run the whole `test/e2e/` directory.

## Progress

- [x] (2026-11-16T21:32Z) Reconnaissance (Wyvern team), prior-art research,
  and initial draft completed.
- [ ] Expert design review applied.
- [ ] Plan approved by the user.
- [ ] `EP-M0` LemmaScript feasibility probe: go/no-go recorded.
- [ ] `EP-M1` Plugin identifier grammar and ADR 009 (Proposed).
- [ ] `EP-M2` Verified settings policy.
- [ ] `EP-M3` Read path: main-process resolution, no start-up write, per-plugin
  failure isolation.
- [ ] `EP-M4` Write path: atomic, formatting-preserving `set` and `reset`
  behind a port.
- [ ] `EP-M5` End-to-end restart and isolation scenarios.
- [ ] `EP-M6` Documentation closure, ADR acceptance, and roadmap update.

## Surprises & discoveries

- Observation: a large part of the roadmap item already exists, and it
  conflicts with the design document. Evidence: `app/runtime/plugin-runtime.ts`
  lines 50 to 76 and 186 to 280, `shared/src/types/config.ts:210`, and the
  `config.plugins` schema entry in `app/config/schema.json` (generated from
  `typings/config.d.ts`), against `docs/velocetty-design.md`
  §Plugin settings persistence, which shows a top-level `plugins` object.
  Impact: the plan formalizes and corrects existing code. It is not a
  greenfield build.
- Observation: `docs/developers-guide.md` (Layering rules) already says that
  plugin defaults are "runtime contributions, not persisted", but the code
  persists them. Impact: `D-3` brings the code into line with that guidance.
- Observation: `config.json5` has no last-known-good fallback. A parse or
  schema failure makes the active configuration the bundled defaults
  (`app/config/import-sources.ts`, `loadUserConfig`). Impact: per-plugin
  failure isolation (`D-5`) matters more, because the schema is the only gate
  that can wipe out every setting.
- Observation: `app/config/layering.ts` `resolveConfigLayers` has no
  production caller. `_init` in `app/config/init.ts` uses `lodash/merge`, which
  merges arrays by index. Impact: plugin settings resolution must not rely on
  either. It is its own pure function (`D-4`).
- Observation: the worktree had no `node_modules`, so the installed
  LemmaScript surface could not be inspected locally during planning. Impact:
  `EP-M0` runs `bun install` first (see the fresh-worktree note in
  `Concrete steps`).

## Decision log

- D-1. Decision: keep the namespace at `config.plugins["<plugin-id>"]` and
  correct the design document's top-level example. Rationale: the top-level
  `plugins` key is Hyper's npm list, and the strict validator
  (`validateStringArrayField` in `app/config/json5-config.ts`) rejects an
  object there, which would discard the whole file. `config.plugins` is
  already implemented, validated, and documented in
  `docs/developers-guide.md`. The rejected alternative is to rename the npm
  list (for example, to `pluginPackages`). That breaks every Hyper-era
  configuration and the CLI for no user benefit. Date/Author: 2026-11-16,
  planning agent.
- D-2. Decision: plugin identifiers follow the grammar
  `segment ("." segment)+`, where `segment = [a-z][a-z0-9]*("-"[a-z0-9]+)*`.
  The total length is 3 to 128 characters, ASCII only, and there are at least
  two segments. The prefix `velocetty.` is reserved for plugins bundled with
  the application. The identifier is case-sensitive, but uppercase is rejected
  rather than folded. Rationale: this matches the existing ID and the design
  document's `com.example.git-branch`, and follows the publisher-qualified
  convention VS Code uses for extension settings ("use the extension name as
  prefix"). Requiring a dot keeps `__proto__`, `constructor`, and `prototype`
  out by construction. Rejecting uppercase and non-ASCII leaves no two
  accepted IDs that differ only by case, and no homoglyphs. The rejected
  alternative is npm package names: they allow `@scope/` and uppercase legacy
  names, and they name an install source, not a settings owner. Legacy npm
  plugins keep reading the top-level config through `decorateConfig` and do
  not get a namespace in this item. Date/Author: 2026-11-16, planning agent.
- D-3. Decision: defaults are applied at read time and are never written into
  `config.json5`. `ensureRuntimePluginSettingsPersisted` and its start-up call
  in `app/plugins.ts` are deleted. Rationale: this matches the developers'
  guide ("Plugin defaults (runtime contributions, not persisted)"), the
  principle from 3.2.1 that a reload never writes, and VS Code's practice of
  keeping manifest defaults out of `settings.json`. It also stops defaults
  freezing across plugin upgrades. The rejected alternative is to keep
  materializing defaults, which writes the user's file without consent, can
  trigger a reload loop, and freezes old defaults. Date/Author: 2026-11-16,
  planning agent.
- D-4. Decision: resolution is shallow and checks kinds key by key. For each
  key the manifest declares, the stored value is used when its JSON kind
  (`null`, `boolean`, `number`, `string`, `array`, or `object`) matches the
  default's kind; otherwise the default is used and the key is reported. A
  stored key the manifest does not declare passes through unchanged. Arrays
  and objects are atomic values: they replace the default whole. Rationale:
  this is the smallest rule that applies defaults when values are missing and
  survives a wrong-typed value. It can be stated in LemmaScript's subset, it
  matches the renderer's current shallow behaviour, and the golden-path
  settings are flat. Full JSON Schema validation of plugin values (ranges,
  enums, and so on) belongs to roadmap `5.2.1` ("Support basic field types,
  validation, and defaults"). The rejected alternative is deep merge, which
  `lodash/merge` gets wrong for arrays, has no sound kind rule for nested
  objects, and would need a recursive proof for a case no plugin uses yet.
  Date/Author: 2026-11-16, planning agent.
- D-5. Decision: failure isolation is per plugin. The namespace schema becomes
  `Record<string, JsonValue>`. The policy, not Ajv, rejects a non-object
  entry or an invalid identifier, ignores only that entry with a diagnostic,
  and keeps the stored text. Rationale: one malformed plugin entry must not
  reset every Velocetty setting to defaults ("remain isolated per plugin"
  covers failures too). The rejected alternative is a `propertyNames` pattern
  in the schema, which turns a typo in one plugin's identifier into a
  whole-file fallback. Date/Author: 2026-11-16, planning agent.
- D-6. Decision: no persisted-format migration. Rationale: files that 1.3.1
  wrote already conform. Their materialized values are read as user values
  that equal the defaults. Date/Author: 2026-11-16, planning agent.
- D-7. Decision: the main process resolves settings once, while it composes
  the configuration (start-up and reload). `config.plugins` in the composed
  configuration holds the resolved settings of every registered plugin. The
  renderer reads `config.plugins[id]` and no longer merges defaults.
  Rationale: one owner, one answer, and no `lib/` to `app/` import. The
  rejected alternative is to put a shared policy module in `shared/src`, which
  `app/` cannot import at run time and would therefore duplicate.
  Date/Author: 2026-11-16, planning agent.
- D-8. Decision: isolation of the write API is by capability. The service
  exposes `forPlugin(id: PluginId): PluginSettingsHandle`, and the handle's
  `get`, `set(key, value)`, and `reset(key)` cannot name another plugin. The
  pure update functions carry a proved frame property (`INV-SET-FRAME`).
  Rationale: this follows the design document's `PluginContext.settings`
  sketch (`get(path)`, `set(path, value)`) and makes cross-plugin writes
  unrepresentable rather than merely checked. Date/Author: 2026-11-16,
  planning agent.
- D-9. Decision: the write is a targeted JSON5 patch through the existing
  round-trip patcher (`app/runtime/plugin-runtime-json5-roundtrip.ts`). It
  then makes an atomic replacement (temporary file, `fsync`, rename with the
  existing retry). That replacement is extracted from
  `app/config/keybindings-store.ts` into a shared helper by a separate,
  behaviour-preserving refactor commit. Rationale: one atomic-write
  implementation, tested by the keybindings suite that already exists.
  Date/Author: 2026-11-16, planning agent.
- D-10. Decision: proof scope. The LemmaScript proof covers the pure policy:
  resolution, `set`, and `reset` over flat maps with opaque payloads.
  Identifier grammar is covered by table and property tests, not the proof.
  If `EP-M0` is a no-go, the options are: (a) represent maps as sorted entry
  arrays inside the policy; (b) prove only the resolution function and cover
  the frame property with model-based property tests; (c) request approval
  for an `extern`. The plan escalates rather than choosing among them alone.
  Date/Author: 2026-11-16, planning agent.
- D-11. Decision: ADR 009 records `D-1` to `D-5` and `D-7` to `D-8`. It is
  written as `Proposed` in `EP-M1` and set to `Accepted` in `EP-M6`.
  Date/Author: 2026-11-16, planning agent.

## Outcomes & retrospective

Not started. Complete at each milestone and at closure.

## Context and orientation

Inspected base revision: `9c2d84ba` (`main`, 2026-11-16).

Configuration load path. `setup()` in `app/config.ts` runs the start-up session
(`app/config/startup-session.ts`) and then `_import('startup')`
(`app/config/import.ts`). The watcher (`app/config/config-watch.ts`, chokidar,
100 ms debounce) calls `_import('reload')`. `loadUserConfig`
(`app/config/import-sources.ts`) reads the file. `parseJson5WithSchemaDiagnostics`
(`app/config/json5-config.ts`) parses it with `json5` and validates the
`config` block with Ajv against the generated `app/config/schema.json`. `_init`
(`app/config/init.ts`) merges the bundled `app/config/config-default.json` with
`lodash/merge`. `setCurrentConfig` (`app/config/current-config.ts`) publishes
the result. `app/ui/window.ts` sends `config change` to the renderer, where
`lib/utils/config.ts` `getConfig` calls `getDecoratedConfig(profileName)`
(`app/plugins.ts`). The path being written is `locations.config.path` (exported
as `cfgPath` from `app/config/paths.ts`). It already honours the 3.2.1
resolution order (development file, Velocetty tree, legacy Hyper tree).

Plugin settings today. `shared/src/types/config.ts:210` defines
`pluginSettingsNamespace`. `configOptions.plugins?` holds it. The golden-path
manifest exists twice. `shared/src/runtime/golden-path-demo.ts` is used by the
renderer, and `app/runtime/golden-path-demo.ts` is used by the main process,
because `app/` cannot import `@shared` values. The manifest declares
`settingsDefaults` (`enabled: true`, `message`, `tabPrefix: 'GP'`) and a
JSON-Schema-like `settingsSchema`. `app/runtime/plugin-runtime.ts` exports
`getRuntimePluginSettings` (deep merge), `ensureRuntimePluginSettingsPersisted`
(called once at start-up from `app/plugins.ts`), and
`setRuntimePluginEnabledPersisted` (tests only).
`app/runtime/golden-path-message.ts` reads settings in the main process.
`lib/utils/plugins.ts` `resolveRuntimePluginSettings` reads them in the
renderer. `app/runtime/plugin-runtime-json5-roundtrip.ts` patches
`config.plugins.<id>` text-preservingly through an 839-line handwritten parser
(`plugin-runtime-json5-parser.ts`). Its `pluginId(value)` brand validates
nothing.

Precedent to follow. 3.2.1 split keybindings into a verified policy
(`app/config/keybindings-policy.ts`, `.dfy`, `.dfy.gen`), ports
(`keybindings-ports.ts`), a file adapter (`keybindings-store.ts`: temporary
sibling, `wx` open, write loop, `fsync`, `chmod`, rename through
`keybindings-rename-retry.ts`), a service (`keybindings.ts`), a notifier, and
composition in `app/config.ts`. `docs/configuration-architecture.md` describes
that shape. This plan mirrors it at a smaller scale.

Definitions. *Namespace*: the object stored at `config.plugins["<plugin-id>"]`.
*Manifest*: the in-code description of a bundled plugin
(`RuntimePluginManifest`). *Resolved settings*: the defaults with valid stored
values applied. *JSON kind*: one of `null`, `boolean`, `number`, `string`,
`array`, `object`. *Frame property*: an update changes only the location it
names.

Tests and gates. `make all` runs
`check-fmt typecheck lint test spelling prove`. Unit, behavioural, and property
tests live flat in `test/unit/` and run as
`bun test --concurrent --isolate test/unit` (`make test`). Property tests use
`fast-check` with fixed seeds, in `*.property.test.ts`. Each arbitrary has a
`*.coverage.test.ts` guard asserting that each interesting class appears in
more than 5 per cent of samples (`docs/developers-guide.md`, Property tests).
Proofs: `LemmaScript-files.txt` lists `path timeout` lines, and `make prove`
runs `bin/prove.sh` (Dafny 4.11.x, Z3 4.12.1, `.dfy.gen` freshness, axiom
allow-list, one verifier summary per source). The fast E2E lane is
`bun run test:e2e:fast` (Bun, `RUN_E2E=1`, `test/e2e/`). It observes the app
through stdout markers (`app/config/e2e-marker-sink.ts`) and drives it through
a request file read by probes started only from `app/e2e-entry.mts`. The
3.2.1 restart scenario, `test/e2e/keybindings.e2e.test.ts` ("a relaunch reads
the persisted edit and rewrites nothing"), is the template for `EP-M5`.
The repository has no Gherkin runner. Behavioural tests are `bun:test` suites
named `*-behaviour.test.ts`.

Documentation to read first: `docs/velocetty-design.md` (Configuration system,
Plugin runtime, Schema-driven settings panels, Plugin settings persistence);
`docs/velocetty-product-requirements-document.md` (lines 60, 68, and 177 to
181: "Plugin-contributed settings (namespaced)" and "Namespaced persistence
into JSON5"); `docs/configuration-architecture.md`; `docs/developers-guide.md`
(Configuration format practice, Layering rules, Package boundaries, Testing,
LemmaScript proofs, E2E); `docs/adr-007-keybindings-json5-storage.md` and
`docs/adr-008-velocetty-configuration-directory.md` (ADR shape);
`docs/documentation-style-guide.md` (ADR sections at lines 204 to 308).

Skills to load during implementation: `execplans` (keep this plan current);
`typescript-router`, then `typescript-boundaries-and-validation` and
`typescript-errors-and-outcomes` (identifier parsing, outcomes), and
`typescript-data-and-state` (policy shapes); `hexagonal-architecture`
(policy, port, and adapter split); `typescript-testing`, `fast-check`, and
`typescript-verification`; `lemmascript` (proof); `electron-and-ipc` (renderer
configuration delivery); `en-gb-oxendict-style` (documentation);
`commit-message` and `pr-creation` (delivery).

## Conformance basis

Upstream artefacts inspected at `9c2d84ba`:

- `docs/roadmap.md` item `3.2.2` and its three sub-items.
- `docs/velocetty-design.md` §Plugin settings persistence, §Plugin runtime
  (`PluginContext.settings`), §Schema-driven settings panels,
  §Layering rules, and §Validation and error reporting.
- `docs/velocetty-product-requirements-document.md`: "Plugin-contributed
  settings (namespaced)", "Settings schema format (UI hints + validation +
  defaults)", and "Namespaced persistence into JSON5".
- ADR 007 and ADR 008 (3.2.1 storage conventions). ADR 009 is new in this
  plan.
- `docs/developers-guide.md` "Configuration format practice" and "Layering
  rules".
- No Terms of Reference document exists for this project.

Requirements:

- `REQ-NS`: plugin settings persist at `config.plugins["<plugin-id>"]` in
  `config.json5`, one object per plugin. (Roadmap "namespace conventions per
  plugin ID"; PRD "Namespaced persistence into JSON5".)
- `REQ-ID`: plugin identifiers have a defined, validated grammar. (Roadmap
  "namespace conventions".)
- `REQ-DEFAULTS`: a setting that is missing, or whose stored kind is wrong,
  resolves to the manifest default. (Roadmap "default values are applied
  when missing".)
- `REQ-RESTART`: a value set through the host API, or edited by hand, is the
  resolved value after a restart. (Roadmap success criterion.)
- `REQ-ISOLATION`: a plugin's resolved settings depend only on its own
  namespace and manifest. A write through one plugin's handle changes no
  other namespace, in memory or in file bytes. A malformed namespace affects
  only its own plugin. (Roadmap success criterion.)
- `REQ-PRESERVE`: plugin-settings writes keep unrelated text, never happen at
  start-up or reload, and never happen when the file is unparsable.
  (Developers' guide; 3.2.1 principle.)
- `REQ-HEX`: pure policy is separate from ports and adapters.
- `REQ-DOCS`: the users' guide, developers' guide, configuration architecture,
  design document, and ADR reflect the behaviour.

Gaps:

- `GAP-DOC-SHAPE`: the design document's example puts `plugins` at the top
  level.
- `GAP-ID`: there is no identifier grammar.
- `GAP-DEFAULT-WRITE`: start-up materializes defaults.
- `GAP-MERGE-SPLIT`: main and renderer merge differently.
- `GAP-FAIL-WIDE`: one bad entry invalidates the whole file.
- `GAP-WRITE`: there is no write port and no atomic write.
- `GAP-RELOAD`: `config.plugins` has no reloadability classification.

Trace:

```plaintext
Roadmap "namespace conventions" -> REQ-NS, REQ-ID -> GAP-ID, GAP-DOC-SHAPE
  -> EP-M1, EP-M6 -> plugin-id.test.ts, plugin-id.property.test.ts, ADR 009
Roadmap "defaults applied when missing" -> REQ-DEFAULTS -> GAP-DEFAULT-WRITE, GAP-MERGE-SPLIT
  -> EP-M2, EP-M3 -> policy proof, plugin-settings-resolution-behaviour.test.ts, E2E "defaults without writing"
Roadmap "survive restart" -> REQ-RESTART, REQ-PRESERVE -> GAP-WRITE
  -> EP-M4, EP-M5 -> plugin-settings-store.contract.test.ts, E2E "set survives relaunch"
Roadmap "isolated per plugin" -> REQ-ISOLATION -> GAP-FAIL-WIDE
  -> EP-M2..EP-M5 -> INV-SET-FRAME proof, INV-RESOLVE-LOCAL, E2E "other namespace bytes unchanged"
Design §Plugin runtime PluginContext.settings -> REQ-HEX -> EP-M4 -> PluginSettingsHandle
Design §Hot reload semantics -> GAP-RELOAD -> EP-M3 -> reloadability registry test
```

## Verification plan

### Abstract model

Let `K` be strings (setting keys), `I` the set of valid plugin identifiers, and
`E = (kind, payload)` a setting entry whose payload is opaque. `Settings` is a
finite map `K -> E`. `Namespace` is a finite map `I -> Settings`. A manifest
supplies `defaults(i): Settings` for a registered `i`.

- `resolve(d, s)`: for `k in d`, the result is `s[k]` if `k in s` and
  `s[k].kind = d[k].kind`; otherwise it is `d[k]`. For `k in s \ d`, the
  result is `s[k]`. No other keys are present.
- `mismatches(d, s) = {k in d ∩ s | s[k].kind ≠ d[k].kind}`.
- `set(n, i, k, e)`: `n` with `n[i][k] := e`, creating `n[i]` as empty if
  absent.
- `reset(n, i, k)`: `n` with `k` removed from `n[i]`; unchanged if absent.
- `resolveNamespace(n, registered)`: for each registered `i`,
  `resolve(defaults(i), n[i] or {})`.

The adapter parses `config.json5` into `rawConfig`. It converts
`config.plugins` into `Namespace` by checking each identifier against `D-2`
and requiring each entry to be an object (failures become diagnostics and are
skipped). It classifies kinds with a total function `jsonKind`. Malformed
inputs never reach the policy.

### Invariants and lemmas

- `INV-DEFAULT-TOTAL` (`REQ-DEFAULTS`): `keys(d) ⊆ keys(resolve(d, s))`.
- `INV-STORED-WINS` (`REQ-RESTART`): `k in d ∩ s` and equal kinds imply
  `resolve(d, s)[k] = s[k]`.
- `INV-KIND-FALLBACK` (`REQ-DEFAULTS`): `k in d` and (`k not in s` or kinds
  differ) imply `resolve(d, s)[k] = d[k]`, and `k in mismatches(d, s)` exactly
  when `k in s` and the kinds differ.
- `INV-PASSTHROUGH`: `k in s \ d` implies `resolve(d, s)[k] = s[k]`.
- `INV-NO-INVENT`: `keys(resolve(d, s)) ⊆ keys(d) ∪ keys(s)`.
- `L-IDEMPOTENT`: `resolve(d, resolve(d, s)) = resolve(d, s)`. This is the
  lemma that lets the renderer re-resolve without changing anything.
- `INV-SET-FRAME` (`REQ-ISOLATION`): `set(n, i, k, e)[j] = n[j]` for
  `j ≠ i`; `set(n, i, k, e)[i][k'] = n[i][k']` for `k' ≠ k`;
  `set(n, i, k, e)[i][k] = e`.
- `INV-RESET-FRAME` (`REQ-ISOLATION`): `reset` changes only `n[i][k]`.
- `L-RESET-DEFAULT` (`REQ-DEFAULTS`): `k in d(i)` implies
  `resolve(d(i), reset(n, i, k)[i])[k] = d(i)[k]`.
- `L-SET-ROUNDTRIP` (`REQ-RESTART`, logical half): `k not in d(i)` or
  `e.kind = d(i)[k].kind` implies `resolve(d(i), set(n, i, k, e)[i])[k] = e`.
- `INV-RESOLVE-LOCAL` (`REQ-ISOLATION`): `n1[i] = n2[i]` implies
  `resolveNamespace(n1)[i] = resolveNamespace(n2)[i]`. Together with
  `INV-SET-FRAME`, a write for `j` never changes the resolved settings of `i`.
- `INV-ID-GRAMMAR` (`REQ-ID`): `parsePluginId` accepts exactly the `D-2`
  language. Accepted values contain `.`, are lowercase ASCII, and are 3 to
  128 characters long, so they never equal `__proto__`, `constructor`, or
  `prototype`.
- `INV-PATCH-PRESERVE` (`REQ-PRESERVE`, `REQ-ISOLATION`): after a successful
  write, re-parsing the file equals the old parsed configuration with exactly
  `config.plugins[i][k]` changed. Every byte outside the replaced or inserted
  span is unchanged.
- `INV-NO-WRITE-INVALID` (`REQ-PRESERVE`): a missing, unreadable, or
  unparsable file gives a refused outcome, and the bytes stay unchanged.
- `INV-ATOMIC` (`REQ-PRESERVE`): if the write fails at any step before the
  rename, the original bytes are intact and no temporary file remains.
- `INV-NO-IMPLICIT-WRITE` (`REQ-PRESERVE`): start-up and reload perform no
  write to `config.json5` for plugin settings.

### Axioms (trusted, not verified here)

- `AXIOM-PAYLOAD-EQ`: the proof treats payloads as opaque values with
  equality. In TypeScript, equality is structural deep equality of JSON
  values. This is the same trusted bridge as in
  `app/config/keybindings-policy.ts`, documented in the module header. The
  adapter is the only producer of entries.
- `AXIOM-LSC-LOWERING`: `lsc` 0.6.5 translates the annotated TypeScript
  faithfully. `bin/prove.sh` checks that `.dfy.gen` is fresh, so the proof is
  of the shipped source.
- `AXIOM-JSON5`: the `json5` package parses according to the JSON5
  specification.
- `AXIOM-RENAME`: a same-directory `rename` replaces the target atomically on
  POSIX. On Windows it is retried on `EPERM`, `EACCES`, and `EBUSY` by
  `keybindings-rename-retry.ts`.
- `AXIOM-WATCHER`: chokidar delivers a change event after the rename, within
  the debounce window.
- `AXIOM-SINGLE-WRITER`: one Velocetty main process writes `config.json5` at a
  time. User editors and the CLI are concurrent writers on a last-writer-wins
  basis (see `Risks`).

### Methods per obligation

- Obligation: `INV-DEFAULT-TOTAL`, `INV-STORED-WINS`, `INV-KIND-FALLBACK`,
  `INV-PASSTHROUGH`, `INV-NO-INVENT`, and `L-IDEMPOTENT`.
  Method: LemmaScript `//@ ensures` contracts with Dafny lemmas, plus a
  fast-check property suite.
  Rationale: these hold over every map, so a proof is proportionate. The
  property suite checks the TypeScript implementation against an independent
  oracle, a direct per-key `if` over generated keys, because the proof's
  bridge is `AXIOM-PAYLOAD-EQ`.
  Domain: all finite `Settings` (proof); generated maps of 0 to 8 keys over a
  6-key alphabet with all six kinds (properties).
  Artefacts: `app/config/plugin-settings-policy.ts`, `.dfy`, `.dfy.gen`;
  `test/unit/plugin-settings-policy.test.ts`;
  `test/unit/plugin-settings-policy.property.test.ts`;
  `test/unit/plugin-settings-arbitraries.coverage.test.ts`;
  `test/testUtils/plugin-settings-arbitraries.ts`.
  Evidence: `make prove` reports the new source verified with no errors;
  `bun test test/unit/plugin-settings-policy*.test.ts` passes, seed
  `PLUGIN_SETTINGS_PROPERTY_SEED`.
  Non-vacuity: the `.dfy` contains witness lemmas, as in
  `keybindings-policy.dfy`. One has a stored key with a matching kind, one a
  mismatched kind, one a key absent from the defaults, and one empty defaults.
  This shows that every antecedent is inhabited. The coverage guard requires
  each class (match, mismatch, missing, extra key, empty) to appear in more
  than 5 per cent of samples. Seeded fault: change the kind comparison to
  always prefer the stored value; both `make prove` and the property suite
  must fail. Revert, and record the transcript.
- Obligation: `INV-SET-FRAME`, `INV-RESET-FRAME`, `L-RESET-DEFAULT`,
  `L-SET-ROUNDTRIP`, and `INV-RESOLVE-LOCAL`.
  Method: LemmaScript contracts over `Record` spread updates, plus a
  model-based fast-check test over sequences of `set` and `reset` against a
  `Map`-of-`Map` model.
  Rationale: the frame property is the core of the isolation claim and must
  hold for every namespace and every sequence of operations.
  Domain: proof over all maps; properties over sequences of 0 to 20
  operations on 3 identifiers and 4 keys.
  Artefacts: the same policy files, plus
  `test/unit/plugin-settings-service.model.test.ts`.
  Evidence: `make prove`; the model test passes.
  Non-vacuity: witnesses where `i ≠ j` both exist with non-empty settings.
  Seeded fault: make `set` write `n[j][k]` for the lexically first `j`; the
  proof and the model test must fail.
- Obligation: `INV-ID-GRAMMAR`.
  Method: a parameterized table (valid: `velocetty.golden-path-demo`,
  `com.example.git-branch`, `a.b`; invalid: empty, `golden`, `Com.example.x`,
  `com..x`, `.x`, `x.`, `x.-y`, `x.y-`, `__proto__`, `constructor`,
  `com.exämple.x`, 129 characters, and `com.example.x` followed by a trailing
  space), plus a fast-check property. The property builds valid IDs from generated
  segments, which the parser must accept, and invalid IDs by single-character
  mutation outside the alphabet or by breaking a segment rule, which it must
  reject. Every bundled manifest ID must parse, and only bundled manifests may
  use the reserved `velocetty.` prefix.
  Rationale: the grammar is a regular language, so a generator-based oracle is
  independent of the implementation's regular expression.
  Artefacts: `app/config/plugin-id.ts`, `test/unit/plugin-id.test.ts`,
  `test/unit/plugin-id.property.test.ts`, and a coverage guard.
  Non-vacuity: the coverage guard requires both accepted and rejected classes
  (each mutation kind) above 5 per cent. Seeded fault: drop the "at least two
  segments" rule; the table case `golden` must fail.
- Obligation: `INV-PATCH-PRESERVE`.
  Method: a property test over generated `config.json5` documents. The
  generator produces documents with comments, trailing commas, quoted and
  unquoted keys, absent or present `config`, `plugins`, and namespace objects,
  and several plugin entries. For each document, run a `set` and compare the
  re-parse (`json5`) to the expected structure, and the bytes outside the
  patched span to the original. Add named regressions for the existing
  formatting tests in `test/unit/runtime-plugin-settings.test.ts`.
  Artefacts: `test/unit/plugin-settings-patch.property.test.ts` and a coverage
  guard (each shape class above 5 per cent).
  Seeded fault: patch the whole namespace object instead of one key; a byte
  comparison on another key's comment must fail.
- Obligation: `INV-NO-WRITE-INVALID` and `INV-ATOMIC`.
  Method: contract tests against the file adapter on a real per-test
  temporary directory, plus fault injection through the injected `fs` port.
  Inject a failure in `open`, `write`, `fsync`, and `rename` in turn.
  Artefacts: `test/unit/plugin-settings-store.contract.test.ts`.
  Evidence: original bytes intact, no `.config.json5.*.tmp` left, and a typed
  `refused` or `failed` outcome.
  Non-vacuity: one success case per directory shape, so the happy path is
  reachable.
- Obligation: `INV-NO-IMPLICIT-WRITE`, and `REQ-RESTART` (physical half).
  Method: a behavioural test that composes the real import with a recording
  fs (no writes at start-up or reload), and E2E scenarios on three launches
  checking file bytes and modification time.
  Artefacts: `test/unit/plugin-settings-resolution-behaviour.test.ts`,
  `test/e2e/plugin-settings.e2e.test.ts`.
  Non-vacuity: the probe value `ZZ-e2e` is not the default `GP`, so a dropped
  value cannot pass by coincidence (3.2.1 lesson).

### Formal verification decision

A proof is warranted for the policy because `REQ-ISOLATION` and
`REQ-DEFAULTS` are contractual and range over all maps and sequences of
operations. The proof stops at the policy. Kind classification, identifier
parsing, JSON5 patching, and file atomicity are covered by property, contract,
and E2E tests, because they depend on third-party behaviour (`json5`, the
filesystem) that a proof would only restate as axioms. Bounded model checking
would add nothing over the unbounded Dafny proof for the policy. A
state-machine model checker is not needed: the only concurrency is the
last-writer-wins race, which the plan documents rather than verifies.

### Suggested BDD features

Proposed acceptance scenarios. The repository has no Gherkin runner, so they
are realized as `describe` and `test` blocks with matching names in
`test/unit/plugin-settings-resolution-behaviour.test.ts` (unit level) and
`test/e2e/plugin-settings.e2e.test.ts` (application level). No `.feature`
file or runner is added.

```gherkin
Feature: Plugin settings persist under namespaced keys

  Scenario: Defaults apply without writing the file
    Given config.json5 has no config.plugins entry
    When Velocetty starts
    Then the golden-path tab prefix is "GP"
    And config.json5 bytes and mtime are unchanged

  Scenario: A stored value survives restart
    Given the golden-path handle sets tabPrefix to "ZZ-e2e"
    When Velocetty is relaunched
    Then the golden-path tab prefix is "ZZ-e2e"
    And config.json5 contains tabPrefix "ZZ-e2e" under "velocetty.golden-path-demo"

  Scenario: Another plugin's namespace is untouched
    Given config.json5 holds a commented entry for "com.example.other"
    When the golden-path handle sets tabPrefix
    Then the bytes of the "com.example.other" entry are unchanged

  Scenario: A wrong-kind value falls back for that key only
    Given tabPrefix is stored as 42 and message as "hello"
    When Velocetty starts
    Then the tab prefix is "GP", the message is "hello"
    And a notification names "velocetty.golden-path-demo.tabPrefix"

  Scenario: A malformed namespace does not reset other settings
    Given config.plugins["velocetty.golden-path-demo"] is true and fontSize is 17
    When Velocetty starts
    Then fontSize is 17 and the golden-path settings are the defaults

  Scenario: An invalid identifier is ignored, not erased
    Given config.plugins["Com.Example"] is { a: 1 }
    When Velocetty starts and a golden-path setting is written
    Then a diagnostic names "Com.Example" and its text is still in the file

  Scenario: Writes refuse on an unparsable file
    Given config.json5 contains a syntax error
    When the golden-path handle sets tabPrefix
    Then the outcome is refused and the file bytes are unchanged
```

## Plan of work

### `EP-M0` LemmaScript feasibility probe (prototype)

Question: can `lsc` 0.6.5 with the Dafny backend lower a `Record<string, Entry>`
spread update and a key-wise resolution loop, and prove `INV-SET-FRAME` and
`INV-DEFAULT-TOTAL` with no `extern` beyond the admitted one? Install
dependencies, then write a scratch module under `/tmp/lsc-probe-3-2-2/` (not
in the repository). It should contain `setSetting` and `resolveSettings` with
two `//@ ensures` clauses each. Run `bunx lsc gen --backend=dafny` and
`bunx lsc check --backend=dafny` on it, using the repository's Dafny and Z3
(`bin/prove.sh` documents the version checks). Decide go if both contracts
verify within the 60-second timeout limit; otherwise no-go. On a no-go, record
the transcript, set the status to `BLOCKED`, and present the `D-10` options.
The probe is deleted. Only its transcript goes into `Artefacts and notes`.

### `EP-M1` Plugin identifier grammar and ADR 009 (Proposed)

Assigned: `REQ-ID`, `GAP-ID`, `D-2`, `D-11`. Red: add
`test/unit/plugin-id.test.ts` (the table above) and
`test/unit/plugin-id.property.test.ts` with its arbitraries and coverage
guard. They fail because `app/config/plugin-id.ts` does not exist. Green:
create `app/config/plugin-id.ts` with:

```ts
export type PluginId = string & {readonly __brand: 'PluginId'};
export type PluginIdRejection = Readonly<{
  kind: 'invalid-plugin-id';
  value: string;
  reason: 'length' | 'characters' | 'segments';
}>;
export const parsePluginId = (value: string):
  Readonly<{ok: true; id: PluginId}> | Readonly<{ok: false; rejection: PluginIdRejection}> => ...;
export const isReservedPluginId = (id: PluginId): boolean => ...; // `velocetty.` prefix
```

Replace the unvalidated `PluginId` brand and the `pluginId()` constructor in
`app/runtime/plugin-runtime-json5-roundtrip.ts` with this type, and update
every caller together (`plugin-runtime.ts` and its tests). Add a test that
every entry of `runtimePluginManifests` (`app/runtime/golden-path-demo.ts`)
parses, and that the `shared/` copy's ID is identical. Write
`docs/adr-009-plugin-settings-namespace.md` with status `Proposed`, covering
`D-1` to `D-5` and `D-7` to `D-8`. Refactor: keep `parsePluginId` free of
regex look-behind, to stay portable across engines. Gates: `make check-fmt`,
`make typecheck`, `make lint`, `make test`, and `make markdownlint`.

### `EP-M2` Verified settings policy

Assigned: `REQ-DEFAULTS`, `REQ-ISOLATION`, `D-4`, `D-10`. Red: write
`test/unit/plugin-settings-policy.test.ts` (named examples for each
invariant), the property suite, the coverage guard, and the model test. They
fail on the missing module. Green: create
`app/config/plugin-settings-policy.ts` (pure, at most 400 lines) with:

```ts
export type SettingKind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
export interface SettingPayload { /* opaque to the proof */ }
export type SettingEntry = Readonly<{kind: SettingKind; payload: SettingPayload}>;
export type PluginSettings = Readonly<Record<string, SettingEntry>>;
export type SettingsNamespace = Readonly<Record<string, PluginSettings>>; // keys are parsed PluginIds
export function resolvePluginSettings(defaults: PluginSettings, stored: PluginSettings): PluginSettings;
export function kindMismatches(defaults: PluginSettings, stored: PluginSettings): readonly string[];
export function setPluginSetting(ns: SettingsNamespace, id: string, key: string, entry: SettingEntry): SettingsNamespace;
export function resetPluginSetting(ns: SettingsNamespace, id: string, key: string): SettingsNamespace;
```

The exact shape of the opaque payload type follows the `EP-M0` outcome. Add
the `//@ ensures` contracts listed in `Invariants and lemmas`. Add
`app/config/plugin-settings-policy.ts 30` to `LemmaScript-files.txt`. Run
`bunx lsc regen --backend=dafny app/config/plugin-settings-policy.ts`, then add
the proof lemmas and witnesses to `.dfy` as additions only, and run
`bun bin/generate-dafny.mjs`. Seeded faults are applied and reverted as the
verification plan describes. Gates: the four standard gates plus
`make prove`.

### `EP-M3` Read path

Assigned: `REQ-DEFAULTS`, `REQ-ISOLATION`, `REQ-PRESERVE`,
`GAP-DEFAULT-WRITE`, `GAP-MERGE-SPLIT`, `GAP-FAIL-WIDE`, `GAP-RELOAD`, `D-3`,
`D-5`, `D-7`. Red: write
`test/unit/plugin-settings-resolution-behaviour.test.ts`. It drives
`_import('startup')` and `_import('reload')` through injected sources and a
recording filesystem, and asserts the BDD scenarios "Defaults apply without
writing", "wrong-kind fallback", "malformed namespace", and "invalid
identifier". It also asserts that `getProfileConfig` cannot override
`plugins`. Green:

1. Create `app/config/plugin-settings-codec.ts` (adapter-side, pure).
   `jsonKind(value: JsonValue): SettingKind` classifies kinds.
   `decodeNamespace(raw: unknown): {namespace: SettingsNamespace; issues: PluginSettingsIssue[]}`
   applies `parsePluginId` and the object-entry check. `encodeSettings`
   converts back to `JsonObject`.
2. Create `app/config/plugin-settings-resolution.ts`.
   `resolveConfiguredPluginSettings(raw, manifests)` returns resolved
   `Record<PluginId, JsonObject>` for registered manifests, plus issues
   (identifier, non-object, kind mismatch). Call it from the configuration
   composition, so `parsedConfig.config.plugins` holds resolved settings for
   registered plugins. Inject the manifest list from the composition root
   (`app/config.ts`), not by importing `app/runtime` into `app/config/init.ts`.
3. Report issues through the existing configuration notification path, the
   `ConfigImportNotify` used by `_init`. Send one notification per import that
   names the first issue's path, such as
   `config.plugins["velocetty.golden-path-demo"].tabPrefix`, with a suggested
   fix, and log the rest with structured fields `path`, `message`, and
   `suggestedFix`.
4. Change `pluginSettingsNamespace` in `shared/src/types/config.ts` (and its
   `typings/config.d.ts` re-export if any) to `Record<string, JsonValue>`, then
   run `bun run generate-schema` and commit the regenerated schemas.
5. Delete `ensureRuntimePluginSettingsPersisted`, the start-up hook in
   `app/plugins.ts`, and `getRuntimePluginSettings`'s deep merge. Callers
   (`golden-path-message.ts`, `isRuntimePluginManifestEnabled`) read the
   resolved `config.plugins[id]`.
6. In `lib/utils/plugins.ts`, replace `resolveRuntimePluginSettings`'s spread
   with a direct read of `config.plugins[manifest.id]` (net lines must not
   grow).
7. Add `plugins` to the profile-scope registry in
   `app/config/reloadability-registry.ts` with classification `live`. Use a
   distinct key, or the existing scope mechanism, so it is not confused with
   the top-level npm list. Add a registry test.

Delete or rewrite the old tests in `test/unit/runtime-plugin-settings.test.ts`
that assert materialization. Keep the formatting-preservation cases for
`EP-M4`. Gates: the four standard gates plus `make prove`.

### `EP-M4` Write path

Assigned: `REQ-RESTART`, `REQ-PRESERVE`, `REQ-HEX`, `GAP-WRITE`, `D-8`,
`D-9`.

Refactor first, as a separate commit. Move the temporary-file and rename steps
(`planReplacement`, `commitWrite`, the symlink and read-only checks, and the
start-up stale-temporary cleanup) out of `app/config/keybindings-store.ts` into
`app/config/atomic-text-file.ts`, parameterized by file name. The keybindings
store suite must pass unchanged before and after.

Red: write `test/unit/plugin-settings-store.contract.test.ts`,
`test/unit/plugin-settings-patch.property.test.ts`, and
`test/unit/plugin-settings-service.test.ts` (handle scoping, outcomes, and a
"fresh import after set" restart test). Green:

1. `app/config/plugin-settings-ports.ts` defines the following types.
   `PluginSettingsStore` has
   `writeSetting(id: PluginId, key: string, value: JsonValue | undefined): PluginSettingsWriteOutcome`,
   where `undefined` means reset. The outcome is one of `written`,
   `unchanged`, `refused` (with a reason of `missing`, `unreadable`, or
   `invalid`), or `failed` (with a failure of `permission` or `other`), as a
   discriminated union on `status`.
   `PluginSettingsHandle` has `get(): JsonObject`,
   `set(key: string, value: JsonValue): PluginSettingsWriteOutcome`, and
   `reset(key: string): PluginSettingsWriteOutcome`.
2. `app/config/plugin-settings-store.ts` is the file adapter. It reads the
   text, parses strictly (`parseConfigJson5Strict`), and refuses on failure.
   It builds the new namespace with `setPluginSetting` or
   `resetPluginSetting`, so the policy decides what changes. It patches only
   `config.plugins[id][key]` through a single-path setter (or deleter) added
   to `plugin-runtime-json5-roundtrip.ts`, and writes with
   `atomic-text-file.ts`. When the patch equals the original text, the outcome
   is `unchanged` and nothing is written.
3. `app/config/plugin-settings.ts` is the service.
   `createPluginSettingsService({store, readResolved})` returns
   `{forPlugin(id: PluginId): PluginSettingsHandle}`. `get` returns the
   currently resolved settings. `set` and `reset` delegate to the store; the
   reload that follows makes the value live.
4. Compose the service in `app/config.ts`, next to the keybindings service.
   Suppress the "Configuration updated" toast for the service's own write
   through the watched-file reconciler when feasible (see `Risks`).
5. Delete `setRuntimePluginEnabledPersisted`. Its single-key write is now
   `forPlugin(id).set('enabled', false)`.

Gates: the four standard gates plus `make prove`.

### `EP-M5` End-to-end scenarios

Assigned: `REQ-RESTART`, `REQ-ISOLATION`, `REQ-PRESERVE`. Add a marker,
`plugin-settings`, that the composition emits after each import. It carries
the golden-path `tabPrefix` and an import status, through
`app/config/e2e-marker-sink.ts`. Add a plugin-settings probe, started only
from `app/e2e-entry.mts`, that reads `set` and `reset` requests from a request
file (mirroring `startShortcutProbe`) and calls the service's golden-path
handle. Write `test/e2e/plugin-settings.e2e.test.ts` covering the BDD
scenarios at application level. One scenario runs three launches: defaults
with no write; then set, relaunch, and persisted; then the bytes of a
`com.example.other` entry with comments unchanged. Others cover a wrong kind,
a malformed namespace with `fontSize` preserved, and an unparsable file
refusing the write. Assert on markers, file bytes, and modification time, not
on screenshots. Run `bun run test:e2e:fast` locally (headless recipe) and
confirm that the CI fast lane picks up the new file, because `test:e2e:run`
runs the whole directory.

### `EP-M6` Documentation closure

Assigned: `REQ-DOCS`, `GAP-DOC-SHAPE`, `D-11`.

- `docs/velocetty-design.md` §Plugin settings persistence: correct the example
  to `config: { plugins: { ... } }`. State the identifier grammar,
  read-time defaults, per-key kind fallback, per-plugin failure isolation, and
  the handle API. Link ADR 009. Add an "Implemented storage (roadmap 3.2.2)"
  paragraph, as 3.2.1 did. Remove nothing from §Outstanding decisions that is
  still open.
- `docs/adr-009-plugin-settings-namespace.md`: set to `Accepted` with the date
  and the delivering plan, and add known limitations (last-writer-wins race,
  shallow resolution, legacy plugins outside the namespace).
- `docs/configuration-architecture.md`: add a "Plugin settings" subsection
  after "Plugin loader" (policy, codec, resolution, ports, store, service, and
  probe), a row in Table 1, the data flow for read and write, and the proof
  boundary. Widen the module-location invariant in the header to include the
  new `app/config/plugin-settings*` modules.
- `docs/developers-guide.md`: in Configuration format practice and Layering
  rules, cover the identifier grammar, "defaults are never persisted", how a
  bundled plugin declares defaults, how host code obtains a handle, the
  test-suite names, and the proof entry. Fix the precedence list so plugin
  defaults appear for settings, not only for keybindings.
- `docs/users-guide.md`: add a "Plugin settings" section. Cover where they
  live, an example, how to return a setting to its default (delete the key),
  what happens with a wrong-kind value or a malformed entry, and that settings
  are not per-profile. Note the 1.3.1 materialized values.
- `PLUGINS.md`: point plugin authors to the namespace and identifier rules.
- `docs/tracking-issues.md`: add `CONFIG-CLI-001` (the CLI `save` drops
  comments) and any deferral found during implementation.
- `docs/roadmap.md`: mark `3.2.2` and its sub-items done.

Gates: `make check-fmt`, `make lint`, `make test`, `make markdownlint`,
`make nixie`, and `make spelling`. Then reconcile `Conformance basis` and set
this plan to `COMPLETE`.

## Milestones and plateaus

- `EP-M0`: a documented go or no-go. No repository change. Recovery: none
  needed. Compatibility decision: none.
- `EP-M1`: a validated `PluginId` used everywhere a plugin identifier enters
  persistence. ADR 009 is Proposed. Evidence: the identifier tests pass and
  the manifest-ID test passes. Conformance check: `REQ-ID` is satisfied; the
  design is followed; no persisted-format change; no new public interface
  beyond application-internal modules. Recovery: revert the milestone
  commits. Remaining: resolution and writes. Compatibility: none, because
  callers change together.
- `EP-M2`: a pure, proved policy with no callers yet, which is a coherent
  library plateau. Evidence: `make prove` passes, and the property, model, and
  seeded-fault transcripts are recorded. Conformance check: `REQ-DEFAULTS`
  and `REQ-ISOLATION` are proved for the policy; the axioms are unchanged.
  Recovery: revert. Remaining: integration. Compatibility: none.
- `EP-M3`: the application reads resolved settings and never writes at
  start-up. Evidence: the behavioural suite passes; the golden-path message
  and tab decoration use resolved values. Conformance check:
  `GAP-DEFAULT-WRITE`, `GAP-MERGE-SPLIT`, `GAP-FAIL-WIDE`, and `GAP-RELOAD`
  are closed. Persisted format: the schema is relaxed (a compatible
  widening). Recovery: revert. Remaining: writes. Compatibility: none.
- `EP-M4`: an atomic, formatting-preserving `set` and `reset` behind a port.
  Evidence: the contract, patch-property, and service suites pass, and the
  keybindings suite is unchanged. Conformance check: `REQ-RESTART` (unit
  level), `REQ-PRESERVE`, and `REQ-HEX`. Recovery: revert the feature commits
  independently of the refactor commit. Remaining: E2E. Compatibility: none.
- `EP-M5`: application-level evidence. Evidence: the E2E suite passes
  locally, and in CI when the PR runs. Conformance check: all `REQ-*` items
  are observed end to end. Recovery: revert the probe and the test.
- `EP-M6`: documentation matches the behaviour, and the roadmap is updated.
  Conformance check: `REQ-DOCS`; `GAP-DOC-SHAPE` is closed.

## Concrete steps

Working directory: the repository root of this worktree. A fresh worktree has
no `node_modules`. Run `bun install`; if `postinstall` fails on a stale npm
cache, run `npm install` inside `app/` and retry. Rebuild `node-pty` for E2E as
`docs/developers-guide.md` describes.

Focused red and green, for example in `EP-M1`:

```plaintext
Red:   bun test test/unit/plugin-id.test.ts      -> error: Cannot find module '../../app/config/plugin-id'
Green: bun test test/unit/plugin-id.test.ts      -> all cases pass, 0 fail
Red:   bun test test/unit/plugin-settings-policy.test.ts -> missing module
Green: same command -> pass; then `make prove` -> "app/config/plugin-settings-policy.ts ... verified, 0 errors"
```

The gate sequence after each milestone, run sequentially with `pipefail`.
Logs go to `/tmp`:

```bash
set -o pipefail
b=3-2-2-persist-plugin-settings-under-namespaced-keys
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-$b.out
make typecheck 2>&1 | tee /tmp/typecheck-velocetty-$b.out
make lint      2>&1 | tee /tmp/lint-velocetty-$b.out
make test      2>&1 | tee /tmp/test-velocetty-$b.out
make prove     2>&1 | tee /tmp/prove-velocetty-$b.out          # from EP-M2
bun run test:e2e:fast 2>&1 | tee /tmp/e2e-velocetty-$b.out     # EP-M5 onwards
make markdownlint 2>&1 | tee /tmp/markdownlint-velocetty-$b.out # documentation changes
make nixie     2>&1 | tee /tmp/nixie-velocetty-$b.out           # documentation changes
```

If `make spelling` regenerates `typos.toml` with changes unrelated to this
work, commit that file separately, as `AGENTS.md` (Spelling) requires.

## Validation and acceptance

Behavioural acceptance:

- Starting with no plugin entry shows the golden-path prefix `GP`, and the
  `config.json5` bytes and modification time stay unchanged across the launch.
- Setting `tabPrefix` through the handle (the E2E probe) to `ZZ-e2e` changes
  the prefix live. After a relaunch the prefix is still `ZZ-e2e`, and the file
  contains it under `"velocetty.golden-path-demo"`.
- A commented `com.example.other` entry is byte-identical after the write.
- `tabPrefix: 42` gives `GP` plus a notification naming the path. A
  `true` namespace keeps `fontSize: 17`.

Quality criteria:

- Tests: `make test` passes, including every new suite named above, and
  `bun run test:e2e:fast` passes.
- Verification: `make prove` passes with `app/config/plugin-settings-policy.ts`
  listed. The seeded-fault transcripts are recorded in `Artefacts and notes`.
- Lint and typecheck: `make check-fmt`, `make typecheck`, and `make lint` are
  clean, with no new suppressions without a stated invariant.
- Documentation: `make markdownlint`, `make nixie`, and `make spelling` are
  clean.

At each milestone boundary, record the conformance check from
`Milestones and plateaus` in `Progress`.

## Idempotence and recovery

Every gate and test command is re-runnable. The E2E and contract tests own
per-test temporary directories and never touch the user's real configuration
directory. Seeded faults are applied in the working tree only, observed, and
reverted before commit. Confirm with `git diff --stat` that no fault
survives. Each milestone is one or more commits, and the `EP-M4` refactor is
its own commit, so any milestone can be reverted alone. If `generate-schema`
leaves unexpected diffs, run it again on a clean tree and compare. CI
regenerates on checkout.

## Artefacts and notes

Planning-time evidence (reconnaissance, not implementation results):

```plaintext
app/config/schema.json (config block):
  "plugins": {"additionalProperties": {"additionalProperties": {"$ref": "#/definitions/JsonValue"}, "type": "object"},
              "description": "Namespaced plugin settings keyed by plugin identifier.", "type": "object"}
app/config/schema.json (top level):
  "plugins": {"description": "a list of plugins to fetch and install from npm ...",
              "items": {"type": "string"}, "type": "array"}
app/plugins.ts:87     ensureRuntimePluginSettingsPersisted();   // start-up write of defaults
lib/utils/plugins.ts:129  return {...manifest.settingsDefaults, ...candidate};  // renderer shallow merge
```

LemmaScript `SPEC.md` (upstream `main`, fetched 2026-11-16) lists these Dafny
lowerings: `{ ...map, [k]: v }` to `map[k := v]`;
`const { [k]: _, ...rest } = map` to a map comprehension;
`for (const [k, v] of Object.entries(m))` to a loop over `SetToSeq(m.Keys)`;
and `forall(k, P)`. `EP-M0` confirms these against the pinned `0.6.5`.

Prior art: the VS Code contribution-points reference for
`contributes.configuration` advises using the extension name as the prefix
for setting keys. Defaults are declared in the manifest and are not written to
`settings.json`. Ajv's `useDefaults` mutates data and skips `anyOf`, `oneOf`,
`not`, and `if`/`then`. That is one more reason not to use it for defaults
here.

## Interfaces and dependencies

No new dependencies. New application-internal modules, all in `app/config/`:

- `plugin-id.ts`: `PluginId`, `parsePluginId`, `isReservedPluginId`.
- `plugin-settings-policy.ts` (pure, proved): `SettingKind`, `SettingEntry`,
  `PluginSettings`, `SettingsNamespace`, `resolvePluginSettings`,
  `kindMismatches`, `setPluginSetting`, `resetPluginSetting`.
- `plugin-settings-codec.ts`: `jsonKind`, `decodeNamespace`, `encodeSettings`,
  `PluginSettingsIssue`.
- `plugin-settings-resolution.ts`: `resolveConfiguredPluginSettings`.
- `plugin-settings-ports.ts`: `PluginSettingsStore`, `PluginSettingsHandle`,
  `PluginSettingsWriteOutcome`.
- `plugin-settings-store.ts`: `createFilePluginSettingsStore({path, fs})`.
- `plugin-settings.ts`: `createPluginSettingsService`.
- `atomic-text-file.ts`: extracted from `keybindings-store.ts`.
- `e2e-plugin-settings-probe.ts`: started only from `app/e2e-entry.mts`.

Reuse policy. Identifier parsing has one owner (`plugin-id.ts`); no other
module may brand a `PluginId` by cast. Kind classification has one owner (the
codec). Resolution has one owner (the policy, called only from
`plugin-settings-resolution.ts`). The renderer must not re-implement it.
JSON5 patching goes only through `plugin-runtime-json5-roundtrip.ts`, and the
parser must not grow. Atomic file replacement goes only through
`atomic-text-file.ts`.

Modified: `app/runtime/plugin-runtime.ts`,
`app/runtime/plugin-runtime-json5-roundtrip.ts`, `app/runtime/golden-path-message.ts`,
`app/plugins.ts`, `app/config.ts`, `app/config/init.ts` (or the import
composition), `app/config/reloadability-registry.ts`,
`app/config/keybindings-store.ts`, `app/e2e-entry.mts`,
`app/config/e2e-marker-sink.ts`, `lib/utils/plugins.ts`,
`shared/src/types/config.ts`, the generated schemas, and
`LemmaScript-files.txt`.

## Revision note

- 2026-11-16: initial draft from Wyvern reconnaissance and prior-art research.
