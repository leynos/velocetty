# Store keybindings in `keybindings.json5` (roadmap 3.2.1)

## Module header

- Purpose: an implementation-ready plan for roadmap item `3.2.1`. It revises
  an earlier delivery, now rebased onto `main`, so that user keybindings live in
  `keybindings.json5`. That means validated read and write utilities,
  same-format export and import, and hot reload that never silently loses a
  user's working shortcuts.
- Invariants:
  - Active user keybindings always equal the most recently accepted
    `keybindings.json5` state, or no overrides.
  - A failed parse never replaces working keybindings.
  - The file is created only at start-up, never during a reload.
  - Legacy `config.json5.keymaps` migrate only from a successfully parsed
    `config.json5`, and only when they validate.
  - Keybinding code never writes the user's `config.json5`. Runtime-plugin
    default persistence (`app/runtime/plugin-runtime.ts`) is existing,
    separate behaviour.
  - New configuration files are created only in the Velocetty configuration
    tree. The legacy Hyper tree is still read for an existing `config.json5`,
    but never receives a new configuration file.
- Cross-links:
  - `docs/roadmap.md` (§3.2 and the dependent items `4.2.1`, `4.2.2`,
    `5.1.2`).
  - `docs/velocetty-design.md` (§Keybinding system design, §Configuration
    system: JSON5 and layering).
  - `docs/velocetty-product-requirements-document.md` (§3, command system and
    keybinding management).
  - `docs/adr-007-keybindings-json5-storage.md` (this item's architectural
    decision record (ADR), status Proposed) and
    `docs/adr-008-velocetty-configuration-directory.md` (the configuration
    tree, status Proposed).
  - `docs/developers-guide.md` (§Configuration format practice,
    §Configuration layering and reloadability practice, §Tests).
  - `docs/velocetty-hyper-codebase.md`, `docs/tracking-issues.md`,
    `docs/adr-001-replace-ava-with-bun-test.md`,
    `docs/adr-005-enhance-e2e-testing-strategy.md`, and
    `docs/documentation-style-guide.md`.
  - Code: `app/config.ts`, `app/config/import.ts`, `app/config/keybindings.ts`,
    `app/config/paths.ts`, `app/config/init.ts`, `app/utils/map-keys.ts`,
    `app/config/json5-config.ts`, `app/plugins.ts`,
    `app/runtime/plugin-runtime.ts`, and `cli/api.ts` (the CLI's own config
    path resolver).
- Skills signposts:
  - `execplans` for this format.
  - `hexagonal-architecture` for the policy, port, and adapter split.
  - `typescript-router`, then `typescript-boundaries-and-validation`,
    `typescript-errors-and-outcomes`, and `typescript-data-and-state` for the
    codec and the outcome unions.
  - `typescript-testing` (bun:test), `fast-check`, and `lemmascript` for
    verification.
  - `node-bun-and-processes` (file-system adapter) and `electron-and-ipc`
    (watcher and end-to-end lane).
  - `codegraph-mcp` and `leta` for navigation.
  - `document`, `tutorial-howto-doc` (users' guide), and `en-gb-oxendict-style`
    for documentation.
  - `commit-message` for commits.

This execution plan (ExecPlan) is a living document. The sections `Constraints`,
`Tolerances (exception triggers)`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, `Outcomes & retrospective`,
`Conformance basis`, and `Verification plan` must be kept up to date as work
proceeds.

Status: APPROVED

This revised plan was explicitly approved by a human on 2026-10-29.
Implementation began after that approval. The approval questions below were
answered on 2026-10-29. The same answer added the Velocetty configuration tree
requirement, which this revision incorporates.

## Approval questions

The approver accepted all three recommendations on 2026-10-29: question 1
option A, question 2 as written, and question 3 option A. The options are kept
here for the record.

1. User-facing export and import. The roadmap asks for export and import "in
   the same format". The roadmap already places user-facing export and import
   in the keybinding editor (`4.2.2`, "Enable export/import via JSON5") and
   settings commands (`5.1.2`, "exporting configuration").
   - Option A (recommended): deliver main-process utilities only. When ticking
     the roadmap, reword the sub-bullet to "Provide export/import utilities in
     the storage format (user-facing entry points: 4.2.2, 5.1.2)."
   - Option B: also add a `keybindings.export` and `keybindings.import`
     command pair with native file dialogs. That is about four more files and
     one more end-to-end scenario.
   - Option C: also add only an "Open Keybindings File" menu entry, reusing
     `app/config/open.ts`. Today nothing in the user interface (UI) opens the
     file, and `window:preferences` opens `config.json5`. That is about two
     more files.
2. Storage format. ADR-007 proposes the Hyper-compatible map
   `{ "<command-id>": "<shortcut>" | ["<shortcut>", ...] }`, with additive
   evolution towards `when`-scoped bindings. Recommended: accept ADR-007 as
   written.
3. Reset after deletion. Deleting `keybindings.json5` while legacy
   `config.json5.keymaps` remain causes the next start-up to seed the file from
   them again, because the application may not edit `config.json5`.
   - Option A (recommended): document this, and document `{}` as the way to
     reset.
   - Option B: record "migration done" in a small marker file in the
     application's own state directory (Electron `userData`), so deletion
     yields an empty file on the next start. That is about two more files and
     one more policy input.

### Additional requirement: a Velocetty configuration tree

The same answer added this requirement, quoted here: "Create a Velocetty named
tree for the new file. Treat this tree with higher priority than the old tree.
Keep the old tree supported for now, but not to be used for any new
configuration files. Prefer an XDG configuration directory on Linux if
possible."

This plan reads it as follows. The decisions are recorded in `Decision log` and
in ADR-008.

- The Velocetty tree is `$XDG_CONFIG_HOME/Velocetty` when `XDG_CONFIG_HOME`
  is set to an absolute path, on any platform. Otherwise it is
  `~/.config/Velocetty` on Linux and macOS, and `%APPDATA%\Velocetty` on
  Windows. On Linux, this follows the XDG Base Directory specification: an
  empty or relative `XDG_CONFIG_HOME` is ignored, and `~/.config` is the
  default.
- `keybindings.json5` lives only in the Velocetty tree.
- `config.json5` is looked up in the Velocetty tree first, then in the Hyper
  tree (`config.json5`, then the older `hyper.json`). The Hyper tree's
  resolution rules are unchanged.
- When no `config.json5` exists anywhere, it is created in the Velocetty
  tree. Fresh installs therefore never touch the Hyper tree.
- Existing users keep their `config.json5` in the Hyper tree and it keeps
  working. It is not moved. When both trees hold one, the Velocetty copy wins,
  and a notification says the Hyper copy is ignored.
- No new configuration file is ever created in the Hyper tree. That includes
  the editor schema copy (`schema.json`), which is refreshed there only if it
  already exists.
- On Linux the Hyper tree is also Electron's `userData` directory, because
  `productName` is still `Hyper`. Electron and `electron-store` keep writing
  application state there (for example `config.json` for window state,
  `Preferences`, and `GPUCache/`). That is application state, not
  configuration, and this item leaves it alone.
- The CLI's plugin commands resolve `config.json5` in the same order, so they
  edit the same file the application reads.

## Purpose / big picture

Velocetty is a terminal emulator forked from Hyper. It used to keep a user's
keyboard shortcuts inside the main `config.json5` file, under a `keymaps` key.
The design moves them into a separate `keybindings.json5` file in the same
configuration directory. That file is layered over built-in and plugin
defaults, validated on read, and reloaded live when it changes.

After this work a user can do the following:

1. Open `keybindings.json5` in the Velocetty configuration directory (for
   example `~/.config/Velocetty/keybindings.json5` on Linux, or
   `$XDG_CONFIG_HOME/Velocetty/keybindings.json5`), change a shortcut, save,
   and see it take effect in the running application without a restart.
2. Save a broken file and keep every shortcut that worked before the save. A
   non-blocking notification names the line and column, or the JSON Pointer
   path, together with a suggested fix. A JSON Pointer path is a
   slash-separated location inside a JavaScript Object Notation (JSON)
   document, such as `/window:new/0`.
3. Upgrade from a build that kept shortcuts in `config.json5`. Those shortcuts
   are copied once into a new `keybindings.json5`, a notification says so, and
   `config.json5` is left byte-for-byte untouched.
4. Delete `keybindings.json5` and get platform defaults until the next start.
   The next start follows the rules in Approval question 3.
5. Install Velocetty fresh and find all configuration under the Velocetty
   tree. Or keep an existing Hyper-tree `config.json5` working unchanged, with
   only the new `keybindings.json5` appearing under the Velocetty tree.

Developers gain export and import utilities whose text is exactly the storage
format, so roadmap items `4.2.2` and `5.1.2` need no new file format.

This plan revises an earlier delivery of `3.2.1`, pull request #67. That
delivery has been rebased onto `main` and its gates repaired (see `Progress`).
Review of the pull request and fresh reconnaissance found defects that this
plan corrects. The most serious is this: when `keybindings.json5` becomes
invalid during a hot reload, the application falls back to legacy or empty
keymaps instead of the last known good keymaps. That contradicts both the
design and the notification the user sees.

## Constraints

- Scope is roadmap item `3.2.1`. The following are out of scope, apart from
  leaving seams for them:
  - plugin settings (`3.2.2`);
  - chord and `when` semantics, precedence, conflict detection at load
    (`detectKeybindingConflicts` exists but stays unwired), and warnings for
    unknown command identifiers (`4.2.1`);
  - the keybinding editor (`4.2.2`);
  - settings commands (`5.1.2`), as answered in Approval question 1;
  - automatic migration of an existing `config.json5` from the Hyper tree to
    the Velocetty tree, and the `XDG_CONFIG_DIRS` system-wide search path.
- The application must never write the user's `config.json5` from keybinding
  code. Tests compare its bytes before and after.
- `keybindings.json5` is created only during start-up bootstrap. A reload
  never creates or rewrites it.
- No configuration file is ever created in the legacy Hyper tree. New files go
  to the Velocetty tree. The Hyper tree's own resolution rules
  (`app/config/paths.ts` today) stay exactly as they are, so existing setups
  keep resolving.
- Plugin directories (`plugins/`, `plugins/local`, `plugins/cache`) follow the
  directory of the active `config.json5`, as today. They hold plugin state
  rather than configuration files, and moving them belongs to plugin
  persistence work (`3.2.2`).
- `config.json5` is created only at start-up, and only when the active tree is
  `velocetty`. Plugin directories are created only at start-up. A reload never
  creates a file or a directory. Today `_importConf` runs `mkdirpSync` and
  `ensureUserConfigFile` on every reload, and this plan removes that.
- Main-process code under `app/` must not import runtime values from
  `@shared/*`; `import type` only (see `app/config/reloadability-registry.ts`
  and `bun run check:boundaries`).
- The runtime contract `parsedConfig.keymaps: Record<string, string[]>`
  (`shared/src/types/config.ts`) is unchanged. So are its downstream consumers:
  `app/plugins.ts` `getDecoratedKeymaps`, the IPC schema in
  `lib/transport/ipc-schemas.ts`, menus, and `lib/command-registry.ts`.
- The merge of user overrides over platform defaults in `app/config/init.ts`
  is unchanged. The plugin layer's current position deviates from the design
  (see `Surprises & discoveries`). It is recorded, not corrected, and the
  correction is deferred to `4.2.1`.
- The reload callback stays synchronous on the main thread. Start-up and
  reload never interleave, so no reload re-entrancy guard is needed.
- No source file may exceed 400 lines (`AGENTS.md`), and
  `app/config/import.ts` must end at no more than 360 lines. Generated proof
  artefacts (`*.dfy.gen`) are exempt. In EP-A they are added to the Biome and
  markdownlint ignore lists.
- All behaviour changes follow Red-Green-Refactor with `bun:test`. Property
  tests use fast-check. Contractual policy logic carries a LemmaScript proof
  checked by Dafny.
- Documentation uses en-GB-oxendict spelling and follows
  `docs/documentation-style-guide.md`.
- Every milestone ends with `make check-fmt`, `make typecheck`, `make lint`,
  and `make test` passing. From EP-B onwards, `make prove` must pass too.

## Tolerances (exception triggers)

- Scope: stop and escalate if implementation needs more than 58 non-ExecPlan
  files or more than 3,500 net added lines of code and other documentation.
  This ExecPlan file is excluded from both counts. Generated artefacts
  (`*.dfy.gen`, `bun.lock`, generated schema JSON) are excluded from the line
  count but count as files.
- Interface: stop and escalate if any exported signature outside these files
  must change, or if `parsedConfig.keymaps` must change shape:
  - `app/config/keybindings*.ts`
  - `app/config/import.ts`
  - `app/config/watcher.ts`
  - `app/config.ts`
  - `app/config/paths.ts` and the new `app/config/config-tree.ts`
  - the new `shared/src/config/config-tree.ts` and `cli/api.ts`
    (`resolveConfigPath` only)
  - `test/e2e/electron-e2e-helpers.ts`

  Adding `@deprecated` to `keymaps` in `typings/config.d.ts` is approved here.
- Electron identity: escalate before calling `app.setPath('userData')` or
  changing `productName`.
- Dependencies: exactly two new development dependencies are approved,
  `fast-check` and `lemmascript`. Anything else needs escalation.
- Persisted format: escalate before accepting any `keybindings.json5` shape
  beyond ADR-007.
- Proof feasibility: escalate if the Stage B prototype misses its go/no-go
  within 4 hours of active work. Do not substitute a handwritten parallel Dafny
  model without approval.
- Time: escalate if any milestone other than EP-B exceeds 6 hours of active
  work.
- Iterations: escalate if any single gate still fails after three fix
  attempts.
- Continuous integration (CI): this plan approves one Linux-only step in the
  `build` job of `.github/workflows/nodejs.yml` (installing pinned Dafny and
  running `make prove`). It also approves changing the `test:e2e:run` script so
  it runs the whole `test/e2e/` directory. Any other workflow change needs
  escalation.
- Ambiguity: escalate when two valid readings of the design lead to
  materially different user-visible behaviour.

## Risks

- Risk: LemmaScript is a tech preview. Plain record payloads and untagged
  unions fall outside its subset. LemmaScript 0.6.0's type lowering leaves
  `Readonly<...>` and `string | readonly string[]` as opaque, constructorless
  types. Severity: medium. Likelihood: high.
  - Mitigation: the policy treats keymaps as an opaque payload. It obtains the
    empty value from `//@ extern function emptyUserKeymaps()` and carries no
    diagnostics.
  - Stage B is a 4-hour prototype with concrete go/no-go checks. Its fallback
    is `//@ declare-type`.
- Risk: `make prove` passing while verifying nothing. Evidence from
  LemmaScript's `runBatch`: an empty list verifies nothing and exits 0, list
  entries with timeouts over 60 seconds are silently downgraded to generation
  checks, and `extern` calls become axioms. Severity: high. Likelihood: medium.
  Mitigation: `bin/prove.sh` (EP-A) fails if:
  - the list lacks `app/config/keybindings-policy.ts`;
  - any entry has a timeout over 60 seconds;
  - generated files are stale;
  - any `assume`, `{:verify false}`, or `{:axiom}` appears beyond an explicit
    allow-list (only `emptyUserKeymaps`);
  - a planted false `ensures` in a fixture still verifies.
- Risk: Dafny is absent from CI runners. Severity: medium. Likelihood: high.
  Mitigation: EP-A adds a Linux-only CI step that installs Dafny 4.11.0, the
  version used locally.
- Risk: watching individual files with chokidar 3.6 is unreliable across
  platforms. Severity: high. Likelihood: high. Details:
  - On macOS chokidar uses `fsevents`, which disables its `atomic` handling.
  - On Linux and Windows a deleted path is re-watched only through an
    internal special case.
  - The initial scan emits `add` for every existing file unless
    `ignoreInitial` is set.

  Mitigation: watch the configuration directory at `depth: 0`, filtered to the
  two exact file names, with `ignoreInitial: true`. Coalesce events with one
  shared debounce timer. KB-WATCH-1 and E2E-KB-2 to E2E-KB-4 cover modify,
  rename-over, delete, and re-create.
- Risk: the macOS packaged build does not reliably print stdout markers in
  CI (`test/e2e/electron.e2e.test.ts`, packaged spawn test). Severity: medium.
  Likelihood: high. Mitigation: the keybinding end-to-end scenarios use the
  development-output launch, which requires `[e2e] renderer-ready` on every
  operating system. They also emit `[e2e] keybindings-path` so the test can
  assert that development mode did not pick a repository-local config.
- Risk: atomic replacement by rename replaces a symlinked file with a plain
  file, resets its permissions, and can fail transiently on Windows (`EPERM`,
  `EBUSY`). Severity: medium. Likelihood: medium. Mitigation, in the store
  adapter:
  - resolve the real path and create the temporary file beside the real
    file;
  - copy the original mode and `fsync` before renaming;
  - retry the rename only on `EPERM`, `EACCES`, and `EBUSY`, at most five
    times within about 200 milliseconds;
  - otherwise remove the temporary file and report failure without touching
    the target, with no overwrite fallback.

  Writes happen only at first-run bootstrap and on import.
- Risk: an editor that saves in place (truncate, then write) can be read
  half-written, producing a spurious error notification. Severity: low.
  Likelihood: low. Mitigation: last known good is kept, so nothing is lost.
  Repeated identical diagnostics are not re-notified. A confirmatory re-read is
  deferred.
- Risk: users deleting the file are surprised by legacy re-seeding.
  Severity: low. Likelihood: low. Mitigation: Approval question 3 and the
  users' guide.
- Risk: the application and the CLI resolve `config.json5` separately. If
  their orders drift, `hyper install` edits a file the application does not
  read. Severity: high. Likelihood: medium. Mitigation: the CLI may use only
  `@shared` runtime code, so the pure resolver is mirrored in
  `shared/src/config/config-tree.ts`. A parity test (KB-PATH-2) compares it with
  `app/config/config-tree.ts` over the whole enumerated domain, following the
  existing `test/unit/app-reloadability-parity.test.ts` precedent.
- Risk: users with a `config.json5` in both trees edit the Hyper copy and see
  no effect. Severity: medium. Likelihood: low. Mitigation: a notification at
  start-up names the ignored copy, and the users' guide explains the order.
- Risk: Electron's `userData` is `<appData>/Hyper` on every platform, because
  the product name is still `Hyper`. On Linux that is the Hyper tree itself,
  and Electron and `electron-store` write state there. Severity: low.
  Likelihood: high. Mitigation: the Velocetty tree uses
  `app.getPath('appData')` plus `Velocetty`, never `userData`. Tests assert
  only that no configuration file name (`config.json5`, `hyper.json`,
  `keybindings.json5`, `schema.json`, `keybindings.schema.json`) appears under
  the Hyper tree unless it was seeded. They do not compare directory listings.
- Risk: if the Velocetty directory is deleted mid-session, its watcher is lost
  until restart. Severity: low. Likelihood: low. Mitigation: documented in the
  users' guide. The next start-up recreates the directory.
- Risk: a symlinked tree or file produces a false "ignored copy" notice, or a
  broken dotfiles symlink in the Hyper tree reads as absent, so a new Velocetty
  `config.json5` silently shadows it for good. Severity: medium. Likelihood:
  low. Mitigation: the resolver takes an injected `sameFile` (real-path
  equality) and a three-state `probe` that distinguishes `broken-link` from
  `absent` (KB-PATH-1 named examples).
- Risk: the two active files may now sit in different directories, so a
  single-directory watcher would miss one. Severity: high. Likelihood: high
  (for every existing user). Mitigation: the watcher watches the directory of
  each active file at `depth: 0`, filtered to exact paths. The Velocetty
  directory is created at start-up so it can be watched even when bootstrap is
  deferred.
- Risk: the local fast end-to-end lane needs `node-pty` built for Electron,
  and `bun run rebuild-node-pty` failed in the planning worktree. Severity:
  low. Likelihood: medium. Mitigation: CI builds it. Locally, follow the setup
  steps in `Concrete steps`.

## Progress

- [x] (2026-04-22 23:12Z) Earlier delivery opened as pull request #67, with
  plan status `COMPLETE`.
- [x] (2026-10-29 17:20Z) Rebased the three earlier commits onto
  `origin/main` at `40949b2f`:
  - resolved conflicts in `app/config/import.ts`,
    `test/unit/config-import-json5.test.ts`, and `docs/developers-guide.md`;
  - moved the shared import harness into
    `test/testUtils/config-import-harness.ts`;
  - removed duplicate imports and re-exports that the merge driver left in
    `app/config.ts`;
  - kept local backup branch `backup/3-2-1-pre-rebase-e3335b98`.
- [x] (2026-10-29 18:40Z) Repaired the rebase fallout in `9f8c2cd1` (watcher
  test, two oxlint findings, Markdown reflow). `make check-fmt`,
  `make typecheck`, `make lint`, `make test` (514 pass), and
  `make markdownlint` all pass.
- [x] (2026-10-29 19:00Z) Reconnaissance and external research complete.
- [x] (2026-10-29 19:40Z) First draft committed (`cf4ffec7`). Roadmap
  `3.2.1` reopened.
- [x] (2026-10-29 21:30Z) Community-of-experts review completed, covering
  architecture, verification, product and documentation, reliability and
  end-to-end, and plan quality. The review found 7 blockers and about 40 other
  findings. This revision addresses them, and ADR-007 is drafted as Proposed.
- [x] (2026-10-29 22:40Z) Approver accepted all three recommendations and
  added the Velocetty configuration tree requirement. This revision adds it as
  EP-P, KB-PATH-1 and KB-PATH-2, ADR-008, and end-to-end scenario E2E-KB-0.
- [x] (2026-10-29) Approval gate: explicit human approval of this revision.
- [x] (2026-10-29 23:30Z) EP-A tooling: red confirmed with
  `test/proofs/sample-false.ts` (Dafny named the unproved postcondition and
  `make prove` exited 2); green confirmed on `test/proofs/sample.ts`
  (`1 verified, 0 errors`); Linux-only CI step added; `make check-fmt`,
  `make typecheck`, `make lint`, and `make test` (514 pass) all pass.
- [x] (2026-10-29 23:55Z) EP-P configuration tree: red confirmed against a
  stub that still returned Hyper paths (6 of 8 KB-PATH-1 tests failed, naming
  the priority, creation, XDG, and symlink invariants); green on
  `resolveConfigLocations` in `app/config/config-tree.ts` and its
  `shared/src/config/config-tree.ts` mirror; CLI delegation and five new
  `cli/api.ts` cases; `--help` now prints the keybindings path and active tree;
  531 unit tests pass. Four negative controls each failed the intended
  invariant and were reverted; details in `Artefacts and notes`.
- [x] (2026-10-30) EP-B policy and proof: prototype go/no-go passed (LemmaScript
  0.6.5 translates every planned construct, including unions, switch, backward
  recursion, and an indexed fold); red confirmed by stubbing the bodies (3
  verified, 11 unproved `ensures`); green on the real policy (8 verified, 0
  errors) and 35 unit tests; negative controls (a) and (b) each failed the
  intended invariants and were reverted; gates green (566 tests, proof 1 + 8
  verified). Deviations and subset findings are recorded in
  `Surprises & discoveries` and the Decision log.
- [x] (2026-10-30) EP-C codec and schema: red confirmed with the missing
  module (`Cannot find module '../../app/config/keybindings-codec'`); green on
  `app/config/keybindings-codec.ts` with 46 focused tests across four suites
  and a generated draft-07 schema at `shared/schemas/keybindings.schema.json`.
  `bun run generate-schema` is idempotent, and a hand-edited `minLength` failed
  both schema tests before being reverted; gates green (610 tests, proof 1 + 8
  verified). Details in `Artefacts and notes`.
- [x] (2026-10-30) EP-C review follow-up: the milestone CodeRabbit review of
  `4190d65b` (base `2132eabc`) reported three minor and one trivial finding,
  all rooted in `$schema` handling. `readEntries` now validates the `$schema`
  value before dropping it; a rejected `schema-key-invalid.json5` fixture and
  parity case were added; and the legacy `parseKeybindingsSource` adapter now
  parses through the codec. Also added the KB-COD-2 outcome-share guard and ran
  the KB-COD-1 sorting-removal control, which failed two tests before being
  reverted. Gates green after the follow-up (612 tests, 74 files; proof 1 + 8
  verified).
- [ ] EP-D store, service, importer: red; green; negative control (c);
  refactor; gates.
  - [x] (2026-10-30) D1 atomic store: `app/config/keybindings-store.ts` and
    its 14 KB-STORE-1 tests. Each injected fault point (open, write, `fsync`,
    chmod, rename) is asserted reached and leaves the previous bytes intact;
    symlink, mode-preservation, transient-retry, give-up, and stale-temporary
    cases pass. Gates green (626 tests, 75 files).
  - [x] (2026-10-30) D2 service: `app/config/keybindings.ts` is rewritten as a
    store-driven service with one state-change path, plus the temporary
    `keybindings-legacy.ts` adapter that keeps the importer working until D3.
    19 named examples, 7 KB-SVC-1 properties, and 2 KB-SVC-2 model tests pass.
    Both required negative controls fail and were reverted; transcripts in
    `Artefacts and notes`.
- [ ] EP-E watcher and end-to-end: red; green; refactor; gates; CI end-to-end
  run on three operating systems.
- [ ] EP-F documentation and roadmap: drafts; review; gates.

## Surprises & discoveries

- Observation: the earlier delivery's invalid-reload fallback never reaches
  the last known good keymaps. Evidence: `buildFallbackResult` in
  `app/config/keybindings.ts` computes
  `fallbackKeymaps ?? lastKnownGoodKeymaps ?? {}`, and `app/config/import.ts`
  always passes an object as `bootstrapFrom`. The test meant to cover it,
  "keeps the last known good keymaps", passes only because its legacy keymaps
  equal the bootstrapped file. Impact: KB-POL-1, KB-SVC-2, and negative control
  (c).
- Observation: a transient `config.json5` parse failure on the first run
  after upgrading writes an empty `keybindings.json5`, which permanently blocks
  migration. Evidence: the automated Codex reviewer's priority-2 finding on
  pull request #67, and `bootstrapKeymaps` in `app/config/import.ts`. Impact:
  KB-POL-2.
- Observation: `_import()` runs at both start-up and reload, so bootstrap
  re-runs on every reload. A file deleted mid-session would be recreated
  straight away. Evidence: `app/config.ts` `_watch` and `setup` both call
  `_import()`. Impact: the importer and service separate `start` from `reload`,
  and a reload never writes.
- Observation: the watcher listens only for `change` and schedules one
  100-millisecond timer per event, so bursts cause several reloads and
  re-creation is missed. Evidence: `app/config.ts` `_watch`. Impact: KB-WATCH-1.
- Observation: "Configuration updated" fires even when a reload fell back.
  Evidence: `app/config.ts` `onChange`. Impact: the import report carries a
  status per file.
- Observation: the end-to-end target value in the first draft,
  `ctrl+shift+n`, is already the Linux and Windows platform default for
  `window:new` (`app/keymaps/linux.json`, `app/keymaps/win32.json`). Tests
  using it could not detect a reload that dropped user overrides. Impact: the
  end-to-end probe uses `ctrl+alt+shift+n`, which appears in no platform
  keymap, and asserts this as a precondition.
- Observation: the fast end-to-end script runs one named file
  (`package.json` `test:e2e:run`), so a new end-to-end file would never run.
  Impact: the script runs the `test/e2e/` directory.
- Observation: plugin keybinding precedence differs from the design.
  `mergeRuntimePluginKeybindings` (`app/runtime/plugin-runtime.ts`) lets core
  plus user beat runtime plugin defaults, and `decorateKeymaps` hooks
  (`app/plugins.ts`) run after user overrides. Impact: recorded in
  `docs/tracking-issues.md` and ADR-007. The trace link for DES-CFG-KB-LAYER is
  narrowed to "user over core". The fix is deferred to `4.2.1`.
- Observation: the repository forces `ajv` 6.14.0 through `overrides`, which
  validates JSON Schema draft-07 only. Zod 4's `z.toJSONSchema` emits draft
  2020-12 by default. The root uses `zod` `^4.3.6` while `app/` uses `^4.6.7`.
  Impact: AXIOM-AJV, and generation with `target: 'draft-7'` from `app/`'s copy
  of Zod.
- Observation: there is no `docs/users-guide.md` and no component
  architecture document for `app/config`. Impact: EP-F creates both.
- Observation: `getKeyScope` in `app/config/reloadability-registry.ts` maps
  only the singular `keymap` to the keymap scope, while the config key is
  `keymaps`. Nothing calls it for keymaps yet. Impact: logged in
  `docs/tracking-issues.md` for the settings UI work, not fixed here.
- Observation: the configuration directory is still named `Hyper`, not
  `Velocetty` as the design proposes. On Windows it is Electron's `userData`
  (`%APPDATA%\Hyper`, from `productName`). Impact: the approver directed a
  Velocetty tree with higher priority (EP-P and ADR-008).
- Observation: the CLI resolves `config.json5` itself (`cli/api.ts`
  `resolveConfigPath`, which mirrors the Hyper rules), and only `@shared`
  runtime code is available to it. Impact: a mirrored pure resolver and a
  parity test.
- Observation: in a fresh worktree on this host, `bun install` postinstall
  fails in `electron-builder install-app-deps` because of a stale npm cache.
  Impact: a workaround is in `Concrete steps`.
- Observation: `lsc gen` creates a missing `.dfy` beside the `.dfy.gen`, but
  `lsc gen` and `lsc regen` both refuse to rewrite a `.dfy` whose generated
  lines were edited, reporting "modifications to generated lines (not
  additions-only)". Evidence: the EP-A red step, where the planted contract
  changed `ensures` in place. Removing the stale `.dfy` and regenerating
  recreated it, but that discards handwritten proof additions. Impact: `.dfy`
  files are additions-only, and a contract change needs the generated lines
  reconciled by hand before `make prove` will run.
