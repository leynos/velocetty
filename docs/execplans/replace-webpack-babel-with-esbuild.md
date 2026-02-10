# Replace Webpack and Babel with esbuild

## Module header

- Purpose: Define a test-first, low-risk migration plan from Webpack/Babel to
  esbuild as required by ADR 002.
- Invariants: Keep build outputs, packaging artefacts, and runtime behaviour
  equivalent while migration work is in flight.
- Cross-links: `docs/adr-002-replace-webpack-babel-with-esbuild.md`,
  `docs/developers-guide.md`, `docs/roadmap.md`,
  `docs/velocetty-design.md`, `docs/velocetty-hyper-codebase.md`, and
  `docs/velocetty-product-requirements-document.md`.

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: DRAFT

No `PLANS.md` exists at the repository root as of 2026-02-10. If one is added,
this plan must be updated to follow it.

## Purpose / Big Picture

Migrate the repository build pipeline from Webpack/Babel to esbuild without
breaking renderer behaviour, CLI behaviour, or packaging output. The migration
is complete when build commands use esbuild, Webpack/Babel dependencies are
removed, required build-contract and plugin-validation tests pass, and quality
gates succeed (`bun install`, `make build`, `make check-fmt`, `make lint`,
`make test`).

Success must be observable in three ways:

- translation outcomes are equivalent (TypeScript/JSX, `styled-jsx`,
  externals, source maps, minification);
- packaging outcomes are equivalent (copied artefacts and expected output
  structure);
- bespoke esbuild plugin logic is validated by deterministic tests.

## Constraints

- Follow ADR 002 direction: esbuild is the target bundler; do not introduce an
  alternate bundler.
- Keep existing command entry points stable until migration completion:
  `bun run dev`, `bun run build`, `bun run build:hyper-app`, and `bun run dist`.
- Implement required test coverage before switching default build scripts from
  Webpack/Babel to esbuild.
- Preserve production packaging artefacts currently produced under `target/`,
  `bin/`, and `dist/`.
- Keep Node/Electron runtime compatibility unchanged unless a separate ADR
  authorizes changes.
- Keep documentation and roadmap aligned with implemented behaviour.
- Keep markdown wrapped to 80 columns and code blocks wrapped to 120 columns.

## Tolerances (Exception Triggers)

- Scope: if migration requires more than 18 files or 900 net lines in a single
  milestone, stop and split the milestone.
- Interface: if a public script or Makefile target must be removed or renamed,
  stop and escalate.
- Dependencies: if migration requires adding more than two new build
  dependencies beyond `esbuild` and one Babel bridge dependency, stop and
  escalate.
- Behaviour: if any build-contract test category cannot be made green after
  three focused attempts, stop and escalate with evidence.
- Runtime: if packaged app startup or CLI execution regresses in smoke tests,
  stop and escalate before removing Webpack/Babel.
- Time: if a milestone exceeds one day without a passing validation subset,
  stop and re-plan.

## Risks

- Risk: `styled-jsx` requires Babel plugin semantics not natively provided by
  esbuild.
  Severity: high.
  Likelihood: high.
  Mitigation: isolate a Babel bridge plugin, cover scoped/global style output
  with integration tests, and keep rewrite work out of Phase 1.

- Risk: copy-only `hyper-app` behaviour is currently encoded via
  `copy-webpack-plugin` + `null-loader`.
  Severity: high.
  Likelihood: medium.
  Mitigation: replace with manifest-driven copy logic and add artefact contract
  tests against `target/`.

- Risk: renderer externals and ignore semantics rely on specific require-path
  shape.
  Severity: high.
  Likelihood: medium.
  Mitigation: add plugin-level tests plus bundle-inspection tests before
  enabling esbuild as default.

- Risk: `__non_webpack_require__` in `lib/v8-snapshot-util.ts` is Webpack
  specific.
  Severity: high.
  Likelihood: medium.
  Mitigation: rewrite to a bundler-agnostic loader path and verify with
  snapshot bootstrap integration tests.

