# Architectural decision record (ADR) 007: Frontend command dispatcher contract

## Status

Proposed.

## Date

2026-11-25

## Context and problem statement

Roadmap item 4.1.1 delivers one renderer-side path through which every
keybinding, user-interface (UI) control, and plugin call runs a command. The
technical design (`docs/velocetty-design.md`) sketches the pipeline and the
result type, but four questions are left open, and each changes a public
contract:

- What shape does a command result have?
- How is a command routed to the renderer or to the main process?
- What happens when plugin middleware swallows or defers the Redux action that
  gates execution?
- Does `when` enablement apply to every invocation source?

The answers must not add an Internet Protocol Control (IPC) channel, must keep
the documented Hyper plugin contracts in `PLUGINS.md` working, and must be
provable rather than merely tested.

## Decision drivers

- One invocation path for every source, so precedence and cancellation cannot
  drift between sources.
- Illegal states unrepresentable, so a caller cannot observe both success and
  an error.
- No new IPC surface, no main-process change.
- Third-party Hyper plugins keep working: `terms.registerCommands({...})`
  handlers still receive `(event, dispatch)`, plugin Redux middleware can still
  observe, swallow, or defer the execution action, and a command with no
  renderer handler is still emitted to the main process.
- The contractual logic is small enough to verify formally.

## Decision outcome

### D-3: a discriminated result union

`CommandResult` is a union on `status`:

```ts
type CommandResult<TResult extends JsonValue = JsonValue> =
  | {readonly status: 'ok'; readonly value?: TResult}
  | {readonly status: 'error'; readonly error: CommandInvocationError}
  | {readonly status: 'cancelled'; readonly stage: CommandCancellationStage};
```

This replaces the design sketch's `{ok: boolean; result?; error?; cancelled?}`,
which admits `ok: true` together with an `error`. The union makes those states
unrepresentable and gives exhaustive `switch` checking.

Mapping onto the protobuf `CommandResult` sketch for 4.1.2: `status` becomes
the message's oneof discriminator, `value` the `ok` arm's payload, `error` the
`error` arm, and `stage` the `cancelled` arm. The backend extends that message
rather than flattening the union.

`invoke` never rejects. `TResult` is unchecked unless the definition declares a
`resultSchema`.

### D-5: routing by handler presence, not by `kind`

A command with a registered renderer handler executes in the renderer.
Otherwise its identifier is emitted to the host over the existing
fire-and-forget `transport.emit('command', id)` channel. The host route admits
only `null` arguments, because that channel cannot carry arguments; non-null
arguments fail as `INVALID_COMMAND_ARGS`.

`kind` stays descriptive until 4.1.2. Routing on it would break two documented
cases: plugins override built-in host commands with renderer handlers (the
`pane:maximize` example in `PLUGINS.md`), and the golden-path demonstration
command declares `kind: 'frontend'` while being implemented in the main process.

### D-6: pending semantics for the execution gate

The execution gate dispatches `UI_COMMAND_EXEC`, carrying `source` and frozen
`args`, with an `effect` callback. Execution happens inside that effect. If
`dispatch` returns without the effect having run, the gate reports `pending`,
and the invocation settles when the effect runs or the caller's signal aborts.

The dispatcher does not try to distinguish a middleware that swallows the
action from one that defers it, because the Redux `effects` middleware makes
them indistinguishable: both leave `dispatch` returning without the effect
having run. The `run` callback is idempotent, so a middleware that
re-dispatches a cloned action cannot execute twice, and it is a no-op after
settlement.

Permission checks in 4.1.2 will be an admission gate, not middleware, so a
plugin cannot grant itself authority by intercepting an action.

### D-7: enablement is source-aware

`defaultWhen` is a gate for the affordance sources `keybinding`, `palette`,
`menu`, and `ui`. The `plugin` and `remote` sources skip it, matching Visual
Studio Code's `executeCommand`. An unparsable expression fails closed with
`INVALID_WHEN_EXPRESSION`.

Every source still runs the same machine; the source only selects which verdict
the enablement gate computes. Until roadmap item 4.2.1 populates context keys, a
`defaultWhen` that references a key evaluates against an empty service, so any
such command is disabled for the affordance sources. No current definition sets
`defaultWhen`.

### D-11: absent arguments normalize to `null`

An absent `args` is normalized to `null` before validation, and handlers receive
`null`. Commands with optional object arguments declare
`type: ['object', 'null']`.

`undefined` is not a JSON value and does not survive the wire. Normalizing to
`null` also keeps Escape working: it binds `editor:search-close` with no
arguments, and a schema that demanded an object would reject every Escape press.

### D-14: one pure state machine, interpreted

The contractual logic is one pure state machine,
`lib/command-dispatch/policy/invocation-machine.ts`, exposing
`step(state, event) → {state, action}`. The dispatcher holds a single state
variable, performs only the action the machine returns, and resolves its
promise in exactly one function.

Proving the machine the interpreter actually executes covers gate order,
at-most-once execution, and exactly-once settlement. Two earlier designs were
rejected: an admission fold expressed as `findIndex` with a comment, and a
separate settlement reducer that risked becoming a parallel model of the code
it claimed to describe.

The machine imports nothing and reads no clock. `make proofs` verifies it with
LemmaScript and Dafny; `fast-check` properties then check that the asynchronous
interpreter refines the proved machine.

## Consequences

- Positive: one path, exhaustive result handling, no illegal result states, and
  a proved core.
- Positive: a keybinding whose command is refused at admission no longer
  swallows the key; it reaches the terminal.
- Negative: a plugin middleware that swallows `UI_COMMAND_EXEC` leaves the
  invocation pending. Callers that await must pass a signal. This is documented
  in `PLUGINS.md`.
- Negative: legacy handlers written for keybindings receive `undefined` when
  invoked from a UI control or another plugin. Such a handler fails as
  `COMMAND_EXECUTION_FAILED` rather than crashing the renderer.
- Negative: `defaultWhen` cannot be honoured until roadmap item 4.2.1 populates
  context keys.

## Alternatives considered

- Keep the record-shaped result. Rejected: illegal states and no exhaustive
  checking.
- Route by `kind`. Rejected: breaks plugin overrides and the golden-path
  command.
- Synthesize registry definitions from keymaps. Rejected: pollutes `list()`,
  the palette's source of truth, and needs separate ownership tracking, which
  an earlier draft got wrong by deleting a plugin handler on removal.
- Settle as soon as `dispatch` returns. Rejected: misreports a deferral as a
  veto.

## References

- `docs/roadmap.md` item 4.1.1
- `docs/velocetty-design.md` §Command registry and dispatcher,
  §Cancellation semantics
- `docs/velocetty-product-requirements-document.md` §3
- `PLUGINS.md`