- Observation: EP-P's red step is only decisive once a stub exists. Without the
  module, Bun reports a missing import and no invariant runs; with a stub that
  returns the old Hyper paths, exactly the two non-vacuity tests pass and the
  six behavioural ones fail. Impact: the stub phase is the red transcript
  recorded in `Artefacts and notes`; the module-missing phase only proves the
  test file loads.
- Observation: the priority and symlink-shadowing invariants share one fixture,
  so swapping the Velocetty and Hyper priority fails two tests, not one. The
  symlink case asserts that a Velocetty directory symlinked to the Hyper tree
  reports no shadowed copy; under Hyper-first priority the active tree becomes
  Hyper and the case can no longer hold. Impact: negative control 1 is a
  two-test signal, and neither test is redundant.
- Observation: `shadowed` notices follow the priority order, so any change to
  the Velocetty directory name also changes which copies appear shadowed in
  development mode. The parity control therefore reported 768 mismatches, not
  just a differing `velocettyDirectory` field. Impact: KB-PATH-2 checks the
  whole result object, which is what makes a one-character mirror drift visible.
- Observation: the CLI cannot resolve real paths, so its `sameFile` is string
  equality. A CLI-side Velocetty directory symlinked to the Hyper tree
  therefore still reports the Hyper copy as shadowed, whereas the application
  does not. Impact: accepted divergence, recorded in the Decision log; the
  notice is cosmetic and the CLI never writes.
- Observation: the LemmaScript subset constrains the policy's shape more than
  the plan anticipated. Each constraint below was found by a failing
  translation or verification, not by reading the documentation:
  - `//@ extern` is accepted only on a function with a body; it then emits an
    axiomatic Dafny function, so `emptyUserKeymaps` stays the single trust
    anchor.
  - A loop invariant must be a leading comment of the first statement inside
    the loop body. A `for...of` loop lowers to a range loop whose internal
    counter (`_<head>_idx`) the source cannot name, so an invariant over the
    consumed prefix needs an indexed C-style `for` loop. C-style loops receive
    no automatic bound invariant, so `0 <= i` and `i <= history.length` must be
    written explicitly.
  - A `switch` scrutinee must be string-typed or a declared union. A nested
    union field such as `input.legacy.kind` must be destructured to a local
    first, otherwise the emitter produces `match ?`.
  - `\result.kind` is not available when the result is a union, so contracts on
    `BootstrapDecision` and `KeybindingsObservation | null` use boolean and
    projection spec functions (`isSeed`, `isDefer`, `specSeedKeymaps`,
    `specLegacyKeymaps`, `isDeferredObservation`, `specObservationKeymaps`).
  - `Record<string, ...>` lowers to a synthetic opaque type, while an interface
    with an index signature lowers to a comparable Dafny type. `UserKeymaps` is
    therefore an interface.
  - A lemma body may call only lemmas, so the non-vacuity witnesses are a
    `method` over the shipped `replayKeybindingObservations`; naming a union
    constructor requires qualification (`KeybindingsObservation.missing`).

  Impact: the planned "forward `for...of` fold" is implemented as an equivalent
  indexed fold, and the contracts are written through spec predicates. Both are
  recorded in the Decision log.
- Observation: `lsc gen` refuses to rewrite an edited `.dfy`, and a body change
  makes the recorded generated lines stale. The workable procedure after any
  policy edit is to delete the `.dfy`, regenerate it, and re-apply the proof
  additions, then re-run `make prove`. Impact: `.dfy` proof additions are a
  maintained patch, not a one-off edit.
- Observation: oxlint does not model `noUncheckedIndexedAccess`, so it reads
  `history[lastIndex]` and `history[i]` as always defined and reports the
  `undefined` guards as unnecessary, while tsgo requires them. LemmaScript, in
  turn, needs the truthiness form (`if (!last)`) to emit the branch as
  unreachable; an `=== undefined` guard produces ill-typed Dafny. Impact: two
  narrow `oxlint-disable-next-line typescript/no-unnecessary-condition`
  comments with reasons, and no behavioural suppression. Precomputing
  `lastIndex` also avoids `unicorn/prefer-at`, which LemmaScript cannot lower.

- Observation: Zod 4's record parsing assigns validated entries with `[[Set]]`,
  so an own `__proto__` key is silently dropped and never validated;
  `safeParse` returns success with the key missing. Evidence: a probe on
  `z.record(z.string(), z.string())` and the codec's prototype round-trip test.
  By contrast, `JSON5.parse` does create an own `__proto__` data property while
  keeping `Object.prototype`, which is why the fixture corpus can express the
  case at all. Impact: the codec validates command ids and bindings
  individually and assembles the map with `Object.fromEntries`; Ajv validates
  the same document correctly, so the generated schema needed no workaround.
- Observation: the plan expected `parseKeybindingsText` to catch a `RangeError`
  from pathological nesting. On Bun 1.4.4, `'['.repeat(100_000)` raises JSON5's
  own `SyntaxError` with `lineNumber`/`columnNumber`, so there is no separate
  depth branch to write. Impact: one `try`/`catch` covers both syntax and depth
  failures, and the regression test asserts non-throwing behaviour rather than
  a specific error class.
