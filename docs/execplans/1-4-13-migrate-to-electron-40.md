# Migrate runtime stack to Electron 40

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists in this repository, so this plan stands alone.

## Purpose / big picture

Deliver roadmap item `1.4.13` by migrating the runtime from Electron 34 to
Electron 40 in line with ADR-004's staged path. Success is observable when
`bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
all succeed on this branch, `docs/developers-guide.md` captures any updated
development practice for Electron 40, and `docs/roadmap.md` marks `1.4.13`
done.

## Constraints

- Follow ADR-004 from `docs/adr-004-update-electron-40.md`: staged runtime
  upgrades remain the governing approach and this milestone is the final
  Electron 40 step.
- Preserve existing Make targets and npm/bun script entry points used by local
  development and Continuous Integration (CI).
- Maintain native module functionality for `node-pty` and associated rebuild
  paths (`bun install` postinstall, `bin/rebuild-node-pty.cjs`).
- Keep documentation wrapped to 80 columns and code blocks wrapped to 120
  columns.
- Update `docs/developers-guide.md` if development practice changes for this
  migration.
- Do not mark roadmap item `1.4.13` done until all required gates pass.

## Tolerances (exception triggers)

- Scope: if implementation exceeds 25 files or 1200 net lines, stop and
  escalate.
- Dependencies: if a new third-party dependency is required to complete the
  migration, stop and escalate.
- Interfaces: if user-facing runtime behaviour or command-line interface (CLI)
  contracts must change, stop and escalate.
- Validation: if any required gate still fails after two focused remediation
  passes, stop and escalate with log evidence.
- Ambiguity: if Electron 40 introduces breaking changes not covered by ADR-004
  and there are multiple valid mitigations, stop and escalate with options.

## Risks

- Risk: `node-pty` may fail against Electron 40/Node 24 ABI changes.
  Severity: high
  Likelihood: medium
  Mitigation: run `bun install` first, inspect rebuild failures, and only
  adjust runtime dependency versions with concrete build evidence.
- Risk: snapshot/build tooling can fail when moving from Electron 34 to 40.
  Severity: medium
  Likelihood: medium
  Mitigation: validate with `make build` immediately after runtime anchor
  updates; capture failing step logs and apply minimal targeted fixes.
- Risk: version drift in architecture and developer docs can leave mixed 34/40
  guidance.
  Severity: medium
  Likelihood: high
  Mitigation: perform a focused doc sweep for Electron and bundled Node
  baseline references, prioritizing `docs/developers-guide.md`,
  `docs/velocetty-hyper-codebase.md`, and roadmap status.

## Progress

- [x] (2026-02-09) Confirmed branch is
  `1-4-13-migrate-to-electron-40` and collected roadmap/ADR context.
- [x] (2026-02-09) Drafted this ExecPlan with concrete migration stages,
  tolerances, and validation gates.
- [x] (2026-02-10) Implemented runtime anchor updates for Electron 40:
  `package.json`, `bin/rebuild-node-pty.cjs`, and
  `.github/workflows/nodejs.yml`.
- [x] (2026-02-10) Ran required gates with captured logs:
  `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
- [x] (2026-02-10) Updated developer-facing and baseline documentation:
  `docs/developers-guide.md`, `docs/velocetty-hyper-codebase.md`, and
  `docs/roadmap.md`.
- [x] (2026-02-10) Re-ran full gate sequence after documentation changes and
  confirmed all required checks still pass.
- [x] (2026-02-10) Applied post-review documentation correction in
  `docs/velocetty-hyper-codebase.md` to align the CI Node.js row with the
  Electron 40 baseline (`24.x`).

## Surprises & discoveries

- Observation: `grepai` semantic search is intermittently unavailable in this
  environment due local embedding service timeouts.
  Evidence: repeated `grepai search ... --json --compact` errors reporting
  timeout while awaiting Ollama embedding responses.
  Impact: context gathering falls back to direct file reads for this task.
