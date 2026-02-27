# Roadmap: Velocetty implementation

This roadmap translates the product requirements and technical design into
phased, measurable delivery tasks. It is intentionally implementation-focused
and uses the command system, JSON5 configuration, and plugin model as the
backbone for all subsequent work.

Scope notes:

- This roadmap is a planning tool, not a schedule; it contains no timeframes.
- Tasks are sized to be deliverable in weeks, not quarters.
- Dependencies are called out explicitly using dotted notation.
- Each task references the design or PRD section it implements.

## 1. Core scaffolding and shared contracts

### 1.1. Repository split and build foundations

- [x] 1.1.1. Establish `frontend/`, `backend/`, and `shared/` package
  boundaries. See [velocetty-design.md](velocetty-design.md) §Repository layout
  and module boundaries.
  - [x] Define TypeScript path aliases and build outputs for each package.
  - [x] Move shared types, schemas, and constants into `shared/`.
  - [x] Success criteria: each package builds in isolation; cross-package
    imports are one-directional (`frontend` → `shared`, `backend` → `shared`).
- [x] 1.1.2. Introduce a transport abstraction with an Electron IPC adapter.
  See [velocetty-design.md](velocetty-design.md) §Host migration: Electron to
  Tauri.
  - [x] Define a transport interface for command invocation and event streams.
  - [x] Implement Electron IPC adapter using existing RPC wiring.
  - [x] Success criteria: command invocation works end-to-end via the adapter
    without direct Electron calls inside the command layer.
  - [x] Outstanding concerns (deferred follow-ups):
    - [x] Remove remaining `window.rpc`-based UI event subscriptions in
      renderer surfaces (`lib/containers/hyper.tsx`,
      `lib/components/term.tsx`) and migrate them behind transport
      abstractions once a host-agnostic facade is agreed. See
      [velocetty-design.md](velocetty-design.md) §Host migration:
      Electron to Tauri.
    - [x] Replace direct `lib/transport/electron-ipc-transport.ts`
      imports with a barrel module (`lib/transport/index.ts`) so the
      host backend can be swapped at a single composition boundary. See
      [velocetty-design.md](velocetty-design.md) §Host migration:
      Electron to Tauri.
    - [x] Add end-to-end bootstrap regression coverage for
      high-frequency streams and continue using transport-path
      assertions beyond this milestone. See
      [velocetty-design.md](velocetty-design.md) §Testing.

### 1.2. Command primitives and context key engine

- [x] 1.2.1. Implement shared command definition types and registry APIs. See
  [velocetty-design.md](velocetty-design.md) §Command system design.
  - [x] Define `CommandDefinition`, metadata, and optional arg/result schemas.
  - [x] Implement registry CRUD with deterministic ordering.
  - [x] Success criteria: registry can enumerate commands, and arg schema
    validation returns structured errors for invalid input.
- [x] 1.2.2. Implement the context key service and `when` parser/evaluator. See
  [velocetty-design.md](velocetty-design.md) §Context keys and “when”
  expressions.
  - [x] Implement AST parsing for logical operators, comparisons, and grouping.
  - [x] Provide evaluation against a key/value map with explicit types.
  - [x] Success criteria: unit tests cover all operators and precedence, and
    evaluation is deterministic across runs.

### 1.3. Golden path example plugin

- [x] 1.3.1. Ship a golden path plugin demonstrating commands, settings, and
  tab decorations. See [velocetty-design.md](velocetty-design.md) §Plugin
  runtime and §Tab decoration API; see
  [PRD](velocetty-product-requirements-document.md) §Workstreams and
  deliverables.
  - [x] Plugin manifest created with settings schema and sensible defaults.
  - [x] Command and keybinding registered and working in the plugin runtime.
  - [x] Tab decoration provider registered producing deterministic decorations.
  - [x] Success criteria: plugin can be enabled/disabled, settings persist to
    JSON5, and decoration updates are event-driven.
  - [x] Integrator gate: passed on the integration branch — `bun install`,
    `make build`, `make check-fmt`, `make lint`, and `make test` all
    succeeded.

