# Migrate renderer dependencies to React 18.3

## Module header

- Purpose: Describe the execution plan for upgrading Velocetty to React 18.3 as
  the first step in the incremental React 19 migration.
- Invariants: Maintain the ExecPlan structure, keep validation outcomes
  current, and record decisions as they occur.
- Cross-links: `docs/roadmap.md`, `docs/adr-003-update-react-19.md`,
  `docs/developers-guide.md`, `docs/velocetty-hyper-codebase.md`.

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists at the repository root as of 2026-02-03. If one is added,
this plan must be updated to follow it.

## Purpose / Big Picture

Upgrade the renderer stack from React 18.2 to React 18.3 (React and React DOM),
keeping the incremental migration path towards React 19 described in ADR 003.
Success is observable when the repository installs with React 18.3 versions,
all validation gates pass, documentation reflects the new versions, and the
roadmap entry 1.4.9 is marked done.

## Constraints

- Use Bun for JavaScript/TypeScript script invocation unless a documented
  exception is required.
- Keep the incremental upgrade path in ADR 003 intact and do not introduce
  React 19 changes in this milestone.
- Keep build tooling behaviour equivalent unless React 18.3 requires changes.
- Preserve plugin decoration behaviour and shared React module patching.
- Update `docs/developers-guide.md` if any development practice changes.
- Keep documentation wrapped to 80 columns and code blocks to 120 columns.
- Ensure `bun install`, `make build`, `make check-fmt`, `make lint`, and
  `make test` succeed before marking the roadmap entry done.

## Tolerances (Exception Triggers)

- Scope: if the change requires more than 18 files or more than 500 net lines,
  stop and escalate.
- Interfaces: if a public script or Makefile target must be removed or
  renamed, stop and escalate.
- Dependencies: if a new runtime dependency beyond React 18.3.x and matching
  `@types` packages is required, stop and escalate.
- Tooling: if build tooling (Webpack, Babel, tsgo) requires a new major
  version, stop and escalate.
- Tests: if `make check-fmt`, `make lint`, or `make test` fails twice after
  updates, stop and escalate.

## Risks

- Risk: React 18.3 introduces warnings that require code updates before React
  19.
  Severity: medium
  Likelihood: medium
  Mitigation: scan for deprecated patterns (`ReactDOM.render`, string refs) and
  confirm the renderer already uses the `createRoot` path.
- Risk: version drift between `package.json` and `app/package.json` causes
  duplicate React instances for plugins.
  Severity: high
  Likelihood: medium
  Mitigation: update both manifests and confirm `bun.lock` reflects a single
  React 18.3.x version.
- Risk: documentation continues to cite React 18.2, creating confusion.
  Severity: low
  Likelihood: high
  Mitigation: update every documented React version reference and re-run
  Markdown validation.

## Progress

- [x] (2026-02-03 19:23Z) Reviewed roadmap entry 1.4.9 and ADR 003 to confirm
  the incremental upgrade path.
- [x] (2026-02-03 19:23Z) Located current React 18.2 references in dependency
  manifests and documentation.
- [x] (2026-02-03 19:27Z) Plan approved and implementation started.
- [x] (2026-02-03 19:30Z) Confirmed target versions (React 18.3.1) and checked
  for deprecated rendering patterns.
- [x] (2026-02-03 19:32Z) Updated dependency manifests and refreshed
  `bun.lock` via `bun install`.
- [x] (2026-02-03 19:38Z) Updated developer and architecture documentation and
  marked roadmap entry 1.4.9 as done.
- [x] (2026-02-03 20:11Z) Restored `styled-jsx` style blocks and aligned
  `forwardRef` usage with Babel parsing to keep React 18.3 builds stable.
