# Implement the frontend command dispatcher (roadmap 4.1.1)

## Module header

Purpose: deliver one renderer-side command dispatcher through which every
keybinding, user-interface (UI) control, and plugin call runs. The dispatcher
validates arguments against JSON Schema before execution and honours
cancellation through `AbortSignal`.

Invariants: every invocation passes the same ordered gates (resolve, validate
arguments, check enablement, admit through the Redux execution gate, execute,
validate the result). Every invocation settles exactly once, as `ok`, `error`,
or `cancelled`. No handler runs for an invocation that fails a gate or whose
signal was already aborted.

Cross-links: `docs/roadmap.md` (4.1.1), `docs/velocetty-design.md` §Command
registry and dispatcher and §Cancellation semantics,
`docs/velocetty-product-requirements-document.md` §3, `lib/command-registry.ts`,
`lib/context-key-service.ts`, `shared/src/types/commands.ts`, `PLUGINS.md`.

This Execution Plan (ExecPlan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT

No `PLANS.md` exists in this repository; this file is the only plan for the
work.

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

- A single `CommandDispatcher.invoke(invocation, options)` call is the only
  way the renderer executes a command. Keybindings, the search box close button
  (the first UI control routed through commands), and plugins (through the new
  `Terms#invokeCommand` method) all use it.
- A command whose definition declares an `argsSchema` rejects invalid
  arguments with a structured `INVALID_COMMAND_ARGS` error before any handler
  runs.
- A caller can pass an `AbortSignal`. An already-aborted signal prevents
  execution. Aborting during execution settles the invocation as `cancelled` at
  once, and the handler receives the signal so it can stop cooperatively.
- Every invocation resolves to a discriminated `CommandResult`: `ok` with a
  value, `error` with a code and message, or `cancelled`.

A human can see it working by pressing the search shortcut (`Ctrl+Shift+F` on
Linux, to be confirmed in Stage A), observing the search box open, clicking its
close button, and observing it close. Both actions now travel through the
dispatcher, and the new deep end-to-end (E2E) scenario
`test/e2e-deep/command-dispatch.e2e.ts` asserts this. Behavioural unit tests
show that one command invoked from each of the three sources produces the same
gate sequence and the same Redux `UI_COMMAND_EXEC` action, differing only in
`source`.

This plan covers only the renderer (frontend) dispatcher. The backend command
registry, server-side re-validation, permission checks, and result-bearing
backend RPC belong to roadmap 4.1.2. Routing the remaining menus and buttons
through commands belongs to 4.3.2.

## Constraints

- Implementation starts only after the user explicitly approves this plan.
- Do not modify the Electron main process (`app/`) or add, rename, or change
  any IPC channel or its Zod schema in `lib/transport/ipc-schemas.ts`. Host
  (main-process) commands keep using the existing fire-and-forget
  `transport.emit('command', id)` channel.
- Preserve the documented Hyper plugin contracts in `PLUGINS.md`:
  `terms.registerCommands({...})` handlers keep receiving `(event, dispatch)`.
  If no renderer handler exists, the command name is still emitted to the main
  process. Plugin Redux middleware can still observe, swallow, or defer the
  `UI_COMMAND_EXEC` action before a command executes. These are the
  compatibility surfaces with named external consumers (third-party Hyper
  plugins); no other compatibility layer is permitted.
- Keep `decorateKeymaps`, `getRegisteredKeys`, and `shouldPreventDefault`
  behaviour unchanged. A legacy handler that calls `event.preventDefault()`
  must still run synchronously inside the keydown callback.
- Domain policy (`lib/command-dispatch/policy/`) must not import React, Redux,
  Ajv, the transport, the context-key service, or any DOM type. It may import
  only `@shared/types/*`.
- The dispatcher creates no timers and reads no clock. Timeouts are the
  caller's concern (`AbortSignal.timeout`). Logging goes through an injected
  logger port; no `console` calls in dispatcher code.
- Tests must follow `docs/developers-guide.md` "Unit tests (Bun)": no
  `mock.module` (`deslop/no-module-mocking` is an error), no file-scope
  teardown of global shims, injected seams instead of global timers or loggers,
  and suites that pass under `bun test --concurrent --isolate`.
- No code file may exceed 400 lines (`AGENTS.md`). `lib/command-registry.ts`
  is at 396 lines, so it must shrink before it grows. Pre-existing oversized
  files (`lib/components/term.tsx`, `lib/bootstrap/renderer-bootstrap.ts`) may
  receive only minimal edits and must not grow by more than 15 lines each.
- New dependencies are limited to `fast-check` (development, caret range) and
  `lemmascript` (development, pinned exactly because it is a tech preview,
  following the `ai-deslop` precedent). The user explicitly requested both.
- Documentation uses en-GB-oxendict spelling and follows
  `docs/documentation-style-guide.md`.
- `make check-fmt`, `make typecheck`, `make lint`, and `make test` must pass at
  the end of every milestone. The proof milestone also requires `make proofs`.

## Tolerances (exception triggers)

- Scope: if implementation needs more than 40 non-ExecPlan files, or more than
  3,800 net lines of code and other documentation, stop and escalate. Exclude
  this ExecPlan from both counts. Generated `*.dfy.gen` files are excluded from
  the line count but count towards files.
- Interface: if a change to an IPC channel, a main-process module, or the
  `PLUGINS.md` plugin contracts becomes necessary, stop and escalate.
- Dependencies: if any dependency beyond `fast-check` and `lemmascript` is
  needed, stop and escalate.
- Proof feasibility: if, after two working sessions on milestone EP-M2, a
  policy module cannot be verified in place by LemmaScript without `//@ assume`
  or a parallel model, stop and present the options listed in EP-M2.
- Iterations: if a gate still fails after three fix attempts within one
  milestone, stop and escalate with the log paths.
- Ambiguity: if the source of a command invocation (keybinding, UI, plugin)
  cannot be routed through the dispatcher without changing user-visible
  behaviour other than that described in `Purpose / big picture`, stop and
  present options.
- File size: if keeping a touched file under 400 lines would require an
  unplanned refactor of more than 100 lines, stop and escalate.

## Risks

- Risk: the pipeline becomes asynchronous before the handler runs, so legacy
  handlers call `event.preventDefault()` after the browser has already acted on
  the keystroke. Severity: high. Likelihood: medium. Mitigation: obligation
  `INV-SYNC` makes synchronous admission an explicit invariant, tested by
  asserting the handler ran before `invoke()` returned.
- Risk: renderer-registered commands do not include the main-process commands
  bound in keymaps (for example `tab:new`), so the resolve gate would reject
  every built-in shortcut with `COMMAND_NOT_FOUND`. Severity: high. Likelihood:
  certain without mitigation. Mitigation: EP-M3 registers keymap-derived host
  definitions during `getRegisteredKeys()`, and
  `test/unit/command-dispatch/convergence.test.ts` drives a real keymap through
  the real registry.
- Risk: a plugin middleware swallows `UI_COMMAND_EXEC`, so the execution gate
  never opens and an awaiting caller waits indefinitely. Severity: medium.
  Likelihood: low. Mitigation: a swallowed action settles as `cancelled` with
  stage `vetoed` when the dispatch returns without the effect having run and
  without the middleware having deferred it (see `Decision log`, D-6). Deferred
  effects still settle when the effect runs or the signal aborts.
- Risk: LemmaScript (tech preview) does not support a construct used by the
  policy modules, or its Dafny output fails to verify. Severity: medium.
  Likelihood: medium. Mitigation: EP-M2 starts with a prototyping spike that
  either verifies the annotated modules or triggers the proof-feasibility
  tolerance.
- Risk: `deslop/no-unknown-returns`, `deslop/no-object-parameters`, and
  `deslop/no-unknown-type-aliases` reject natural signatures for
  `CommandResult<unknown>` and handler request objects. Severity: low.
  Likelihood: medium. Mitigation: use named generic types with defaults rather
  than bare `unknown` aliases, and run `bun run lint:oxlint` on each new file
  as it is created.
- Risk: `test/` is type-checked by no project, so a test double can drift
  from the real shape. Severity: medium. Likelihood: medium. Mitigation: new
  tests live in `test/unit/command-dispatch/`, which EP-M4 adds to
  `tsconfig.typecheck.json` as a narrow ratchet, and fixtures are built from
  production types and factories.
- Risk: the branch grows large, and CodeScene (advisory, not required) fails
  large pull requests. Severity: low. Likelihood: high. Mitigation: small files
  at full health, separate refactor commits, and acceptance that CodeScene is
  advisory on this repository.
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
- [x] (2026-10-29) Drafted this ExecPlan.
- [ ] Expert-panel design review and revision.
- [ ] User approval.
- [ ] EP-M0 baseline.
- [ ] EP-M1 registry refactor.
- [ ] EP-M2 verified policy core.
- [ ] EP-M3 shared contract and registry extensions.
- [ ] EP-M4 dispatcher service and driven adapters.
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
  `upsertCommand`; only runtime plugin commands and legacy handler commands are
  registered. Impact: the resolve gate needs keymap-derived host definitions
  (D-4).
- Observation: built-in command identifiers use colons (`tab:new`), not the
  dot-separated form in the design document (`terminal.newTab`). Evidence:
  `app/keymaps/linux.json`. Impact: the dispatcher treats identifiers as opaque
  `CommandId` values; renaming is out of scope.
- Observation: the golden-path demonstration command declares
  `kind: 'frontend'` but is implemented in the main process. Evidence:
  `shared/src/runtime/golden-path-demo.ts:53` and `app/commands.ts:154-164`.
  Impact: routing by `kind` alone would break it, which informs D-5.
- Observation: the `effects` middleware documents that plugins may
  "interrupt, defer, or augment side effects". Evidence:
  `lib/utils/effects.ts:1-9`. Impact: execution must stay behind the
  `UI_COMMAND_EXEC` action (D-6).
- Observation: `fast-check`, LemmaScript, and Gherkin feature files are all
  absent; behavioural tests are ordinary `bun:test` suites. Evidence:
  `package.json`, `bun.lock`, and `test/`. Impact: this plan introduces the two
  tools and writes behavioural tests as named `bun:test` scenarios.
- Observation: `docs/users-guide.md` and any component architecture document
  do not exist. Impact: EP-M7 creates both.

## Decision log

- D-1. Decision: implement the dispatcher in `lib/command-dispatch/`, not in
  the `frontend/` package. Rationale: `frontend/src` is a one-line placeholder
  with no `@frontend` alias in the root `tsconfig.json`,
  `tsconfig.typecheck.json`, or the esbuild configuration. The boundary script
  already treats `lib/` as the frontend layer, and roadmap items 1.2.1 and
  1.2.2 placed their renderer code in `lib/`. Wiring the alias is a packaging
  change unrelated to this item. Date/Author: 2026-10-29, planning agent.
- D-2. Decision: shared, serializable contract types (`CommandInvocation`,
  `CommandInvocationSource`, `CommandResult`, `CommandInvocationError`,
  `CommandDispatcher`) live in `shared/src/types/commands.ts`. Renderer-only
  types (the handler request, which carries `dispatch` and the DOM trigger
  event) live in `lib/command-dispatch/`. Rationale: 4.1.2 and the remote
  protocol need the wire shapes; they must never see Redux or DOM types.
  Date/Author: 2026-10-29, planning agent.
- D-3. Decision: `CommandResult` is a discriminated union on `status`
  (`'ok' | 'error' | 'cancelled'`) instead of the design sketch's
  `{ok: boolean; result?; error?; cancelled?}`. Rationale: the sketch admits
  illegal states (`ok: true` with an `error`, or `cancelled` with `ok: true`).
  The union makes them unrepresentable and gives exhaustive `switch` checking.
  This is a deviation from `docs/velocetty-design.md` lines 532-550 and is
  recorded in ADR-007, which EP-M3 adds. Date/Author: 2026-10-29, planning
  agent.
- D-4. Decision: `getRegisteredKeys()` registers a host definition
  (`kind: 'backend'`, title equal to the identifier) for every keymap command
  that has no definition. These synthesized definitions are tracked like
  runtime plugin commands: removed when they leave the keymap, and never
  overwriting a definition registered by other means. Rationale: it makes the
  resolve gate meaningful without a new IPC channel. Host commands that no
  keymap binds (`cli:install`, `editor:quit`, `editor:stop`, `editor:tmux`,
  `window:toggleKeepOnTop`) remain unresolvable from the renderer until 4.1.2
  or 4.3.2 supply a host command catalogue. Date/Author: 2026-10-29, planning
  agent.
- D-5. Decision: route execution by handler presence, not by `kind`. A
  command with a registered renderer handler executes in the renderer;
  otherwise its identifier is emitted to the host. `kind` stays descriptive
  until 4.1.2 introduces the backend registry. Rationale: `PLUGINS.md`
  documents exactly this fallback, plugins override built-in host commands with
  renderer handlers (the `pane:maximize` example), and the golden-path command
  is misclassified (see `Surprises & discoveries`). Date/Author: 2026-10-29,
  planning agent.
- D-6. Decision: the execution gate dispatches `UI_COMMAND_EXEC` (now carrying
  `source` and `args`) with an `effect` callback, and execution happens inside
  that effect. If `dispatch` returns without the effect having run, the
  invocation is pending until the effect runs (a deferring middleware) or the
  signal aborts. Rationale: it keeps the documented plugin interception point
  for every source, not only keybindings. Open question for review: whether a
  synchronous swallow should settle as `cancelled` with stage `vetoed` rather
  than remain pending. Date/Author: 2026-10-29, planning agent.
- D-7. Decision: enablement is enforced for every source. A command with
  `defaultWhen` executes only when the expression evaluates to `true` against
  the renderer context-key service; an unparseable expression fails closed with
  `INVALID_WHEN_EXPRESSION`. Commands without `defaultWhen` are always enabled.
  Rationale: the design's dispatcher path lists the `when` check as a gate, and
  the success criterion requires identical paths. VS Code instead ignores
  `when` for programmatic calls; that alternative is recorded in ADR-007.
  Date/Author: 2026-10-29, planning agent.
- D-8. Decision: on abort during execution the invocation settles as
  `cancelled` immediately, and any later handler outcome is discarded (a late
  rejection is consumed and logged at debug level). A handler that rejects with
  the signal's `reason` also yields `cancelled`. Host commands are
  fire-and-forget and settle `ok` once emitted. Rationale: callers such as the
  palette must be released promptly; cooperative handlers still receive the
  signal. Date/Author: 2026-10-29, planning agent.
- D-9. Decision: add `fast-check` and `lemmascript` as development
  dependencies, and a `make proofs` target. Rationale: the user requested
  property tests and an exhaustive proof for contractual logic; the two policy
  modules are pure and fit LemmaScript's supported fragment. Date/Author:
  2026-10-29, planning agent.
- D-10. Decision: the first UI control routed through the dispatcher is the
  search box close button (`editor:search-close` with a validated
  `{uid?: string}` argument). Rationale: it already has a renderer handler, so
  the change exercises argument validation from a real UI control without
  migrating menus (4.3.2). Tab decoration widgets carry a `CommandId` but have
  no rendered click surface yet. Date/Author: 2026-10-29, planning agent.

## Outcomes & retrospective

Not started. Complete at each milestone boundary and at closure.

## Context and orientation

The repository is an Electron application with three code areas that matter
here:

- `app/` is the Electron main process. `app/commands.ts` holds a flat table of
  host commands (for example `tab:new`) that mostly emit legacy RPC events back
  to the renderer. Menus call it directly. This plan does not touch `app/`.
- `lib/` is the renderer (the browser-side React and Redux application). The
  boundary script `scripts/check-package-boundaries.mjs` classifies `lib/` and
  `frontend/src` together as the frontend layer, which may import `@shared/*`
  but not `app/` or `backend/`.
- `shared/src/` holds types and constants used by both sides.

Terms used in this plan:

- Command definition: a `CommandDefinition` from
  `shared/src/types/commands.ts`, with an `id`, `metadata`, `kind`, optional
  `defaultWhen` (a `when` expression string), and optional `argsSchema` and
  `resultSchema` (JSON Schema objects).
- Command registry: `lib/command-registry.ts`, built by
  `createCommandRegistryModule(dependencies)`. It stores definitions and
  optional renderer handlers, orders `list()` by identifier, and validates
  arguments with Ajv (`validateArgs`). Ajv resolves to 6.14.0 through the
  `overrides` block in `package.json`, and uses JSON Schema draft-07.
- Context-key service: `lib/context-key-service.ts#createContextKeyService`.
  It stores named values and evaluates `when` expressions such as
  `terminalFocus && !settingsOpen`. `evaluate` throws
  `WhenExpressionSyntaxError` for an unparseable expression. Nothing in the
  application constructs or populates one yet.
- Host command: a command executed by the Electron main process, reached by
  `transport.emit('command', id)`.
- Execution gate: the Redux hop through which a command passes before it
  executes. The store middleware chain is `thunk`, `plugins.middleware`,
  `writeMiddleware`, `effects` (`lib/store/configure-store.*.ts`). The
  `effects` middleware runs an action's `effect()` after the rest of the chain
  has passed the action on.
- Port and adapter: following the hexagonal architecture style, a port is an
  interface that the dispatcher's own code defines to describe what it needs
  (for example "look up a command definition"). An adapter is the small piece
  of code that satisfies that port using real infrastructure (the registry,
  Redux, the transport). Ports let the dispatcher be tested with in-memory
  fakes.

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
source adapter (keybinding | UI | plugin)
  -> dispatcher.invoke({id, args, source}, {signal, triggerEvent})
  -> resolve -> validate args -> check enablement      (admission policy)
  -> UI_COMMAND_EXEC with effect                       (execution gate)
  -> renderer handler(request) or host emit            (executor)
  -> validate result -> settle exactly once            (settlement policy)
```

Relevant skills for the implementer: `typescript-router` (start here),
`typescript-async-and-concurrency` (signal ownership and settlement),
`typescript-errors-and-outcomes` (result union and error mapping),
`typescript-boundaries-and-validation` (argument and result schemas),
`react-and-accessible-ui` (context provider and hook), `electron-and-ipc`
(renderer-host routing), `hexagonal-architecture` (ports and adapters),
`fast-check`, `lemmascript`, `typescript-testing`, `biome-typescript`, and
`execplans`. Use the `codegraph` MCP tools (`codegraph_get_callers`,
`codegraph_analyze_impact`) before editing `lib/command-registry.ts`,
`lib/actions/ui.ts`, or `lib/containers/hyper.tsx`.

Relevant documents: `docs/developers-guide.md` (sections "Command registry
practice", "Context key and `when` practice", and "Unit tests (Bun)"),
`docs/testing-with-bun.md`, `docs/adr-005-enhance-e2e-testing-strategy.md`,
`docs/adr-006-oxlint-plugin-strategy.md`, `docs/documentation-style-guide.md`,
and `PLUGINS.md` §Register a handler for your commands.

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
    commands (respected by not adding privileged renderer handlers).
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
RM-4.1.1-A  -> TDD-DISP-PATH -> EP-M2 admission, EP-M4 -> dispatcher.test.ts::rejects invalid args before execution
RM-4.1.1-A  -> TDD-DISP-API  -> EP-M3 validateResult -> command-registry-validation.test.ts::result schema
RM-4.1.1-B  -> TDD-CANCEL    -> EP-M2 settlement, EP-M4 -> cancellation.property.test.ts::settles exactly once
RM-4.1.1-SC -> PRD-DISP-SINGLE, TDD-PRINC-CMD -> EP-M5 -> convergence.test.ts::sources share one path
RM-4.1.1-SC -> PRD-DISP-SINGLE -> EP-M6 -> command-dispatch.e2e.ts::keybinding and button use dispatcher
TDD-DISP-API (deviation D-3) -> ADR-007 -> EP-M3 -> shared result union
```

Deviation: D-3 changes the shape in `TDD-DISP-API`. It is proposed here for
approval together with the plan; EP-M3 records it in ADR-007 and EP-M7 updates
`docs/velocetty-design.md` to reference the ADR.

## Verification plan

The implementation is split so that the two pieces of contractual logic are
pure functions, separately from the asynchronous orchestration that uses them.
That decomposition is what makes a proof tractable: LemmaScript verifies pure
TypeScript in place, and fast-check checks the asynchronous code against the
same pure functions.

### Obligations

- Obligation `INV-ADMIT-SOUND`: `admitInvocation(verdicts)` returns `admit`
  only if every gate verdict is `pass`.
  - Method: formal proof (LemmaScript, Dafny backend) plus an exhaustive
    parameterized table.
  - Rationale: this is the contract that no handler runs for an invalid,
    unknown, or disabled command. It is load-bearing for 4.1.2's permission
    gate, which will add a verdict.
  - Domain: all verdict sequences of any length, each verdict `pass` or a
    failure carrying a code.
  - Artefact: `lib/command-dispatch/policy/admission.ts` with `//@` contracts;
    `lib/command-dispatch/policy/admission.dfy`;
    `test/unit/command-dispatch/admission.test.ts`.
  - Evidence: `make proofs` reports `0 errors` for `admission.ts`; the table
    test enumerates all 2^4 pass and fail combinations of the four current
    gates.
  - Non-vacuity: the `requires` clause is `true` (every array is admissible).
    Witnesses: the all-pass sequence (admit) and each single-failure sequence
    (reject). Seeded fault: change the loop to skip the last verdict; the
    proof must fail on the soundness `ensures`, and the table row with only
    the last gate failing must fail.
- Obligation `INV-ADMIT-FIRST`: when `admitInvocation` rejects, the code is
  that of the first failing verdict in gate order.
  - Method: formal proof plus the same table.
  - Rationale: callers branch on the code (the palette shows "invalid
    arguments" differently from "disabled"); precedence must be stable.
  - Domain and artefacts: as for `INV-ADMIT-SOUND`.
  - Evidence: the `ensures` clause states that every verdict before the
    returned index passes and the verdict at the index fails.
  - Non-vacuity: witness with two failures (resolve passes, arguments fail,
    enablement fails) must report the arguments code. Seeded fault: return
    the last failure; the proof and that table row must fail.
- Obligation `INV-ADMIT-COMPLETE`: when every verdict passes, the result is
  `admit`.
  - Method: formal proof plus the table.
  - Non-vacuity: the all-pass witness; seeded fault: reject an empty
    sequence; the proof must fail.
- Obligation `INV-SETTLE-ONCE`: the settlement reducer
  `applySettlementEvent(state, event)` never changes a settled state, and
  `settle(events)` equals the outcome of the first decisive event.
  - Method: formal proof (in place, over event arrays of any length) plus a
    fast-check model-based property against the real asynchronous
    dispatcher.
  - Rationale: exactly-once settlement is the core cancellation contract
    (`RM-4.1.1-B`); a double settlement would report both `ok` and
    `cancelled` to different observers.
  - Domain: events `handlerFulfilled`, `handlerRejected(isAbortReason)`,
    `aborted`, `effectRan`, `gateSwallowed`; states `awaitingGate`,
    `executing`, and `settled(outcome)`.
  - Artefact: `lib/command-dispatch/policy/settlement.ts`,
    `lib/command-dispatch/policy/settlement.dfy`,
    `test/unit/command-dispatch/settlement.test.ts`,
    `test/unit/command-dispatch/cancellation.property.test.ts`.
  - Evidence: `make proofs` reports `0 errors`; the property passes 1,000
    runs with `fc.scheduler()` interleavings.
  - Non-vacuity: proof antecedents are satisfiable (the empty sequence and
    each single-event sequence are witnesses). The property records
    `fc.statistics` classification of the outcome and requires every outcome
    class (`ok`, `error`, `cancelled` before start, `cancelled` during
    execution, late rejection after abort) to be generated at least once;
    the test fails otherwise. Seeded fault: let `aborted` overwrite an `ok`
    settlement; the proof must fail on absorption and the property must find
    a counterexample.
- Obligation `INV-CANCEL-DOMINANT`: if `aborted` is the first decisive event
  after `executing` begins, the outcome is `cancelled`; if the signal is
  already aborted at `invoke`, no gate effect and no handler run.
  - Method: proof for the reducer; named unit tests for the pre-aborted case.
  - Non-vacuity: witness sequences `[aborted, handlerFulfilled]` (cancelled)
    and `[handlerFulfilled, aborted]` (ok). Seeded fault: check the signal
    only after the gate; the pre-aborted unit test must observe the gate
    action and fail.
- Obligation `INV-VALIDATE-BEFORE-EXEC`: for any definition with an
  `argsSchema` and any argument value, the handler runs only if Ajv accepts the
  value, and an invalid value yields `INVALID_COMMAND_ARGS` with every Ajv
  issue.
  - Method: fast-check property over generated schemas from a small grammar
    (object, string with `minLength`, integer with `minimum`, `required`,
    `additionalProperties: false`) and generated values.
  - Rationale: the schema space is infinite; the relation between Ajv's
    verdict and execution is the invariant, and Ajv's internals are an axiom.
  - Artefact: `test/unit/command-dispatch/validation.property.test.ts`.
  - Evidence: 500 runs pass; classification shows both valid and invalid
    arguments in at least 20% of runs each.
  - Non-vacuity: a seeded fault that skips the validation gate when
    `args === undefined` must be caught by generated `required` schemas.
- Obligation `INV-SYNC`: when no middleware defers `UI_COMMAND_EXEC`, the
  handler is called before `invoke()` returns its promise.
  - Method: named unit tests with a real store middleware chain.
  - Rationale: legacy keybinding handlers call `event.preventDefault()`;
    asynchronous admission would break them silently.
  - Artefact: `test/unit/command-dispatch/dispatcher.test.ts`.
  - Non-vacuity: seeded fault: insert `await Promise.resolve()` before the
    gate; the test must fail.
- Obligation `INV-SAME-PATH`: for a fixed command, the keybinding adapter,
  the UI hook, and the plugin facade produce the same gate sequence, the same
  `UI_COMMAND_EXEC` action except for `source`, and the same result.
  - Method: behavioural test with the real registry, context-key service,
    and store middleware chain; parameterized over the three sources and over
    three commands (valid renderer command, invalid arguments, host command).
  - Artefact: `test/unit/command-dispatch/convergence.test.ts`.
  - Non-vacuity: seeded fault: let the plugin facade call the registry
    handler directly; the recorded action list for the plugin row must differ
    and fail.
- Obligation `INV-KEYMAP-SYNC`: synthesizing keymap host definitions is
  idempotent, never overwrites a definition registered by a plugin or legacy
  handler, and removes only definitions it synthesized.
  - Method: fast-check property over generated sequences of keymap snapshots
    interleaved with plugin registrations.
  - Artefact: `test/unit/command-dispatch/keymap-definitions.property.test.ts`.
  - Non-vacuity: classification must include overlapping identifiers;
    seeded fault: always overwrite; the property must find a counterexample.
- Obligation `INV-NO-LEAK`: after settlement, the dispatcher has removed
  every abort listener it added, and no handler rejection is left unhandled.
  - Method: named unit tests that wrap `addEventListener` and
    `removeEventListener` on a real `AbortSignal` instance, and a thenable
    fake that records whether a rejection handler was attached.
  - Artefact: `test/unit/command-dispatch/dispatcher.test.ts`.

### Axioms

- `AX-AJV`: Ajv 6.14.0 `compile` and the compiled validator implement JSON
  Schema draft-07 for the keywords used, and `errors` lists every failure when
  `allErrors` is true. Exercised against the real Ajv in every test.
- `AX-ABORT`: `AbortSignal` fires `abort` at most once, `aborted` becomes
  true before listeners run, and `reason` is stable afterwards (WHATWG DOM).
  Exercised with real `AbortController` instances in Bun and in the Electron
  renderer E2E scenario.
- `AX-REDUX`: Redux middleware runs synchronously in chain order, and the
  `effects` middleware calls `effect()` after `next(action)` returns, at most
  once per action. Exercised with the real middleware modules.
- `AX-LS`: LemmaScript's translation of the supported TypeScript fragment to
  Dafny preserves the semantics relevant to the obligations (array indexing,
  discriminated unions, string-literal comparison, loops with invariants). The
  policy modules avoid floating point, `async`, closures, and regular
  expressions so the documented modelling gaps do not apply.
- `AX-DAFNY`: Dafny 4.11 and its Z3 back end are sound.

Residual gaps: the proofs cover the pure policy only. The orchestration in
`dispatcher.ts` is trusted to call the policy correctly, which the property
tests sample but do not prove. Plugin middleware behaviour beyond observe,
swallow, and defer is not modelled.

## Plan of work

### Stage A: understand and propose (no code changes)

Complete. Reconnaissance results are recorded in `Context and orientation` and
`Surprises & discoveries`. After approval, confirm three small facts before
EP-M3 and record each in `Surprises & discoveries`: the exact Linux search
shortcut in `app/keymaps/linux.json`; whether the golden-path plugin is enabled
in the E2E environment; and the line in `lib/components/term.tsx` where the
search box `close` prop is wired.

### Stage B: red tests and failing verification artefacts

Each implementation milestone opens with the smallest failing test or open
proof goal for its obligations, run once to observe the expected failure,
before production code is written.

### Stage C: implementation with verification

Milestones EP-M1 to EP-M6 below.

### Stage D: refactor, documentation, and closure

Milestone EP-M7, plus a refactor pass at the end of each milestone.

## Milestones and plateaus

### EP-M0: baseline

- Outcome: dependencies installed and every gate's baseline result recorded,
  with no source change.
- Requirements and gaps: none; establishes the comparison point.
- Acceptance evidence: logs under
  `/tmp/*-velocetty-4-1-1-implement-frontend-command-dispatcher.out` for
  `make check-fmt`, `make typecheck`, `make lint`, and `make test`, each
  passing. If any fails on the untouched tree, record it in
  `Surprises & discoveries` and escalate before EP-M1.
- Conformance check: not applicable (no change).
- Recovery: rerun `bun install`; it is idempotent.
- Remaining gaps: everything.
- Compatibility decision: none.

### EP-M1: make room in the command registry

- Outcome: Ajv validation moves from `lib/command-registry.ts` into
  `lib/command-registry-validation.ts`, exporting
  `createCommandSchemaValidator()` with `validateArgs` and `forget(commandId)`.
  The registry delegates to it. Behaviour and exports are unchanged.
- Requirements and gaps: prepares `RM-4.1.1-A`; satisfies the 400-line
  constraint.
- Acceptance evidence: the existing
  `test/unit/command-registry*.test.ts` suites pass unchanged;
  `lib/command-registry.ts` is under 320 lines.
- Conformance check:
  - No behaviour change; existing suites are the evidence.
  - No new interface beyond the internal validator module.
  - No dependency, trust-boundary, or persisted-format change.
- Recovery: `git revert` the single refactor commit.
- Remaining gaps: all dispatcher behaviour.
- Compatibility decision: none (internal module).

### EP-M2: verified policy core (includes a prototyping spike)

- Outcome: two pure modules exist and are proved in place.
  - `lib/command-dispatch/policy/admission.ts` exports the `GateVerdict` type
    and `admitInvocation(verdicts: readonly GateVerdict[]): AdmissionDecision`.
  - `lib/command-dispatch/policy/settlement.ts` exports `SettlementState`,
    `SettlementEvent`, `applySettlementEvent`, and `settle`.
  - `LemmaScript-files.txt` at the repository root lists both files.
  - The `Makefile` gains `proofs`, which runs
    `bunx --bun lsc check --backend=dafny` over that list.
  - `.github/workflows/proofs.yml` runs `make proofs` on pull requests, with
    Dafny installed from a pinned release.
  - `package.json` gains `fast-check` (`^4.10.2`) and `lemmascript`
    (`0.6.5`).
- Prototyping spike, first step: annotate `admission.ts` alone and run
  `lsc check`. Keep the approach if it verifies with no `//@ assume`. Otherwise
  stop under the proof-feasibility tolerance and present these options: (a)
  restructure the policy into a form LemmaScript supports; (b) replace the
  proof with exhaustive enumeration over bounded sequence lengths, stating the
  bound as a residual gap; (c) fix the LemmaScript toolchain upstream first.
- Requirements and gaps: `RM-4.1.1-A`, `RM-4.1.1-B` (policy halves);
  obligations `INV-ADMIT-*`, `INV-SETTLE-ONCE`, `INV-CANCEL-DOMINANT`.
- Acceptance evidence: `make proofs` prints `0 errors` for both files; the
  table test and reducer unit tests pass; the seeded faults listed in the
  `Verification plan` are each run once locally, observed to fail, and
  reverted, with the transcript excerpt recorded in `Artefacts and notes`.
- Conformance check:
  - Policy imports only `@shared/types/*` (enforced by a unit test that reads
    the files' import specifiers).
  - The two development dependencies are the approved ones.
  - No runtime behaviour change yet (policy is unused).
- Recovery: revert the milestone commits; dependencies are development-only.
- Remaining gaps: orchestration, adapters, sources.
- Compatibility decision: none.

### EP-M3: shared contract and registry extensions

- Outcome:
  - `shared/src/types/commands.ts` gains the contract types (see
    `Interfaces and dependencies`).
  - `CommandValidationErrorCode` gains `COMMAND_DISABLED`,
    `INVALID_WHEN_EXPRESSION`, and `COMMAND_EXECUTION_FAILED`.
  - `lib/command-registry-validation.ts` gains `validateResult`, and the
    registry exposes it.
  - The registry's handler type becomes `RendererCommandHandler` (request
    object). `registerCommandHandlers` wraps legacy `(event, dispatch)`
    handlers as
    `(request) => legacy(request.triggerEvent, request.dispatch)`.
  - `getRegisteredKeys()` synthesizes keymap host definitions (D-4).
  - `editor:search-close` declares the arguments schema
    `{type: 'object', properties: {uid: {type: 'string', minLength: 1}},
    additionalProperties: false}` and closes the given `uid`, or the active
    session when `uid` is absent.
  - `docs/adr-007-frontend-command-dispatcher-contract.md` is added with
    status `Accepted`.
- Requirements and gaps: `RM-4.1.1-A`, `TDD-DISP-API` (with D-3),
  `INV-KEYMAP-SYNC`.
- Acceptance evidence: new tests in
  `test/unit/command-registry-validation.test.ts` (result schema) and
  `test/unit/command-dispatch/keymap-definitions.property.test.ts` pass after
  failing first. The existing compatibility test proves legacy handlers still
  receive `(event, dispatch)`.
- Conformance check:
  - D-3 is recorded in ADR-007.
  - No IPC change: `getRuntimePluginCommands` and `getDecoratedKeymaps` are
    reused as they are.
  - `PLUGINS.md` contracts still hold.
- Recovery: revert the milestone commits.
- Remaining gaps: the dispatcher itself.
- Compatibility decision: legacy handler wrapping is kept for third-party
  Hyper plugins that call `terms.registerCommands` (`PLUGINS.md`).

### EP-M4: dispatcher service and driven adapters

- Outcome: `createCommandDispatcher(ports)` in
  `lib/command-dispatch/dispatcher.ts` implements the pipeline using the policy
  modules. The driven adapters live in `lib/command-dispatch/adapters/`:
  - `registry-catalogue.ts` adapts the registry to the `CommandCatalogue`
    port.
  - `context-key-enablement.ts` maps a thrown `WhenExpressionSyntaxError` to
    a failing verdict.
  - `redux-execution-gate.ts` dispatches `UI_COMMAND_EXEC` with an effect.
  - `host-command-channel.ts` wraps `transport.emit('command', id)`.

  `tsconfig.typecheck.json` includes `./test/unit/command-dispatch/`.
- Requirements and gaps: `RM-4.1.1-A`, `RM-4.1.1-B`, `TDD-DISP-PATH`,
  `TDD-CANCEL`; obligations `INV-VALIDATE-BEFORE-EXEC`, `INV-SYNC`,
  `INV-NO-LEAK`, and the dispatcher half of `INV-SETTLE-ONCE`.
- Acceptance evidence: `dispatcher.test.ts`, `validation.property.test.ts`,
  and `cancellation.property.test.ts` pass after failing first.
  `make typecheck` passes with the test directory included.
- Conformance check:
  - The dispatcher depends only on ports and policy (an import test, as in
    EP-M2).
  - No timer or clock use (the import test bans `setTimeout`, `Date`, and
    `performance` identifiers in `dispatcher.ts`).
  - The result union matches ADR-007.
- Recovery: revert the milestone commits; nothing calls the dispatcher yet.
- Remaining gaps: sources still use the old path.
- Compatibility decision: none.

### EP-M5: driving adapters and composition

- Outcome:
  - `lib/command-dispatch/inbound/keybinding.ts` exports
    `createKeybindingInvoker(dispatcher)`. `lib/containers/hyper.tsx` uses it
    in place of `props.execCommand`. The adapter keeps setting
    `event.catched` and applying `shouldPreventDefault`.
  - `lib/command-dispatch/inbound/react.tsx` exports
    `CommandDispatcherProvider` and `useCommandInvoker()`; the hook fixes
    `source: 'ui'`.
  - `lib/command-dispatch/inbound/plugin-api.ts` exports
    `createPluginCommandApi(dispatcher)`, which fixes `source: 'plugin'`.
    `lib/components/terms.tsx` exposes it as `this.invokeCommand`, beside
    `this.registerCommands`.
  - The search box close button in `lib/components/term.tsx` invokes
    `editor:search-close` with `{uid}`.
  - `lib/bootstrap/command-dispatch-bootstrap.ts` composes the registry,
    a renderer context-key service, the store, and the transport into one
    dispatcher. `startRendererApplication` passes it to `mountApp`, which
    wraps the tree in `CommandDispatcherProvider`.
  - `lib/actions/ui.ts#execCommand` and `HyperProps.execCommand`
    (`typings/hyper.d.ts`) are deleted, and every caller and test is updated
    in the same commit.
- Requirements and gaps: `RM-4.1.1-SC`, `PRD-DISP-SINGLE`, `TDD-PRINC-CMD`;
  obligation `INV-SAME-PATH`.
- Acceptance evidence: `convergence.test.ts` passes after failing first; the
  updated `test/unit/hyper-effects.test.ts` and
  `test/unit/hyper-transport.test.ts` pass; a component test renders the search
  box under the provider and observes `editor:search-close` with the session
  `uid` in the recorded `UI_COMMAND_EXEC` action.
- Conformance check:
  - No source executes a command outside `dispatcher.invoke` (verified with
    `codegraph_get_callers` on `getCommandHandler` and with a ripgrep for
    `emit('command'`, which must match only `host-command-channel.ts`).
  - `PLUGINS.md` contracts hold.
  - `lib/components/term.tsx` and `lib/bootstrap/renderer-bootstrap.ts` grow
    by at most 15 lines each.
- Recovery: revert the milestone commits; EP-M4 remains a coherent plateau.
- Remaining gaps: the E2E scenario and documentation.
- Compatibility decision: none. The deleted `execCommand` thunk and prop are
  application-internal.

### EP-M6: end-to-end scenario

- Outcome: `test/e2e-deep/command-dispatch.e2e.ts` launches the packaged app.
  It presses the search shortcut and asserts the search box is visible, then
  clicks the close button and asserts it is gone. Throughout, it asserts that no
  `[e2e][renderer-error]` line appeared. If Stage A found the golden-path
  plugin enabled in the E2E environment, the scenario also presses its
  keybinding and asserts the notification text.
- Requirements and gaps: `RM-4.1.1-SC` at system level.
- Acceptance evidence: `bun run test:e2e:deep` passes locally (run headless
  as described in `Concrete steps`) and in the `e2e-deep-linux` CI job.
- Conformance check: the scenario uses only existing helpers in
  `test/e2e/electron-e2e-helpers.ts`.
- Recovery: delete the scenario file; no production code depends on it.
- Remaining gaps: documentation.
- Compatibility decision: none.

### EP-M7: documentation and roadmap closure

- Outcome:
  - `docs/velocetty-design.md` §Command registry and dispatcher describes
    the implemented pipeline and references ADR-007.
  - New component architecture document
    `docs/command-dispatch-architecture.md` describes the ports, adapters,
    policy modules, and composition root, and is linked from the design
    document.
  - `docs/developers-guide.md` gains a "Command dispatcher practice" section
    after "Command registry practice" (how to add a command, write a
    cancellable handler, and invoke a command from UI code; testing rules),
    plus a "Proofs" note under "Tests" covering `make proofs`.
  - New `docs/users-guide.md` contains a "Commands and keybindings" section:
    shortcuts, the search close button, and plugins all run commands;
    disabled or invalid invocations do nothing and are reported in the
    developer console.
  - `PLUGINS.md` documents `this.terms.invokeCommand(id, args, {signal})` and
    the result union.
  - `docs/roadmap.md` marks 4.1.1 and its sub-items done.
- Requirements and gaps: documentation duties from the task brief.
- Acceptance evidence: `bunx markdownlint-cli2` on the changed files,
  `nixie --no-sandbox`, `make spelling`, and `make check-fmt` all pass.
- Conformance check: every decision in `Decision log` is reflected in ADR-007
  or the design document; every trace link resolves to an existing test.
- Recovery: documentation-only commits; revert individually.
- Remaining gaps: none for 4.1.1. Handed on: a host command catalogue (4.1.2
  and 4.3.2), backend cancellation tokens (4.1.2), and populating context keys
  (4.2.1).
- Compatibility decision: none.

## Concrete steps

Run every command from the worktree root,
`/home/leynos/.lody/repos/github---leynos---velocetty/worktrees/34485024-af9a-46ed-9032-8348722ff933`.
Capture output with `tee` so truncation does not hide failures:

```bash
set -o pipefail
BRANCH=$(git branch --show-current)
bun install 2>&1 | tee "/tmp/install-velocetty-${BRANCH}.out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-velocetty-${BRANCH}.out"
make typecheck 2>&1 | tee "/tmp/typecheck-velocetty-${BRANCH}.out"
make lint 2>&1 | tee "/tmp/lint-velocetty-${BRANCH}.out"
make test 2>&1 | tee "/tmp/test-velocetty-${BRANCH}.out"
```

Run the gates sequentially, never in parallel, so they share build caches
safely. Expect `make test` to end with a summary such as:

```plaintext
 NNNN pass
 0 fail
```

Focused red and green runs during a milestone, for example:

```bash
bun test --isolate test/unit/command-dispatch/admission.test.ts
```

The proof gate, from EP-M2 onwards:

```bash
make proofs 2>&1 | tee "/tmp/proofs-velocetty-${BRANCH}.out"
```

Expected tail:

```plaintext
Dafny program verifier finished with N verified, 0 errors
```

The deep E2E lane on this host, following the headless recipe (the
`--ozone-platform=headless` flag bypasses the missing X server):

```bash
bun run test:e2e:prepare
bun bin/rebuild-node-pty.mjs
bun run test:e2e:deep 2>&1 | tee "/tmp/e2e-deep-velocetty-${BRANCH}.out"
```

If the Playwright launcher cannot start without a display, set the launch
arguments in the scenario to include `--ozone-platform=headless` only when
`process.env.CI` is unset, and record the choice in `Decision log`.

Documentation gates for EP-M7:

```bash
bunx markdownlint-cli2 docs/execplans/4-1-1-implement-frontend-command-dispatcher.md \
  docs/adr-007-frontend-command-dispatcher-contract.md docs/command-dispatch-architecture.md \
  docs/developers-guide.md docs/users-guide.md docs/velocetty-design.md docs/roadmap.md PLUGINS.md
nixie --no-sandbox
make spelling
```

Commit after each green step with a descriptive message, and gate every commit
with the four make targets (plus `make proofs` from EP-M2).

## Validation and acceptance

Behavioural acceptance:

- Pressing a built-in shortcut (for example new tab) still opens a tab. The
  convergence test shows the action travelled through `dispatcher.invoke` with
  `source: 'keybinding'`.
- Pressing a shortcut whose plugin handler calls `event.preventDefault()`
  still prevents the browser default (`INV-SYNC`).
- Clicking the search box close button closes that session's search box
  (E2E scenario and component test).
- `terms.invokeCommand('editor:search-close', {uid: 42})` resolves to
  `{status: 'error', error: {code: 'INVALID_COMMAND_ARGS', ...}}`, and the
  handler is not called.
- Invoking any command with an already-aborted signal resolves to
  `{status: 'cancelled', stage: 'before-execution'}` and dispatches no action.
- Aborting while a renderer handler awaits resolves at once to
  `{status: 'cancelled', stage: 'during-execution'}`, and the handler observes
  `request.signal.aborted === true`.

Red-Green-Refactor evidence, recorded per milestone in `Artefacts and notes`:

- Red: the focused `bun test --isolate <file>` run fails with a missing export
  or assertion failure naming the obligation, before the production change. For
  proofs, the red state is an `lsc check` run with the `ensures` clauses
  present and a stub body, showing the open postcondition.
- Green: the same focused command passes after the minimal change.
- Refactor: the focused command, then all four make targets, pass.

Quality criteria:

- Tests: `make test` passes with every new suite included.
- Verification: `make proofs` passes, and every property in the
  `Verification plan` passes with its classification requirements met.
- Lint and type checking: `make lint` and `make typecheck` pass with no new
  suppressions; any `@ts-expect-error` must carry a reason and is discouraged.
- Formatting: `make check-fmt` passes.
- Performance: synchronous admission (`INV-SYNC`) is the performance
  requirement; no benchmark is planned.
- Security: no new IPC surface; plugin-sourced invocations cannot claim
  another source, because the facade fixes `source: 'plugin'`.

## Idempotence and recovery

Every step is re-runnable. `bun install` and `make proofs` are idempotent.
`lsc regen` performs a three-way merge, so it is safe to rerun after editing
annotated TypeScript; never delete a `.dfy` file to start again. Each milestone
ends on a committed, green plateau, so `git revert` of that milestone's commits
returns to the previous plateau. Use temporary work in progress (WIP) commits
rather than `git stash`, because the stash is shared with other worktrees.

## Artefacts and notes

Expected logs:

```plaintext
/tmp/install-velocetty-4-1-1-implement-frontend-command-dispatcher.out
/tmp/check-fmt-velocetty-4-1-1-implement-frontend-command-dispatcher.out
/tmp/typecheck-velocetty-4-1-1-implement-frontend-command-dispatcher.out
/tmp/lint-velocetty-4-1-1-implement-frontend-command-dispatcher.out
/tmp/test-velocetty-4-1-1-implement-frontend-command-dispatcher.out
/tmp/proofs-velocetty-4-1-1-implement-frontend-command-dispatcher.out
/tmp/e2e-deep-velocetty-4-1-1-implement-frontend-command-dispatcher.out
```

Seeded-fault transcripts and red-stage excerpts are appended here during
implementation.

## Interfaces and dependencies

Add to `shared/src/types/commands.ts`:

```ts
export type CommandInvocationSource = 'keybinding' | 'palette' | 'menu' | 'ui' | 'plugin' | 'remote';

export interface CommandInvocation<TArgs = JsonValue> {
  readonly id: CommandId;
  readonly args?: TArgs;
  readonly source: CommandInvocationSource;
}

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

export type CommandCancellationStage = 'before-execution' | 'during-execution';

export type CommandResult<TResult = JsonValue> =
  | {readonly status: 'ok'; readonly value: TResult | undefined}
  | {readonly status: 'error'; readonly error: CommandInvocationError}
  | {readonly status: 'cancelled'; readonly stage: CommandCancellationStage};

export interface CommandDispatchOptions {
  readonly signal?: AbortSignal;
}

export interface CommandDispatcher<TOptions extends CommandDispatchOptions = CommandDispatchOptions> {
  invoke<TArgs = JsonValue, TResult = JsonValue>(
    invocation: CommandInvocation<TArgs>,
    options?: TOptions
  ): Promise<CommandResult<TResult>>;
}
```

`CommandValidationErrorCode` keeps its four existing members. The new codes
appear only in `CommandInvocationErrorCode`, so registry validation results are
unchanged.

Add to `lib/command-dispatch/types.ts` (renderer only):

```ts
export interface RendererDispatchOptions extends CommandDispatchOptions {
  /** The DOM event that triggered the invocation, passed to legacy handlers. */
  readonly triggerEvent?: Event;
}

export interface RendererCommandRequest<TArgs = JsonValue> {
  readonly invocation: CommandInvocation<TArgs>;
  readonly signal: AbortSignal;
  readonly dispatch: HyperDispatch;
  readonly triggerEvent: Event | undefined;
}

export type RendererCommandHandler<TArgs = JsonValue, TResult = JsonValue> = (
  request: RendererCommandRequest<TArgs>
) => TResult | undefined | Promise<TResult | undefined>;

export type RendererCommandDispatcher = CommandDispatcher<RendererDispatchOptions>;
```

`signal` is always present in the request. When the caller passes none, the
dispatcher supplies a signal that never aborts, so handlers need no `undefined`
checks.

Ports, in `lib/command-dispatch/ports.ts`:

```ts
export interface CommandCatalogue {
  get(id: CommandId): CommandDefinition | undefined;
  getHandler(id: CommandId): RendererCommandHandler | undefined;
  validateArgs(id: CommandId, args: JsonValue | undefined): CommandValidationResult;
  validateResult(id: CommandId, value: JsonValue | undefined): CommandValidationResult;
}

export interface EnablementEvaluator {
  evaluate(expression: string): EnablementVerdict;
}

export type EnablementVerdict =
  | {readonly kind: 'enabled'}
  | {readonly kind: 'disabled'}
  | {readonly kind: 'invalid'; readonly message: string};

export interface ExecutionGate {
  /** Calls `run` when the `UI_COMMAND_EXEC` effect executes; reports whether it ran synchronously. */
  admit(invocation: CommandInvocation, run: () => void): GateOutcome; // 'ran' | 'deferred'
}

export interface HostCommandChannel {
  emit(id: CommandId): void;
}

export interface DispatcherLogger {
  debug(message: string, details: JsonObject): void;
  warn(message: string, details: JsonObject): void;
}
```

Factory, in `lib/command-dispatch/dispatcher.ts`:

```ts
export interface CommandDispatcherPorts {
  readonly catalogue: CommandCatalogue;
  readonly enablement: EnablementEvaluator;
  readonly gate: ExecutionGate;
  readonly host: HostCommandChannel;
  readonly dispatch: HyperDispatch;
  readonly logger: DispatcherLogger;
}

export const createCommandDispatcher = (ports: CommandDispatcherPorts): RendererCommandDispatcher => { /* ... */ };
```

Policy, in `lib/command-dispatch/policy/admission.ts` and `settlement.ts`:

```ts
export type GateVerdict = {readonly kind: 'pass'} | {readonly kind: 'fail'; readonly code: CommandInvocationErrorCode};
export type AdmissionDecision =
  | {readonly kind: 'admit'}
  | {readonly kind: 'reject'; readonly index: number; readonly code: CommandInvocationErrorCode};
export function admitInvocation(verdicts: readonly GateVerdict[]): AdmissionDecision;

export type SettlementEvent =
  | {readonly kind: 'effectRan'}
  | {readonly kind: 'handlerFulfilled'}
  | {readonly kind: 'handlerRejected'; readonly isAbortReason: boolean}
  | {readonly kind: 'aborted'};
export type SettlementState =
  | {readonly kind: 'awaitingGate'}
  | {readonly kind: 'executing'}
  | {readonly kind: 'settled'; readonly outcome: 'ok' | 'failed' | 'cancelledBefore' | 'cancelledDuring'};
export function applySettlementEvent(state: SettlementState, event: SettlementEvent): SettlementState;
export function settle(events: readonly SettlementEvent[]): SettlementState;
```

Dependencies: `fast-check@^4.10.2` and `lemmascript@0.6.5` (development). Dafny
4.11 is a host tool, installed in CI by `.github/workflows/proofs.yml` from a
pinned release archive. No runtime dependency is added.

## Revision note

- 2026-10-29: initial draft, before the expert-panel review.
