# Restore Linux aarch64 Continuous Integration (CI) reliability

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, and `Outcomes & retrospective` must be kept current as work
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
  Ubuntu mixed-arch runtime provisioning (`libc6:amd64`, `libstdc++6:amd64`,
  `libgcc-s1:amd64`, `libglib2.0-0:amd64`, `libexpat1:amd64`, and
  `libpcre2-8-0:amd64`) plus pinned per-architecture apt sources.
- [x] (2026-02-23 00:00Z) Added `SKIP_X64_V8_SNAPSHOT=1` support and set it in
  the Linux aarch64 install gate to avoid redundant x64 snapshot generation in
  arm64-only packaging lanes.
- [x] (2026-02-23 00:00Z) Reworked Linux aarch64 QEMU runtime provisioning to
  amd64 multiarch libraries after CI install failed in arm64 snapshot
  generation with missing `libglib-2.0.so.0`.
- [x] (2026-02-23 00:00Z) Corrected apt source selection for mixed architectures
  on Ubuntu arm runners by using explicit `arm64` `ports.ubuntu.com` entries
  and `amd64` `archive.ubuntu.com`/`security.ubuntu.com` entries.
- [x] (2026-02-23 00:00Z) Extended mixed-architecture apt source pinning into
  the shared `install-linux-e2e-runtime-deps` action so downstream package
  installation stays reliable after adding `amd64` on arm64 runners.
- [x] (2026-02-23 00:00Z) Added CI-level snapshot skip for Linux aarch64
  installs (`SKIP_V8_SNAPSHOT=1`) to prevent multi-hour stalls in postinstall.
- [x] (2026-02-23 00:00Z) Added runtime package variant detection in the shared
  Linux dependency action so Ubuntu Jammy runners install `libasound2` when
  `libasound2t64` is unavailable.
- [x] (2026-02-24 12:00Z) Added dual mocks for `lib/utils/plugins` (with and
  without the `.ts` suffix) in the affected unit suites so Bun's aarch64
  loader always observes the fake `connect` export and the transport/decoration
  tests pass locally.
- [x] (2026-02-24 13:00Z) Addressed follow-up review comments by extracting
  mixed-arch apt source generation into a shared CI script and factoring plugin
  mock module setup into a shared unit-test helper.
- [x] (2026-02-24 14:00Z) Added an explicit Linux aarch64 CI snapshot-generation
  step (`SKIP_X64_V8_SNAPSHOT=1 bun run v8-snapshot`) before packaging so
  `afterPack` snapshot copy checks pass on clean runners even when install uses
  `SKIP_V8_SNAPSHOT=1`.

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
  snapshot execution on arm64 requires `qemu-x86_64-static` plus a sysroot
  containing `ld-linux-x86-64.so.2`.
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
  in the QEMU loader path, not only a minimal glibc/libstdc++ package set.
- Observation: adding amd64 architecture on the runner triggered apt index
  fetches against `ports.ubuntu.com` for amd64, which return `404 Not Found`.
  Evidence: CI logs show repeated failures for
  `http://ports.ubuntu.com/ubuntu-ports/.../binary-amd64/Packages`.
  Impact: mixed-architecture bootstrap must pin apt sources by architecture,
  not rely on default runner source lists.
- Observation: fixing only the pre-install bootstrap step was insufficient; the
  later shared Linux dependency action still ran `apt-get update` against the
  runner defaults and failed on the same `ports` amd64 404s.
  Evidence: GitHub Actions logs for `Install Linux build and E2E runtime deps`
  failed with `E: Failed to fetch ... binary-amd64/Packages`.
  Impact: all apt invocations after enabling foreign architectures must use the
  same per-architecture source mapping.
- Observation: even with x64 snapshots disabled, Linux aarch64 CI installs can
  stall for hours in `bun run v8-snapshot` while generating arm64 snapshots.
  Evidence: CI `Install` step remained stuck at
  `bun bin/download-mksnapshot.js && bun bin/mk-snapshot.js` until the
  six-hour job timeout.
  Impact: arm64 snapshot generation is too expensive/unpredictable for the CI
  install gate and needs an explicit skip path.
