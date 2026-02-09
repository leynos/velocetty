# Migrate runtime stack to Electron 34

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists in this repository, so this plan stands alone.

## Purpose / Big Picture

Deliver roadmap item `1.4.12` by migrating the runtime from Electron 28 to
Electron 34 while preserving build, packaging, and test workflows.

Success is observable when the following commands all succeed on this branch:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

And when tracking/developer documents are updated:

- `docs/developers-guide.md` reflects updated migration practice.
- `docs/roadmap.md` marks `1.4.12` done.

## Constraints

- Follow ADR-004 staged migration path from
  `docs/adr-004-update-electron-40.md`: 22 → 28 → 34 → 40.
- Preserve existing script and Make target names.
- Maintain native module functionality (`node-pty`) after the upgrade.
- Ensure documentation remains wrapped to 80 columns and code blocks to 120
  columns.
- Update `docs/developers-guide.md` if development practice changes.
- Do not mark roadmap item `1.4.12` done until required gates pass.

## Tolerances (Exception Triggers)

- Scope: if implementation exceeds 25 files or 1000 net lines, stop and
  escalate.
- Dependencies: if a new third-party dependency is required, stop and
  escalate.
- Interfaces: if user-facing runtime behaviour or CLI contracts must change,
  stop and escalate.
- Validation: if required gates fail after two focused remediation passes,
  stop and escalate with logs.
- Ambiguity: if a migration decision materially affects Electron 40 readiness
  and is not covered by ADR-004, stop and escalate.

## Risks

- Risk: `node-pty` may fail to compile against Electron 34 headers.
  Severity: high
  Likelihood: medium
  Mitigation: validate `bun install` early and only adjust runtime dependencies
  if failure evidence confirms incompatibility.
- Risk: V8 snapshot generation may fail with Electron 34 runtime changes.
  Severity: medium
  Likelihood: medium
  Mitigation: validate during `make build` and adjust snapshot tooling only if
  error evidence requires it.
- Risk: documentation drift can leave mixed Electron 28 and 34 baseline
  references.
  Severity: medium
  Likelihood: high
  Mitigation: sweep baseline references in `docs/velocetty-hyper-codebase.md`.

## Progress

- [x] (2026-02-09) Confirmed branch is
  `1-4-12-migrate-to-electron-34` and gathered migration context from ADR,
  roadmap, and existing runtime/tooling files.
- [x] (2026-02-09) Updated runtime anchors in `package.json` and
  `bin/rebuild-node-pty.cjs` for Electron 34.
- [x] (2026-02-09) Updated CI Node baseline in `.github/workflows/nodejs.yml`
  to align with Electron 34's bundled Node family.
- [x] (2026-02-09) Updated `docs/developers-guide.md`,
  `docs/velocetty-hyper-codebase.md`, and `docs/roadmap.md` for the new
  baseline and completion tracking.
- [x] (2026-02-09) Ran and passed required gates with captured logs:
  `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
- [x] (2026-02-09) Finalized plan status and retrospective.

## Surprises & Discoveries

- Observation: ADR-004 references Electron 34 runtime details but the previous
  completed milestone still left many architecture baseline references to
  Electron 28 in `docs/velocetty-hyper-codebase.md`.
  Evidence: targeted grep sweep before edits.
  Impact: required a broader documentation baseline update than just roadmap and
  developers guide.

## Decision Log

- Decision: target Electron `34.5.8` for this milestone.
  Rationale: latest available Electron 34 patch release at execution time.
  Date/Author: 2026-02-09 / Codex
- Decision: align `@types/node` to `^20.19.33`.
  Rationale: keep type baseline aligned with Electron 34's bundled Node major.
  Date/Author: 2026-02-09 / Codex
- Decision: align CI workflow Node baseline to 20.x and arm bootstrap to
  Node 20.18.1.
  Rationale: keep rebuild/runtime assumptions consistent with Electron 34.
  Date/Author: 2026-02-09 / Codex

## Outcomes & Retrospective

Roadmap item `1.4.12` is complete. The runtime now targets Electron 34 and
native module rebuilding succeeds with Electron 34 headers.

All required commands passed on this branch:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

The main migration risk remained native module compatibility. This was
contained by validating `bun install` first and confirming `node-pty` rebuild
success before running the rest of the gates.

Developer guidance now includes explicit Node-typing and CI Node-baseline
alignment expectations when upgrading Electron.

## Context and Orientation

Key migration surfaces:

- `package.json`: Electron and Node typings versions.
- `bin/rebuild-node-pty.cjs`: native module rebuild fallback target.
- `.github/workflows/nodejs.yml`: CI Node baseline for native rebuilds.
- `docs/developers-guide.md`: local migration and validation practice.
- `docs/roadmap.md`: roadmap delivery status.
- `docs/velocetty-hyper-codebase.md`: current architecture/runtime baseline.

## Plan of Work

Stage A: Update runtime anchors and rebuild target.

Stage B: Align CI Node baseline with Electron 34 runtime family.

Stage C: Update developer and architecture baseline documentation.

Stage D: Run required gates and capture logs.

Stage E: Finalize ExecPlan to `COMPLETE`.

## Concrete Steps

1. Update runtime anchors in `package.json` and `bin/rebuild-node-pty.cjs`.
2. Update CI runtime anchors in `.github/workflows/nodejs.yml`.
3. Update tracking and guidance docs.
4. Run and capture:

   - `bun install` →
     `/tmp/install-velocetty-1-4-12-migrate-to-electron-34.out`
   - `make build` →
     `/tmp/build-velocetty-1-4-12-migrate-to-electron-34.out`
   - `make check-fmt` →
     `/tmp/check-fmt-velocetty-1-4-12-migrate-to-electron-34.out`
   - `make lint` →
     `/tmp/lint-velocetty-1-4-12-migrate-to-electron-34.out`
   - `make test` →
     `/tmp/test-velocetty-1-4-12-migrate-to-electron-34.out`
5. Finalize docs and ExecPlan status.

## Validation and Acceptance

Done criteria for roadmap item `1.4.12`:

- Electron runtime upgraded to Electron 34 baseline.
- Native rebuild path succeeds with Electron 34 target.
- Required commands pass:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`
- `docs/developers-guide.md` reflects migration-practice changes.
- `docs/roadmap.md` marks `1.4.12` done.

## Idempotence and Recovery

- Commands are rerunnable; failures are diagnosed using `/tmp` logs.
- If `bun install` fails in postinstall, fix the failing stage and rerun
  `bun install`.
- If build fails due to stale generated artefacts, clean generated outputs and
  rerun `make build`.

## Interfaces and Dependencies

- Runtime dependency baseline:
  - `electron`: `^34.5.8` (`package.json`)
  - `node-pty`: `1.1.0` (`app/package.json`)
- Type baseline:
  - `@types/node`: `^20.19.33` (`package.json`)
- Native rebuild target:
  - `bin/rebuild-node-pty.cjs` fallback target `34.5.8`.
- CI baseline:
  - `.github/workflows/nodejs.yml` `NODE_VERSION: 20.x`.

## Revision Note

Updated to `COMPLETE` after passing all required quality gates and finalizing
tracking/guidance documentation for the Electron 34 baseline.