- [x] (2026-02-03 20:18Z) Ran `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.
- [x] (2026-02-03 20:23Z) Re-ran documentation formatting and Mermaid
  validation (`bun fmt`, `make markdownlint`, `make nixie`).
- [x] (2026-02-03 20:33Z) Committed changes and closed out the ExecPlan.

## Surprises & Discoveries

- Observation: `bun install` reported Bun 1.3.5 while the repo pins 1.3.7.
  Evidence: `/tmp/install-velocetty-1-4-9-migrate-to-react-18-3.out`.
  Impact: No functional change observed, but local tooling is older than the
  pinned version.
- Observation: React 18.3 typings rejected the `jsx`/`global` attributes on
  `styled-jsx` style tags.
  Evidence: `make build` type errors before adding `typings/styled-jsx.d.ts`.
  Impact: Added a local typings shim to preserve the existing styling model.
- Observation: Unit tests still emit `react-dom/test-utils` and `jsx` attribute
  warnings.
  Evidence: `/tmp/test-velocetty-1-4-9-migrate-to-react-18-3.out`.
  Impact: Tests pass; warnings remain from existing test/runtime behaviour.

## Decision Log

- Decision: Follow ADR 003 and upgrade to React 18.3 before React 19.
  Rationale: ADR 003 explicitly specifies an incremental upgrade path.
  Date/Author: 2026-02-03 (assistant)
- Decision: Proceed with implementation after plan approval.
  Rationale: User explicitly approved the ExecPlan draft.
  Date/Author: 2026-02-03 (assistant)
- Decision: Add a local `styled-jsx` typings shim and avoid
  `forwardRef<T>` generics.
  Rationale: Keeps React 18.3 type-checking and Babel parsing aligned without
  changing runtime behaviour.
  Date/Author: 2026-02-03 (assistant)

## Outcomes & Retrospective

React and React DOM are now on 18.3.1 across both manifests, with matching
`@types` updates and a refreshed lockfile. Renderer styling remains intact by
restoring `styled-jsx` blocks, adding a local typings shim for the `jsx` and
`global` attributes, and keeping Babel's TypeScript preset aligned with TSX
parsing. Documentation was updated to reflect the new React version and the
roadmap entry is marked done. All validation gates (`bun install`, `make build`,
`make check-fmt`, `make lint`, `make test`, `make markdownlint`, `make nixie`)
completed successfully; unit tests still emit the pre-existing `act` and `jsx`
warnings.

## Context and Orientation

React and React DOM are declared in both the repository root `package.json`
(caret ranges used for most dependencies) and `app/package.json` (exact
versions for critical runtime dependencies). The renderer entry point is
`lib/index.tsx`, and shared React module patching is described in
`docs/velocetty-hyper-codebase.md`. Documentation that records dependency
versions and developer practices lives in `docs/velocetty-hyper-codebase.md`
and `docs/developers-guide.md`. The roadmap entry 1.4.9 in `docs/roadmap.md`
must be marked done after validation passes.

## Plan of Work

Stage A: confirm the target React 18.3.x versions. Query the registry for the
latest 18.3.x versions of `react`, `react-dom`, and `@types` packages. Review
renderer code for any deprecated patterns highlighted in the React 19 upgrade
notes to avoid surprises in the next milestone.

Stage B: update dependencies. Align `package.json` and `app/package.json` with
React 18.3.x and update `@types/react` and `@types/react-dom` to the matching
18.3.x versions. Run `bun install` to refresh `bun.lock` and verify a single
React version is resolved.

Stage C: update documentation and roadmap. Refresh all React version references
in `docs/velocetty-hyper-codebase.md`, adjust any dependency tables, and update
`docs/developers-guide.md` if development practices change. Mark roadmap entry
1.4.9 as done once validations succeed.

Stage D: validate and commit. Run the required formatting, linting, build, and
test gates with logs captured via `tee`. Commit each logical change only after
its gates pass.

## Concrete Steps

1. Confirm target versions and scan for deprecated patterns.

   - Query the registry for React 18.3.x versions:

     bunx npm view react@18.3 version
     bunx npm view react-dom@18.3 version
     bunx npm view @types/react@18.3 version
     bunx npm view @types/react-dom@18.3 version

   - Scan renderer code for deprecated patterns:

     grepai search "ReactDOM.render usage" --json --compact
     grepai search "string ref" --json --compact
     rg -n "createRoot|hydrateRoot" lib

   Capture findings in `Surprises & Discoveries` if anything unexpected
   appears.

2. Update dependency manifests.

   - `package.json`: update `react`, `react-dom`, `@types/react`, and
     `@types/react-dom` to the selected 18.3.x versions.
   - `app/package.json`: update `react` and `react-dom` to the same 18.3.x
     versions (keep exact versions here).

3. Refresh the lockfile and verify resolution.

   - Run:

     bun install 2>&1 | tee /tmp/install-velocetty-$(git branch --show).out

   - Confirm `bun.lock` resolves React 18.3.x once across workspaces.

4. Update documentation and roadmap.

   - `docs/velocetty-hyper-codebase.md`: replace React 18.2.0 references with
     18.3.x (React and React DOM), update dependency tables, and adjust any
     diagrams that hardcode versions.
   - `docs/developers-guide.md`: note any new development practices if React
     18.3 introduces build or runtime changes.
   - `docs/roadmap.md`: mark entry 1.4.9 as done after validation passes.

5. Run formatting and validation gates (capture output with `tee`).

   If `get-project` is unavailable, replace it with `velocetty` in the log
   filenames.

   - Documentation formatting and validation:

     bun run fmt
     make markdownlint 2>&1 | tee \\
       /tmp/markdownlint-$(get-project)-$(git branch --show).out
     make nixie 2>&1 | tee \\
       /tmp/nixie-$(get-project)-$(git branch --show).out

   - Required build and test gates:

     make build 2>&1 | tee \\
       /tmp/build-$(get-project)-$(git branch --show).out
     make check-fmt 2>&1 | tee \\
       /tmp/check-fmt-$(get-project)-$(git branch --show).out
     make lint 2>&1 | tee \\
       /tmp/lint-$(get-project)-$(git branch --show).out
     make test 2>&1 | tee \\
       /tmp/test-$(get-project)-$(git branch --show).out

6. Commit each logical change after its gates pass. Suggested split:

   - Commit 1: dependency manifest and lockfile updates.
   - Commit 2: documentation updates and roadmap change.

## Validation and Acceptance

Quality criteria (done means all of the following are true):

- React and React DOM are on 18.3.x in `package.json`, `app/package.json`, and
  `bun.lock`.
- Documentation reflects React 18.3.x and any development practice changes.
- Roadmap entry 1.4.9 is marked done.
- `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  complete successfully.
- Documentation validators (`bun run fmt`, `make markdownlint`, `make nixie`)
  complete successfully after doc updates.

## Idempotence and Recovery

Most steps are safe to repeat. If `bun install` or `make build` fails, re-run
after addressing the reported errors and confirm `bun.lock` remains consistent.
If a validation gate fails, consult the corresponding log file in `/tmp/` and
retry only after the underlying issue is fixed.

## Artifacts and Notes

Store command outputs in `/tmp/*-velocetty-$(git branch --show).out` to retain
proof of successful validation. Include any notable warnings in the
`Surprises & Discoveries` section.

## Interfaces and Dependencies

React-related dependencies that must be aligned to 18.3.x:

- `react`
- `react-dom`
- `@types/react`
- `@types/react-dom`

The renderer entry point remains `lib/index.tsx`, which should continue to use
`createRoot` from `react-dom/client` without introducing React 19-only APIs.

## Revision note

Closed out the plan with final validation results and completion status.