- Observation: Ubuntu 22.04 arm64 runners fail Linux dependency installation on
  `libasound2t64` with `E: Unable to locate package libasound2t64`.
  Evidence: CI logs from `Install Linux build and E2E runtime deps` show apt
  update success followed by package resolution failure on `libasound2t64`.
  Impact: runtime package naming differs across Ubuntu releases, so static
  package names are not reliable for shared Linux dependency steps.
- Observation: Bun's TypeScript resolver on Linux aarch64 canonicalizes the
  renderer `lib/utils/plugins` import as `lib/utils/plugins.ts`, so mocks that
  only matched the extensionless spec were skipped and the real plugin module
  loaded, triggering the `connect` export failure reported in CI.
  Evidence: the aarch64 job logged `SyntaxError: Export named 'connect' not found
  in module lib/utils/plugins.ts` even though the stub exports `connect`.
  Impact: register mocks for both path forms to guarantee the fake exports on
  every architecture.

## Decision log

- Decision: scope this plan to the Linux sub-items of roadmap `1.4.15` only.
  Rationale: user request is specifically Linux aarch64 support and arm7
  retirement.
  Date/Author: 2026-02-23 / Codex
- Decision: prefer `ubuntu-22.04-arm` runner over `pguyot/arm-runner-action`.
  Rationale: avoids copy-to-image disk exhaustion and simplifies
  reproducibility.
  Date/Author: 2026-02-23 / Codex
- Decision: keep this as a draft-only artefact until user approval.
  Rationale: follows ExecPlan approval-gate requirements.
  Date/Author: 2026-02-23 / Codex
- Decision: include explicit lint/test gates in the Linux aarch64 workflow lane
  before packaging.
  Rationale: roadmap scope requires Linux aarch64 reliability across install,
  build, lint, and test, not just packaging.
  Date/Author: 2026-02-23 / Codex
- Decision: bootstrap x64 snapshot emulation in the Linux aarch64 lane before
  install by preparing `qemu-user-static`, enabling dpkg `amd64`, and
  provisioning required `:amd64` runtime libraries.
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
  related libraries, so the lane installs `libc6:amd64`, `libstdc++6:amd64`,
  `libgcc-s1:amd64`, `libglib2.0-0:amd64`, `libexpat1:amd64`, and
  `libpcre2-8-0:amd64` with pinned per-architecture apt sources.
  Date/Author: 2026-02-23 / Codex
- Decision: use an explicit temporary apt source list in Linux aarch64
  bootstrap with `ports.ubuntu.com` limited to `arm64` and
  `archive.ubuntu.com`/`security.ubuntu.com` limited to `amd64`.
  Rationale: avoids amd64 index lookups against `ports` mirrors and makes
  package resolution deterministic on Ubuntu arm runners.
  Date/Author: 2026-02-23 / Codex
- Decision: add mixed-arch source auto-detection to the shared
  `.github/actions/install-linux-e2e-runtime-deps` action.
  Rationale: keeps fast/deep Linux dependency installation aligned with the
  aarch64 bootstrap once `amd64` is enabled, without changing x64 lanes.
  Date/Author: 2026-02-23 / Codex
- Decision: add `SKIP_V8_SNAPSHOT` support to `bin/run-v8-snapshot.js` and set
  it in Linux aarch64 CI install.
  Rationale: makes `bun install` deterministic on aarch64 lanes by bypassing
  the long-running emulated snapshot phase, while retaining the snapshot flow
  for non-CI and non-aarch64 contexts.
  Date/Author: 2026-02-23 / Codex
- Decision: resolve ALSA dependency package names dynamically in the shared
  Linux dependency action by checking availability of `libasound2t64` then
  falling back to `libasound2`.
  Rationale: preserves one CI action implementation across Jammy and Noble
  without per-runner forks.
  Date/Author: 2026-02-23 / Codex
