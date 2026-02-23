# Restore Linux aarch64 CI reliability

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept current as work
proceeds.

Status: COMPLETE

No `PLANS.md` exists in this repository, so this plan stands alone.

Implementation was approved by the user on 2026-02-23.

## Purpose / big picture

Deliver the Linux scope of roadmap item `1.4.15`:

- Retire arm7 CI lanes and release artefact targets.
- Replace required Linux ARM coverage with Linux aarch64.
- Resolve Linux aarch64 failures across install, build, lint, and test gates.

Success is observable when:

- `.github/workflows/nodejs.yml` no longer runs `armv7l` lanes.
- Linux ARM CI runs on aarch64 only and is green through
  install/build/lint/test.
- `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`
  all pass on this branch.
- `docs/developers-guide.md` is updated with any changed development practice.
- `docs/roadmap.md` is updated so the Linux-relevant `1.4.15` checklist entries
  are marked done.

## Constraints

- Keep alignment with `docs/adr-004-update-electron-40.md` Phase 3 validation
  and `docs/developers-guide.md` runtime-alignment guidance.
- Keep runtime anchors coherent (`electron`, `electron-mksnapshot`,
  `@types/node`, `bin/rebuild-node-pty.cjs`, and CI `NODE_VERSION`) whenever
  touched.
- Do not expand this plan into macOS aarch64 or Windows stabilization work.
  Those remain separate `1.4.15` checklist items.
- Preserve current Make targets and primary script entry points.
- Keep Markdown wrapped to 80 columns for prose and 120 for code blocks.

## Tolerances (exception triggers)

- Scope: if implementation needs more than 12 files or 700 net lines, stop and
  escalate with options.
- Tooling: if `ubuntu-22.04-arm` is unavailable for this repository, stop and
  escalate before introducing a different CI architecture strategy.
- Dependencies: if fixing Linux aarch64 needs a new third-party dependency,
  stop and escalate before adding it.
- Validation: if any required gate fails after two focused remediation passes,
  stop and escalate with logs.
- Behaviour: if user-facing packaging outputs or command interfaces must change
  beyond architecture target adjustments, stop and escalate.

## Risks

- Risk: current ARM emulation flow (`pguyot/arm-runner-action`) exhausts disk
  while copying the repository into the image.
  Severity: high
  Likelihood: high
  Mitigation: prefer native ARM runners (`ubuntu-22.04-arm`) so CI does not
  copy large `node_modules` trees into an emulated filesystem.
- Risk: `node-pty` rebuild fails on Linux aarch64 due to Node/Electron ABI or
  bootstrap mismatches.
  Severity: high
  Likelihood: medium
  Mitigation: keep Node 24 runtime alignment, run `bun install` first, and
  verify rebuild logs before running later gates.
- Risk: arm7 artefact paths survive in workflow/archive steps and silently keep
  stale release targets alive.
  Severity: medium
  Likelihood: medium
  Mitigation: remove `armv7l` matrix entries, remove `--armv7l` packaging paths,
  and verify uploaded artefact names and formats.

## Progress

- [x] (2026-02-23 00:00Z) Gathered roadmap/ADR/developer-guide constraints and
  inspected current `build-linux-arm` workflow structure.
- [x] (2026-02-23 00:00Z) Collected failure evidence: arm-runner rebuild step
  fails with `No space left on device` during repository copy.
- [x] (2026-02-23 00:00Z) Drafted initial ExecPlan with explicit Linux scope,
  gates, and documentation requirements.
- [x] (2026-02-23 00:00Z) Implemented workflow changes for Linux aarch64-only
  CI coverage in `.github/workflows/nodejs.yml`.
- [x] (2026-02-23 00:00Z) Updated `docs/developers-guide.md` and Linux checklist
  entries under `docs/roadmap.md`.
