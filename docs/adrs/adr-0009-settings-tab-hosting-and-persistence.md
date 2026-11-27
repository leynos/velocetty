# Architectural decision record (ADR) 009: Settings tab hosting and persistence

## Status

Accepted. Settings are hosted as a singleton pseudo-tab in the existing tab
strip, edits are written by one main-process writer that preserves the user's
comments, and the load-time schema is left unchanged.

## Date

2026-11-25.

## Context and problem statement

Velocetty is a terminal emulator forked from Hyper. Choosing `Preferences…`
opened `config.json5` in an external editor, while the product requirements and
the design commit the application to a first-class settings experience: a
settings tab with search, categories, inline validation, and reset-to-default
(PRD-SET-1, TDD-SET-TAB, TDD-HR-UI, TDD-VAL).

Four questions had to be answered together, because the answer to one changes
the others:

1. Where does the settings surface live, and how does it share input with
   running terminals without resizing or disturbing them?
2. Who writes the config file, and how are the user's comments, formatting,
   and line endings preserved?
3. How much validation moves to load time, given that any added constraint
   makes an existing file fall back to defaults wholesale?
4. How do the renderer and the main process talk, and where do the shared types
   live given the package-boundary rules?

## Decision drivers

- The design requires settings to be a tab type (`tabType = "settings"`), not a
  modal.
- Terminal sessions must not be unmounted, resized, written to, or closed by
  the settings tab.
- The config file is the single source of truth; there must be no second store
  that can disagree with it.
- Existing user files must keep loading; tightening the load schema is not an
  option.
- The renderer cannot import `app/`, and `app/` may import only types from
  `shared/`; pure logic must live in `shared/src/`.
- Typing in a settings field must never reach a hidden shell.

## Options considered

### Option A: A settings window or modal

Open settings in a separate `BrowserWindow` or a modal overlay. Isolation is
simple, but the design explicitly rejects a modal, the tab strip would not show
the settings surface, and a separate window duplicates profile and theme state.

### Option B: A pseudo-tab with a full tab-model rewrite

Introduce settings as a first-class tab by rewriting the tab model. Cleanest
long term, but the rewrite is roadmap item 6.1, and this work must not depend
on it.

### Option C: A pseudo-tab with an explicit active-surface model

Append a singleton entry with the reserved uid `velocetty:settings` to the
existing strip, and introduce one selector that decides which surface is
active. Terminal movement and close actions route through that strip.

### Option D: Rewrite the whole file on every edit

Serialize the parsed config back to JSON5. Simple to implement, but every
comment and every formatting choice the user made is destroyed, which the
developers' guide forbids (DG-CFG-RT).

| Topic              | A: window/modal | B: tab rewrite | C: pseudo-tab | D: whole-file write |
| ------------------ | --------------- | -------------- | ------------- | ------------------- |
| Matches the design | no              | yes            | yes           | yes                 |
| Depends on 6.1     | no              | yes            | no            | no                  |
| Disturbs terminals | no              | no             | no¹           | no                  |
| Preserves comments | n/a             | n/a            | n/a           | no                  |
| Delivers now       | yes             | no             | yes           | yes                 |

_Table 1: Hosting and persistence options. ¹ By construction: the terminal
layer keeps its node and size and is only moved offscreen._

## Decision outcome / proposed direction

**Hosting (Option C).** A `settingsTab` Redux slice holds
`{isOpen, isActive, query, selectedCategory}`. `selectTabStrip` returns the
ordered strip — terminal root groups, then the settings tab when open — with
exactly one active entry, and `activateTab(uid)` routes a uid to either kind.
While settings is active the terminal layer is moved offscreen with an explicit
width and height (never `display: none`, which would fire the terminal's
`ResizeObserver` and refit the PTY) and marked `inert`; the settings layer
fills the same box. The terminal container is never unmounted.
Terminal-targeting commands are dropped before reaching a session and do not
call `preventDefault`, so native editing works in the fields; `pane:close`
closes the settings tab.

**Persistence.** One main-process writer, `app/config/config-file-writer.ts`,
owns every read-modify-write. Each attempt is a single synchronous critical
section: resolve the real path, re-read, refuse unless the root and `config`
are objects, apply one targeted edit from `app/config/json5/document-edit.ts`,
re-parse and compare the value it meant to write, apply the write policy and
the schema to the edited subtree, write a sibling temporary file with the
original mode, fsync, rename, and fsync the directory. `EBUSY`, `EPERM`, and
`EACCES` retry the whole section. Reset removes the key so future defaults
reach the user. The plugin runtime writes through the same writer.

**Validation.** The load schema is unchanged. Stricter, UI-only bounds live in
`shared/src/settings/core-catalogue.ts` and are enforced again at write time by
`app/settings/settings-write-policy.ts`, so no existing file can start falling
back to defaults. A schema-invalid file is reported with every diagnostic, and
only the diagnosed keys are editable, so it can be fixed one key at a time.

**Protocol.** `SettingsSnapshot`, `SettingsWriteOutcome`, and `SettingTarget`
live in `shared/src/settings/protocol.ts`; the renderer reads them through the
`SettingsGateway` port (`lib/settings/ports.ts`). The protocol needs no version
field because the renderer and main process ship in one build.