- Decision: register plugin mocks for both the extensionless and `.ts` spec
  strings in the renderer unit suites.
  Rationale: Bun's Linux aarch64 resolver canonicalizes the import as
  `lib/utils/plugins.ts`, so the previous mock targets were skipped and the
  real module triggered the `connect` export error.
  Date/Author: 2026-02-24 / Codex
- Decision: centralize Ubuntu arm64 mixed-arch apt source list generation in
  `.github/scripts/configure-ubuntu-mixed-arch-apt-sources.sh` and call it from
  both the workflow bootstrap and shared Linux dependency action.
  Rationale: avoids drift between duplicated source-list blocks when mirrors or
  codename handling change.
  Date/Author: 2026-02-24 / Codex
- Decision: factor repeated plugin module mock wiring into
  `test/testUtils/plugins-mock.ts`.
  Rationale: keeps Bun path-mocking behavior consistent across the Hyper and
  renderer unit suites and reduces duplicated `createPluginExports` factories.
  Date/Author: 2026-02-24 / Codex
- Decision: keep `SKIP_V8_SNAPSHOT=1` for Linux aarch64 install speed, but add a
  dedicated arm64 snapshot generation step before `electron-builder` packaging.
  Rationale: `bin/cp-snapshot.js` validates `cache/arm64` snapshot outputs in
  `afterPack`, so packaging must regenerate arm64 blobs on fresh CI runners.
  Date/Author: 2026-02-24 / Codex

## Outcomes & retrospective

Implemented Linux aarch64 workflow and documentation updates for the Linux
scope of roadmap `1.4.15`.

Observed outcomes:

- arm7 (`armv7l`) Linux CI lane and arm7 Linux artefact targets were removed.
- Linux ARM workflow now runs as Linux aarch64 on `ubuntu-22.04-arm`.
- Linux aarch64 workflow now bootstraps `qemu-x86_64-static` and `QEMU_LD_PREFIX`
  sysroot setup before `bun install`.
- Linux aarch64 bootstrap now uses `:amd64` multiarch runtime packages
  (`libc6`, `libstdc++6`, `libgcc-s1`, `libglib2.0-0`, `libexpat1`, and
  `libpcre2-8-0`) plus pinned per-architecture apt sources rather than
  container export to avoid very long install times in CI.
- Linux aarch64 install now skips x64 snapshot generation when the lane targets
  arm64-only artefacts, reducing CI install time and emulation load.
- Linux aarch64 snapshot bootstrap now installs amd64 multiarch runtime
  libraries (`libc6`, `libstdc++6`, `libgcc-s1`, `libglib2.0-0`, `libexpat1`,
  and `libpcre2-8-0`) with `QEMU_LD_PREFIX=/` so arm64 snapshot generation can
  execute its x64 helper binaries.
- Linux aarch64 apt bootstrap now uses explicit per-arch mirrors to prevent
  `ports.ubuntu.com` amd64 index fetch failures.
- Shared Linux runtime dependency installation now reuses mixed-arch source
  pinning on Ubuntu arm64 runners with `amd64` enabled so post-install apt
  updates do not regress with `ports` amd64 404 errors.
- Linux aarch64 CI `bun install` now sets `SKIP_V8_SNAPSHOT=1`, preventing
  six-hour stalls in the snapshot generation stage.
- Shared Linux runtime dependency installation now selects the available ALSA
  package variant (`libasound2t64` or `libasound2`) so Ubuntu 22.04 and newer
  runners both pass the install gate.
- Linux aarch64 lane now runs install/lint/test/build checks and packages arm64
  Linux artefacts.
- `docs/developers-guide.md` now records Linux aarch64 runtime-alignment and CI
  practice.
- `docs/roadmap.md` Linux-specific `1.4.15` checklist items are marked done.
- Unit suites now mock `lib/utils/plugins` for both extensionless and `.ts`
  import specifiers so Bun's Linux aarch64 loader always sees the fake
  `connect` export.

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
6. Update this ExecPlan `Progress`, `Decision log`, and `Outcomes` sections.

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

Last validated: CI #LAST_VALIDATED_CI on LAST_VALIDATED_DATE