- [x] (2026-02-23 00:00Z) Ran required gates with `tee` logs:
  `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
- [x] (2026-02-23 00:00Z) Added Linux aarch64 CI bootstrap for x64 snapshot
  emulation (`qemu-user-static` plus `QEMU_LD_PREFIX` sysroot export).
- [x] (2026-02-23 00:00Z) Replaced slow container-export sysroot bootstrap with
  cross-runtime packages (`libc6-amd64-cross`, `libstdc++6-amd64-cross`).
- [x] (2026-02-23 00:00Z) Added `SKIP_X64_V8_SNAPSHOT=1` support and set it in
  the Linux aarch64 install gate to avoid redundant x64 snapshot generation in
  arm64-only packaging lanes.
- [x] (2026-02-23 00:00Z) Reworked Linux aarch64 QEMU runtime provisioning to
  amd64 multiarch libraries after CI install failed in arm64 snapshot
  generation with missing `libglib-2.0.so.0`.

## Surprises & discoveries

- Observation: the failure is not primarily a compile error in `node-pty`; the
  runner fails earlier while copying the repository into the ARM image.
  Evidence: CI log shows repeated `cp: ... No space left on device` in the
  arm-runner mount path before rebuild completes.
  Impact: replacing emulated copy-based runners with native ARM runners is the
  lowest-risk first move.
- Observation: native Linux aarch64 `bun install` still fails without the
  documented x64 snapshot prerequisites.
  Evidence: the install path runs `v8-snapshot` for x64 and arm64, and x64
  snapshot execution on arm64 requires `qemu-x86_64` plus a sysroot containing
  `ld-linux-x86-64.so.2`.
  Impact: the Linux aarch64 lane must prepare `qemu-user-static` and export
  `QEMU_LD_PREFIX` before running install.
- Observation: Linux aarch64 `Install` can remain in progress for hours because
  postinstall executes both x64 and arm64 snapshot passes, and x64 runs under
  QEMU emulation.
  Evidence: GitHub Actions run `22308987524` shows `build-linux-aarch64` stuck
  in `Install` for multiple hours while pre-install sysroot prep completed in
  under one minute.
  Impact: arm64-only packaging lanes should skip x64 snapshot generation.
- Observation: after skipping x64 snapshots for arm64-only lanes, arm64
  snapshot generation still failed under QEMU because
  `v8_context_snapshot_generator` could not load `libglib-2.0.so.0`.
  Evidence: GitHub Actions run `22315578120` failed in `Install` with status
  `127` while running `bun run mk-snapshot`.
  Impact: Linux aarch64 lanes need amd64 multiarch runtime libraries available
  in the QEMU loader path, not only glibc/libstdc++ cross-runtime sysroot
  packages.

## Decision Log

- Decision: scope this plan to the Linux sub-items of roadmap `1.4.15` only.
  Rationale: user request is specifically Linux aarch64 support and arm7
  retirement.
  Date/Author: 2026-02-23 / Codex
- Decision: prefer `ubuntu-22.04-arm` runner over `pguyot/arm-runner-action`.
  Rationale: avoids copy-to-image disk exhaustion and simplifies
  reproducibility.
  Date/Author: 2026-02-23 / Codex
- Decision: keep this as a draft-only artifact until user approval.
  Rationale: follows ExecPlan approval-gate requirements.
  Date/Author: 2026-02-23 / Codex
- Decision: include explicit lint/test gates in the Linux aarch64 workflow lane
  before packaging.
  Rationale: roadmap scope requires Linux aarch64 reliability across install,
  build, lint, and test, not just packaging.
  Date/Author: 2026-02-23 / Codex
- Decision: bootstrap x64 snapshot emulation in the Linux aarch64 lane before
  install by preparing `qemu-user-static` and an x86_64 cross-runtime sysroot.
  Rationale: this matches documented aarch64 snapshot requirements and unblocks
  the install gate on native ARM runners.
  Date/Author: 2026-02-23 / Codex
- Decision: add `SKIP_X64_V8_SNAPSHOT` handling to snapshot orchestration and
  set it in the Linux aarch64 CI install environment.
  Rationale: Linux aarch64 CI lane packages arm64 artefacts only, so generating
  an additional x64 snapshot adds substantial install latency without affecting
  arm64 packaging outcomes.
  Date/Author: 2026-02-23 / Codex
- Decision: provision x86_64 runtime libraries via dpkg multiarch (`amd64`) and
  set `QEMU_LD_PREFIX=/` in the Linux aarch64 lane.
  Rationale: `v8_context_snapshot_generator` dynamically links against glib and
  related libraries that are not present in the previous minimal cross-runtime
  sysroot path.
  Date/Author: 2026-02-23 / Codex

## Outcomes & Retrospective

Implemented Linux aarch64 workflow and documentation updates for the Linux
scope of roadmap `1.4.15`.

Observed outcomes:

- arm7 (`armv7l`) Linux CI lane and arm7 Linux artefact targets were removed.
- Linux ARM workflow now runs as Linux aarch64 on `ubuntu-22.04-arm`.
- Linux aarch64 workflow now bootstraps `qemu-x86_64` and `QEMU_LD_PREFIX`
  sysroot setup before `bun install`.
- Linux aarch64 bootstrap now uses cross-runtime packages rather than container
  export to avoid very long install times in CI.
- Linux aarch64 install now skips x64 snapshot generation when the lane targets
  arm64-only artefacts, reducing CI install time and emulation load.
- Linux aarch64 snapshot bootstrap now installs amd64 multiarch runtime
  libraries (`libc6`, `libstdc++6`, `libgcc-s1`, `libglib2.0-0`, `libexpat1`,
  and `libpcre2-8-0`) with `QEMU_LD_PREFIX=/` so arm64 snapshot generation can
  execute its x64 helper binaries.
- Linux aarch64 lane now runs install/lint/test/build checks and packages arm64
  Linux artefacts.
- `docs/developers-guide.md` now records Linux aarch64 runtime-alignment and CI
  practice.
- `docs/roadmap.md` Linux-specific `1.4.15` checklist items are marked done.

Validation command evidence (local):

- `/tmp/install-velocetty-1-4-15-1-linux-aarch64-support.out`
- `/tmp/build-velocetty-1-4-15-1-linux-aarch64-support.out`
- `/tmp/check-fmt-velocetty-1-4-15-1-linux-aarch64-support.out`
- `/tmp/lint-velocetty-1-4-15-1-linux-aarch64-support.out`
- `/tmp/test-velocetty-1-4-15-1-linux-aarch64-support.out`

Additional docs lint evidence:

- `/tmp/markdownlint-velocetty-1-4-15-1-linux-aarch64-support.out`

## Agent team model

Implementation will use a small agent team:

1. Workflow agent: owns `.github/workflows/nodejs.yml` ARM lane migration and
   validates architecture targeting and artefact naming.
2. Docs agent: owns `docs/developers-guide.md` and Linux checklist updates in
   `docs/roadmap.md`.
3. Verification agent: runs required gates in order, captures logs in `/tmp`,
   and reports pass/fail evidence and residual risks.

The lead agent coordinates sequencing, resolves conflicts, and keeps this
ExecPlan current.

## Context and orientation

Primary files in scope:

- `.github/workflows/nodejs.yml`
  - Linux ARM lane is now `build-linux-aarch64` on `ubuntu-22.04-arm`.
  - Lane includes install/lint/test/build gates plus arm64 Linux packaging.
  - Legacy `armv7l` matrix and `arm-runner` emulation flow were removed.
- `docs/developers-guide.md`
  - `Electron runtime alignment` section is the policy for Node/Electron/native
    rebuild consistency.
- `docs/roadmap.md`
  - `1.4.15` contains Linux checklist items that must be marked done on
    completion of this feature slice.
- `docs/adr-004-update-electron-40.md`
  - Provides the Electron 40 validation context this work must preserve.
- `docs/installing-aarch64.md`
  - Serves as Linux aarch64 troubleshooting guidance and should stay accurate if
    development practice changes.

## Plan of work

Stage A: Redesign Linux ARM CI lane

- Replace emulated copy-based Linux ARM execution with a native ARM runner
  (`runs-on: ubuntu-22.04-arm`) for the Linux aarch64 lane.
- Retire `armv7l` lane entries and remove any arm7-specific packaging/snapshot
  steps.
- Keep Linux aarch64 lane responsible for install/build/lint/test reliability.

Stage B: Stabilize native rebuild and packaging flow

- Ensure Linux aarch64 lane executes `bun install` with aligned Node settings.
- Ensure `node-pty` rebuild path succeeds on aarch64 and does not depend on
  emulated repository copy behaviour.
- Keep artefact packaging targets at aarch64 where relevant and remove arm7
  targets.

Stage C: Update developer documentation

- Update `docs/developers-guide.md` to document Linux aarch64 CI/runtime
  expectations and any changed local troubleshooting steps.
- If workflow strategy changes materially, align supporting references in docs
  that describe CI architecture coverage.

Stage D: Validate required gates

- Run, in order, with log capture:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`
- Use `set -o pipefail` and `tee` for each gate, with branch-qualified log
  filenames under `/tmp`.

