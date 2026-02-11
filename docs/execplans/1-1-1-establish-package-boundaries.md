# Establish frontend/backend/shared package boundaries (roadmap 1.1.1)

## Module header

- Purpose: define and execute a safe migration from the current `app/`, `lib/`,
  and `typings/` layout to explicit `frontend/`, `backend/`, and `shared/`
  package boundaries.
- Invariants: preserve current runtime behaviour and keep the build, lint, and
  test gates green while introducing boundary enforcement.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`, and
  `docs/developers-guide.md`.

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: IN PROGRESS

No `PLANS.md` exists at repository root as of 2026-02-11, so this document is
self-contained.

Implementation approval received on 2026-02-11 and execution is underway.

## Purpose / Big picture

Roadmap item `1.1.1` requires explicit package boundaries and one-way
cross-package imports. The design and PRD both define the target split:
`frontend/` for UI code, `backend/` for privileged code, and `shared/` for
contracts reused by both sides.

Success is observable when:

- each package has its own TypeScript project configuration and build output,
- shared types/schemas/constants live under `shared/`,
- dependency direction is enforced (`frontend -> shared`, `backend -> shared`),
- developer workflow documentation covers the new practices, and
- the required gates pass: `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.

After all acceptance checks pass, roadmap entry `1.1.1` is marked done in
`docs/roadmap.md`.

## Constraints

- Keep runtime behaviour equivalent for current Electron main/renderer
  execution. This change establishes boundaries first; it must not redesign app
  features.
- Preserve existing build artefact expectations for packaging (`target/` and
  existing esbuild outputs) while adding package-specific build outputs.
- Define explicit path aliases for `frontend`, `backend`, and `shared` and
  migrate imports away from implicit deep relative paths where touched.
- Move shared contracts into `shared/` and keep compatibility shims only as
  short-lived migration aids.
- Enforce one-way imports so `frontend` and `backend` do not import each other
  directly.
- Update `docs/developers-guide.md` with new repository practices introduced by
  this split.
- Mark roadmap item `1.1.1` done only after all required gates pass.
- Use Makefile targets for validation and capture long outputs with `tee`.

## Tolerances (exception triggers)

- Scope tolerance: if boundary migration needs more than 35 files or more than
  1,200 net lines in a single commit, split into additional atomic commits.
- Packaging tolerance: if existing packaging requires incompatible output path
  changes (for example, breaking `target/` assumptions) that cannot be shimmed,
  stop and escalate with options.
- Contract tolerance: if converting current `typings/*.d.ts` constants to shared
  modules breaks runtime import semantics and no low-risk shim is available,
  stop and escalate.
- Tooling tolerance: if isolated package builds cannot be represented with
  `tsgo` and current build scripts without adding new build tools, stop and
  escalate.
- Validation tolerance: if any of the five required gates fails twice after
  focused remediation, stop and escalate with findings.

## Risks

- Risk: current `typings/constants/*.d.ts` files are used as runtime modules in
  parts of the renderer. Moving them blindly may break bundling.
  Severity: high
  Likelihood: medium
  Mitigation: convert shared constants to `.ts` modules in `shared/` and keep
  temporary compatibility re-exports while imports are migrated.

- Risk: existing build and packaging pipeline assumes current entrypoint paths.
  Severity: high
  Likelihood: medium
  Mitigation: keep existing runtime outputs stable and introduce package build
  outputs as additive validation artefacts during this roadmap item.

- Risk: hidden cross-boundary imports remain after migration.
  Severity: medium
  Likelihood: high
  Mitigation: add an automated boundary check (script or lint rule) and run it
  in `make lint` or `make test`.

- Risk: developers continue using legacy import paths after migration.
  Severity: medium
  Likelihood: medium
  Mitigation: document import conventions and boundary rules in
  `docs/developers-guide.md` and include examples.

## Progress

- [x] (2026-02-11 00:00Z) Draft ExecPlan created and aligned with roadmap item
  `1.1.1`.
- [x] (2026-02-11 00:00Z) Source constraints collected from roadmap, design,
  PRD, and developers guide.
- [x] (2026-02-11 00:20Z) Plan approved for implementation.
- [x] (2026-02-11 00:25Z) Stage A complete: baseline inventory and migration
  map.
- [x] (2026-02-11 00:40Z) Stage B complete: package scaffolding, TypeScript
  aliases, and package build outputs.
- [x] (2026-02-11 00:45Z) Stage C complete: shared contracts moved into
  `shared/` with compatibility re-exports in `typings/`.
- [x] (2026-02-11 00:55Z) Stage D complete: imports migrated and one-way
  boundary checks enforced.
- [x] (2026-02-11 01:10Z) Stage E complete: developer guide and roadmap
  updated.
- [x] (2026-02-11 01:15Z) Stage F complete: required validation gates pass.

## Surprises & Discoveries