- Risk: CLI shebang behaviour could break when removing `shebang-loader`.
  Severity: medium.
  Likelihood: medium.
  Mitigation: add shebang artefact checks and CLI smoke execution tests.

## Progress

- [x] 2026-02-10 13:23 UTC: Reviewed ADR 002 requirements and validation gaps.
- [x] 2026-02-10 13:23 UTC: Reviewed build/testing context in
  `package.json`, `webpack.config.ts`, and existing test suites.
- [x] 2026-02-10 13:23 UTC: Drafted this ExecPlan with mandatory pre-migration
  coverage milestones for translation, packaging, and bespoke plugins.
- [ ] Add pre-migration build-contract tests for translation outcomes while
  Webpack remains the active bundler.
- [ ] Add pre-migration packaging contract tests for copied artefacts and CLI
  output shape.
- [ ] Implement and validate bespoke esbuild plugins behind a non-default
  script path.
- [ ] Switch build scripts to esbuild and keep all migration contract tests
  green.
- [ ] Remove Webpack/Babel dependencies and update docs/CI references.
- [ ] Run final gates: `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.

## Surprises & Discoveries

- Existing `test/` coverage does not include build-pipeline contract tests for
  bundle equivalence or packaging artefact shape.
- Current `build` script still performs a post-bundle Babel minification pass,
  which must be replaced by esbuild minification behaviour and validated.

## Decision Log

- Decision: Treat pre-migration test coverage as a hard gate rather than a
  follow-up task.
  Rationale: ADR 002 states current tests are insufficient and explicitly
  requires build-equivalence and plugin-validation coverage before migration is
  complete.
  Date/Author: 2026-02-10 (assistant).

- Decision: Keep this migration as a phased cut-over with shadow build support
  first.
  Rationale: parallel build outputs allow faster parity checks and lower risk
  while plugin behaviour is still being validated.
  Date/Author: 2026-02-10 (assistant).

## Outcomes & Retrospective

To be completed after implementation. The final write-up must include:

- which risks materialized and how they were mitigated;
- test suites added (translation, packaging, plugin validation);
- dependency and script diffs;
- gate outcomes and any post-migration follow-up tasks.

## Context and Orientation

Current build entry points live in `package.json` scripts, with Webpack configs
in `webpack.config.ts` and Babel transforms in `babel.config.json`. The
renderer still depends on `styled-jsx`, and runtime snapshot logic currently
uses `__non_webpack_require__` in `lib/v8-snapshot-util.ts`.

The migration must preserve three output families:

- renderer bundle output under `target/renderer/`;
- app/static copy output under `target/`;
- CLI output under `bin/cli.js`.

`docs/velocetty-hyper-codebase.md` documents current architecture and tool
inventory; this plan supersedes that document only after migration completion.

## Plan of Work

Stage A: establish mandatory pre-migration coverage.

- Add translation contract tests that prove parity for:
  - `styled-jsx` scoped and global styles;
  - externals require-path mapping in renderer output;
  - ignored imports and source-map handling;
  - production minification and development source maps.
- Add packaging contract tests that prove:
  - required copied files exist in `target/` and `target/config`/`keymaps`;
  - `target/static` and optional `target/patches` behaviour match current
    expectations;
  - `bin/cli.js` shebang presence and placement remain valid.
- Add snapshot bootstrap regression coverage for replacing
  `__non_webpack_require__`.

Stage B: introduce esbuild build entry point in shadow mode.

- Add `build/esbuild.mjs` (or equivalent) as the plugin host and maintain
  current scripts unchanged.
- Add non-default scripts (`build:esbuild:*`) that write to isolated output
  directories for comparison.
- Keep Webpack as the default until Stage A tests are green and Stage B shadow
  builds pass.

Stage C: implement bespoke esbuild plugin paths with dedicated tests.

- Implement focused plugin modules for:
  - `styled-jsx` Babel bridge transform;
  - externals/ignore resolution mapping;
  - copy-manifest handling;
  - shebang guard/fallback logic;
  - snapshot shim compatibility hooks as needed.
- Add unit tests for each plugin module to validate:
  - hook registration (`onResolve`, `onLoad`, `onEnd`);
  - input-to-output mapping for representative fixtures;
  - failure paths and diagnostics for unsupported inputs.

Stage D: migrate each bundle target with parity checks.

- Migrate renderer target first and run translation contract tests.
- Migrate copy-only app target (`hyper-app`) and run packaging contract tests.
- Migrate CLI target and run shebang + runtime smoke tests.
- Keep shadow comparison during this stage to detect regressions quickly.

Stage E: switch defaults and remove legacy tooling.

- Update `dev` and `build` scripts to use esbuild flow.
- Remove Webpack/Babel dependencies and obsolete config files only after all
  migration suites are green.
- Update CI workflow references and developer documentation.

Stage F: finalize and verify.

- Re-run mandatory gates:
  `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
