<!--
@file docs/execplans/remove-yarn-dependencies.md
Purpose: Track the execution plan for replacing Yarn with Bun across scripts,
continuous integration (CI), and runtime integration.
Invariants: Keep constraints, tolerances, risks, progress, surprises &
discoveries, decision log, and outcomes updated as work proceeds.
Cross-links: docs/documentation-style-guide.md, README.md, PLUGINS.md
-->

# Replace Yarn Usage With Bun

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists in the repository at the time of writing.

## Purpose / Big Picture

Eliminate Yarn from scripts, continuous integration (CI), and runtime
integration so the repository and application rely on Bun instead. Success is
observable when CI workflows use Bun only, developer documentation references
Bun, `bin/yarn-standalone.js` is removed, and runtime code that previously
invoked Yarn now uses Bun.

## Constraints

- Remove `bin/yarn-standalone.js` and replace all runtime calls that used it
  with Bun-based equivalents.
- Replace `app/config/paths.ts` dependencies on Yarn with Bun equivalents and
  update all call sites that used the Yarn path.
- Keep CI Node version unchanged (`env.NODE_VERSION` in the workflow).
- Use the `oven-sh/setup-bun@v2` action in CI to install Bun.
- Do not introduce new external dependencies.
- Preserve existing behaviour of scripts (same script names, same command
  order).
- Do not change user-facing command-line interface (CLI) command names unless
  explicitly requested.

## Tolerances (Exception Triggers)

- Scope: if more than 20 files or more than 130k net lines must change, stop
  and escalate. (Removing `bin/yarn-standalone.js` is expected to dominate the
  line count.)
- Interface: if any public CLI or script name must change, stop and escalate.
- Dependencies: if a new dependency or GitHub Action is required beyond
  `oven-sh/setup-bun@v2`, stop and escalate.
- Iterations: if lint or tests fail after two remediation attempts, stop and
  escalate.
- Ambiguity: if Bun must be bundled for packaged app runtime and the required
  approach is unclear, stop and ask for guidance before proceeding.

## Risks

    - Risk: Runtime plugin installation currently assumes a bundled Yarn. Moving
      to Bun may require bundling a Bun binary or requiring a system install.
      Severity: high
      Likelihood: medium
      Mitigation: trace all call sites that use `paths.yarn` to understand how
      it is invoked; if packaging expectations are unclear, pause and ask.

    - Risk: `bun test` vs `bun run test` behavioural differences could change
      CI expectations.
      Severity: medium
      Likelihood: medium
      Mitigation: prefer `bun run <script>` in CI to execute the same package
      scripts as developers, and verify local runs for `test` and `test:e2e`.

    - Risk: Removing Yarn cache steps could slow CI or cause cache misses.
      Severity: low
      Likelihood: medium
      Mitigation: replace the Yarn cache step with a Bun cache path when the
      correct cache location is verified; otherwise document the removal.

    - Risk: Documentation contains extensive Yarn references beyond README and
      PLUGINS.
      Severity: medium
      Likelihood: high
      Mitigation: update developer-facing docs tied to running scripts, and
      log any larger documentation updates that exceed tolerances before doing
      them.

## Progress

    - [x] (2026-01-30 18:10Z) Inventory Yarn references in scripts, CI, and
      runtime code paths.
    - [x] (2026-01-30 18:22Z) Remove `bin/yarn-standalone.js` and update
      references.
    - [x] (2026-01-30 18:24Z) Replace runtime Yarn path usage in
      `app/config/paths.ts` and its call sites with Bun.
    - [x] (2026-01-30 18:32Z) Update CI workflow to remove Yarn and use Bun
      commands only.
    - [x] (2026-01-30 18:36Z) Update local developer documentation to use Bun.
    - [x] (2026-01-30 19:18Z) Run required validation commands and capture logs.
    - [x] (2026-01-30 20:05Z) Stage Bun binary for packaged builds and update
      runtime paths.