- Observation: the repository currently runs on `main` and has no
  `frontend/`, `backend/`, or `shared/` directories yet.
  Evidence: `git branch --show` and repository root listing on 2026-02-11.
  Impact: migration starts from a legacy layout (`app/`, `lib/`, `typings/`)
  and must be incremental.

- Observation: many renderer and main-process files import from `typings/`, and
  at least one CLI file imports `app/package.json` directly.
  Evidence: import scans over `app/`, `lib/`, and `cli/`.
  Impact: shared contract migration requires both path aliasing and import
  cleanup to enforce one-way boundaries.

- Observation: `leta files | head` can terminate with a broken pipe panic when
  piping output.
  Evidence: `leta files` aborted with `failed printing to stdout: Broken pipe`.
  Impact: use direct file reads and `grepai`/`rg` scans for long listings
  instead of piping `leta files`.

- Observation: frontend code still had a direct dependency on backend code via
  `lib/utils/remote-plugins.ts -> ../../app/plugins`.
  Evidence: boundary check failure output from
  `scripts/check-package-boundaries.mjs`.
  Impact: replaced backend module type import with a shared interface contract
  to preserve runtime behaviour without cross-layer imports.

- Observation: `tsgo` 7 rejects `baseUrl` in this repository configuration and
  requires explicit relative path entries for `paths`.
  Evidence: `TS5102` and `TS5090` failures during the first `make build` run.
  Impact: switched to `paths` with `./`-prefixed entries and removed
  `baseUrl` from `tsconfig.base.json`.

- Observation: electron-builder `afterPack` hook context can expose `arch` as a
  string rather than a numeric enum key.
  Evidence: `Arch[context.arch]` failure in `bin/cp-snapshot.js` during
  `make build`.
  Impact: hardened architecture resolution in `bin/cp-snapshot.js` to accept
  both forms.

## Decision Log

- Decision: treat this roadmap item as a boundary-establishment migration, not
  a full feature re-architecture.
  Rationale: roadmap `1.1.1` is specifically about package boundaries and
  shared contracts, while later roadmap items handle transport and command
  architecture evolution.
  Date/Author: 2026-02-11 / Codex

- Decision: keep runtime packaging outputs stable while introducing package
  build outputs for isolated verification.
  Rationale: this minimises blast radius and keeps compatibility with current
  `make build` pipeline.
  Date/Author: 2026-02-11 / Codex

- Decision: keep `app/config/schema.json` as a synced compatibility copy and
  treat `shared/schemas/schema.json` as the generated source of truth.
  Rationale: runtime migration code and packaging currently expect a schema file
  in `app/config/`, so a sync step avoids behavioural regressions while moving
  shared schema ownership into `shared/`.
  Date/Author: 2026-02-11 / Codex

- Decision: enforce boundary checks over both new package roots and legacy
  source roots (`lib` and `app`) during migration.
  Rationale: runtime code is still housed in legacy directories, so checking
  only `frontend/src` and `backend/src` would not enforce the architectural
  constraint in practice.
  Date/Author: 2026-02-11 / Codex

- Decision: keep package-isolation checks as package-local `tsgo --project`
  runs with `noEmit`, while the production build keeps app compilation focused
  on `app/tsconfig.json`.
  Rationale: this proves isolation without destabilising the existing
  application build pipeline.
  Date/Author: 2026-02-11 / Codex

## Outcomes & Retrospective

Implemented package-boundary scaffolding for `frontend/`, `backend/`, and
`shared/`, migrated shared constants/types/schema ownership into `shared/`,
repointed application imports to `@shared/*`, and added automated
cross-layer boundary validation. The required gates (`bun install`,
`make build`, `make check-fmt`, `make lint`, and `make test`) all pass, and
roadmap item `1.1.1` is now marked done.

## Context and orientation

Current architecture is split across:

- `app/` (privileged Electron main process and config/plugin services),
- `lib/` (renderer UI, Redux, and renderer-side utilities), and
- `typings/` (cross-cutting type and constant declarations currently imported
  by both sides).

The design document section "Repository layout and module boundaries" sets a
forward layout of `frontend/`, `backend/`, and `shared/`. The PRD foundation
workstream requires the same split and treats `shared/` as the contract source
for types, protocol, and schemas.

Current build behaviour uses esbuild plus `tsgo` and produces outputs such as
`target/renderer/bundle.js`, `target/` copied app artefacts, and TypeScript
outputs under existing temporary directories. This plan introduces package-level
TypeScript outputs without breaking existing packaging assumptions.

## Plan of work

Stage A: Baseline inventory and migration map.

Map current modules into target packages and identify cross-boundary imports.
Produce a concrete mapping list (`app/* -> backend/*`, `lib/* -> frontend/*`,
`typings/* + shared schemas/constants -> shared/*`) and identify exceptions
that need shims.

Stage B: Package scaffolding, path aliases, and isolated build outputs.

Create `frontend/`, `backend/`, and `shared/` package roots with package-level
`tsconfig.json` files and clear `outDir` values. Add root TypeScript path
aliases so imports resolve through package namespaces instead of deep relative
paths. Ensure each package can be built in isolation through explicit scripts
or project references.

