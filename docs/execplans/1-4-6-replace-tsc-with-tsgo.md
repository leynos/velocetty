# Replace tsc with tsgo in build and CI

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists at the repository root as of 2026-02-02. If one is added,
this plan must be updated to follow it.

## Purpose / Big Picture

Switch the repository from the JavaScript-based `tsc` compiler to the native
preview `tsgo` compiler (provided by `@typescript/native-preview`) for both
TypeScript compilation and type checking in local scripts and CI. Success is
observable when `bun run dev` and `bun run build` invoke `tsgo`, `make typecheck`
uses `tsgo`, CI builds complete without calling `tsc`, and the roadmap entry
1.4.6 is marked done.

## Constraints

- Use Bun for JavaScript/TypeScript script invocation unless a specific
  constraint blocks it.
- Prefer Makefile targets for validation and keep CI-aligned gates unchanged.
- Keep TypeScript configuration (`tsconfig.base.json`, `tsconfig.json`,
  `tsconfig.typecheck.json`) semantically equivalent unless the `tsgo` CLI
  forces an update.
- Do not remove the existing `typescript` dependency unless the repository
  proves it is no longer required.
- Keep documentation wrapped to 80 columns and code blocks to 120 columns.
- Ensure `make check-fmt`, `make lint`, and `make test` succeed before the
  feature is marked done.

## Tolerances (Exception Triggers)

- Scope: if the change requires more than 12 files or more than 400 net lines,
  stop and escalate.
- Interfaces: if any public-facing script or Makefile target must be removed
  or renamed, stop and escalate.
- Dependencies: if a new dependency or a change to the version range of
  `@typescript/native-preview` or `typescript` is required, stop and escalate.
- Tooling: if `tsgo` lacks required CLI flags (`--build`, `--watch`, or
  `--project`) and a workaround is needed, stop and escalate.
- Tests: if `make check-fmt`, `make lint`, or `make test` fails twice after
  updates, stop and escalate.

## Risks

- Risk: `tsgo` does not support some `tsc` CLI flags currently used in scripts.
  Severity: medium
  Likelihood: medium
  Mitigation: check `tsgo --help`, drop unsupported flags, and document any
  behaviour changes in `docs/developers-guide.md`.
- Risk: build output diverges when using `tsgo` in `bun run build`.
  Severity: medium
  Likelihood: low
  Mitigation: run `bun run build` locally if feasible and verify CI output on
  the next run.
- Risk: documentation references to `tsc` remain, causing confusion.
  Severity: low
  Likelihood: high
  Mitigation: update `docs/developers-guide.md`, `docs/velocetty-hyper-codebase.md`,
  and `docs/installing-aarch64.md`, then re-scan for `tsc` references.

## Progress

- [x] (2026-02-02 18:12Z) Inventory current `tsc` usage in scripts, CI, and
  docs, and confirm `tsgo` supports required flags.
- [x] (2026-02-02 18:25Z) Replace `tsc` usage in `package.json` scripts with
  `tsgo` equivalents.
- [x] (2026-02-02 18:25Z) Confirm CI workflows do not reference `tsc` and align
  documentation with `tsgo`.
- [x] (2026-02-02 18:25Z) Update developer-facing docs with new `tsgo` usage.
- [x] (2026-02-02 18:27Z) Mark roadmap item 1.4.6 as done.
- [x] (2026-02-02 19:05Z) Validate required gates (`make check-fmt`,
  `make lint`, `make test`, `make markdownlint`, `make nixie`). (check-fmt,
  lint, test, and nixie succeeded; markdownlint failed due to pre-existing
  repository violations.)

## Surprises & Discoveries

- Observation: `make markdownlint` reports 3,000+ existing violations across
  repository markdown files.
  Evidence: `/tmp/markdownlint-velocetty-1-4-6-replace-tsc-with-tsgo.out`
  Impact: Markdown validation remains red outside this change set.

## Decision Log

- Decision: Proceed with implementation following plan approval.
  Rationale: User explicitly approved the draft ExecPlan.
  Date/Author: 2026-02-02 (assistant)
- Decision: Do not attempt repo-wide markdownlint remediation.
  Rationale: The errors predate this change and resolving them would exceed
  the task scope and tolerances.
  Date/Author: 2026-02-02 (assistant)

## Outcomes & Retrospective

The repository now uses `tsgo` for TypeScript builds and type checks in the
`dev`, `build`, and `check:types` workflows, with documentation and the
roadmap updated accordingly. Existing markdownlint violations across the repo
still prevent `make markdownlint` from passing; this was not addressed due to
scope limits.

## Context and Orientation

TypeScript build and type checking are driven by `package.json` commands. The
`dev`, `build`, and `check:types` scripts use `tsgo`. The `Makefile` exposes
`typecheck`, `check-fmt`, `lint`, and `test` gates used by both local
development and CI. CI runs the build via `bun run dist` (which invokes
`bun run build`). Documentation describing the build, tooling, or TypeScript
compiler lives in `docs/velocetty-hyper-codebase.md`, `docs/developers-guide.md`,
`docs/installing-aarch64.md`, and the roadmap in `docs/roadmap.md`.