### 1.4. Quality gates and supply-chain hygiene

- [x] 1.4.1. Lint succeeds with recommended settings enabled.
- [x] 1.4.2. `bun audit` reports no critical, high, or medium vulnerabilities.
- [ ] 1.4.3. Continuous Integration (CI) dependencies are pinned to SHAs.
- [x] 1.4.4. Fully remove dependencies on Yarn and AVA, including in CI.
- [ ] 1.4.5. Replace Husky with `git-hooks` for repository hook management.
- [x] 1.4.6. Adopt `tsgo` for TypeScript compilation and type checking.
- [x] 1.4.7. Publish the migration plan for replacing Webpack/Babel with
  esbuild (see ADR-002 and
  `docs/execplans/replace-webpack-babel-with-esbuild.md`).
- [ ] 1.4.8. Re-enable Biome rules currently disabled for legacy code:
  `noExplicitAny`, `noNonNullAssertion`, `useNodejsImportProtocol`,
  `useExhaustiveDependencies`, and the accessibility (a11y) rule set. Track
  each rule's enablement date in `docs/velocetty-hyper-codebase.md`. Tracking
  issue: BIOME-001 in `docs/tracking-issues.md`.
- [x] 1.4.9. Migrate to React 18.3 (see adr-003)
- [x] 1.4.10. Migrate to React 19.x (see adr-003)
- [x] 1.4.11. Migrate to Electron 28 (see adr-004)
- [x] 1.4.12. Migrate to Electron 34 (see adr-004)
- [x] 1.4.13. Migrate to Electron 40 (see adr-004). See
  [velocetty-design.md](velocetty-design.md) §Host migration: Electron to
  Tauri and
  [adr-004-update-electron-40.md](adr-004-update-electron-40.md)
  §Phase 3: Electron 40 validation.
  - [x] Align runtime anchors (`electron`, `electron-mksnapshot`,
    `@types/node`, rebuild target, and CI Node baseline).
  - [x] Success criteria: `bun install`, `make build`, `make check-fmt`,
    `make lint`, and `make test` pass.
- [x] 1.4.14. Execute the Webpack/Babel-to-esbuild migration plan from
  ADR-002 and remove legacy bundler dependencies from scripts and manifests.
  - [x] Switch default bundling scripts (`dev`, `build`, `build:hyper-app`) to
    the esbuild build entrypoint.
  - [x] Add migration contract tests for translation outcomes, packaging
    outcomes, and bespoke plugin validation.
  - [x] Rewrite snapshot bootstrap loading to remove Webpack-specific globals.
  - [x] Success criteria: `bun install`, `make build`, `make check-fmt`,
    `make lint`, and `make test` pass after cut-over.
- [x] 1.4.15. Restore cross-architecture CI reliability for host platforms.
  See [adr-004-update-electron-40.md](adr-004-update-electron-40.md) §Phase 3:
  Electron 40 validation and [developers-guide.md](developers-guide.md)
  §Electron runtime alignment.
  - [x] Retire armv7 CI lanes and release artefact targets, and replace required
    Linux ARM coverage with Linux aarch64.
  - [x] Resolve Linux aarch64 CI failures across install, build, lint, and test
    gates.
  - [x] Resolve macOS aarch64 CI failures across install, build, lint, and test
    gates.
  - [x] Stabilize Windows CI on x64 and add a Windows aarch64 lane if runner and
    toolchain support is available.
  - [x] If Windows aarch64 cannot be enabled, document the blocker and create a
    tracked follow-up item with explicit ownership. Tracking issue:
    `WINARM64-001` in `docs/tracking-issues.md`.
    Upstream blocker:
    [oven-sh/bun#9824](https://github.com/oven-sh/bun/issues/9824) (Bun on
    Windows aarch64).
  - [x] Success criteria: CI lanes are green for macOS aarch64, Linux aarch64,
    and Windows x64; armv7 lanes are removed; Windows aarch64 is either running
    in CI or explicitly tracked as blocked with a documented mitigation path.

