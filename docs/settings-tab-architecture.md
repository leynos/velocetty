# Settings tab architecture

This document describes how the settings tab is put together: the layers, the
one write path, the protocol between the renderer and the main process, and the
proofs and tests that guard each part. The decisions behind it are recorded in
[ADR 009](adrs/adr-0009-settings-tab-hosting-and-persistence.md), and the
delivery plan is
[the 5.1.1 ExecPlan](execplans/5-1-1-settings-tab-shell-and-navigation.md).

## Layers

The code follows the repository's package boundaries:

| Layer    | Location                          | Role                                                 |
| -------- | --------------------------------- | ---------------------------------------------------- |
| Domain   | `shared/src/settings/`            | Pure model, catalogue, search, coercion, field state |
| Renderer | `lib/settings/`, `lib/…`          | Ports, adapters, store, controls, views, tab strip   |
| Main     | `app/settings/`, `app/config`     | Writer, write policy, service, IPC, watcher          |
| Protocol | `shared/src/settings/protocol.ts` | Types exchanged over IPC                             |

_Table 1: the settings layers._

`shared/src/` imports neither `lib/` nor `app/`, performs no I/O, and holds no
React, Redux, Electron, or transport code. The main process may import only
types from `shared/`, because it is compiled to CommonJS without the `@shared`
alias.

## Domain ring

- `panel-model.ts` — `SettingId` (branded), `ControlDescriptor`, `FieldLabel`,
  `PanelField`, `PanelSection`, `SettingsPanelModel`.
- `core-catalogue.ts` — the 31 editable core keys with their categories and
  controls, the 18 documented exclusions, and `buildCorePanelModel()`.
- `search.ts` — `searchFieldIndices` and its pure helpers, annotated for
  LemmaScript; normalization stays outside the proved core.
- `coerce.ts` — `coerceInput(control, raw)` and `formatValue`.
- `field-state.ts` — `FieldState`, `FieldEvent`, `FieldEffect`, `stepField`,
  `wellFormed`, and the pure predicates the contracts use.
- `protocol.ts` — `SettingTarget`, `SettingsSnapshot`, `SettingsWriteOutcome`.

The catalogue is exhaustive by test: every property of the generated
`configOptions` schema is either catalogue entry or an exclusion with a reason,
and every control must match the schema's type, enum, and integer-ness.

## Renderer

- `lib/settings/ports.ts` — the `SettingsGateway` port: one snapshot read, one
  write, one reset, and a change subscription.
- `lib/settings/adapters/transport-settings-gateway.ts` — the transport
  adapter. It listens for the payload-free `config change` event on
  `ipcRenderer` because that event is not sent through the RPC envelope.
- `lib/settings/field-store.ts` — the ref-backed store around `stepField`.
  Effects run outside React, in submission order, and outcomes feed back as
  events. `whenIdle` lets tests wait for the last write.
- `lib/settings/hooks/use-settings-editor.ts` — loads the snapshot (one abort
  controller per load, older revisions ignored), refreshes the field store, and
  derives the filtered panel model through `searchFieldIndices`.
- `lib/settings/components/` — the pure view, the row, and the five controls.
- `lib/selectors/tab-strip.ts` and `lib/actions/tab-strip.ts` — the strip and
  the single activation path.
- `lib/settings/surface-command-gate.ts` — which commands may run while
  settings owns input.

The view receives strings from `lib/settings/i18n/`; the label table is typed
`Record<CoreSettingKey, string>`, so a catalogue entry without a label fails to
compile. The tab title is translated in `HeaderWithTranslation` because
selectors cannot call hooks.

## The active surface

`selectTabStrip` returns terminal root groups followed by the settings tab when
it is open, and marks exactly one entry active. `selectActiveSurface` returns
`{kind: 'settings'}` or `{kind: 'terminal', uid}` for the input gate.

While settings is active:

- the terminal layer and the settings layer are siblings with explicit width
  and height; the inactive one is moved offscreen by changing `left` only, so
  no size changes and no terminal refit occurs;
- the terminal layer is `inert`;
- `execCommand` drops every command outside the allow-list before any handler
  or main-process fallback runs, and the key handler skips `preventDefault` for
  those commands;
