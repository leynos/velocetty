# Store keybindings in `keybindings.json5` (roadmap 3.2.1)

## Module header

- Purpose: an implementation-ready plan for roadmap item `3.2.1`. It
  revises an earlier delivery, now rebased onto `main`, so that user
  keybindings live in `keybindings.json5` with validated read/write utilities,
  same-format export and import, and hot reload that never silently loses a
  user's working shortcuts.
- Invariants: active user keybindings always equal the most recently accepted
  `keybindings.json5` state (or none); a failed parse never replaces working
  keybindings; legacy `config.json5.keymaps` migrate at most from a
  successfully parsed `config.json5`; the application never rewrites the user's
  `config.json5` to perform this migration.
- Cross-links: `docs/roadmap.md` (§3.2), `docs/velocetty-design.md`
  (§Keybinding system design, §Configuration system: JSON5 and layering),
  `docs/developers-guide.md` (§Configuration format practice, §Configuration
  layering and reloadability practice, §Tests),
  `docs/adr-001-replace-ava-with-bun-test.md`,
  `docs/adr-005-enhance-e2e-testing-strategy.md`,
  `docs/documentation-style-guide.md` (§Architectural decision records),
  `app/config/keybindings.ts`, `app/config/import.ts`, `app/config.ts`,
  `app/config/paths.ts`, `app/config/init.ts`, `app/utils/map-keys.ts`, and
  `app/config/json5-config.ts`.
- Skills signposts: `execplans` (this format), `hexagonal-architecture`
  (policy, port, and adapter separation), `typescript-router` then
  `typescript-boundaries-and-validation` and `typescript-errors-and-outcomes`
  (codec and result shapes), `typescript-testing` (bun:test layout),
  `fast-check` (property tests), `lemmascript` (proof workflow),
  `node-bun-and-processes` (file-system adapter), `electron-and-ipc` (main
  process watcher and the end-to-end lane), `codegraph-mcp` and `leta`
  (navigation), `en-gb-oxendict-style` and `document` (documentation),
  `arch-decision-records` (ADR shape, adapted to the house template), and
  `commit-message` (commit discipline).

This Execution Plan (ExecPlan) is a living document. The sections `Constraints`,
`Tolerances (exception triggers)`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, `Outcomes & retrospective`,
`Conformance basis`, and `Verification plan` must be kept up to date as work
proceeds.

Status: DRAFT

Implementation must not begin until a human explicitly approves this plan.

## Purpose / big picture

Velocetty, a terminal emulator forked from Hyper, used to keep a user's
keyboard shortcuts inside the main `config.json5` file under a `keymaps` key.
The design (`docs/velocetty-design.md`, §Configuration system: JSON5 and
layering) moves them into a separate `keybindings.json5` file in the same
configuration directory, layered over built-in and plugin defaults, validated
on read, and reloaded live when the file changes.

After this work a user can:

1. Open `keybindings.json5` in the configuration directory (for example
   `~/.config/Hyper/keybindings.json5` on Linux), change a shortcut such as
   `"window:new": "ctrl+shift+n"`, save, and see the new shortcut take effect
   in the running application without a restart.
2. Save a broken file (a stray comma outside JSON5 rules, or a number where a
   shortcut string belongs) and keep every shortcut that worked before the
   save, with a non-blocking notification naming the line, column, or JSON
   Pointer path and a suggested fix.
3. Upgrade from a build that kept shortcuts in `config.json5` and find those
   shortcuts copied once into a new `keybindings.json5`, with `config.json5`
   left byte-for-byte untouched.
4. Delete `keybindings.json5` and fall back to the platform defaults until the
   file is recreated.

Developers gain read, write, import, and export utilities whose exported text
is exactly the storage format, so the keybinding editor planned in roadmap
`4.2.2` and the settings commands in `5.1.2` can build on them without a new
file format.