## 2. Rendering overhaul

### 2.1. Visible-only rendering and WebGL context pool

- [x] 2.1.1. Implement pane visibility detection and a WebGL context pool. See
  [velocetty-design.md](velocetty-design.md) §Rendering: WebGL only for visible
  panes.
  - [x] Define a visibility model based on active tab, layout bounds, and
    occlusion.
  - [x] Allocate WebGL contexts only to visible panes with LRU eviction.
  - [x] Success criteria: hidden panes use Canvas, and WebGL usage never exceeds
    the configured maximum.
- [x] 2.1.2. Add context-loss recovery and fallbacks. See
  [velocetty-design.md](velocetty-design.md) §WebGL context pool.
  - [x] Detect context loss and immediately detach WebGL addons.
  - [x] Retry allocation when resources are freed.
  - [x] Success criteria: context loss does not crash the renderer and is
    observable via instrumentation.

### 2.2. Rendering instrumentation and performance baselines

- [x] 2.2.1. Add WebGL allocation and fallback metrics. See
  [velocetty-design.md](velocetty-design.md) §Observability.
  - [x] Record current and peak context counts.
  - [x] Record fallback events and reasons.
  - [x] Success criteria: metrics are visible in a developer diagnostics view or
    log output.
- [ ] 2.2.2. Add PTY output batching and frame timing metrics. See
  [velocetty-design.md](velocetty-design.md) §Render scheduling and
  §Observability.
  - [ ] Track input latency and long-frame counts.
  - [ ] Confirm batching thresholds mirror existing semantics.
  - [ ] Success criteria: benchmarks demonstrate stable frame times under
    synthetic load.

## 3. Configuration system: JSON5 and layering

### 3.1. JSON5 config loader and schema diagnostics

- [ ] 3.1.1. Implement JSON5 parsing with schema validation. See
  [velocetty-design.md](velocetty-design.md) §Configuration system: JSON5 and
  layering.
  - [ ] Parse `config.json5` and surface structured validation errors.
  - [ ] Provide defaults and schema-derived documentation strings.
  - [ ] Success criteria: invalid config reports path, message, and suggested
    fix.
- [ ] 3.1.2. Define layering rules and hot-reload semantics. See
  [velocetty-design.md](velocetty-design.md) §Layering rules.
  - [ ] Implement defaults → user config → runtime overrides.
  - [ ] Specify which changes require restart vs live reload.
  - [ ] Success criteria: live-reloadable settings apply without UI restart,
    and non-reloadable settings display clear warnings.

### 3.2. Keybindings and plugin settings storage

- [ ] 3.2.1. Store keybindings in `keybindings.json5`. See
  [velocetty-design.md](velocetty-design.md) §Configuration system: JSON5 and
  layering.
  - [ ] Provide read/write utilities with schema validation.
  - [ ] Support export/import in the same format.
  - [ ] Success criteria: keybinding edits persist and hot-reload cleanly.
- [ ] 3.2.2. Persist plugin settings under namespaced keys. See
  [velocetty-design.md](velocetty-design.md) §Plugin settings persistence.
  - [ ] Define namespace conventions per plugin ID.
  - [ ] Ensure default values are applied when missing.
  - [ ] Success criteria: plugin settings survive restart and remain isolated
    per plugin.

## 4. Command system, keybindings, and palette

### 4.1. Command dispatcher and execution paths

- [ ] 4.1.1. Implement the command dispatcher in the frontend. Requires 1.2.1.
  See [velocetty-design.md](velocetty-design.md) §Command registry and
  dispatcher.
  - [ ] Validate arguments against schemas before invocation.
  - [ ] Support cancellation via `AbortSignal`.
  - [ ] Success criteria: commands invoked from UI, keybindings, and plugins all
    follow the same path.