- Observation: oxlint's advice constrains how the corpus is expressed, in ways
  the type checker does not. `deslop(no-known-value-widening)` rejects an
  explicit `Readonly<Record<string, FixtureExpectation>>` annotation on the
  fixture table, requiring inference plus `satisfies`; but with inference the
  table cannot be indexed by `string`, and
  `typescript(no-unnecessary-condition)` ignores `noUncheckedIndexedAccess` and
  would report an `undefined` guard as unnecessary. Evidence: two successive
  lint runs. Impact: the agreement test iterates `Object.entries(FIXTURES)`
  instead of indexing by file name, and the key set is still pinned by a
  separate assertion.
- Observation: `z.toJSONSchema` returns Zod's schema-payload interface, which is
  not assignable to the repository's `JsonValue`. Impact: the codec exports the
  payload type as-is for the generator and Ajv, and the parity suite widens
  only the assertion (`expect<unknown>`) rather than converting the schema.

## Decision log

- Decision: keep the earlier delivery's commits, rebased, and restructure
  them under this plan. Rationale: requested by the user on 2026-10-29.
  Date/Author: 2026-10-29, user and planning agent.
- Decision: the storage format, verbatim import and export, last-known-good
  semantics, and the migration rule are as proposed in ADR-007. Rationale: see
  the ADR. Date/Author: 2026-10-29, planning agent; awaiting approval through
  Approval question 2.
- Decision: split keybinding code along hexagonal lines, keeping the
  repository's flat `app/config/` layout and factory-with-dependencies style:
  - `keybindings-policy.ts`: pure, proved decisions.
  - `keybindings-codec.ts`: JSON5 text to validated keymaps.
  - `keybindings.ts`: application service; also declares the
    `KeybindingsStore` port it consumes.
  - `keybindings-store.ts`: file adapter implementing that port.
  - `watcher.ts`: debounce and watch orchestration, declaring the
    `WatcherHandle` port.
  - `app/config.ts`: composition root. It creates the store, service, and
    watcher, and injects them.

  `app/config/import.ts` declares the narrow `ConfigImportKeybindings` port it
  needs. Rationale: the dependency rule points inward; the policy can be proved
  without I/O; import and export get a single owner of last-known-good state,
  reachable from `app/config.ts` for `4.2.2`. It avoids transplanting `domain/`
  and `adapters/` directories, which the rest of `app/config` does not use.
  Date/Author: 2026-10-29, planning agent, after architecture review.
- Decision: the policy state is a single value, `lastAccepted`, which is
  either keymaps or `null`. Active overrides are derived as `lastAccepted`, or
  empty when it is `null`. Policy observations carry no diagnostics. Rationale:
  storing `active` and `lastKnownGood` separately duplicates one fact. Keeping
  diagnostics out of the policy keeps the proof free of cross-module types.
  Date/Author: 2026-10-29, planning agent.
- Decision: start-up and reload are separate commands. `start(legacy)` may
  bootstrap through `decideBootstrap`. `reload()` never writes; a missing file
  is observed as `missing`. A deferred migration is retried only at the next
  start-up. Rationale: fixes the reviewers' blocker that a deleted file would
  be recreated mid-session. Date/Author: 2026-10-29, planning agent.
- Decision: import validates and writes only, and returns `written`,
  `invalid`, or `failed`. The service state changes only through `start` and
  `reload`. The application's own write reaches the active state through the
  watcher's reload, which is idempotent (KB-POL-1 idempotence lemma). Export
  reads and parses only. It returns `stored`, `invalid` (with the stored text
  and diagnostics), `missing`, or `unreadable`; it never invents content, and
  never notifies or writes. There is no public canonical writer. Rationale:
  command/query segregation; one path for state changes; no fabricated exports.
  Comment-preserving targeted edits are left to `4.2.2`, which can reuse
  `app/runtime/plugin-runtime-json5-roundtrip.ts`. Date/Author: 2026-10-29,
  planning agent.
- Decision: `_import` takes a phase and returns `{config, report}`. The
  report is
  `{config: 'applied' | 'fallback'; keybindings: 'applied' | 'kept' | 'unchanged'}`.
  It replaces a hidden "last report" query. "Configuration updated" is shown
  when at least one file applied and neither fell back. The keybindings error
  is shown again only when its diagnostics differ from the last shown.
  Rationale: a value is returned instead of mutable state; each file's status
  is independent. `getDefaultConfig` is split from `_importConf`, so querying
  defaults never starts keybindings. Date/Author: 2026-10-29, planning agent.
- Decision: legacy `config.json5.keymaps` handling. Migration shows one
  notification ("Shortcuts moved to keybindings.json5"). When legacy keymaps
  coexist with the file, one notification per process says they are ignored.
  `keymaps` is marked `@deprecated` in `typings/config.d.ts`, so the
  regenerated schema flags it in editors. Legacy keymaps that fail the codec's
  validation are not seeded. Migration is deferred, with a notification naming
  the problem. Rationale: users editing the old key get feedback, and a file
  that would start out invalid is never written. Date/Author: 2026-10-29,
  planning agent.
- Decision: notification wording follows what is actually in effect. It
  reads "Keeping your previous shortcuts" when last known good is in use, and
  "Using default shortcuts until the file is fixed" when nothing was accepted
  yet. The success text drops "Hyper". Rationale: the earlier text was false at
  start-up. Date/Author: 2026-10-29, planning agent.
- Decision: the file watcher watches the configuration directory at depth 0,
  filtered to `config.json5` and `keybindings.json5`, with
  `ignoreInitial: true`. It uses one shared trailing debounce of 100
  milliseconds. Rationale: reliable delete, re-create, and rename-over handling
  on all three platforms. Date/Author: 2026-10-29, planning agent.
- Decision: atomic writes follow the store design under `Risks`, with no
  direct-overwrite fallback. At start-up, stale temporary files matching the
  adapter's own name pattern are removed. Rationale: keeps KB-STORE-1 true.
  Date/Author: 2026-10-29, planning agent.
- Decision: the JSON Schema for editors is generated from the codec's Zod
  schema as draft-07 into `shared/schemas/keybindings.schema.json`.
  `generate-schema` runs the generator. `ensureSchemaFile` copies the schema
  into the configuration directory beside the configuration schema. The codec
  accepts and ignores a top-level `$schema` key. Rationale: satisfies
  DES-CFG-VALID's pinned schema, and stays clean under CI regeneration.
  Date/Author: 2026-10-29, planning agent.
- Decision: EP-A (tooling) and EP-F (documentation) have no behaviour under
  unit test.
  - EP-A's red step is a planted false `ensures` that `make prove` must
    reject. Its green step is the sample verifying.
  - EP-F's evidence is `make markdownlint`, `make nixie`, and review.
  - KB-LAYER-1 characterizes existing behaviour, so it is expected to pass on
    its first run. Its red substitute is a negative control.

  Date/Author: 2026-10-29, planning agent.
- Decision: pin `lemmascript` at exactly `0.6.5`. Rationale: patch releases
  change generated code, which would break the stale-artefact check. This is a
  documented exception to the caret policy in `AGENTS.md`. Date/Author:
  2026-10-29, planning agent.

- Decision: accept the three approval recommendations: utilities-only export
  and import, ADR-007's map format, and documented re-seeding after deletion.
  Rationale: the approver accepted them. Date/Author: 2026-10-29, approver.
- Decision: add a Velocetty configuration tree, with the rules under
  `Additional requirement` above. Rationale: the approver directed it. The
  interpretation details are planning-agent decisions, recorded in ADR-008.
  Date/Author: 2026-10-29, approver and planning agent.
- Decision: one rule for `XDG_CONFIG_HOME` in the Velocetty tree on every
  platform. An absolute, non-empty value wins. Otherwise the tree is
  `~/.config/Velocetty` on Linux and macOS and `%APPDATA%\Velocetty` on
  Windows. Rationale: it matches the Linux XDG specification, which the
  approver asked for. It keeps the existing "XDG on any platform" behaviour
  that end-to-end isolation relies on. It matches the design's paths table for
  macOS and Windows. The Hyper tree keeps its current, laxer rule unchanged.
  Date/Author: 2026-10-29, planning agent.
- Decision: the directory is named `Velocetty`, capitalized, as in the
  design's paths table. Rationale: it is consistent with the design and with
  the Hyper tree's `Hyper`. Date/Author: 2026-10-29, planning agent.
- Decision: `keybindings.json5` is resolved only in the Velocetty tree. A
  `Hyper/keybindings.json5` written by unreleased builds of the earlier branch
  is ignored. Rationale: the file is new, and no release ever wrote it to the
  Hyper tree. Date/Author: 2026-10-29, planning agent.
- Decision: the configuration schema copy is refreshed beside the active
  `config.json5` only where it may create files. That is always in the
  Velocetty tree, and in the Hyper tree only when the copy already exists.
  `keybindings.schema.json` is copied beside `keybindings.json5`. Rationale: no
  new file in the old tree, and editor validation keeps working for both trees.
  Date/Author: 2026-10-29, planning agent.
- Decision: development mode is unchanged. A repository-root `config.json5`
  or `hyper.json` overrides both trees, and `keybindings.json5` then lives
  beside it. Rationale: it preserves the developer workflow, and the end-to-end
  lane asserts the path through `[e2e] keybindings-path`. Date/Author:
  2026-10-29, planning agent.
- Decision: `getConfigDir()` (`app/config.ts`), which plugins reach through
  `app.config`, keeps returning the directory of the active `config.json5`, for
  plugin compatibility. Files that third-party plugins write there are outside
  this item (`3.2.2`). `app/config/open.ts` keeps opening the active `cfgPath`.
  The `--help` output in `app/index.mts` also prints the keybindings path and
  the active tree. Date/Author: 2026-10-29, planning agent.
- Decision: macOS uses `~/.config/Velocetty`, not
  `~/Library/Application Support/Velocetty`. Rationale: this matches the
  design's paths table and the Hyper tree, which macOS users already know. On
  Linux the name is case-sensitive, so a hand-made `~/.config/velocetty` is not
  consulted, and the users' guide says so. Date/Author: 2026-10-29, planning
  agent.
- Decision: a Hyper-tree candidate that is a broken symlink (`lstat` succeeds
  but `stat` fails) counts as present. It becomes the active config, defaults
  apply, a notification is shown, and nothing is created. Shadowed entries that
  are the same file as the active one are dropped. Rationale: never silently
  replace a dotfiles-managed configuration. Date/Author: 2026-10-29, planning
  agent.
- Decision: KB-PATH-2 parity covers the resolver function only. Today the
  application and the CLI derive their inputs differently:
  - the development flag: `isDev` against `NODE_ENV !== 'production'`;
  - the development directory: `dist/` against the repository root;
  - Windows `appData`: Electron's known folder against `APPDATA` or
    `<home>\AppData\Roaming`.

  These are recorded in `docs/tracking-issues.md`, not fixed here. Date/Author:
  2026-10-29, planning agent.
- Decision: the choice of tree is made once, at start-up. Creating a Velocetty
  `config.json5` while the application runs takes effect after a restart.
  Rationale: switching the active file during a reload would be a new migration
  flow, outside this item's scope. Date/Author: 2026-10-29, planning agent.
- Decision: `bin/prove.sh` requires `app/config/keybindings-policy.ts` to be
  listed only when that file exists. Rationale: EP-A runs before EP-B creates
  the policy, so an unconditional check would fail the tooling stage; once EP-B
  lands, the condition becomes a permanent guard. Date/Author: 2026-10-29,
  implementation agent.
- Decision: the `prove` target invokes `./bin/prove.sh` rather than
  `bun bin/prove.sh`. Rationale: the script uses bash arrays, `mapfile`, and
  regular-expression tests that Bun's shell does not implement; the shebang and
  executable bit make direct invocation both correct and portable within the
  Linux-only proof step. Date/Author: 2026-10-29, implementation agent.
- Decision: `shadowed` lists lower-priority `config.json5` files only, not
  `hyper.json`. Rationale: the notice names configuration files that the new
  tree hides. Hyper-to-`hyper.json` fallback is unchanged from today and is not
  shadowing, and the plan's KB-PATH-1 wording says "`config.json5` files".
  Date/Author: 2026-10-29, implementation agent.
- Decision: the CLI's `sameFile` is string equality, not `realpathSync`.
  Rationale: `cli/api.ts` runs before any Electron or application state exists
  and resolves only the active path, so it has no reason to touch the
  filesystem beyond `existsSync`; a symlinked tree produces at worst a spurious
  "ignored copy" notice in a code path that never writes. Date/Author:
  2026-10-29, implementation agent.
- Decision: the shared resolver is a duplicated file, not a re-export of
  `app/`. Rationale: the package-boundary check forbids `shared/` importing from
  `app/`, and the CLI bundles only `@shared` runtime code. KB-PATH-2 covers
  the duplication cost with a 768-case deep-equality test. Date/Author:
  2026-10-29, implementation agent.
- Decision: `test/testUtils/config-tree-domain.ts` is an extra artefact beyond
  the plan's list. Rationale: it holds the 768-case enumeration, the platform
  fixtures, and the input builder shared by KB-PATH-1 and KB-PATH-2, so the two
  suites cannot drift in the domain they exercise. Date/Author: 2026-10-29,
  implementation agent.
- Decision: `replayKeybindingObservations` is an indexed C-style `for` loop,
  not the planned `for...of` fold, with explicit `0 <= i` and
  `i <= history.length` invariants and a `history.slice(0, i)` prefix
  invariant. Rationale: LemmaScript lowers `for...of` through an internal
  counter the invariant cannot name, so the planned fold cannot carry
  KB-POL-1's replay contract. The indexed loop has the same semantics and the
  same public signature. Date/Author: 2026-10-30, implementation agent.
- Decision: KB-POL-2's contracts are expressed with the exported spec
  predicates `isSeed`, `isDefer`, `specSeedKeymaps`, `specLegacyKeymaps`,
  `isDeferredObservation`, and `specObservationKeymaps`. Rationale: LemmaScript
  cannot project `\result.kind` from a union result, and these predicates are
  also the vocabulary the unit tests use. They add public surface, so they are
  documented in `Interfaces and dependencies`. Date/Author: 2026-10-30,
  implementation agent.
- Decision: `UserKeymaps` is an interface with a string index signature rather
  than `Record<string, string | string[]>`. Rationale: `Record` lowers to a
  synthetic opaque type in LemmaScript, losing comparability and field access;
  the interface lowers to a Dafny type and is structurally identical at the
  TypeScript boundary. Date/Author: 2026-10-30, implementation agent.
- Decision: the checked-in `.dfy` adds four slice/exit assertions inside
  `replayKeybindingObservations` and a `replayKeybindingObservationsExamples`
  method. Rationale: the assertions are the two facts Dafny needs to unfold
  `specLatestAccepted` at the consumed element and to close the postcondition;
  no helper lemma was needed. The example method witnesses that each
  observation kind is reachable through the shipped fold, so the contract is
  not vacuous. Date/Author: 2026-10-30, implementation agent.
- Decision: two `oxlint-disable-next-line typescript/no-unnecessary-condition`
  comments guard the indexed reads in `specLatestAccepted` and the replay loop,
  each with a written reason. Rationale: oxlint ignores
  `noUncheckedIndexedAccess` while tsgo and LemmaScript both require the
  guard's truthiness form; `.at()` and `=== undefined` were each rejected by
  the translator. Precomputing `lastIndex` keeps the code free of
  `unicorn/prefer-at`. No behavioural check is suppressed. Date/Author:
  2026-10-30, implementation agent.

- Decision: `parseKeybindingsText` validates command ids and bindings with Zod
  schemas but assembles the accepted map itself, with `Object.fromEntries`.
  Rationale: `z.record` parses through `[[Set]]` and therefore loses an own
  `__proto__` key without reporting an error, which would make the codec
  disagree with its own JSON Schema. Validating entries individually keeps one
  source of truth for the constraints while preserving every own key.
  Date/Author: 2026-10-30, implementation agent.
- Decision: the top-level `$schema` key is validated as an ordinary
  binding-shaped entry and then dropped. An invalid value, such as
  `$schema: 42`, is rejected with a diagnostic. Rationale: the generated JSON
  Schema still describes it as an `additionalProperties` member, so Ajv and the
  codec accept exactly the same documents; teaching the schema a special case
  would have meant a refinement, which `z.toJSONSchema` would drop. The first
  implementation skipped the value unvalidated, which the milestone review
  caught; `schema-key-invalid.json5` now pins the correction. Date/Author:
  2026-10-30, implementation agent.
- Decision: the codec exports `keybindingsJsonSchema`, which returns Zod's
  draft-07 payload directly. The generator and the parity suite both consume
  it, so there is one schema expression in the repository. Rationale:
  converting the payload to `JsonValue` would add an error path that cannot
  trigger, and re-declaring the schema in the generator would defeat the parity
  check. Date/Author: 2026-10-30, implementation agent.
- Decision: `app/config/keybindings.ts` still holds the legacy module until
  EP-D, but its local Zod record schema is deleted and `keybindingsSchema` and
  `toRawKeymaps` now come from the codec. Rationale: keeps one validation
  definition during the transition without pre-empting the service rewrite.
  Date/Author: 2026-10-30, implementation agent.
