# Architectural decision record (ADR) 008: Velocetty configuration directory

## Status

Accepted on 2026-10-30. Roadmap item `3.2.1` is delivered under
`docs/execplans/3-2-1-store-keybindings-in-keybindings-json5.md`. The Velocetty
tree is created at start-up, `config.json5` and `keybindings.json5` resolve
through it first, the Hyper tree remains a read-only fallback, and the CLI
resolves the same order through the mirrored resolver. `docs/users-guide.md`
documents the user-facing consequences of the migration.

## Date

2026-10-29

## Context and problem statement

Velocetty inherited Hyper's configuration directory. That directory is
`$XDG_CONFIG_HOME/Hyper` when the variable is set, and otherwise
`~/.config/Hyper` on Linux and macOS or Electron's `userData`
(`%APPDATA%\Hyper`) on Windows. The design's paths table
(`docs/velocetty-design.md`, §File format and locations) proposes `Velocetty`
directories instead.

Roadmap item `3.2.1` adds the first new configuration file,
`keybindings.json5`. On 2026-10-29 the maintainer directed the following:
create a Velocetty-named tree for the new file, give it priority over the old
tree, keep the old tree supported but never use it for new configuration files,
and prefer an XDG configuration directory on Linux.

Two programs resolve the configuration path. The main process
(`app/config/paths.ts`) resolves it, and so does the command-line interface
(CLI, in `cli/api.ts`), whose plugin commands edit `config.json5`. They must
agree.

## Decision drivers

- Existing users' configuration must keep working without being moved.
- Fresh installs must not create any configuration file under the Hyper name.
  Electron's `userData` (`<appData>/Hyper`) still receives application state on
  every platform until the product name changes. On Linux, `userData` is the
  same directory as the Hyper tree.
- Linux users expect the XDG Base Directory specification to be honoured.
- The main process may import only types from `@shared`. The CLI may import
  only `@shared` runtime code.

## Options considered

| Option                                                            | Existing users      | Fresh installs  | Risk                           |
| ----------------------------------------------------------------- | ------------------- | --------------- | ------------------------------ |
| A. Velocetty tree first, Hyper tree as read-only fallback         | Unchanged           | Velocetty only  | Two places to look             |
| B. Move `config.json5` from Hyper to Velocetty on first start     | Moved automatically | Velocetty only  | Rewrites users' files; plugins |
| C. Keep the Hyper tree and add only `keybindings.json5` beside it | Unchanged           | Hyper name kept | Contradicts the direction      |

_Table 1: Configuration directory options._

## Decision outcome

Option A.

- The Velocetty tree is chosen in this order:
  - `$XDG_CONFIG_HOME/Velocetty`, when `XDG_CONFIG_HOME` is set to an absolute
    path, on any platform;
  - otherwise `~/.config/Velocetty` on Linux and macOS, and
    `%APPDATA%\Velocetty` on Windows (Electron's `appData`, not `userData`).

  An empty or relative `XDG_CONFIG_HOME` is ignored, as the XDG Base Directory
  specification requires.
- `config.json5` is resolved in this order:
  1. a development-mode file (unchanged; see below);
  2. `Velocetty/config.json5`;
  3. the Hyper tree's existing rules (`config.json5`, then `hyper.json`).

  If none exists, it is created in the Velocetty tree. A development-mode
  `config.json5` beside the application root (`dist/` for the application)
  takes precedence over both trees, as it does today.
- `keybindings.json5`, and any later new configuration file, lives in the
  Velocetty tree, except that an active development-mode `config.json5` or
  `hyper.json` keeps it beside that development file.
- No configuration file is created in the Hyper tree. The editor schema copy
  is refreshed there only if it already exists. Plugin directories follow the
  active `config.json5`, because they hold plugin state rather than
  configuration.
- When both trees hold a `config.json5`, the Velocetty copy wins, and a
  notification names the ignored copy.
- The tree is chosen once, at start-up.
- The resolver is a pure function in `app/config/config-tree.ts`, mirrored for
  the CLI in `shared/src/config/config-tree.ts`. Exhaustive enumeration tests
  and a parity test keep the two copies in step.

## Known risks and limitations

- Users with a `config.json5` in both trees may edit the ignored copy. The
  start-up notification and the users' guide mitigate this.
- Moving an existing configuration is manual. Quit Velocetty, move
  `config.json5`, `schema.json`, and `plugins/` from the Hyper tree into the
  existing Velocetty directory, and restart. Do not move the other files in the
  Hyper directory; they are Electron application state. Automatic migration may
  follow once the Hyper tree is retired.
- macOS uses `~/.config/Velocetty`, not `~/Library/Application Support`, to
  match the design's paths table and the Hyper tree.
- On Linux the directory name is case-sensitive, and `~/.config/velocetty` is
  not consulted.
- A broken symlink in the Hyper tree counts as present in the application, so a
  dotfiles-managed configuration is never silently shadowed. The CLI's narrower
  filesystem slice cannot tell a dangling link from an absent file.
- The application and the CLI pass different inputs to the mirrored resolver.
  The CLI derives `userData` as `<appData>/Hyper`, compares trees by string
  equality rather than by `realpath`, and detects development mode from
  `NODE_ENV` rather than `electron-is-dev`. The priority rules are shared, but
  a dangling symlink or an unusual development layout can resolve differently.
  Tracking issue `CONFIG-003` records this.
- `XDG_CONFIG_DIRS`, the system-wide configuration search path, is not
  consulted.
- Electron still writes its own caches to `userData` (`%APPDATA%\Hyper` on
  Windows) until the product name changes. That is application state, not
  configuration.

## Architectural rationale

A priority lookup leaves users' files where they are, and stops the Hyper name
from spreading to new installs. A single pure resolver, with exhaustive tests,
makes the precedence rules auditable. The mirrored copy plus a parity test
follows the repository's existing pattern for code needed on both sides of the
`@shared` boundary.