- [ ] 4.1.2. Implement backend command registry and permission checks. Requires
  1.1.2 and 1.2.1. See [velocetty-design.md](velocetty-design.md) §Command
  registry and dispatcher.
  - [ ] Validate args again server-side.
  - [ ] Return structured errors with codes and messages.
  - [ ] Success criteria: privileged commands are rejected without proper
    capability, and errors are surfaced in the UI.

### 4.2. Keybinding engine and editor UI

- [ ] 4.2.1. Implement keybinding parsing and resolution. Requires 1.2.2 and
  3.2.1. See [velocetty-design.md](velocetty-design.md) §Keybinding system
  design.
  - [ ] Support chords and platform-specific modifier mapping.
  - [ ] Implement deterministic precedence and conflict detection.
  - [ ] Success criteria: conflicts are surfaced with clear resolution hints.
- [ ] 4.2.2. Build the keybinding editor UI. Requires 4.2.1. See
  [velocetty-design.md](velocetty-design.md) §Keybinding editor UI.
  - [ ] Provide search, record, remove, and reset-to-default actions.
  - [ ] Enable export/import via JSON5.
  - [ ] Success criteria: edits flow through the command system and are
    immediately reflected in the active keymap.

### 4.3. Command palette and UI integration

- [ ] 4.3.1. Implement the command palette UI. Requires 4.1.1. See
  [velocetty-design.md](velocetty-design.md) §Command palette.
  - [ ] Provide fuzzy search and category grouping.
  - [ ] Display active keybindings and recent commands.
  - [ ] Success criteria: palette opens via command, lists commands, and invokes
    them with validation feedback.
- [ ] 4.3.2. Route menus and UI buttons through the dispatcher. Requires 4.1.1.
  See [velocetty-design.md](velocetty-design.md) §Menu and button integration.
  - [ ] Replace direct action calls with command invocations.
  - [ ] Audit existing menu entries for command coverage.
  - [ ] Success criteria: no UI action bypasses the dispatcher.

## 5. Settings tab and schema-driven plugin settings

### 5.1. Settings shell and core settings

- [ ] 5.1.1. Implement the settings tab shell and navigation. Requires 3.1.1.
  See [velocetty-design.md](velocetty-design.md) §Settings tab + schema-driven
  plugin settings and [PRD](velocetty-product-requirements-document.md)
  §Settings tab + plugin settings panels.
  - [ ] Add search, categories, and reset-to-default flows.
  - [ ] Surface validation errors inline.
  - [ ] Success criteria: core settings are editable and validated in the UI.
- [ ] 5.1.2. Expose settings commands. Requires 4.1.1. See
  [velocetty-design.md](velocetty-design.md) §Settings-driven commands.
  - [ ] Implement commands for opening settings, opening keybindings, and
    exporting configuration.
  - [ ] Success criteria: commands trigger the correct settings views without
    direct UI references.

### 5.2. Schema-driven plugin settings panels

- [ ] 5.2.1. Implement schema-to-UI rendering for plugin settings. Requires
  3.2.2. See [velocetty-design.md](velocetty-design.md) §Schema-driven plugin
  settings panels.
  - [ ] Support basic field types, validation, and defaults.
  - [ ] Provide a sectioned UI based on schema hints.
  - [ ] Success criteria: plugin panels render without custom UI code.
- [ ] 5.2.2. Implement trusted custom panels with an explicit trust model.
  Requires 5.2.1. See [velocetty-design.md](velocetty-design.md) §Optional
  custom settings panels.
  - [ ] Enforce trust checks and environment restrictions (local only).
  - [ ] Provide redacted UI state when in remote mode.
  - [ ] Success criteria: untrusted plugins cannot render custom panels.

## 6. Vertical tabs and tab decoration API

### 6.1. Vertical tabs and tab model

- [ ] 6.1.1. Implement the vertical tab rail and tab lifecycle. Requires 4.1.1.
  See [velocetty-design.md](velocetty-design.md) §Vertical tabs and tab
  decoration API.
  - [ ] Support pinning, grouping, and drag-and-drop reorder.
  - [ ] Add keyboard navigation commands for tab movement and focus.
  - [ ] Success criteria: tab state survives restart and reflects recent
    activity.