- Observation: the hyper codebase document currently embeds extensive Electron
  34 baseline references.
  Evidence: targeted `rg` sweep across
  `docs/velocetty-hyper-codebase.md` for `Electron 34`, `34.5.8`, and Node
  runtime baselines.
  Impact: migration likely requires broader documentation baseline updates than
  roadmap and developers' guide alone.
- Observation: `node-pty@1.1.0` rebuilt successfully against Electron 40
  headers, so no runtime dependency bump was required for this milestone.
  Evidence: `bun install` postinstall and explicit rebuild path both completed
  with `--target=40.2.1` and `gyp info ok`.
  Impact: migration remained focused on runtime anchors and documentation
  baselines with no app runtime dependency churn.

## Decision log

- Decision: treat this document as a draft execution plan only until explicit
  implementation approval.
  Rationale: aligns with ExecPlan process and keeps implementation changes
  gated behind reviewed scope.
  Date/Author: 2026-02-09 / Codex
- Decision: keep required gate commands in the exact sequence requested by the
  roadmap task (`bun install` then Make gates).
  Rationale: `bun install` exercises native rebuild and snapshot generation
  before higher-level checks, reducing diagnosis ambiguity.
  Date/Author: 2026-02-09 / Codex
- Decision: target Electron `40.2.1` and align `electron-mksnapshot` to the
  same patch.
  Rationale: latest available Electron 40 patch release at implementation time
  with matching snapshot tooling.
  Date/Author: 2026-02-10 / Codex
- Decision: align TypeScript Node typings to `@types/node ^24.10.12` and CI
  `NODE_VERSION` to `24.11.1`.
  Rationale: keep development and native rebuild tooling aligned with Electron
  40's bundled Node.js major/minor baseline.
  Date/Author: 2026-02-10 / Codex
- Decision: retain `node-pty` at `1.1.0`.
  Rationale: no stable upstream version newer than `1.1.0` and rebuild/test
  evidence shows compatibility with Electron 40 in this repository.
  Date/Author: 2026-02-10 / Codex
- Decision: apply a targeted follow-up documentation correction for the CI
  feature table Node.js version value.
  Rationale: reviewer feedback identified a stale `20.x` row inconsistent with
  the Electron 40/Node 24 baseline.
  Date/Author: 2026-02-10 / Codex

## Outcomes & retrospective

Roadmap item `1.4.13` is complete. The repository now targets Electron 40 and
all required quality gates pass after runtime and documentation updates.

Validated commands:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Additional documentation-quality gates run and passed after markdown edits:

- `bun fmt`
- `bunx markdownlint-cli "docs/**/*.md"`
- `nixie --no-sandbox`

## Context and orientation

This milestone closes roadmap workstream `1.4.13` and follows completed
milestones `1.4.11` (Electron 28) and `1.4.12` (Electron 34). Current runtime
anchors are Electron `^40.2.1` and `@types/node` `^24.10.12` in
`package.json`, with fallback rebuild target `40.2.1` in
`bin/rebuild-node-pty.cjs`, and CI Node baseline `24.11.1` in
`.github/workflows/nodejs.yml`.

Relevant source-of-truth documents for this implementation:

- `docs/roadmap.md`: task status and completion tracking for `1.4.13`.
- `docs/adr-004-update-electron-40.md`: accepted staged path and risk framing.
- `docs/developers-guide.md`: developer practice that must reflect migration
  changes.
- `docs/velocetty-design.md`: host migration constraint to avoid locking new
  systems to Electron-specific APIs.
- `docs/velocetty-hyper-codebase.md`: technology baseline matrix and runtime
  inventory likely requiring version updates.
- `docs/velocetty-product-requirements-document.md`: quality-gate expectations
  and delivery framing for migration workstreams.

## Plan of work

Stage A: Confirm the exact Electron 40 target patch release and bundled Node
major to avoid partial or mixed runtime updates.

