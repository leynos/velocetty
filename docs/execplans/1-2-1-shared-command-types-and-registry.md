# Implement shared command types and deterministic registry APIs (roadmap 1.2.1)

## Module header

- Purpose: define and execute roadmap item `1.2.1` by introducing shared
  command definition contracts, metadata, schema-aware validation, and
  deterministic registry create, read, update, delete (CRUD) APIs that can be
  reused by renderer and backend command dispatch paths.
- Invariants: preserve current keyboard/menu command behaviour while replacing
  ad-hoc string-to-handler maps with typed, enumerable registry surfaces.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`, and
  `docs/developers-guide.md`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: COMPLETE (2026-02-19)

No `PLANS.md` exists at repository root as of 2026-02-19, so this plan is
self-contained.

## Purpose / big picture

Roadmap item `1.2.1` requires a real command foundation, not only callable
handlers. Today, command behaviour is spread across `app/commands.ts` and
`lib/command-registry.ts` as mutable maps keyed by raw strings, with no shared
command model, no metadata surface, and no argument/result validation. This
blocks upcoming roadmap items that depend on discoverable commands, unified
invocation, and context-aware enablement.

After this change, the repository should expose one shared command contract
shape (`CommandDefinition` plus metadata and optional schemas), and one
registry API family that can register, update, remove, get, and enumerate
command definitions in deterministic order. Success is observable when
`make test` includes new registry tests proving:

- command enumeration is deterministic across runs for the same registry state,
- argument validation rejects invalid payloads with structured error objects,
- the current runtime command entry points can read command definitions through
  the new registry API without regressing existing behaviour.

This milestone must also document new development practice in
`docs/developers-guide.md` and only mark roadmap checkbox `1.2.1` complete
after all required gates pass: `bun install`, `make build`, `make check-fmt`,
`make lint`, and `make test`.

## Constraints

- Keep command IDs backward-compatible with currently shipped IDs in
  `app/commands.ts` and keymap consumers in `lib/containers/hyper.tsx`.
- Do not change external plugin-facing command hook names in this milestone
  (`registerCommands`, existing keymap wiring) unless a compatibility shim is
  provided in the same change.
- Define shared command contracts under `shared/src/types/` and export via
  `shared/src/index.ts` so frontend and backend can consume the same types.
- Do not add new third-party dependencies; prefer existing `ajv` for JSON
  Schema validation support and existing TypeScript runtime patterns.
- Preserve current renderer-to-main execution flow while introducing registry
  APIs; behavioural changes to dispatch precedence are out of scope for `1.2.1`.
- Keep file-level scope focused on command primitives and registry APIs; defer
  context-key parser/evaluator implementation to roadmap item `1.2.2`.
- Update `docs/developers-guide.md` to capture any new command registration or
  validation practice required by this milestone.
- Mark `docs/roadmap.md` item `1.2.1` done only after all required gates pass.

## Tolerances (exception triggers)

- Scope: if implementation exceeds 16 files or 750 net changed lines, stop and
  escalate with options.
- Interface: if plugin-facing command registration APIs must be removed rather
  than adapted, stop and escalate.
- Ordering semantics: if deterministic ordering cannot be delivered without
  changing existing keymap conflict behaviour, stop and escalate with concrete
  alternatives.
- Dependencies: if existing `ajv` cannot satisfy schema validation needs and a
  new dependency appears necessary, stop and escalate.
- Validation: if any required gate fails after two focused remediation passes,
  stop and escalate with logs.
- Ambiguity: if roadmap/design wording permits multiple incompatible registry
  contracts, stop and request a decision with trade-offs.

## Risks

- Risk: replacing current ad-hoc maps could regress keyboard shortcut dispatch.
  Severity: high
  Likelihood: medium
  Mitigation: preserve compatibility wrappers for `getCommandHandler` and
  `registerCommandHandlers` during migration, and extend existing unit tests in
  `test/unit/command-registry.test.ts`.

- Risk: deterministic ordering choice may conflict with plugin assumptions
  about insertion order.
  Severity: medium
  Likelihood: medium
  Mitigation: document ordering contract explicitly (stable sort strategy), add
  tests for ordering invariants, and preserve current behaviour for existing
  commands via compatibility helpers.

- Risk: schema validation errors could be too generic to satisfy success
  criteria.
  Severity: high
  Likelihood: medium
  Mitigation: define a typed structured error shape in shared contracts and
  assert precise fields in unit tests.

- Risk: this work overlaps upcoming dispatcher/context-key milestones, which can
  cause interface churn if contracts are under-specified.
  Severity: medium
  Likelihood: high
  Mitigation: include dispatcher-friendly fields from design now
  (`defaultWhen`, `kind`, optional result schema), but keep runtime wiring
  minimal for this milestone.

## Progress

- [x] (2026-02-19 00:00Z) Confirmed roadmap item `1.2.1` scope and explicit
  success criteria in `docs/roadmap.md`.
- [x] (2026-02-19 00:00Z) Mapped design contracts for command model and
  dispatcher prerequisites in `docs/velocetty-design.md`.
- [x] (2026-02-19 00:00Z) Audited current command infrastructure in
  `app/commands.ts`, `lib/command-registry.ts`, `lib/containers/hyper.tsx`, and
  `lib/components/terms.tsx`.
- [x] (2026-02-19 00:00Z) Collected gate and development-practice requirements
  from `Makefile` and `docs/developers-guide.md`.
- [x] (2026-02-19 00:00Z) Drafted this ExecPlan.
- [x] (2026-02-19 11:15Z) Received explicit approval to begin implementation.
- [x] (2026-02-19 11:16Z) Stage A complete: shared command contracts landed in
  `shared/src/types/commands.ts` and are exported through `shared/src/index.ts`.
- [x] (2026-02-19 11:17Z) Stage B complete: deterministic registry CRUD and
  argument-schema validation landed in `lib/command-registry.ts` with unit
  coverage in `test/unit/command-registry.test.ts`.
- [x] (2026-02-19 11:18Z) Stage C complete: compatibility wrappers remain in
  place for `registerCommandHandlers`, `getCommandHandler`, and
  `getRegisteredKeys`.
- [x] (2026-02-19 11:22Z) Stage D complete: updated
  `docs/developers-guide.md`, marked roadmap item `1.2.1` done, and validated
  required gates (`bun install`, `make build`, `make check-fmt`, `make lint`,
  `make test`) plus docs gates (`markdownlint`, `nixie`).

## Surprises & discoveries

- Observation: current renderer registry only stores handlers and keymap
  lookups, with no metadata or schema support.
  Evidence: `lib/command-registry.ts` exports
  `registerCommandHandlers/getCommandHandler/getRegisteredKeys` over mutable
  records.
  Impact: milestone `1.2.1` needs a new shared model and API rather than minor
  type tweaks.

- Observation: command execution currently bifurcates between renderer handlers
  and `transport.emit('command', command)` fallback.
  Evidence: `lib/actions/ui.ts::execCommand` and
  `lib/containers/hyper.tsx::attachKeyListeners`.
  Impact: registry introduction must preserve this split while exposing typed
  command definitions for both sides.

- Observation: shared package already exports transport contracts and includes
  `ajv` as an existing dependency in repository manifests.
  Evidence: `shared/src/index.ts`, `shared/src/types/transport.ts`, and
  `package.json` dependency list.
  Impact: this milestone can add shared command contracts without adding new
  packages.

- Observation: initial registry implementation duplicated command contract types
  in `lib/command-registry.ts` instead of importing shared contracts.
  Evidence: first implementation pass declared local `CommandDefinition` and
  `CommandValidationError` interfaces in `lib/command-registry.ts`.
  Impact: follow-up alignment was required to ensure runtime registry APIs
  consume `@shared/types/commands`.

## Decision log

- Decision: treat existing map-based command plumbing as replace-with-shim,
  not extend-in-place.
  Rationale: roadmap requires shared definition metadata and schema validation,
  which do not fit the current `Record<string, fn>` shape cleanly.
  Date/Author: 2026-02-19 / Codex

- Decision: design contracts in `shared/src/types/commands.ts` first, then
  adapt renderer/main command modules to consume those contracts.
  Rationale: shared contracts are required for future frontend/backend registry
  and dispatcher milestones.
  Date/Author: 2026-02-19 / Codex

- Decision: keep implementation gated by explicit user approval because this
  file is an ExecPlan draft.
  Rationale: execplans skill approval gate requires confirmation before code
  changes begin.
  Date/Author: 2026-02-19 / Codex

- Decision: retain compatibility wrappers in `lib/command-registry.ts` while
  introducing CRUD and validation APIs.
  Rationale: preserves current plugin/runtime integration paths while enabling
  new registry surfaces for follow-on dispatcher milestones.
  Date/Author: 2026-02-19 / Codex

## Outcomes & retrospective

Implementation is complete. Outcomes:

- shared command definition and registry contracts are available from `shared/`,
- deterministic registry CRUD APIs are covered by unit tests,
- invalid command args produce structured validation errors including machine-
  readable issue details,
- compatibility command entry points remain stable for existing renderer/plugin
  flows,
- `docs/developers-guide.md` documents command-registry practice and full
  release gate sequencing,
- `docs/roadmap.md` item `1.2.1` and its success-criteria subitems are marked
  complete.

Retrospective:

- Shared contracts prevented drift between registry runtime types and design
  expectations, but this milestone still leaves backend command-registry wiring
  for follow-on roadmap items.
- Generated JS/definition artefacts can appear during local build/install
  workflows; keep the tree clean before format gates to avoid false failures.

## Context and orientation

Current state before implementation:

- `app/commands.ts` defines main-process command handlers as
  `Record<string, (focusedWindow?) => void>` and exposes `execCommand`.
- `lib/command-registry.ts` defines renderer handler registration and keymap
  flattening, but no command metadata, schema, or deterministic enumeration
  contract.
- `lib/containers/hyper.tsx` binds shortcuts from
  `getRegisteredKeys()` and dispatches command IDs through
  `uiActions.execCommand`.
- `lib/components/terms.tsx` exposes plugin command registration through
  `registerCommandHandlers`.
- `docs/velocetty-design.md` defines the target model:
  `CommandMetadata`, `CommandDefinition`, optional `argsSchema/resultSchema`,
  and frontend/backend registries with a dispatcher path.
- `docs/velocetty-product-requirements-document.md` requires stable command IDs,
  metadata, optional argument schemas, and command-registry-first architecture.

Key files likely touched during implementation:

- `shared/src/types/commands.ts` (new)
- `shared/src/index.ts`
- `lib/command-registry.ts` (or replacement module plus shim)
- `app/commands.ts` (adoption of shared command definitions)
- `test/unit/command-registry.test.ts` (expanded)
- `docs/developers-guide.md`
- `docs/roadmap.md`

## Plan of work

Stage A: shared contract scaffolding and test-first validation shape.

Define shared command primitives so both renderer and backend code can consume
one source of truth. Add `CommandId`, `CommandMetadata`, `CommandDefinition`,
registry error/validation types, and a structured invalid-args error shape under
`shared/src/types/commands.ts`. Export these through `shared/src/index.ts`.

At this stage, add focused unit tests that define expected validation error
payload structure before integrating with existing registries.

Go/no-go for Stage A: tests compile against shared contracts, and no runtime
command behaviour changes yet.

Stage B: deterministic registry CRUD implementation.

Implement registry APIs that support create/register, update/replace, delete,
get-by-ID, existence checks, and deterministic enumeration.

The deterministic ordering contract must be explicit and tested (for example,
stable ordering by command ID, or stable registration-order with defined
reordering semantics for update/delete). Include tests that execute registry
operations in varied sequences and assert the same enumeration output for the
same final state.

Integrate optional argument schema validation using existing `ajv`, returning a
structured error object when input is invalid.

Go/no-go for Stage B: registry CRUD and deterministic enumeration tests pass,
and invalid args tests return structured errors.

Stage C: compatibility integration with existing command paths.

Adapt `lib/command-registry.ts` and command call sites to read from the new
registry surface while preserving current behaviour for shortcuts,
menu fallback, and plugin registration hooks.

If required, keep thin compatibility wrappers that map legacy helper calls to
new registry APIs so plugin-facing behaviour remains stable within this
milestone.

Go/no-go for Stage C: existing command execution tests continue to pass and new
registry coverage remains green.

Stage D: documentation, gates, and roadmap closure.

Update `docs/developers-guide.md` with new command development practice,
including where command definitions live, how metadata/schemas are authored,
how deterministic ordering is guaranteed, and how structured validation errors
should be handled in tests.

Run required validation commands with log capture, then mark roadmap item
`1.2.1` complete in `docs/roadmap.md`.

Go/no-go for Stage D: all required gates pass and documentation reflects the
implemented workflow.

## Concrete steps

Run all commands from repository root: `/data/leynos/Projects/velocetty`.
Use log files so truncated terminal output can still be reviewed.

Set reusable log variables:

    PROJECT="$(get-project 2>/dev/null || basename "$PWD")"
    BRANCH_SAFE="$(git branch --show | tr '/' '-')"

Implementation sequence:

1. Baseline install/build prerequisites.

       bun install 2>&1 | tee "/tmp/bun-install-${PROJECT}-${BRANCH_SAFE}.out"

   Expected signal: install completes successfully, including postinstall steps
   (`v8-snapshot`, app deps, schema sync).

2. Implement Stage A and Stage B changes with focused unit tests.

       bun run test:unit:run test/unit/command-registry.test.ts 2>&1 | tee \
         "/tmp/test-unit-command-registry-${PROJECT}-${BRANCH_SAFE}.out"

   Expected signal: new tests for deterministic ordering and structured schema
   validation errors pass.

3. Implement Stage C compatibility wiring and rerun unit tests.

       make test 2>&1 | tee "/tmp/test-${PROJECT}-${BRANCH_SAFE}.out"

   Expected signal: existing command-path tests and new registry tests pass.

4. Run required final gates in required order.

       make build 2>&1 | tee "/tmp/build-${PROJECT}-${BRANCH_SAFE}.out"
       make check-fmt 2>&1 | tee "/tmp/check-fmt-${PROJECT}-${BRANCH_SAFE}.out"
       make lint 2>&1 | tee "/tmp/lint-${PROJECT}-${BRANCH_SAFE}.out"
       make test 2>&1 | tee "/tmp/test-${PROJECT}-${BRANCH_SAFE}.out"

   Expected signal: each command exits zero; logs contain no fatal errors.

5. Final documentation and roadmap updates.

       bunx markdownlint-cli2 "docs/**/*.md" 2>&1 | tee \
         "/tmp/markdownlint-${PROJECT}-${BRANCH_SAFE}.out"
       nixie --no-sandbox 2>&1 | tee "/tmp/nixie-${PROJECT}-${BRANCH_SAFE}.out"

   Expected signal: docs validation passes after developer-guide and roadmap
   edits.

## Validation and acceptance

Acceptance behaviours for roadmap `1.2.1`:

- Registry enumeration is deterministic for equivalent final registry state.
- Registry CRUD supports create/update/delete/get/list semantics.
- Command definitions include metadata and optional arg/result schemas.
- Invalid args fail validation with structured error payloads
  (code/message/details or equivalent documented shape).
- Existing command execution pathways remain functional.

Quality criteria:

- Tests: `make test` passes with new registry coverage.
- Build: `make build` passes.
- Formatting: `make check-fmt` passes.
- Lint: `make lint` passes.
- Dependency baseline: `bun install` passes.
- Documentation: `docs/developers-guide.md` updated and docs linters clean.

Quality method:

- Capture logs from each gate under `/tmp/*-${PROJECT}-${BRANCH_SAFE}.out`.
- Inspect logs for success markers before marking roadmap item done.
- Only then mark `docs/roadmap.md` checkbox `1.2.1` complete.

## Idempotence and recovery

- Registry tests and validation gates are idempotent; rerunning commands should
  not mutate repository state except generated build artefacts.
- If a gate fails, fix the smallest scoped issue and rerun only the failed gate
  first, then rerun the full required gate set.
- If deterministic ordering behaviour is unclear, pause implementation and
  record alternatives in `Decision log` before proceeding.
- If unexpected unrelated working-tree changes appear, stop and ask for
  direction before continuing.

## Artifacts and notes

Expected artifacts after implementation:

- New shared command type definitions in `shared/src/types/commands.ts`.
- Updated registry implementation and tests proving deterministic ordering and
  structured validation errors.
- Gate logs under `/tmp/` for `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.
- Documentation updates in `docs/developers-guide.md` and roadmap status update
  in `docs/roadmap.md`.

## Interfaces and dependencies

Planned shared interfaces (final names may differ only if needed for repository
conventions):

    export type CommandId = string;

    export interface CommandMetadata {
      title: string;
      category?: string;
      description?: string;
      keywords?: string[];
      icon?: string;
    }

    export interface CommandDefinition<TArgs = unknown, TResult = unknown> {
      id: CommandId;
      metadata: CommandMetadata;
      kind: 'frontend' | 'backend';
      defaultWhen?: string;
      argsSchema?: object;
      resultSchema?: object;
    }

    export interface CommandValidationError {
      code: 'INVALID_COMMAND_ARGS';
      message: string;
      details: unknown;
    }

    export interface CommandRegistry {
      register(definition: CommandDefinition): void;
      update(definition: CommandDefinition): void;
      remove(commandId: CommandId): boolean;
      get(commandId: CommandId): CommandDefinition | undefined;
      list(): CommandDefinition[];
      has(commandId: CommandId): boolean;
      validateArgs(commandId: CommandId, args: unknown):
        | {ok: true}
        | {ok: false; error: CommandValidationError};
    }

Dependencies and rationale:

- `shared/` contracts: single source of truth for frontend/backend command
  primitives.
- Existing `ajv`: schema validation engine already present in repository.
- Existing command modules (`lib/command-registry.ts`, `app/commands.ts`):
  integration points that must consume the new registry APIs.

## Revision note

Initial draft created on 2026-02-19.
This revision marks the plan `COMPLETE`, records Stage D evidence, and captures
final outcomes after all required gates passed.