### 6.2. Tab decoration providers and merge rules

- [ ] 6.2.1. Implement slot-based tab decoration providers. Requires 1.2.2 and
  6.1.1. See [velocetty-design.md](velocetty-design.md) §Tab decoration API:
  slots and providers.
  - [ ] Define decoration context with redaction flags.
  - [ ] Evaluate providers by priority with deterministic merge rules.
  - [ ] Success criteria: multiple providers combine without UI conflicts or
    layout instability.
- [ ] 6.2.2. Provide user controls for provider precedence. Requires 6.2.1 and
  3.1.1. See [velocetty-design.md](velocetty-design.md) §User overrides.
  - [ ] Add settings for ordering and disabling providers.
  - [ ] Ensure changes take effect without restart.
  - [ ] Success criteria: precedence changes immediately alter tab decorations.

## 7. Host migration and backend abstraction

### 7.1. Backend abstraction layer

- [ ] 7.1.1. Define a backend service interface shared by Electron and Tauri.
  Requires 1.1.2. See [velocetty-design.md](velocetty-design.md) §Host
  migration: Electron to Tauri.
  - [ ] Map command execution, PTY operations, and config I/O to the interface.
  - [ ] Ensure structured error propagation to the frontend.
  - [ ] Success criteria: frontend does not import host-specific modules.

### 7.2. Tauri PTY and packaging

- [ ] 7.2.1. Implement Rust PTY manager and integrate with the command layer.
  Requires 7.1.1. See [velocetty-design.md](velocetty-design.md) §Target (Tauri)
  approach.
  - [ ] Match session semantics to the existing batcher model.
  - [ ] Support resize, close, and restart flows.
  - [ ] Success criteria: feature parity with the Electron PTY path.
- [ ] 7.2.2. Package the app with Tauri and update strategy. Requires 7.2.1. See
  [velocetty-design.md](velocetty-design.md) §Target (Tauri) approach.
  - [ ] Define update channels and signing requirements.
  - [ ] Ensure config and plugin paths remain stable.
  - [ ] Success criteria: builds install, run, and update on macOS, Linux, and
    Windows.

## 8. Remote frontend and protocol

### 8.1. Protobuf protocol and WebSocket transport

- [ ] 8.1.1. Define protobuf messages and versioning strategy. Requires 1.1.1.
  See [velocetty-design.md](velocetty-design.md) §Remote frontend:
  protobuf/WebSocket protocol.
  - [ ] Cover command invocation, PTY streams, and capability negotiation.
  - [ ] Define envelope framing and error semantics.
  - [ ] Success criteria: protocol version negotiation is explicit and
    backwards-compatible.
- [ ] 8.1.2. Implement backend WebSocket server with multiplexing. Requires
  8.1.1. See [velocetty-design.md](velocetty-design.md) §Protocol goals.
  - [ ] Support multiple sessions per connection.
  - [ ] Enforce message size limits and timeouts.
  - [ ] Success criteria: WebSocket transport handles PTY throughput without
    command latency regressions.

### 8.2. Authentication, authorisation, and redaction

- [ ] 8.2.1. Implement auth and capability negotiation. Requires 8.1.2. See
  [velocetty-design.md](velocetty-design.md) §Authentication and
  authorisation.
  - [ ] Issue and store local loopback tokens securely.
  - [ ] Bind capability sets to remote sessions.
  - [ ] Success criteria: unauthorised connections cannot invoke privileged
    commands.
- [ ] 8.2.2. Implement redaction of sensitive metadata. Requires 6.2.1 and
  8.2.1. See [velocetty-design.md](velocetty-design.md) §Redaction and sensitive
  metadata.
  - [ ] Mark redacted fields on the backend.
  - [ ] Ensure plugins and UI respect `redacted` flags.
  - [ ] Success criteria: remote UI never displays paths or hostnames without
    permission.

### 8.3. Remote browser UI