- Ensure migration-specific suites run in CI and are documented.
- Mark the roadmap migration implementation item complete when and only when
  legacy tooling has been removed.

## Concrete Steps

1. Baseline and fixtures.

   - Create deterministic fixtures for renderer, app copy manifests, and CLI
     outputs.
   - Add test helpers to execute build scripts in isolated temp directories.

2. Translation outcome tests (must land before cut-over).

   - Add renderer build contract tests under `test/unit/` to assert style
     scoping, source-map presence, externals shape, and minification semantics.
   - Add snapshot bootstrap integration coverage for `lib/v8-snapshot-util.ts`.

3. Packaging outcome tests (must land before cut-over).

   - Add tests that assert copied files and directory structure produced by
     build scripts.
   - Add CLI artefact tests that validate shebang and basic invocation.

4. Bespoke plugin validation tests.

   - Add unit tests for each bespoke esbuild plugin module using fixture-based
     assertions.
   - Ensure plugin diagnostics are asserted, not only happy paths.

5. Shadow esbuild implementation.

   - Add `build/esbuild.mjs` and plugin modules.
   - Add non-default scripts to generate side-by-side outputs.
   - Run new tests and compare outputs with existing contracts.

6. Final cut-over and cleanup.

   - Replace default bundler scripts with esbuild equivalents.
   - Remove Webpack/Babel dependencies and obsolete configuration.
   - Update docs and roadmap implementation item, then run mandatory gates.

## Validation and Acceptance

Migration implementation is accepted only when all conditions below are true:

- Translation outcome tests pass in development and production modes.
- Packaging outcome tests pass for copied assets and CLI artefacts.
- Bespoke esbuild plugin unit tests pass for hook logic and error handling.
- Snapshot bootstrap integration path passes without Webpack-specific globals.
- `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  all pass.
- `docs/developers-guide.md` and `docs/velocetty-hyper-codebase.md` are aligned
  with the active build pipeline.

## Idempotence and Recovery

All stages are designed to be rerunnable. If a stage fails:

- keep default scripts on Webpack until stage-specific tests pass;
- keep shadow esbuild scripts isolated from release outputs;
- document failure cause and next action in `Decision Log`;
- retry only the failed stage before advancing.

If parity cannot be reached for a required risk area within tolerance limits,
stop and escalate with logs and fixture evidence.

## Interfaces and Dependencies

- Build scripts: `package.json`.
- Legacy bundler config: `webpack.config.ts`, `babel.config.json`.
- Snapshot shim: `lib/v8-snapshot-util.ts`.
- Planned esbuild host: `build/esbuild.mjs` and plugin modules under
  `build/esbuild/`.
- Tests: `test/unit/`, `test/e2e/`, and any migration-specific fixture paths.
- Packaging config remains in `electron-builder.json`.

## Revision note

Initial draft created on 2026-02-10.