## Plan of Work

Stage A: confirm current usage and `tsgo` CLI compatibility. Identify every
`tsc` reference in scripts, CI configuration, and docs. Verify which `tsc`
flags (`--build`, `--watch`, `--pretty`, `--preserveWatchOutput`, `--project`)
are supported by `tsgo` so replacements are accurate.

Stage B: update build and development scripts. Replace `tsc` invocations in
`package.json` with `tsgo` equivalents, ensuring `dev` uses `tsgo` watch mode
and `build` uses `tsgo` build mode. Keep the command structure intact so CI
continues to call the same scripts.

Stage C: update documentation. Replace references to `tsc` in
`docs/developers-guide.md`, `docs/velocetty-hyper-codebase.md`, and
`docs/installing-aarch64.md` with `tsgo` equivalents, including diagrams,
command tables, and tooling summaries. Note any behavioural differences in the
developers' guide.

Stage D: update roadmap and validate. Mark roadmap item 1.4.6 as done. Run
formatting, lint, tests, and documentation validators. Gate each commit with
the required checks.

## Concrete Steps

1. Inventory current references and confirm `tsgo` flags.

    rg "\\btsc\\b" -n
    bun node_modules/.bin/tsgo --help

   Capture which flags are supported and map them to the existing `tsc`
   commands in `package.json`.

2. Update `package.json` scripts.

   Replace `tsc` invocations in `dev` and `build` with `tsgo` equivalents, for
   example:

   - `dev`: replace the `tsc --build --watch` command with `tsgo --build --watch`.
   - `build`: replace `tsc -b -v` with `tsgo -b -v`.

   If `tsgo` does not support `--pretty` or `--preserveWatchOutput`, remove
   those flags and record the change in the developers' guide.

3. Update documentation for the new compiler.

   - `docs/developers-guide.md`: add or update a TypeScript section describing
     `tsgo` usage and update any command references.
   - `docs/velocetty-hyper-codebase.md`: update tooling tables and diagrams
     that mention `tsc 5.4.5`, and update any `build:ts` / `dev` rows to show
     `tsgo` commands.
   - `docs/installing-aarch64.md`: replace the `tsc --build --watch` reference
     with the `tsgo` equivalent.

4. Mark the roadmap entry 1.4.6 as done in `docs/roadmap.md`.

5. Run formatting and validation gates, capturing output with `tee` as
   required.

    bun run fmt
    make check-fmt 2>&1 | tee /tmp/check-fmt-$(get-project)-$(git branch --show).out
    make lint 2>&1 | tee /tmp/lint-$(get-project)-$(git branch --show).out
    make test 2>&1 | tee /tmp/test-$(get-project)-$(git branch --show).out
    make markdownlint 2>&1 | tee /tmp/markdownlint-$(get-project)-$(git branch --show).out
    make nixie 2>&1 | tee /tmp/nixie-$(get-project)-$(git branch --show).out

6. Commit each logical change after its gate passes. Suggested split:

   - Commit 1: script updates (`package.json`, any build wiring).
   - Commit 2: documentation updates and roadmap change.

## Validation and Acceptance

Quality criteria:

- `make check-fmt` succeeds.
- `make lint` succeeds.
- `make test` succeeds.
- Documentation validation passes via `make markdownlint` and `make nixie`.
- `bun run build` uses `tsgo` (confirm in command output).

Acceptance is achieved when the build and dev scripts use `tsgo`, CI no longer
invokes `tsc`, documentation reflects the change, and the roadmap entry 1.4.6
is marked done.

## Idempotence and Recovery

All steps are safe to rerun. If a validation step fails, fix the reported
issue and rerun the failing command before proceeding. If `tsgo` does not
support required flags, stop after documenting the issue in the Decision Log
and ask for guidance.

## Artifacts and Notes

Keep the `tee` logs from validation in `/tmp` and summarise any failures in the
Decision Log before retrying.

## Interfaces and Dependencies

- `@typescript/native-preview` must remain in `devDependencies` and provides the
  `tsgo` binary at `node_modules/.bin/tsgo`.
- `check:types` should remain `bun node_modules/.bin/tsgo --project
  tsconfig.typecheck.json` unless `tsgo` flag requirements change.
- `dev` and `build` scripts should invoke `tsgo` with the same project files
  (`tsconfig.json` and its references) currently used by `tsc`.

## Revision note

Initial draft created on 2026-02-02.
2026-02-02: Marked plan as IN PROGRESS, logged approval, and recorded the
inventory step as complete.
2026-02-02: Recorded completion of script and documentation updates and
aligned the context section with the new `tsgo` usage.
2026-02-02: Logged markdownlint failure due to pre-existing violations and
recorded the validation status.
2026-02-02: Marked the plan complete and documented the validation outcomes.