Stage E: Roadmap closure for this slice

- Mark Linux-relevant checklist entries under `1.4.15` as done.
- Leave non-Linux `1.4.15` checklist items unchanged.
- Record residual follow-up items if any blocker remains.

## Concrete steps

1. Edit `.github/workflows/nodejs.yml`:
   - Remove `armv7l` from matrix/targets.
   - Replace `build-linux-arm` emulation flow with a Linux aarch64 lane on
     `ubuntu-22.04-arm`.
   - Keep install/build/lint/test coverage in that lane.
2. Verify `node-pty` rebuild and packaging steps on Linux aarch64 only.
3. Update `docs/developers-guide.md` with new Linux aarch64 development and CI
   practice.
4. Update `docs/roadmap.md` to mark Linux `1.4.15` checklist items done.
5. Run required gates with `tee` logs, resolve failures, then rerun until green.
6. Update this ExecPlan `Progress`, `Decision Log`, and `Outcomes` sections.

## Validation and acceptance

Acceptance for this feature slice:

- Linux CI no longer includes arm7 lanes or arm7 Linux release targets.
- Linux aarch64 lane is present and green for install/build/lint/test.
- Local required commands succeed:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`
- `docs/developers-guide.md` reflects changed Linux aarch64 practice.
- `docs/roadmap.md` Linux checklist entries for `1.4.15` are marked done.

## Idempotence and recovery

- Workflow edits are idempotent: rerunning CI should not mutate repository
  state.
- If Linux aarch64 rebuild fails, capture logs, re-run from a clean checkout,
  and compare whether failure happens before or during native rebuild.
- If `ubuntu-22.04-arm` is unavailable, revert to pre-change workflow state and
  escalate with options rather than shipping partial coverage.

## Evidence log paths

Use one log file per gate, for example:

- `/tmp/install-velocetty-$(git branch --show-current).out`
- `/tmp/build-velocetty-$(git branch --show-current).out`
- `/tmp/check-fmt-velocetty-$(git branch --show-current).out`
- `/tmp/lint-velocetty-$(git branch --show-current).out`
- `/tmp/test-velocetty-$(git branch --show-current).out`