## Surprises & Discoveries

    - Observation: `bun check:types` is not defined in package scripts.
      Evidence: `bun check:types` failed with "Script not found".
      Impact: Ran `bunx tsc --noEmit --project tsconfig.typecheck.json` instead.

## Decision Log

    - Decision: Expand scope to remove runtime Yarn integration and replace it
      with Bun, per user request.
      Rationale: Explicit requirement to remove `bin/yarn-standalone.js` and
      replace `app/config/paths.ts` Yarn usage.
      Date/Author: 2026-01-30 (Codex)
    - Decision: Use `bun install --no-save --production --cache-dir` for
      plugin installation to mirror Yarn's production install and avoid
      lockfile writes.
      Rationale: Maintains production-only dependency install behaviour while
      avoiding plugin metadata mutations.
      Date/Author: 2026-01-30 (Codex)
    - Decision: Remove `app/yarn.lock` and stop bundling it in the build.
      Rationale: Yarn is no longer used for runtime installs, so the lockfile
      is obsolete.
      Date/Author: 2026-01-30 (Codex)
    - Decision: Use `bunx tsc --noEmit --project tsconfig.typecheck.json` for
      type checking in lieu of a missing `check:types` script.
      Rationale: Maintains type safety validation without changing existing
      scripts.
      Date/Author: 2026-01-30 (Codex)
    - Decision: Bundle the Bun binary via `build/${os}/` so packaging picks up
      a per-OS Bun runtime.
      Rationale: Ensures plugin installation works in packaged builds without
      a system Bun dependency.
      Date/Author: 2026-01-30 (Codex)

## Outcomes & Retrospective

Yarn has been removed from runtime, CI, and documentation references, and
plugin installs now use Bun with production-safe flags. The build no longer
ships the Yarn standalone binary or lockfile, and CI runs Bun-only workflows.
Packaged builds now bundle the Bun binary under `resources/bin/` for runtime
plugin installation with a fallback to system Bun in dev. Type checking uses
the new `check:types` script for `tsgo`.

## Context and Orientation

Key locations affected by the Yarn removal:

- `.github/workflows/nodejs.yml` now runs Bun-only commands for the `build` and
  `build-linux-arm` jobs.
- `README.md` and `PLUGINS.md` now document Bun-based developer workflows.
- `app/config/paths.ts` now points at the bundled Bun binary under
  `resources/bin/` with a fallback to system Bun when running from source.
- `bin/yarn-standalone.js` has been removed and is no longer bundled by
  `electron-builder.json` or excluded in `biome.json`.
- `webpack.config.ts` no longer copies `app/yarn.lock`, and the file has been
  removed.

## Plan of Work

Stage A: confirm scope and inventory.
Run `rg -n "yarn"` across scripts, CI, and runtime code. Use Leta to trace
where `paths.yarn` is referenced so all call sites can be updated. If runtime
usage depends on a bundled package manager, decide whether to bundle Bun or
require a system install; if this is unclear, escalate.

Stage B: remove Yarn runtime assets.
Delete `bin/yarn-standalone.js` and remove references in configs such as
`electron-builder.json` and `biome.json`. Update any build steps that copy
`app/yarn.lock` to either use `bun.lock` or remove the copy entirely if no
longer required.

Stage C: replace runtime Yarn usage with Bun.
Update `app/config/paths.ts` to expose a Bun path and update all usages that
previously consumed `paths.yarn` to call Bun with equivalent arguments. Ensure
command arguments are preserved (e.g. install flags, cwd, timeout handling).

Stage D: update CI and local docs.
Remove Yarn Corepack steps and Yarn cache logic in CI, replacing `yarn run ...`
with `bun run ...` while keeping Bun setup via `oven-sh/setup-bun@v2`. Update
`README.md` and `PLUGINS.md` to use Bun commands.

