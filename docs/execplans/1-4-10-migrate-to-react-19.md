# Migrate renderer stack to React 19

This execution plan (ExecPlan) is a living document. The sections
`Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: Complete

No `PLANS.md` exists in this repository, so this plan stands alone.

## Purpose / Big picture

Upgrade the renderer React stack from 18.3 to React 19 in line with
`docs/adr-003-update-react-19.md`. Success means the Electron renderer builds
and tests pass with React 19, React 19-compatible dependencies, and updated
project documentation. A developer should be able to run the standard gates
and see all required commands complete successfully.

## Constraints

- Keep the renderer architecture intact (React + Redux UI in `lib/` as described
  in `docs/velocetty-design.md`).
- Update React and React DOM in both `package.json` and `app/package.json` in
  the same change, keeping the `app/package.json` versions exact to avoid
  duplicate React instances in plugins.
- Preserve the new JSX transform required by React 19; do not regress
  `jsx: react-jsx` in `tsconfig.base.json` or the automatic runtime in
  `babel.config.json`.
- Maintain the plugin compatibility contract where possible, including the
  shared React/ReactDOM module patch in `lib/utils/plugins.ts` and its mirrored
  implementation in `app/plugins.js`.
- Documentation must stay wrapped to 80 columns with code blocks wrapped to
  120 columns.

## Tolerances (exception triggers)

- Scope: if upgrading React 19 requires modifying more than 30 files or more
  than 900 net lines, stop and escalate.
- Dependencies: if a new runtime dependency is required outside the React
  ecosystem, stop and escalate.
- Interfaces: if a public plugin hook or Redux contract must change, stop and
  escalate.
- Validation: if `make test` or `make build` still fails after two focused
  remediation passes, stop and escalate.
- Ambiguity: if multiple viable React 19-compatible dependency sets exist with
  different risks, stop and present options with trade-offs.

## Risks

- Risk: React 19 peer dependency mismatches for `react-redux`, `react-use`, or
  `styled-jsx`.
  Severity: medium
  Likelihood: medium
  Mitigation: verify peer dependency ranges before upgrading, and upgrade to
  the smallest compatible versions.
- Risk: latent string refs or legacy APIs remain in renderer components.
  Severity: medium
  Likelihood: low
  Mitigation: search for string ref patterns and replace with `useRef` or
  `createRef` where necessary.
- Risk: plugin runtime relies on React Universal Module Definition (UMD)
  globals or bundled copies.
  Severity: medium
  Likelihood: low
  Mitigation: verify no UMD imports or global React usage remain; keep the
  shared module patch aligned across renderer and main.
- Risk: documentation drift leaves React 18 references in
  `docs/velocetty-hyper-codebase.md`.
  Severity: low
  Likelihood: high
  Mitigation: update all React version references and rerun Markdown checks.

## Progress

- [x] (2026-02-05 00:00Z) Draft ExecPlan created.
- [x] (2026-02-05 14:10Z) ExecPlan approved to proceed with implementation.
- [x] (2026-02-05 14:22Z) Stage A complete: dependency baselines confirmed.
- [x] (2026-02-05 14:42Z) Stage B complete: React 19 dependencies updated.
- [x] (2026-02-05 15:12Z) Stage C complete: React 19 code remediation applied.
- [x] (2026-02-05 15:12Z) Stage D complete: documentation updated.
- [x] (2026-02-05 16:12Z) Stage E complete: validation commands pass.
- [x] (2026-02-05 18:25Z) Post-implementation fixes applied for Redux 5
  middleware typing, React Redux imports, and Bun version alignment.

## Surprises & discoveries

- Observation: `bun install` failed during V8 snapshot generation because
  `electron-link` could not parse the React Redux 9.2.0 production bundle.
  Evidence: `mk-snapshot` error referencing
  `react-redux.production.min.cjs` in the install log.
  Impact: Updated `bin/mk-snapshot.js` to exclude `react-redux` from snapshot
  linking so the install pipeline can complete.
- Observation: Redux 5 middleware typing switched to `unknown` actions, and
  React Redux 9 removed internal `es/components/connect` paths.
  Evidence: Continuous Integration (CI) type errors for middleware signatures
  and missing module `react-redux/es/components/connect`.
  Impact: Added middleware type guards, updated the React Redux type import,
  and extended the JSX typing augmentation to include `JSX.Element`.

## Decision log

- Decision: Draft the ExecPlan before implementation, per `execplans` rules.
  Rationale: The upgrade may require dependency alignment decisions and should
  not proceed without review.
  Date/Author: 2026-02-05 / Codex
- Decision: Proceed with implementation after approval.
  Rationale: User approved the ExecPlan; no blocking constraints identified.
  Date/Author: 2026-02-05 / Codex
- Decision: Exclude `react-redux` from V8 snapshot linking.
  Rationale: `electron-link` fails to parse the React Redux production bundle,
  blocking `bun install` and the build pipeline.
  Date/Author: 2026-02-05 / Codex
- Decision: Update Redux middleware typing and React Redux imports for Redux 5
  and React Redux 9 compatibility, and bump Bun to 1.3.8 in CI.
  Rationale: CI build failures surfaced type and tooling mismatches after the
  React 19 upgrade.
  Date/Author: 2026-02-05 / Codex.

## Outcomes & retrospective

React 19.2.4 and related dependencies are now aligned across the renderer and
app manifests, and Redux has been updated to 5.0.1 with compatible middleware.
The snapshot build pipeline now skips the React Redux production bundle to keep
`bun install` reliable. Documentation and the roadmap reflect the upgrade, and
all required validation commands pass.

## Context and orientation

The React renderer lives under `lib/` and is bootstrapped in `lib/index.tsx`
using `createRoot`. React and React DOM versions are defined in two places:
`package.json` for the repository and `app/package.json` for the packaged app
(manifest uses exact versions). The shared React/ReactDOM patch lives in
`lib/utils/plugins.ts` with a mirrored implementation in `app/plugins.js`.
React build settings live in `babel.config.json` and `tsconfig.base.json`, both
already configured for the new JSX transform. The product and architecture
context for this upgrade is documented in `docs/adr-003-update-react-19.md`,
`docs/velocetty-design.md`, and `docs/velocetty-hyper-codebase.md`.

## Plan of work

Stage A: Baseline and dependency assessment. Confirm current React versions,
scan for legacy React APIs (string refs, `ReactDOM.render`, UMD usage), and
check peer dependency ranges for React-adjacent packages. Do not change code in
this stage.

Stage B: Dependency and configuration updates. Update React, React DOM, and
`@types` packages in `package.json` and `app/package.json`. If React-adjacent
packages need upgrades for compatibility, update them in the same change. Keep
Babel and TypeScript JSX settings aligned with React 19.

Stage C: Code remediation. Replace any string refs or other removed APIs, and
ensure plugin shared module behaviour remains intact. Re-run TypeScript
checks and fix any type errors surfaced by updated `@types/react` or
`@types/react-dom`.

Stage D: Documentation updates. Update `docs/developers-guide.md` with any new
React 19 development practices (for example, avoiding string refs and keeping
`@types/react` aligned). Update `docs/velocetty-hyper-codebase.md` to reference
React 19 in tables and narrative sections, and mark roadmap item 1.4.10 as
complete once all validations pass.

Stage E: Validation and final checks. Run the required commands in order and
capture logs. Only proceed to commit once all gates pass.

## Concrete steps

1. Record current dependency baselines and peer dependency expectations.

    Run:

    ```shell
    bun x npm info react version
    bun x npm info react-dom version
    bun x npm info react-redux peerDependencies
    bun x npm info react-use peerDependencies
    bun x npm info styled-jsx peerDependencies
    ```

2. Search for legacy React usage in the renderer and plugin bridge.

    Run:

    ```shell
    rg -n "ReactDOM.render|createFactory|ref=\\\"|ref='" lib app
    rg -n "react/umd|react-dom/umd|window.React" lib app
    ```

3. Update dependency versions.

    Edit `package.json` to bump `react`, `react-dom`, `@types/react`, and
    `@types/react-dom` to React 19-compatible versions. Edit `app/package.json`
    to set exact `react` and `react-dom` versions that match the root versions.
    If peer dependency checks require it, bump React-adjacent dependencies (for
    example, `react-redux` or `styled-jsx`) to the smallest compatible versions.
    Run `bun install` to update `bun.lock`.

4. Apply code fixes if searches in step 2 found deprecated APIs.

    Replace string refs with `useRef` or `createRef` in the relevant
    components. Ensure `lib/utils/plugins.ts` and `app/plugins.js` still share
    React and React DOM modules consistently.

5. Update documentation.

    Update `docs/developers-guide.md` to reflect any new React 19 development
    practices and the new baseline versions. Update
    `docs/velocetty-hyper-codebase.md` to replace React 18.3.1 references with
    the new React 19 versions and update any related tables. Mark roadmap item
    1.4.10 as done in `docs/roadmap.md` after validation succeeds.

6. Run validation commands and capture logs.

    Run:

    ```shell
    bun install | tee /tmp/bun-install-velocetty-1-4-10-migrate-to-react-19.out
    make build | tee /tmp/build-velocetty-1-4-10-migrate-to-react-19.out
    make check-fmt | tee /tmp/check-fmt-velocetty-1-4-10-migrate-to-react-19.out
    make lint | tee /tmp/lint-velocetty-1-4-10-migrate-to-react-19.out
    make test | tee /tmp/test-velocetty-1-4-10-migrate-to-react-19.out
    ```

    If documentation changed, also run:

    ```shell
    bunx markdownlint-cli2 "docs/**/*.md" | tee /tmp/mdlint-velocetty-1-4-10-migrate-to-react-19.out
    nixie --no-sandbox | tee /tmp/nixie-velocetty-1-4-10-migrate-to-react-19.out
    ```

## Validation and acceptance

Quality criteria:

- React and React DOM are upgraded to React 19 in both `package.json` and
  `app/package.json`, with `app/package.json` pinned to exact versions.
- React-adjacent dependencies are on versions that declare React 19 support.
- No string refs or other removed React APIs remain in renderer components.
- Documentation reflects the React 19 upgrade and the roadmap marks item 1.4.10
  as done.
- The following commands succeed with exit code 0:

    ```shell
    bun install
    make build
    make check-fmt
    make lint
    make test
    bunx markdownlint-cli2 "docs/**/*.md" (when docs change)
    nixie --no-sandbox (when docs change)
    ```

## Idempotence and recovery

`bun install` and the Makefile targets are safe to re-run. If any command
fails, review the corresponding log in `/tmp/` and fix the underlying issue
before re-running only the failed command. Use Git status to verify the lock
file and documentation changes are expected after re-running.

## Artifacts and notes

Expected file touch list (may expand if compatibility fixes are needed):

- `package.json`
- `app/package.json`
- `bun.lock`
- `lib/` (only if code changes are needed for deprecated APIs)
- `docs/developers-guide.md`
- `docs/velocetty-hyper-codebase.md`
- `docs/roadmap.md`

## Interfaces and dependencies

The React runtime and types must be React 19-compatible at the end of the
upgrade. The following versions should be set to the latest React 19-compatible
releases as determined in Stage A:

- `react` and `react-dom` (React 19.x.y)
- `@types/react` and `@types/react-dom` (matching React 19 types)
- `react-redux`, `react-use`, `styled-jsx` (only if peer dependency ranges
  require changes)

## Revision note

Recorded post-implementation fixes for Redux 5, React Redux 9, and Bun 1.3.8.
