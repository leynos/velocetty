# Architectural decision record (ADR) 007: Keybindings JSON5 storage

## Status

Accepted on 2026-10-30. Roadmap item `3.2.1` is delivered under
`docs/execplans/3-2-1-store-keybindings-in-keybindings-json5.md`. The
implementation stores the map decided below verbatim, holds the last known good
in memory, migrates legacy `config.json5.keymaps` once at start-up, and never
rewrites `config.json5`. `docs/configuration-architecture.md` describes the
components that carry it out, and `docs/users-guide.md` describes what a user
sees. One detail changed during implementation: the reserved `$schema` key is
validated before it is dropped, so a non-string value is rejected with a
diagnostic rather than silently ignored.

## Date

2026-10-29

## Context and problem statement

Hyper, which Velocetty forks, kept user keyboard shortcuts in the main
configuration file under a `keymaps` key. The Velocetty design
(`docs/velocetty-design.md`, §Configuration system: JSON5 and layering) moves
them into a separate `keybindings.json5` file in the configuration directory.
Built-in and plugin defaults sit beneath that file. It is validated on read and
reloaded without a restart. When it is invalid, the last known good state stays
in effect.

That leaves several choices open. The design does not settle the on-disk shape
of `keybindings.json5`, how import and export relate to that shape, what "last
known good" means when a file is missing or was never valid, or how existing
users' `keymaps` move across without the application rewriting their
`config.json5`. These choices are hard to reverse once users hold files in the
chosen shape, so they are recorded here.

## Decision drivers

- Every runtime consumer already expects a map from command identifier to one
  or more shortcut strings. These consumers are `app/config/init.ts`,
  `app/utils/map-keys.ts`, `app/plugins.ts`, the inter-process communication
  (IPC) schema, menus, and `lib/command-registry.ts`.
- The bundled platform defaults (`app/keymaps/*.json`) and legacy
  `config.json5.keymaps` use that map.
- The keybinding editor (roadmap `4.2.2`) needs export and import "via JSON5",
  and rich bindings with `when` clauses and arguments (roadmap `4.2.1`) must
  fit later without a breaking migration.
- A broken save must never cost a user working shortcuts.
- Keybinding code must not rewrite the user's `config.json5`. Its comments and
  formatting are theirs.

## Options considered

The on-disk shape:

| Option                                                | Fits consumers today | Unbinds a default | Room for `when` and `args` | Migration from Hyper |
| ----------------------------------------------------- | -------------------- | ----------------- | -------------------------- | -------------------- |
| A. Map: command to string or string array             | Yes                  | Yes, with `[]`    | By widening array elements | Copy as is           |
| B. Rule array, as in Visual Studio Code               | No, needs adapter    | `-command` rules  | Native                     | Needs conversion     |
| C. Map with object values only (`{keys, when, args}`) | No, needs adapter    | Yes               | One binding per command    | Needs conversion     |

_Table 1: On-disk shapes for `keybindings.json5`._

Import and export:

| Option                                    | Comments kept | Export matches file | Side effects on export |
| ----------------------------------------- | ------------- | ------------------- | ---------------------- |
| Verbatim: validate, then store given text | Yes           | Yes                 | None                   |
| Canonical: validate, then reserialize     | No            | Only after import   | None                   |

_Table 2: Import and export strategies._

Invalid-file behaviour:

| Option                                            | Loses working shortcuts | Surprising partial state |
| ------------------------------------------------- | ----------------------- | ------------------------ |
| Keep last known good in memory for the session    | No                      | No                       |
| Persist last known good to a side file            | No                      | Hidden second source     |
| Accept the valid entries of a partly invalid file | No                      | Yes                      |

_Table 3: Behaviour when `keybindings.json5` is invalid._

## Decision outcome

Option A, the map. `keybindings.json5` is a JSON5 object whose keys are command
identifiers and whose values are a non-empty shortcut string or an array of
such strings. An empty array unbinds the command's default. The key `$schema`
is reserved for editor tooling and is ignored. Command identifiers must be
non-empty and have no leading or trailing whitespace. Shortcut strings must be
non-empty and not only whitespace. Shortcut grammar is not validated here; that
belongs to the `4.2.1` parser, because tightening it now could reject shortcuts
that work today.

The planned evolution is additive. A later version may widen each array element
to `string | {keys: string; when?: string; args?: unknown}`, so a command can
carry several `when`-scoped bindings. Existing files stay valid, and no version
field is needed.

Import and export are verbatim. Import validates the text and stores it
unchanged. Export returns the stored text unchanged when it is valid. When the
stored text is invalid, export reports it as invalid, with diagnostics, rather
than inventing content. The application writes canonical text (sorted keys,
two-space JSON5, a header comment) only when it creates the file during
first-run bootstrap.

Last known good is held in memory for the session. It is the most recent state
accepted from disk. A missing file is accepted as "no overrides". An invalid or
unreadable file changes nothing, and before anything has been accepted the
active overrides are empty, so platform defaults apply.

Migration copies a successfully parsed `config.json5.keymaps` into a new
`keybindings.json5` once, at start-up, when that file is missing. It never
writes `config.json5`. Once `keybindings.json5` exists, `config.json5.keymaps`
is ignored, with a notification. If `config.json5` fails to parse, migration is
deferred to a later start-up rather than seeding an empty file.

## Known risks and limitations

- Deleting `keybindings.json5` while legacy `config.json5.keymaps` remain
  causes the next start-up to seed the file from them again. The users' guide
  documents `{}` as the way to reset.
- Plugin keybinding precedence in the current code (`app/plugins.ts`,
  `app/runtime/plugin-runtime.ts`) differs from the design's layering. Built-in
  defaults currently beat plugin defaults, and legacy `decorateKeymaps` hooks
  run after user overrides. This ADR does not change that. Roadmap `4.2.1` owns
  precedence.
- `keybindings.json5` lives in the Velocetty configuration tree, which may
  differ from the directory of a legacy Hyper-tree `config.json5`. See ADR-008.

## Architectural rationale

The map keeps the persisted format equal to the runtime contract, so no adapter
layer or migration is needed and the hot path stays a plain merge. Holding last
known good in memory keeps a single source of truth on disk. Verbatim import
and export make "the same format" literally true and keep user comments.