Stage E: validation and cleanup.
Run formatting, linting, type checks, and tests using the project’s standard
Bun commands. Ensure documentation linting passes if Markdown files change.

## Concrete Steps

All commands run from the repository root.

1. Inventory Yarn references across scripts, CI, and runtime code:

    rg -n "yarn" .github README.md PLUGINS.md app bin scripts build

2. Trace runtime Yarn usage:

    - Use Leta to locate the `yarn` export in `app/config/paths.ts`.
    - Use Leta to find all references to the exported Yarn path and note which
      modules execute it (likely CLI or plugin install flows).

3. Remove Yarn runtime assets:

    - Delete `bin/yarn-standalone.js`.
    - Remove references to it in `electron-builder.json` and `biome.json`.
    - Review `webpack.config.ts` for `yarn.lock` copying and decide whether to
      replace with `bun.lock` or remove the step.

4. Replace runtime Yarn usage with Bun:

    - Update `app/config/paths.ts` to include `bun` instead of `yarn`.
    - Update call sites to invoke Bun with equivalent arguments.

5. Update `.github/workflows/nodejs.yml`:

    - Remove the "Enable Yarn (Corepack)" step.
    - Remove the "Determine Yarn cache directory" and related cache restore/save
      steps.
    - Replace `yarn run test`, `yarn run dist`, `yarn run test:e2e`,
      `yarn run build`, and `yarn run v8-snapshot:arch` with `bun run` variants.

6. Update local documentation:

    - `README.md`: replace setup/build/run commands that mention Yarn with Bun.
    - `PLUGINS.md`: replace `yarn run app` guidance with `bun run app`.

7. Validate changes (use `tee` per repo guidance):

    bun fmt | tee /tmp/fmt-velocetty-$(git branch --show).out
    bun lint | tee /tmp/lint-velocetty-$(git branch --show).out
    bun check:types | tee /tmp/check-types-velocetty-$(git branch --show).out
    bun test | tee /tmp/test-velocetty-$(git branch --show).out

   If Markdown changed:

    bunx markdownlint-cli2 "docs/**/*.md" \
      | tee /tmp/markdownlint-velocetty-$(git branch --show).out
    nixie --no-sandbox

## Validation and Acceptance

Acceptance is met when:

- `bin/yarn-standalone.js` is removed and no longer referenced.
- `app/config/paths.ts` and its call sites invoke Bun instead of Yarn.
- `.github/workflows/nodejs.yml` has no Yarn commands or cache steps and uses
  Bun for all script execution.
- `README.md` and `PLUGINS.md` instructions show Bun commands only.
- `rg -n "yarn" .github README.md PLUGINS.md app bin scripts build` returns no
  Yarn references.
- `bun fmt`, `bun lint`, `bun check:types`, and `bun test` succeed.

## Idempotence and Recovery

The edits are safe to reapply. If a step fails, re-run the command after
correcting the file. If CI or runtime behaviour regresses, revert the specific
workflow or runtime edits and reassess the Bun invocation strategy.

## Artifacts and Notes

Capture the `rg` output and test logs under `/tmp/*-velocetty-<branch>.out` for
review and future debugging.

## Interfaces and Dependencies

- CI uses `oven-sh/setup-bun@v2` for Bun installation.
- Runtime package management flows use Bun instead of Yarn.
- No new dependencies or script names are introduced.

## Revision note (required when editing an ExecPlan)

2026-01-30: Expanded scope to remove runtime Yarn integration, delete
`bin/yarn-standalone.js`, and replace `app/config/paths.ts` usage with Bun.
2026-01-30: Updated status/progress, refreshed context to match completed
removals, and recorded Bun install decisions; remaining work is validation.
2026-01-30: Logged validation results and the typecheck fallback used when the
`check:types` script was missing.
2026-01-30: Marked plan complete and summarized outcomes after validation.
2026-01-30: Added Bun binary bundling and updated runtime paths and outcomes.