- `pane:close` closes the settings tab instead of a pane;
- returning to a terminal restores focus to its session explicitly.

The settings tab is deactivated by any terminal activation (`SESSION_ADD` or
`SESSION_SET_ACTIVE`), so two surfaces cannot both be active.

## The single writer

`app/config/config-file-writer.ts` is the only code that changes the user's
config file. One attempt runs as a synchronous critical section:

1. Resolve the real path, following symlinks.
2. Read the file fresh; parse it. A parse failure refuses the write.
3. Refuse unless the root and `config` are objects.
4. Apply one edit with `setPropertyAtPath` or `removePropertyAtPath`.
5. Re-parse the candidate and compare the value at the edited path with the
   intended value (or confirm the removal).
6. Validate the candidate's `config` and filter diagnostics to the edited
   key's subtree. A problem elsewhere in the file does not block this edit.
7. Apply the write policy for the key.
8. Write a sibling temporary file named `.velocetty-config-write-<pid>-<n>`
   with the original mode, fsync it, rename it over the real path, and fsync
   the directory (not on Windows).
9. Record the text hash and allocate a new revision.

`EBUSY`, `EPERM`, and `EACCES` re-run the whole section up to three times with
backoff; `app/config/config-write-retry.ts` owns the retry policy, its counter,
and its bounded lines. The plugin runtime uses `writeConfigEditSync`, one pass,
because it persists during module evaluation.

The reload watcher compares the file on disk with the writer's recorded hash
through `selfWriteVerdict`, which answers `'self-write'`, `'external'`, or
`'unreadable'`. Only a self-write with unchanged keybindings is silent; an
unreadable file is announced and named in one bounded line, and a missing file
is announced without a line. The composition root supplies the read port, so
the comparison never reaches for an ambient module.

## Observability

The settings write path reports only bounded values: a counter from the closed
`ConfigCounter` set, a `SettingsWriteFailure` reason token, an errno, an
attempt number, a category, and an outcome. It never logs a path, a key name,
file content, or a raw error message. `app/config.ts` exports the process-wide
`configMetrics` and `configSpans` instances, and `app/start.ts` hands both to
the settings service and its writer, so one session has one tally and one span
stream.

- `settingsApplies`, `settingsRejections`, and `settingsFailures` count the
  three `SettingsWriteOutcome` kinds of one `setValue` or `resetValue`.
  `settingsWriteRetries` counts a retryable writer failure that has another
  attempt left, and `settingsDurabilityUnconfirmed` counts a rename whose
  directory fsync failed, so the new text is visible but not known to survive a
  crash.
- Each service call records one `settings-write` span, finished `applied` or
  `failed`.
- `app/config/config-file-writer.ts` logs
  `config writer retry attempt=<n> code=<errno>` before each retry and
  `config writer durability=unconfirmed` after an unconfirmed rename. Other
  write failures keep the bounded
  `config writer failed: {"code":"<errno>","name":"Error"}` line.
- `app/settings/settings-service.ts` logs
  `settings write refused reason=<reason>` for a rejection or failure. The
  reason is a protocol token: `not-editable` for a rejected edit, otherwise the
  outcome's own `SettingsWriteFailure`.
- The renderer's `lib/settings/field-store.ts` logs
  `settings write rejected category=transport name=<name>` when the gateway
  promise rejects, naming the error's constructor only when it is a string and
  never its message.
- The start-up sweep in `app/config/config-file-write-io.ts` logs
  `[config] temporary sweep failed category=readdir code=<errno>` when it
  cannot list the config directory. A missing directory is a first run and
  stays silent, and a per-file unlink race stays silent because the leftover is
  swept next time.

## The edit operations

`app/config/json5/` contains the relocated scanner and the edits:

- `parser.ts` (with `lexer.ts`, `keys.ts`, `object-scanner.ts`,
  `property-list.ts`, `characters.ts`, `parsing-state.ts`, `types.ts`) reports
  object and property ranges without disturbing the source;
- `document-scan.ts` recovers the true end of a value (the parser reports it at
  the terminating delimiter, including a trailing comment) and resolves object
  ranges by path;