- [ ] 8.3.1. Implement a remote-capable frontend shell. Requires 8.1.2. See
  [velocetty-design.md](velocetty-design.md) §Remote frontend:
  protobuf/WebSocket protocol.
  - [ ] Connect to the backend via WebSocket and perform handshake.
  - [ ] Support command invocation and PTY rendering.
  - [ ] Success criteria: a browser client can open a terminal, run commands,
    and close sessions with parity to the local UI.

## 9. Testing and quality gates

### 9.1. Shared test coverage for core primitives

- [ ] 9.1.1. Add unit tests for the command system and `when` evaluator.
  Requires 1.2.1 and 1.2.2. See
  [velocetty-design.md](velocetty-design.md) §Testing.
  - [ ] Include parser edge cases and error handling.
  - [ ] Include precedence and conflict detection tests.
  - [ ] Success criteria: coverage for new shared modules meets the project
    threshold, and failures are actionable.

### 9.2. Integration and performance tests

- [ ] 9.2.1. Add end-to-end command invocation tests. Requires 4.1.1 and 4.1.2.
  See [velocetty-design.md](velocetty-design.md) §Testing.
  - [ ] Validate palette → dispatcher → backend flows.
  - [ ] Include cancellation behaviour for long-running commands.
  - [ ] Success criteria: test suite confirms command routing is consistent
    across UI surfaces.
- [ ] 9.2.2. Add rendering and WebGL stress tests. Requires 2.1.1. See
  [velocetty-design.md](velocetty-design.md) §Performance tests.
  - [ ] Simulate high tab/pane counts with visible-only allocation.
  - [ ] Validate fallback behaviour and recovery.
  - [ ] Success criteria: no crashes, and WebGL usage stays under the maximum.
- [x] 9.2.3. Implement Architecture Decision Record 005 (ADR-005) layered
  end-to-end (E2E) strategy (Option C). See
  [ADR 005](adr-005-enhance-e2e-testing-strategy.md).
  - [x] Keep fast-lane pull request checks in Bun with renderer readiness and
    critical console error assertions.
  - [x] Add a deep Playwright Test lane under Node.js with an interaction-path
    scenario (terminal input and rendered output).
  - [x] Run deep lane on schedule, manual trigger (`workflow_dispatch`), and
    pushes to `master` and `canary`.
  - [x] Retain deep-lane failure artefacts (stdout/stderr, renderer console,
    screenshots, and traces).

### 9.3. Unit-test isolation and concurrency safety

- [ ] 9.3.1. Eliminate cross-suite global state leakage in unit tests. Requires
  1.1.2 and 9.1.1. See [velocetty-design.md](velocetty-design.md) §Testing.
  - [x] Quarantine `test/unit/bootstrap-transport-integration.test.ts` behind
    `VELOCETTY_RUN_BOOTSTRAP_TRANSPORT_INTEGRATION=1` and execute it in a
    dedicated Bun process from `make test`.
  - [ ] Remove file-scope `mock.module(...)` blast radius in suites that mutate
    shared renderer/runtime globals (`window`, `document`, transport mocks).
  - [ ] Replace bootstrap module-mock wiring with explicit dependency injection
    so the dedicated-process quarantine can be removed.
  - [ ] Ensure each suite that calls `setupHappyDom()` performs deterministic
    teardown in the same file and restores module mocks after use.
  - [ ] Success criteria: repeated `bun test --randomize --seed <N>` runs are
    stable with no order-dependent failures across at least three seeds.
- [ ] 9.3.2. Restore parallel unit-test execution after isolation hardening.
  Requires 9.3.1. See [velocetty-design.md](velocetty-design.md) §Testing.
  - [ ] Remove serialized Bun execution guardrails from default lint/test gates.
  - [ ] Re-enable parallel execution in CI and local default test gates.
  - [ ] Success criteria: CI and local runs pass with default Bun concurrency
    and no test timeouts caused by cross-file interference.

## Out of scope for this roadmap

- Marketplace, payments, or plugin monetisation flows.
- Multi-user collaboration or shared terminal sessions.
- Persisting full terminal scrollback across restarts.
