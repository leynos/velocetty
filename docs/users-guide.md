# Velocetty users' guide

## Module header

- Purpose: explain the configuration files a user edits, where they live on
  each platform, and what the application does when they change.
- Invariants: every path and behaviour here matches `app/config` and the
  automated tests named in
  [Configuration architecture](configuration-architecture.md).
- Cross-links: [Configuration architecture](configuration-architecture.md),
  [Developers' guide](developers-guide.md), [ADR 007](adr-007-keybindings-json5-storage.md),
  and [ADR 008](adr-008-velocetty-configuration-directory.md).

## Where configuration lives

Velocetty reads configuration from a Velocetty-named directory. A Hyper-named
directory is still read as a fallback, so an existing Hyper configuration keeps
working without being moved.

| Platform | Velocetty directory                                   | Hyper directory (legacy fallback)             |
| -------- | ----------------------------------------------------- | --------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/Velocetty` or `~/.config/Velocetty` | `$XDG_CONFIG_HOME/Hyper` or `~/.config/Hyper` |
| macOS    | `$XDG_CONFIG_HOME/Velocetty` or `~/.config/Velocetty` | `$XDG_CONFIG_HOME/Hyper` or `~/.config/Hyper` |
| Windows  | `%APPDATA%\Velocetty`                                 | `%APPDATA%\Hyper`                             |

_Table 1: Configuration directories._

On every platform, `XDG_CONFIG_HOME` wins when it is set to an absolute path.
An empty or relative value is ignored, as the XDG Base Directory specification
requires. On Linux the directory name is case-sensitive: `~/.config/velocetty`
is not consulted.

`config.json5` is resolved in this order:

1. a development-mode file beside the build output, when running a development
   build;
2. `Velocetty/config.json5`;
3. the Hyper directory's `config.json5`, then its older `hyper.json`.

When no `config.json5` exists anywhere, Velocetty creates one in the Velocetty
directory. If both directories hold one, the Velocetty copy wins and a
notification names the ignored copy.

`keybindings.json5` lives only in the Velocetty directory. Velocetty never
creates a new configuration file in the Hyper directory.

## Keyboard shortcuts

Keyboard shortcuts are stored in `keybindings.json5`, separately from the rest
of the configuration. Velocetty creates the file on first start with a short
header comment and an empty object. Open it in any text editor, for example:

```bash
code ~/.config/Velocetty/keybindings.json5
```

No menu entry or command opens the file yet.

### Moving an existing configuration

1. Quit Velocetty.
2. Move `config.json5`, `schema.json`, and the `plugins/` directory from the
   Hyper directory into the Velocetty directory. Create the Velocetty directory
   if it does not exist yet.
3. Start Velocetty again.

Do not move the other files in the Hyper directory. They are Electron's
application state (window layout, caches, preferences), not configuration.

### Format

The file is a JSON5 object. Each key is a command identifier, and each value is
either one shortcut string or an array of shortcut strings:

```json5
{
  // Replace the default shortcut for a command.
  'window:new': 'ctrl+alt+shift+n',

  // Offer more than one shortcut for the same command.
  'window:close': ['ctrl+alt+shift+w', 'ctrl+alt+q'],

  // An empty array removes the default shortcut.
  'editor:paste': [],
}
```

Comments and trailing commas are allowed, because the file is JSON5 rather than
JSON.

The optional `$schema` key names a JSON Schema file for editor completion.
Velocetty checks that it is a string, then ignores it.

Command identifiers are the identifiers shown in the command palette and the
menus, such as `window:new` or `pane:split:vertical`. They must not be empty
and must not start or end with whitespace.

### Shortcut syntax

Shortcuts use the Mousetrap syntax[^1], the same syntax Hyper used:

- Join the parts of one shortcut with `+`, for example `ctrl+shift+n`.
- Modifiers are `ctrl`, `alt`, `shift`, and `meta`. On macOS, `command` is the
  ⌘ key. `cmd` is accepted as a deprecated alias for `command`; Velocetty
  rewrites it and prints a warning in the developer console.
- A key is a letter, a digit, a function key such as `f11`, or a named key such
  as `enter`, `escape`, `tab`, `space`, `backspace`, `delete`, `insert`, `home`,
  `end`, `pageup`, `pagedown`, `up`, `down`, `left`, or `right`.

### Prefix shortcuts

A command identifier ending in `:prefix` expands into nine bindings. The base
identifier is extended with `:1` to `:8` and `:last`, and each digit is
appended to each shortcut:

```json5
{
  'tab:jump:prefix': 'ctrl',
}
```

The example binds `ctrl+1` through `ctrl+8` to `tab:jump:1` through
`tab:jump:8`, and `ctrl+9` to `tab:jump:last`.

### Unbinding and resetting

- An empty array unbinds a command without removing the default for other
  commands: `'window:new': []`.
- To return every command to its platform default, replace the contents of the
  file with an empty object: `{}`.

Deleting the file is not the same as resetting it. While Velocetty is running,
deleting the file removes all user overrides until the next start. On the next
start, Velocetty recreates the file, and if the legacy `config.json5` still
holds `keymaps` it seeds the new file from them again. Use `{}` when the intent
is to reset.

### Hot reload

Save the file and Velocetty applies the change within a fraction of a second,
without a restart. Unsaved edits do nothing.

An invalid file never removes working shortcuts:

- If `keybindings.json5` is invalid while Velocetty is running, the shortcuts
  already in effect stay in effect, and a notification names the first problem.
- If it is invalid at start-up, Velocetty starts with the platform defaults and
  shows the same kind of notification.
- If it cannot be read at all (for example because of file permissions),
  Velocetty treats it the same way.

Fix the reported problem and save again; the next valid save is applied.

### Migration from `config.json5`

Hyper kept shortcuts under the `keymaps` key of `config.json5`. On the first
start after an upgrade, when `keybindings.json5` does not exist, Velocetty
copies a valid `config.json5.keymaps` into the new file. It never writes to
`config.json5`; its comments and formatting remain unchanged.

Once `keybindings.json5` exists, the legacy `keymaps` key is ignored and a
notification says so. If `config.json5` cannot be parsed at start-up, migration
is postponed to a later start rather than seeding an empty file.

For a standalone summary of the change, including the target release, see the
[migration note](migration-keybindings-json5.md).

### Sharing shortcuts

`keybindings.json5` is a plain text file. Share it by copying it to the same
location on another machine. Review platform-specific modifiers first: a
shortcut that uses `command` is meaningful on macOS and inert elsewhere.

### Current limits

- Duplicate shortcuts are not reported yet.
- Unknown command identifiers are not reported yet; a binding for a command
  that does not exist simply never fires.
- Legacy plugins with a `decorateKeymaps` hook run after user overrides and can
  change or remove them.
- Export and import utilities exist in the main process, but no menu entry or
  command calls them yet. The user-facing entry points are roadmap items
  `4.2.2` and `5.1.2`.

[^1]: Mousetrap documentation: <https://craig.is/killing/mice>.
