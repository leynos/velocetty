# Users' guide

## Module header

- Purpose: Explain to people using Velocetty how commands and keybindings
  behave.
- Invariants: Keep the behaviour described here aligned with the dispatcher in
  `lib/command-dispatch/`; plugin authoring belongs in `PLUGINS.md`.
- Cross-links: [Developers' guide](developers-guide.md),
  [Command dispatch architecture](command-dispatch-architecture.md), and
  [Plugin development](../PLUGINS.md).

## Commands and keybindings

Velocetty treats every action as a command. A keyboard shortcut, the close
button on the search box, and a plugin that asks to run a command all take the
same route: the command dispatcher resolves the command, checks it, and runs
it. One route means a shortcut and a button cannot disagree about what a
command does.

### Refused shortcuts pass the key through

A shortcut takes its key only when its command is admitted. If the command
cannot run — it is not registered, its arguments do not validate, or its `when`
condition disables it — the key is passed through to the terminal instead of
being swallowed.

Escape shows the same result in ordinary use. It is bound to the command that
closes the search box, and with no search box open it still reaches the
terminal: run `cat -v`, press Escape, and `^[` appears. The same holds for any
other shortcut whose command is unavailable.

### Where refusals are reported

A refused shortcut is reported in the developer console. The default build
reports warnings; add `?debug=1` to the renderer URL for debug-level detail,
which includes a shortcut refused because its command is disabled.

A refusal is not always a fault. An unregistered command and a disabled command
are reported at different levels, and either way the key remains available to
the terminal.