- `document-edit.ts` inserts or replaces one property;
- `document-remove.ts` deletes a property with one separating comma, its
  trailing same-line comment, and the whole line when it had one;
- `document-format.ts` spells new keys and values; `document-result.ts` holds
  the result types.

## Protocol

```typescript
type SettingTarget = {scope: 'core'; key: CoreSettingKey};

type SettingsSnapshot = {
  revision: number;
  filePath: string;
  fileStatus:
    | {kind: 'ok'}
    | {kind: 'missing'}
    | {kind: 'unparseable'; diagnostics: configValidationDiagnostic[]}
    | {kind: 'invalid'; diagnostics: configValidationDiagnostic[]}
    | {kind: 'legacy-json'};
  userValues: Record<string, JsonValue>;
  defaultValues: Record<string, JsonValue>;
  profileOverriddenKeys: string[];
};

type SettingsWriteOutcome =
  | {kind: 'applied'; snapshot: SettingsSnapshot}
  | {kind: 'rejected'; diagnostics: configValidationDiagnostic[]}
  | {kind: 'failed'; reason: SettingsWriteFailure; detail?: string};
```

The IPC channels are `settings:getSnapshot`, `settings:setValue`, and
`settings:resetValue`. The handler validates the target against the write
policy's key list and the value against the JSON contract before calling the
service; the renderer validates every response with a zod schema.

`revision` is monotonic in the main process. A write allocates one; so does
every watcher reload. The renderer ignores a snapshot older than the newest it
has seen, which is what makes an out-of-order outcome harmless.

## File states

- **Missing** — values are empty; the first write reports `config-file-missing`
  rather than creating a file. The banner explains that a change will be
  written once a file exists.
- **Unparsable** — the tab is read-only with a banner naming the problem.
- **Invalid** — every diagnostic is shown; only the diagnosed keys are
  editable, so the file can be repaired one key at a time.
- **Legacy `hyper.json`** — read-only, with a banner naming the real path, so
  JSON5 syntax is never emitted into a `.json` file.

## Proofs and property tests

| Artefact                                          | Claim                                              |
| ------------------------------------------------- | -------------------------------------------------- |
| `shared/src/settings/search.dfy`                  | Sound, complete, ordered search                    |
| `shared/src/settings/field-state.dfy`             | Invariants, stale outcomes, no stuck state, drafts |
| `test/unit/settings-search.property.test.ts`      | Metamorphic search properties                      |
| `test/unit/settings-coerce.property.test.ts`      | Coercion round-trips                               |
| `test/unit/settings-field-state.property.test.ts` | Model-based field machine                          |
| `test/unit/json5-document-edit.property.test.ts`  | Set and remove equal the JSON value, locality      |
| `test/unit/settings-convergence.property.test.ts` | The file settles on the last submission            |
| `test/unit/config-file-writer.test.ts`            | Refusals never write; writers do not lose updates  |
| `test/unit/settings-catalogue-parity.test.ts`     | Catalogue, policy, and schema agree                |

_Table 2: proofs and property suites._ Run `make proofs` for the formal
obligations; it verifies both files with the Dafny backend. `make proofs-fresh`
(part of `make lint`) rejects a hand-edited `.dfy.gen`.

## Tests by layer

- Domain: named examples plus the property suites above.
- Writer: an in-memory file-system port for refusals, retries, and
  exclusivity; a real temporary directory for mode, symlinks, read-only
  directories, and sweeping.
- Watcher: a real chokidar watcher over a temporary file, asserting one reload
  per atomic replacement, notification suppression for a self-write, and burst
  collapsing.
- Service: one scenario per file state, including the fix-one-key flow.
- Renderer: the tab-strip transition table against the real reducers and
  middleware, the command gate driven by every platform keymap command, the
  terminal-preservation component test, the view and control tests, and the
  field-store scenarios.
- End to end: `test/e2e-deep/settings-tab.e2e.ts` against the packaged app and
  a real config file.

## Trusted assumptions

The full list is in ADR 009. The ones that matter when changing this code:
`rename` is atomic on one file system after `fsync`; Electron preserves IPC
order; chokidar reports a rename replacement within the debounce; and the
writer's critical section cannot interleave with other main-process JavaScript.
