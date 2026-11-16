# 3.2.2 Persist plugin settings under namespaced keys

This ExecPlan (execution plan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT (expert design review applied; awaiting user approval;
implementation must not begin)

Branch: `3-2-2-persist-plugin-settings-under-namespaced-keys`

Roadmap item: `3.2.2` in `docs/roadmap.md`.

## Purpose / big picture

Velocetty is a terminal emulator derived from Hyper. It is an Electron
application: a main process (`app/`) owns files and configuration, and a
renderer process (`lib/`) draws the user interface (UI). Plugins can contribute
commands, keybindings, tab decorations, and *settings*. A plugin setting is a
named value that the user may change and that must still be there after
Velocetty restarts, such as the prefix a plugin writes in front of tab titles.

Roadmap item `1.3.1` shipped one bundled "golden path" demonstration plugin,
with the identifier `velocetty.golden-path-demo`. It already reads settings from
`config.json5` under `config.plugins["<plugin-id>"]`, but that first cut has
six defects:

1. Nothing defines what a plugin identifier, or a setting key, may look like.
   Two plugins could share a namespace, an identifier or key such as
   `__proto__` could reach object-key code, and `Foo.Bar` and `foo.bar` would
   be different plugins.
2. Every start-up, `ensureRuntimePluginSettingsPersisted`
   (`app/runtime/plugin-runtime.ts`) rewrites the user's `config.json5` to copy
   the plugin's default values into it. The user never asked for that write.
   The copied defaults then freeze: if a later plugin version changes a
   default, users who never touched the setting keep the old value.
3. The main process and the renderer apply defaults differently. The main
   process deep-merges with `lodash/merge`. The renderer
   (`resolveRuntimePluginSettings` in `lib/utils/plugins.ts`) spreads
   shallowly. The two copies of the manifest also already disagree: the
   renderer copy falls back to the default object, while the main copy
   hard-codes `'GP'`.
4. One malformed plugin entry, such as `"velocetty.golden-path-demo": true`,
   fails schema validation for the whole of `config.json5`. Every setting then
   falls back to the bundled defaults, not only that plugin's settings.
5. The only programmatic writer, `setRuntimePluginEnabledPersisted`, has no
   production caller. It writes with a plain `writeFileSync`, so a crash
   mid-write can leave a truncated configuration file. It would also write into
   a legacy Hyper `hyper.json` that Hyper itself may still be reading.
6. Resolved values are not protected on their way to the renderer. Legacy
   `decorateConfig` hooks run over the whole configuration and can replace
   `config.plugins` before the renderer reads it.

After this change:

- A plugin identifier is a lowercase, dotted, reverse-DNS-style name, such as
  `velocetty.golden-path-demo` or `com.example.git-branch`. A setting key is a
  short ASCII word, such as `tabPrefix`. Anything else is rejected with a
  diagnostic, and the stored text is left alone.
- Plugin settings live in `config.json5` at
  `config.plugins["<plugin-id>"].<key>`. Only values that someone changed are
  stored. Defaults come from the plugin's manifest every time settings are
  read, and are never written into the file.
- If a stored value is not acceptable, the default applies to that one key and
  the problem is reported once. For example, the stored value might have the
  wrong JSON kind (a number where a string is expected), or be a non-finite
  number. The plugin's other settings, and every other plugin's settings, are
  unaffected.
- The main process resolves settings once, while it composes the
  configuration. The renderer receives the resolved values with the
  configuration it already gets, protected from legacy decorators, so both
  processes always agree.
- A host-side service gives each plugin a handle scoped to its own namespace,
  with `get`, `set`, and `reset`. The handle cannot name another plugin. A
  `set` or `reset` patches only that value in `config.json5` and keeps the
  user's comments and formatting. Before writing, it checks the patched text,
  then writes atomically: a temporary file, flushed to disk, renamed over the
  original. It refuses, with a typed reason, whenever writing could lose or
  corrupt the user's data.

A user can observe the change:

- Start Velocetty with a `config.json5` that has no plugin entry. The tab title
  reads `[GP] Shell`, and the file's bytes do not change.
- Edit the file to set `config.plugins["velocetty.golden-path-demo"].tabPrefix`
  to `"ZZ-e2e"`. The title becomes `[ZZ-e2e] Shell`, and it still reads
  `[ZZ-e2e] Shell` after a restart.
- Set the value to `42` instead. The title falls back to `[GP] Shell`, and one
  notification names `config.plugins["velocetty.golden-path-demo"].tabPrefix`.

The following behaviour is preserved:

- The top-level `plugins` and `localPlugins` arrays, which are the npm plugin
  lists inherited from Hyper.
- The legacy `decorateConfig` hook, for every key except the resolved plugin
  namespace.
- Keybinding storage in `keybindings.json5`.
- The start-up creation of `config.json5` when it is missing.

The following behaviour changes deliberately:

- Start-up no longer writes plugin defaults.
- A malformed plugin entry no longer invalidates the whole file.
- The renderer no longer merges defaults itself.
- Undeclared keys are no longer visible to the plugin, although they stay in
  the file.

This plan closes a design gap. `docs/velocetty-design.md` §Plugin settings
persistence shows the namespace as a top-level `plugins` object, which collides
with Hyper's top-level `plugins` array. The plan also supplies the storage and
default contract that roadmap `5.2.1` (schema-driven plugin settings panels)
`Requires`.

## Constraints

- Implementation begins only after the user explicitly approves this plan.
- Do not change the meaning or shape of the top-level `plugins` and
  `localPlugins` arrays in `config.json5`. Do not change the `rawConfig` fields
  `plugins?: string[]` and `localPlugins?: string[]` in
  `shared/src/types/config.ts`. Do not change any consumer of those arrays
  (`app/plugins.ts`, `cli/api.ts`, `lib/transport/ipc-schemas.ts`).
- The plugin settings namespace stays at `config.plugins`, inside the
  `config` block. No top-level object named `plugins` may be introduced.
- The generated editor schema (`shared/schemas/schema.json`, copied to
  `app/config/schema.json` and into the user's configuration directory) keeps
  describing `config.plugins` as an object of objects, so editors still flag
  mistakes. Only the runtime validator is relaxed (`D-5`).
- Do not change the legacy Hyper plugin API (the `decorate*` hooks and
  `getDecoratedConfig`), except that `getDecoratedConfig` restores the resolved
  namespace after decoration (`D-7`). Legacy npm plugins run with Node.js
  access, so the isolation in this plan is an API-level guarantee of the
  runtime plugin contract, not a security sandbox against them.
- `keybindings.json5` storage, `app/config/keybindings-policy.ts`, and its
  proof keep their behaviour. The only permitted changes in that area are the
  behaviour-preserving extraction of the atomic text-file write (`EP-M4`) and
  the generalization of `bin/prove.sh` from one required policy source to a
  required list (`EP-M2`). The existing keybindings and `prove-guards` suites
  guard both.
- Start-up and reload must never write `config.json5` to apply plugin
  defaults. The only plugin-settings writes are explicit `set` and `reset`
  calls.
- A plugin-settings write must refuse without touching the file when any of
  these hold:
  - the file is missing, unreadable, unparsable, or fails the configuration
    schema;
  - the active file is in the legacy Hyper tree, or is named `hyper.json`;
  - the plugin's namespace is not an object;
  - the file has more than one hard link;
  - the patched text does not re-parse to exactly the intended change;
  - the file changed between the read and the rename.
- Pure policy modules must not import Electron, the filesystem, the clock, or
  the logger, following `app/config/keybindings-policy.ts`. This is the
  hexagonal separation: policy, then ports, then adapters.
- `app/` main-process modules take only `import type` from `@shared/*`
  (`docs/developers-guide.md`, "Package boundaries", enforced by
  `bun run check:boundaries`). The renderer (`lib/`) must not import `app/`
  except where `scripts/check-package-boundaries.mjs` already allows it.
- No code file may exceed 400 lines (`AGENTS.md`). For files already over the
  limit (`lib/utils/plugins.ts`, `app/plugins.ts`,
  `app/config/json5-config.ts`, and `plugin-runtime-json5-parser.ts`), each
  edit must add no more lines than it deletes. Check with
  `git diff --numstat "$base" -- <file>`, where additions must not exceed
  deletions.
- Do not add a dependency. `fast-check` `^4.10.2`, `lemmascript` `0.6.5`,
  `json5`, `ajv`, and `zod` are already present.
- `bin/prove.sh` admits exactly one trust construct,
  `function {:axiom} emptyUserKeymaps()`. The new proof must not need another
  axiom or `extern`; if it does, stop and escalate. The policy must not take a
  value import from another module, because LemmaScript turns a cross-file
  value import into an automatic `extern` axiom.
- Tests obey the concurrent-suite rules in `docs/developers-guide.md`
  (Testing): no `mock.module`, no file-scope mutable mocks, no `process.env`
  mutation, per-test temporary directories, and injected seams for the
  filesystem, clock, and logger.
- Documentation uses en-GB-oxendict spelling and follows
  `docs/documentation-style-guide.md`. Completed historical ExecPlans are not
  edited.
- Compatibility: every affected source interface is application-internal and
  pre-1.0, so callers change together, with no aliases or shims. The persisted
  format changes compatibly: files written by 1.3.1 remain valid (`D-6`).

## Tolerances (exception triggers)

Exclude this ExecPlan file from every count. The comparison base is the merge
base with `origin/main` (`9c2d84ba` when this plan was drafted). Count with:

```bash
base=$(git merge-base HEAD origin/main)
git diff --numstat "$base" -- . ':!docs/execplans/*' ':!**/*.dfy.gen' \
  ':!shared/schemas/*.json' ':!app/config/schema.json'
git diff --name-only "$base" -- . ':!docs/execplans/*' | wc -l
```

Files are classified whole:

- Code: `app/**`, `lib/**`, `shared/src/**`, `cli/**`, `bin/**`, `scripts/**`,
  `test/**`, and `typings/**`.
- Proof: `app/config/plugin-settings-policy.dfy`, which is maintained by hand.
  It counts towards the code budget, with its own sub-limit.
- Configuration: `LemmaScript-files.txt`, `package.json`, `biome.json`,
  `tsconfig*.json`, `.github/**`, and `typos.local.toml`.
- Documentation: `docs/**` (excluding ExecPlans), `PLUGINS.md`, and
  `README.md`.
- Generated files: `*.dfy.gen`, `shared/schemas/*.json`, and
  `app/config/schema.json`. They are excluded from line counts, included in the
  file count, and never edited by hand. This plan expects no schema
  regeneration.

Thresholds. Each is enforced independently; headroom in one never offsets an
overrun in another.

- Files: more than 50 non-ExecPlan files changed. A pure `git mv` counts once.
- Code: more than 3,600 net lines in total. These sub-limits also apply:
  - production code (code excluding `test/**`): 1,150 net lines;
  - tests: 2,300 net lines;
  - the `.dfy` proof: 450 lines.
- Configuration: more than 60 net lines.
- Documentation: more than 950 net lines.
- Interface: any change to an interface named in `Constraints`.
- Dependencies: any new package, or any changed version.
- Architecture: settings are resolved anywhere other than the injected
  composition in `app/config.ts`, a new axiom is needed in `bin/prove.sh`, or a
  renderer-side resolution is needed.
- Iterations: a gate still fails after three fix attempts.
- Time: `EP-M0` takes more than 3 hours, or any other milestone takes more
  than 6 hours.
- Ambiguity: two readings of the roadmap or the design would produce
  different persisted formats.

Budget survey:

- Live code that changes:
  - `app/runtime/plugin-runtime.ts` (280 lines): two writers removed, reads
    re-pointed.
  - The JSON5 round-trip, parser, and parsing-state files: moved into
    `app/config/`, with a single-path setter and deleter, end-of-line
    detection, and a validated brand added.
  - `app/plugins.ts`: start-up hook removed, decoration restore added, net
    lines negative.
  - `lib/utils/plugins.ts`: merge and fallback removed.
  - `app/config.ts`: composition.
  - `app/config/json5-config.ts`: runtime Ajv relaxation, net zero.
  - `shared/src/types/config.ts`: stored and resolved types split.
  - `lib/transport/ipc-schemas.ts` (190 lines): `plugins` field.
  - `app/config/keybindings-store.ts`: extraction.
  - `bin/prove.sh`: required-sources list.
  - `app/config/e2e-marker-sink.ts`: one marker.
  - The golden-path manifests: renderer fallback removed.
- New production modules: about seven, of 60 to 220 lines each, totalling
  about 950 lines, offset by about 200 deleted.
- Tests: about 2,100 lines, comprising unit, behavioural, property,
  coverage-guard, model-based, real-directory contract, and the two E2E lanes.
- Proof: about 400 lines.
- Documentation: about 700 lines, comprising ADR 009 (about 220), the design
  document (about 80), the users' guide (about 120), the developers' guide
  (about 150), the configuration architecture (about 90), `PLUGINS.md` (about
  20), the tracking issues (about 30), and the roadmap (about 6).

History:

- The nearest precedent is
  `docs/execplans/3-2-1-store-keybindings-in-keybindings-json5.md`. It set one
  combined budget of 58 files and 3,500 net lines of code and documentation,
  and recorded a single exception. The delivered diff was 90 files and 8,234
  net lines (7,692 without generated artefacts). It was within the limit
  without tests (3,447), and over it with the 4,245 lines of tests.
- That plan combined categories and under-counted tests. This plan counts
  tests inside the code budget, gives tests and the proof their own sub-limits,
  and sizes each sub-limit at about 1.1 to 1.2 times the estimate.
- Roadmap `1.3.1` recorded no comparable budget revision.

## Risks

- **LemmaScript lowering.** LemmaScript `0.6.5` may not give the
  `SetToSeq(m.Keys)` loop lowering enough preamble facts to prove loop
  equivalence without an `extern`. These facts are that keys are distinct and
  that every key is covered. Severity: high. Likelihood: medium. Mitigation: the
  `EP-M0` probe decides this before any production code. On a no-go, stop and
  present the `D-10` options.
- **Toast on self-write.** A programmatic `set` changes `config.json5`, which
  the watcher reloads, announcing "Configuration updated". Severity: low.
  Likelihood: certain. Mitigation (`D-12`):
  - The service runs the import itself after a successful write, so the value
    is live when the promise resolves.
  - The service records the exact text it wrote. A watcher reload that reads
    that same text resolves and publishes without announcing, by text
    comparison as `settledWrittenStamp` does.
  - The reload marker gains an `announced` field so tests can observe this.
- **Lost update when the user edits.** The user may edit `config.json5` in an
  editor while `set` runs. Severity: medium. Likelihood: low. Mitigation:
  compare-and-swap. Re-read the target immediately before the rename; if it
  differs from the text that was patched, delete the temporary file and return
  `refused: 'concurrent-edit'`. The remaining case cannot be prevented: an
  editor holding an unsaved buffer will later overwrite the write. The ADR's
  known limitations record this.
- **Parser divergence.** The handwritten JSON5 parser takes the first of two
  duplicate keys, but `JSON5.parse` keeps the last. Severity: high. Likelihood:
  low. Mitigation: the store verifies every patch at run time
  (`INV-PATCH-PRESERVE`). If the patched text does not re-parse to exactly the
  intended change, it returns `refused: 'unpatchable'`.
- **Writing into Hyper's file.** A write could land in a file Hyper still
  reads. Severity: high. Likelihood: medium. Mitigation: refuse with
  `legacy-tree` (`D-9`). The refusal notification points at the move
  instructions in ADR 008.
- **Notification spam.** A persistent bad value could notify on every reload.
  Severity: medium. Likelihood: high. Mitigation: notify only when the
  fingerprint of the set of issues changes from the previous import, and log
  every time (`D-13`).
- **Decorators replacing the namespace.** Legacy decorators could replace
  `config.plugins`. Severity: medium. Likelihood: low. Mitigation:
  `getDecoratedConfig` restores the frozen resolved namespace after decoration.
  A test uses a decorator that deletes `plugins`.
- **Changed start-up behaviour.** Removing the start-up default write changes
  behaviour for existing files. Severity: low. Likelihood: certain. Mitigation:
  values 1.3.1 materialized equal today's defaults. They stay frozen when
  defaults later change, which the users' guide and the ADR record as a known
  limitation. Deleting the key restores the live default, and roadmap `5.1.1`'s
  reset flows will give a UI for it. A 1.3.1 fixture test pins the read
  behaviour.
- **CLI drops comments.** `cli/api.ts` `save` rewrites `config.json5`
  canonically and drops comments. Severity: low (out of scope). Likelihood:
  medium. Mitigation: record `CONFIG-CLI-001` in `docs/tracking-issues.md`. The
  CLI reads the raw file, never resolved state, so it cannot copy defaults into
  the file.
- **E2E environment.** The E2E lanes need a working local Electron.
  Severity: medium. Likelihood: medium. Mitigation:
  - Use the headless recipe in `docs/developers-guide.md` (E2E).
  - Assert that the `[e2e] config-path` marker names the isolated Velocetty
    path before trusting any other marker.
  - Match markers on the probe value, not on the first marker seen.
  - Compare bytes, with modification time as a secondary check only.

## Progress

- [x] (2026-11-16T21:32Z) Reconnaissance (Wyvern team), prior-art research,
  and initial draft completed.
- [x] (2026-11-16T22:40Z) Six-expert design review completed; findings applied
  (see `Decision log` D-1 to D-16 and the revision note).
- [ ] Plan approved by the user.
- [ ] `EP-M0` LemmaScript feasibility probe: go/no-go recorded.
- [ ] `EP-M1` Identifier and key grammar, manifest contract, and ADR 009
  (Proposed).
- [ ] `EP-M2` Verified settings policy and `prove.sh` required-sources list.
- [ ] `EP-M3` Read path: resolution in composition, no start-up write,
  per-plugin failure isolation, renderer delivery.
- [ ] `EP-M4a` Refactor: move the JSON5 patcher into `app/config/` and extract
  the atomic text-file write.
- [ ] `EP-M4b` Write path: guarded, atomic, formatting-preserving `set` and
  `reset` behind a port.
- [ ] `EP-M5` End-to-end evidence in the fast and deep lanes.
- [ ] `EP-M6` Documentation closure, ADR acceptance, roadmap update.

At each milestone boundary, append a conformance line per affected requirement
to this section, in the form
`REQ-<name>: satisfied | advanced | unaffected — <evidence file or command>`.

## Surprises & discoveries

- Observation: much of the roadmap item already exists, and it conflicts with
  the design document. Evidence: `app/runtime/plugin-runtime.ts` lines 50–76
  and 186–280; `shared/src/types/config.ts:210`; the `config.plugins` entry in
  the generated schema; and §Plugin settings persistence in the design
  document, which shows a top-level `plugins` object. Impact: the plan
  formalizes and corrects code that exists, rather than building from scratch.
- Observation: `docs/developers-guide.md` (Layering rules) already says that
  plugin defaults are "runtime contributions, not persisted", but the code
  persists them. Impact: `D-3` brings the code into line with the guide.
- Observation: `config.json5` has no last-known-good fallback. A parse or
  schema failure makes the active configuration the bundled defaults
  (`loadUserConfig`, `app/config/import-sources.ts`). Impact: per-plugin
  failure isolation (`D-5`) matters more, because the schema is the gate that
  can discard every setting at once.
- Observation: `app/config/layering.ts` `resolveConfigLayers` and
  `createReloadHandler` (`reload-handler.ts`) have no production caller.
  `config.plugins` is already classified `live` by name collision with the npm
  list, because `getKeyScope` consults `PLUGIN_KEYS` first
  (`app/config/reloadability-registry.ts`). It is already redacted by
  `SENSITIVE_KEYS`. Impact: the reloadability registry is out of scope. The
  draft's `GAP-RELOAD` was withdrawn, and `RELOAD-002` is to be recorded in
  `docs/tracking-issues.md` (`EP-M6`).
- Observation: the two copies of the golden-path manifest disagree on the
  `tabPrefix` fallback. `shared/src/runtime/golden-path-demo.ts` uses the
  defaults object, while `app/runtime/golden-path-demo.ts` hard-codes `'GP'`.
  Impact: `EP-M1` adds a parity test, and `EP-M3` removes both fallbacks.
- Observation: the worktree had no `node_modules` while this plan was being
  drafted. Impact: `EP-M0` starts with `bun install` (see `Concrete steps`).

## Decision log

- D-1. Decision: keep the namespace at `config.plugins["<plugin-id>"]`, and
  correct the design document's top-level example. Rationale: the top-level
  `plugins` key is Hyper's npm list, and `validateStringArrayField`
  (`app/config/json5-config.ts`) rejects an object there. Putting the namespace
  at the top level would therefore discard the whole file. `config.plugins` is
  already implemented and documented. A useful property for ADR 009: an
  identifier must contain a dot, so an npm name such as `hyperpower` or
  `@org/x` can never collide with a settings namespace. Rejected alternatives:
  - Renaming the npm list. This breaks every configuration written for Hyper.
  - A separate host-owned `plugin-settings.json5`. This was the strongest
    alternative; see `D-15`.
- D-2. Decision: grammars.
  - A plugin identifier is `segment ("." segment)+` with
    `segment = [a-z][a-z0-9]*("-"[a-z0-9]+)*`. It is ASCII only, 3 to 128
    characters long, and has at least two segments. Its first segment must
    not be a Windows reserved device name (`con`, `prn`, `aux`, `nul`,
    `com1`–`com9`, `lpt1`–`lpt9`), because identifiers are expected to become
    `plugins/<id>/` directory names (design document §Plugin packaging).
    Segments that begin with a digit, such as `com.1password`, and `_` are
    excluded deliberately, for simplicity.
  - Uppercase is rejected, not folded, so no two accepted identifiers differ
    only by case.
  - The prefix `velocetty.` is reserved for plugins bundled with the
    application. Every manifest today is bundled and defined in code, so the
    reservation is a documented rule plus a manifest test. Enforcement at an
    external loader is tracked as `PLUGIN-ID-001`.
  - A setting key is `[A-Za-z][A-Za-z0-9_-]{0,63}`, excluding `constructor`,
    `prototype`, and `toString`. Keys are top-level names only: there are no
    dotted paths, because identifiers contain dots and `D-4` treats objects
    as atomic.
  - The grammars cover settings namespaces only. Command and tab-provider
    identifiers (`plugins:golden-path-demo:announce`,
    `${pluginName}.${providerId}`) are not derived from `PluginId` yet;
    `PLUGIN-ID-002` tracks that.

  Rationale: this matches the existing identifier and the design document's
  `com.example.git-branch`. It follows the publisher-qualified convention VS
  Code uses for extension settings ("Use the extension name as prefix"). The
  required dot excludes `__proto__`, `constructor`, and `prototype` from
  identifiers by construction. Rejected alternatives: npm names, which allow
  scopes and uppercase, and name an install source rather than a settings
  owner; and the 255-character, underscore-allowing grammars of D-Bus and
  Flatpak, which nothing here needs.
- D-3. Decision: defaults are applied at read time and never written into
  `config.json5`. Delete `ensureRuntimePluginSettingsPersisted` and its
  start-up call in `app/plugins.ts`. Rationale:
  - This matches the developers' guide and 3.2.1's rule that reloads never
    write.
  - VS Code also keeps manifest defaults out of `settings.json`.
  - It stops defaults freezing.

  Rejected alternative: continuing to materialize defaults, which writes
  without consent and can trigger a reload.
- D-4. Decision: resolution is shallow, key by key, and limited to declared
  keys.
  - For each key the manifest declares, the stored value is used when it is
    *acceptable*; otherwise the default is used, and the key is reported if
    it was stored.
  - In 3.2.2, a value is acceptable when its JSON kind matches the default's
    kind. The kinds are `null`, `boolean`, `number`, `string`, `array`, and
    `object`. A non-finite number (JSON5's `NaN` or `Infinity`) has no kind,
    so it is never acceptable.
  - A manifest may not declare a `null` default. The manifest test enforces
    this, because a `null`-kinded key could never be set.
  - Arrays and objects are atomic values. The kinds of array elements are not
    checked, which is a recorded limitation.
  - Undeclared stored keys are not exposed to the plugin. They stay in the
    file untouched.
  - Integer-ness, ranges, string lengths, and enumerations belong to roadmap
    `5.2.1`. That item replaces the acceptability predicate, computed by the
    adapter, with per-property schema validation. Because the proof is
    written over a precomputed acceptability, it needs no change when that
    happens.

  Rejected alternatives:
  - Deep merge. `lodash/merge` merges arrays by index, there is no sound kind
    rule for nested objects, and no plugin needs it.
  - Passing undeclared keys through. That would expose keys the plugin's
    schema forbids (`additionalProperties: false`).
  - Validating with Ajv now. Ajv compiles schemas into code, so an untrusted
    `pattern` in a third-party schema is a regular-expression
    denial-of-service vector; 5.2.1 must define a safe schema subset first.
- D-5. Decision: failure isolation is per plugin, and enforced at run time
  rather than by the schema.
  - `configOptionsSections()` in `app/config/json5-config.ts` overrides the
    `config.plugins` section to accept any JSON value before Ajv compiles it,
    so that file's net line count must not grow.
  - The codec then rejects, one plugin at a time, a non-object `config.plugins`
    (for example a Hyper user's `plugins: ['hyper-foo']` inside `config`), an
    invalid identifier, a non-object entry, or an invalid key.
  - Each rejected entry is reported and ignored, and its stored text is kept.
  - The generated editor schema stays strict (`Constraints`).

  Rejected alternatives:
  - Widening the generated schema. Editors would then stop flagging mistakes.
  - A `propertyNames` pattern in the schema. A single typo would then discard
    the whole file.
- D-6. Decision: no persisted-format migration. Values written by 1.3.1 are
  read as user-set values. That they stay frozen is a known limitation (see
  `Risks`). A fixture test written by 1.3.1 pins this.
- D-7. Decision: stored and resolved settings get separate types, and the
  main process alone resolves.
  - `rawConfig.config.plugins` has the type
    `StoredPluginSettings = Record<string, Record<string, JsonValue>>`. This is
    the editor contract that schema generation uses, and it is unchanged.
  - The composed `configOptions.plugins` has the type
    `ResolvedPluginSettings = Readonly<Record<string, Readonly<JsonObject>>>`.
    It holds the resolved values of every registered plugin, and nothing
    else. Unregistered and rejected entries are dropped from the composed
    view but stay in the file.
  - Resolution runs by wrapping the injected `_init` at its composition in
    `app/config.ts`. The wrapper reads `userCfg.config?.plugins` before
    `lodash/merge` runs, and writes `parsed.config.plugins`.
  - `getDecoratedConfig` restores the frozen resolved namespace after the
    legacy decorators run.
  - `lib/transport/ipc-schemas.ts` validates `plugins` as a record of
    records.
  - The renderer reads `config.plugins[id]`.
  - ADR invariant: no serializer ever sees resolved values. Export and save
    paths read the raw file. 5.1.2 export must do the same.

  Rejected alternatives:
  - A shared policy module in `shared/src`. `app/` cannot import it at run
    time, so it would have to be duplicated.
  - A separate `resolvedPluginSettings` field beside `config`. The renderer
    would need a new inter-process communication (IPC) channel.
- D-8. Decision: isolation of the write API is by capability.
  - `PluginSettingsService.forPlugin(id: PluginId)` returns a
    `PluginSettingsHandle` with:
    - `get(): {values; userSetKeys}`, a frozen snapshot;
    - `set(key, value): Promise<PluginSettingsWriteOutcome>`;
    - `reset(key): Promise<PluginSettingsWriteOutcome>`.
  - The outcome types are asynchronous now, so a later IPC-backed plugin
    runtime does not break the signature.
  - Wire rule for the future (ADR 009): when requests cross IPC, the host
    binds the plugin identifier from the loading context, never from the
    message payload.
  - A settings UI's authority over every plugin is a separate capability,
    which roadmap 5.2.1 designs.
  - The handle has no production caller until 5.2.1 and the plugin runtime.
    It is in scope because 5.2.1 `Requires 3.2.2` and needs a write contract.
  - This decision deliberately diverges from the design document's
    `settings.get(path)` and `set(path, value): Promise<void>`: keys are
    top-level, and outcomes are typed. The design document is updated in
    `EP-M6`.
- D-9. Decision: the write path.
  - The policy validates the request (`planSettingWrite`), and its result is
    the only input the store acts on.
  - The store patches only `config.plugins[id][key]`, using the JSON5 patcher
    moved into `app/config/config-json5-patch*.ts`.
  - The store re-parses the patched text and verifies the change at run
    time.
  - It writes atomically through the `atomic-text-file.ts` helper extracted
    from the keybindings store. The helper resolves symlink chains, refuses a
    read-only target, opens with `wx`, calls `fsync`, and retries the rename.
  - It refuses in the cases listed in `Constraints`.
  - Inserted text uses the document's own line endings.

  The two refactors are separate, behaviour-preserving commits (`EP-M4a`).
  Rejected alternative: a separate, non-atomic writer.
- D-10. Decision: proof design and escalation. The policy is written over
  kinds and acceptability, never over payloads. It returns per-key *choices*
  (`'stored'` or `'default'`) and write *plans*, and the adapter selects values
  by reference. This removes the draft's payload-equality axiom altogether.

  The proof covers:
  - `resolveChoices`, a loop proved equal to the separately written per-key
    specification `specChoice`;
  - `resolveNamespaceChoices`, a loop over the registered plugins;
  - `planSettingWrite`;
  - an isolation theorem stated as a fold over any sequence of write plans,
    in the way `replayKeybindingObservations` is.

  If `EP-M0` is a no-go, the options are:
  - (a) sorted entry arrays inside the policy;
  - (b) prove only `specChoice`, and cover the loops with model-based
    property tests;
  - (c) request approval for an `extern`.

  The plan escalates rather than choosing between them alone.
- D-11. Decision: ADR 009 records D-1 to D-5, D-7 to D-9, D-12 to D-13, and
  D-15. It is written as `Proposed` in `EP-M1` and set to `Accepted` in `EP-M6`.
- D-12. Decision: liveness after a self-write. After a successful write,
  `set` and `reset` run the configuration import through the composition root's
  `_import('reload')`, and resolve only once it publishes. The watcher's later
  reload of the same text does not announce (see `Risks`).
- D-13. Decision: diagnostics.
  - Paths are written in bracketed form, for example
    `config.plugins["velocetty.golden-path-demo"].tabPrefix`.
  - Each issue is logged as a structured line with the fields `path`,
    `message`, and `suggestedFix` on every import.
  - A user notification is sent only when the fingerprint of the set of
    issues changes.
  - Plugin issues count as "applied with warnings". They never trigger the
    whole-file `fallback` classification.
  - Each write outcome other than `written` is logged with its `status`,
    `reason`, tree, and path.
- D-14. Decision: `enabled` is a key the host reserves. Every runtime
  manifest must declare `enabled` with a boolean default (manifest test), and
  the host reads the resolved `enabled`. Ownership of enablement may move to
  the plugin index proposed in design document §Plugin packaging; ADR 009
  records this.
- D-15. Decision: a separate `plugin-settings.json5` file is considered and
  deferred, not adopted.

  What the alternative would gain:
  - It would avoid patching a file users write by hand.
  - It would remove the CLI clobber race.
  - It would make a future Tauri port simpler.

  Why it is deferred:
  - It contradicts the product requirements document ("Namespaced
    persistence into JSON5") and the design document.
  - It would split each user's settings across two files.
  - It would need a migration.

  Hedge: the `PluginSettingsStore` port carries nothing specific to
  `config.json5`, so moving storage later means swapping the adapter and
  migrating in the style of ADR 007. ADR 009 names the conditions for reopening
  this decision: routine writes from the 5.2.1 UI, `CONFIG-CLI-001` still open,
  or a move to Tauri.

- D-16. Decision: the E2E lanes use hand-edited files and do not drive the
  handle through a request-file probe. Rationale: `set` has no production
  caller until roadmap 5.2.1, so a probe that only tests use would cost about
  250 lines and several slow Electron launches. The restart behaviour of the
  write path is established by the model test, which writes through the real
  store to a real temporary file and then runs a fresh `_import`. When 5.2.1
  adds a UI caller, its E2E scenario drives `set` through that UI. Rejected
  alternative: an E2E-only probe started from `app/e2e-entry.mts`, as the draft
  proposed.

All decisions were made by the planning agent on 2026-11-16, informed by the
expert review panel.

## Outcomes & retrospective

Not started. Complete at each milestone and at closure.

## Context and orientation

Inspected base revision: `9c2d84ba` (`main`, 2026-11-16).

### Configuration load path

1. `setup()` in `app/config.ts` runs the start-up session
   (`app/config/startup-session.ts`), then `_import('startup')`
   (`app/config/import.ts`).
2. The watcher (`app/config/config-watch.ts`, chokidar, 100 ms debounce) calls
   `_import('reload')` when the file changes.
3. `loadUserConfig` (`app/config/import-sources.ts`) reads the file.
4. `parseJson5WithSchemaDiagnostics` (`app/config/json5-config.ts`, 413 lines)
   parses it with `json5`, then validates the `config` block with Ajv
   (`configOptionsValidator`, built from `configOptionsSections()`).
5. `_init` (`app/config/init.ts`) merges in `app/config/config-default.json`
   with `lodash/merge`. `app/config.ts` injects `_init` into the importer at
   about line 80.
6. `setCurrentConfig` publishes the result.
7. `app/ui/window.ts` sends `config change`.
8. In the renderer, `lib/utils/config.ts` `getConfig` calls
   `getDecoratedConfig(profileName)` (`app/plugins.ts`). That function runs the
   legacy `decorateConfig` hooks over a clone of
   `getProfileConfig(profileName)`.

Profiles cannot override `plugins`, because `profileConfigOptions` excludes it.

`locations.config` (`app/config/paths.ts`) gives the active file path and its
`tree`: `development`, `velocetty`, or `hyper` (ADR 008). The Hyper tree may
hold `config.json5` or `hyper.json`.

### Plugin settings today

`shared/src/types/config.ts:210` defines `pluginSettingsNamespace`. The
golden-path manifest exists twice:

- `shared/src/runtime/golden-path-demo.ts` is used by the renderer, for its tab
  providers.
- `app/runtime/golden-path-demo.ts` is used by the main process, because
  `app/` cannot import values from `@shared`.

The manifest declares `settingsDefaults` (`enabled: true`, `message`, and
`tabPrefix: 'GP'`) and a JSON-Schema-like `settingsSchema` (`minLength: 1`,
`additionalProperties: false`). The tab provider renders
`` `[${prefix}${activitySuffix}] ${baseTitle}` ``, for example `[GP] Shell`.

`app/runtime/plugin-runtime.ts` exports these functions:

- `getRuntimePluginSettings` deep-merges.
- `ensureRuntimePluginSettingsPersisted` runs once at start-up from
  `app/plugins.ts`, at about line 87.
- `setRuntimePluginEnabledPersisted` is called only by tests.

The two readers are `app/runtime/golden-path-message.ts` (main) and
`lib/utils/plugins.ts:125` (renderer).

`app/runtime/plugin-runtime-json5-roundtrip.ts` (245 lines) patches the text
through `plugin-runtime-json5-parser.ts` (839 lines) and
`plugin-runtime-json5-parsing-state.ts`. Its `pluginId(value)` brand validates
nothing. The parser takes the first of two duplicate keys. Today `app/config/`
imports nothing from `app/runtime/`, while the round-trip file imports
`../config/json5-config`.

### Precedent

3.2.1 split keybindings into these modules:

- a verified policy (`app/config/keybindings-policy.ts` with `.dfy` and
  `.dfy.gen`);
- ports (`keybindings-ports.ts`);
- a file adapter (`keybindings-store.ts`), which writes a temporary sibling,
  opens it with `wx`, writes in a loop, calls `fsync` and `chmod`, then renames
  through `keybindings-rename-retry.ts`;
- a service (`keybindings.ts`);
- a notifier;
- composition in `app/config.ts`.

`docs/configuration-architecture.md` documents that shape. The keybindings
proof earns its keep because a loop is proved equal to a separately written
specification (`keybindings-policy.dfy`, around lines 256–282), not because of
its definitions. This plan copies that.

### Definitions

- *Namespace*: the object at `config.plugins["<plugin-id>"]`.
- *Manifest*: the in-code description of a bundled plugin
  (`RuntimePluginManifest`).
- *Acceptable*: a stored value the adapter's predicate admits; in 3.2.2, one
  whose kind matches the default's kind.
- *Choice*: the policy's per-key decision, `'stored'` or `'default'`.
- *Write plan*: the policy's validated description of a single `set` or
  `reset`.
- *Frame property*: an update changes only the location it names.

### Tests and gates

- `make all` runs `check-fmt typecheck lint test spelling prove`.
- Unit, behavioural, model, and property tests live flat in `test/unit/`, run
  by `bun test --concurrent --isolate test/unit` (`make test`).
- Property tests use `fast-check` with fixed seeds, in files named
  `*.property.test.ts`. Each arbitrary has a `*.coverage.test.ts` guard
  requiring every interesting class to appear in more than 5 per cent of samples
  (`docs/developers-guide.md`, Property tests).
- Proofs: `LemmaScript-files.txt` lists `path timeout` lines, and
  `make prove` runs `bin/prove.sh`. The script:
  - requires Dafny 4.11.x and Z3 4.12.1;
  - checks that each `.dfy.gen` is fresh;
  - enforces the axiom allow-list;
  - requires one `Dafny program verifier finished with <N> verified, 0 errors`
    summary per listed source;
  - hard-codes `policy_source='app/config/keybindings-policy.ts'` as a
    required entry (line 15).

  `test/unit/prove-guards.test.ts` tests its guards.
- The fast E2E lane, `bun run test:e2e:fast`, uses Bun with `RUN_E2E=1` over
  the whole `test/e2e/` directory. It observes the app through stdout markers
  (`app/config/e2e-marker-sink.ts`). The template for restart evidence is "a
  relaunch reads the persisted edit and rewrites nothing" in
  `test/e2e/keybindings.e2e.test.ts`.
- The deep lane, `bun run test:e2e:deep`, runs Playwright over
  `test/e2e-deep/*.e2e.ts` and can read the rendered DOM. See
  `test/e2e-deep/terminal-input-path.e2e.ts`.
- The repository has no Gherkin runner. Behavioural tests are `bun:test`
  suites named `*-behaviour.test.ts`.

### Documentation to read first

- `docs/velocetty-design.md`: Configuration system, Plugin runtime, Plugin
  packaging, Schema-driven settings panels, and Plugin settings persistence.
- `docs/velocetty-product-requirements-document.md`, lines 60, 68 and
  177–181.
- `docs/configuration-architecture.md`.
- `docs/developers-guide.md`: Configuration format practice, Layering rules,
  Package boundaries, Testing, the LemmaScript proofs, and E2E.
- `docs/adr-007-keybindings-json5-storage.md` and
  `docs/adr-008-velocetty-configuration-directory.md`.
- `docs/documentation-style-guide.md`, lines 204–308, on ADRs.

### Skills to load

- `execplans`, to keep this plan current.
- `typescript-router`, then:
  - `typescript-boundaries-and-validation` and
    `typescript-errors-and-outcomes`, for grammars, the codec, and outcomes;
  - `typescript-data-and-state`, for the policy shapes.
- `hexagonal-architecture`.
- `typescript-testing`, `fast-check`, and `typescript-verification`.
- `lemmascript`.
- `electron-and-ipc`, for delivering configuration to the renderer and for
  the IPC schema.
- `en-gb-oxendict-style`.
- `commit-message` and `pr-creation`.

## Conformance basis

Upstream artefacts inspected at `9c2d84ba`:

- `docs/roadmap.md` 3.2.2 and its sub-items. Roadmap 5.2.1 and 5.1.1–5.1.2
  were read for downstream consistency.
- `docs/velocetty-design.md`: §Plugin settings persistence, §Plugin runtime,
  §Plugin packaging and installation, §Schema-driven settings panels, §Layering
  rules, and §Validation and error reporting.
- `docs/velocetty-product-requirements-document.md`: "Plugin-contributed
  settings (namespaced)", "Settings schema format (UI hints + validation +
  defaults)", and "Namespaced persistence into JSON5".
- ADR 007 and ADR 008. ADR 009 is new in this plan.
- The `docs/developers-guide.md` sections "Configuration format practice" and
  "Layering rules".
- No Terms of Reference document exists for this project.

Requirements:

- `REQ-NS`: plugin settings persist at `config.plugins["<plugin-id>"]` in
  `config.json5`, as one object per plugin.
- `REQ-ID`: plugin identifiers and setting keys have defined, validated
  grammars.
- `REQ-DEFAULTS`: a declared setting that is missing or not acceptable
  resolves to the manifest default.
- `REQ-RESTART`: a value stored by hand or through the handle is the resolved
  value after a restart.
- `REQ-ISOLATION`: a plugin's resolved settings depend only on its own
  namespace and manifest. A write through one plugin's handle changes no other
  namespace, whether in memory or in the file's bytes. A malformed namespace
  affects only its own plugin.
- `REQ-PRESERVE`: plugin-settings writes keep unrelated text, never happen at
  start-up or reload, and refuse in every case listed under `Constraints`.
- `REQ-HEX`: the pure policy is kept separate from ports and adapters.
- `REQ-DOCS`: the users' guide, developers' guide, configuration
  architecture, design document, and ADR all describe the behaviour.

Gaps:

- `GAP-DOC-SHAPE`: the design document's example puts the namespace at the top
  level.
- `GAP-ID`: there is no identifier or key grammar.
- `GAP-DEFAULT-WRITE`: start-up writes the defaults into the file.
- `GAP-MERGE-SPLIT`: the main process and the renderer merge differently, and
  the manifest copies disagree.
- `GAP-FAIL-WIDE`: one bad entry invalidates the whole file.
- `GAP-WRITE`: there is no write port, no atomic write, and no guard against
  the legacy tree.
- `GAP-DECORATE`: resolved values are not protected from legacy decorators.

Trace:

```plaintext
Roadmap "namespace conventions" -> REQ-NS, REQ-ID -> GAP-ID, GAP-DOC-SHAPE
  -> EP-M1, EP-M6 -> plugin-id.test.ts, plugin-id.property.test.ts, ADR 009
Roadmap "defaults applied when missing" -> REQ-DEFAULTS -> GAP-DEFAULT-WRITE, GAP-MERGE-SPLIT
  -> EP-M2, EP-M3 -> policy proof, plugin-settings-resolution-behaviour.test.ts, E2E fast lane
Roadmap "survive restart" -> REQ-RESTART, REQ-PRESERVE -> GAP-WRITE
  -> EP-M3, EP-M4b, EP-M5 -> plugin-settings-store.contract.test.ts, E2E fast lane relaunch
Roadmap "isolated per plugin" -> REQ-ISOLATION -> GAP-FAIL-WIDE, GAP-DECORATE
  -> EP-M2..EP-M5 -> isolation fold proof, plugin-settings-service.model.test.ts, E2E deep lane
Design §Plugin runtime PluginContext.settings -> REQ-HEX -> EP-M4b -> PluginSettingsHandle
```

## Verification plan

### Abstract model

Let `K` be setting keys that satisfy `D-2`, and `I` be valid plugin
identifiers. The policy never sees values. It sees:

- `declared: Set<K>` per plugin: the keys the manifest declares.
- `stored: Map<K, bool>` per plugin: the keys present in the file, each
  mapped to whether its value is acceptable. The adapter computes this.
- `namespace: Map<I, Map<K, bool>>`: the stored map for every plugin.

The policy computes:

- `specChoice(declared, stored, k)` for `k in declared`: `'stored'` if
  `k in stored` and `stored[k]` is true, otherwise `'default'`.
- `resolveChoices(declared, stored)`: a map with exactly the keys in
  `declared`, built by a loop over `declared`.
- `mismatches(declared, stored)`: the set of keys `k` in `declared` where
  `k in stored` and `stored[k]` is false.
- `resolveNamespaceChoices(registered: Seq<I>, declaredOf, namespace)`: a map
  from each registered `i` to `resolveChoices(declaredOf(i), namespace[i]`, or
  the empty map if `i` has no entry`)`.
- `planSettingWrite(declared, op)`. The operation is `set(k, acceptable)` or
  `reset(k)`, and the function returns one of:
  - `accept(set k)`, when `k in declared` and the value is acceptable;
  - `accept(reset k)`, when `k in declared`;
  - `reject('key')`, when `k` is not declared;
  - `reject('kind')`, when `k` is declared but the value is not acceptable.
- `applyPlan(namespace, i, plan)`:
  - `accept(set k)` sets `namespace[i][k] := true`, creating `namespace[i]`
    if it is absent;
  - `accept(reset k)` removes `k` from `namespace[i]`;
  - a rejection leaves the namespace unchanged.

The adapter is responsible for everything the policy does not see:

- Parsing identifiers and keys (`D-2`).
- Classifying each value's kind, and treating non-finite numbers as having no
  kind.
- Computing acceptability.
- Selecting values by the choice: the stored value or the default value, by
  reference.
- Rejecting a malformed namespace before the policy runs.

The adapter reads every object with `Object.hasOwn`, so it never consults a
prototype key.

### Invariants and lemmas

- `INV-CHOICE-SPEC` (`REQ-DEFAULTS`): for every `k` in `declared`,
  `resolveChoices(declared, stored)[k]` equals
  `specChoice(declared, stored, k)`, and the keys of the result are exactly
  `declared`. This is a loop-equivalence proof with invariants over the prefix
  of `SetToSeq(declared)` processed so far.
- `INV-MISMATCH-SPEC`: membership in `mismatches` is as defined above, with no
  duplicates. Tests compare sorted results, because `SetToSeq` order is
  arbitrary.
- `L-ACCEPTED-SET-WINS` (`REQ-RESTART`, the logical half): if
  `planSettingWrite(declared(i), set(k, true))` is `accept`, then after
  `applyPlan`, the choice for `k` is `'stored'`. This connects the write check
  to resolution, and is not true by definition.
- `L-RESET-DEFAULT` (`REQ-DEFAULTS`): after an accepted `reset k`, the choice
  for `k` is `'default'`.
- `L-REJECT-NOOP`: a rejected plan leaves the namespace unchanged.
- `INV-ISOLATION-FOLD` (`REQ-ISOLATION`): for any sequence of operations
  applied through plugin `i`, and any registered `j` other than `i`,
  `resolveNamespaceChoices(...)[j]` is the same before and after. The proof
  uses an induction lemma over the sequence and a loop invariant in
  `resolveNamespaceChoices`.
- `INV-ID-GRAMMAR` (`REQ-ID`): `parsePluginId` and `parseSettingKey` accept
  exactly the `D-2` languages.
- `INV-KIND` (`REQ-DEFAULTS`): `jsonKind` agrees with an independent
  classifier. `null` is not classified as `object`, arrays are not classified as
  `object`, and `NaN` and `±Infinity` have no kind.
- `INV-RESOLVED-VALUES` (the adapter bridge): for every declared key, the
  resolved value is identical (`toBe`) to the stored value when the choice is
  `'stored'`, and to the default when the choice is `'default'`.
- `INV-PATCH-PRESERVE` (`REQ-PRESERVE`, `REQ-ISOLATION`): after `written`, the
  re-parsed file equals the old parsed configuration with exactly
  `config.plugins[i][k]` changed, and every byte outside the replaced span is
  unchanged. This is checked at run time on every write, and by property tests.
- `INV-REFUSALS` (`REQ-PRESERVE`): each refusal condition in `Constraints`
  produces its typed reason, leaves the bytes unchanged, and leaves no
  temporary file.
- `INV-ATOMIC` (`REQ-PRESERVE`): a failure at any step before the rename
  leaves the original bytes intact, with no temporary file remaining.
- `INV-NO-IMPLICIT-WRITE` (`REQ-PRESERVE`): start-up and reload perform no
  writes.
- `INV-DECORATE-SAFE` (`REQ-ISOLATION`): the renderer's
  `config.plugins` equals the resolved namespace, whatever the legacy
  decorators return.

### Axioms (trusted, not verified here)

- `AXIOM-LSC-LOWERING`: `lsc` 0.6.5 translates the annotated TypeScript
  faithfully. `bin/prove.sh` checks that `.dfy.gen` is fresh, so the proof is
  about the shipped source.
- `AXIOM-RECORD-MAP`: a TypeScript `Record` read through `Object.hasOwn`
  corresponds to a Dafny `map` with `in`. The codec is the only producer of the
  policy's inputs, and it uses `Object.hasOwn`. Property tests include the keys
  `__proto__`, `constructor`, `toString`, and integer-like keys.
- `AXIOM-JSON5`: the `json5` package parses according to the JSON5
  specification.
- `AXIOM-RENAME`: a rename within one directory replaces the target
  atomically on POSIX. On Windows it is retried on `EPERM`, `EACCES`, and
  `EBUSY`.
- `AXIOM-WATCHER`: chokidar delivers a change event after the rename. This
  matters only for edits made by hand, because self-writes import explicitly
  (`D-12`).

The draft's `AXIOM-PAYLOAD-EQ` is removed by `D-10`. `AXIOM-SINGLE-WRITER` is
narrowed by compare-and-swap; the remaining risk is documented under `Risks`.

### Methods per obligation

- **`INV-CHOICE-SPEC`, `INV-MISMATCH-SPEC`, `L-ACCEPTED-SET-WINS`,
  `L-RESET-DEFAULT`, `L-REJECT-NOOP`, `INV-ISOLATION-FOLD`.**
  - Method: LemmaScript `//@ ensures` and `//@ invariant` contracts, plus Dafny
    lemmas added to the `.dfy`. A model-based fast-check test at the service
    layer backs them up.
  - Rationale: these range over every map and every sequence of operations.
    The loop-equivalence and fold structure makes each one depend on loop
    invariants and induction, not on unfolding a definition.
  - Domain: every finite input for the proof. The property tests use 0 to 8
    declared keys and sequences of 0 to 20 operations over 3 plugins.
  - Artefacts:
    - `app/config/plugin-settings-policy.ts`, `.dfy`, and `.dfy.gen`;
    - `test/unit/plugin-settings-policy.test.ts`;
    - `test/unit/plugin-settings-service.model.test.ts`.
  - Evidence: `make prove` exits 0 and prints at least three
    `Dafny program verifier finished with <N> verified, 0 errors` lines, one
    for each listed source. Record the total of `N` before and after, so a
    lemma that silently disappears shows up as a drop.
  - Non-vacuity, witnesses: witness lemmas in the `.dfy` go through the
    shipped functions, as `replayKeybindingObservationsExamples` does. One
    shows a stored and acceptable key giving `'stored'`. One shows a stored
    but unacceptable key giving `'default'` and appearing in `mismatches`. One
    shows an undeclared stored key absent from the result. One shows two
    registered plugins with non-empty namespaces, where a set on one leaves
    the other unchanged.
  - Non-vacuity, seeded faults: each is applied in turn, observed failing, and
    reverted:
    - `resolveChoices` returns `'default'` for acceptable keys;
    - `applyPlan` returns `{[i]: …}` and drops the other plugins;
    - `reset` deletes the whole plugin entry.
  - Non-vacuity, plumbing: after `make prove` passes, remove the new
    `LemmaScript-files.txt` entry and confirm that the new `prove.sh`
    required-sources guard fails.
- **`INV-RESOLVED-VALUES` and the end-to-end resolution relation.**
  - Method: property tests at the adapter boundary.
  - Oracles:
    - Differential: when every stored key is declared and acceptable, the
      resolved object equals the legacy shallow spread, `{...d, ...s}`.
    - Metamorphic: resolving against an empty stored map gives exactly the
      defaults, and resolution is idempotent.
  - Artefacts: `test/unit/plugin-settings-resolution.property.test.ts`, with
    arbitraries in `test/testUtils/plugin-settings-arbitraries.ts` and a
    coverage guard. The classes to cover are: matching, mismatched, missing,
    undeclared, empty, and prototype-named keys.
  - Seed: `PLUGIN_SETTINGS_PROPERTY_SEED`.
- **`INV-KIND`.**
  - Method: a table test plus a property test against an independent
    classifier, written with `Object.prototype.toString` and
    `Number.isFinite`.
  - Seeded faults: classifying `null` as `object`, and arrays as `object`.
    Both must fail.
- **`INV-ID-GRAMMAR`.**
  - Method: parameterized tables plus fast-check properties.
  - Valid identifiers: `velocetty.golden-path-demo`,
    `com.example.git-branch`, and `a.b`.
  - Invalid identifiers:
    - empty, `golden`, and `Com.example.x`;
    - `com..x`, `.x`, `x.`, `x.-y`, and `x.y-`;
    - `__proto__`, `constructor`, and `con.example`;
    - `com.exämple.x` and `com.1password`;
    - a 129-character identifier;
    - `com.example.x` followed by a trailing space.
  - Keys: `tabPrefix` is valid. Empty, `_x`, `a.b`, `constructor`, and a
    65-character key are invalid.
  - Oracle: valid identifiers are built from generated segments. Invalid ones
    are made by single-character mutation outside the alphabet, or by
    breaking one segment rule.
  - Coverage guard: requires each accept class and each mutation kind.
  - Seeded fault: dropping the at-least-two-segments rule must make the
    `golden` case fail.
  - Artefacts: `test/unit/plugin-id.test.ts`,
    `test/unit/plugin-id.property.test.ts`, and a coverage guard.
- **Manifest contract (`D-4`, `D-14`, and the parity in `GAP-MERGE-SPLIT`).**
  - Method: one table test that checks every runtime manifest:
    - its identifier parses;
    - its declared keys parse;
    - it has no `null` default;
    - `enabled` is declared with a boolean default;
    - `settingsDefaults` validates against its own `settingsSchema` (Ajv, at
      test time only);
    - the app and shared copies are deep-equal in `id`, `settingsDefaults`,
      and `settingsSchema`.
  - Artefact: `test/unit/plugin-manifest-contract.test.ts`.
- **`INV-PATCH-PRESERVE`.**
  - Method: the runtime check described in `D-9`, plus a property test over
    generated `config.json5` documents. The generated documents vary:
    - comments, trailing commas, and quoted and unquoted keys;
    - CRLF and LF line endings;
    - whether `config`, `plugins`, and the namespace are absent or present;
    - several plugin entries;
    - duplicate keys, which must lead to `refused: 'unpatchable'`.

    Each case is compared on the re-parse and on the bytes outside the
    patched span. The formatting cases from
    `test/unit/runtime-plugin-settings.test.ts` are kept as named
    regressions.
  - Seeded fault: patching the whole namespace object. A byte comparison on a
    neighbouring key's comment must then fail, and so must the runtime check.
  - Artefact: `test/unit/plugin-settings-patch.property.test.ts`, with a
    coverage guard.
- **`INV-REFUSALS` and `INV-ATOMIC`.**
  - Method: contract tests against the file store in a real per-test
    temporary directory, plus fault injection through the injected `fs` port.
  - Cases:
    - a missing or unreadable file;
    - a syntax error;
    - a schema failure;
    - the Hyper tree and `hyper.json`;
    - a malformed namespace;
    - `nlink > 1`;
    - a concurrent edit between the read and the rename;
    - a symlinked `config.json5` whose target is in another directory, which
      must succeed and preserve the link;
    - failures injected at `open`, `write`, `fsync`, and `rename`.
  - Evidence: unchanged bytes, no `.config.json5.*.tmp` left behind, and the
    typed outcome. Each directory shape also has a success case.
  - Seeded fault: an in-place write with no temporary file. The
    rename-failure injection must then fail.
  - Artefact: `test/unit/plugin-settings-store.contract.test.ts`.
- **`REQ-RESTART` (physical half), `INV-ISOLATION-FOLD` at the bridge, and
  `L-ACCEPTED-SET-WINS` at the bridge.**
  - Method: a model-based fast-check test. It runs sequences of `set` and
    `reset` through two handles against the real store on a temporary file.
    After each step it runs a fresh `_import` from disk and compares the
    result with a `Map`-of-`Map` model.
  - Seeded fault: re-add the start-up call to
    `ensureRuntimePluginSettingsPersisted`. The behaviour suite's no-write
    assertion must then fail.
  - Artefact: `test/unit/plugin-settings-service.model.test.ts`.
- **`INV-NO-IMPLICIT-WRITE`, `INV-DECORATE-SAFE`, and the BDD scenarios at
  unit level.**
  - Method: a behavioural suite that drives the real `_import` with injected
    sources and a recording filesystem. It also includes a decorator that
    deletes `plugins`, and a 1.3.1 fixture with materialized defaults and
    comments.
  - Artefact: `test/unit/plugin-settings-resolution-behaviour.test.ts`.
- **End to end.**
  - The fast lane (`test/e2e/plugin-settings.e2e.test.ts`) covers no write at
    start-up, a hand-edited `tabPrefix: "ZZ-e2e"` surviving a relaunch, and a
    commented `com.example.other` entry staying byte-identical. These are
    separate scenarios, each with its own environment. Before reading other
    markers, a scenario asserts that the `[e2e] config-path` marker names the
    isolated Velocetty path, and it waits on a `plugin-settings` marker that
    carries `ZZ-e2e`.
  - The deep lane (`test/e2e-deep/plugin-settings.e2e.ts`) uses the same
    hand-edited file. It asserts that the rendered tab title starts with
    `[ZZ-e2e]`, which proves that the renderer receives resolved values.
  - Neither lane drives `set` in the end-to-end tests. That path has no
    production caller until 5.2.1, so its restart evidence is the
    real-directory model test above (`D-16`).

### Formal verification decision

A proof is warranted for the policy. `REQ-ISOLATION` and `REQ-DEFAULTS` are
contractual and range over every map and every sequence of operations. After
the review, the proof's content is not just its definitions: it consists of
loop equivalence, the link between write planning and resolution, and an
isolation fold. The proof stops at the policy. Kind classification, grammar
parsing, JSON5 patching, and file atomicity are covered by property, contract,
and E2E tests, because they rest on third-party behaviour that a proof would
only restate as axioms. Bounded or state-machine model checking would add
nothing over the unbounded Dafny proof. The one concurrency risk is handled by
compare-and-swap and documented.

### Suggested BDD features

These are proposed acceptance scenarios. The repository has no Gherkin runner,
so they become `describe` and `test` blocks with matching names in
`test/unit/plugin-settings-resolution-behaviour.test.ts`,
`test/unit/plugin-settings-store.contract.test.ts`, and the two E2E files. No
`.feature` file or runner is added.

```gherkin
Feature: Plugin settings persist under namespaced keys

  Scenario: Defaults apply without writing the file
    Given config.json5 has no config.plugins entry
    When Velocetty starts
    Then the golden-path tab title is "[GP] Shell"
    And config.json5 bytes are unchanged

  Scenario: A stored value survives restart
    Given config.json5 sets tabPrefix to "ZZ-e2e" under "velocetty.golden-path-demo"
    When Velocetty is relaunched
    Then the golden-path tab title starts with "[ZZ-e2e]"

  Scenario: A handle write is isolated and survives a fresh import
    Given config.json5 holds a commented entry for "com.example.other"
    When the golden-path handle sets tabPrefix to "QQ"
    And the configuration is imported afresh from disk
    Then the resolved tabPrefix is "QQ"
    And the bytes of the "com.example.other" entry are unchanged

  Scenario: A wrong-kind value falls back for that key only
    Given tabPrefix is stored as 42 and message as "hello"
    When Velocetty starts
    Then the tab prefix is "GP" and the message is "hello"
    And one notification names config.plugins["velocetty.golden-path-demo"].tabPrefix
    And a later reload with the same issue does not notify again

  Scenario: A malformed namespace does not reset other settings
    Given config.plugins["velocetty.golden-path-demo"] is true and fontSize is 17
    When Velocetty starts
    Then fontSize is 17 and the golden-path settings are the defaults

  Scenario: Writes refuse rather than risk the user's file
    Given config.json5 <condition>
    When the golden-path handle sets tabPrefix
    Then the outcome is refused with <reason> and the file bytes are unchanged

    Examples:
      | condition                         | reason             |
      | contains a syntax error           | syntax             |
      | fails the configuration schema    | schema             |
      | is the legacy Hyper hyper.json    | legacy-tree        |
      | has a duplicated tabPrefix key    | unpatchable        |
      | changes between read and rename   | concurrent-edit    |
```

## Plan of work

Every milestone ends with the full gate sequence listed in `Concrete steps`
(`make check-fmt`, `make typecheck`, `make lint`, `make test`, and, from
`EP-M2` onwards, `make prove`). Milestones that change documentation also run
`make markdownlint` and `make nixie`. Each milestone follows
Red-Green-Refactor. The intended commits are listed per milestone.

### `EP-M0` LemmaScript feasibility probe (prototype)

Question: can `lsc` 0.6.5, with the Dafny backend, lower and prove the
following without an `extern`?

1. A `for (const k of Object.entries(...))`-style loop over a `Record`, proved
   equal to a per-key specification function.
2. A loop over a `string[]` of registered identifiers that builds a nested
   `Record`.
3. A recursive specification over a sequence of operations, used for the
   isolation fold.

Steps:

1. Run `bun install`.
2. Write a scratch module, of about 80 lines, under `/tmp/lsc-probe-3-2-2/`,
   outside the repository. It should contain `specChoice`, `resolveChoices`,
   and a two-plugin fold.
3. Run `bunx lsc gen --backend=dafny` on the module, add the loop invariants,
   and run `bunx lsc check --backend=dafny` with the Dafny 4.11 and Z3 4.12.1
   toolchain that `bin/prove.sh` checks for.

Decision: the probe is a go if every contract verifies within the 60-second
limit. Record the transcript and the shape of the generated `datatype` and
`map` in `Artefacts and notes`. Check that no zero-field datatype is emitted.
On a no-go, set the status to `BLOCKED` and present the `D-10` options. The
probe directory is deleted afterwards. No commit is made.

### `EP-M1` Grammars, manifest contract, and ADR 009 (Proposed)

Assigned: `REQ-ID`, `GAP-ID`, part of `GAP-MERGE-SPLIT`, `D-2`, `D-11`, and
`D-14`.

Red: write the following tests. They fail because the module is missing and
`enabled` is not declared.

- `test/unit/plugin-id.test.ts`;
- `test/unit/plugin-id.property.test.ts`, with
  `test/testUtils/plugin-id-arbitraries.ts` and
  `test/unit/plugin-id-arbitraries.coverage.test.ts`;
- `test/unit/plugin-manifest-contract.test.ts`.

Green: create `app/config/plugin-id.ts`, of at most 150 lines:

```ts
export type PluginId = string & {readonly __brand: 'PluginId'};
export type SettingKey = string & {readonly __brand: 'SettingKey'};
export type GrammarRejection = Readonly<{
  kind: 'invalid-plugin-id' | 'invalid-setting-key';
  value: string;
  reason: 'length' | 'characters' | 'segments' | 'reserved-name';
}>;
export type Parsed<T> =
  | Readonly<{ok: true; value: T}>
  | Readonly<{ok: false; rejection: GrammarRejection}>;
export const parsePluginId: (value: string) => Parsed<PluginId>;
export const parseSettingKey: (value: string) => Parsed<SettingKey>;
```

Further steps:

1. Replace the unvalidated `PluginId` and the `pluginId()` brand in
   `app/runtime/plugin-runtime-json5-roundtrip.ts` with this type, and update
   every caller in the same change.
2. Declare `enabled` in both copies of the golden-path manifest if it is not
   already declared.
3. Write `docs/adr-009-plugin-settings-namespace.md` with status `Proposed`,
   following the section order in the style guide. The ADR covers the decisions
   listed in `D-11` and the reopening conditions from `D-15`.

Refactor: keep `parsePluginId` free of look-behind, and share the segment
predicate between the two parsers.

Commits:

1. "Add plugin identifier and setting-key grammars";
2. "Pin the runtime plugin manifest contract";
3. "Propose ADR 009 for plugin settings".

### `EP-M2` Verified settings policy

Assigned: `REQ-DEFAULTS`, `REQ-ISOLATION`, `D-4`, and `D-10`.

Red: write `test/unit/plugin-settings-policy.test.ts`. It has named examples
for each invariant, and each witness from the verification plan as a test.
Confirm it fails because the module is missing.

Green: create `app/config/plugin-settings-policy.ts`. It must be pure, at most
400 lines, and import no values from other modules. Its exported shape follows
the `EP-M0` outcome. The intended shape is:

```ts
export type Choice = 'stored' | 'default';
export type Acceptability = Readonly<Record<string, boolean>>;          // stored key -> acceptable
export type Declared = Readonly<Record<string, boolean>>;               // declared key set
export type StoredNamespace = Readonly<Record<string, Acceptability>>;  // plugin id -> stored keys
export type WriteOp = {kind: 'set'; key: string; acceptable: boolean} | {kind: 'reset'; key: string};
export type WritePlan = {kind: 'accept'; op: WriteOp} | {kind: 'reject'; reason: 'key' | 'kind'};
export function specChoice(declared: Declared, stored: Acceptability, key: string): Choice;
export function resolveChoices(declared: Declared, stored: Acceptability): Readonly<Record<string, Choice>>;
export function mismatches(declared: Declared, stored: Acceptability): readonly string[];
export function resolveNamespaceChoices(
  registered: readonly string[], declaredOf: Readonly<Record<string, Declared>>, ns: StoredNamespace
): Readonly<Record<string, Readonly<Record<string, Choice>>>>;
export function planSettingWrite(declared: Declared, op: WriteOp): WritePlan;
export function applyPlan(ns: StoredNamespace, id: string, plan: WritePlan): StoredNamespace;
```

Further steps:

1. Add the contracts listed under `Invariants and lemmas`.
2. Add `app/config/plugin-settings-policy.ts 30` to `LemmaScript-files.txt`.
3. Change `bin/prove.sh` so that `policy_source` becomes a
   `required_sources` array listing both policy files, and extend
   `test/unit/prove-guards.test.ts` with a case where the new entry is missing.
4. Run `bunx lsc regen --backend=dafny app/config/plugin-settings-policy.ts`.
5. Add the lemmas and witnesses to `.dfy`, as additions only.
6. Run `bun bin/generate-dafny.mjs`.

Apply the seeded faults, observe each one fail, revert it, and record the
transcripts.

Refactor: extract repeated loop shapes into specification helpers, then
re-prove.

Acceptance: `make prove` exits 0 with one verifier summary per listed source,
all reporting `0 errors`, and the `N` total recorded.

Commits:

1. "Add verified plugin settings policy";
2. "Require every policy proof in prove.sh".

### `EP-M3` Read path

Assigned: `REQ-DEFAULTS`, `REQ-ISOLATION`, `REQ-PRESERVE`, `GAP-DEFAULT-WRITE`,
`GAP-MERGE-SPLIT`, `GAP-FAIL-WIDE`, `GAP-DECORATE`, `D-3`, `D-5`, `D-6`, `D-7`,
and `D-13`.

Red: write `test/unit/plugin-settings-resolution-behaviour.test.ts`, covering
the unit-level BDD scenarios, the decorator test, and the 1.3.1 fixture. Also
write `test/unit/plugin-settings-resolution.property.test.ts` and the kind
tests. All of them fail.

Green:

1. Create `app/config/plugin-settings-resolution.ts`, the adapter-side
   bridge, with no I/O, of at most 300 lines. It holds:
   - `jsonKind`;
   - `decodeStoredNamespace(raw: unknown)`, which uses `Object.hasOwn`, the
     grammars, and the object checks, and produces issues;
   - `resolveConfiguredPluginSettings(raw, manifests)`, which calls the
     policy and selects values by reference, returning
     `{resolved: ResolvedPluginSettings; issues}`.
2. In `shared/src/types/config.ts`, introduce `StoredPluginSettings` and
   `ResolvedPluginSettings`:
   - `rawConfig.config` becomes `Omit<Partial<configOptions>, 'plugins'> &
     {plugins?: StoredPluginSettings}`;
   - `configOptions.plugins` becomes `ResolvedPluginSettings`.

   Run `bun run generate-schema` and confirm the working tree stays clean. The
   editor contract is unchanged; if the schema does change, stop and reconcile
   it with `Constraints`.
3. In `app/config/json5-config.ts`, override the `config.plugins` section in
   `configOptionsSections()` to accept any value, with a net line count of zero
   or less.
4. In `app/config.ts`, wrap the injected `_init`:
   - resolve from `userCfg.config?.plugins` against the manifest list
     injected from `app/runtime/golden-path-demo.ts`
     (`runtimePluginManifests`);
   - set `parsed.config.plugins`;
   - report the issues according to `D-13`, keeping the previous fingerprint
     in the composition root.
5. In `app/plugins.ts`:
   - delete `ensureRuntimeDefaultsPersisted` and its call;
   - in `getDecoratedConfig`, restore the frozen resolved namespace after
     decoration;
   - keep the file's net lines below zero.
6. In `app/runtime/plugin-runtime.ts`:
   - delete `ensureRuntimePluginSettingsPersisted`,
     `setRuntimePluginEnabledPersisted`, and the deep merge in
     `getRuntimePluginSettings`;
   - read `config.plugins[id]` instead;
   - `isRuntimePluginManifestEnabled` reads the resolved boolean `enabled`.
7. In `lib/utils/plugins.ts`, read `config.plugins[manifest.id]` directly,
   without a fallback. Remove the hard-coded `'GP'` and default-object
   fallbacks from both copies of the golden-path tab provider; the value is
   always resolved now.
8. Add
   `plugins: z.record(z.string(), z.record(z.string(), jsonValueSchema)).optional()`
   to `configOptionsSchema` in `lib/transport/ipc-schemas.ts`.
9. Delete the materialization assertions in
   `test/unit/runtime-plugin-settings.test.ts`. Move its formatting cases to the
   `EP-M4b` patch suite.

Refactor: simplify the remaining `plugin-runtime.ts` helpers, and confirm the
net-line rule for the over-cap files.

Commits:

1. "Split stored and resolved plugin settings types";
2. "Resolve plugin settings in configuration composition";
3. "Stop writing plugin defaults at start-up";
4. "Protect resolved plugin settings from decorators".

### `EP-M4a` Refactor: patcher location and atomic text-file write

Assigned: `D-9`. Behaviour is unchanged.

Red: none, because this is a pure refactor. The existing keybindings store
suites, round-trip suites, and parser suites are the guard; run them before and
after the change and confirm identical pass counts.

Steps:

1. Use `git mv` to move `app/runtime/plugin-runtime-json5-roundtrip.ts`,
   `plugin-runtime-json5-parser.ts`, and
   `plugin-runtime-json5-parsing-state.ts` to
   `app/config/config-json5-patch.ts`,
   `app/config/config-json5-patch-parser.ts`, and
   `app/config/config-json5-patch-state.ts`. Update the imports and test paths.
   This removes the two-way dependency between `app/config/` and `app/runtime/`.
2. Move `planReplacement`, `commitWrite`, the symlink and read-only checks,
   and the stale-temporary-file cleanup out of
   `app/config/keybindings-store.ts` into `app/config/atomic-text-file.ts`,
   parameterized by file name. `keybindings-store.ts` then calls the helper.

Commits:

1. "Move the config JSON5 patcher into app/config";
2. "Extract the atomic text-file write".

### `EP-M4b` Write path

Assigned: `REQ-RESTART`, `REQ-PRESERVE`, `REQ-HEX`, `GAP-WRITE`, `D-8`, `D-9`,
and `D-12`.

Red: write the following, and confirm they fail:

- `test/unit/plugin-settings-store.contract.test.ts`;
- `test/unit/plugin-settings-patch.property.test.ts`, with a coverage guard;
- `test/unit/plugin-settings-service.test.ts`, covering handle scoping, every
  outcome, and the `get` snapshot after a write;
- `test/unit/plugin-settings-service.model.test.ts`.

Green:

1. In `app/config/config-json5-patch.ts`, add `setPathValue(doc, path, value)`
   and `deletePath(doc, path)`, plus end-of-line detection. The parser files
   must not grow.
2. Create `app/config/plugin-settings-ports.ts`. It defines the
   `PluginSettingsStore` port, with `read()` and
   `write(id, key, op): Promise<PluginSettingsWriteOutcome>`, and the
   `PluginSettingsHandle` type. The outcome is a discriminated union on
   `status`:
   - `written`;
   - `unchanged`;
   - `rejected`, with reason `key` or `kind`;
   - `refused`, with reason `missing`, `unreadable`, `syntax`, `schema`,
     `legacy-tree`, `malformed-namespace`, `hard-link`, `unpatchable`, or
     `concurrent-edit`;
   - `failed`, with failure `permission` or `other`.
3. Create `app/config/plugin-settings-store.ts`, the file adapter,
   constructed as `createFilePluginSettingsStore({location, fs})`. It performs
   these steps in order:
   1. Check the tree and the file name.
   2. Read the text and check `nlink`.
   3. Parse strictly. A syntax error refuses with `syntax`, and a schema
      failure refuses with `schema`.
   4. Refuse if the namespace is malformed.
   5. Patch the text.
   6. Re-parse it, and verify that exactly the one intended path changed.
   7. Re-read the target and compare it with the original text
      (compare-and-swap).
   8. Write atomically.

   It returns `unchanged` when the patched text equals the original.
4. Create `app/config/plugin-settings.ts`, the service, constructed as
   `createPluginSettingsService({store, readResolved, reimport, manifests})`.
   It provides `forPlugin(id)`:
   - `set` classifies the value's kind and calls `planSettingWrite`. A
     rejection is returned with no input/output (I/O). An accepted plan calls
     `store.write`; after `written`, it awaits `reimport()` and records the
     written text for the watcher's suppression.
   - `get` returns a frozen `{values, userSetKeys}`.
5. Compose the store and the service in `app/config.ts`, beside the
   keybindings service. Add the `announced` field to the reload marker.

Refactor: share the outcome-to-log mapping with the keybindings reporter where
the shapes match, and re-run the property suites.

Commits:

1. "Add plugin settings store and port";
2. "Add the scoped plugin settings service";
3. "Suppress the reload toast for plugin settings self-writes".

### `EP-M5` End-to-end evidence

Assigned: `REQ-RESTART`, `REQ-ISOLATION`, `REQ-PRESERVE`, and `D-16`.

Red: write `test/e2e/plugin-settings.e2e.test.ts` and
`test/e2e-deep/plugin-settings.e2e.ts` first. Run them and confirm they fail,
because the `plugin-settings` marker is missing.

Green: emit the `plugin-settings` marker from the composition after each
import, through `app/config/e2e-marker-sink.ts`. The marker carries the
resolved golden-path `tabPrefix`, the issue count, and `announced`. Then run
`bun run test:e2e:fast` and `bun run test:e2e:deep` locally, using the headless
recipe.

Refactor: share launch helpers with `test/e2e/keybindings-e2e-harness.ts`
instead of duplicating them.

Commit: "Add plugin settings end-to-end scenarios".

### `EP-M6` Documentation closure

Assigned: `REQ-DOCS`, `GAP-DOC-SHAPE`, and `D-11`.

- `docs/velocetty-design.md`:
  - Correct §Plugin settings persistence so the example reads
    `config: { plugins: { ... } }`. Add the grammars, read-time defaults,
    acceptability, per-plugin failure isolation, and refusals. Add an
    "Implemented storage (roadmap 3.2.2)" paragraph and a link to ADR 009.
  - Update the §Plugin runtime `settings` sketch to the handle API from
    `D-8`.
- `docs/adr-009-plugin-settings-namespace.md`: set the status to `Accepted`,
  with the date and the delivering plan. Record the known limitations:
  - the edit race with an unsaved editor buffer;
  - shallow resolution, and array element kinds not checked;
  - legacy plugins sit outside the namespace;
  - values materialized by 1.3.1 stay frozen;
  - `enabled` may move to the plugin index.
- `docs/configuration-architecture.md`:
  - Add a "Plugin settings" subsection after "Plugin loader", covering the
    grammar, policy, resolution, ports, store, service, and composition.
  - Add a row to Table 1, and the read and write data flows.
  - Add the proof boundary and the refusal matrix.
  - Widen the module-location invariant in the header.
- `docs/developers-guide.md`:
  - Cover the grammars, and the rule that defaults are never persisted.
  - Explain how a bundled plugin declares defaults, including that `enabled`
    is required and `null` defaults are forbidden.
  - Explain how host code obtains a handle, and the wire rule.
  - Add a "how to change the policy and re-prove it" recipe: edit the `.ts`,
    run `lsc regen`, apply the additions in `.dfy`, run `generate-dafny`, run
    `make prove`, and check the `N` total.
  - Fix the precedence list so that plugin defaults appear for settings.
- `docs/users-guide.md`: add a "Plugin settings" section. It covers:
  - where plugin settings live, with an example;
  - how to return a setting to its default, which is to delete the key;
  - what happens with a wrong-kind value, a malformed entry, or a value
    written by 1.3.1;
  - that settings are not per-profile;
  - that Velocetty never writes into Hyper's files.
- `PLUGINS.md`: link plugin authors to the namespace and the grammars.
- `docs/tracking-issues.md`: add these issues:
  - `CONFIG-CLI-001`: the CLI `save` drops comments.
  - `RELOAD-002`: classify `config.plugins` by path, not by the npm-list name.
  - `PLUGIN-ID-001`: enforce the reserved prefix in an external loader.
  - `PLUGIN-ID-002`: derive command and provider identifiers from
    `PluginId`.
  - `SIZE-00x`: the files already over the 400-line cap that this plan
    touched.
- `docs/roadmap.md`: mark `3.2.2` and its sub-items done.

Gates: the full sequence plus `make markdownlint`, `make nixie`, and
`make spelling`. Then reconcile `Conformance basis` and set this plan to
`COMPLETE`.

Commit: "Document plugin settings namespaces (3.2.2)".

## Milestones and plateaus

| Milestone | End state                                                          | Acceptance evidence                                                  | Recovery                                         | Remaining gaps      |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------- |
| `EP-M0`   | Go or no-go recorded                                               | Probe transcript                                                     | None                                             | Everything          |
| `EP-M1`   | Validated grammars and pinned manifest contract; ADR Proposed      | Grammar and manifest suites pass; full gates                         | Revert commits 1–3                               | Policy, read, write |
| `EP-M2`   | Pure proved policy, no callers (library plateau)                   | `make prove` summaries ≥ 3 with `0 errors`; seeded-fault transcripts | Revert                                           | Integration         |
| `EP-M3`   | Resolved reads everywhere; no start-up write; per-plugin isolation | Behaviour and property suites; full gates                            | Revert per commit                                | Writes              |
| `EP-M4a`  | Patcher and atomic write relocated, behaviour identical            | Same pass counts before and after                                    | Revert either commit                             | Writes              |
| `EP-M4b`  | Guarded atomic `set`/`reset` behind a port                         | Contract, patch-property, service, and model suites                  | Revert feature commits independently of `EP-M4a` | E2E, docs           |
| `EP-M5`   | Application-level evidence in both lanes                           | Fast and deep E2E pass locally and in CI                             | Revert test and marker                           | Docs                |
| `EP-M6`   | Docs match behaviour; ADR Accepted; roadmap done                   | Markdown gates; conformance lines recorded                           | Revert docs commit                               | None                |

*Table 1: Milestones, plateaus, and recovery.*

Conformance check at every boundary:

1. The assigned `REQ-*` items are satisfied or advanced, with evidence.
2. The design in `Decision log` is still followed.
3. No upstream assumption has been falsified.
4. There is no unapproved interface change or new dependency.
5. There is no unapproved change to a trust boundary or the persisted format.
6. The trace links are current.

Compatibility decision for every milestone: none. All surfaces are
application-internal and pre-1.0, and the persisted format is read compatibly
(`D-6`).

## Concrete steps

The working directory is this worktree's repository root. A fresh worktree has
no `node_modules`, so run `bun install` first. If `postinstall` fails on a
stale npm cache, run `npm install` inside `app/` and retry. Rebuild `node-pty`
for E2E as `docs/developers-guide.md` describes.

Focused red and green commands, for example:

```plaintext
Red:   bun test test/unit/plugin-id.test.ts -> error: Cannot find module '../../app/config/plugin-id'
Green: bun test test/unit/plugin-id.test.ts -> all cases pass, 0 fail
Red:   bun test test/unit/plugin-settings-policy.test.ts -> missing module
Green: same command -> pass
Proof: make prove -> one "Dafny program verifier finished with <N> verified, 0 errors" per listed source
```

Run the full gate sequence after each milestone, one gate at a time, with
`pipefail`:

```bash
set -o pipefail
b=3-2-2-persist-plugin-settings-under-namespaced-keys
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-$b.out
make typecheck 2>&1 | tee /tmp/typecheck-velocetty-$b.out
make lint      2>&1 | tee /tmp/lint-velocetty-$b.out
make test      2>&1 | tee /tmp/test-velocetty-$b.out
make prove     2>&1 | tee /tmp/prove-velocetty-$b.out              # EP-M2 onwards
bun run test:e2e:fast 2>&1 | tee /tmp/e2e-fast-velocetty-$b.out    # EP-M5 onwards
bun run test:e2e:deep 2>&1 | tee /tmp/e2e-deep-velocetty-$b.out    # EP-M5 onwards
make markdownlint 2>&1 | tee /tmp/markdownlint-velocetty-$b.out    # documentation changes
make nixie     2>&1 | tee /tmp/nixie-velocetty-$b.out              # documentation changes
```

If `make spelling` regenerates `typos.toml` with changes unrelated to this
work, commit that file separately, as `AGENTS.md` (Spelling) requires.

## Validation and acceptance

Behavioural acceptance:

1. Starting with no plugin entry renders `[GP] Shell`, and the `config.json5`
   bytes are unchanged.
2. A hand-edited `tabPrefix: "ZZ-e2e"` renders `[ZZ-e2e] Shell`, and still
   does after a relaunch.
3. A commented `com.example.other` entry is byte-identical after a handle
   write.
4. `tabPrefix: 42` falls back to `GP`, with one notification naming the
   bracketed path. A reload with the same issue does not notify again.
5. A `true` namespace keeps `fontSize: 17`.
6. Every refusal in the BDD table leaves the bytes unchanged.

Quality criteria:

- Tests: `make test` passes with every suite named above, and
  `bun run test:e2e:fast` and `bun run test:e2e:deep` pass.
- Verification: `make prove` exits 0, with one verifier summary per listed
  source and `0 errors`. The seeded-fault transcripts and the plumbing negative
  control are recorded in `Artefacts and notes`.
- Lint and typecheck: `make check-fmt`, `make typecheck`, and `make lint` are
  clean. No new suppression is added without a stated invariant.
- Documentation: `make markdownlint`, `make nixie`, and `make spelling` are
  clean.

## Idempotence and recovery

Every gate and test command can be re-run safely. The E2E and contract tests
own per-test temporary directories and never touch the user's real
configuration directory; the E2E path is asserted from the marker.

Seeded faults are applied only in the working tree. Each is observed failing
and then reverted before commit; confirm this with `git diff --stat`. Remove
any fast-check regression artefacts the faults create.

Each milestone consists of the listed commits. The refactor milestone,
`EP-M4a`, is separate, so any milestone can be reverted on its own. If
`generate-schema` leaves a diff, re-run it on a clean tree. A real schema
change is an interface tolerance breach.

## Artefacts and notes

Evidence gathered during planning (reconnaissance, not implementation results):

```plaintext
app/config/schema.json (config block):
  "plugins": {"additionalProperties": {"additionalProperties": {"$ref": "#/definitions/JsonValue"}, "type": "object"},
              "description": "Namespaced plugin settings keyed by plugin identifier.", "type": "object"}
app/config/schema.json (top level):
  "plugins": {"description": "a list of plugins to fetch and install from npm ...",
              "items": {"type": "string"}, "type": "array"}
app/plugins.ts:87          ensureRuntimePluginSettingsPersisted();   // start-up write of defaults
lib/utils/plugins.ts:129   return {...manifest.settingsDefaults, ...candidate};  // renderer shallow merge
app/runtime/golden-path-demo.ts:134  ... : 'GP';   // main-copy fallback differs from shared copy
bin/prove.sh:15            readonly policy_source='app/config/keybindings-policy.ts'
```

LemmaScript `SPEC.md` (upstream `main`, fetched 2026-11-16) lists these
lowerings for the Dafny backend:

- `{ ...map, [k]: v }` lowers to `map[k := v]`.
- `const { [k]: _, ...rest } = map` lowers to a map comprehension.
- `for (const [k, v] of Object.entries(m))` lowers to a loop over
  `SetToSeq(m.Keys)`.
- `forall(k, P)` is available in specifications.
- Interfaces become single-constructor datatypes. This is why the policy
  never holds payloads.
- A cross-file value import becomes an automatic `extern`.

`EP-M0` confirms these against the pinned `0.6.5`.

Prior art:

- The VS Code contribution-points reference for `contributes.configuration`
  says to "use the extension name as prefix" for setting keys. Defaults live in
  the manifest, not in `settings.json`.
- Ajv's `useDefaults` mutates data and skips `anyOf`, `oneOf`, `not`, and
  `if`/`then`. Ajv also compiles schemas into code. Both are reasons it is not
  used for defaults or for third-party schemas here.

### Expert review summary (2026-11-16)

The review used the Logisphere six-expert panel. The verdict was "proceed with
conditions". All conditions are applied above.

- Pandalump: the resolved namespace leaked through the legacy decorators; one
  type covered two states; the proved `set` never governed the bytes written;
  and the reloadability premise was wrong.
- Wafflecat: the separate-file alternative (`D-15`); keep stored and resolved
  values apart; use acceptability rather than a schema-specific kind rule; make
  the handle asynchronous; Windows reserved names.
- Telefono: keep the editor schema strict; add a key grammar and a `rejected`
  outcome; `null` and non-finite numbers; the `enabled` contract; the bracketed
  path form; an IPC schema field.
- Doggylump: refuse writes into the legacy tree; verify every patch at run
  time (duplicate keys); make liveness independent of the watcher; refuse on
  schema failure, a malformed namespace, or hard links; compare-and-swap;
  notify only when the issue set changes; E2E hygiene.
- Buzzy Bee (verification): replace the definitional proof with a
  loop-equivalence proof and a fold; remove the payload axiom; the `Record` and
  `in` bridge; make `prove.sh` require every listed source; independent
  oracles; a model test at the store layer; trim the E2E; the budget.
- Dinolump: name every choice point; make `EP-M4a` its own milestone; defer
  the reloadability registry; add a manifest parity test; spell out the
  over-cap rule; add a re-prove recipe; give each milestone an explicit
  Refactor step and commit list.

Pre-mortem scenarios and the mitigations now designed in:

1. "Velocetty broke my Hyper": the `legacy-tree` refusal.
2. "Settings won't stick":
   - runtime verification of every patch;
   - a re-import triggered by the service;
   - a contract test with a symlink into another directory.
3. "Notification storm and a lost edit":
   - notify only when the issue fingerprint changes;
   - compare-and-swap before the rename;
   - the remaining risk recorded in the ADR.

## Interfaces and dependencies

No new dependencies.

New application-internal modules, all in `app/config/`:

- `plugin-id.ts`: `PluginId`, `SettingKey`, `parsePluginId`, and
  `parseSettingKey`.
- `plugin-settings-policy.ts` (pure, proved): `Choice`, `Declared`,
  `Acceptability`, `StoredNamespace`, `WriteOp`, `WritePlan`, `specChoice`,
  `resolveChoices`, `mismatches`, `resolveNamespaceChoices`,
  `planSettingWrite`, and `applyPlan`.
- `plugin-settings-resolution.ts`: `jsonKind`, `decodeStoredNamespace`,
  `resolveConfiguredPluginSettings`, and `PluginSettingsIssue`.
- `plugin-settings-ports.ts`: `PluginSettingsStore`, `PluginSettingsHandle`,
  and `PluginSettingsWriteOutcome`.
- `plugin-settings-store.ts`: `createFilePluginSettingsStore`.
- `plugin-settings.ts`: `createPluginSettingsService`.
- `atomic-text-file.ts`: extracted from `keybindings-store.ts`.
- `config-json5-patch.ts`, `config-json5-patch-parser.ts`, and
  `config-json5-patch-state.ts`: moved from `app/runtime/`.

New shared types in `shared/src/types/config.ts`: `StoredPluginSettings` and
`ResolvedPluginSettings`.

Reuse policy. Each concern has one owner, and no other module may duplicate it:

- Grammar parsing: `plugin-id.ts`. No other module may brand a value by
  casting.
- Kind classification and decoding: `plugin-settings-resolution.ts`.
- Choice and write planning: the policy. The renderer never resolves.
- JSON5 patching: `config-json5-patch.ts`.
- Atomic replacement: `atomic-text-file.ts`.

The policy takes plain `string` identifiers, and the resolution module is where
brands are checked and removed.

Modified files:

- `app/runtime/plugin-runtime.ts` and `app/runtime/golden-path-message.ts`;
- both golden-path manifests;
- `app/plugins.ts` and `app/config.ts`;
- `app/config/json5-config.ts` and `app/config/keybindings-store.ts`;
- `app/config/e2e-marker-sink.ts`;
- `lib/utils/plugins.ts` and `lib/transport/ipc-schemas.ts`;
- `shared/src/types/config.ts`;
- `bin/prove.sh` and `test/unit/prove-guards.test.ts`;
- `LemmaScript-files.txt`.

## Revision note

- 2026-11-16: initial draft from Wyvern reconnaissance and prior-art research.
- 2026-11-16: revised after the six-expert design review (verdict: proceed
  with conditions).

  Changes to the design:
  - Stored and resolved types are split, and the resolved namespace is
    restored after the legacy decorators run (`D-7`).
  - The generated editor schema stays strict, and only the runtime validator
    is relaxed (`D-5`).
  - A setting-key grammar, Windows reserved-name exclusion, and a `rejected`
    outcome are added (`D-2`, `D-8`).
  - Acceptability replaces the kind-only rule, undeclared keys are no longer
    passed through, `null` defaults are forbidden, and non-finite numbers
    are rejected (`D-4`).
  - `enabled` is reserved by the host (`D-14`).
  - The handle is asynchronous and bound to its plugin by capability (`D-8`).
  - The separate-file alternative is recorded and deferred (`D-15`).

  Changes to the write path (`D-9`, `D-12`, `D-13`):
  - Writes refuse for the legacy tree, a schema failure, a malformed
    namespace, hard links, failed verification of the patched text, and a
    concurrent edit.
  - Every patch is verified at run time.
  - The service re-imports after a write.
  - The user is notified only when the set of issues changes.

  Changes to verification (`D-10`):
  - The proof is redesigned around kinds and choices, with a
    loop-equivalence proof and an isolation fold, removing the payload axiom.
  - `prove.sh` requires every listed source.
  - The oracles are independent of the implementation, the model test runs
    at the store layer, and the seeded faults were rewritten.

  Changes to scope:
  - The reloadability registry work is withdrawn and tracked as
    `RELOAD-002`.
  - The E2E request-file probe is dropped in favour of a fast lane using
    hand-edited files plus a deep-lane DOM check (`D-16`).
  - `EP-M4a` is split out as its own refactor milestone.

  Changes to budgets: the code budget rises to 3,600 net lines, with sub-limits
  for production code, tests, and the proof. Each milestone now lists its
  gates, its Refactor step, and its commits. The milestone order is unchanged
  apart from the new `EP-M4a`.
