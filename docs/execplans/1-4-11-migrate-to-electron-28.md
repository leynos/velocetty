# Migrate runtime stack to Electron 28

This ExecPlan is a living document. The sections `Constraints`, `Tolerances`,
`Risks`, `Progress`, `Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists in this repository, so this plan stands alone.

## Purpose / big picture

Deliver roadmap item `1.4.11` by migrating the runtime from Electron 22 to
Electron 28, while preserving build, packaging, and test workflows. Success is
observable when `bun install`, `make build`, `make check-fmt`, `make lint`, and
`make test` all succeed, developer documentation captures any updated practice,
and roadmap item `1.4.11` is marked done.

## Constraints

- Follow Architecture Decision Record (ADR)-004 staged migration path from
  `docs/adr-004-update-electron-40.md`:
  Electron 22 → 28 → 34 → 40.
- Preserve existing script and Make target names.
- Maintain native module functionality (`node-pty`) after the upgrade.
- Ensure documentation stays wrapped to 80 columns and code blocks to 120
  columns.
- Update `docs/developers-guide.md` if development practice changes.
- Do not mark roadmap item `1.4.11` done until required gates pass.

## Tolerances (exception triggers)

- Scope: if implementation exceeds 20 files or 800 net lines, stop and
  escalate.
- Dependencies: if a new third-party dependency is required, stop and
  escalate.
- Interfaces: if user-facing runtime behaviour or CLI contracts must change,
  stop and escalate.
- Validation: if required gates fail after two focused remediation passes,
  stop and escalate with logs.
- Ambiguity: if a migration decision materially affects later Electron 34/40
  steps and is not covered by ADR-004, stop and escalate.

## Risks

- Risk: `node-pty` may fail to compile against Electron 28 headers.
  Severity: high
  Likelihood: medium
  Mitigation: validate `bun install` early and upgrade `node-pty` if required.
- Risk: stale patch artefacts in `target/` can break `patch-package` during
  app dependency installation.
  Severity: medium
  Likelihood: medium
  Mitigation: ensure build step clears stale patch output before recopying.
- Risk: documentation drift across large architecture documents can leave mixed
  runtime baselines.
  Severity: medium
  Likelihood: high
  Mitigation: sweep `docs/velocetty-hyper-codebase.md` for old Electron 22
  values and normalize to Electron 28 baseline.

## Progress

- [x] (2026-02-08 21:42Z) Confirmed branch is
  `1-4-11-migrate-to-electron-28` and baseline gates pass pre-change.
- [x] (2026-02-08 21:46Z) Updated runtime anchor versions:
  `package.json` (`electron`, `@types/node`) and
  `bin/rebuild-node-pty.cjs` fallback target.
- [x] (2026-02-08 21:49Z) Diagnosed and resolved Electron 28 install failure by
  upgrading `app/package.json` `node-pty` to `1.1.0`.
- [x] (2026-02-08 21:50Z) Fixed stale patch artefact issue by cleaning
  `target/patches` in `build:hyper-app` before copying app assets.
- [x] (2026-02-08 21:51Z) Re-ran and passed `bun install`, `make build`,
  `make check-fmt`, `make lint`, and `make test` after runtime migration.
- [x] (2026-02-08 21:54Z) Updated roadmap and developer guidance docs; updated
  Electron 22 baseline references in `docs/velocetty-hyper-codebase.md`.
- [x] (2026-02-08 21:55Z) Re-ran full required gates after documentation
  updates.
- [x] (2026-02-08 21:56Z) Finalized ExecPlan status and retrospective.
- [x] (2026-02-09 00:06Z) Investigated Continuous Integration (CI) `bun install`
  failure in
  `install-app-deps` and reproduced patch-package mismatch for
  `node-pty+1.1.0.patch`.
- [x] (2026-02-09 00:08Z) Removed obsolete node-pty patch and made
  `build:hyper-app` tolerate empty `app/patches/` copy inputs.
- [x] (2026-02-09 00:10Z) Re-ran required gates (`bun install`, `make build`,
  `make check-fmt`, `make lint`, `make test`) after remediation.

## Surprises & discoveries

- Observation: `node-pty@1.0.0` fails to compile against Electron 28 headers
  with a V8/NAN type assertion error.
  Evidence: `/tmp/install-velocetty-1-4-11-migrate-to-electron-28.out` from
  the initial migration attempt.
  Impact: upgraded app runtime dependency to `node-pty@1.1.0`.
- Observation: `patch-package` failed in `target/` because old patch files were
  retained between builds.
  Evidence: `install-app-deps` attempted to apply stale
  `node-pty+1.0.0.patch` after the repository moved to
  `node-pty+1.1.0.patch`.
  Impact: `build:hyper-app` now clears `target/patches` before copying.
- Observation: `node-pty+1.1.0.patch` still targeted the old 1.0.0 NAN-era
  source and no longer applied to `node-pty@1.1.0` (N-API implementation).
  Evidence: deterministic repro via `npx patch-package` in a clean temporary
  installation with `node-pty@1.1.0`.
  Impact: removed the obsolete patch and updated the asset copy step to allow
  empty `app/patches/` content.

## Decision log

- Decision: target Electron `28.3.3` for this milestone.
  Rationale: latest Electron 28 patch and aligns with ADR-004 staged approach.
  Date/Author: 2026-02-08 / Codex
- Decision: upgrade `@types/node` to `^18.19.130`.
  Rationale: align type baseline with Electron 28 Node runtime family.
  Date/Author: 2026-02-08 / Codex
- Decision: upgrade `app/package.json` `node-pty` from `1.0.0` to `1.1.0`.
  Rationale: `1.0.0` failed to build against Electron 28 headers.
  Date/Author: 2026-02-08 / Codex
- Decision: clean `target/patches` before `build:hyper-app` copy.
  Rationale: prevent stale patch files from breaking `patch-package`.
  Date/Author: 2026-02-08 / Codex
- Decision: normalize Electron baseline references in
  `docs/velocetty-hyper-codebase.md` to Electron 28 data.
  Rationale: remove stale Electron 22 guidance and align docs with migrated
  runtime baseline.
  Date/Author: 2026-02-08 / Codex
- Decision: remove `app/patches/node-pty+1.1.0.patch`.
  Rationale: patch was obsolete and inapplicable against upstream
  `node-pty@1.1.0`, causing CI install failure.
  Date/Author: 2026-02-09 / Codex
- Decision: set `noErrorOnMissing: true` for the `app/patches` copy pattern in
  `webpack.config.ts`.
  Rationale: support zero-patch state without failing `build:hyper-app`.
  Date/Author: 2026-02-09 / Codex

## Outcomes & retrospective

Roadmap item `1.4.11` is complete. The runtime now targets Electron 28 and
native module rebuilding works with Electron 28 headers. The most significant
implementation risk was native compatibility of `node-pty`; this was resolved
with a version bump to `1.1.0` plus a deterministic copy-step fix for patch
artefacts in `target/patches`.

Post-completion CI validation revealed that the carried-over node-pty patch for
`1.1.0` was obsolete. Removing that patch and allowing empty patch-copy inputs
resolved the install-app-deps failure without changing runtime behaviour.

All required commands now pass on this branch:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Developer guidance and roadmap tracking were updated in the same change, and
the architecture baseline doc no longer reports Electron 22 as current runtime
state.

## Context and orientation

Key migration surfaces:

- `package.json`: Electron version, Node typings, and build script workflow.
- `app/package.json`: runtime dependency pin for `node-pty` bundled in app.
- `bin/rebuild-node-pty.cjs`: native module rebuild fallback target.
- `app/patches/`: Windows node-pty patch applied by `patch-package`.
- `docs/developers-guide.md`: local practices developers follow.
- `docs/roadmap.md`: delivery status tracking.
- `docs/velocetty-hyper-codebase.md`: architecture and dependency baseline.

## Plan of work

Stage A: Update runtime dependency anchors and native rebuild target.

Stage B: Run `bun install`, capture failures, and remediate Electron 28
compatibility blockers.

Stage C: Validate required build/test gates.

Stage D: Update developer-facing documentation and roadmap status.

Stage E: Re-run gates after doc updates and finalize.

## Concrete steps

1. Update dependency anchors (`package.json`, `bin/rebuild-node-pty.cjs`,
   `app/package.json`) and patch file naming under `app/patches/`.
2. Run and capture:

   - `bun install` →
     `/tmp/install-velocetty-1-4-11-migrate-to-electron-28.out`
   - `make build` →
     `/tmp/build-velocetty-1-4-11-migrate-to-electron-28.out`
   - `make check-fmt` →
     `/tmp/check-fmt-velocetty-1-4-11-migrate-to-electron-28.out`
   - `make lint` →
     `/tmp/lint-velocetty-1-4-11-migrate-to-electron-28.out`
   - `make test` →
     `/tmp/test-velocetty-1-4-11-migrate-to-electron-28.out`
3. Update docs and roadmap.
4. Re-run required gates and finalize status.

## Validation and acceptance

Done criteria for this roadmap item:

- Electron runtime upgraded to Electron 28 baseline.
- Native rebuild path succeeds with Electron 28 target.
- Required commands pass:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`
- `docs/developers-guide.md` reflects migration-practice changes.
- `docs/roadmap.md` marks `1.4.11` done.

## Idempotence and recovery

- Commands are rerunnable; failures are diagnosed through `/tmp` logs.
- If `bun install` fails in postinstall, fix the reported failing stage and
  rerun `bun install`.
- If stale copied artefacts break patching, clear generated `target/` output and
  rerun `bun run build:hyper-app` before install-app-deps.

## Interfaces and dependencies

- Runtime dependency baseline:
  - `electron`: `^28.3.3` (`package.json`)
  - `node-pty`: `1.1.0` (`app/package.json`)
- Type baseline:
  - `@types/node`: `^18.19.130` (`package.json`)
- Native rebuild target:
  - `bin/rebuild-node-pty.cjs` fallback target `28.3.3`.

## Revision note

Updated to `COMPLETE` after final gate rerun and documentation completion,
including outcomes and closure of pending progress items.
