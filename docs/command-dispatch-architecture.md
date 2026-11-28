# Command dispatch architecture

## Module header

- Purpose: Describe the components of the frontend command dispatcher, how they
  fit together, and which parts are proved.
- Invariants: The proved machine stays a pure function with no imports, timers,
  or clock reads; every command source uses the one dispatcher; the interpreter
  remains the only code that consults the machine.
- Cross-links: [ADR 009](adrs/adr-0009-frontend-command-dispatcher-contract.md),
  [Developers' guide](developers-guide.md), [Technical design](velocetty-design.md),
  and [Users' guide](users-guide.md).

## Purpose and trust boundary

The frontend command dispatcher is the renderer's one path from an invocation
to a command handler. A keyboard shortcut, a UI control, and a plugin call all
reach the same `invoke`; they differ only in the `source` they supply. Because
the path is shared, precedence, argument validation, and cancellation cannot
drift between sources.

The design separates a small proved contract from the infrastructure that
surrounds it:

- **Proved.** `policy/invocation-machine.ts` is a total function from state and
  event to state and action. It imports nothing, holds no timers, and reads no
  clock. `policy/invocation-machine.dfy` proves four families of property over
  it: gate order, run-at-most-once, settle-at-most-once with absorption, and
  the cancellation outcomes.
- **Trusted.** The interpreter in `dispatcher.ts` is trusted to feed the
  machine faithfully. A structural test counts its `step` call sites and
  promise-resolution call sites, because a proof of a machine the interpreter
  bypasses would prove nothing.
- **Trusted.** The driven adapters touch the registry, the context-key service,
  Redux, and the transport. The inbound adapters touch Mousetrap and React.
  None of that is proved; it is tested or reviewed.
- **Trusted.** Argument and result validation is JSON Schema validation through
  the command-schema interpreter, reached through the registry. The machine
  decides when validation runs and what a failure means, not whether the
  interpreter implements a schema keyword correctly.
- **Trusted.** The host process is outside this boundary. Admitting an
  invocation is not a permission check; backend permission checking remains a
  separate concern.

## The machine

`lib/command-dispatch/policy/invocation-machine.ts` exports `MachineState`,
`MachineEvent`, `MachineAction`, `initialState(isAborted)`,
`step(state, event)`, and `outcomeOf(state)`. `initialState` seeds an
invocation; `step` returns the next state and the one action to perform;
`outcomeOf` reports the outcome, or `pending` before settlement.

### Phases

| Phase          | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| `admitting`    | Evaluating admission gate `gate`, an index from 0 to 3.               |
| `awaitingGate` | Every gate passed; the execution gate is open and its effect pending. |
| `executing`    | A handler is running.                                                 |
| `settled`      | Finished, with an `outcome` and the `failedGate` index or `-1`.       |

Table 1: the machine's four phases.

### Gates

The four admission gates, in index order, are:

1. resolve the command definition;
2. route the arguments (a host command cannot carry arguments);
3. validate the arguments against the definition's `argsSchema`;
4. evaluate the definition's `defaultWhen` enablement expression.

A refused invocation names the first gate that refused it, in `failedGate`.

### Events and actions

Events report what happened: `gatePassed`, `gateFailed`, `aborted`, `gateRan`,
`gatePending`, `hostEmitted`, `handlerFulfilled{resultValid}`, and
`handlerRejected{isAbortReason}`.

Actions state what to do next: `evaluateGate{gate}`, `openGate`, `runHandler`,
`settle`, and `idle`. A settled state absorbs every later event with `idle`.

### Outcomes

`MachineOutcome` is `ok`, `rejected`, `failedHandler`, `failedResult`,
`cancelledBefore`, or `cancelledDuring`. `outcomeOf` adds `pending` for a state
that has not settled.

The interpreter maps each outcome to the shared `CommandResult`:

| Machine outcome   | `CommandResult`                                            |
| ----------------- | ---------------------------------------------------------- |
| `ok`              | `{status: 'ok', value?}`                                   |
| `rejected`        | `{status: 'error', error}` from the refusing gate          |
| `failedHandler`   | `{status: 'error', error}` with `COMMAND_EXECUTION_FAILED` |
| `failedResult`    | `{status: 'error', error}` from result validation          |
| `cancelledBefore` | `{status: 'cancelled', stage: 'before-execution'}`         |
| `cancelledDuring` | `{status: 'cancelled', stage: 'during-execution'}`         |

Table 2: machine outcomes and the result a caller observes.

## The interpreter

`lib/command-dispatch/dispatcher.ts` holds one `MachineState` per invocation.
It asks the machine what to do and does only that, feeding each outcome back as
the next event. Two structural facts make the proof meaningful:

- `step` is called in exactly one function, `transition`.
- The invocation's promise is resolved in exactly one function,
  `performSettle`.

`test/unit/command-dispatch/interpreter-structure.test.ts` asserts both call
site counts by reading the dispatcher's source, so a refactor cannot quietly
add a second path around the machine.

`createCommandDispatcher(ports)` returns `{invoke, check}`. `invoke` never
rejects. Admission runs synchronously: when nothing defers the execution gate,
the handler starts before `invoke` returns its promise, which is what lets a
legacy handler call `event.preventDefault()` in time. `check` performs only the
admission fold and no effect, so the keybinding binder can decide whether to
catch a key without running anything.

## Ports and driven adapters

`ports.ts` names five driven ports. Each is a plain interface over serializable
values, so a test can satisfy it in memory and the dispatcher cannot reach past
it. `compose.ts` supplies the real adapters.

### Command catalogue

`get`, `validateArgs`, and `validateResult`. `adapters/registry-catalogue.ts`
resolves definitions from `lib/command-registry.ts`. An identifier that the
latest keymap snapshot binds but the registry never defines resolves to a host
stub (`kind: 'backend'`, no schemas). The stub is synthesized on read and never
written to the registry, so `list()` stays the palette's source of truth. A
stub declares no schemas, so its arguments pass this port; the interpreter's
route gate is what restricts a host command to `null` arguments.

### Enablement evaluator

`evaluate(expression)` returns `enabled`, `disabled`, or `invalid`.
`adapters/context-key-enablement.ts` wraps the context-key service and maps a
thrown parse error to `invalid`, so a broken `when` expression fails closed with
`INVALID_WHEN_EXPRESSION` instead of being treated as enabled. A false
evaluation is `disabled`, which reports `COMMAND_DISABLED`.

### Execution gate

`admit(invocation, args, run)` returns `ran` or `pending`.
`adapters/redux-execution-gate.ts` dispatches `UI_COMMAND_EXEC` carrying
`source` and a `structuredClone`d, deeply frozen copy of the arguments, with an
idempotent `effect` that runs the handler. The idempotence matters because a
plugin middleware may re-dispatch a cloned action. A middleware that swallows
the action and one that defers it are indistinguishable, so both report
`pending`.

### Command executor

`routeOf(id)` and `start(invocation, args, signal, context)`.
`adapters/renderer-executor.ts` routes by handler presence, never by `kind`: a
command with a registered renderer handler runs here, and one without a handler
is emitted to the host and finishes as `hostEmitted`. The handler request
carries the invocation, the validated arguments, the caller's signal, the Redux
dispatcher, and the triggering keyboard event. An async closure turns a
synchronous handler throw into a rejection, so it settles the invocation rather
than escaping into the Redux effect.

### Logger

`debug` and `warn`. `compose.ts` builds a console adapter: `warn` always
writes, and `debug` writes only when `?debug=1` is present in the renderer URL.
The dispatcher makes no `console` calls of its own.

The optional `MachineTracer` records every event the interpreter feeds the
machine. Only tests supply one; the cancellation property folds the recorded
trace through the proved machine to check that the interpreter refines it.

## Inbound adapters

Three adapters turn external events into invocations. They differ in the source
they fix and in what they may pass.

### Keybinding binder

`createKeybindingBinder({dispatcher, keymap, getMousetrap, logger, onSnapshot})`
returns `{reload, reset}`. A reload fetches the keymap before resetting
Mousetrap, then applies the registry sync, the snapshot, and the new bindings
in one synchronous block guarded by a generation counter. A stale completion is
dropped; a failed fetch keeps the existing bindings and logs a warning.

Each bound callback asks `dispatcher.check()` first. A refused shortcut sets
neither `catched` nor `preventDefault`, so the key reaches the terminal. An
admitted shortcut sets `catched` and calls `preventDefault` unless the command
is an Electron role command, then invokes synchronously inside the keydown
callback. That one flag and one synchronous call are what keep xterm and legacy
handlers working.

### Plugin command API

`createPluginCommandApi(dispatcher)` fixes `source: 'plugin'` and accepts no
trigger event. Before admission it rejects an argument that is not a
transferable JSON value with `INVALID_COMMAND_ARGS`; that includes a class
instance whose own properties happen to be JSON, because a plugin shares the
renderer process and could otherwise hand over something that would not survive
serialization. `unavailablePluginCommandApi` supplies the same facade shape
outside the application tree, returning a structured failure instead of
throwing.

### React provider and UI invoker

`inbound/command-dispatcher-provider.tsx` exports `CommandDispatcherContext`,
`CommandDispatcherProvider`, and `useCommandInvoker()`. The provider publishes
the one bundle the composition root built. The hook fixes `source: 'ui'`, so a
component cannot claim to be a keybinding or a plugin, and it resolves
`COMMAND_EXECUTION_FAILED` outside the provider rather than throwing.
`inbound/search-close.ts` is the search box close button's route: it invokes
`editor:search-close` with `{uid}` when a bundle exists, and otherwise calls
the caller's local teardown.

## Composition

`compose.ts` exports
`composeRendererDispatcher({dispatch, emitHostCommand, getMousetrap, logger?,
isDebugEnabled?})`.
It returns `{dispatcher, keybindings, invokeCommand}`.

The composition builds, in dependency order, the registry catalogue, the
context-key enablement evaluator, the Redux execution gate, the renderer
executor, the dispatcher, and the keybinding binder. The keymap snapshot is
shared through one holder: the binder writes it and the catalogue reads it, so
both describe the same reload. Exactly one dispatcher exists per renderer, and
every source uses it.

`lib/index.tsx` calls `composeRendererDispatcher` inside `mountApp` and wraps
the tree in `CommandDispatcherProvider`.

## Sequence of one invocation

1. `invoke` normalizes absent arguments to `null`.
2. `initialState(signal?.aborted === true)` seeds the machine. If the signal is
   already aborted, the invocation settles as `cancelled` with stage
   `before-execution` and no gate runs.
3. The resolve gate asks the catalogue for the definition. An unknown command
   fails as `COMMAND_NOT_FOUND`.
4. The route-arguments gate refuses a non-null argument to a host command as
   `INVALID_COMMAND_ARGS`.
5. The validate-arguments gate validates the value against `argsSchema`.
   Validation issues are carried on the error.
6. The enablement gate evaluates `defaultWhen`, but only for `keybinding`,
   `palette`, `menu`, and `ui`. A disabled command fails as `COMMAND_DISABLED`;
   an unparsable expression fails as `INVALID_WHEN_EXPRESSION`.
7. `openGate` admits the invocation through the execution gate, which
   dispatches `UI_COMMAND_EXEC` with a frozen copy of the arguments. If the
   effect runs, the machine receives `gateRan`; if not, it waits for the effect
   or for the caller's signal.
8. `runHandler` starts the executor. A command with no renderer handler is
   emitted to the host and settles `ok` as `hostEmitted`.
9. A renderer handler runs with
   `{invocation, args, signal, dispatch, triggerEvent}`. Its fulfilment is
   validated against the definition's `resultSchema` when one is declared; a
   rejection settles `failedHandler`, unless it is the signal's own abort
   reason, which settles `cancelledDuring`.
10. Settlement happens once. `outcomeOf` decides the `CommandResult`, the abort
    listener is removed, and a handler rejection arriving after settlement is
    consumed and logged at debug level.

## Cancellation semantics

- An abort before execution settles `cancelled` with stage `before-execution`.
  That stage guarantees no handler ran and nothing was emitted to the host.
- An abort during execution settles at once as `cancelled` with stage
  `during-execution`. The handler keeps running unless it observes the signal;
  its later outcome is discarded and logged at debug level.
- The dispatcher attaches an abort listener only when the caller supplied a
  signal, and removes it on settlement. Callers that pass none share
  `NEVER_ABORTS_SIGNAL`, so they cannot accumulate listeners.
- A handler opts into cooperative cancellation by accepting `request.signal`.
  Settling early does not stop the work; the handler must check the signal and
  return.

## Verification

`make prove` runs `./bin/prove.sh`, which verifies every source listed in
`LemmaScript-files.txt` through the pinned
`node_modules/.bin/lsc check --backend=dafny`. The list holds a source path and
a timeout per line, and it currently names `test/proofs/sample.ts`,
`app/config/keybindings-policy.ts`, and
`lib/command-dispatch/policy/invocation-machine.ts`. Run `bun install` first;
the script needs `node_modules/.bin/lsc`. It also requires Dafny 4.11.x and Z3
4.12.1 where Dafny looks for its solver, and it reports
`Dafny program verifier finished with N verified, 0 errors`.

`prove` is part of `make all`. The script refuses a vacuous pass: it fails on
an empty list, on a timeout above 60 seconds, on a policy source that exists
but is not listed, on a forbidden trust construct other than the single
`emptyUserKeymaps` axiom, on fewer verifier summaries than listed sources, and
on stale generated `.dfy.gen` artefacts.

The invocation machine's proof carries 33 verified obligations, with 0 errors.
They are:

- admission gates are evaluated in index order, and a refusal names the first
  gate that refused;
- `runHandler` is emitted at most once, only after every gate passed, and never
  after an abort settled the invocation;
- `settle` is emitted at most once, and a settled state absorbs every later
  event;
- an abort before `runHandler` yields `cancelledBefore`, and an abort after it
  yields `cancelledDuring`.

Fast-check properties cover the gap between the synchronous machine and the
asynchronous interpreter:

- `cancellation.property.test.ts` folds the recorded event trace from the
  initial state and compares the machine's outcome with the interpreter's
  resolved result, across ok, rejected, cancelled, and deferred scenarios.
- `validation.property.test.ts` covers argument and result validation,
  including a mutant that must fail.
- `keybinding-reload.property.test.ts` covers overlapping reloads and the
  generation guard.
- `convergence.test.ts` drives the real dispatcher, registry, and execution
  gate from a keybinding, a UI control, and a plugin, and checks that they
  produce the same machine trace and the same `UI_COMMAND_EXEC` action apart
  from `source`.
- `interpreter-structure.test.ts` checks the single `step` call site and the
  single resolution point.

Property tests set explicit run counts and per-test timeouts, and use no
timers. The focused stress run is:

```bash
bun test --concurrent test/unit/command-dispatch/
```

Residual gaps:

- Nothing proves the adapters, React, Redux, the transport, Mousetrap, or the
  command-schema interpreter. Their behaviour is taken as given; the machine
  governs only when they are consulted and what their answers mean.
- Nothing proves the interpreter feeds the machine faithfully. The structural
  test narrows the gap; it does not close it.
- A plugin middleware that swallows `UI_COMMAND_EXEC` leaves the invocation
  pending unless the caller passed a signal. This is a documented consequence
  of the execution gate's semantics, not a defect.
- Nothing populates context keys yet, so a `defaultWhen` that references one
  evaluates against an empty service and disables the command for the
  affordance sources. No current definition sets `defaultWhen`.
- Backend permission checks and backend cancellation tokens belong to roadmap
  item 4.1.2 and are not part of this dispatcher.
- The deep end-to-end lane scripts the user-visible path; it is supporting
  evidence, not verification.

The rationale for the contract shape — the result union, routing by handler
presence, pending gate semantics, source-aware enablement, and `null`
normalization — is recorded in
[ADR 009](adrs/adr-0009-frontend-command-dispatcher-contract.md).