- Decision: the KB-COD-2 rejection corpus is twelve JSON5 fixtures under
  `test/fixtures/keybindings/`, nine of them rejections, and the parity suite
  asserts the exact file set. Rationale: the class coverage becomes a
  reviewable diff instead of hidden test data, and adding or removing a class
  without classifying it fails the suite. Date/Author: 2026-10-30,
  implementation agent.
- Decision: the service exposes `active()` as a read-only query and keeps
  `start`, `reload`, `importKeybindings`, and `exportKeybindings` as the only
  state-changing commands. Rationale: KB-SVC-2's model has to observe the
  keymaps in effect after every command without perturbing them, and the
  alternative, reading through `exportKeybindings`, would conflate a filesystem
  read with a query. The query returns a fresh map from `activeKeymaps`, so no
  caller can mutate service state. Date/Author: 2026-10-30, implementation
  agent.
- Decision: the KB-SVC-2 model test does not pass an `fc.commands`
  `replayPath` option. Rationale: the option takes a serialized shrink hint
  such as `"EBC:F"`, not a filename; supplying a filename made the shrinker
  throw. fast-check already prints `/*replayPath="..."*/` on failure, so the
  reproduction hint is retained without the option. Date/Author: 2026-10-30,
  implementation agent.
- Decision: `app/config/keybindings-legacy.ts` is a temporary module holding
  the earlier delivery's importer-facing API, re-exported from
  `keybindings.ts`, rather than keeping both in one file. Rationale: the
  service rewrite pushed `keybindings.ts` past the 400-line limit; splitting
  the untouched legacy behaviour keeps the service reviewable and makes the D3
  deletion a single file plus one export. It imports `UserKeymaps` from the
  policy module, not from `keybindings.ts`, so no type cycle is introduced.
  Date/Author: 2026-10-30, implementation agent.

## Outcomes & retrospective

Not yet started. Populate this at each milestone boundary and at completion.
Compare the result with `Purpose / big picture`, and reconcile discoveries with
ADR-007 and the design document before setting `COMPLETE`.

## Context and orientation

Velocetty is an Electron application. The main process (code under `app/`) owns
configuration. The renderer (code under `lib/`) receives keymaps over IPC.
`shared/` holds code shared with the renderer and the command-line interface
(CLI), but the main process may import only types from it.

Configuration lives in a per-user directory computed in `app/config/paths.ts`.
It is `$XDG_CONFIG_HOME/Hyper` when that variable is set (on any platform).
Otherwise it is `~/.config/Hyper` on Linux and macOS, or Electron's `userData`
on Windows. This is the "Hyper tree". In development mode it moves to the
repository root if a `config.json5` exists there. The module exports `cfgDir`,
`cfgPath`, and, on this branch, `keybindingsFile` and `keybindingsPath`. EP-P
adds the higher-priority "Velocetty tree" (see `Additional requirement`). The
CLI (`cli/api.ts` `resolveConfigPath`) computes the same Hyper paths
independently, for plugin commands.

Start-up (`setup()` in `app/config.ts`) and every reload call `_import()` from
`createConfigImportModule` (`app/config/import.ts`). Today `_import()` does the
following:

1. Creates the plugin directories and copies the configuration schema.
2. Loads the bundled defaults, and writes `config.json5` from them if it is
   missing.
3. Reads `app/keymaps/<platform>.json` into the defaults.
4. Loads `config.json5`, falling back to defaults on error.
5. Loads `keybindings.json5` through the earlier delivery's module,
   bootstrapping it if missing.
6. Calls `_init` (`app/config/init.ts`), which computes
   `keymaps: mapKeys({...defaultCfg.keymaps, ...userCfg.keymaps})`. A user
   entry therefore replaces the default for that command.
   `app/utils/map-keys.ts` normalizes values to arrays, rewrites `cmd` to
   `command`, and expands `<command>:prefix` entries into numbered commands.

`app/config.ts` then notifies "Configuration updated" and calls its
subscribers: menus (`app/start.ts`), windows (`app/ui/window.ts`, which sends
`config change` to the renderer), plugins, and the updater. After that,
`app/plugins.ts` `getDecoratedKeymaps` merges runtime plugin keybindings and
runs plugin `decorateKeymaps` hooks.

`app/config/json5-config.ts` provides two helpers:

- `parseJson5WithSchemaDiagnostics`, which returns
  `{value, diagnostics, usedFallback}`. Its diagnostics have the shape
  `configValidationDiagnostic`: `path`, `message`, `suggestedFix`, and the
  optional `docHint` and `defaultHint`.
- `stringifyJson5`, which writes sorted keys with a two-space indent.

Terms used in this plan:

- JSON5: a superset of JSON that allows comments, trailing commas, and
  unquoted keys.
- Last known good (LKG): the most recent user keybindings accepted from disk
  in this session.
- Observation: one read of `keybindings.json5`, classified as `valid` (with
  keymaps), `missing`, `invalid`, or `unreadable`. `valid` and `missing` are
  "accepted"; the other two are "rejected".
- Bootstrap: creating `keybindings.json5` at start-up when it is missing.
- Port and adapter: a port is an interface that a component declares for
  something it needs from the outside world, such as "read and write the
  keybindings text". An adapter implements a port, such as the file-system
  store. A driven port is one the application calls outwards.
- Canonical serialization: `stringifyJson5` output with a header comment,
  used only when bootstrap creates the file.
- Zod: the runtime schema-validation library used across the repository.
- chokidar: the file-watching library used by the main process (version 3.6).
- fast-check: a property-based testing library. It generates many inputs for
  a stated property, and shrinks any counterexample it finds.
- LemmaScript: a tool that translates TypeScript annotated with `//@`
  comments into Dafny. `lsc gen` generates artefacts, `lsc check` generates and
  verifies them, and `lsc regen` regenerates while keeping proof additions.
- Dafny: a verification-aware language whose verifier proves the annotated
  contracts.
- Mousetrap: the keyboard-shortcut library behind Hyper's shortcut syntax,
  such as `ctrl+shift+t` or `command+]`.

Tests run with `bun test --concurrent --isolate test/unit` through `make test`.
Per-test temporary directories and injected dependencies are the norm
(`docs/developers-guide.md` §Unit tests (Bun)). The repository has no property
tests or proofs yet.

The fast end-to-end lane, `bun run test:e2e:fast`, launches Electron with an
isolated home directory (`test/e2e/electron-e2e-helpers.ts`
`createIsolatedE2EEnvironment`). It reads stdout markers that `app/rpc.ts`
emits when `RUN_E2E=1`, such as `[e2e] renderer-ready`. CI runs it on Linux,
macOS, and Windows for every pull request.

## Conformance basis

No Terms of Reference document exists. The upstream artefacts are as follows.

`docs/velocetty-design.md` at `main` revision `40949b2f`:

- DES-CFG-FILES: keybindings live in `keybindings.json5`, separate from
  `config.json5`.
- DES-CFG-KB-LAYER: keybindings layer as built-in, then plugin, then user,
  then optional workspace overrides. This plan delivers user over built-in
  only; the plugin position is recorded as a deviation and workspace overrides
  are deferred.
- DES-CFG-VALID: JSON5 parsing, a pinned JSON Schema in `shared/schemas/`,
  and structured diagnostics.
- DES-CFG-LKG: on error, keep last known good, notify without blocking, and
  log full diagnostics.
- DES-CFG-HOT: keybindings reload without a restart.
- DES-KB-EXPORT: the keybinding editor exports and imports JSON5. This item
  prepares it; `4.2.2` delivers it.

`docs/roadmap.md` item `3.2.1`:

- RM-321-RW: "Provide read/write utilities with schema validation."
- RM-321-XI: "Support export/import in the same format."
- RM-321-OK: "keybinding edits persist and hot-reload cleanly."

Pull request #67 review findings:

- REV-67-LKG: last known good over bootstrap fallback.
- REV-67-BOOT: no empty bootstrap after a `config.json5` fallback.
- REV-67-WATCH: `add` and `unlink` handling.
- REV-67-FLAG: `usedLastKnownGood` reflects actual use.
- REV-67-SIMPLE: drop the redundant path wrapper types.
- REV-67-DOCS: define acronyms; keep the plan a living draft.

Approver direction of 2026-10-29 (see `Additional requirement`):

- REQ-TREE-NEW: the new file lives in a Velocetty-named tree.
- REQ-TREE-PRIORITY: the Velocetty tree outranks the Hyper tree.
- REQ-TREE-LEGACY: the Hyper tree stays supported, but receives no new
  configuration files.
- REQ-TREE-XDG: prefer an XDG configuration directory on Linux.

This also realizes the design's paths table (DES-CFG-FILES), which proposes
`Velocetty` directories.

ADR-007 (Proposed) records this item's format decisions. ADR-008 (Proposed)
records the configuration tree.

The governing standards are `AGENTS.md`, `docs/documentation-style-guide.md`,
`docs/developers-guide.md`, ADR-001 (bun:test), and ADR-005 (layered end-to-end
lanes).

Trace links:

```plaintext
DES-CFG-FILES, RM-321-RW -> keybindings-codec.ts, keybindings-store.ts, keybindings.ts -> EP-C, EP-D
  -> KB-COD-1, KB-COD-2, KB-STORE-1
DES-CFG-VALID -> keybindings-codec.ts, shared/schemas/keybindings.schema.json -> EP-C -> KB-COD-2, KB-COD-3
DES-CFG-LKG, REV-67-LKG, REV-67-FLAG -> keybindings-policy.ts observeKeybindings -> EP-B, EP-D
  -> KB-POL-1 (proof), KB-SVC-2 (model test)
REV-67-BOOT -> keybindings-policy.ts decideBootstrap, keybindings.ts start -> EP-B, EP-D
  -> KB-POL-2 (proof and exhaustive table), KB-SVC-3
RM-321-XI, DES-KB-EXPORT -> keybindings.ts importKeybindings, exportKeybindings -> EP-D -> KB-SVC-1
RM-321-OK, DES-CFG-HOT, REV-67-WATCH -> watcher.ts, app/config.ts -> EP-E -> KB-WATCH-1, E2E-KB-1 to E2E-KB-4
DES-CFG-KB-LAYER (user over core only) -> app/config/init.ts (unchanged) -> EP-E -> KB-LAYER-1
REV-67-SIMPLE, REV-67-DOCS -> EP-D, EP-F -> review, markdownlint
REQ-TREE-NEW, REQ-TREE-PRIORITY, REQ-TREE-LEGACY, REQ-TREE-XDG, DES-CFG-FILES
  -> config-tree.ts (app and shared mirror), paths.ts, cli/api.ts -> EP-P -> KB-PATH-1, KB-PATH-2
  -> EP-E -> E2E-KB-0, E2E-KB-1
```

## Verification plan

The load-bearing decisions are small pure functions in
`app/config/keybindings-policy.ts`, and they carry proofs. The wiring around
them is covered by a model-based property test. I/O is covered by
fault-injection tests against a real temporary directory. Behaviour across the
whole system is covered by end-to-end tests.

### Axioms

These are trusted, not verified here:

- AXIOM-JSON5: `json5@2` `parse` and `stringify` round-trip JSON values.
  Deeply nested input may throw `RangeError`, which the codec must catch.
