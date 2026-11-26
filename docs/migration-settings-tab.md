# Migrating to the settings tab (4.0.0)

## Module header

- Purpose: tell an existing user what changed when **Preferences…** started
  opening the in-app settings tab instead of the external editor.
- Invariants: the behaviour described here matches `app/commands.ts`,
  `lib/settings/`, and the [users' guide](users-guide.md).
- Cross-links:
  - [Users' guide](users-guide.md)
  - [Settings tab architecture](settings-tab-architecture.md)
  - [ADR 009](adrs/adr-0009-settings-tab-hosting-and-persistence.md)

## What changed

**Preferences…**, `Ctrl+,`, and `Cmd+,` now open a **Settings** tab in the
window. They no longer open `config.json5` in your external editor. The
terminal keeps running, and opening the tab does not resize or restart it.

## What did not change

- The settings tab edits the same `config.json5` and `keybindings.json5` files
  as before. There is no second store and no export step.
- Every write is a targeted edit: your comments, ordering, quoting, and line
  endings elsewhere in the file are preserved.
- An external editor still works. A save from another program is reloaded and
  the tab refreshes.
- A legacy `hyper.json` remains read-only in the settings tab until it is
  renamed to `config.json5`.

## Opening the file directly

Use the **Open config file** button in the settings tab, or open the file
yourself. Settings the tab does not cover — the colour palette, environment
variables, shell arguments, custom CSS, profiles, and plugin namespaces — are
edited in the file as before. See
[Other settings, and the config file](users-guide.md#other-settings-and-the-config-file).

## Rolling back

There is nothing to roll back: the tab only edits the existing file. A build
without the tab opens the same file from **Preferences…** and ignores no
settings the tab wrote.
