# Tracking issues

## BIOME-001 Re-enable Biome legacy rules

Status: Open  
Owner: TBD  
Last updated: 2026-01-28  
Issue: [#24](https://github.com/leynos/velocetty/issues/24)

### BIOME-001 summary

- Re-enable Biome rules currently disabled for legacy code:
  `noExplicitAny`, `noNonNullAssertion`, `useNodejsImportProtocol`,
  `useExhaustiveDependencies`, and the accessibility (a11y) rule set.
- Record each rule's enablement date in
  `docs/velocetty-hyper-codebase.md`.

### BIOME-001 exit criteria

- All targeted rules are enabled with no new lint violations.
- Roadmap item 1.4.8 is complete.

## BOUNDARY-001 Parse CommonJS imports in package boundary checks

Status: Open  
Owner: TBD  
Last updated: 2026-02-12  
Issue: [#23](https://github.com/leynos/velocetty/issues/23)

### BOUNDARY-001 summary

- Extend `scripts/check-package-boundaries.mjs` to detect boundary violations in
  CommonJS `require(...)` usage as well as ECMAScript modules (ESM) `import`/
  `export` forms.
- Prefer Abstract Syntax Tree (AST)-based parsing over regex-only
  matching so alias, relative, dynamic, and CommonJS import forms are evaluated
  consistently.
- Add targeted unit tests for the checker to prevent regressions in import
  detection logic.

### BOUNDARY-001 exit criteria

- `bun run check:boundaries` fails on disallowed cross-layer imports using
  `require(...)`.
- Checker tests cover alias, relative, dynamic import, and CommonJS paths.
- `make lint` and `make test` remain green with the stronger guardrail.

## CONTRACT-001 Decouple schema generation from legacy typings source

Status: Open  
Owner: TBD  
Last updated: 2026-02-12  
Issue: [#22](https://github.com/leynos/velocetty/issues/22)

### CONTRACT-001 summary

- Move the schema generation source of truth to `shared/src/types/config.ts`
  and remove reliance on `typings/config.d.ts` as generator input.
- Keep `typings/` exports as compatibility shims only during migration.
- Preserve runtime compatibility by continuing to sync generated schema output
  to `app/config/schema.json` until downstream runtime consumers are migrated.

### CONTRACT-001 exit criteria

- `bun run generate-schema` reads source types from `shared/` directly.
- `typings/config.d.ts` is no longer part of schema generation inputs.
- Generated schema remains identical for runtime consumers and all gates pass.

## CONFIG-001 Support hot-reload for WebGL renderer setting

Status: Open  
Owner: TBD  
Last updated: 2026-03-27

### CONFIG-001 summary

- Remove the current requirement to restart terminal sessions after changing
  `webGLRenderer`.
- Apply renderer-setting changes to existing sessions without reopening tabs.
- Preserve fallback behaviour when WebGL contexts are unavailable.
- The reloadability registry in `shared/src/constants/config-reloadability.ts`
  currently classifies `webGLRenderer` as `restart`-required pending this work.

### CONFIG-001 exit criteria

- Changing `webGLRenderer` takes effect for active sessions without restart.
- Update `webGLRenderer` classification to `live` in the reloadability registry.
- Unit or integration tests cover hot-reload behaviour and fallback handling.
- `make lint` and `make test` remain green.

## CONFIG-002 Support workspace-level configuration overrides

Status: Open  
Owner: TBD  
Last updated: 2026-03-27

### CONFIG-002 summary

- Implement workspace-level configuration overrides (e.g.,
  `.velocetty/config.json5` in a project root).
- Extend the layering system to support: defaults → user → workspace → runtime.
- Define workspace discovery and resolution rules.
- Coordinate with reloadability semantics when workspace settings change.

### CONFIG-002 background

Deferred from roadmap item `3.1.2`. The layering infrastructure in
`app/config/layering.ts` supports workspace layers, but the workspace discovery
and resolution paths are not yet defined.

### CONFIG-002 exit criteria

- Workspace config files are discovered and loaded.
- Layering order is: defaults → user → workspace → runtime.
- Changes to workspace settings trigger appropriate reload/restart warnings.
- Documentation updated in `docs/developers-guide.md`.
- `make lint` and `make test` remain green.

## CONFIG-003 Align application and CLI configuration-tree inputs

Status: Open  
Owner: TBD  
Last updated: 2026-10-30

### CONFIG-003 summary

- The configuration-tree rules are shared between the application
  (`app/config/config-tree.ts`) and the CLI
  (`shared/src/config/config-tree.ts`), and a parity test covers the pure
  function. The inputs they are given still differ.
- The CLI derives the legacy Hyper tree as `<appData>/Hyper` by string join,
  whereas the application passes Electron's `userData` path.
- The CLI compares candidate trees with string equality, because its narrow
  filesystem slice cannot call `realpath`. The application can, so a symlinked
  dotfiles configuration can resolve differently.
- The CLI treats any `NODE_ENV` other than `production` as development mode,
  whereas the application uses `electron-is-dev`.
- The CLI's filesystem probe is two-state (`present` or `absent`), so a dangling
  symlink looks absent. The application's probe is three-state and reports a
  broken link as present, so an intentionally dangling managed file is not
  silently shadowed.
- Recorded as a known risk in
  [ADR 008](adr-008-velocetty-configuration-directory.md).

### CONFIG-003 exit criteria

- The CLI receives `realpath`-capable comparison, or both sides document why
  string equality is sufficient.
- Broken-link handling is either shared or explicitly documented as an
  application-only guarantee.
- Development-mode detection has a single definition used by both sides.
- Tests cover a symlinked tree and a dangling symlink on both sides.

## CONFIG-004 Rename the Electron `userData` directory away from `Hyper`

Status: Open  
Owner: TBD  
Last updated: 2026-10-30

### CONFIG-004 summary

- Velocetty now reads and writes configuration under a Velocetty-named tree, but
  `app/package.json` still sets `"productName": "Hyper"`, so Electron and
  `electron-store` continue to use `<appData>/Hyper` as `userData`.
- That directory holds application state, not configuration: window layout,
  `Preferences`, caches, and the `config.json` that `electron-store` writes.
  Roadmap item `3.2.1` deliberately left it alone.
- On Linux the Hyper tree and `userData` are the same directory, so the two
  concepts are easy to confuse in support discussions.
- Changing `productName` renames the directory and would strand existing
  application state unless a migration is written.

### CONFIG-004 exit criteria

- `productName` names Velocetty, and `userData` resolves to a Velocetty-named
  directory on every platform.
- A one-time migration moves or imports existing application state without
  losing window layout or preferences.
- The users' guide and
  [ADR 008](adr-008-velocetty-configuration-directory.md) are updated.

## KEYMAP-001 Align plugin keybinding precedence with the design

Status: Open  
Owner: TBD  
Last updated: 2026-10-30

### KEYMAP-001 summary

- The design orders keybinding precedence as user bindings, then
  plugin-contributed defaults, then core defaults (`docs/velocetty-design.md`,
  §Resolution and precedence).
- The implementation differs in two ways. `mergeRuntimePluginKeybindings`
  spreads runtime plugin keybindings first and the resolved keymaps second
  (`app/runtime/plugin-runtime.ts`), so core defaults beat plugin defaults.
  Legacy `decorateKeymaps` hooks then run after user overrides
  (`app/plugins.ts`), so a plugin can change or remove a user's binding.
- [ADR 007](adr-007-keybindings-json5-storage.md) records this as a known
  limitation. Roadmap item `4.2.1` owns the full precedence rules.
- Users are told about the `decorateKeymaps` effect in the
  [users' guide](users-guide.md).

### KEYMAP-001 exit criteria

- Plugin defaults outrank core defaults, and user bindings outrank both.
- `when`-scoped resolution and conflict detection follow the design.
- An end-to-end or integration test pins the precedence order.
- The limitation is removed from ADR 007 and the users' guide.

## KEYMAP-002 Classify the `keymaps` key for reloadability

Status: Open  
Owner: TBD  
Last updated: 2026-10-30

### KEYMAP-002 summary

- `getKeyScope` in `app/config/reloadability-registry.ts` and in
  `shared/src/constants/config-reloadability.ts` recognizes a keymap key through
  `KEYMAP_KEYS = new Set(['keymap'])`.
- The configuration key is `keymaps`, plural. A `keymaps` change in
  `config.json5` is therefore classified as `profile` scope rather than
  `keymap` scope, and falls back to the fail-safe `restart` classification.
- Today keybindings live in `keybindings.json5`, which has its own watcher and
  reload path, so the mismatch has no user-visible effect. It would matter to
  the legacy `keymaps` key and to any future consumer of the scope helper.
- Both copies are mirrored, so a fix must change both and keep the parity test
  green.

### KEYMAP-002 exit criteria

- The keymap key set matches the configuration key, in both copies.
- A unit test asserts the scope of `keymaps` and of an unknown profile key.
- `docs/developers-guide.md` describes the scope helper without the mismatch.

## WINARM64-001 Track Windows aarch64 CI enablement after Bun support lands

Status: Open  
Owner: @leynos  
Last updated: 2026-02-25  
Issue: [#35](https://github.com/leynos/velocetty/issues/35)

### WINARM64-001 summary

- Roadmap item `1.4.15` currently uses the blocker path for Windows aarch64
  because Bun does not publish a Windows arm64 runtime artefact.
- Evidence captured on 2026-02-25 from the latest Bun release
  (`bun-v1.3.9`, published 2026-02-08): assets include `bun-windows-x64*` and
  no Windows arm64 asset.
- Mitigation: keep Windows x64 CI as the required host-platform lane and
  re-evaluate Windows aarch64 lane enablement on each Bun release.

### WINARM64-001 exit criteria

- Latest Bun release publishes a Windows arm64 asset suitable for
  `oven-sh/setup-bun` installation.
- A Windows aarch64 CI lane is enabled and green for install, build, lint, and
  test gates, or a replacement upstream-supported installation path is
  documented.
- `docs/developers-guide.md` and roadmap item `1.4.15` are updated to reflect
  the unblocked state.