Stage C: Move shared contracts into `shared/`.

Relocate shared types, schemas, and constants into `shared/` with stable export
entrypoints. Add temporary compatibility modules where necessary so migration
can proceed incrementally without breaking runtime.

Stage D: Import migration and boundary enforcement.

Update frontend and backend imports to consume shared contracts via aliases.
Remove direct frontend/backend cross-imports. Add an automated boundary check so
future imports violating directionality fail CI/local gates.

Stage E: Documentation and roadmap updates.

Update `docs/developers-guide.md` with new development practices:

- package ownership and allowed dependency directions,
- path alias usage,
- package-local build/typecheck commands,
- boundary-check expectations.

After successful validation, mark roadmap item `1.1.1` as done in
`docs/roadmap.md`.

Stage F: Validation and release readiness checks.

Run required installation/build/format/lint/test commands, capture logs with
`tee`, and verify each exits successfully before final commit.

## Concrete steps

1. Inventory current imports and classify modules by target package.

   - Build a migration list of files that belong in `frontend/`, `backend/`,
     and `shared/`.
   - Identify all imports that currently cross prospective boundaries.

2. Scaffold package roots and package TypeScript configs.

   - Create `frontend/`, `backend/`, and `shared/` with explicit source
     directories and package-local `tsconfig.json` files.
   - Define isolated `outDir` values, for example:
     - `frontend`: `dist/tmp/frontend/`
     - `backend`: `dist/tmp/backend/`
     - `shared`: `dist/tmp/shared/`

3. Define root-level path aliases and references.

   - Update base/root TypeScript config to expose aliases such as:
     - `@frontend/*`
     - `@backend/*`
     - `@shared/*`
   - Wire project references so each package can be type-checked and built in
     isolation.

4. Move shared contracts into `shared/`.

   - Move shared type contracts from `typings/` into `shared/` modules.
   - Move shared schemas and constants into `shared/`.
   - Provide temporary compatibility re-exports in legacy paths during
     transition, then remove them before completion if feasible.

5. Migrate imports and enforce boundary direction.

   - Replace legacy relative imports with package alias imports.
   - Ensure no `frontend` imports from `backend` and no `backend` imports from
     `frontend`.
   - Add an automated check (lint rule or script) to guard this invariant.

6. Update developer documentation.

   - Update `docs/developers-guide.md` with the new package layout,
     alias/import conventions, and boundary validation workflow.

7. Mark roadmap entry done after validation.

   - Change roadmap item `1.1.1` checklist to done only after all required
     commands succeed.

8. Run required validation gates and capture output logs.

   If `get-project` is unavailable, replace `$(get-project)` with `velocetty`.

    bun install 2>&1 | tee /tmp/install-$(get-project)-$(git branch --show).out
    make build 2>&1 | tee /tmp/build-$(get-project)-$(git branch --show).out
    make check-fmt 2>&1 | tee /tmp/check-fmt-$(get-project)-$(git branch --show).out
    make lint 2>&1 | tee /tmp/lint-$(get-project)-$(git branch --show).out
    make test 2>&1 | tee /tmp/test-$(get-project)-$(git branch --show).out

   Because this work updates docs, also run:

    bunx markdownlint-cli2 "docs/**/*.md" \
      2>&1 | tee /tmp/markdownlint-$(get-project)-$(git branch --show).out
    nixie --no-sandbox 2>&1 | tee /tmp/nixie-$(get-project)-$(git branch --show).out

9. Commit strategy.

   - Commit 1: package scaffolding and TypeScript alias/build wiring.
   - Commit 2: shared contract migration and import updates.
   - Commit 3: boundary enforcement tooling and documentation updates
     (including roadmap check-off).

## Validation and acceptance

Acceptance criteria for roadmap `1.1.1`:

- `frontend/`, `backend/`, and `shared/` directories exist with package-local
  TypeScript configuration.
- TypeScript path aliases are defined and used for cross-package imports.
- Shared types, schemas, and constants are sourced from `shared/`.
- Import direction is enforced such that only `frontend -> shared` and
  `backend -> shared` are allowed.
- `docs/developers-guide.md` documents the new development practice.
- `docs/roadmap.md` marks item `1.1.1` as done.
- Required commands succeed:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`

## Idempotence and recovery

All scaffold and validation steps are safe to re-run. If a validation gate
fails:

- inspect the corresponding log in `/tmp/`,
- apply the smallest focused fix,
- re-run only the failed command,
- re-run the full required gate set before marking roadmap completion.

If packaging paths are disrupted, restore previous output wiring first, then
continue migration with additive compatibility shims.

## Artifacts and notes

- Primary output: this plan file.
- Implementation is expected to touch project configuration, source imports,
  and docs.
- Keep this plan updated as a living document during execution, especially
  `Progress`, `Surprises & Discoveries`, and `Decision Log`.
