# Implement the frontend command dispatcher (roadmap 4.1.1)

## Module header

Purpose: deliver one renderer-side command dispatcher through which every
keybinding, user-interface (UI) control, and plugin call runs. The dispatcher
validates arguments against JSON Schema before execution and honours
cancellation through `AbortSignal`.

Invariants: every invocation is driven by one pure, proved state machine. It
evaluates the admission gates lazily and in a fixed order (resolve, route
arguments, validate arguments, check enablement), then opens the Redux
execution gate, then executes and validates the result. Every invocation
settles exactly once, as `ok`, `error`, or `cancelled`. No handler runs, and
nothing is emitted to the host, for an invocation that fails a gate or whose
signal was aborted first. `invoke` never rejects.

Cross-links: `docs/roadmap.md` (4.1.1), `docs/velocetty-design.md` §Command
registry and dispatcher and §Cancellation semantics,
`docs/velocetty-product-requirements-document.md` §3, `lib/command-registry.ts`,
`lib/context-key-service.ts`, `shared/src/types/commands.ts`,
`shared/src/constants/ui.ts`, `lib/utils/effects.ts`, `PLUGINS.md`.

This Execution Plan (ExecPlan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT

The status moves through DRAFT, APPROVED (after explicit user approval), IN
PROGRESS, and COMPLETE. BLOCKED is used whenever a tolerance is breached or a
design deviation awaits approval. No `PLANS.md` exists in this repository; this
file is the only plan for the work.

## Purpose / big picture

Velocetty is a fork of the Hyper terminal, and its design mantra is that
"everything the app can do is a command". Today a keystroke reaches an action
through a bespoke chain: `lib/containers/hyper.tsx` binds Mousetrap shortcuts,
looks up a renderer handler, and dispatches a Redux thunk
(`lib/actions/ui.ts#execCommand`). That thunk either calls the handler or emits
the command name to the Electron main process. Nothing validates arguments,
nothing checks `when` enablement, nothing can be cancelled, and nothing reports
a result. UI buttons and plugins bypass even this chain.

After this work:

- A single `dispatcher.invoke(invocation, options)` call is the only way the
  renderer executes a command. Keybindings, the search box close button (the
  first UI control routed through commands), and plugins (through the new
  `Terms#invokeCommand` method) all use it.
- A command whose definition declares an `argsSchema` rejects invalid
  arguments with a structured `INVALID_COMMAND_ARGS` error before any handler
  runs. Absent arguments are validated, and delivered, as `null`.
- A caller can pass an `AbortSignal`. An already-aborted signal prevents
  execution. Aborting during execution settles the invocation as `cancelled` at
  once, and the handler receives the signal so it can stop cooperatively.
- Every invocation resolves to a discriminated `CommandResult`: `ok` with an
  optional value, `error` with a code and message, or `cancelled` with the
  stage at which cancellation took effect.
- A keybinding whose command is refused at admission (for example, disabled
  by its `when` expression) no longer swallows the keystroke; the key passes
  through to the terminal.

A human can see it working in the packaged app. Press the search shortcut and
the search box opens; click its close button and it closes; with the box
closed, press Escape inside `cat -v` and `^[` appears, proving Escape still
reaches the terminal. Every step travels through the dispatcher. The deep
end-to-end (E2E) scenario `test/e2e-deep/command-dispatch.e2e.ts` asserts all
three. Behavioural unit tests show that one command invoked from each of the
three sources produces the same machine trace and the same Redux
`UI_COMMAND_EXEC` action, differing only in `source`.

This plan covers only the renderer (frontend) dispatcher. The backend command
registry, server-side re-validation, permission checks, cancellation tokens for
host commands, and result-bearing backend calls belong to roadmap 4.1.2.
Routing the remaining menus and buttons through commands belongs to 4.3.2.
Populating context keys belongs to 4.2.1.

## Constraints

- Implementation starts only after the user explicitly approves this plan.
- Do not modify the Electron main process (`app/`). Do not add, rename, or
  change any IPC channel or its Zod schema in `lib/transport/ipc-schemas.ts`.
  Host (main-process) commands keep using the existing fire-and-forget
  `transport.emit('command', id)` channel.
- Preserve the documented Hyper plugin contracts in `PLUGINS.md`.
  `terms.registerCommands({...})` handlers keep receiving `(event, dispatch)`,
  and the command name is still emitted to the main process when no renderer
  handler exists. Plugin Redux middleware can still observe, swallow, or defer
  the `UI_COMMAND_EXEC` action before a command executes. These are the only
  compatibility surfaces, and they have named external consumers: third-party
  Hyper plugins. No other compatibility layer is permitted.
- Keep `decorateKeymaps`, the keymap shape returned by `getDecoratedKeymaps`,
  and `shouldPreventDefault` behaviour unchanged for admitted commands. A
  legacy handler that calls `event.preventDefault()` or resets `event.catched`
  must still run synchronously inside the keydown callback.
- The policy module `lib/command-dispatch/policy/invocation-machine.ts` must
  import nothing. The dispatcher core (`lib/command-dispatch/*.ts`, outside
  `adapters/` and `inbound/`) must not import React, Redux, Ajv, the transport,
  the context-key service, `typings/hyper`, or any DOM event type.
  `scripts/check-package-boundaries.mjs` enforces both rules under `make lint`.
- The dispatcher creates no timers and reads no clock. Timeouts are the
  caller's concern (`AbortSignal.timeout`). Logging goes through an injected
  logger port; dispatcher code makes no `console` calls.
- Tests follow `docs/developers-guide.md` "Unit tests (Bun)". They use no
  `mock.module` (`deslop/no-module-mocking` is an error) and no file-scope
  teardown of global shims. They inject seams instead of using global timers or
  loggers, use no thenable fakes (`unicorn/no-thenable` is an error), and pass
  under `bun test --concurrent --isolate`. `tsconfig.typecheck.json` already
  includes `./test/`, so test files are type-checked by `make typecheck`.
- No code file may exceed 400 lines (`AGENTS.md`). `lib/command-registry.ts`
  is at 396 lines, so EP-M1 shrinks it before anything grows it. Pre-existing
  oversized files (`lib/components/term.tsx`) may receive only minimal edits
  and must not grow by more than 15 lines.
  `lib/bootstrap/renderer-bootstrap.ts` must not be edited.
- New dependencies are limited to `fast-check` and `lemmascript`, both for
  development only, as the user requested. `fast-check` takes a caret range.
  `lemmascript` is pinned exactly because it is a tech preview, following the
  `ai-deslop` precedent.
- Documentation uses en-GB-oxendict spelling and follows
  `docs/documentation-style-guide.md`. Commits follow `AGENTS.md`: imperative
  subject of 50 characters or fewer, body wrapped at 72 columns, and a refactor
  in its own commit after the functional change it supports.
- Every milestone ends with the gate line in `Milestones and plateaus`
  passing.

## Tolerances (exception triggers)

- Scope: the planned change set is listed in `Interfaces and dependencies`
  under "Planned file inventory" (57 files). If implementation needs more than
  62 non-ExecPlan files, or more than 4,500 net lines of code and other
  documentation, stop and escalate. This ExecPlan, `bun.lock`, the generated
  `typos.toml`, and generated `*.dfy.gen` files are excluded from the line
  count. All of them except this ExecPlan count towards the file limit.
- Interface: if a change to an IPC channel, a main-process module, or the
  `PLUGINS.md` plugin contracts becomes necessary, stop and escalate.
- Dependencies: if any dependency beyond `fast-check` and `lemmascript` is
  needed, stop and escalate.
- Proof feasibility: if the invocation machine cannot be verified in place
  without `//@ assume` or a parallel model, stop and present the options listed
  in EP-M2. The trigger is three failed `lsc check` iterations on the same
  obligation, or four hours of proof work.
- Iterations: if a gate still fails after three fix attempts within one
  milestone, stop and escalate with the log paths.
- Ambiguity: if a source cannot be routed through the dispatcher without
  user-visible behaviour changes beyond those in `Purpose / big picture`, stop
  and present options.
- File size: if keeping a touched file under 400 lines would require an
  unplanned refactor of more than 100 lines, stop and escalate.

## Risks

- Risk: the pipeline becomes asynchronous before the handler runs, so legacy
  handlers call `event.preventDefault()` too late, or `closeSearchAction` resets
  `event.catched` after xterm has already consumed Escape. Severity: high.
  Likelihood: medium. Mitigation: obligation `INV-SYNC` (handler runs before
  `invoke()` returns), the Escape convergence row, and the `cat -v` E2E step.
- Risk: the Escape key binds `editor:search-close` with no arguments, so a
  schema that requires an object would reject every Escape press. Severity:
  high. Likelihood: certain if unaddressed. Mitigation: D-11 normalizes absent
  arguments to `null`, and the command's schema admits `['object', 'null']`.
  Both the convergence test and the E2E scenario press Escape without arguments.
- Risk: renderer-registered commands do not include the main-process commands
  bound in keymaps (for example `tab:new`), so the resolve gate would reject
  every built-in shortcut. Severity: high. Likelihood: certain if unaddressed.
  Mitigation: D-4's catalogue fallback resolves identifiers in the latest
  keymap snapshot as host commands, and the convergence test drives a real
  keymap through the real registry.
- Risk: two configuration reloads interleave in `attachKeyListeners`, so the
  bound keys and the keymap snapshot come from different reloads, and shortcuts
  silently stop working. Severity: high. Likelihood: medium. Mitigation: D-12
  fetches both snapshots before resetting Mousetrap, and applies them in one
  synchronous block guarded by a generation counter.
  `keybinding-reload.property.test.ts` uses `fc.scheduler()` to check this.
- Risk: a plugin middleware swallows `UI_COMMAND_EXEC`, so the invocation
  never settles and the caller waits forever. Severity: medium. Likelihood:
  low. Mitigation: D-6 documents this pending semantics. Callers that await
  pass a signal. The keybinding, UI, and plugin adapters attach no listener
  when given no signal, so nothing accumulates.
- Risk: LemmaScript (tech preview) rejects a construct in the machine, or
  its Dafny output fails to verify. Severity: medium. Likelihood: medium.
  Mitigation: EP-M2 opens with a spike on the smallest annotated function and
  is governed by the proof-feasibility tolerance. The machine imports nothing,
  uses string-literal unions and plain records, and avoids `readonly` array
  types until the spike confirms support.
- Risk: once 4.2.1 populates context keys, a command with `defaultWhen` could
  be disabled for an affordance source for longer than users expect. Severity:
  low. Likelihood: medium. Mitigation: no current definition sets
  `defaultWhen`. ADR-007 and the users' guide state the rule, and a disabled
  keybinding passes the key through instead of swallowing it.
- Risk: legacy plugin handlers written for keybindings assume an event
  argument, and now receive `undefined` when invoked from a UI control or
  another plugin. Severity: low. Likelihood: low. Mitigation: such a handler
  fails as `COMMAND_EXECUTION_FAILED` rather than crashing the renderer, and
  `PLUGINS.md` documents that `e` is `undefined` outside keybindings.
- Risk: the branch is large, and CodeScene (advisory, not a required check)
  fails large pull requests. Severity: low. Likelihood: high. Mitigation: small
  files at full health, separate refactor commits, and acceptance that
  CodeScene is advisory on this repository.
- Risk: the worktree has no `node_modules`, and `bun install` runs a heavy
  `postinstall` (Electron rebuild and snapshot generation). Severity: low.
  Likelihood: certain. Mitigation: run it once in EP-M0 and record the baseline
  gate results before any change.

## Progress

- [x] (2026-10-29) Renamed branch to
  `4-1-1-implement-frontend-command-dispatcher` with upstream
  `origin/4-1-1-implement-frontend-command-dispatcher`.
- [x] (2026-10-29) Reconnaissance by the Wyvern team: shared command types,
  current invocation paths, test and documentation conventions.
- [x] (2026-10-29) External research: LemmaScript status and subset,
  `AbortSignal.any` support, VS Code command semantics, ai-deslop rules.
- [x] (2026-10-29) Drafted this ExecPlan (commit `f5886845`).
- [x] (2026-10-29) Expert-panel design review (six lenses: structure,
  alternatives, verification cost, contracts, failure modes, long-term
  viability). Verdict: proceed with conditions. Revision 2 addresses every
  blocking finding; see `Decision log` D-6 and D-11 to D-16.
- [x] (2026-10-29) Pushed the branch and opened draft pull request
  [#252](https://github.com/leynos/velocetty/pull/252).
- [ ] User approval.
- [ ] EP-M0 baseline.
- [ ] EP-M1 registry refactor.
- [ ] EP-M2 verified invocation machine.
- [ ] EP-M3 shared contract and registry extensions.
- [ ] EP-M4 dispatcher interpreter and driven adapters.
- [ ] EP-M5 driving adapters and composition.
- [ ] EP-M6 end-to-end scenario.
- [ ] EP-M7 documentation and roadmap closure.

## Surprises & discoveries

- Observation: there is no dispatcher, invocation, or result type in code.
  Evidence: `CommandInvocation`, `CommandResult`, and `CommandDispatcher`
  appear only in `docs/velocetty-design.md` lines 518-564. Impact: EP-M3
  defines them in `shared/src/types/commands.ts`.
- Observation: keymap command identifiers are not registered as command
  definitions in the renderer. Evidence:
  `lib/command-registry.ts#getRegisteredKeys` flips the keymap without calling
  `upsertCommand`. Impact: the catalogue needs a keymap fallback (D-4).
- Observation: Escape is bound to `editor:search-close` with no arguments.
  The command's built-in handler resets `event.catched` to `false` when no
  search box is open, so xterm still receives Escape. Evidence:
  `app/keymaps/linux.json` and `lib/command-registry.ts:61-85`. Impact: D-11
  and the Escape tests.
- Observation: the built-in host commands not bound in any keymap are
  `cli:install`, `editor:quit`, `editor:stop`, `editor:tmux`, and
  `window:toggleKeepOnTop`. `tab:jump:prefix` is expanded into `tab:jump:1` to
  `tab:jump:8` and `tab:jump:last` before the renderer sees it. Evidence:
  `app/commands.ts`, `app/keymaps/linux.json`, and `app/utils/map-keys.ts:3-9`.
  Impact: those five are unresolvable from the renderer until 4.1.2 or 4.3.2;
  no current renderer path invokes them.
- Observation: built-in command identifiers use colons (`tab:new`), not the
  dot-separated form in the design document (`terminal.newTab`). Impact: the
  dispatcher treats identifiers as opaque `CommandId` values; renaming is out
  of scope.
- Observation: the golden-path demonstration command declares
  `kind: 'frontend'` but is implemented in the main process. Evidence:
  `shared/src/runtime/golden-path-demo.ts:53` and `app/commands.ts:154-164`.
  Impact: routing by `kind` alone would break it (D-5).
- Observation: the `effects` middleware lets plugins "interrupt, defer, or
  augment side effects", and it runs an effect only after `next(action)`
  returns. A swallowed action and a deferred one are therefore
  indistinguishable when `dispatch` returns. Evidence: `lib/utils/effects.ts`.
  Impact: D-6.
- Observation: `UICommandExecAction` is a shared type. Evidence:
  `shared/src/constants/ui.ts:172-175`. Impact: EP-M3 extends it.
- Observation: `tsconfig.typecheck.json` already type-checks `./test/`, since
  PR #218 merged. Impact: an earlier draft's risk and step on this were removed.
- Observation: `fast-check`, LemmaScript, and Gherkin feature files are all
  absent. Behavioural tests are ordinary named `bun:test` scenarios. Impact:
  this plan introduces the two tools and writes behavioural tests as `bun:test`
  suites.
- Observation: `docs/users-guide.md` and any component architecture document
  do not exist. Impact: EP-M7 creates both.

## Decision log

- D-1. Decision: implement the dispatcher in `lib/command-dispatch/`, not in
  the `frontend/` package. Rationale: `frontend/src` is a one-line placeholder.
  The root `tsconfig.json`, `tsconfig.typecheck.json`, and esbuild
  configuration have no `@frontend` alias. The boundary script already treats
  `lib/` as the frontend layer, and roadmap items 1.2.1 and 1.2.2 placed their
  renderer code in `lib/`. Date/Author: 2026-10-29, planning agent.
- D-2. Decision: shared, serializable contract types (`CommandInvocation`,
  `CommandInvocationSource`, `CommandResult`, `CommandInvocationError`,
  `CommandDispatcher`) live in `shared/src/types/commands.ts`. Renderer-only
  types (the handler request carrying `dispatch` and the trigger event) live
  beside the registry, in `lib/command-registry-handlers.ts`, which owns
  handler storage. Rationale: 4.1.2 and the remote protocol need the wire
  shapes, and they must never see Redux or DOM types. Date/Author: 2026-10-29,
  planning agent.
- D-3. Decision: `CommandResult` is a discriminated union on `status`
  (`'ok' | 'error' | 'cancelled'`). It replaces the design sketch's
  `{ok: boolean; result?; error?; cancelled?}`. Rationale: the sketch admits
  illegal states, such as `ok: true` with an `error`. The union makes them
  unrepresentable and gives exhaustive `switch` checking. This deviates from
  `docs/velocetty-design.md` lines 532-550 and is recorded in ADR-007. ADR-007
  also maps the union onto the protobuf `CommandResult` sketch, so that 4.1.2
  extends that message rather than flattening the union. Date/Author:
  2026-10-29, planning agent.
- D-4 (revised after review). Decision: do not write keymap-derived
  definitions into the registry. Instead, the catalogue adapter resolves
  `registry.get(id)`, falling back to a host stub (`kind: 'backend'`, no
  schemas) when `id` is in the latest keymap snapshot held by the keybinding
  adapter. Rationale: synthesized definitions would pollute `list()`, the
  palette's source of truth. They would also need separate ownership tracking
  for definitions and handlers: removing a synthesized entry deleted a plugin's
  handler in the earlier draft. Date/Author: 2026-10-29, panel (Wafflecat,
  Doggylump).
- D-5. Decision: route execution by handler presence, not by `kind`. A
  command with a registered renderer handler executes in the renderer;
  otherwise its identifier is emitted to the host. The host route admits only
  `null` arguments, because the host channel cannot carry arguments. Non-null
  arguments fail as `INVALID_COMMAND_ARGS`. `kind` stays descriptive until
  4.1.2. Rationale: `PLUGINS.md` documents this fallback, and plugins override
  built-in host commands with renderer handlers (its `pane:maximize` example).
  The golden-path command is also misclassified. Date/Author: 2026-10-29,
  planning agent and panel (Telefono).
- D-6 (resolved after review). Decision: the execution gate dispatches
  `UI_COMMAND_EXEC`, now carrying `source` and frozen `args`, with an `effect`
  callback. Execution happens inside that effect. If `dispatch` returns without
  the effect having run, `ExecutionGate.admit` reports `pending`. The
  invocation then settles when the effect runs or the signal aborts. The
  dispatcher does not try to tell a swallowing middleware from a deferring one,
  because they are indistinguishable. The `run` callback is idempotent, so a
  middleware that re-dispatches a cloned action cannot execute twice. `run` is
  a no-op after settlement and never throws. Permission checks in 4.1.2 will be
  an admission gate, not middleware. Rationale: this keeps the documented
  plugin interception point for every source without promising detection the
  runtime cannot provide. Date/Author: 2026-10-29, panel (Pandalump, Wafflecat,
  Telefono; Doggylump's settle-as-vetoed alternative was rejected because it
  misreports deferrals).
- D-7 (revised after review). Decision: enablement (`defaultWhen`) is a gate
  for the affordance sources `keybinding`, `palette`, `menu`, and `ui`. The
  `plugin` and `remote` sources skip it. An unparsable expression fails closed
  with `INVALID_WHEN_EXPRESSION`. Rationale: the design calls `when` a UI
  affordance and makes permissions the security boundary. VS Code's
  `executeCommand` likewise ignores `when`. Every source still runs the same
  machine; the source only changes which verdict the enablement gate computes.
  Until 4.2.1 populates context keys, any `defaultWhen` that references a key
  evaluates against an empty service. ADR-007 records this. Date/Author:
  2026-10-29, panel (Wafflecat, Doggylump).
- D-8. Decision: an abort during execution settles the invocation as
  `cancelled` at once, and any later handler outcome is discarded. A late
  rejection is consumed and logged at debug level. A handler that rejects with
  the signal's `reason` also yields `cancelled`. Host commands are
  fire-and-forget and settle `ok` once emitted. Rationale: callers such as the
  palette must be released promptly, while cooperative handlers still receive
  the signal. Date/Author: 2026-10-29, planning agent.
- D-9. Decision: add `fast-check` and `lemmascript` as development
  dependencies, and a `make proofs` target that is not part of `make all`.
  `.github/workflows/proofs.yml` runs it on every pull request, without a path
  filter, so the check never sits pending. Rationale: the user requested
  property tests and an exhaustive proof for contractual logic. Dafny is cheap
  in CI when installed from a pinned archive with
  `bun install --ignore-scripts`. Date/Author: 2026-10-29, planning agent and
  panel (Buzzy Bee).
- D-10. Decision: the first UI control routed through the dispatcher is the
  search box close button, which invokes `editor:search-close` with `{uid}`.
  Rationale: the command already has a renderer handler, so routing this button
  exercises argument validation from a real control without migrating menus
  (4.3.2). Date/Author: 2026-10-29, planning agent.
- D-11 (new). Decision: an absent `args` is normalized to `null` before
  validation, and handlers receive `null`. Commands with optional object
  arguments declare `type: ['object', 'null']`. Rationale: `undefined` is not a
  JSON value and does not survive the wire; `null` makes optionality explicit
  in the schema. It also stops the Escape regression, because
  `editor:search-close` admits `null`. Date/Author: 2026-10-29, panel
  (Doggylump, Buzzy Bee).
- D-12 (new). Decision: the keybinding adapter fetches the runtime commands
  and the decorated keymap before it resets Mousetrap. It then applies the
  registry sync, the keymap snapshot, and the new bindings in one synchronous
  block, guarded by a generation counter that drops stale completions. If
  either fetch fails, the existing bindings are kept and a warning is logged.
  Rationale: this prevents interleaved reloads and the existing
  lose-all-bindings-on-error behaviour. Date/Author: 2026-10-29, panel
  (Doggylump).
- D-13 (new). Decision: the keybinding adapter calls `dispatcher.check()`, a
  pure query that runs the machine's admission phase, before marking the event.
  If admission is refused, the adapter sets neither `catched` nor
  `preventDefault`, so the key reaches the terminal. It logs at debug level for
  `COMMAND_DISABLED` and at warn level otherwise. If admission succeeds, the
  adapter keeps today's behaviour and then calls `invoke`. Rationale: a
  disabled shortcut must not eat the key. Both `check` and `invoke` use the
  same proved machine. Date/Author: 2026-10-29, panel (Wafflecat).
- D-14 (new). Decision: the contractual logic is one pure state machine,
  `lib/command-dispatch/policy/invocation-machine.ts`, exposing
  `step(state, event) → {state, action}`. The dispatcher is a thin interpreter
  that holds a single `state` variable and acts only on the returned `action`.
  Its promise is resolved in exactly one function. This replaces the earlier
  pair of admission and settlement modules. Rationale: the earlier admission
  fold was `findIndex` with a contract, and the settlement reducer risked
  becoming a parallel model. Proving the machine that the interpreter actually
  executes covers gate order, lazy evaluation, at-most-once execution, and
  exactly-once settlement. Date/Author: 2026-10-29, panel (Wafflecat, Buzzy
  Bee, Pandalump).
- D-15 (new). Decision: Redux and DOM types stay out of the dispatcher core.
  One driven port, `CommandExecutor`, owns routing (D-5), builds the legacy
  request with `dispatch`, and emits host commands. Its adapter lives in
  `adapters/`. Rationale: the earlier draft's `dispatch: HyperDispatch` port
  leaked Redux into the core. Date/Author: 2026-10-29, panel (Pandalump).
- D-16 (new). Decision: retain both requested documents, the users' guide
  and the component architecture document. The panel's suggestion to defer them
  is declined. Each is kept short and points to ADR-007 rather than repeating
  it. Rationale: the task brief explicitly requires the users' guide and a
  component architecture document. Date/Author: 2026-10-29, planning agent.

## Outcomes & retrospective

Not started. Complete at each milestone boundary and at closure.

## Context and orientation

The repository is an Electron application with three code areas that matter
here:

- `app/` is the Electron main process. `app/commands.ts` holds a flat table of
  host commands (for example `tab:new`) that mostly emit legacy RPC events back
  to the renderer. Menus call it directly. This plan does not touch `app/`.
- `lib/` is the renderer: the browser-side React and Redux application. The
  boundary script `scripts/check-package-boundaries.mjs` classifies `lib/` and
  `frontend/src` together as the frontend layer, which may import `@shared/*`
  but not `app/` or `backend/`.
- `shared/src/` holds types and constants used by both sides.

Terms used in this plan:

- Command definition: a `CommandDefinition` from
  `shared/src/types/commands.ts`. It has an `id`, `metadata`, `kind`, an
  optional `defaultWhen` (a `when` expression string), and optional
  `argsSchema` and `resultSchema` (JSON Schema objects).
- Command registry: `lib/command-registry.ts`, built by
  `createCommandRegistryModule(dependencies)`, with a module singleton at the
  bottom of the file. It stores definitions and optional renderer handlers,
  orders `list()` by identifier, and validates arguments with Ajv
  (`validateArgs`). Ajv resolves to 6.14.0 through the `overrides` block in
  `package.json`, and it implements JSON Schema draft-07.
- Context-key service: `lib/context-key-service.ts#createContextKeyService`.
  It stores named values and evaluates `when` expressions such as
  `terminalFocus && !settingsOpen`. Its `evaluate` method throws
  `WhenExpressionSyntaxError` for an unparsable expression. Nothing in the
  application constructs or populates one yet.
- Host command: a command executed by the Electron main process, reached by
  `transport.emit('command', id)`.
- Execution gate: the Redux hop a command passes through before it executes.
  The store middleware chain is `thunk`, `plugins.middleware`,
  `writeMiddleware`, `effects` (`lib/store/configure-store.*.ts`). The
  `effects` middleware runs an action's `effect()` after the rest of the chain
  has passed the action on.
- State machine and interpreter: the invocation machine is a pure function
  from a state and an event to a new state and an action. The interpreter
  (`dispatcher.ts`) performs each action (evaluate the next gate, open the
  execution gate, run the handler, settle), feeds the outcome back as the next
  event, and does nothing the machine did not ask for.
- Port and adapter: in the hexagonal architecture style, a port is an
  interface that the dispatcher's own code defines to say what it needs (for
  example "look up a command definition"). An adapter is the small piece of
  code that satisfies a port using real infrastructure (the registry, Redux,
  the transport). Ports let the dispatcher be tested with in-memory fakes. This
  plan applies the style only where a boundary needs protecting. It uses five
  driven ports and three inbound adapters, and adds no further layering.

The current keybinding path, which this plan replaces, is:

```plaintext
Mousetrap keydown (lib/containers/hyper.tsx:71)
  -> getCommandHandler(id) (lib/command-registry.ts:241)
  -> props.execCommand(id, handler, event) (lib/containers/hyper.tsx:153)
  -> thunk dispatches UI_COMMAND_EXEC with effect (lib/actions/ui.ts:331)
  -> effects middleware runs effect (lib/utils/effects.ts:25)
  -> handler(event, dispatch) or transport.emit('command', id)
```

The target path, identical for every source, is:

```plaintext
inbound adapter (keybinding | UI hook | plugin facade)
  -> dispatcher.invoke({id, args, source}, {signal, triggerEvent})
  -> machine admission: resolve -> route args -> validate args -> enablement
  -> machine: open execution gate (UI_COMMAND_EXEC with effect)
  -> machine: run handler via CommandExecutor (renderer handler or host emit)
  -> machine: validate result -> settle exactly once
```

Relevant skills for the implementer: `typescript-router` (start here),
`typescript-async-and-concurrency` (signal ownership and settlement),
`typescript-errors-and-outcomes` (result union and error mapping),
`typescript-boundaries-and-validation` (argument, result, and plugin input
validation), `react-and-accessible-ui` (context provider and hook),
`electron-and-ipc` (renderer-to-host routing), `hexagonal-architecture` (ports
and adapters), `fast-check`, `lemmascript`, `typescript-verification`,
`typescript-testing`, `biome-typescript`, `execplans`, `commit-message`,
`pr-creation`, `pr-babysitting`, and `sdlc-implementation`. Use the `codegraph`
MCP tools (`codegraph_get_callers`, `codegraph_analyze_impact`) before editing
`lib/command-registry.ts`, `lib/actions/ui.ts`, or `lib/containers/hyper.tsx`.

Relevant documents: `docs/developers-guide.md` (sections "Command registry
practice", "Context key and `when` practice", and "Unit tests (Bun)"),
`docs/testing-with-bun.md`, `docs/adr-005-enhance-e2e-testing-strategy.md`,
`docs/adr-006-oxlint-plugin-strategy.md` (the layout to copy for ADR-007),
`docs/documentation-style-guide.md`, and `PLUGINS.md` §Register a handler for
your commands.

## Conformance basis

Upstream artefacts, at the revision of `main` commit `40949b2f`:

- Roadmap `docs/roadmap.md` lines 263-271:
  - `RM-4.1.1-A`: validate arguments against schemas before invocation.
  - `RM-4.1.1-B`: support cancellation via `AbortSignal`.
  - `RM-4.1.1-SC`: commands invoked from UI, keybindings, and plugins all
    follow the same path.
- Technical design `docs/velocetty-design.md`:
  - `TDD-PRINC-CMD` (lines 288-290): a command is the only way to do things.
  - `TDD-DISP-PATH` (lines 494-510): resolve, validate, check enablement,
    execute, return a structured result.
  - `TDD-DISP-API` (lines 518-564): invocation, result, and dispatcher types.
  - `TDD-CANCEL` (lines 726-737): frontend commands use `AbortSignal` and
    cooperative cancellation.
  - `TDD-PLUGIN-SEC` (lines 1353-1367): privileged work goes through backend
    commands. This plan respects it by adding no privileged renderer
    handlers.
- Product requirements `docs/velocetty-product-requirements-document.md`
  §3 (lines 91-100):
  - `PRD-DISP-SINGLE`: a single invocation path for shortcuts, palette,
    menus, buttons, and plugin calls.
  - `PRD-DISP-ASYNC`: asynchronous commands and cancellation where sensible.
- Governing standards: `AGENTS.md`, `docs/developers-guide.md`,
  `docs/documentation-style-guide.md`, ADR-001 (Bun test), ADR-005 (E2E
  strategy), ADR-006 (Oxlint plugin strategy).
- No Terms of Reference document exists for this project; none is invented.

Trace links:

```plaintext
RM-4.1.1-A  -> TDD-DISP-PATH -> EP-M2 machine gate order -> invocation-machine.dfy::GatesInOrder
RM-4.1.1-A  -> TDD-DISP-PATH -> EP-M4 -> validation.property.test.ts::executes only valid args
RM-4.1.1-A  -> TDD-DISP-API  -> EP-M3 validateResult -> command-registry-validation.test.ts::result schema
RM-4.1.1-B  -> TDD-CANCEL    -> EP-M2 -> invocation-machine.dfy::SettlesAtMostOnce
RM-4.1.1-B  -> TDD-CANCEL    -> EP-M4 -> cancellation.property.test.ts::interpreter matches machine
RM-4.1.1-SC -> PRD-DISP-SINGLE, TDD-PRINC-CMD -> EP-M5 -> convergence.test.ts::sources share one path
RM-4.1.1-SC -> PRD-DISP-SINGLE -> EP-M6 -> command-dispatch.e2e.ts::keybinding, button, and Escape
TDD-DISP-API (deviation D-3) -> ADR-007 -> EP-M3 -> shared result union
TDD-DISP-PATH (refinement D-7) -> ADR-007 -> EP-M2 -> machine enablement gate per source
```

Deviations proposed with this plan, for approval: D-3 changes the result shape
in `TDD-DISP-API`. D-7 makes the enablement gate depend on the source, which
refines `TDD-DISP-PATH`. EP-M3 records both in ADR-007, and EP-M7 updates
`docs/velocetty-design.md` to reference it.

## Verification plan

The contractual logic is one pure state machine (D-14), separate from the
asynchronous interpreter that runs it. That split is what makes a proof
tractable: LemmaScript verifies pure TypeScript in place. fast-check then
checks that the real asynchronous interpreter only does what the machine says.

### The machine

States (plain records with a string-literal `phase`):

- `admitting` with `gate`, an integer from 0 to 3 naming the next gate to
  evaluate. An already-aborted signal skips this phase: `initialState(true)`
  settles at once as `cancelledBefore`.
- `awaitingGate`.
- `executing`.
- `settled` with `outcome` and `failedGate`. The outcome is one of `ok`,
  `rejected` (with `failedGate` naming the first failing gate), `failedHandler`,
  `failedResult`, `cancelledBefore`, or `cancelledDuring`. `failedGate` is
  `-1` for every outcome except `rejected`.

Events: `gatePassed`, `gateFailed`, `aborted`, `gateRan` (the Redux effect
executed), `gatePending`, `handlerFulfilled` (which carries whether the result
validated), `handlerRejected` (which carries whether the rejection was the
abort reason), and `hostEmitted`.

Actions: `evaluateGate` (with an index), `openGate`, `runHandler`, `settle`, and
`none`.

The four gates, in order, are `resolve`, `routeArgs`, `validateArgs`, and
`enablement`. The interpreter computes each verdict only when asked for it, so
later gates are never evaluated after an earlier failure.

### Obligations

- Obligation `INV-GATE-ORDER`: on every event trace, `evaluateGate(k)` is
  emitted only after `evaluateGate(j)` for every `j < k`, each answered by
  `gatePassed`. `openGate` is emitted only after all four gates pass. A
  `rejected` outcome carries the index of the first `gateFailed`.
  - Method: formal proof (LemmaScript, Dafny back end) of `step`, plus a fold
    lemma over traces of any length. Also an exhaustive table test over the
    16 combinations of gate verdicts.
  - Rationale: this is the contract that no handler runs for an unknown,
    misrouted, invalid, or disabled command, with stable error precedence.
    4.1.2 will add a permission gate here.
  - Domain: all event sequences, of any length.
  - Artefacts: `lib/command-dispatch/policy/invocation-machine.ts` (with `//@`
    contracts), `lib/command-dispatch/policy/invocation-machine.dfy`, and
    `test/unit/command-dispatch/invocation-machine.test.ts`.
  - Evidence: `make proofs` reports `0 errors`, and the table test passes.
  - Non-vacuity: the machine's preconditions are `true`, so every trace is
    admissible. Witnesses are the all-pass trace and each single-failure
    trace. Seeded fault: let `gateFailed` at index 2 advance to index 3. The
    proof must fail on `GatesInOrder`, and the matching table row must fail.
- Obligation `INV-RUN-ONCE`: `runHandler` is emitted at most once on any
  trace. It is emitted only on the transition from `awaitingGate` to
  `executing` triggered by `gateRan`, and never after `aborted`. In particular,
  a `gateRan` that arrives after `aborted` (a deferred effect) yields `none`.
  - Method: formal proof using a ghost counter in the fold, plus a
    fast-check property against the interpreter.
  - Rationale: running a handler twice, or after cancellation, is the most
    damaging failure a dispatcher can have.
  - Evidence: `make proofs` reports `0 errors`. The property shows that
    the spy handler's call count equals the number of `runHandler` actions
    in the recorded trace.
  - Non-vacuity: witness `[pass ×4, gateRan]` emits `runHandler`, and
    `[pass ×4, gatePending, aborted, gateRan]` does not. Seeded fault: allow
    `gateRan` from `settled`. The proof must fail.
- Obligation `INV-SETTLE-ONCE`: `settle` is emitted exactly once on every
  trace that reaches a terminal event, and at most once on every trace. Every
  event applied to a `settled` state returns the same state with action `none`
  (absorption).
  - Method: formal proof plus the interpreter property. The property's
    oracle is `result === outcomeOf(fold(recordedTrace))`.
  - Rationale: exactly-once settlement is the core cancellation contract
    (`RM-4.1.1-B`). A double settlement would report both `ok` and
    `cancelled`.
  - Domain: interleavings of handler fulfilment, rejection, abort, and gate
    deferral. The scenario class is drawn first with `fc.constantFrom`, then
    `fc.scheduler()` orders the interleaving.
  - Evidence: `make proofs` reports `0 errors`, and the property passes 300
    runs by default. The run count can be raised with
    `FC_NUM_RUNS` and is set per assertion, never through
    `fc.configureGlobal`. Each property test sets its own timeout.
  - Non-vacuity: the scenario classes `ok`, `error`, `cancelledBefore`,
    `cancelledDuring`, late rejection after abort, and deferred gate are
    generated by construction, so every class is reached. Seeded fault:
    let `aborted` overwrite an `ok` settlement. The proof must fail on
    absorption. The mutant is kept as a permanent test that runs
    `fc.assert(property(mutantMachine))` and expects it to throw.
- Obligation `INV-CANCEL-OUTCOME`: the outcome is `cancelledBefore` if and
  only if `aborted` precedes `runHandler`. It is `cancelledDuring` if and only
  if `aborted`, or `handlerRejected` carrying the abort reason, is the first
  decisive event after `runHandler`.
  - Method: formal proof.
  - Non-vacuity: witnesses `[aborted]` (before),
    `[pass ×4, gateRan, aborted, handlerFulfilled]` (during), and
    `[pass ×4, gateRan, handlerFulfilled, aborted]` (ok). Seeded fault:
    classify an abort during `awaitingGate` as `cancelledDuring`. The proof
    must fail.
- Obligation `INV-INTERPRETER-REFINES`: the interpreter performs exactly the
  actions the machine returns, in order, and nothing else.
  - Method: structural rules plus the interpreter properties above.
    `dispatcher.ts` holds a single `let state`, calls `step` for every
    transition, and resolves its promise only inside `performSettle`. A
    unit test reads `dispatcher.ts` and asserts there is exactly one
    `resolve(` call site and one `step(` call site. The interpreter can
    record its event trace through an optional `trace` port, which only the
    tests use.
  - Rationale: the proof is worthless if the interpreter bypasses it.
  - Non-vacuity: seeded fault: call the handler directly after admission
    without consulting `step`. The trace-equality property must fail.
- Obligation `INV-VALIDATE-BEFORE-EXEC`: for any definition with an
  `argsSchema` and any argument value, the handler runs only if Ajv accepts the
  normalized value. An invalid value yields `INVALID_COMMAND_ARGS` with every
  Ajv issue.
  - Method: fast-check property. Generated schemas come from a small grammar
    (object, string with `minLength`, integer with `minimum`, `required`,
    `additionalProperties: false`, and type unions with `null`). Valid
    values are built from the schema arbitrary, and invalid ones are made by
    mutating valid ones. The generator's label is cross-checked against a
    fresh Ajv instance with the same options.
  - Rationale: the schema space is infinite. The relation between Ajv's
    verdict and execution is the invariant; Ajv's internals are an axiom.
  - Artefact: `test/unit/command-dispatch/validation.property.test.ts`.
  - Evidence: 200 runs pass, with both valid and invalid classes produced by
    construction.
  - Non-vacuity: a permanent mutant test skips validation when `args` is
    `null`, and must be rejected by generated non-nullable schemas.
- Obligation `INV-SYNC`: when no middleware defers `UI_COMMAND_EXEC`, the
  handler is called before `invoke()` returns its promise, and `check()` is
  fully synchronous.
  - Method: named unit tests with the real middleware chain (`thunk`, a
    recording plugin middleware, `effects`).
  - Rationale: legacy keybinding handlers call `event.preventDefault()` and
    reset `event.catched`, so asynchronous admission would break them
    silently.
  - Artefact: `test/unit/command-dispatch/dispatcher.test.ts`.
  - Non-vacuity: a seeded fault that inserts `await Promise.resolve()` before
    the gate must make the test fail.
- Obligation `INV-SAME-PATH`: for a fixed command, the keybinding adapter,
  the UI hook, and the plugin facade produce the same machine trace and the same
  `UI_COMMAND_EXEC` action except for `source`. The exceptions are the
  documented enablement difference for `plugin` (D-7) and the absent
  `triggerEvent` for non-keybinding sources.
  - Method: a behavioural test using the real registry, a real context-key
    service, and the real store middleware chain. It is parameterized over
    the three sources and five commands: a valid renderer command, invalid
    arguments, a host command from the keymap, `editor:search-close` with no
    arguments (Escape), and a role command (`editor:copy`) that must still be
    emitted.
  - Artefact: `test/unit/command-dispatch/convergence.test.ts`.
  - Non-vacuity: a seeded fault lets the plugin facade call the registry
    handler directly. The recorded trace for the plugin row must then differ
    and fail.
- Obligation `INV-RELOAD-LATEST`: after any interleaving of overlapping
  keymap reloads, the bound keys and the keymap snapshot both come from the
  most recently started reload that completed. A failed fetch leaves the
  previous bindings intact.
  - Method: fast-check property using `fc.scheduler()` over two or three
    concurrent reloads. Identifiers are drawn from a pool of five, so
    overlaps are certain.
  - Artefact:
    `test/unit/command-dispatch/keybinding-reload.property.test.ts`.
  - Non-vacuity: a permanent mutant without the generation guard must be
    rejected.
- Obligation `INV-NO-LEAK`: after settlement, the interpreter has removed
  every abort listener it added. It adds none when the caller passed no signal.
  No handler rejection reaches the runtime unhandled; a late rejection reaches
  the logger port instead.
  - Method: named unit tests. They wrap `addEventListener` and
    `removeEventListener` on a real `AbortSignal` instance, and use a real
    rejecting `Promise` whose rejection must appear in the recording
    logger. No thenable fakes are used.
  - Artefact: `test/unit/command-dispatch/dispatcher.test.ts`.

### Axioms

- `AX-AJV`: Ajv 6.14.0 `compile`, and the validators it produces, implement
  JSON Schema draft-07 for the keywords used, including type arrays. Their
  `errors` list every failure when `allErrors` is true. Every test exercises
  the real Ajv.
- `AX-ABORT`: an `AbortSignal` fires `abort` at most once. `aborted` becomes
  true before listeners run, and `reason` is stable afterwards (WHATWG DOM).
  This is exercised with real `AbortController` instances in Bun, and in the
  Electron renderer during the E2E scenario.
- `AX-REDUX`: Redux middleware runs synchronously in chain order. The
  `effects` middleware calls `effect()` after `next(action)` returns, at most
  once per action object. This is exercised with the real middleware modules.
- `AX-LS`: LemmaScript's translation of the supported TypeScript fragment to
  Dafny preserves the semantics the obligations rely on: records, string
  literal unions, integers, and conditionals. The machine avoids floating point,
  `async`, closures, regular expressions, and imports, so the documented
  modelling gaps do not apply.
- `AX-DAFNY`: Dafny 4.11 and its Z3 back end are sound.

Residual gaps: the interpreter is checked by structure and sampling, not by
proof. Plugin middleware is modelled only as observe, swallow, defer, or
re-dispatch a clone. Handler side effects that happen after cancellation are
the handler's responsibility (cooperative cancellation).

## Plan of work

### Stage A: understand and propose (no code changes)

Complete. Reconnaissance results are recorded in `Context and orientation` and
`Surprises & discoveries`. After approval, confirm two facts and record them in
`Surprises & discoveries` before EP-M3. The first is the exact search shortcut
in `app/keymaps/linux.json`. The second is the line in
`lib/components/term.tsx` that wires the search box `close` prop.

### Stage B: red tests and failing verification artefacts

Each implementation milestone opens with the smallest failing test, or open
proof goal, for its obligations. Run it once to observe the expected failure
before writing production code.

### Stage C: implementation with verification

Milestones EP-M1 to EP-M6 below.

### Stage D: refactor, documentation, and closure

Milestone EP-M7, plus a refactor pass at the end of each milestone, committed
separately from the functional change.

## Milestones and plateaus

Every milestone ends with this gate line, run sequentially from the repository
root, with each log written to `/tmp/<gate>-velocetty-<branch>.out`:

```plaintext
make check-fmt && make typecheck && make lint && make test
```

From EP-M2 onwards, add `make proofs`. EP-M7 adds the documentation gates. At
each milestone boundary, push the branch, update `Progress` and
`Outcomes & retrospective`, and record the conformance check.

### EP-M0: baseline

- Outcome: dependencies are installed and each gate's baseline result is
  recorded, with no source change. Dafny 4.11 is confirmed (`dafny --version`
  starts with `4.11.`).
- Requirements and gaps: none. This milestone sets the comparison point.
- Acceptance evidence: the four gate logs pass. If any gate fails on the
  untouched tree, record it in `Surprises & discoveries` and escalate before
  EP-M1.
- Conformance check: not applicable (no change).
- Recovery: rerun `bun install`; it is idempotent.
- Remaining gaps: everything.
- Compatibility decision: none.

### EP-M1: make room in the command registry

- Outcome:
  - Ajv validation moves from `lib/command-registry.ts` into
    `lib/command-registry-validation.ts`, which exports
    `createCommandSchemaValidator()` with `validateArgs` and
    `forget(commandId)`.
  - Validators are compiled when a command is registered rather than on
    first use, so the first keypress does not pay for compilation.
  - The alias block (`registerCommand`, `createCommand`, and the other
    aliases at `lib/command-registry.ts:282-297` and `363-379`) is deleted,
    along with its only consumer, the alias assertions in
    `test/unit/command-registry-compat.test.ts`.
  - The built-in `editor:search-close` handler moves to
    `lib/commands/search-close.ts` and is registered by the registry
    singleton's setup.
- Requirements and gaps: prepares `RM-4.1.1-A` and satisfies the 400-line
  constraint.
- Acceptance evidence: the remaining `test/unit/command-registry*.test.ts`
  suites pass unchanged in substance. `lib/command-registry.ts` is under 300
  lines. The gate line passes.
- Conformance check:
  - There is no behaviour change; the existing suites are the evidence.
  - The aliases had no production callers (checked with
    `codegraph_get_callers`), so deleting them breaks no consumer.
  - There is no dependency, trust-boundary, or persisted-format change.
- Recovery: `git revert` the refactor commits.
- Remaining gaps: all dispatcher behaviour.
- Compatibility decision: none. The aliases were internal, with no named
  consumer.

### EP-M2: verified invocation machine (opens with a prototyping spike)

- Outcome:
  - `lib/command-dispatch/policy/invocation-machine.ts` exports the
    `MachineState`, `MachineEvent`, and `MachineAction` types, and the
    functions `initialState(isAborted)`, `step`, and `outcomeOf`. All carry
    `//@` contracts and are proved in place.
  - `LemmaScript-files.txt` at the repository root lists the file. That file
    name is fixed by LemmaScript's batch mode.
  - The `Makefile` gains a `proofs` target. It checks that
    `dafny --version` starts with `4.11.`, then runs
    `npx --no-install lsc check --backend=dafny` under Node.
  - `.github/workflows/proofs.yml` runs `bun install --ignore-scripts` and
    installs Dafny 4.11 from the release archive, pinned by version and
    SHA-256 and cached. It then runs `make proofs` on every pull request,
    with no path filter.
  - `package.json` gains `fast-check` (`^4.10.2`) and `lemmascript`
    (`0.6.5`) as development dependencies.
  - `typos.local.toml` excludes `*.dfy` and `*.dfy.gen`; Biome and Oxlint
    already ignore those extensions.
- Prototyping spike, first step:
  - Annotate only the `admitting` transitions and run `lsc check`.
  - Keep the approach if it verifies without `//@ assume`.
  - Otherwise, stop under the proof-feasibility tolerance and present three
    options:
    - (a) restructure the machine into the subset LemmaScript supports;
    - (b) replace the proof with an exhaustive enumeration of every trace up
      to length 8, stating that bound as a residual gap;
    - (c) fix the LemmaScript toolchain upstream first.
- Requirements and gaps: `RM-4.1.1-A`, `RM-4.1.1-B` (policy), and the
  obligations `INV-GATE-ORDER`, `INV-RUN-ONCE`, `INV-SETTLE-ONCE`, and
  `INV-CANCEL-OUTCOME`.
- Acceptance evidence:
  - `make proofs` prints `0 errors`.
  - The table test and the machine unit tests pass after first failing
    against a stub.
  - Each Dafny seeded fault listed in the `Verification plan` is applied on a
    temporary work-in-progress (WIP) commit, observed to fail, and reset. Do
    this because `lsc regen` merges into the `.dfy` file. Record the
    transcript excerpts in `Artefacts and notes`.
  - The gate line plus `make proofs` passes.
- Conformance check:
  - The machine imports nothing; the boundary script enforces this.
  - The two development dependencies are the approved ones.
  - Runtime behaviour does not change yet, because nothing uses the machine.
- Recovery: revert the milestone commits. Both dependencies are
  development-only.
- Remaining gaps: the interpreter, adapters, and sources.
- Compatibility decision: none.

### EP-M3: shared contract and registry extensions

- Outcome:
  - `shared/src/types/commands.ts` gains the contract types listed in
    `Interfaces and dependencies`. `CommandValidationErrorCode` is unchanged.
    The new codes belong only to `CommandInvocationErrorCode`.
  - `shared/src/constants/ui.ts` extends `UICommandExecAction` with
    `source` and `args`.
  - `lib/command-registry-validation.ts` gains `validateResult`, which the
    registry exposes.
  - `lib/command-registry-handlers.ts` defines `RendererCommandHandler` and
    `RendererCommandRequest`. The registry stores handlers of that type.
    `registerCommandHandlers` wraps each legacy `(event, dispatch)` handler as
    `(request) => { legacy(request.triggerEvent, request.dispatch); }`,
    discarding any return value.
  - `editor:search-close` declares the arguments schema below. It closes the
    given `uid`, or the active session when `args` is `null`:

    ```json
    {"type": ["object", "null"], "properties": {"uid": {"type": "string", "minLength": 1}}, "additionalProperties": false}
    ```

  - `docs/adr-007-frontend-command-dispatcher-contract.md` is added with
    status `Proposed`, recording D-3, D-5, D-6, D-7, D-11, and D-14.
- Requirements and gaps: `RM-4.1.1-A` and `TDD-DISP-API` (with D-3).
- Acceptance evidence:
  - New tests in `test/unit/command-registry-validation.test.ts` (result
    schema) pass after first failing.
  - A new test shows `editor:search-close` accepts `null` and `{uid: 's1'}`
    and rejects `{uid: 42}`.
  - The compatibility test proves that legacy handlers still receive
    `(event, dispatch)`.
  - The gate line plus `make proofs` passes.
- Conformance check:
  - D-3 is recorded in ADR-007.
  - There is no IPC change.
  - The `PLUGINS.md` contracts still hold.
- Recovery: revert the milestone commits.
- Remaining gaps: the dispatcher itself.
- Compatibility decision: legacy handler wrapping is kept for the
  third-party Hyper plugins that call `terms.registerCommands` (`PLUGINS.md`).

### EP-M4: dispatcher interpreter and driven adapters

- Outcome:
  - `createCommandDispatcher(ports)` in `lib/command-dispatch/dispatcher.ts`
    interprets the machine, exposing `invoke` and `check`.
  - `lib/command-dispatch/adapters/` holds the driven adapters:
    - `registry-catalogue.ts` resolves definitions with the D-4 keymap
      fallback and validates arguments and results;
    - `context-key-enablement.ts` maps a thrown `WhenExpressionSyntaxError`
      to an `invalid` verdict;
    - `redux-execution-gate.ts` dispatches `UI_COMMAND_EXEC` with an
      idempotent effect and a `structuredClone`d, frozen copy of `args`;
    - `renderer-executor.ts` implements D-5 routing, builds the handler
      request, and emits host commands.
  - `scripts/check-package-boundaries.mjs` gains the sub-layer rules from
    `Constraints`.
- Requirements and gaps: `RM-4.1.1-A`, `RM-4.1.1-B`, `TDD-DISP-PATH`,
  `TDD-CANCEL`, and the obligations `INV-INTERPRETER-REFINES`,
  `INV-VALIDATE-BEFORE-EXEC`, `INV-SYNC`, `INV-NO-LEAK`, and the interpreter
  halves of `INV-RUN-ONCE` and `INV-SETTLE-ONCE`.
- Acceptance evidence: `dispatcher.test.ts`,
  `validation.property.test.ts`, and `cancellation.property.test.ts` pass after
  first failing. The gate line plus `make proofs` passes.
- Conformance check:
  - The core imports only ports, `@shared/types/*`, and the machine; the
    boundary script enforces this.
  - The core uses no timer or clock (also enforced by the boundary script).
  - The result union matches ADR-007.
- Recovery: revert the milestone commits. Nothing calls the dispatcher yet.
- Remaining gaps: the sources still use the old path.
- Compatibility decision: none.

### EP-M5: driving adapters and composition

Make this milestone four commits, so that the riskiest cutover can be reverted
on its own: composition and UI, then plugin, then keybinding, then removing the
old path.

- Outcome:
  - The composition: `lib/command-dispatch/compose.ts` exports
    `composeRendererDispatcher({registry, store, transport, logger})`.
    - It builds a renderer context-key service, the four adapters, and the
      dispatcher.
    - It adapts `DispatcherLogger` to `console`: refusals log at warn level,
      and debug output is hidden unless `?debug=1` is set.
    - The `mountApp` closure in `lib/index.tsx` calls it and wraps the tree
      in `CommandDispatcherProvider`. `renderer-bootstrap.ts` is not edited.
  - The UI path: `lib/command-dispatch/inbound/command-dispatcher-provider.tsx`
    exports `CommandDispatcherContext`, `CommandDispatcherProvider`, and
    `useCommandInvoker()`. The hook fixes `source: 'ui'`. The search box
    close button in `lib/components/term.tsx` invokes `editor:search-close`
    with `{uid}`. `Term` reads the context through `static contextType`.
  - The plugin path: `lib/command-dispatch/inbound/plugin-api.ts` exports
    `createPluginCommandApi(dispatcher)`.
    - The facade fixes `source: 'plugin'` and accepts no `triggerEvent`.
    - It rejects non-JSON `args` with `INVALID_COMMAND_ARGS` before invoking
      (`isJsonValue` from `shared/src/types/json.ts`).
    - `lib/components/terms.tsx` exposes it as `this.invokeCommand`, beside
      `this.registerCommands`, using `static contextType`.
  - The keybinding path: `lib/command-dispatch/inbound/keybinding.ts` exports
    `createKeybindingBinder({dispatcher, registry, mousetrapFactory,
    logger})`.
    - It implements D-12 (generation-guarded reload) and D-13 (pass the key
      through when refused).
    - It keeps setting `event.catched` and applying `shouldPreventDefault`
      for admitted commands.
    - It attaches a `.then` to every invocation, and logs any non-`ok`
      result once per command per keymap generation.
    - `lib/containers/hyper.tsx` uses it in place of `props.execCommand`.
  - The removal: `lib/actions/ui.ts#execCommand`, `HyperProps.execCommand`
    (`typings/hyper.d.ts`), and `getCommandHandler` are deleted, and every
    caller and test is updated in the same commit (including
    `test/unit/hyper-effects.test.ts`, `test/unit/hyper-transport.test.ts`,
    and `test/testUtils/command-registry-mock.ts`).
- Requirements and gaps: `RM-4.1.1-SC`, `PRD-DISP-SINGLE`, `TDD-PRINC-CMD`,
  and the obligations `INV-SAME-PATH` and `INV-RELOAD-LATEST`.
- Acceptance evidence:
  - `convergence.test.ts` and `keybinding-reload.property.test.ts` pass after
    first failing.
  - A component test renders `lib/components/search-box.tsx` with
    `test/testUtils/happy-dom.ts` under a provider holding an injected
    recording dispatcher. It then clicks the close button and observes
    `editor:search-close` with the session `uid`. If `term.tsx` must be
    rendered, it reuses `test/testUtils/term-harness.ts` without new module
    mocks.
  - A plugin facade test shows that `{uid: 42}` yields
    `INVALID_COMMAND_ARGS` and that a function argument is rejected before
    admission.
  - The gate line plus `make proofs` passes after each of the four commits.
- Conformance check:
  - No source executes a command outside `dispatcher.invoke`. Check this
    with `codegraph_get_callers` on the registry's handler lookup, and with
    a ripgrep for `emit('command'`, which must match only
    `renderer-executor.ts`.
  - The `PLUGINS.md` contracts hold.
  - `lib/components/term.tsx` grows by at most 15 lines.
- Recovery: revert the four commits in reverse order. EP-M4 remains a
  coherent plateau.
- Remaining gaps: the E2E scenario and documentation.
- Compatibility decision: none. The deleted `execCommand` thunk, prop, and
  `getCommandHandler` are application-internal.

### EP-M6: end-to-end scenario

- Outcome: `test/e2e-deep/command-dispatch.e2e.ts` launches the packaged app
  and checks three things. Throughout, no `[e2e][renderer-error]` line may
  appear.
  - It presses the search shortcut until the search box is visible. Each
    press is retried within a deadline, because bindings attach
    asynchronously. Every attempt is logged.
  - It clicks the close button and asserts that the box is gone.
  - It runs `cat -v`, presses Escape and then Enter, and asserts that `^[`
    appears in the terminal buffer.
- Requirements and gaps: `RM-4.1.1-SC` at system level, and the Escape
  regression guard.
- Acceptance evidence: `bun run test:e2e:deep` passes locally and in the
  `e2e-deep-linux` CI job, which runs under Xvfb. Record which display mode
  each local pass used. A local `--ozone-platform=headless` pass is supporting
  evidence, not a substitute for CI.
- Conformance check: the scenario uses only the existing helpers in
  `test/e2e/electron-e2e-helpers.ts`.
- Recovery: delete the scenario file; no production code depends on it.
- Remaining gaps: documentation.
- Compatibility decision: none.

### EP-M7: documentation and roadmap closure

- Outcome:
  - `docs/velocetty-design.md` §Command registry and dispatcher describes the
    implemented pipeline and references ADR-007. ADR-007 moves to
    `Accepted (<date>): <summary>`.
  - A new component architecture document,
    `docs/command-dispatch-architecture.md`, has a module header. It covers
    the machine, the interpreter, the ports, the adapters, the composition,
    and the sequence of one invocation, and points to ADR-007 for the
    rationale.
  - `docs/developers-guide.md` changes:
    - It gains a "Command dispatcher practice" section after "Command
      registry practice". The section covers adding a command, writing a
      cancellable handler, declaring nullable optional arguments, invoking
      from UI code, and the testing rules.
    - Rewrite the registry section's bullet that kept entry points "until
      dispatcher migration milestones replace those entry points".
    - Add a "Proofs" note under "Tests" covering `make proofs` and the local
      Dafny installation.
    - Add a focused stress run, `bun test --concurrent
      test/unit/command-dispatch/`.
  - A new `docs/users-guide.md`, titled "Users' guide", has a module header
    and a "Commands and keybindings" section. It states that shortcuts, the
    search close button, and plugins all run commands. A refused shortcut
    passes the key through to the terminal, and refusals are reported in the
    developer console.
  - `PLUGINS.md` documents `this.terms.invokeCommand(id, args, {signal})`,
    the result union, the pending semantics of a swallowed
    `UI_COMMAND_EXEC`, and that `e` is `undefined` outside keybindings.
  - `docs/roadmap.md` marks 4.1.1 and its sub-items done. Do this only after
    every gate and the `e2e-deep-linux` CI job pass. Then set this plan's
    status to COMPLETE.
- Requirements and gaps: the documentation duties from the task brief.
- Acceptance evidence: `make markdownlint`, `make nixie`, `make spelling`,
  and the gate line plus `make proofs` all pass.
- Conformance check: every decision in `Decision log` is reflected in
  ADR-007 or the design document, and every trace link resolves to an existing
  test or proof.
- Recovery: documentation-only commits, each revertible on its own.
- Remaining gaps for 4.1.1: none. Handed on to later items:
  - a host command catalogue covering commands that no keymap binds (4.1.2
    and 4.3.2);
  - backend cancellation tokens (4.1.2);
  - populating context keys (4.2.1).
- Compatibility decision: none.

## Concrete steps

Run every command from the repository root (the worktree checkout). Capture
output with `tee` so that truncation does not hide failures. Run gates
sequentially, never in parallel, so they share build caches safely:

```bash
set -o pipefail
BRANCH=$(git branch --show-current)
bun install 2>&1 | tee "/tmp/install-velocetty-${BRANCH}.out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-velocetty-${BRANCH}.out"
make typecheck 2>&1 | tee "/tmp/typecheck-velocetty-${BRANCH}.out"
make lint 2>&1 | tee "/tmp/lint-velocetty-${BRANCH}.out"
make test 2>&1 | tee "/tmp/test-velocetty-${BRANCH}.out"
```

Expect `make test` to end with a summary such as:

```plaintext
 NNNN pass
 0 fail
```

Focused red and green runs during a milestone, for example:

```bash
bun test --isolate test/unit/command-dispatch/invocation-machine.test.ts
```

Installing Dafny 4.11 locally, if `dafny --version` is missing or reports a
different version: the .NET 8 runtime is required. Download
`dafny-4.11.0-x64-ubuntu-20.04.zip` from the Dafny GitHub releases page, and
check its SHA-256 against the value pinned in `.github/workflows/proofs.yml`.
Then unpack it under `~/.local/share/dafny` and link
`~/.local/share/dafny/dafny/dafny` into `~/.local/bin`. The proof gate, from
EP-M2 onwards:

```bash
make proofs 2>&1 | tee "/tmp/proofs-velocetty-${BRANCH}.out"
```

Expected tail:

```plaintext
Dafny program verifier finished with N verified, 0 errors
```

The deep E2E lane. CI runs it under Xvfb. To run it on a workstation without an
X server, do three things:

- stage the development target;
- build `node-pty` for Electron, because there is no linux-x64 prebuild;
- launch Electron with `--ozone-platform=headless`, which bypasses X
  initialization. If the Playwright launcher needs the flag, add it to the
  scenario's launch arguments only when `process.env.CI` is unset, and record
  that in `Decision log`.

```bash
bun run test:e2e:prepare
bun bin/rebuild-node-pty.mjs
bun run test:e2e:deep 2>&1 | tee "/tmp/e2e-deep-velocetty-${BRANCH}.out"
```

Documentation gates for EP-M7:

```bash
make markdownlint 2>&1 | tee "/tmp/markdownlint-velocetty-${BRANCH}.out"
make nixie 2>&1 | tee "/tmp/nixie-velocetty-${BRANCH}.out"
make spelling 2>&1 | tee "/tmp/spelling-velocetty-${BRANCH}.out"
```

Commit after each green step. Use an imperative subject of 50 characters or
fewer and a body wrapped at 72 columns that explains what changed and why. Gate
every commit with the milestone gate line. Push at each milestone boundary. The
pull request body links this ExecPlan and roadmap 4.1.1; use the `pr-creation`
skill to write it and `pr-babysitting` to shepherd it.

## Validation and acceptance

Behavioural acceptance:

- Pressing a built-in shortcut (for example, new tab) still opens a tab. The
  convergence test shows that it travelled through `dispatcher.invoke` with
  `source: 'keybinding'`.
- Pressing a shortcut whose plugin handler calls `event.preventDefault()`
  still prevents the browser default (`INV-SYNC`).
- With no search box open, Escape reaches the terminal. The E2E `cat -v`
  step shows `^[`.
- Clicking the search box close button closes that session's search box.
  The E2E scenario and the component test both show this.
- `terms.invokeCommand('editor:search-close', {uid: 42})` resolves to
  `{status: 'error', error: {code: 'INVALID_COMMAND_ARGS', ...}}`, and the
  handler is not called.
- Invoking any command with an already-aborted signal resolves to
  `{status: 'cancelled', stage: 'before-execution'}`. No action is dispatched
  and nothing is emitted.
- Aborting while a renderer handler awaits resolves at once to
  `{status: 'cancelled', stage: 'during-execution'}`, and the handler observes
  `request.signal.aborted === true`.
- A shortcut bound to a command whose `defaultWhen` evaluates to false
  dispatches nothing. The key event is neither marked `catched` nor
  default-prevented.

Red-Green-Refactor evidence, recorded per milestone in `Artefacts and notes`:

- Red: the focused `bun test --isolate <file>` run fails, before the
  production change, with a missing export or an assertion failure naming the
  obligation. For proofs, the red state is an `lsc check` run with the
  `ensures` clauses present and a stub body, showing the open postcondition.
- Green: the same focused command passes after the minimal change.
- Refactor: the focused command passes, then the full gate line.

Quality criteria:

- Tests: `make test` passes with every new suite included. Property tests set
  explicit timeouts and run counts.
- Verification: `make proofs` passes. Every property in the
  `Verification plan` passes, and its permanent mutant tests are rejected as
  expected.
- Lint and type checking: `make lint` and `make typecheck` pass with no new
  suppressions.
- Formatting: `make check-fmt` passes.
- Performance: `INV-SYNC` is the performance requirement, and no benchmark is
  planned. Validators are precompiled at registration, and `when` expressions
  are cached by the context-key service.
- Security: there is no new IPC surface. Plugin-sourced invocations cannot
  claim another source, because the facade fixes `source: 'plugin'`, and their
  arguments are checked as JSON before admission.

## Idempotence and recovery

Every step can be rerun. `bun install` and `make proofs` are idempotent.
`lsc regen` performs a three-way merge, so it is safe to rerun after editing
annotated TypeScript; never delete a `.dfy` file to start again. Each milestone
ends on a committed, green plateau, so reverting a milestone's commits returns
to the previous plateau. Use temporary WIP commits rather than `git stash`,
because the stash is shared with other worktrees.

## Artefacts and notes

Expected logs, where `<branch>` is
`4-1-1-implement-frontend-command-dispatcher`:

```plaintext
/tmp/install-velocetty-<branch>.out
/tmp/check-fmt-velocetty-<branch>.out
/tmp/typecheck-velocetty-<branch>.out
/tmp/lint-velocetty-<branch>.out
/tmp/test-velocetty-<branch>.out
/tmp/proofs-velocetty-<branch>.out
/tmp/e2e-deep-velocetty-<branch>.out
```

Append the seeded-fault transcripts and red-stage excerpts here during
implementation.

## Interfaces and dependencies

Add to `shared/src/types/commands.ts`:

```ts
export type CommandInvocationSource = 'keybinding' | 'palette' | 'menu' | 'ui' | 'plugin' | 'remote';

export interface CommandInvocation<TArgs extends JsonValue = JsonValue> {
  readonly id: CommandId;
  /** Absent arguments are normalized to `null` before validation. */
  readonly args?: TArgs;
  readonly source: CommandInvocationSource;
}

/**
 * Consumers must treat an unrecognized code as a generic failure: 4.1.2 adds
 * a permission code, and older remote clients must still decode results.
 */
export type CommandInvocationErrorCode =
  | CommandValidationErrorCode
  | 'COMMAND_DISABLED'
  | 'INVALID_WHEN_EXPRESSION'
  | 'COMMAND_EXECUTION_FAILED';

export interface CommandInvocationError {
  readonly code: CommandInvocationErrorCode;
  readonly commandId: CommandId;
  readonly message: string;
  readonly issues?: readonly CommandValidationIssue[];
}

/** `before-execution` guarantees no handler ran and nothing was emitted to the host. */
export type CommandCancellationStage = 'before-execution' | 'during-execution';

export type CommandResult<TResult extends JsonValue = JsonValue> =
  | {readonly status: 'ok'; readonly value?: TResult}
  | {readonly status: 'error'; readonly error: CommandInvocationError}
  | {readonly status: 'cancelled'; readonly stage: CommandCancellationStage};

export interface CommandDispatchOptions {
  readonly signal?: AbortSignal;
}

/**
 * `invoke` never rejects. `TResult` is unchecked unless the definition
 * declares a `resultSchema`.
 */
export interface CommandDispatcher<TOptions extends CommandDispatchOptions = CommandDispatchOptions> {
  invoke<TArgs extends JsonValue = JsonValue, TResult extends JsonValue = JsonValue>(
    invocation: CommandInvocation<TArgs>,
    options?: TOptions
  ): Promise<CommandResult<TResult>>;
}
```

Extend `UICommandExecAction` in `shared/src/constants/ui.ts` with
`readonly source: CommandInvocationSource` and `readonly args: JsonValue`.

Add `lib/command-registry-handlers.ts` (renderer only, imports
`@shared/types/*` and `typings/hyper`):

```ts
export interface RendererCommandRequest {
  readonly invocation: CommandInvocation;
  readonly args: JsonValue;
  readonly signal: AbortSignal;
  readonly dispatch: HyperDispatch;
  /** The keyboard event for `keybinding` invocations; otherwise `undefined`. */
  readonly triggerEvent: Event | undefined;
}

export type RendererCommandHandler = (
  request: RendererCommandRequest
) => JsonValue | undefined | Promise<JsonValue | undefined>;
```

When the caller passes no signal, the request carries one shared, module-level
signal that never aborts, and the interpreter adds no listener to it.

Driven ports, in `lib/command-dispatch/ports.ts` (no React, Redux, or DOM event
types):

```ts
export interface CommandCatalogue {
  get(id: CommandId): CommandDefinition | undefined;
  validateArgs(id: CommandId, args: JsonValue): CommandValidationResult;
  validateResult(id: CommandId, value: JsonValue | undefined): CommandValidationResult;
}

export type EnablementVerdict =
  | {readonly kind: 'enabled'}
  | {readonly kind: 'disabled'}
  | {readonly kind: 'invalid'; readonly message: string};

export interface EnablementEvaluator {
  evaluate(expression: string): EnablementVerdict;
}

/** `pending`: the effect has not run yet; a swallow and a deferral look identical. */
export type GateOutcome = 'ran' | 'pending';

export interface ExecutionGate {
  /** `run` is idempotent, never throws, and is a no-op after settlement. */
  admit(invocation: CommandInvocation, args: JsonValue, run: () => void): GateOutcome;
}

export type ExecutionRoute = 'renderer' | 'host';

export type ExecutionStart =
  | {readonly kind: 'hostEmitted'}
  | {readonly kind: 'rendererStarted'; readonly completion: Promise<JsonValue | undefined>};

export interface CommandExecutor<TContext> {
  routeOf(id: CommandId): ExecutionRoute;
  start(invocation: CommandInvocation, args: JsonValue, signal: AbortSignal, context: TContext): ExecutionStart;
}

export interface DispatcherLogger {
  debug(message: string, details: JsonObject): void;
  warn(message: string, details: JsonObject): void;
}
```

The interpreter, in `lib/command-dispatch/dispatcher.ts`:

```ts
export interface CommandDispatcherPorts<TContext> {
  readonly catalogue: CommandCatalogue;
  readonly enablement: EnablementEvaluator;
  readonly gate: ExecutionGate;
  readonly executor: CommandExecutor<TContext>;
  readonly logger: DispatcherLogger;
}

export interface AdmissionCheck {
  readonly admitted: boolean;
  readonly error?: CommandInvocationError;
}

export interface InterpretingDispatcher<TContext> {
  invoke(invocation: CommandInvocation, options?: CommandDispatchOptions, context?: TContext): Promise<CommandResult>;
  /** Pure query: runs only the machine's admission phase, synchronously. */
  check(invocation: CommandInvocation): AdmissionCheck;
}

export const createCommandDispatcher = <TContext>(
  ports: CommandDispatcherPorts<TContext>
): InterpretingDispatcher<TContext> => { /* interpreter */ };
```

The renderer instantiates `TContext` as
`{readonly triggerEvent: Event | undefined}` inside `compose.ts`. This keeps
DOM types out of the core.

The policy, in `lib/command-dispatch/policy/invocation-machine.ts`. It imports
nothing; gate failures are reported by index, and the interpreter maps an index
to an error code:

```ts
export type GateIndex = 0 | 1 | 2 | 3; // resolve, routeArgs, validateArgs, enablement
export type MachineState =
  | {readonly phase: 'admitting'; readonly gate: number}
  | {readonly phase: 'awaitingGate'}
  | {readonly phase: 'executing'}
  | {readonly phase: 'settled'; readonly outcome: MachineOutcome; readonly failedGate: number};
export type MachineOutcome = 'ok' | 'rejected' | 'failedHandler' | 'failedResult' | 'cancelledBefore' | 'cancelledDuring';
export type MachineEvent =
  | {readonly kind: 'gatePassed'}
  | {readonly kind: 'gateFailed'}
  | {readonly kind: 'aborted'}
  | {readonly kind: 'gateRan'}
  | {readonly kind: 'gatePending'}
  | {readonly kind: 'hostEmitted'}
  | {readonly kind: 'handlerFulfilled'; readonly resultValid: boolean}
  | {readonly kind: 'handlerRejected'; readonly isAbortReason: boolean};
export type MachineAction =
  | {readonly kind: 'evaluateGate'; readonly gate: number}
  | {readonly kind: 'openGate'}
  | {readonly kind: 'runHandler'}
  | {readonly kind: 'settle'}
  | {readonly kind: 'none'};
export interface MachineStep {
  readonly state: MachineState;
  readonly action: MachineAction;
}
export function initialState(isAborted: boolean): MachineStep;
export function step(state: MachineState, event: MachineEvent): MachineStep;
```

The exact shapes may be adjusted during the EP-M2 spike to fit LemmaScript's
subset, for example by replacing the `GateIndex` alias with `number` and a
range precondition. Any such change is recorded in `Decision log`.

Dependencies: `fast-check@^4.10.2` and `lemmascript@0.6.5`, both for
development. Dafny 4.11 is a host tool, installed in CI from a pinned archive.
No runtime dependency is added.

### Planned file inventory

Production code (25 files):

- `lib/command-registry.ts`;
- `lib/command-registry-validation.ts`;
- `lib/command-registry-handlers.ts`;
- `lib/commands/search-close.ts`;
- `lib/command-dispatch/policy/invocation-machine.ts`;
- `lib/command-dispatch/policy/invocation-machine.dfy`;
- `lib/command-dispatch/policy/invocation-machine.dfy.gen`;
- `lib/command-dispatch/ports.ts`;
- `lib/command-dispatch/dispatcher.ts`;
- `lib/command-dispatch/compose.ts`;
- `lib/command-dispatch/adapters/registry-catalogue.ts`;
- `lib/command-dispatch/adapters/context-key-enablement.ts`;
- `lib/command-dispatch/adapters/redux-execution-gate.ts`;
- `lib/command-dispatch/adapters/renderer-executor.ts`;
- `lib/command-dispatch/inbound/keybinding.ts`;
- `lib/command-dispatch/inbound/command-dispatcher-provider.tsx`;
- `lib/command-dispatch/inbound/plugin-api.ts`;
- `lib/index.tsx`;
- `lib/containers/hyper.tsx`;
- `lib/components/terms.tsx`;
- `lib/components/term.tsx`;
- `lib/actions/ui.ts`;
- `typings/hyper.d.ts`;
- `shared/src/types/commands.ts`;
- `shared/src/constants/ui.ts`.

Build, tooling, and configuration (9 files):

- `scripts/check-package-boundaries.mjs`;
- `package.json`;
- `bun.lock`;
- `Makefile`;
- `LemmaScript-files.txt`;
- `.github/workflows/proofs.yml`;
- `typos.local.toml`;
- `typos.toml`;
- `.gitignore`, if LemmaScript writes caches.

Tests (15 files):

- in `test/unit/command-dispatch/`: `invocation-machine.test.ts`,
  `dispatcher.test.ts`, `validation.property.test.ts`,
  `cancellation.property.test.ts`, `convergence.test.ts`, `keybinding.test.ts`,
  `keybinding-reload.property.test.ts`, `plugin-api.test.ts`,
  `search-close-button.test.tsx`, and `interpreter-structure.test.ts`;
- `test/unit/command-registry-validation.test.ts`;
- `test/unit/command-registry-compat.test.ts`;
- `test/unit/hyper-effects.test.ts`;
- `test/unit/hyper-transport.test.ts`;
- `test/testUtils/command-registry-mock.ts`.

E2E (1 file): `test/e2e-deep/command-dispatch.e2e.ts`.

Documentation (7 files):

- `docs/adr-007-frontend-command-dispatcher-contract.md`;
- `docs/command-dispatch-architecture.md`;
- `docs/velocetty-design.md`;
- `docs/developers-guide.md`;
- `docs/users-guide.md`;
- `PLUGINS.md`;
- `docs/roadmap.md`.

## Revision note

- 2026-10-29, revision 1: initial draft, before the expert-panel review.
- 2026-10-29, revision 2: incorporated the six-lens expert-panel review.
  - Replaced the admission fold and settlement reducer with one proved
    invocation machine that the dispatcher interprets (D-14).
  - Resolved the swallow-versus-defer contradiction as pending semantics
    (D-6).
  - Fixed the Escape regression by normalizing absent arguments to `null`
    (D-11).
  - Replaced keymap-derived registry definitions with a catalogue fallback
    (D-4).
  - Added generation-guarded keymap reloads (D-12).
  - Made enablement source-aware, with a disabled shortcut passing its key
    through (D-7, D-13).
  - Moved Redux and DOM types out of the core behind a `CommandExecutor` port
    (D-15).
  - Kept the requested documents (D-16).
  - Removed a false premise about test type-checking.
  - Added per-milestone gate lines, the commit and pull-request workflow, a
    file inventory with recalibrated tolerances, and local Dafny and E2E
    instructions.

  The remaining work is unchanged in scope but re-sequenced: EP-M2 now proves
  the machine that EP-M4 interprets.