This plan revises an earlier delivery of `3.2.1` (pull request #67). That
delivery is now rebased onto `main` and repaired so its gates pass (see
`Progress`). Review of that pull request and fresh reconnaissance found defects
that this plan corrects. The most serious is that an invalid
`keybindings.json5` on hot reload falls back to legacy or empty keymaps instead
of the last known good keymaps, contrary to the design and to the notification
the user sees.

## Constraints

- Scope is roadmap item `3.2.1` only. Plugin settings persistence (`3.2.2`),
  chord and `when`-clause semantics and conflict detection (`4.2.1`), the
  keybinding editor (`4.2.2`), and settings commands (`5.1.2`) stay out of
  scope, apart from leaving seams they can use.
- The application must never write to the user's `config.json5` as part of
  keybinding migration or reload. Its bytes must be unchanged after any
  keybinding operation.
- Main-process code under `app/` must not import runtime values from
  `@shared/*`. Only type imports are allowed (see the header of
  `app/config/reloadability-registry.ts` and `bun run check:boundaries`).
- The in-memory runtime contract stays
  `parsedConfig.keymaps: Record<string, string[]>`
  (`shared/src/types/config.ts`). Downstream consumers (`app/plugins.ts`
  `getDecoratedKeymaps`, the inter-process communication (IPC) schema in
  `lib/transport/ipc-schemas.ts`, menus, and `lib/command-registry.ts`) must
  not change shape.
- The keybinding layering order is fixed by the design: built-in platform
  defaults, then plugin defaults, then user overrides from `keybindings.json5`.
  Workspace overrides remain deferred, as recorded in
  `docs/developers-guide.md` §Deferred features.
- No file in the change may exceed 400 lines (`AGENTS.md`). Generated proof
  artefacts (`*.dfy.gen`) are exempt only if the house linters ignore them.
- All new behaviour follows Red-Green-Refactor with `bun:test`. Property tests
  use `fast-check`. Contractual policy logic carries a LemmaScript proof
  checked by Dafny.
- Documentation uses en-GB-oxendict spelling and follows
  `docs/documentation-style-guide.md`.
- `make check-fmt`, `make typecheck`, `make lint`, and `make test` must pass at
  the end of every milestone. From the proof milestone onwards, `make prove`
  must pass too.

## Tolerances (exception triggers)

- Scope: stop and escalate if implementation needs more than 40 non-ExecPlan
  files or more than 2,600 net added lines of code and other documentation.
  Exclude this ExecPlan file from both counts. Also exclude generated artefacts
  (`*.dfy.gen`, `bun.lock`) from the line count, though they count as files.
- Interface: stop and escalate if any exported signature outside
  `app/config/keybindings*.ts`, `app/config/import.ts`,
  `app/config/watcher.ts`, and `app/config.ts` must change, or if the
  `parsedConfig.keymaps` shape must change.
- Dependencies: the plan approves exactly two new development dependencies,
  `fast-check` and `lemmascript`. Any other new dependency, runtime or
  development, needs escalation.
- Persisted format: escalate before changing the accepted shape of
  `keybindings.json5` beyond what ADR-007 (Stage F) records.
- Proof feasibility: if after two working sessions the LemmaScript prototype
  (Stage B) cannot verify the policy module in place, stop. Present the options
  recorded under `Risks`, and do not substitute a handwritten parallel Dafny
  model without approval.
- Iterations: escalate if any single gate still fails after three fix
  attempts.
- Continuous integration (CI): escalate before adding a new CI job or
  changing an existing workflow beyond adding `make prove` to the Linux `build`
  job.
- Ambiguity: escalate when two valid readings of the design lead to
  materially different user-visible behaviour, as with the open questions in
  `Decision log`.

## Risks

- Risk: LemmaScript is a tech preview. Generic type parameters, opaque record
  payloads, or equality on them may fall outside its supported subset.
  Severity: medium. Likelihood: medium. Mitigation: Stage B is a time-boxed
  prototype that verifies the reducer and bootstrap decision first. Fallbacks,
  in order: shadow the payload with `//@ declare-type UserKeymaps`, so the real
  function stays the proof target; or make the reducer track an accepted
  revision counter alongside the payload, so the proof is over a supported
  type. Either way the code under proof stays the shipped code.
- Risk: the Dafny toolchain is absent in CI runners. Severity: medium.
  Likelihood: high. Mitigation: `make prove` installs nothing itself. Stage F
  adds a CI step that installs a pinned Dafny release on the Linux `build` job
  only, within the CI tolerance above. Locally, Dafny 4.11 is already on this
  host at `~/.local/bin/dafny`.
- Risk: on Windows, `fs.renameSync` over an existing file can fail with
  `EPERM` or `EBUSY` while an editor or antivirus holds it open, which would
  break the atomic-write adapter. Severity: medium. Likelihood: low.
  Mitigation: the adapter retries the rename a bounded number of times, then
  falls back to a direct overwrite and logs it. The retry path is covered by a
  fault-injection test.
- Risk: editors that save by rename can make chokidar 3.6 drop or delay
  events. Severity: medium. Likelihood: medium. Mitigation: keep chokidar's
  default `atomic` handling, which reports an unlink followed by an add within
  100 milliseconds as `change`. Also subscribe to `add` and `unlink`, and cover
  all three in the watcher property test.
- Risk: the fast end-to-end lane needs `node-pty` built for Electron.
  `bun run rebuild-node-pty` failed in this worktree during planning. Severity:
  low. Likelihood: medium. Mitigation: CI already builds it. Locally, follow
  `docs/developers-guide.md` §End-to-end (E2E) tests (layered strategy), and
  record the outcome in `Surprises & discoveries`.
- Risk: users who delete `keybindings.json5` see their legacy
  `config.json5.keymaps` re-seeded on the next start. Severity: low.
  Likelihood: low. Mitigation: documented in `docs/users-guide.md`, plus a
  start-up warning when legacy keymaps exist alongside `keybindings.json5`.
  Removing the legacy key automatically is rejected by the `config.json5` write
  ban in `Constraints`.

## Progress

- [x] (2026-04-22) Earlier delivery committed on this branch as pull
  request #67, with plan status `COMPLETE`.
- [x] (2026-10-29 17:20Z) Rebased the three earlier commits onto `origin/main`
  (`40949b2f`). Resolved conflicts in `app/config/import.ts`,
  `test/unit/config-import-json5.test.ts`, and `docs/developers-guide.md`.
  Moved the shared config-import harness into
  `test/testUtils/config-import-harness.ts`. Removed duplicate imports and
  re-exports that the merge driver left in `app/config.ts`. Kept a local backup
  branch `backup/3-2-1-pre-rebase-e3335b98`.
- [x] (2026-10-29 18:40Z) Repaired the rebase fallout in commit `9f8c2cd1`:
  the watcher test now matches `createConfigImportModule` and `utils/colours`;
  the two oxlint findings in `app/config/keybindings.ts` are fixed; Markdown is
  reflowed. `make check-fmt`, `make typecheck`, `make lint`, `make test` (514
  pass), and `make markdownlint` all pass.
- [x] (2026-10-29 19:00Z) Reconnaissance and external research complete.
  Findings are folded into `Context and orientation` and `Decision log`.
- [x] (2026-10-29) Revised this plan to `DRAFT` and reopened roadmap item
  `3.2.1`.
- [ ] Expert review of the draft plan, then revision.
- [ ] Approval gate: explicit human approval of this plan.
- [ ] Stage A: tooling (`fast-check`, `lemmascript`, `make prove`).
- [ ] Stage B: policy core with proof (prototype go/no-go first).
- [ ] Stage C: codec and JSON Schema.
- [ ] Stage D: store adapter, application service, and importer rewiring.
- [ ] Stage E: watcher hardening and end-to-end coverage.
- [ ] Stage F: documentation, ADR, CI proof step, roadmap update.

## Surprises & discoveries

- Observation: the earlier delivery's invalid-reload fallback never reaches
  the last known good keymaps on the real start-up and reload path. Evidence:
  `buildFallbackResult` in `app/config/keybindings.ts` computes
  `fallbackKeymaps ?? lastKnownGoodKeymaps ?? {}`, and `app/config/import.ts`
  always passes an object (`{}` or the legacy keymaps) as `bootstrapFrom`, so
  the `??` never reaches the last known good value. The test meant to cover this
  (`test/unit/config-import-keybindings-json5.test.ts`, "keeps the last known
  good keymaps") passes only because its legacy keymaps equal the bootstrapped
  file. Impact: Stage B makes this a proved invariant, and the seeded mutation
  in the `Verification plan` reproduces the bug as a negative control.
- Observation: a transient `config.json5` parse failure on the first run after
  upgrading writes an empty `keybindings.json5`, which then permanently blocks
  migration of the legacy keymaps. Evidence: pull request #67 review (Codex P2)
  and `app/config/import.ts` `bootstrapKeymaps`. Impact: the bootstrap decision
  becomes a pure, proved function (Stage B).
- Observation: the watcher listens only for `change`, so deleting and
  recreating `keybindings.json5` outside chokidar's 100-millisecond atomic
  window is never reloaded. Each event also schedules its own 100-millisecond
  timer, so a burst causes several reloads. Evidence: `app/config.ts` `_watch`.
  Impact: Stage E.
- Observation: the "Configuration updated" notification fires even when the
  reload fell back, next to the "Couldn't parse keybindings file" error.
  Evidence: `app/config.ts` `onChange`. Impact: Stage E reports fallback status
  out of the importer so the success notice is suppressed.
- Observation: no `docs/users-guide.md` exists, and there is no component
  architecture document for `app/config`. Impact: Stage F creates both.
- Observation: `app/config/reloadability-registry.ts` `getKeyScope` maps only
  the singular `keymap` to the keymap scope, while the config key is `keymaps`.
  Nothing calls it for keymaps today. Impact: none for this item. The latent
  mismatch is noted in `docs/tracking-issues.md` (Stage F) for the settings
  user interface (UI) work.
- Observation: the configuration directory is still named `Hyper`
  (`app/config/paths.ts`), whereas the design proposes `Velocetty`. Impact:
  none. The rename is out of scope, and documentation describes the actual path.
- Observation: `bun install` postinstall fails in a fresh worktree on this
  host because `electron-builder install-app-deps` resolves against a stale npm
  cache. `npm install --production --prefer-online` inside `app/` was the
  workaround. Impact: noted for implementers. No repository change is needed.

## Decision log

- Decision: keep the earlier delivery's commits, rebased onto `main`, and
  revise them under this plan rather than restarting from `main`. Rationale:
  requested by the user on 2026-10-29. The earlier code is a useful baseline,
  and the plan treats it as the starting state to be restructured. Date/Author:
  2026-10-29, user and planning agent.
- Decision: store keybindings as the Hyper-compatible map
  `{ "<command-id>": "<shortcut>" | ["<shortcut>", ...] }`, not as the array of
  rules that Visual Studio Code uses. Rationale: every consumer already expects
  the map, and the bundled platform defaults (`app/keymaps/*.json`) and legacy
  `config.json5.keymaps` are in this shape. An empty array cleanly unbinds a
  default. The richer rule model in the design (`when`, `args`, `source`)
  belongs to `4.2.1`, and can extend the map additively by later accepting an
  object value per command. Recorded in ADR-007 (Stage F). Date/Author:
  2026-10-29, planning agent; requires approval.
- Decision: split the module along hexagonal lines while keeping the
  repository's flat `app/config/` layout and factory-with-dependencies style.
  Files are `keybindings-policy.ts` (pure decisions, proved),
  `keybindings-codec.ts` (JSON5 text to validated keymaps and back),
  `keybindings-store.ts` (driven port and file adapter), `keybindings.ts`
  (application service), and `watcher.ts` (watch orchestration).
  `app/config.ts` stays the composition root. Rationale: protects the
  load-bearing policy from I/O, so it can be proved and property-tested without
  temp directories. It avoids a pattern transplant such as `domain/` or
  `adapters/` directories that the rest of `app/config` does not use.
  Date/Author: 2026-10-29, planning agent.
- Decision: on an invalid or unreadable `keybindings.json5`, the active user
  keybindings are the last known good keybindings from this session. If the
  session has none yet, they are empty, so only defaults apply. Legacy
  `config.json5.keymaps` are never a reload fallback. Rationale: the design
  (§Validation and error reporting) requires keeping the last known good state,
  and legacy keymaps are stale by definition once the file exists. Date/Author:
  2026-10-29, planning agent.
- Decision: a missing `keybindings.json5` during a session counts as an
  accepted state with no overrides, and becomes the new last known good. The
  application does not recreate the file mid-session. Rationale: deletion is
  deliberate user intent. Recreating the file would fight editors that save by
  rename. Date/Author: 2026-10-29, planning agent.
- Decision: bootstrap at start-up writes `keybindings.json5` only when the
  file is missing. It seeds from legacy `config.json5.keymaps` only when
  `config.json5` parsed successfully. A freshly created `config.json5` seeds an
  empty map. A `config.json5` that failed to parse defers creation: no file is
  written, and user overrides are empty for this session. Rationale: fixes the
  permanent migration block found in review, and keeps a single well-defined
  trigger. Date/Author: 2026-10-29, planning agent.
- Decision: `importKeybindings(text)` validates, then writes the user's text
  verbatim, preserving comments and ordering. `exportKeybindings()` returns the
  stored text verbatim when it is valid. When it is not, it returns the
  canonical serialization of the active keymaps and reports that it did so.
  `writeKeybindings(keymaps)` writes the canonical serialization: sorted keys,
  two-space JSON5, and a short header comment. Rationale: "export and import in
  the same format" then holds literally, and export has no side effects.
  Comment-preserving targeted edits are left to `4.2.2`, which can reuse
  `app/runtime/plugin-runtime-json5-roundtrip.ts`. Date/Author: 2026-10-29,
  planning agent.
- Decision: all writes go through an atomic write (a temporary sibling file,
  then rename). Rationale: the watcher can fire mid-write, and a partial read
  would otherwise surface as a spurious parse error. Date/Author: 2026-10-29,
  planning agent.
- Decision: schema validation is structural. The root must be an object, each
  key a non-empty command identifier without leading or trailing whitespace,
  and each value a non-empty shortcut string or an array of such strings
  (possibly empty, which unbinds). Shortcut grammar validation is left to the
  `4.2.1` parser, because tightening it now could reject shortcuts that work
  today in Hyper's Mousetrap syntax. A JSON Schema generated from the Zod
  schema ships as `shared/schemas/keybindings.schema.json` for editor tooling.
  A parity test keeps it in step. Date/Author: 2026-10-29, planning agent.
- Decision: export and import are delivered as main-process utilities with no
  menu, command-palette, or command-line interface (CLI) entry point in this
  item. Rationale: the design places `keybindings.export` in the keybinding
  editor (`4.2.2`) and settings commands in `5.1.2`. A CLI entry would need the
  codec mirrored into `shared/`, because the CLI may only use `@shared` runtime
  code. Open question for the approver: if a user-reachable export/import is
  required for `3.2.1` itself, the smallest option is a main-process command
  pair (`keybindings:export`, `keybindings:import`) driven by native file
  dialogs. That adds about 4 files and one end-to-end scenario. Date/Author:
  2026-10-29, planning agent; requires approval.
- Decision: add a `docs/configuration-architecture.md` component architecture
  document for `app/config`, linked from the design document and the
  developers' guide. Rationale: the request asks for internal interfaces to be
  documented in the relevant component architecture document, and none exists.
  Date/Author: 2026-10-29, planning agent.

## Outcomes & retrospective

Not yet started. Populate this section at each milestone boundary and at
completion, comparing the result with `Purpose / big picture`.

## Context and orientation

Velocetty is an Electron application. The main process (code under `app/`) owns
configuration. The renderer (code under `lib/`) receives keymaps over
inter-process communication. `shared/` holds types and code shared with the
renderer and the CLI, but the main process may import only types from it.

Configuration lives in a per-user directory computed in `app/config/paths.ts`.
On Linux it is `$XDG_CONFIG_HOME/Hyper` or `~/.config/Hyper`, and in
development mode it may be the repository root. That module exports `cfgDir`,
`cfgPath` (`config.json5`), and, on this branch, `keybindingsFile` and
`keybindingsPath` (`keybindings.json5`).

Start-up and reload both run `_import()` from `createConfigImportModule` in
`app/config/import.ts`, wired up in `app/config.ts`. Today it:

1. creates plugin directories and copies the configuration schema;
2. loads the bundled defaults, then writes `config.json5` from them if it is
   missing;
3. reads the platform keymap from `app/keymaps/<platform>.json` into the
   defaults;
4. loads the user's `config.json5`, falling back to defaults on error;
5. calls the earlier delivery's keybindings module to load
   `keybindings.json5`, bootstrapping it from legacy `config.json5.keymaps` if
   missing, and replaces `userCfg.keymaps` with the result;
6. passes both to `_init` in `app/config/init.ts`. That computes
   `keymaps: mapKeys({...defaultCfg.keymaps, ...userCfg.keymaps})`, so a user
   entry replaces the default for that command. `app/utils/map-keys.ts`
   normalizes values to arrays, rewrites `cmd` to `command`, and expands
   `<command>:prefix` entries.

`app/config.ts` watches the files with chokidar 3.6 and reloads on `change`
after 100 milliseconds. It notifies "Configuration updated" and calls
subscribers: menus (`app/start.ts`), windows (`app/ui/window.ts`, which sends
`config change` to the renderer), plugins, and the updater. `app/plugins.ts`
`getDecoratedKeymaps` then layers runtime plugin keybindings (config wins) and
plugin `decorateKeymaps` hooks. This is the "plugin defaults" layer.

`app/config/json5-config.ts` provides `parseJson5WithSchemaDiagnostics`, which
returns `{value, diagnostics, usedFallback}`. Its diagnostics follow
`configValidationDiagnostic`: `path`, `message`, `suggestedFix`, and optional
`docHint` and `defaultHint`. It also provides `stringifyJson5` (sorted keys,
two-space indent, trailing newline).

Terms used in this plan:

- Last known good (LKG): the most recent user keybindings accepted from disk
  in this session.
- Observation: one read of `keybindings.json5`, classified as valid (with
  keymaps), invalid (with diagnostics), missing, or unreadable.
- Bootstrap: creating `keybindings.json5` at start-up when it does not exist.
- Port and adapter: a port is an interface the policy or service needs from
  the outside world, such as "read and write the keybindings text". An adapter
  implements it, such as the file-system store.
- Canonical serialization: `stringifyJson5` output with sorted keys, used
  whenever the application writes keymaps it did not receive as text.

Tests run with `bun test --concurrent --isolate test/unit` through `make test`.
Per-test temporary directories and injected dependencies are the norm
(`docs/developers-guide.md` §Unit tests (Bun)). There are no property tests or
proofs in the repository yet. The fast end-to-end lane,
`bun run test:e2e:fast`, launches the packaged Electron app with an isolated
configuration directory (`test/e2e/electron-e2e-helpers.ts`
`createIsolatedE2EEnvironment`). It reads stdout markers such as
`[e2e] renderer-ready`, emitted by `app/rpc.ts` when `RUN_E2E=1`. CI runs it on
Linux, macOS, and Windows for every pull request.

## Conformance basis

No Terms of Reference document exists for this work. The upstream artefacts are:

- `docs/velocetty-design.md` at the revision on `main` `40949b2f`:
  - DES-CFG-FILES: keybindings live in a separate `keybindings.json5`
    alongside `config.json5` (§File format and locations).
  - DES-CFG-KB-LAYER: keybinding layering is built-in defaults, then plugin
    defaults, then user overrides, then optional workspace overrides
    (§Layering rules).
  - DES-CFG-VALID: JSON5 parsing with comments and trailing commas; a pinned
    JSON Schema in `shared/schemas/`; structured parse and schema
    diagnostics (§Validation and error reporting).
  - DES-CFG-LKG: on error, keep the last known good configuration in memory,
    notify without blocking, and log full diagnostics (§Validation and error
    reporting).
  - DES-CFG-HOT: keybindings reload without restart (§Hot reload semantics).
  - DES-KB-EXPORT: the keybinding editor exports and imports JSON5
    (§Keybinding editor UI). This item prepares it; `4.2.2` delivers it.
- `docs/roadmap.md` item `3.2.1`:
  - RM-321-RW: "Provide read/write utilities with schema validation."
  - RM-321-XI: "Support export/import in the same format."
  - RM-321-OK: "keybinding edits persist and hot-reload cleanly."
- Pull request #67 review findings:
  - REV-67-LKG: prefer last known good over the bootstrap fallback.
  - REV-67-BOOT: do not bootstrap an empty file when `config.json5` fell
    back.
  - REV-67-WATCH: handle `add` and `unlink`.
  - REV-67-FLAG: `usedLastKnownGood` must reflect actual use.
  - REV-67-SIMPLE: drop the redundant path wrapper types.
  - REV-67-DOCS: define acronyms on first use, and keep the plan a living
    draft rather than a transcript.
- Governing standards: `AGENTS.md`, `docs/documentation-style-guide.md`,
  `docs/developers-guide.md`, `docs/adr-001-replace-ava-with-bun-test.md`
  (bun:test), and `docs/adr-005-enhance-e2e-testing-strategy.md` (layered
  end-to-end lanes).

Trace links:

```plaintext
DES-CFG-FILES, RM-321-RW -> keybindings-codec.ts, keybindings-store.ts -> EP-C, EP-D
  -> test/unit/keybindings-codec.test.ts, test/unit/keybindings-store.test.ts
DES-CFG-VALID -> keybindings-codec.ts, shared/schemas/keybindings.schema.json -> EP-C
  -> KB-COD-1, KB-COD-2, KB-COD-3
DES-CFG-LKG, REV-67-LKG, REV-67-FLAG -> keybindings-policy.ts observeKeybindings -> EP-B
  -> KB-POL-1 (proof), KB-SVC-2 (property)
REV-67-BOOT -> keybindings-policy.ts decideBootstrap -> EP-B, EP-D
  -> KB-POL-2 (proof and exhaustive table), test/unit/config-import-keybindings-json5.test.ts
RM-321-XI, DES-KB-EXPORT -> keybindings.ts importKeybindings, exportKeybindings -> EP-D
  -> KB-SVC-1 (property)
RM-321-OK, DES-CFG-HOT, REV-67-WATCH -> watcher.ts, app/config.ts -> EP-E
  -> KB-WATCH-1 (property), E2E-KB-1 to E2E-KB-3
DES-CFG-KB-LAYER -> app/config/init.ts (unchanged), keybindings layering docs -> EP-E
  -> KB-LAYER-1
REV-67-SIMPLE, REV-67-DOCS -> EP-D, EP-F -> code review, markdownlint
```

## Verification plan

The implementation is shaped so its load-bearing decisions are small pure
functions in `app/config/keybindings-policy.ts`. Those carry proofs. The I/O
around them is tested by properties and examples against real and in-memory
adapters.

Axioms (trusted, not verified here):

- AXIOM-JSON5: `json5@2` `parse` accepts JSON5 text and `stringify` emits text
  that `parse` reads back to an equal JSON value.
- AXIOM-ZOD: `zod@4` `z.record` and `z.union` validate as documented and return
  data equal to their input for accepted values.
- AXIOM-CHOKIDAR: chokidar 3.6 emits `change` on modification and `add` and
  `unlink` on creation and deletion of a watched path. With the default
  `atomic: true`, an unlink followed by an add within 100 milliseconds is
  reported as `change`.
- AXIOM-RENAME: `fs.renameSync` within one directory atomically replaces the
  destination on POSIX file systems. On Windows it may fail transiently with
  `EPERM` or `EBUSY`.
- AXIOM-ELECTRON: one Electron main process owns all application writes to the
  configuration directory. External editors may write concurrently, and the
  last writer wins.
- AXIOM-LEMMASCRIPT: `lsc` translates the annotated TypeScript faithfully into
  Dafny for the supported subset, and Dafny 4.x is sound.

Obligations:

- Obligation KB-POL-1 (last-known-good soundness). Let the state be
  `{active, lastKnownGood}`, where `lastKnownGood` is optional. Start from
  `{active: EMPTY, lastKnownGood: none}` and apply `observeKeybindings` over
  any sequence of observations. The resulting `active` equals the keymaps of
  the latest accepted observation (`valid` carries its keymaps; `missing`
  carries `EMPTY`), or `EMPTY` if none has been accepted. `lastKnownGood`
  equals that same value, or `none` if nothing was accepted. Corollaries,
  stated as separate `ensures` clauses: an `invalid` or `unreadable`
  observation never changes `active` or `lastKnownGood`, and an accepted
  observation always becomes `active`.
  - Method: LemmaScript proof (Dafny backend) of
    `replayKeybindingObservations(history) == specLatestAccepted(history)`.
    The left side folds `observeKeybindings`. The right side is an
    independent recursive search from the end of the history. Backed by a
    fast-check model-based test of the service (KB-SVC-2).
  - Rationale: this is the design's central safety promise and the precise
    defect found in review, and it must hold for every history, not a
    sample. The fold-versus-search equivalence is an inductive lemma, not a
    restatement.
  - Domain: all finite observation sequences, with the keymap payload
    abstract.
  - Artefact: `app/config/keybindings-policy.ts` (annotated),
    `app/config/keybindings-policy.dfy`, `app/config/keybindings-policy.dfy.gen`,
    and `LemmaScript-files.txt`.
  - Evidence: `make prove`. Red: with the `ensures` clauses written before the
    body exists (Stage B), `lsc check` reports the postconditions unproved.
    Green: `make prove` reports zero errors.
  - Non-vacuity: the initial state and each of the four observation kinds
    are reachable witnesses, and the proof's `requires` is `true`. The
    negative control is to temporarily make the invalid branch choose
    `fallback ?? lastKnownGood`, re-introducing pull request #67's defect.
    `make prove` must then fail on KB-POL-1, and KB-SVC-2 must find a
    counterexample. Record both outputs in `Artefacts and notes`, then
    revert.
- Obligation KB-POL-2 (bootstrap safety).
  `decideBootstrap({fileState, legacy})` returns `writeNothing` whenever the
  file exists. It returns `defer` (no write) when the legacy `config.json5`
  failed to parse. It returns `seed(legacy keymaps)` only when the file is
  missing and `config.json5` parsed with keymaps. It returns `seed(EMPTY)` when
  the file is missing and `config.json5` was freshly created or had no keymaps.
  - Method: an exhaustive table test over the full finite domain (2 file
    states by 4 legacy states) plus LemmaScript `ensures` clauses.
  - Rationale: contractual migration logic with a small finite domain. The
    table enumerates it completely, and the proof guards the contract against
    future edits.
  - Artefact: `test/unit/keybindings-policy.test.ts` and
    `app/config/keybindings-policy.ts`.
  - Evidence: Red: the table fails against a stub returning `writeNothing`.
    Green: all eight rows pass, and `make prove` is clean.
  - Non-vacuity: every row is a distinct witness. The mutation that restores
    "parse failure seeds `{}`" must fail both the table and the proof.
- Obligation KB-COD-1 (codec round trip and canonical form). For every
  admissible keymap `k`: `parseKeybindingsText(serializeKeybindings(k))` is
  `ok` with a value equal to `k`; `serializeKeybindings` is idempotent through
  a parse; and its output does not depend on key insertion order.
  - Method: fast-check property.
  - Rationale: an infinite input domain, with tricky keys (`__proto__`,
    `constructor`, quotes, backslashes, non-ASCII, and keys that look like
    numbers). Sampling with targeted arbitraries is proportionate.
  - Artefact: `test/unit/keybindings-codec.property.test.ts`, with
    arbitraries in `test/testUtils/keybindings-arbitraries.ts`.
  - Evidence: Red against a stub serializer. Green at `numRuns: 500` with the
    seed logged, so a failure can be replayed.
  - Non-vacuity: `fc.statistics` classification shows string values, array
    values, empty arrays, and prototype-named keys each above 5% of samples.
    The mutation that removes key sorting must fail the insertion-order
    property.
- Obligation KB-COD-2 (parser totality and diagnostic shape). For any string
  and any JSON value, `parseKeybindingsText` returns, without throwing, either
  `ok` with a value satisfying `isKeymapConfig`, or `invalid` with at least one
  diagnostic that has a non-empty `path`, `message`, and `suggestedFix`.
  - Method: fast-check over `fc.string()`, `fc.jsonValue()` (printed with
    `JSON5.stringify`), and a mutation arbitrary that corrupts valid
    documents, plus named examples for each rejection class: non-object
    root, number value, nested object, empty command identifier, whitespace
    shortcut, and a syntax error with line and column.
  - Artefact: `test/unit/keybindings-codec.property.test.ts` and
    `test/unit/keybindings-codec.test.ts`.
  - Non-vacuity: classification must show both outcomes above 10%.
- Obligation KB-COD-3 (JSON Schema parity). The committed
  `shared/schemas/keybindings.schema.json` equals the schema generated from the
  Zod schema, and accepts and rejects the same fixture corpus.
  - Method: a named example test with a fixture corpus validated by `ajv`,
    which is already a development dependency.
  - Artefact: `test/unit/keybindings-schema-parity.test.ts`.
  - Non-vacuity: the corpus contains at least one accepted and one rejected
    document per rejection class from KB-COD-2.
- Obligation KB-SVC-1 (import and export laws). For any text `t` that parses
  as valid, `importKeybindings(t)` followed by `exportKeybindings()` returns
  exactly `t`. For any invalid `t`, `importKeybindings(t)` leaves the stored
  text, the active keymaps, and the last known good unchanged, and returns
  diagnostics. `exportKeybindings()` never writes.
  - Method: fast-check property over the service with an in-memory store
    that counts writes.
  - Artefact: `test/unit/keybindings-service.property.test.ts`.
  - Non-vacuity: both valid and invalid inputs above 20% by classification.
    A mutation that canonicalizes on import must fail the verbatim law.
- Obligation KB-SVC-2 (service refines the policy). For any sequence of
  operations against the in-memory store, the service's `active` keymaps equal
  `specLatestAccepted` of the observations it made. Operations are: write valid
  text, write invalid text, delete, make unreadable, load, import, and export.
  - Method: fast-check `fc.commands` model-based test, with
    `specLatestAccepted` imported from the policy module as the model.
  - Rationale: the proof covers the pure reducer only. This test covers the
    wiring that feeds it.
  - Artefact: `test/unit/keybindings-service.model.test.ts`.
  - Non-vacuity: command-mix statistics show every operation, and the pull
    request #67 mutation must produce a shrunk counterexample.
- Obligation KB-STORE-1 (atomic, non-destructive writes). A write either
  leaves the previous content intact or replaces it whole. No temporary file
  survives a failed write. Transient rename failures are retried, then fall
  back to a direct write with a logged warning.
  - Method: parameterized fault-injection tests against a real temporary
    directory, with an injected file-system port that fails at each step.
  - Artefact: `test/unit/keybindings-store.test.ts`.
  - Non-vacuity: each injected fault point is asserted to have been reached.
- Obligation KB-WATCH-1 (coalesced, complete reload triggering). For any
  sequence of `add`, `change`, and `unlink` events on either watched path at
  arbitrary times, the watcher triggers exactly one reload per burst, where a
  burst is a maximal run of events with gaps under the debounce interval. It
  triggers that reload after the burst's last event. It triggers none after
  `close()`.
  - Method: fast-check property with an injected scheduler and a fake clock.
  - Artefact: `test/unit/config-watcher.property.test.ts`.
  - Non-vacuity: generated sequences include single events, long bursts, and
    gaps exactly at the debounce boundary. The current per-event timer
    implementation must fail the property, and that is the red step.
- Obligation KB-LAYER-1 (layering contract). For default keymaps `d` and user
  keymaps `u`, the effective keymaps from `_init` map each command in `u` to
  `u`'s normalized value. That includes `[]`, which unbinds. Every command only
  in `d` keeps `d`'s value.
  - Method: fast-check property over `_init`. This documents existing
    behaviour, which this plan relies on and does not change.
  - Artefact: `test/unit/config-keymap-layering.property.test.ts`.
  - Non-vacuity: classification of overlap and disjoint commands, with both
    above 20%.
- End-to-end obligations (fast lane, real Electron, isolated configuration
  directory), in `test/e2e/keybindings.e2e.test.ts`:
  - E2E-KB-1 (migration and persistence): with a legacy `config.json5`
    containing `keymaps: {'window:new': 'ctrl+alt+n'}` and no
    `keybindings.json5`, launching creates `keybindings.json5` with that map.
    `config.json5` is unchanged byte for byte.
  - E2E-KB-2 (hot reload): after `[e2e] renderer-ready`, rewriting
    `keybindings.json5` to bind `window:new` to `ctrl+shift+n` produces a
    marker `[e2e] keymaps-applied window:new=ctrl+shift+n` within 5 seconds.
  - E2E-KB-3 (invalid reload keeps last known good): then writing invalid
    JSON5 produces `[e2e] keymaps-rejected` and no further
    `keymaps-applied` marker. A final valid write is applied again.
  - The markers are emitted from `app/config.ts` only when `RUN_E2E=1`,
    matching the `app/rpc.ts` precedent. They print only the commands the
    test names in `E2E_KEYMAP_PROBE`, to keep logs small.

There is no further non-trivial invariant. The codec's schema is declarative,
and the CLI, renderer, and menu consumers are unchanged.

## Plan of work

### Stage A: tooling (EP-A)

Add `fast-check` (`^4.10.2`) and `lemmascript` (`^0.6.5`; on a `0.x` version
the caret already holds the minor version) as development dependencies with
`bun add -d`. Commit `bun.lock`. Add a `prove` target to `Makefile` that runs
`bunx lsc check --backend=dafny` with no file argument, so it batches over a
new root `LemmaScript-files.txt`. Add `prove` to the `all` target. Validate the
Makefile with `mbake validate Makefile` and `checkmake Makefile`. Add a
one-paragraph note under §Tests in `docs/developers-guide.md` on property tests
and proofs: naming, seeds, `numRuns`, and `make prove`. Confirm that packaging
excludes `*.dfy` and `*.dfy.gen` (see `build/esbuild/copy-artefacts.ts`); if it
does not, exclude them.

Go/no-go: `make prove` runs and reports "no files" or verifies a trivial
sample. Run all four gates.

### Stage B: policy core with proof (EP-B, prototyping first)

Prototype: write `app/config/keybindings-policy.ts` with the types and `//@`
contracts from `Interfaces and dependencies`, and bodies that return a fixed
value. Run `lsc gen` and `lsc check`. Keep the prototype if Dafny reports the
expected unproved postconditions, which means LemmaScript accepted the types.
Discard and apply the `Risks` fallbacks if `lsc` rejects the input, and record
which fallback was taken in `Decision log`.

Red: write `test/unit/keybindings-policy.test.ts`, covering the KB-POL-2 table
and named KB-POL-1 transitions, and watch it fail.

Green: implement `observeKeybindings`, `replayKeybindingObservations`,
`specLatestAccepted`, and `decideBootstrap`. Add helper lemmas to the `.dfy`
until `make prove` is clean. Run the negative control and record its output.

Refactor: tidy names, keep the file under 400 lines, and rerun the focused
tests, `make prove`, and the four gates.

### Stage C: codec and JSON Schema (EP-C)

Red: `test/unit/keybindings-codec.test.ts` (named rejection classes and
diagnostics) and `test/unit/keybindings-codec.property.test.ts` (KB-COD-1 and
KB-COD-2), plus `test/testUtils/keybindings-arbitraries.ts`.

Green: create `app/config/keybindings-codec.ts`. It holds the Zod schema (moved
from `app/config/keybindings.ts` and tightened as in `Decision log`),
`parseKeybindingsText`, `serializeKeybindings` (header comment plus
`stringifyJson5`), and `keybindingsDiagnosticHints`. Make `app/config/import.ts`
`loadPlatformKeymap` use `parseKeybindingsText` for the bundled platform
keymaps. Generate `shared/schemas/keybindings.schema.json` from the Zod schema
through a new `bin/generate-keybindings-schema.mjs`, called from the existing
`generate-schema` script. Add `test/unit/keybindings-schema-parity.test.ts`
(KB-COD-3).

Refactor, then run the four gates and `make prove`.

### Stage D: store, service, and importer rewiring (EP-D)

Red: `test/unit/keybindings-store.test.ts` (KB-STORE-1),
`test/unit/keybindings-service.test.ts` (named examples, including
`usedLastKnownGood` accuracy), `test/unit/keybindings-service.property.test.ts`
(KB-SVC-1), and `test/unit/keybindings-service.model.test.ts` (KB-SVC-2).
Rewrite `test/unit/config-import-keybindings-json5.test.ts` so the
last-known-good case uses legacy keymaps that differ from the file. The old
test passed by coincidence; this one fails against the current code.

Green: create `app/config/keybindings-store.ts`, exporting the
`KeybindingsStore` port and `createFileKeybindingsStore`, which does atomic
writes with bounded rename retry. Rewrite `app/config/keybindings.ts` as the
application service `createKeybindingsService`. It composes the store, codec,
and policy, holds the policy state, and exposes `load`, `importKeybindings`,
`exportKeybindings`, and `writeKeybindings`. Rewire `app/config/import.ts` to
compute `decideBootstrap` from the `config.json5` outcome (parsed, freshly
created, or fell back), act on it through the service, and return an import
report (`keybindingsStatus: 'applied' | 'fallback'`) through a new
`getLastImportReport()` on the module. Delete the old wrapper types
(REV-67-SIMPLE). Delete `test/unit/keybindings-json5.test.ts`, whose cases move
into the service tests. Log a one-time start-up warning when
`config.json5.keymaps` is non-empty and `keybindings.json5` exists.

Refactor, then run the four gates and `make prove`. Keep `import.ts` under 400
lines; it is 354 now, so if it grows past about 380, move the keybindings
orchestration into `keybindings.ts`.

### Stage E: watcher hardening and end-to-end coverage (EP-E)

Red: `test/unit/config-watcher.property.test.ts` (KB-WATCH-1) against a new
`app/config/watcher.ts` stub, and an extended
`test/unit/config-keybindings-watch.test.ts`. The extended test checks that
`add` and `unlink` trigger a reload, that a fallback reload suppresses
"Configuration updated", and that subscribers still run so the last known good
state is re-sent. Also add `test/unit/config-keymap-layering.property.test.ts`
(KB-LAYER-1) and `test/e2e/keybindings.e2e.test.ts` (E2E-KB-1 to E2E-KB-3).

Green: implement
`createConfigWatcher({watch, paths, debounceMs, schedule, cancel, onReload})` in
`app/config/watcher.ts`, with one shared debounce timer, `add`, `change`, and
`unlink` handlers, and `close`. Use it from `app/config.ts` `_watch`. Use
`getLastImportReport()` to choose between "Configuration updated" and silence,
since the keybindings service has already notified the error. Emit the `[e2e]`
markers under `RUN_E2E=1`.

Refactor, then run the four gates, `make prove`, and `bun run test:e2e:fast`
locally if the host can build `node-pty`. Otherwise rely on CI and record that
here.

### Stage F: documentation, ADR, CI, roadmap (EP-F)

- Write `docs/adr-007-keybindings-json5-storage-format.md` using the house ADR
  template. It covers the map format against the rule array, verbatim import
  and export, last-known-good semantics, migration without touching
  `config.json5`, and additive evolution towards `4.2.1`.
- Update `docs/velocetty-design.md`:
  - §Configuration system: JSON5 and layering gets the storage format, error
    behaviour, and migration;
  - §Keybinding editor UI cross-links ADR-007;
  - implementation plan line 3.2 is ticked.
- Create `docs/users-guide.md` with a "Keyboard shortcuts" section covering:
  - file location per platform, format, and examples;
  - unbinding with `[]`;
  - hot reload, and what happens on errors;
  - deleting the file;
  - migration from `config.json5`;
  - sharing a configuration by copying the file, with a forward note that
    export and import commands arrive with the keybinding editor.
- Create `docs/configuration-architecture.md`, covering the components of
  `app/config` (importer, layering, reloadability, watcher, and the keybindings
  policy, codec, store, and service), their ports, data flow on start-up and
  reload, and the proof boundary.
- Update `docs/developers-guide.md`: replace the keybinding storage bullets
  with links to the architecture document; document property-test and proof
  conventions and the `[e2e]` marker convention; list the new test files.
- Add the reloadability `keymap`/`keymaps` note to `docs/tracking-issues.md`.
- Add `make prove` to the Linux `build` job in `.github/workflows/nodejs.yml`,
  with a pinned Dafny install step.
- On completion, mark roadmap item `3.2.1` and its sub-items `[x]` (done), and
  set this plan's status to `COMPLETE` after the reconciliation in
  `Outcomes & retrospective`.

Run all gates plus `make markdownlint` and `make nixie`.

## Milestones and plateaus

Each stage above is one milestone (EP-A to EP-F). Every milestone ends with all
of `make check-fmt`, `make typecheck`, `make lint`, and `make test` passing.
From EP-B onwards `make prove` must pass too. Each milestone ends with at least
one commit.

- EP-A: tooling installed and documented. No behaviour change.
  - Requirements: none (enabling).
  - Acceptance: `make prove` runs.
  - Conformance: no runtime dependency added; two approved development
    dependencies.
  - Recovery: revert the commit.
  - Remaining gaps: everything else.
  - Compatibility decision: none.
- EP-B: proved policy module exists, but is not yet used by the application.
  - Requirements: DES-CFG-LKG, REV-67-LKG, REV-67-FLAG, REV-67-BOOT (policy
    level).
  - Acceptance: `make prove` reports zero errors, and the negative control
    fails as recorded.
  - Conformance: pure module with no I/O imports; no persisted-format
    change.
  - Recovery: revert. The application is unaffected.
  - Remaining gaps: the service does not use it yet.
  - Compatibility decision: none.
- EP-C: codec and schema in place, and platform keymaps parse through them.
  - Requirements: DES-CFG-VALID, RM-321-RW (validation).
  - Acceptance: KB-COD-1 to KB-COD-3 pass.
  - Conformance: the accepted shape is unchanged except for rejecting empty
    command identifiers and whitespace-only shortcuts. That is a
    persisted-format tightening, approved through this plan and recorded in
    ADR-007.
  - Recovery: revert.
  - Remaining gaps: the store and service.
  - Compatibility decision: existing `keybindings.json5` files written by the
    earlier branch build are a deployed state only on developer machines.
    They remain valid unless they contain empty identifiers, so no migration
    is needed.
- EP-D: the application loads, bootstraps, imports, and exports through the
  service. Review defects are fixed.
  - Requirements: RM-321-RW, RM-321-XI, REV-67-LKG, REV-67-BOOT, REV-67-FLAG,
    REV-67-SIMPLE.
  - Acceptance: KB-SVC-1, KB-SVC-2, KB-STORE-1, and the rewritten importer
    tests pass, and the negative control fails.
  - Conformance: `config.json5` is never written by keybinding code
    (asserted in tests by comparing bytes); `parsedConfig.keymaps` shape is
    unchanged.
  - Recovery: revert to EP-C. The old module is restored by the revert.
  - Remaining gaps: watcher semantics.
  - Compatibility decision: legacy `config.json5.keymaps` are a deployed
    state (Hyper users), handled by the bootstrap decision; no source-level
    shims.
- EP-E: hot reload is robust and observable end to end.
  - Requirements: RM-321-OK, DES-CFG-HOT, REV-67-WATCH, DES-CFG-KB-LAYER.
  - Acceptance: KB-WATCH-1, KB-LAYER-1, and E2E-KB-1 to E2E-KB-3 pass (the
    end-to-end tests in CI at minimum).
  - Conformance: no new IPC channel; markers only under `RUN_E2E=1`.
  - Recovery: revert to EP-D.
  - Remaining gaps: documentation.
  - Compatibility decision: none.
- EP-F: documentation, ADR, CI proof step, and roadmap are complete.
  - Requirements: all traced items, documented.
  - Acceptance: `make markdownlint` and `make nixie` pass, the CI `build` job
    runs `make prove` green, and roadmap `3.2.1` is ticked.
  - Conformance: every Decision log entry is reflected in ADR-007 or the
    design document.
  - Recovery: documentation-only reverts.
  - Remaining gaps: none for `3.2.1`.
  - Compatibility decision: none.

At each boundary, check that the assigned requirements are met, the design is
still followed, no unapproved interface, dependency, or format change crept in,
and the trace links above are current. Record the result in `Progress`.

## Concrete steps

Run everything from the repository root
(`/home/leynos/.lody/repos/github---leynos---velocetty/worktrees/3517761b-5835-4968-a389-cc116ca5be08`
in the planning session, or any checkout of this branch). Tee long outputs to
`/tmp`, following the house convention:

```bash
BRANCH=$(git branch --show-current)
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-${BRANCH}.out
make typecheck 2>&1 | tee /tmp/typecheck-velocetty-${BRANCH}.out
make lint 2>&1 | tee /tmp/lint-velocetty-${BRANCH}.out
make test 2>&1 | tee /tmp/test-velocetty-${BRANCH}.out
make prove 2>&1 | tee /tmp/prove-velocetty-${BRANCH}.out
```

Focused red and green loops use, for example:

```bash
bun test --isolate test/unit/keybindings-policy.test.ts
bunx lsc check --backend=dafny app/config/keybindings-policy.ts
```

The expected tail of a passing `make test`:

```plaintext
 5xx pass
 0 fail
```

The expected tail of a passing `make prove` (exact wording depends on the
LemmaScript version):

```plaintext
Dafny program verifier finished with N verified, 0 errors
```

End-to-end, with CI parity:

```bash
bun run test:e2e:fast 2>&1 | tee /tmp/e2e-fast-velocetty-${BRANCH}.out
```

## Validation and acceptance

Behavioural acceptance, observable by a person:

1. Start the application with a `config.json5` whose `keymaps` binds
   `window:new` to `ctrl+alt+n` and no `keybindings.json5`. Then
   `keybindings.json5` exists, containing that binding, and `config.json5` is
   unchanged. Pressing `Ctrl+Alt+N` opens a window.
2. Edit `keybindings.json5` to bind `window:new` to `ctrl+shift+n` and save.
   Within about a second `Ctrl+Shift+N` opens a window, and the menu shows the
   new accelerator.
3. Save `keybindings.json5` with a syntax error. A notification names the
   location and a suggested fix, `Ctrl+Shift+N` still works, and no
   "Configuration updated" notice appears.
4. Delete `keybindings.json5`. Platform defaults apply. Restart: an empty
   `keybindings.json5`, or one seeded from legacy keymaps, is recreated as
   documented.

Red-Green-Refactor evidence is recorded per stage in `Artefacts and notes`: the
red command and its expected failure, the green command passing, and the
refactor gates passing.

Quality criteria:

- Tests: `make test` passes with all new suites. `bun run test:e2e:fast`
  passes in CI on Linux, macOS, and Windows.
- Verification: `make prove` passes, KB-POL-1 and KB-POL-2 are discharged,
  and both negative controls are recorded as failing for the intended reason.
- Lint and typecheck: `make lint` and `make typecheck` are clean.
- Formatting: `make check-fmt` and `make markdownlint` are clean, and
  `make nixie` is clean if diagrams are added.

## Idempotence and recovery

Every stage is additive or a refactor behind tests, and can be rerun. Gate
commands are read-only apart from `make fmt`. `make prove` regenerates only
`.dfy.gen` files. Never delete a `.dfy` to "start clean"; use `lsc regen`. The
pre-rebase state is preserved locally on `backup/3-2-1-pre-rebase-e3335b98`,
and on the remote until the next push. If an end-to-end run leaves temporary
configuration directories behind, `createIsolatedE2EEnvironment().cleanup`
removes them. Rerunning the suite is safe.

## Artefacts and notes

Gate evidence from planning (rebased and repaired tree, commit `9f8c2cd1`):

```plaintext
make check-fmt   pass
make typecheck   pass
make lint        pass
make test        514 pass, 0 fail (67 files)
make markdownlint 0 issues in 65 files
```

Negative-control transcripts, red and green outputs, and end-to-end logs are
added here during implementation.

## Interfaces and dependencies

Development dependencies: `fast-check@^4.10.2` and `lemmascript@^0.6.5`. The
runtime dependencies stay as they are: `json5`, `zod`, `fs-extra`, and
`chokidar` from `app/package.json`.

`app/config/keybindings-policy.ts` (pure, LemmaScript-verified):

```typescript
export type UserKeymaps = Readonly<Record<string, string | readonly string[]>>;

export type KeybindingsObservation =
  | {readonly kind: 'valid'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'missing'}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'unreadable'};

export type KeybindingsState = {
  readonly active: UserKeymaps;
  readonly lastKnownGood: UserKeymaps | null;
};

export const initialKeybindingsState: KeybindingsState;

/** Applies one observation; invalid and unreadable observations never change state. */
export function observeKeybindings(state: KeybindingsState, observation: KeybindingsObservation): KeybindingsState;

export function replayKeybindingObservations(history: readonly KeybindingsObservation[]): KeybindingsState;

/** Independent specification: keymaps of the latest accepted observation, else empty. */
export function specLatestAccepted(history: readonly KeybindingsObservation[]): UserKeymaps;

export type LegacyKeymapsSource =
  | {readonly kind: 'parsed'; readonly keymaps: UserKeymaps | undefined}
  | {readonly kind: 'freshly-created'}
  | {readonly kind: 'fell-back'};

export type BootstrapDecision =
  | {readonly kind: 'write-nothing'}
  | {readonly kind: 'defer'}
  | {readonly kind: 'seed'; readonly keymaps: UserKeymaps};

export function decideBootstrap(input: {
  readonly fileExists: boolean;
  readonly legacy: LegacyKeymapsSource;
}): BootstrapDecision;
```

The four legacy states in KB-POL-2 are `parsed` with keymaps, `parsed` without
keymaps, `freshly-created`, and `fell-back`.

`app/config/keybindings-codec.ts`:

```typescript
export type KeybindingsParseOutcome =
  | {readonly kind: 'ok'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]};

export const parseKeybindingsText: (text: string, sourceLabel: string) => KeybindingsParseOutcome;
export const serializeKeybindings: (keymaps: UserKeymaps) => string;
export const keybindingsSchema: z.ZodType<UserKeymaps>;
```

`app/config/keybindings-store.ts` (driven port and adapter):

```typescript
export type KeybindingsReadOutcome =
  | {readonly kind: 'present'; readonly text: string}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly error: unknown};

export type KeybindingsStore = {
  readonly location: string;
  readonly read: () => KeybindingsReadOutcome;
  readonly write: (text: string) => {readonly ok: true} | {readonly ok: false; readonly error: unknown};
};

export const createFileKeybindingsStore: (options: {
  readonly filePath: string;
  readonly fs?: KeybindingsFileSystem; // injected for fault tests; defaults to node:fs
  readonly warn?: typeof console.warn;
}) => KeybindingsStore;
```

`app/config/keybindings.ts` (application service):

```typescript
export type KeybindingsLoadResult = {
  readonly keymaps: UserKeymaps;
  readonly diagnostics: readonly configValidationDiagnostic[];
  readonly status: 'applied' | 'fallback';
  readonly usedLastKnownGood: boolean;
};

export const createKeybindingsService: (dependencies: {
  readonly store: KeybindingsStore;
  readonly notify: ConfigImportNotify;
  readonly warn?: typeof console.warn;
}) => {
  readonly load: (bootstrap: BootstrapDecision) => KeybindingsLoadResult;
  readonly importKeybindings: (text: string, sourceLabel: string) => KeybindingsMutationResult;
  readonly exportKeybindings: () => {readonly text: string; readonly canonicalized: boolean};
  readonly writeKeybindings: (keymaps: UserKeymaps) => KeybindingsMutationResult;
};
```

`app/config/watcher.ts`:

```typescript
export const createConfigWatcher: (options: {
  readonly watch: (paths: readonly string[]) => WatcherHandle; // chokidar adapter at the composition root
  readonly paths: readonly string[];
  readonly debounceMs: number;
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly onReload: () => void;
}) => {readonly close: () => Promise<void>};
```

`app/config/import.ts` gains `keybindingsPath` in `ConfigImportPaths` (already
present) and
`getLastImportReport(): {readonly keybindingsStatus: 'applied' | 'fallback'}`
on the module it returns.

Exact type names may be adjusted during Stage B if LemmaScript requires it. Any
such change is recorded in `Decision log`.

## Revision note

- 2026-10-29: rewritten from the earlier `COMPLETE` delivery record into a
  `DRAFT` plan. The branch was rebased onto `main`, with conflicts resolved and
  the fallout repaired. Recorded defects found in review and reconnaissance:
  the last-known-good precedence bug, the migration block on `config.json5`
  fallback, the watcher's missing `add` and `unlink` events and lack of
  coalescing, and a success notice shown on fallback. The work was restructured
  into proved policy, codec, store, service, and watcher milestones with
  property, proof, and end-to-end obligations. Roadmap `3.2.1` was reopened.
  Remaining work is all of Stages A to F, after approval.