## Known risks and limitations

- A snapshot and the file can disagree for a moment while a write is in flight.
  A monotonic revision, the post-write snapshot carried by `applied`, and
  dirty-draft protection keep the UI from regressing; the file remains the
  authority.
- Concurrent writers are serialized inside one process. An external editor
  saving the same key at the same instant can still win, and the watcher then
  reloads the file.
- The terminal's no-resize guarantee depends on the offscreen technique. A
  future change that alters the layer's width or height would break it, which
  is why a component test asserts the node, the class, and `inert`.
- LemmaScript 0.6.12 needed two local patches (generic records in emitted
  datatypes, and generic-union lookup). The version is pinned exactly so the
  patch cannot drift, but the upstream fix belongs in LemmaScript.
- The Proofs workflow is advisory until its exit criteria are met (see the
  2026-11-27 addendum), so a period without hosted verification is covered by
  the local proof gate rather than by branch protection.

## Trusted assumptions

- Ajv validates correctly against the generated schema.
- `JSON5.parse` is the oracle for the edit properties.
- Electron delivers `ipcRenderer.invoke` calls in send order.
- On one file system, `rename` replaces the target atomically after `fsync`; on
  Windows a held file can force a retry.
- chokidar 3.6 reports a rename-based replacement as `change` or `add` within
  the debounce window.
- Node runs the writer's synchronous critical section to completion without
  interleaving.
- LemmaScript's Dafny translation is faithful for the fragment the proofs use
  (strings, `split`, `includes`, arrays, records, discriminated unions,
  integers). Case folding happens outside the proved functions.
- The generated search model axiomatizes `StringSplit` (JavaScript's
  `String.prototype.split` with a literal separator) with bounds on the part
  count and part length, tied by an `ensures` to the recursive `splitSpec` so
  the parts are related to the input. `bin/prove.sh` admits that exact
  declaration, and `emptyUserKeymaps`, as the only axioms a listed proof may
  use. The search non-vacuity evidence is the property suite and seeded
  mutations, because `Std.Collections.Seq.All` and the `StringSplit` axiom are
  opaque to evaluation on concrete strings.
- The proofs are generic in the value type, but the settings domain instantiates
  it only with `string | number | boolean`, where the proof's structural `===`
  and JavaScript's reference equality agree. Request identifiers are JavaScript
  numbers; the monotonicity contract holds within the safe-integer range, which
  the store cannot exhaust.
- `useSyncExternalStore` re-renders after notifications and reads the latest
  snapshot.

### Addendum 2026-11-27: the Proofs workflow is advisory

`.github/workflows/proofs.yml` runs the Dafny verifier on a pull request only
when a proof-related path changes, and it is **advisory**: the workflow is not
a required status check while the proof suite settles. The decision is
deliberate rather than an omission.

- **Exit criteria.** Promote the workflow's `dafny` job to a required check in
  branch protection after two consecutive weeks of green runs on `main` and on
  pull requests that touch the listed paths, with no verifier timeout and no
  freshness failure in that window. Record the promotion in this ADR.
- **What is still enforced meanwhile.** `make proofs-fresh` runs inside
  `make lint`, so a stale or hand-edited generated artefact fails the ordinary
  gate even when the verifier does not run; `bin/prove.sh` refuses a vacuous
  run; and the local commit gate runs `make prove` before a change is committed.
- **Why advisory at all.** The verifier is slow and its toolchain (Dafny 4.11,
  Z3 4.12.1, a patched LemmaScript) is young enough that a transient failure
  should not block unrelated work. A red Proofs run is still treated as a real
  failure and investigated, not dismissed as a flake.

## Alternatives rejected

- **Settings window or modal** (Option A): contradicts the design and
  duplicates window state.
- **Full tab-model rewrite** (Option B): belongs to roadmap 6.1.
- **Draft-then-save** with an explicit Save button: the design applies settings
  per field, and the per-field machine makes partial application safe.
- **All editor state in Redux**: React StrictMode invokes reducers twice, which
  would duplicate writes; the field store lives outside React (ADR-003).
- **Tightening the load schema**: would reset existing files to defaults.
- **A schema-annotated catalogue with `x-ui` hints**: deferred to 5.2.1 behind
  the panel model, which keeps search, field state, and the IPC contract
  reusable for plugin panels.

## Consequences

- The tab strip, the header, and every tab action now share one activation
  model; plugins see `tabType` on the tab decoration context, and built-in
  decoration providers are skipped for the settings tab.
- The plugin runtime no longer writes the config file directly; a startup write
  is validated and atomic like any other.
- A settings write reloads the renderer's config but suppresses the
  "configuration reloaded" notification for the app's own writes.
- Future plugin settings panels (5.2.1) can reuse the panel model, the field
  machine, the search core, and the writer.

## References

- `docs/execplans/5-1-1-settings-tab-shell-and-navigation.md`
- `docs/settings-tab-architecture.md`
- `docs/velocetty-design.md` §Settings tab and plugin settings panels
- `docs/velocetty-product-requirements-document.md` §Settings tab + plugin
  settings panels
- `docs/adrs/adr-0003-update-react-19.md`
- `docs/adrs/adr-0006-oxlint-plugin-strategy.md`