Stage B: Update runtime anchors in source manifests and rebuild scripts:
`package.json`, `bin/rebuild-node-pty.cjs`, and any companion runtime metadata
that must match Electron 40.

Stage C: Align CI/runtime tooling expectations for native rebuild compatibility
with Electron 40's bundled Node family (`.github/workflows/nodejs.yml` and any
other Node-version anchors used for rebuild flows).

Stage D: Run requested quality gates in order with captured logs and address
any migration regressions:
`bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.

Stage E: Update developer and architecture documentation to reflect final
development practice changes and runtime baselines; then mark roadmap item
`1.4.13` done.

Stage F: Re-run the full gate sequence after documentation edits, finalize this
ExecPlan to `COMPLETE`, and record outcome evidence in this file.

## Concrete steps

1. Capture pre-change runtime anchors:
   `package.json`, `bin/rebuild-node-pty.cjs`,
   `.github/workflows/nodejs.yml`, and any Electron-version-locked tooling.
2. Apply Electron 40 migration edits:
   - bump `devDependencies.electron`,
   - align `@types/node` with Electron 40 bundled Node major,
   - update rebuild fallback target in `bin/rebuild-node-pty.cjs`,
   - adjust runtime dependency pins (for example `node-pty`) if evidence
     requires it.
3. Run required gates and log outputs:
   - `bun install |& tee /tmp/install-velocetty-1-4-13-migrate-to-electron-40.out`
   - `make build |& tee /tmp/build-velocetty-1-4-13-migrate-to-electron-40.out`
   - `make check-fmt |& tee /tmp/check-fmt-velocetty-1-4-13-migrate-to-electron-40.out`
   - `make lint |& tee /tmp/lint-velocetty-1-4-13-migrate-to-electron-40.out`
   - `make test |& tee /tmp/test-velocetty-1-4-13-migrate-to-electron-40.out`
4. Update documentation with the validated Electron 40 baseline and development
   practice deltas:
   `docs/developers-guide.md`, `docs/velocetty-hyper-codebase.md`, and
   `docs/roadmap.md`.
5. Re-run the same gate sequence after doc edits and record success evidence in
   `Progress` and `Outcomes & retrospective`.

## Validation and acceptance

Done criteria for roadmap item `1.4.13`:

- Electron runtime baseline upgraded to Electron 40 in source-of-truth runtime
  anchors.
- Native rebuild/install path remains functional (`bun install` passes with no
  unresolved `node-pty` rebuild failures).
- Required commands pass cleanly:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`
- `docs/developers-guide.md` documents any changed development practices for
  Electron 40 migration.
- `docs/roadmap.md` marks `1.4.13` as done.

## Idempotence and recovery

- All validation commands are safe to re-run; logs in `/tmp/*.out` provide
  deterministic failure evidence for retries.
- If `bun install` fails during postinstall/rebuild, apply a focused fix and
  rerun `bun install` before moving on.
- If generated artefacts cause stale-state issues, clean affected build output,
  rerun the failing command, and record the action in `Surprises &
  discoveries`.

## Interfaces and dependencies

- Runtime anchors to change:
  - `package.json` `devDependencies.electron`
  - `package.json` `devDependencies.electron-mksnapshot`
  - `package.json` `@types/node`
  - `bin/rebuild-node-pty.cjs` fallback target version
- Potential compatibility anchor:
  - `app/package.json` `node-pty` (change only if required by build evidence)
- CI/runtime alignment:
  - `.github/workflows/nodejs.yml` Node bootstrap/runtime version anchors

## Revision note

Updated from `IN PROGRESS` to `COMPLETE` after implementing Electron 40 runtime
anchor changes, validating all required gates, and updating developer/tracking
documentation (including roadmap completion state).

Post-completion review update: corrected a stale CI Node.js table entry in
`docs/velocetty-hyper-codebase.md` from `20.x` to `24.x` to match the shipped
runtime and CI baselines.
