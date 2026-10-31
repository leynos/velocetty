# Migration to `keybindings.json5`

This document describes the migration of keyboard shortcuts from the `keymaps`
key of Hyper's `config.json5` to the separate `keybindings.json5` file. It
covers the storage location, the conditional start-up migration, precedence,
hot reload, and the difference between deleting the file and writing an empty
object. It is a migration note; the users' guide remains the detailed manual.

## Target release

The migration applies from the next Velocetty release. Velocetty has not yet
published a numbered release, so the version number for that release is pending
the maintainer's decision. This document assigns no version number; the number
is independent of the inherited Hyper version.

## What changes

- Keyboard shortcuts move from `config.json5.keymaps` to a separate
  `keybindings.json5` file. The legacy key is not deleted from `config.json5`;
  Velocetty simply stops reading it once the new file exists.
- `keybindings.json5` lives in the Velocetty configuration directory. On every
  platform, an absolute `XDG_CONFIG_HOME` takes precedence, and the directory
  is created beneath it. Otherwise:
  - Linux and macOS: `~/.config/Velocetty`.
  - Windows: `%APPDATA%\Velocetty`.
- Start-up migration is conditional. It runs only when `keybindings.json5`
  does not exist. A valid `keymaps` value is copied into the new file, and
  Velocetty never rewrites `config.json5`, so its comments and formatting are
  preserved. When `config.json5` holds no `keymaps`, the new file is created
  with an empty object. If `config.json5` cannot be parsed, or its `keymaps`
  value is invalid, migration is postponed to a later start rather than seeding
  an empty file.
- Once `keybindings.json5` exists, it is the source of truth. The legacy
  `keymaps` key is ignored; when it holds a valid `keymaps` value, a
  notification states that `keybindings.json5` takes precedence.
- Changes are hot-reloaded. Saving `keybindings.json5` applies the new
  shortcuts within a fraction of a second, without a restart. Unsaved edits
  have no effect.
- While Velocetty is running, deleting the file and writing `{}` both return
  to the platform defaults, but they differ after the next start:
  - `{}` is an explicit empty set of user overrides. It persists, so the
    platform defaults remain in effect on later starts.
  - Deleting the file is not a durable reset. On the next start Velocetty
    recreates the file when it can classify the legacy configuration. If
    `config.json5` still holds valid `keymaps`, those shortcuts are migrated
    again; if it holds none, the recreated file is `{}`. If `config.json5`
    cannot be parsed, recreation is postponed, as described above.
- Invalid and unreadable files never remove working shortcuts during a
  session:
  - During hot reload, the shortcuts already in effect stay in effect, and a
    notification names the first problem. A later valid save is applied.
  - At start-up there is no previous session to fall back to, so Velocetty
    starts with the platform defaults and shows the same kind of
    notification. The file is left in place rather than overwritten.
  - An unreadable file, for example because of file permissions, is treated
    the same way.

## Detailed instructions

Step-by-step instructions, including the file format and shortcut syntax, are
in the [users' guide](users-guide.md).