- AXIOM-ZOD: `zod@4` (`app/`'s 4.6.x copy) validates records and unions as
  documented, returning accepted data unchanged.
- AXIOM-AJV: `ajv` 6.14.0, forced by the root `overrides`, validates JSON
  Schema draft-07.
- AXIOM-CHOKIDAR: chokidar 3.6, watching a directory at `depth: 0` with
  `ignoreInitial: true`, emits `add`, `change`, and `unlink` for files in that
  directory on Linux, Windows, and macOS (`fsevents`). It does not guarantee
  merging of rename-saves; the debounce does that.
- AXIOM-FS: `fs.renameSync` within one directory replaces the destination
  atomically on POSIX file systems. On Windows it may fail transiently with
  `EPERM`, `EACCES`, or `EBUSY`. `fs.fsyncSync` makes data durable before the
  rename.
- AXIOM-ELECTRON: one main process performs all application writes, and the
  main thread runs start-up and reloads without interleaving. External editors
  may write at any time, and the last writer wins.
- AXIOM-LEMMASCRIPT: `lsc` 0.6.5 translates the supported subset faithfully,
  and Dafny 4.11 is sound. `//@ extern emptyUserKeymaps()` is the only admitted
  axiom in the policy proof.

### KB-POL-1: last-known-good soundness

Statement. Define `specLatestAccepted(history)` as follows. It is the payload
of the latest accepted observation in `history`: the observation's keymaps for
`valid`, or `emptyUserKeymaps()` for `missing`. If no observation has been
accepted, it is `null`. Then, for every finite history, the following hold:

- `replayKeybindingObservations(history).lastAccepted === specLatestAccepted(history)`.
- `observeKeybindings` gives each observation kind its status:
  - for `invalid` or `unreadable`, the state is unchanged and
    `status === 'kept'`;
  - for `valid` or `missing`, `lastAccepted` becomes the observation's
    payload and `status === 'applied'`;
  - `usedLastKnownGood` holds exactly when `status === 'kept'` and the prior
    `lastAccepted !== null` (REV-67-FLAG).
- Idempotence: `observe(observe(s, o).state, o).state === observe(s, o).state`.
  This covers the watcher re-reading text the service just wrote.

Method. A LemmaScript proof with the Dafny backend:

- `replayKeybindingObservations` is the shipped forward `for-of` fold. It
  carries
  `//@ invariant state.lastAccepted === specLatestAccepted(history.slice(0, i))`.
- `specLatestAccepted` is an independent backward recursion over
  `history.slice(0, history.length - 1)`, with `//@ decreases history.length`.
  It does a literal inline `switch` on `kind`, and shares no helper with
  `observeKeybindings`.

The theorem is therefore a fold-against-backward-search equivalence, not a
restatement.

Rationale. This is the design's central promise and the exact defect found in
review, and it must hold for every history.

Domain. Every finite observation sequence. The keymap payload is opaque, which
is sound because the policy only passes payloads through.

Artefacts:

- `app/config/keybindings-policy.ts`
- `app/config/keybindings-policy.dfy`
- `app/config/keybindings-policy.dfy.gen`
- `LemmaScript-files.txt`

Evidence:

- Red: with `ensures` clauses over stub bodies, `make prove` exits non-zero
  and names the unproved postconditions.
- Green: `make prove` ends with a line matching
  `Dafny program verifier finished with <N> verified, 0 errors`, with `N ≥ 1`.

Non-vacuity:

- Named example lemmas in the `.dfy`, such as
  `replay([valid(k), invalid]).lastAccepted == k`,
  `replay([valid(k), missing, invalid]).lastAccepted == empty`, and
  `replay([invalid]).lastAccepted == null`, exhibit every observation kind.
- `requires` is `true`.
- Each of the following negative controls is applied separately and
  reverted, and each must make `make prove` exit non-zero, naming the violated
  `ensures`:
  - (a) the `invalid` branch returns `{lastAccepted: emptyUserKeymaps()}`,
    the policy-level form of the pull request #67 defect;
  - (b) `missing` is treated as rejected.
- Record both transcripts in `Artefacts and notes`.

### KB-POL-2: bootstrap safety

Statement. `decideBootstrap({file, legacy})` decides what start-up may write.

Inputs:

- `file` is `'present'`, `'missing'`, or `'unreadable'`, mirroring
  `KeybindingsReadOutcome`.
- `legacy` is one of five classes:
  - `parsed-keymaps`: a non-empty map that the codec validated;
  - `parsed-empty`: an empty map or none;
  - `parsed-invalid`: the codec rejected the keymaps;
  - `freshly-created`;
  - `fell-back`.

Decision rules:

- Only `file === 'missing'` may give `seed`.
- `present` and `unreadable` give `write-nothing`, so an unreadable file is
  never overwritten.
- With the file missing:
  - `parsed-keymaps` seeds exactly those keymaps (the `ensures` relates the
    payload);
  - `parsed-empty` and `freshly-created` seed the empty map;
  - `parsed-invalid` and `fell-back` give `defer`.

Separately, `bootstrapObservation(decision, writeOutcome)` maps the decision
and the write result to the observation `start` must apply:

- seed and written: `valid(k)`;
- seed and failed: `valid(k)`, applied in memory with a notification;
- defer: none;
- write-nothing: the result of reading the file.

Method. An exhaustive table test over all 3 × 5 = 15 input-kind combinations,
plus LemmaScript `ensures` clauses that guard the contract for every payload.

Rationale. This is contractual migration logic, and its domain of kinds is
finite.

Artefacts:

- `test/unit/keybindings-policy.test.ts`
- `app/config/keybindings-policy.ts`

Evidence:

- Red: the table fails against a stub that returns `write-nothing`.
- Green: all 15 rows pass, and `make prove` is clean.

Non-vacuity:

- Each row is a distinct witness.
- Restoring "fell-back seeds `{}`" must fail both the table and the proof.
- Letting `unreadable` seed must fail both.

### KB-COD-1: codec round trip

Statement. For every admissible keymap `k`:

- `parseKeybindingsText(serializeKeybindings(k), label)` returns `ok` with
  entries equal to `k`'s, compared as sorted `Object.entries`;
- `serializeKeybindings` is idempotent through a parse;
- its output does not depend on insertion order.

The plan claims nothing about key order, because integer-like keys always
enumerate first in JavaScript.

Method. A fast-check property, at `numRuns: 500`, with a logged seed.

Rationale. An infinite domain with adversarial keys.

Domain. `fc.dictionary(commandIdArb, bindingArb, {noNullPrototype: true})`,
assembled with `Object.fromEntries`.

- `commandIdArb` is weighted: 1 for
  `constantFrom('__proto__', 'constructor', 'toString', 'valueOf')`, 1 for
  integer-like strings, and 4 for trimmed, non-empty binary strings built by
  construction, not by filtering.
- `bindingArb` covers strings and arrays, including empty arrays.

Artefacts:

- `test/unit/keybindings-codec.property.test.ts`
- `test/testUtils/keybindings-arbitraries.ts`

Evidence:

- Red: fails against a stub serializer.
- Green: passes.

Non-vacuity: `test/unit/keybindings-arbitraries.coverage.test.ts` draws
`fc.sample(arb, 2000)` and asserts each class above 5%:

- prototype-named keys;
- integer-like keys;
- string values;
- array values;
- empty arrays.

The mutation that removes key sorting must fail the insertion-order property.

### KB-COD-2: parser totality and diagnostics

Statement. For any input, `parseKeybindingsText` returns without throwing. It
returns either `ok`, with keymaps that satisfy `isKeymapConfig`, or `invalid`,
with at least one diagnostic whose `path`, `message`, and `suggestedFix` are
all non-empty.

Method. A fast-check property over
`fc.oneof(validDoc, corruptedValidDoc, fc.string({unit: 'binary'}), jsonValueDoc)`,
plus named examples for each rejection class:

- a non-object root;
- a number value;
- a nested object;
- an empty command identifier;
- a whitespace-only shortcut;
- an array element that is not a string;
- a syntax error with line and column;
- a `$schema` key, which is accepted and ignored;
- an invalid `$schema` value, which Ajv rejects as well;
- `'['.repeat(100_000)`, whose deep nesting JSON5 reports as a syntax error on
  Bun 1.4.4, so no separate depth path exists.

Rationale. The codec sits on a trust boundary, because users type into the file.

Artefacts:

- `test/unit/keybindings-codec.property.test.ts`
- `test/unit/keybindings-codec.test.ts`

Evidence: red against a stub that throws, then green.

Non-vacuity: a coverage test asserts both outcomes above 10% of samples.

### KB-COD-3: JSON Schema parity

Statement. The committed `shared/schemas/keybindings.schema.json` equals
`z.toJSONSchema(keybindingsSchema, {target: 'draft-7'})`, as generated by
`bun bin/generate-keybindings-schema.ts`. Under `ajv`, it accepts and rejects
the same fixture corpus as the codec.

Method. A named-example test that iterates over the fixture corpus.

Artefacts:

- `test/unit/keybindings-schema-parity.test.ts`
- `test/fixtures/keybindings/*.json5`

Evidence: written in red before the generator exists, and failing with a
missing file; then green.

Non-vacuity: the corpus has at least one accepted and one rejected document per
KB-COD-2 rejection class. Negative control: hand-editing the committed schema
must fail the parity test.

### KB-SVC-1: import and export laws

Statement:

- For valid text `t`, `importKeybindings(t, label)` returns `written`, the
  store holds exactly `t`, and the service state is unchanged until the next
  `reload()`. After that reload, `active` equals the parse of `t`.
- For invalid `t`, import returns `invalid` with diagnostics, and writes
  nothing.
- When the store write fails, import returns `failed`, and the stored text and
  state are unchanged.
- `exportKeybindings()` returns `stored` with the verbatim text when the file
  is valid, `invalid` with the text and diagnostics when it is not, and
  `missing` or `unreadable` otherwise. It never writes, never notifies, and
  never changes state.

Method. A fast-check property over the service, with an in-memory store that
counts writes and can be set to fail.

Artefact: `test/unit/keybindings-service.property.test.ts`.

Evidence: red against the earlier module (which canonicalizes on import, and
loads on export), then green.

Non-vacuity: a coverage test shows valid and invalid inputs each above 20%. The
mutation "canonicalize on import" must fail the verbatim law.

### KB-SVC-2: the service refines the policy

Statement. Consider any command sequence. External commands set the file to
text with an expected label, delete it, or make it unreadable. Service commands
are `start` (once, first), `reload`, `importKeybindings`, and
`exportKeybindings`. After each command:

- the service's `active` keymaps deep-equal `specLatestAccepted(modelHistory)`,
  or empty when that is `null`;
- `usedLastKnownGood` matches the model;
- the store write count matches the model.

Method. A fast-check `fc.modelRun` (synchronous) with `maxCommands: 50`, and
`replayPath` logged.

- The model is `{file: {text, label} | 'missing' | 'unreadable', history}`.
- The model is updated only by commands. Generators produce
  `(text, expectedLabel)` pairs, so the codec is not the oracle.
- `reload` appends the model's label.

Rationale. The proof covers the reducer; this test covers the wiring that feeds
it, where the pull request #67 defect actually lived.

Artefact: `test/unit/keybindings-service.model.test.ts`.

Non-vacuity:

- Command statistics show every command.
- Negative control (c): on a rejected read, the service applies the legacy or
  bootstrap keymaps instead of the policy result. The test must then shrink to
  a counterexample of the form `[set valid A, start, set invalid, reload]` with
  legacy keymaps `B ≠ A`. Record the transcript.

### KB-SVC-3: start-up and reload write discipline

Statement:

- `reload()` never calls `store.write`, and no reload creates `config.json5`
  or a plugin directory.
- `config.json5` is created at start-up only when the active tree is
  `velocetty`.
- `start()` calls it at most once, and only when `decideBootstrap` returns
  `seed`.
- No keybinding code writes `cfgPath`.

Method. Named examples through the real importer and a real temporary directory.
`test/testUtils/config-import-harness.ts` gains a `config.json5` byte
comparison.

Artefact: `test/unit/config-import-keybindings-json5.test.ts`, rewritten.

Non-vacuity:

- The last-known-good case uses legacy keymaps that differ from the file, so
  the earlier coincidence cannot recur.
- A mid-session delete of `keybindings.json5`, followed by `reload`, must
  leave no file.
- With the Hyper tree active, removing `Hyper/config.json5` (or all of
  `Hyper/`) and calling `reload` must leave both absent.

### KB-STORE-1: atomic, non-destructive writes

Statement. A write either leaves the previous bytes intact or replaces them
whole. Beyond that:

- the target's mode is preserved;
- a symlinked target keeps its link, and the real file is replaced;
- no temporary file remains after a failed write that returned;
- a read-only target reports `failed`.

Method. Parameterized fault-injection tests against a real temporary directory.
An injected `KeybindingsFileSystem` fails at each step: open, write, `fsync`,
chmod, rename, and the transient rename-retry path.

Artefact: `test/unit/keybindings-store.test.ts`.

Evidence: red against a direct `writeFileSync` adapter, then green.

Non-vacuity:

- Each injected fault point is asserted to be reached.
- The negative control is the direct-write adapter, whose mid-write fault
  case must fail.

A process crash can still leave a temporary file behind. Start-up cleanup
removes it, and a named test covers that.

### KB-WATCH-1: coalesced, complete reload triggering

Statement. Let `d` be `debounceMs`. A burst is a maximal run of events whose
consecutive gaps are less than `d`. The watcher calls `onReload` exactly once
per burst, at the burst's last event time plus `d`, and at no other time.

On a tie, the fake clock fires due timers before delivering events, so a gap of
exactly `d` starts a new burst. Also:

- `close()` cancels a pending timer;
- events during `onReload` start a new burst;
- a throwing `onReload` is logged and does not disable the watcher;
- no reload happens before the first real event (`ignoreInitial`).

A continuous stream of events closer together than `d` postpones reload
indefinitely, by design, and this is documented.

Method. A fast-check property with an injected scheduler and fake clock. Gaps
come from
`fc.oneof(fc.constantFrom(0, d - 1, d, d + 1),
fc.integer({min: 0, max: 3 * d}))`.
Event kind (`add`, `change`, `unlink`) and path are drawn independently.

Artefact: `test/unit/config-watcher.property.test.ts`.

Evidence: red against a stub of the current per-event timer behaviour, then
green.

Non-vacuity: a coverage test shows single events, bursts of five or more, and
exact-`d` gaps, each above 5%.

### KB-LAYER-1: user over core layering (characterization)

Statement. Take default keymaps `d` and user keymaps `u`, neither containing
`:prefix` keys or `cmd` substrings. Then:

- every command in `u` maps to `u`'s value, normalized to an array; `[]`
  unbinds;
- every command only in `d` keeps `d`'s value.

Method. A fast-check property over `_init`. It is expected to pass on its first
run, because it documents existing behaviour.

Artefact: `test/unit/config-keymap-layering.property.test.ts`.

Non-vacuity:

- A coverage test shows overlapping and disjoint commands, each above 20%.
- Negative control: swapping the spread order in `_init` must fail the
  property.

### KB-PATH-1: configuration tree resolution

Statement. `resolveConfigLocations(input)` is pure. Its inputs are the
environment (`XDG_CONFIG_HOME`), the platform, the home directory, the Electron
`appData` and `userData` directories, the development flag and directory, and an
`exists(path)` predicate. It returns:

- `velocettyDirectory`;
- `config`, holding the active `config.json5` path, its tree (`velocetty`,
  `hyper`, or `development`), and whether it exists;
- `keybindingsPath`;
- `shadowed`, the paths of any lower-priority `config.json5` that the active
  one hides.

These must hold over the whole domain:

- Priority: if `Velocetty/config.json5` exists, it is active, and any existing
  Hyper copy appears in `shadowed`. Otherwise the Hyper tree's rules apply
  exactly as `app/config/paths.ts` applies them today.
- Creation: if no candidate exists, the active path is
  `<velocettyDirectory>/config.json5`, with `exists: false`.
- Keybindings: `keybindingsPath` is always in `velocettyDirectory`, except in
  development mode with a repository-root config, where it is beside that
  config.
- Legacy safety: no returned path that the caller may create (an active path
  with `exists: false`, or `keybindingsPath`) lies in the Hyper tree.
- XDG: an absolute, non-empty `XDG_CONFIG_HOME` gives
  `<XDG_CONFIG_HOME>/Velocetty` on every platform. An empty or relative value
  falls back to the platform default.
- Hyper compatibility: when `Velocetty/config.json5` is absent and at least
  one Hyper-tree or development candidate exists, `config.path` equals the
  oracle's `cfgPath`, `config.exists` is true, and `tree` is `hyper` or
  `development`. `keybindingsPath` and the creation path are not compared with
  the oracle. The oracle keeps today's laxer rule for the Hyper tree, under
  which any non-empty `XDG_CONFIG_HOME` counts.

Method. Exhaustive enumeration with named invariant checks. The domain is all
combinations of five existence flags (Velocetty `config.json5`, Hyper
`config.json5`, Hyper `hyper.json`, development `config.json5`, development
`hyper.json`), three platforms, four `XDG_CONFIG_HOME` states (unset, empty,
relative, absolute), and the development flag: 32 × 3 × 4 × 2 = 768 cases.

The invariants are stated independently of the implementation, for example "if
`exists` is false then the path starts with `velocettyDirectory`". The
Hyper-compatibility invariant compares against a frozen copy of today's
resolution logic, kept as a test oracle.

Path functions (`isAbsolute`, `join`) come from `path.win32` or `path.posix`
according to `input.platform`, as `cli/api.ts` already does, so Linux test runs
simulate Windows faithfully. The "absolute" `XDG_CONFIG_HOME` value is `/xdg`
on POSIX and `C:\xdg` on win32.

Named examples beside the enumeration:

- win32 drive-relative `C:xdg`, which is ignored;
- an MSYS-style `/c/Users/x/.config`, which is accepted as root-relative,
  matching the Hyper tree;
- a symlinked Velocetty tree pointing at the Hyper tree, which gives no
  shadow notice;
- a broken-symlink Hyper `config.json5`, which is active, with nothing
  created.

Rationale. The domain is finite once paths are abstracted to existence flags,
so complete enumeration is an exhaustive proof for that abstraction. Path
joining is axiomatic (`node:path`).

Artefacts:

- `app/config/config-tree.ts`
- `test/unit/config-tree.test.ts`
- `test/testUtils/legacy-hyper-paths-oracle.ts`

Evidence. Red: the test fails against a stub that returns the Hyper paths.
Green: all 768 cases satisfy every invariant.

Non-vacuity:

- Assert that each invariant's antecedent holds in at least one case. For
  example, some cases have `exists: false`, and some have a shadowed copy. The
  Hyper-compatibility antecedent holds on each of the three platforms.
- Negative controls:
  - swapping the Velocetty and Hyper priority must fail the priority
    invariant;
  - creating in the Hyper tree must fail legacy safety;
  - accepting a relative `XDG_CONFIG_HOME` must fail the XDG invariant.

### KB-PATH-2: CLI parity

Statement. `shared/src/config/config-tree.ts` returns the same result as
`app/config/config-tree.ts` for every case in the KB-PATH-1 enumeration.
`cli/api.ts` `resolveConfigPath` returns the shared resolver's active config
path.

Method. A parity test over the full enumeration, plus updated CLI behaviour
tests.

Artefacts:

- `test/unit/config-tree-parity.test.ts`
- `test/unit/cli-api-behaviour.test.ts`, updated

Evidence. Red: the parity test fails while the mirror is missing. The CLI tests
fail while they still expect Hyper creation paths.

Non-vacuity: a single-character change to the mirror's directory name must fail
parity.

### End-to-end obligations

These run in the fast lane, using the development-output launch (`RUN_E2E=1`)
and an isolated home directory. All four scenarios share one launch. The test
timeout is 90 seconds, and each marker wait allows 10 seconds.

Artefacts:

- `test/e2e/keybindings.e2e.test.ts`
- `test/e2e/electron-e2e-helpers.ts`, extended to expose
  `velocettyConfigDir` (`<tempHome>/Velocetty`) and `hyperConfigDir`
  (`<tempHome>/Hyper`), and to seed files before launch. The helper already sets
  `XDG_CONFIG_HOME` to the temporary home on every platform, so both trees
  resolve inside it.

Markers, emitted by `app/config.ts` only under `RUN_E2E=1`:

- `[e2e] keybindings-path <path>` and `[e2e] config-path <path>`
- `[e2e] config-watcher-ready`, on chokidar's `ready` event.
- `[e2e] keymaps-active status=<applied|kept> window:new=<normalized, comma-joined>`.
  This is printed once at start-up and once per reload, after subscribers run.
  It covers only the commands listed in `E2E_KEYMAP_PROBE`.

Precondition: the probe value `ctrl+alt+shift+n` appears in no
`app/keymaps/*.json`, and a unit test asserts this.

Scenarios:

- E2E-KB-0, fresh install, in a separate short launch:
  - Seed nothing.
  - Expect:
    - `config.json5` and `keybindings.json5` are created under
      `<tempHome>/Velocetty`;
    - no configuration file (`config.json5`, `hyper.json`,
      `keybindings.json5`, `schema.json`, `keybindings.schema.json`) appears
      under `<tempHome>/Hyper`.
- E2E-KB-1, migration and persistence:
  - Seed: a legacy `config.json5` in the Hyper tree (`<tempHome>/Hyper`) with
    `keymaps: {'window:new': 'ctrl+alt+shift+n'}`, and no `keybindings.json5`
    anywhere.
  - Expect:
    - after launch, `<tempHome>/Velocetty/keybindings.json5` holds that map;
    - no configuration file name (`config.json5`, `hyper.json`,
      `keybindings.json5`, `schema.json`, `keybindings.schema.json`) appears
      in `<tempHome>/Hyper` unless it was seeded;
    - the Hyper `config.json5` bytes are unchanged, and it is still the
      active config, as reported by `[e2e] config-path`. The seed already
      holds `config.plugins['velocetty.golden-path-demo']` equal to that
      plugin's `settingsDefaults`, so runtime-plugin default persistence is a
      no-op;
    - the marker reports `ctrl+alt+shift+n`;
    - `[e2e] keybindings-path` is inside the isolated directory.
- E2E-KB-2, hot reload:
  - After `config-watcher-ready`, write `{'window:new': 'ctrl+alt+shift+m'}`
    directly.
  - Expect `status=applied window:new=ctrl+alt+shift+m`.
  - Then write by temporary file and rename, with Windows retry, and expect
    the same marker for a third value.
- E2E-KB-3, invalid reload keeps last known good:
  - Write invalid JSON5.
  - Expect `status=kept` with the previous value still printed.
- E2E-KB-4, deletion:
  - Delete the file.
  - Expect `status=applied` with the platform default, and expect the file not
    to be recreated within 2 seconds.
- Second launch:
  - Relaunch after restoring a valid file.
  - Expect `keybindings.json5` bytes and mtime and `config.json5` bytes to be
    unchanged.

Pressing keys and menu accelerators are checked manually
(`Validation and acceptance`). The spawn driver cannot send keystrokes.

No further non-trivial invariant exists. The schema is declarative, and the
CLI, renderer, and menu consumers are unchanged.

## Plan of work

Commit after each green step, and again after each refactor step, as separate
commits. Every commit must pass `make check-fmt`, `make typecheck`,
`make lint`, and `make test`, plus `make prove` from EP-B onwards. Use the
`commit-message` skill. Run the gates through the `scrutineer` agent where
available.

### Stage A: tooling (EP-A)

Run `bun add -d fast-check@^4.10.2 lemmascript@0.6.5` and commit `package.json`
and `bun.lock`. Add `LemmaScript-files.txt` at the repository root. Each line
holds a repository-relative path and an optional per-file timeout in seconds of
60 or less. To start with, it lists `test/proofs/sample.ts`, a trivial verified
function.

Add `bin/prove.sh`. It checks that `dafny --version` reports 4.11, and prints
installation guidance if not. It then runs `bunx lsc check --backend=dafny`
with no file argument, followed by the guards described under `Risks`.

Add a `prove` target to `Makefile` that calls `bin/prove.sh`, and add `prove` to
`all`. Validate the Makefile with `mbake validate Makefile` and
`checkmake Makefile`. Add `*.dfy.gen` to the Biome and markdownlint ignore
lists. Confirm that `build/esbuild/copy-artefacts.ts` does not package `*.dfy*`
files.

Add the Linux-only CI step, guarded by `if: runner.os == 'Linux'` like the
existing spelling step. It installs Dafny 4.11.0 and runs `make prove`.

Red: run `make prove` with a planted false `ensures` in
`test/proofs/sample-false.ts` listed in `LemmaScript-files.txt`. It must exit
non-zero and name the postcondition.

Green: remove the planted entry, after which `make prove` exits 0.

Record both transcripts, then run the four gates.

### Stage P: Velocetty configuration tree (EP-P; runs after EP-A)

Red:

- Write `test/testUtils/legacy-hyper-paths-oracle.ts`, a frozen copy of
  today's resolution logic in `app/config/paths.ts`, rewritten as a pure
  function.
- Write `test/unit/config-tree.test.ts` (KB-PATH-1) and
  `test/unit/config-tree-parity.test.ts` (KB-PATH-2).
- Run `bun test --isolate test/unit/config-tree.test.ts`. It must fail with
  `Cannot find module '../../app/config/config-tree'`. Once a stub that returns
  Hyper paths exists, it must fail the priority and creation invariants.

Green:

- Create `app/config/config-tree.ts`, holding `resolveConfigLocations` and its
  types. It imports nothing from Electron and does no I/O; `exists` is injected.
- Make `app/config/paths.ts` call it with real inputs: `process.env`,
  `process.platform`, `homedir()`, `app.getPath('appData')`,
  `app.getPath('userData')`, `isDev`, the development directory, and a
  `statSync`-based `exists`.
- Export `velocettyDir`, `configTree`, and `shadowedConfigPaths` alongside
  the existing names. `cfgDir` remains the directory of the active
  `config.json5`.
- Create `shared/src/config/config-tree.ts` as a mirror, with a header
  comment pointing at the parity test.
- Make `cli/api.ts` `resolveConfigPath` delegate to the mirror. Keep the
  existing Hyper-precedence tests in `test/unit/cli-api-behaviour.test.ts` as
  regression tests. Add these red tests first:
  - (a) nothing exists, giving `<XDG>/Velocetty/config.json5`;
  - (b) both trees exist, giving the Velocetty path;
  - (c) `XDG_CONFIG_HOME='rel'` on Linux, giving
    `<home>/.config/Velocetty/config.json5`;
  - (d) Windows with `APPDATA` unset, and with it blank, giving
    `<home>\AppData\Roaming\Velocetty\config.json5`;
  - (e) `cli/index.ts` reporting "not found" with the Velocetty path.
- Update `app/index.mts` `--help` output to print the keybindings path and the
  active tree as well. `test/unit/app-startup-order.test.ts` keeps its existing
  assertion.

Refactor, then run the four gates and `make prove`. EP-P changes only path
resolution. The importer still creates `keybindings.json5` beside the active
config until EP-D, which is acceptable at this plateau: no release ships
between milestones. EP-D moves creation to `keybindingsPath` and the tests
prove it.

### Stage B: policy core with proof (EP-B; prototyping first)

The prototype is time-boxed to 4 hours. Write
`app/config/keybindings-policy.ts` with the types and contracts from
`Interfaces and dependencies`, and stub bodies. List it in
`LemmaScript-files.txt`. The go/no-go checks are:

1. `lsc gen` succeeds on the real file.
2. `dafny resolve` succeeds on the generated `.dfy.gen`.
3. With stub bodies, exactly the expected `ensures` fail.
4. With real bodies, KB-POL-1 and KB-POL-2 verify with at most three helper
   lemmas, each obligation under 60 seconds, and only `emptyUserKeymaps` as an
   axiom.

If check 1 or 2 fails, apply the `//@ declare-type` fallback and record it. If
check 3 or 4 fails within the time box, escalate.

Red: `bun test --isolate test/unit/keybindings-policy.test.ts` fails on the
15-row table and the named transitions, with messages such as
`expected "seed" but got "write-nothing"`. `make prove` also reports the
unproved postconditions.

Green: implement `observeKeybindings`, `replayKeybindingObservations`,
`specLatestAccepted`, `decideBootstrap`, and `bootstrapObservation`. Add the
example lemmas and helper lemmas in the `.dfy`. Run negative controls (a) and
(b), record their output, and revert them.

Refactor, rerun the focused tests and `make prove`, then the four gates.

### Stage C: codec and JSON Schema (EP-C)

Red: write `test/unit/keybindings-codec.test.ts`,
`test/unit/keybindings-codec.property.test.ts`,
`test/testUtils/keybindings-arbitraries.ts`,
`test/unit/keybindings-arbitraries.coverage.test.ts`, and
`test/unit/keybindings-schema-parity.test.ts`. Run
`bun test --isolate test/unit/keybindings-codec.test.ts`. It must fail with
`Cannot find module '../../app/config/keybindings-codec'`.

Green: create `app/config/keybindings-codec.ts`. It holds the Zod schema (moved
from `app/config/keybindings.ts`, tightened as in ADR-007, with `$schema`
ignored), along with:

- `parseKeybindingsText`, which catches `RangeError`;
- `serializeKeybindings`, which writes a header comment and then
  `stringifyJson5`;
- `toRawKeymaps`, a copying conversion to the mutable `rawConfig['keymaps']`
  shape, replacing `cloneKeymaps`.

Make `loadPlatformKeymap` in `app/config/import.ts` use the codec. Add
`bin/generate-keybindings-schema.ts`, which runs under Bun and so resolves
`app/node_modules/zod`. It writes `shared/schemas/keybindings.schema.json` as
draft-07, and the existing `generate-schema` script calls it. Confirm that
`bun run generate-schema` leaves the tree clean.

Refactor, then run the gates and `make prove`.

### Stage D: store, service, and importer (EP-D)

Red: write the following tests.

- `test/unit/keybindings-store.test.ts` (KB-STORE-1), red against a
  direct-write adapter.
- `test/unit/keybindings-service.test.ts`: named examples, including
  notification wording and `usedLastKnownGood`.
- `test/unit/keybindings-service.property.test.ts` (KB-SVC-1).
- `test/unit/keybindings-service.model.test.ts` (KB-SVC-2).
- A rewritten `test/unit/config-import-keybindings-json5.test.ts`
  (KB-SVC-3). It fails against the current code: the last-known-good case
  asserts that the file's keymaps survive, and the current code returns the
  legacy keymaps.

Green: create `app/config/keybindings-store.ts` (`createFileKeybindingsStore`,
following the store design under `Risks`). Rewrite `app/config/keybindings.ts`
as `createKeybindingsService`. It declares the `KeybindingsStore` port,
composes store, codec, and policy, and exposes `start`, `reload`,
`importKeybindings`, and `exportKeybindings`.

In `app/config/import.ts`:

- declare `ConfigImportKeybindings`, `{start(legacy), reload()}`;
- accept the dependency;
- change `_import` to `_import(phase)`, returning `{config, report}`;
- classify the legacy source;
- split `getDefaultConfig` from `_importConf`;
- remove the duplicated `notifyWithPrimaryDiagnostic` in favour of one helper
  in `keybindings.ts`;
- define and export `ConfigImportNotify` once, and use it from `init.ts` and
  `keybindings.ts`.

In `app/config.ts`, the composition root, create the store and service, inject
them, and export `importKeybindings` and `exportKeybindings` for later items.
Create `velocettyDir` with `mkdirp` at start-up, and copy
`keybindings.schema.json` beside `keybindings.json5`. Make `ensureSchemaFile`
skip the Hyper tree unless the copy already exists there. When
`shadowedConfigPaths` is non-empty, notify once per process. Add the legacy
notifications and the `@deprecated` tag, then regenerate the schema. Update
`test/testUtils/config-import-harness.ts` and
`test/unit/config-keybindings-watch.test.ts` for the new `_import` shape. Delete
`test/unit/keybindings-json5.test.ts`, whose cases move into the service tests.

Run negative control (c), record it, and revert it.

Refactor until `import.ts` is 360 lines or fewer, then run the gates and
`make prove`.

### Stage E: watcher and end-to-end (EP-E)

Red: write the following tests.

- `test/unit/config-watcher.property.test.ts` (KB-WATCH-1), against a
  `watcher.ts` stub that mimics today's per-event timers. It must fail with a
  shrunk two-event counterexample.
- An extended `test/unit/config-keybindings-watch.test.ts`, covering:
  - directory watch options (`depth: 0`, `ignoreInitial: true`);
  - `add` and `unlink` handling;
  - the notification rules from the report;
  - one burst touching both files while `keybindings.json5` is invalid.
- `test/unit/config-keymap-layering.property.test.ts` (KB-LAYER-1), with its
  negative control.
- `test/unit/e2e-keymap-probe.test.ts`, the precondition test.
- `test/e2e/keybindings.e2e.test.ts`.

Green: implement `createConfigWatcher` in `app/config/watcher.ts`, and use it
from `_watch` in `app/config.ts` with the chokidar adapter. The adapter watches
the distinct directories of the active `config.json5` and of
`keybindings.json5`, each at `depth: 0`, filtered to the exact file paths. Emit
the `[e2e]` markers. Change `test:e2e:run` to
`bunx cross-env RUN_E2E=1 bun test test/e2e/`. Extend
`test/e2e/electron-e2e-helpers.ts` with `configDir` and file seeding.

Refactor, then run the gates and `make prove`. Run `bun run test:e2e:fast`
locally if `node-pty` builds; otherwise rely on CI. In both cases, confirm in
the CI log that the new suite ran on all three operating systems.

### Stage F: documentation and roadmap (EP-F)

Mark ADR-007 and ADR-008 `Accepted`, with dates and summaries, and reconcile
them with everything the implementation discovered.

In `docs/velocetty-design.md`:

- §Configuration system: JSON5 and layering gets the storage format, error
  behaviour, and migration. Its paths table records the Velocetty tree, its
  priority over the legacy Hyper tree, and the XDG rule;
- §Keybinding model notes that the stored format is the ADR-007 map, not the
  runtime `Keybinding` interface;
- §Keybinding editor UI cross-links ADR-007 and adds `keybindings.import`;
- implementation-plan items 3.1 and 3.2 are ticked.

Create `docs/users-guide.md` with a "Keyboard shortcuts" section, and link it
from `README.md`. Following `tutorial-howto-doc`, it covers:

- file location per platform: the Velocetty tree, the XDG rule, how the legacy
  Hyper tree is still read for `config.json5`, and how to open the file;
- how to move an existing configuration across: quit Velocetty, move
  `config.json5`, `schema.json`, and `plugins/` from the Hyper tree into the
  existing Velocetty directory, and restart. Do not move the other files in the
  Hyper directory, which are Electron application state;
- that the directory name is case-sensitive on Linux;
- format and examples;
- Mousetrap shortcut syntax, with modifier names per platform;
- `<command>:prefix` entries;
- unbinding with `[]`, and resetting with `{}`;
- hot reload, and what invalid files do at start-up and at reload;
- deletion, and the migration from `config.json5`;
- sharing by copying the file;
- current limits: duplicate shortcuts and unknown command identifiers are not
  yet reported, and legacy `decorateKeymaps` plugins can override user bindings.

Create `docs/configuration-architecture.md`. It covers:

- the `app/config` components and their ports;
- start-up and reload data flow, as a Mermaid diagram;
- the proof boundary, and the trusted adapters.

Link it from the design document, the developers' guide, and the component
inventory in `docs/velocetty-hyper-codebase.md`.

Update `docs/developers-guide.md`:

- replace the keybinding storage bullets with a link to the architecture
  document;
- remove the stale `test/unit/keybindings-json5.test.ts` reference;
- document property-test conventions (arbitraries, coverage tests, seeds) and
  proof conventions (`make prove`, `.dfy` additions-only, `lsc regen`);
- document the `[e2e]` marker convention;
- list the new tests.

Add the following to `docs/tracking-issues.md`:

- the plugin-precedence deviation;
- the `getKeyScope` mismatch;
- the differences in how the application and the CLI derive resolver inputs;
- `userData` still being named `Hyper`.

Tick roadmap `3.2.1`, rewording its export and import sub-bullet as decided by
the first approval question. Then set this plan to `COMPLETE` after
`Outcomes & retrospective`.

Run the gates, `make prove`, `make markdownlint`, and `make nixie`.

## Milestones and plateaus

Every milestone ends with `make check-fmt`, `make typecheck`, `make lint`, and
`make test` passing. From EP-B onwards, `make prove` must pass too.

EP-A: tooling installed; CI proves the sample; no behaviour change.

- Requirements: none; this milestone enables the others.
- Acceptance:
  - `make prove` exits 0 on the sample, and exits non-zero on the planted
    false `ensures`;
  - the CI Linux `build` job shows the prove step passing;
  - both transcripts are recorded.
- Conformance check:
  - requirements satisfied: not applicable;
  - design still followed;
  - upstream assumptions still valid;
  - only the two approved development dependencies were added;
  - no trust-boundary or persisted-format change;
  - trace links current.
- Recovery: revert the commits.
- Remaining gaps: everything else.
- Compatibility decision: none.

EP-P: the Velocetty configuration tree resolves with priority. The application
and the CLI agree.

- Requirements: REQ-TREE-NEW, REQ-TREE-PRIORITY, REQ-TREE-LEGACY,
  REQ-TREE-XDG, and DES-CFG-FILES (paths).
- Acceptance:
  - KB-PATH-1 holds over all 768 cases;
  - KB-PATH-2 parity holds;
  - the updated CLI behaviour tests pass;
  - the three negative controls fail as intended.
- Conformance check:
  - REQ-TREE-NEW, REQ-TREE-PRIORITY, REQ-TREE-LEGACY, and REQ-TREE-XDG
    satisfied at the resolver level;
  - Hyper-tree rules unchanged, as the oracle shows;
  - no `@shared` runtime import from `app/`;
  - interface changes confined to the tolerance list;
  - no persisted-format change;
  - trace links current.
- Recovery: revert. Path resolution returns to today's behaviour.
- Remaining gaps:
  - keybinding creation still follows the active config until EP-D;
  - the watcher covers one directory until EP-E.
- Compatibility decision: existing Hyper-tree configurations are a deployed
  state (REQ-TREE-LEGACY), handled by the resolver's lookup order. There is no
  file migration and no source-level shim.

EP-B: the proved policy exists, but the application does not use it yet.

- Requirements: DES-CFG-LKG, REV-67-LKG, REV-67-FLAG, and REV-67-BOOT, at the
  policy level.
- Acceptance:
  - run `make prove` from the repository root; it ends with a line matching
    `Dafny program verifier finished with <N> verified, 0 errors`, where
    `N ≥ 1` for each of KB-POL-1 and KB-POL-2;
  - with negative control (a), then (b), applied, `make prove` exits
    non-zero, naming the violated postcondition;
  - all 15 table rows pass;
  - the transcripts are recorded.
- Conformance check:
  - KB-POL-1 and KB-POL-2 discharged;
  - pure module with no I/O imports;
  - AXIOM-LEMMASCRIPT holds with only the allow-listed axiom;
  - no public interface change;
  - no persisted-format change;
  - trace links current.
- Recovery: revert; the application is unaffected.
- Remaining gaps: the service does not use the policy yet.
- Compatibility decision: none.

EP-C: the codec and schema are in place, and platform keymaps parse through
them.

- Requirements: DES-CFG-VALID, RM-321-RW (validation).
- Acceptance: KB-COD-1, KB-COD-2, and KB-COD-3 pass, and
  `bun run generate-schema` leaves the tree clean.
- Conformance check:
  - DES-CFG-VALID satisfied;
  - design still followed;
  - AXIOM-AJV and AXIOM-ZOD still valid;
  - no public interface change;
  - the persisted format is tightened only as ADR-007 states;
  - trace links current.
- Recovery: revert.
- Remaining gaps: the store and service.
- Compatibility decision: files written by the earlier branch exist only on
  developer machines. They stay valid unless they contain empty identifiers, so
  no migration is needed.

EP-D: the application starts, reloads, imports, and exports through the
service; the review defects are fixed.

- Requirements: RM-321-RW, RM-321-XI, REV-67-LKG, REV-67-BOOT, REV-67-FLAG,
  REV-67-SIMPLE.
- Acceptance:
  - KB-SVC-1, KB-SVC-2, KB-SVC-3, and KB-STORE-1 pass;
  - negative control (c) yields the expected shrunk counterexample;
  - `import.ts` is 360 lines or fewer.
- Conformance check:
  - those requirements satisfied;
  - the hexagonal split is as decided;
  - AXIOM-FS still valid;
  - interface changes are confined to the tolerance list;
  - `config.json5` is never written, as the byte comparison shows;
  - trace links current.
- Recovery: revert to EP-C.
- Remaining gaps: watcher semantics.
- Compatibility decision: legacy `config.json5.keymaps` is a deployed state
  (Hyper users), handled by `decideBootstrap`; no source-level shims are added.

EP-E: hot reload is robust and observable end to end.

- Requirements: RM-321-OK, DES-CFG-HOT, REV-67-WATCH, DES-CFG-KB-LAYER (user
  over core).
- Acceptance:
  - KB-WATCH-1 and KB-LAYER-1 pass;
  - E2E-KB-1 to E2E-KB-4 and the second-launch check pass in CI on Linux,
    macOS, and Windows, as shown in the CI fast-lane log.
- Conformance check:
  - those requirements satisfied;
  - design followed, with the plugin deviation recorded;
  - AXIOM-CHOKIDAR still valid, confirmed by the end-to-end runs;
  - no new IPC channel;
  - markers appear only under `RUN_E2E=1`, and there is no persisted-format
    change;
  - trace links current.
- Recovery: revert to EP-D.
- Remaining gaps: documentation.
- Compatibility decision: none.

EP-F: documentation, ADR, and roadmap are complete.

- Requirements: all traced items, documented.
- Acceptance:
  - `make markdownlint` and `make nixie` pass;
  - ADR-007 is Accepted;
  - roadmap `3.2.1` is ticked.
- Conformance check:
  - every Decision log entry is reflected in ADR-007 or the design document;
  - the design document is updated;
  - discoveries are reconciled;
  - no interface change;
  - no format change;
  - trace links final.
- Recovery: revert the documentation commits.
- Remaining gaps: none for `3.2.1`.
- Compatibility decision: none.

## Concrete steps

Work from the repository root of any checkout of this branch.

One-time setup on a fresh checkout follows. The `npm` step works around a
stale-cache failure in `electron-builder install-app-deps`.

```bash
bun install --frozen-lockfile || true
(cd app && npm install --production --prefer-online && rm -f package-lock.json)
node bin/copy-node-modules.mjs && bun run generate-schema
bun bin/rebuild-node-pty.mjs        # needed only for the end-to-end lane
dafny --version                     # expect 4.11.x; otherwise install Dafny 4.11.0 from its GitHub release
git status --short                  # expect no output
```

Gates, with output kept in `/tmp`:

```bash
BRANCH=$(git branch --show-current)
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-${BRANCH}.out
make typecheck 2>&1 | tee /tmp/typecheck-velocetty-${BRANCH}.out
make lint 2>&1 | tee /tmp/lint-velocetty-${BRANCH}.out
make test 2>&1 | tee /tmp/test-velocetty-${BRANCH}.out
make prove 2>&1 | tee /tmp/prove-velocetty-${BRANCH}.out
```

A passing `make test` ends with `0 fail`. The pass count is at least 514 plus
the number of tests added so far. A passing `make prove` ends with a line like
this:

```plaintext
Dafny program verifier finished with 12 verified, 0 errors
```

The verified count varies with the proof; the guard requires it to be at least
1, with 0 errors.

Focused loops:

```bash
bun test --isolate test/unit/keybindings-policy.test.ts
bunx lsc check --backend=dafny app/config/keybindings-policy.ts
bunx lsc regen --backend=dafny app/config/keybindings-policy.ts   # after editing the .ts; never delete the .dfy
```

End-to-end, the same command CI runs:

```bash
bun run test:e2e:fast 2>&1 | tee /tmp/e2e-fast-velocetty-${BRANCH}.out
```

## Validation and acceptance

These are manual checks a person can observe, using Linux paths as examples.

0. With no `~/.config/Velocetty` and no `~/.config/Hyper`, start the
   application. `~/.config/Velocetty/config.json5` and
   `~/.config/Velocetty/keybindings.json5` appear, and `~/.config/Hyper` holds
   no configuration file. With `XDG_CONFIG_HOME=/tmp/xdg`, the same files
   appear under `/tmp/xdg/Velocetty`.

1. Start the application with a `~/.config/Hyper/config.json5` whose
   `keymaps` binds `window:new` to `ctrl+alt+shift+n`, and with no
   `keybindings.json5`.
   - `~/.config/Velocetty/keybindings.json5` appears holding that binding.
   - No configuration file is created in `~/.config/Hyper`.
   - `config.json5` is unchanged, apart from runtime-plugin defaults if they
     were missing (existing behaviour).
   - A notification says shortcuts moved.
   - `config.json5` is unchanged.
   - `Ctrl+Alt+Shift+N` opens a window.
2. Edit `keybindings.json5` to bind `window:new` to `ctrl+alt+shift+m`, and
   save. Within about a second, `Ctrl+Alt+Shift+M` opens a window, and the menu
   shows the new accelerator.
3. Save the file with a syntax error.
   - A notification names the location and a fix, and says your previous
     shortcuts are kept.
   - `Ctrl+Alt+Shift+M` still works.
   - No "Configuration updated" notice appears.
4. Delete the file. The platform default (`Ctrl+Shift+N`) applies, and the
   file is not recreated. On restart, if `config.json5` still has `keymaps`,
   the file is recreated with exactly those entries; otherwise it is recreated
   as the canonical empty map. `config.json5` is unchanged throughout.

Red-Green-Refactor evidence for each stage goes in `Artefacts and notes`: the
red command and its failure, the green pass, and the refactor gates.

Quality criteria:

- Tests: `make test` passes, and `bun run test:e2e:fast` passes in CI on three
  operating systems.
- Verification: `make prove` passes, KB-POL-1 and KB-POL-2 are discharged,
  and negative controls (a), (b), and (c) fail as intended.
- Lint, types, and format: `make lint`, `make typecheck`, `make check-fmt`,
  and `make markdownlint` are clean, and `make nixie` passes for the new
  diagram.

## Idempotence and recovery

Every stage is either additive or a refactor behind tests, and can be rerun.
Gate commands are read-only apart from `make fmt`. `make prove` fails if
generated files are stale, but never rewrites a `.dfy`. Use `lsc regen`, and
never delete a `.dfy`.

The pre-rebase state is kept locally on `backup/3-2-1-pre-rebase-e3335b98`.

End-to-end runs clean their temporary directories in `finally` blocks.
Directories left behind by a killed run sit under the system temporary
directory and are safe to delete. A crashed write can leave
`.keybindings.json5.<pid>.<random>.tmp` beside the file; the next start-up
removes it.

## Artefacts and notes

Gate evidence from planning (the rebased and repaired tree at `9f8c2cd1`):

```plaintext
make check-fmt    pass
make typecheck    pass
make lint         pass
make test         514 pass, 0 fail (67 files)
make markdownlint 0 issues in 65 files
```

Red, green, negative-control, and end-to-end transcripts are added here during
implementation.

### EP-A: tooling

Red, with `test/proofs/sample-false.ts` (`//@ ensures \result === 1` over a
body returning `0`) listed in `LemmaScript-files.txt`:

```plaintext
Generated: .../test/proofs/sample.dfy.gen
Running dafny verify...

Dafny program verifier finished with 1 verified, 0 errors
Generated: .../test/proofs/sample-false.dfy.gen
Running dafny verify...
sample-false.dfy(10,0): Error: a postcondition could not be proved on this return path
   |
10 | {
   | ^

sample-false.dfy(9,17): Related location: this is the postcondition that could not be proved
  |
9 |   ensures (one() == 1)
  |                  ^^


Dafny program verifier finished with 0 verified, 1 error
prove: LemmaScript verification failed.
make: *** [Makefile:43: prove] Error 1
```

Exit status 2. The negative control was then deleted and the list restored to
one entry.

Green, with only `test/proofs/sample.ts` listed:

```plaintext
./bin/prove.sh
Generated: .../test/proofs/sample.dfy.gen
Running dafny verify...

Dafny program verifier finished with 1 verified, 0 errors
```

Exit status 0. `mbake validate Makefile` reports `Valid syntax`. `checkmake` is
not installed on this host, so its check could not run.
`build/esbuild/copy-artefacts.ts` copies only `.html`, `.json`, `.png`, `.svg`,
and `patches`, so the proof artefacts are not packaged.

Gate evidence for EP-A (branch `3-2-1-store-keybindings-in-keybindings-json5`,
after the tooling changes):

```plaintext
make check-fmt    pass (323 files formatted, 67 Markdown files unchanged)
make typecheck    pass
make lint         pass (Biome, package boundaries, oxlint, actionlint)
make test         514 pass, 0 fail (67 files)
make prove        pass (1 verified, 0 errors)
```

### EP-P: Velocetty configuration tree

Red. `test/unit/config-tree.test.ts` was written against a stub
`app/config/config-tree.ts` that still returned the Hyper paths, so the suite
loaded and every behavioural invariant ran:

```plaintext
✗ KB-PATH-1 > holds every invariant over the whole domain
Expected: "/home/ada/.config/Velocetty"
Received: "/home/ada/.config/Hyper"
✗ KB-PATH-1 > applies the XDG rule to each state on each platform
Expected: "C:\Users\ada\AppData\Roaming\Velocetty"
Received: "C:xdg\Hyper"
✗ KB-PATH-1 > ignores a win32 drive-relative XDG_CONFIG_HOME
✗ KB-PATH-1 > accepts an MSYS-style root-relative XDG_CONFIG_HOME on win32
✗ KB-PATH-1 > does not report a shadowed copy when the Velocetty tree is a symlink
✗ KB-PATH-1 > treats a broken Hyper symlink as present and creates nothing
 2 pass
 6 fail
```

The suite name `KB-PATH-1 configuration tree resolution` is shortened to
`KB-PATH-1` here, and the symlink test's name is truncated, so the transcript
fits the code-block width.

The two passing tests are the non-vacuity checks (`768` cases, and the
Hyper-compatibility antecedent present on all three platforms); they assert
properties of the domain, not of the resolver.

Green. The real resolver, the mirror, and the CLI delegation give:

```plaintext
bun test test/unit/config-tree.test.ts test/unit/config-tree-parity.test.ts
 11 pass
 0 fail
 27 expect() calls
```

Negative controls. Each was applied to the working tree, run, and reverted;
`diff` confirmed the restored files matched the snapshots before continuing.
The quoted assertions are reflowed to the 120-column code-block limit.

1. Hyper listed before Velocetty in `listCandidates`: two tests failed. The
   whole-domain assertion reported:

   ```plaintext
   active /home/ada/.config/Hyper/config.json5 (hyper, exists=true);
   expected /home/ada/.config/Velocetty/config.json5 (velocetty, exists=true)
   ```

   The symlink-shadowing case failed as well, because Hyper became the active
   tree.
2. Creation path changed to the Hyper directory: one test failed.

   ```plaintext
   active /home/ada/.config/Hyper/config.json5 (velocetty, exists=false);
   expected /home/ada/.config/Velocetty/config.json5 (velocetty, exists=false)
   ```

   The tree label alone would not have caught this, which is why the assertion
   compares path, tree, and `exists` together.
3. `paths.isAbsolute` guard removed from the Velocetty XDG rule: three tests
   failed. The XDG test reported `Expected "/home/ada/.config/Velocetty"` and
   `Received "rel/Velocetty"`, and the win32 drive-relative case reported
   `Received "C:xdg\Velocetty"`, so relative values leaked into both platform
   families.
4. The mirror's directory name changed from `Velocetty` to `Velocettz`: 1
   failure, with all 768 cases mismatching. Beyond the directory field, the
   development-mode shadowed lists differed, so a one-character drift cannot
   hide behind a matching tree label.

Gate evidence for EP-P (branch `3-2-1-store-keybindings-in-keybindings-json5`,
after the tree resolver, CLI delegation, and `--help` changes):

```plaintext
make check-fmt    pass (330 files formatted, 67 Markdown files unchanged)
make typecheck    pass
make lint         pass (Biome, package boundaries, oxlint, actionlint)
make test         531 pass, 0 fail (69 files)
make markdownlint pass (0 issues, 67 files)
make spelling     pass (typos.toml unchanged)
make prove        pass (1 verified, 0 errors)
nixie --no-sandbox pass
```

### EP-B: keybindings policy and proof

Go/no-go. Before writing the policy, a prototype checked every construct the
plan needs: discriminated unions, `switch` on a union, backward recursion with
`decreases`, an indexed fold, and `//@ extern`. LemmaScript 0.6.5 translated
all of them and Dafny verified the result, so the approach was accepted with
the subset deviations recorded above.

Red. The real contracts were placed over stub bodies that returned a constant
value. `make prove` reported the unproved postconditions and stopped:

```plaintext
Generated: .../app/config/keybindings-policy.dfy.gen
Running dafny verify...

Dafny program verifier finished with 3 verified, 11 errors
prove: LemmaScript verification failed.
```

The three verified declarations are the pure predicates with no contracts. The
eleven errors are the `ensures` on `observeKeybindings`, `activeKeymaps`,
`decideBootstrap`, `bootstrapObservation`, and `replayKeybindingObservations`,
plus the replay loop invariant.

Green. With the real bodies, the checked-in `.dfy` additions, and the example
method:

```plaintext
Dafny program verifier finished with 8 verified, 0 errors
```

The focused suite also passes:

```plaintext
bun test --isolate test/unit/keybindings-policy.test.ts
 35 pass
  0 fail
 57 expect() calls
```

Negative controls. Each was applied to the working tree, verified, and reverted;
`diff` confirmed the restored files matched their snapshots before the next
step, and `make prove` was green again afterwards.

1. The `invalid` branch returned an empty accepted payload instead of keeping
   the prior state: 5 errors, naming the `invalid` and `unreadable` keeps-state
   and status postconditions and the replay loop invariant.
2. A `missing` observation was treated as rejected: 4 errors, naming the
   `missing` applies-empty-map postconditions and the replay loop invariant.

Each control therefore fails exactly the contracts that mention the changed
observation kind, and the replay contract fails as well, which shows the
invariant is not implied by the per-step contract alone.

Gate evidence for EP-B (branch `3-2-1-store-keybindings-in-keybindings-json5`,
after the policy, proof, tests, and the two documented lint suppressions):

```plaintext
make check-fmt    pass (331 files formatted, 67 Markdown files unchanged)
make typecheck    pass
make lint         pass (Biome, package boundaries, oxlint)
make test         566 pass, 0 fail (70 files)
make spelling     pass (typos.toml current)
make prove        pass (sample 1 verified; policy 8 verified, 0 errors)
```

The first gate attempt failed `make lint` with six oxlint findings (two test
type assertions, `prefer-at`, `prefer-negative-index`, and two
`no-unnecessary-condition` reports). The assertions were removed by typing the
`test.each` rows, the index findings were removed by precomputing `lastIndex`,
and the two remaining conditions are the documented suppressions described in
the Decision log.

### EP-C: keybindings codec and JSON Schema

Artefacts:

- `app/config/keybindings-codec.ts` (new): the validation schema, the total
  parser, the canonical writer, and the copying conversion.
- `app/config/keybindings.ts`: local Zod record schema and `cloneKeymaps`
  removed; `toRawKeymaps` is used instead, and `parseKeybindingsSource` is a
  thin adapter over `parseKeybindingsText` until EP-D replaces the module.
- `app/config/import.ts`: platform keymaps parse through the codec.
- `bin/generate-keybindings-schema.ts` (new) and the `generate-schema` script.
- `shared/schemas/keybindings.schema.json` (new, generated).
- `test/testUtils/keybindings-arbitraries.ts`,
  `test/unit/keybindings-arbitraries.coverage.test.ts`,
  `test/unit/keybindings-codec.test.ts`,
  `test/unit/keybindings-codec.property.test.ts`,
  `test/unit/keybindings-schema-parity.test.ts`, and thirteen documents under
  `test/fixtures/keybindings/`.

Red. The suites were written against the codec before it existed, so the
focused run stopped at the import:

```plaintext
bun test --isolate test/unit/keybindings-codec.test.ts
error: Cannot find module '../../app/config/keybindings-codec'
 0 pass
 1 fail
```

Green. The four focused suites pass:

```plaintext
bun test test/unit/keybindings-codec.test.ts \
  test/unit/keybindings-codec.property.test.ts \
  test/unit/keybindings-schema-parity.test.ts \
  test/unit/keybindings-arbitraries.coverage.test.ts
 46 pass
  0 fail
 5868 expect() calls
Ran 46 tests across 4 files.
```

- KB-COD-1 and KB-COD-2 run 500 cases each at seed `20_261_030`. The totality
  property draws from valid maps, internally corrupted maps, binary strings,
  and arbitrary JSON values, so non-object roots and unparsable text are
  covered as well as shape violations.
- The coverage guard samples 2000 maps and requires every key and binding class
  in more than five per cent of samples, so the properties cannot pass
  vacuously on uniform data. It also samples 2000 totality documents and
  requires the accepted and rejected outcomes each in more than ten per cent.
- The thirteen fixtures are ten rejections and three acceptances. The parity
  suite asserts the exact file set, so a class cannot be dropped or added
  without classifying it, and it checks that Ajv and the codec agree on every
  document. A document Ajv cannot parse must be classified `syntax error`.

Schema parity control. The committed schema was hand-edited from
`"minLength": 1` to `"minLength": 2`. Exactly the two schema tests failed; the
Ajv agreement cases still passed, because every fixture command id is at least
two characters.

```plaintext
 13 pass
  2 fail
```

The file was restored, `cmp` confirmed it matched the snapshot, and the suite
returned `15 pass` at that point; the follow-up fixture makes it 16. The
control isolates committed-versus-generated drift, which is what KB-COD-3
exists to catch.

Sorting control. KB-COD-1's stated mutation removes key sorting from the
serializer. Applied to `sortKeys` in `app/config/json5-config.ts`, it failed
both the round-trip property and the totality property, which reuses the round
trip:

```plaintext
Property failed after 5 tests
{ seed: 20261030, path: "4:1:2:2:4:4", endOnFailure: true }
Counterexample: ["{\"valueOf\":[\"ctrl++key\"],\"__proto__\":\"ctrl++key\"}"]
 1 pass
 2 fail
```

The serializer was restored, `cmp` confirmed it matched the snapshot, and the
property suite returned `3 pass`. The first attempt mutated the `shared/` copy
of `sortKeys` and changed nothing, because the codec resolves the `app/` copy;
that duplication is a known defect for EP-F to reconcile.

Milestone review.
`coderabbit review --agent --committed --base-commit 2132eabc` reviewed exactly
this commit and reported three minor and one trivial finding. All four concerned
`$schema`: the codec dropped the key before validating it, so `$schema: 42`
was accepted by the codec and rejected by Ajv; the parity corpus had no
invalid-`$schema` case to notice; the legacy `parseKeybindingsSource` still
used Zod's record parse and so kept `$schema` as a command and dropped an own
`__proto__`; and the Decision log claimed a validation the code did not
perform. The follow-up commit validates the `$schema` value with its own
diagnostic, adds `test/fixtures/keybindings/schema-key-invalid.json5` and its
parity case, and routes the legacy adapter through `parseKeybindingsText`.

Generation. After `bun run generate-schema`, `sha256sum -c` reports `OK` for
`shared/schemas/schema.json`, `shared/schemas/keybindings.schema.json`, and
`app/config/schema.json`, and `git status` shows only the EP-C paths. The
formatter normalizes its own freshly written copy, and the committed bytes are
stable under regeneration.

Gate evidence for EP-C. The base milestone, committed as `4190d65b`:

```plaintext
make check-fmt    pass (339 files formatted, 67 Markdown files unchanged)
make typecheck    pass
make lint         pass (Biome 340 files, package boundaries, oxlint)
make test         pass (610 pass, 0 fail, 74 files)
make spelling     pass (typos.toml current)
make prove        pass (sample 1 verified; policy 8 verified, 0 errors)
```

The `$schema` follow-up candidate, re-run on all six gates:

```plaintext
make check-fmt    pass (339 files formatted, 67 Markdown files unchanged)
make typecheck    pass
make lint         pass (Biome 340 files, package boundaries, oxlint)
make test         pass (612 pass, 0 fail, 74 files)
make spelling     pass (typos.toml current)
make prove        pass (sample 1 verified; policy 8 verified, 0 errors)
```

The focused EP-C suites report `46 pass`, `5868 expect() calls`, across four
files: the follow-up added one parity fixture case and one coverage test.

The first lint attempt failed with nineteen oxlint findings. Most were
mechanical (`no-array-callback-reference`, `prefer-spread`,
`numeric-separators-style`, `no-conditional-empty-object-spread`). Three shaped
the code: `no-unsafe-dictionary-type` required the parsed root to be narrowed
with `isJsonObject`; `no-known-value-widening` rejected the typed fixture
table, which moved the agreement test to `Object.entries`; and
`no-unnecessary-condition` would have rejected the `undefined` guard that
`noUncheckedIndexedAccess` demands.

### EP-D: atomic store, service, and importer

Artefacts (D1 and D2):

- `app/config/keybindings-store.ts` (new): the atomic file adapter.
- `test/unit/keybindings-store.test.ts` (new): 14 KB-STORE-1 tests.
- `app/config/keybindings.ts` (rewritten): the store-driven service and the
  KB-SVC-1 import/export laws.
- `app/config/keybindings-legacy.ts` (new, temporary): the earlier delivery's
  importer-facing API, re-exported from `keybindings.ts` until D3 deletes it.
- `test/testUtils/memory-keybindings-store.ts` (new): the store double.
- `test/unit/keybindings-service.test.ts`,
  `test/unit/keybindings-service.property.test.ts`, and
  `test/unit/keybindings-service.model.test.ts` (new).

D2 red. The three suites were written against the service before the rewrite,
so the focused run stopped at the missing named export
`createKeybindingsService`; no assertion ran. Green on the rewritten service:

```plaintext
bun test test/unit/keybindings-service.test.ts \
  test/unit/keybindings-service.property.test.ts \
  test/unit/keybindings-service.model.test.ts
 28 pass
  0 fail
 5017 expect() calls
Ran 28 tests across 3 files.
```

The model test runs 60 command sequences of at most 50 commands each at seed
`20_261_030`. Its non-vacuity companion samples the same generator and asserts
the exact set of ten command names, so a command that stopped being generated
would fail the suite rather than silently weaken KB-SVC-2.

Negative control (c), part 1: KB-SVC-1's stated mutation canonicalizes on
import. `importKeybindings` was changed to write
`serializeKeybindings(parsed.keymaps)` instead of the supplied text. The
verbatim property failed on the compact-JSON arm, which is why that arm exists:

```plaintext
Property failed after 1 tests
{ seed: 20261030, path: "0:0", endOnFailure: true }
Counterexample: ["{}"]
Shrunk 1 time(s)
 6 pass
 1 fail
```

Negative control (c), part 2: KB-SVC-2's stated defect applies the legacy
keymaps when the file turns invalid. The service was changed to remember the
`start` argument and apply it on an invalid reload. Five of the nineteen named
examples failed, including the deterministic B≠A regression test, and the model
test failed with:

```plaintext
Property failed after 15 tests
Counterexample: [set invalid,start /*replayPath="GAM:F"*/]
Shrunk 5 time(s)
- [make unreadable,reload,set invalid,start /*replayPath="GAM:F"*/]
- [reload,set invalid,start /*replayPath="GAM:F"*/]
- [set invalid,start /*replayPath="GAM:F"*/]
```

Both mutations were reverted; `grep` confirms neither `legacyKeymaps` nor the
canonicalizing write remains, and the three suites return to `28 pass`.

## Interfaces and dependencies

The development dependencies are `fast-check@^4.10.2` and `lemmascript@0.6.5`.
Runtime dependencies are unchanged: `json5`, `zod`, `fs-extra`, and `chokidar`
in `app/package.json`.

`app/config/keybindings-policy.ts` is pure and LemmaScript-verified. Keymaps
are opaque to the proof.

```typescript
export interface UserKeymaps {
  readonly [command: string]: string | string[];
}

//@ extern
export function emptyUserKeymaps(): UserKeymaps;

export type KeybindingsObservation =
  | {readonly kind: 'valid'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'missing'}
  | {readonly kind: 'invalid'}
  | {readonly kind: 'unreadable'};

export type KeybindingsState = {readonly lastAccepted: UserKeymaps | null};
export const initialKeybindingsState: KeybindingsState; // {lastAccepted: null}

export type ObservationResult = {
  readonly state: KeybindingsState;
  readonly status: 'applied' | 'kept';
  readonly usedLastKnownGood: boolean;
};

export function observeKeybindings(state: KeybindingsState, observation: KeybindingsObservation): ObservationResult;
export function replayKeybindingObservations(history: KeybindingsObservation[]): KeybindingsState;
export function specLatestAccepted(history: KeybindingsObservation[]): UserKeymaps | null;
export function activeKeymaps(state: KeybindingsState): UserKeymaps; // lastAccepted ?? emptyUserKeymaps()

export type BootstrapFileState = 'present' | 'missing' | 'unreadable';
export type LegacyKeymapsSource =
  | {readonly kind: 'parsed-keymaps'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'parsed-empty'}
  | {readonly kind: 'parsed-invalid'}
  | {readonly kind: 'freshly-created'}
  | {readonly kind: 'fell-back'};

export type BootstrapDecision =
  | {readonly kind: 'write-nothing'}
  | {readonly kind: 'defer'}
  | {readonly kind: 'seed'; readonly keymaps: UserKeymaps};

export interface BootstrapInput {
  readonly file: BootstrapFileState;
  readonly legacy: LegacyKeymapsSource;
}

export function decideBootstrap(input: BootstrapInput): BootstrapDecision;

export function bootstrapObservation(
  decision: BootstrapDecision,
  write: 'written' | 'failed' | 'not-attempted'
): KeybindingsObservation | null; // null: read the file (write-nothing) or apply nothing (defer)

// Spec predicates used by the KB-POL-2 contracts, and by the tests.
export function isSeed(decision: BootstrapDecision): boolean;
export function isDefer(decision: BootstrapDecision): boolean;
export function specSeedKeymaps(decision: BootstrapDecision): UserKeymaps; // empty when it seeds nothing
export function specLegacyKeymaps(legacy: LegacyKeymapsSource): UserKeymaps; // empty when it carries none
export function isDeferredObservation(observation: KeybindingsObservation | null): boolean;
export function specObservationKeymaps(observation: KeybindingsObservation | null): UserKeymaps;
```

The contracts are written through these predicates because LemmaScript cannot
project `\result.kind` from a union result. The checked-in
`app/config/keybindings-policy.dfy` is the generated translation plus the proof
additions described in the EP-B artefacts; `make prove` regenerates the
`.dfy.gen` and verifies the `.dfy`.

`app/config/config-tree.ts` is pure. `shared/src/config/config-tree.ts` mirrors
it for the CLI.

```typescript
export type ConfigTree = 'velocetty' | 'hyper' | 'development';

export type ConfigLocationInput = {
  readonly platform: NodeJS.Platform;
  readonly xdgConfigHome: string | undefined;
  readonly homeDirectory: string;
  readonly appDataDirectory: string; // Electron app.getPath('appData'); CLI: APPDATA or <home>/AppData/Roaming
  readonly hyperUserDataDirectory: string; // Electron app.getPath('userData'); Windows Hyper tree
  readonly development: {readonly enabled: boolean; readonly directory: string};
  readonly probe: (path: string) => 'present' | 'broken-link' | 'absent'; // stat, with an lstat fallback
  readonly sameFile: (a: string, b: string) => boolean; // real-path equality
};

export type ConfigLocations = {
  readonly velocettyDirectory: string;
  readonly config: {readonly path: string; readonly tree: ConfigTree; readonly exists: boolean};
  readonly keybindingsPath: string;
  readonly shadowed: readonly string[];
};

export const resolveConfigLocations: (input: ConfigLocationInput) => ConfigLocations;
```

`app/config/paths.ts` keeps its current exports and adds `velocettyDir`,
`configTree`, and `shadowedConfigPaths`.

`app/config/keybindings-codec.ts`:

```typescript
export type KeybindingsParseOutcome =
  | {readonly kind: 'ok'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]};

export const keybindingsSchema: z.ZodType<UserKeymaps>;
export const keybindingsJsonSchema: () => ZodStandardJSONSchemaPayload<typeof keybindingsSchema>; // draft-07
export const parseKeybindingsText: (text: string, sourceLabel: string) => KeybindingsParseOutcome;
export const serializeKeybindings: (keymaps: UserKeymaps) => string;
export const toRawKeymaps: (keymaps: UserKeymaps) => NonNullable<rawConfig['keymaps']>; // copying
```

`app/config/keybindings.ts` is the application service and declares its driven
port:

```typescript
export type ConfigImportNotify = (title: string, body?: string, details?: {error?: unknown}) => void;

export type KeybindingsReadOutcome =
  | {readonly kind: 'present'; readonly text: string}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly error: unknown};

export type KeybindingsWriteOutcome = {readonly kind: 'written'} | {readonly kind: 'failed'; readonly error: unknown};

export type KeybindingsStore = {
  readonly location: string;
  readonly read: () => KeybindingsReadOutcome;
  readonly write: (text: string) => KeybindingsWriteOutcome;
};

export type KeybindingsLoadOutcome =
  | {readonly kind: 'applied'; readonly keymaps: UserKeymaps; readonly origin: 'file' | 'missing' | 'seeded'}
  | {
      readonly kind: 'kept';
      readonly keymaps: UserKeymaps;
      readonly basis: 'last-known-good' | 'empty';
      readonly cause: 'invalid' | 'unreadable' | 'deferred';
      readonly diagnostics: readonly configValidationDiagnostic[];
    };

export type KeybindingsImportOutcome =
  | {readonly kind: 'written'}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'failed'; readonly error: unknown};

export type KeybindingsExport =
  | {readonly kind: 'stored'; readonly text: string}
  | {readonly kind: 'invalid'; readonly text: string; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly error: unknown};

export const createKeybindingsService: (dependencies: {
  readonly store: KeybindingsStore;
  readonly notify: ConfigImportNotify;
  readonly warn?: typeof console.warn;
}) => {
  readonly start: (legacy: LegacyKeymapsSource) => KeybindingsLoadOutcome;
  readonly reload: () => KeybindingsLoadOutcome;
  readonly importKeybindings: (text: string, sourceLabel: string) => KeybindingsImportOutcome;
  readonly exportKeybindings: () => KeybindingsExport;
  readonly active: () => UserKeymaps; // read-only query; KB-SVC-2 observes through it
};
```

`app/config/keybindings-store.ts` is the file adapter:

```typescript
export type KeybindingsFileSystem = Pick<
  typeof import('node:fs'),
  'realpathSync' | 'readFileSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync'
  | 'statSync' | 'chmodSync' | 'renameSync' | 'unlinkSync' | 'readdirSync'
>;

export const createFileKeybindingsStore: (options: {
  readonly filePath: string;
  readonly fs?: KeybindingsFileSystem; // defaults to node:fs; injected for fault tests
  readonly sleep?: (milliseconds: number) => void; // bounded retry back-off; injected in tests
  readonly warn?: typeof console.warn;
}) => KeybindingsStore & {readonly removeStaleTemporaryFiles: () => void};
```

`app/config/watcher.ts`:

```typescript
export type WatcherEvent = 'add' | 'change' | 'unlink';

export type WatcherHandle = {
  readonly on: (event: WatcherEvent, listener: (path: string) => void) => void;
  readonly onReady: (listener: () => void) => void;
  readonly onError: (listener: (error: unknown) => void) => void;
  readonly close: () => Promise<void>;
};

export const createConfigWatcher: <TimerHandle>(options: {
  readonly handle: WatcherHandle; // built by app/config.ts from chokidar.watch(cfgDir, {depth: 0, ignoreInitial: true})
  readonly fileNames: readonly string[]; // ['config.json5', 'keybindings.json5']
  readonly debounceMs: number;
  readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  readonly cancel: (handle: TimerHandle) => void;
  readonly onReload: () => void;
  readonly onReady?: () => void;
}) => {readonly close: () => Promise<void>};
```

`app/config/import.ts`:

```typescript
export type ConfigImportKeybindings = {
  readonly start: (legacy: LegacyKeymapsSource) => KeybindingsLoadOutcome;
  readonly reload: () => KeybindingsLoadOutcome;
};

export type ConfigImportReport = {
  readonly config: 'applied' | 'fallback';
  readonly keybindings: 'applied' | 'kept' | 'unchanged';
};

// createConfigImportModule gains `keybindings: ConfigImportKeybindings` in its dependencies and returns:
//   _import: (phase: 'startup' | 'reload') => {readonly config: parsedConfig; readonly report: ConfigImportReport}
//   getDefaultConfig: () => rawConfig   (no longer runs keybindings start-up)
```

Exact names may be adjusted during the Stage B prototype if LemmaScript
requires it. Any adjustment is recorded in `Decision log`.

## Revision note

- 2026-10-29 (first draft): rewritten from the earlier `COMPLETE` delivery
  record into a `DRAFT`, after rebasing and repairing the branch.
- 2026-10-29 (second draft): revised after a five-member expert review. The
  changes are:
  - Start-up and reload are separated, so a reload never writes.
  - The policy state is reduced to a single `lastAccepted` value with opaque
    payloads.
  - KB-POL-1 is corrected to a well-typed fold-against-backward-search
    theorem. Negative controls are expressible at both the policy and service
    levels.
  - KB-POL-2 is exhaustive over 15 input-kind rows, including unreadable
    files and invalid legacy keymaps.
  - The service is composed in `app/config.ts`, and import and export have no
    hidden state changes.
  - `_import` returns a report covering both files.
  - Atomic writes preserve symlinks and modes, with no overwrite fallback.
  - The watcher observes the configuration directory with `ignoreInitial`.
  - End-to-end tests use a probe binding found in no platform default, the
    development-output launch, readiness markers, a deletion scenario, and a
    script change so that the suite runs.
  - `make prove` guards against vacuous success, and the CI proof step moves
    into EP-A.
  - The JSON Schema targets draft-07 for the pinned `ajv`.
  - Approval questions are added, ADR-007 is drafted as Proposed, and the
    documentation plan is expanded.

  Remaining work is Stages A to F, after approval.
- 2026-10-29 (third draft, after a focused cross-platform review): the
  revision covers the following:
  - `userData` coinciding with the Hyper tree on Linux;
  - reload never creating files or directories;
  - runtime-plugin default persistence in byte checks;
  - a corrected Hyper-compatibility invariant;
  - real red CLI tests;
  - manual migration steps;
  - symlink and broken-link handling;
  - parity scope;
  - platform-specific path functions;
  - `getConfigDir`, macOS location, and case-sensitivity decisions.
- 2026-10-29 (third draft): the approval questions are answered, with all
  three recommendations accepted. The approver's Velocetty configuration tree
  requirement is incorporated:
  - a pure resolver mirrored for the CLI;
  - EP-P with exhaustive KB-PATH-1 and KB-PATH-2 obligations;
  - a two-directory watcher;
  - a schema-copy rule that never creates files in the Hyper tree;
  - fresh-install and legacy-tree end-to-end scenarios;
  - ADR-008 (Proposed);
  - larger scope tolerances.

  Status stays `DRAFT` until this revision is approved.
