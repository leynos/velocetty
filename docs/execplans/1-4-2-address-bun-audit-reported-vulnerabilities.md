# Address bun audit-reported vulnerabilities for roadmap item 1.4.2

This Execution Plan (ExecPlan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE

No `PLANS.md` exists at repository root as of 2026-02-22, so this plan is the
operating contract for this task.

## Purpose / big picture

Deliver roadmap task `1.4.2` in `docs/roadmap.md` by ensuring `bun audit`
reports no `critical`, `high`, or `moderate` vulnerabilities, then proving the
repository still passes the requested quality gates:
`bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.
Success is observable when those commands pass, `docs/developers-guide.md`
documents any development-practice changes introduced by this remediation, and
roadmap item `1.4.2` is marked done (`[x]`).

## Context and orientation

This work sits within roadmap section `1.4` ("Quality gates and supply-chain
hygiene"). Task `1.4.2` is currently unchecked and explicitly requires
`bun audit` to show no `critical`, `high`, or `medium` vulnerabilities.

Project guidance relevant to this implementation:

- `velocetty-product-requirements-document.md` describes Workstream 0 as
  quality-gate first, with lint/build/test reliability as a baseline contract.
- `velocetty-design.md` places trust and verification at backend boundaries for
  distribution and plugin flows, reinforcing supply-chain hardening goals.
- `velocetty-hyper-codebase.md` states dependency policy and records audit
  scanning as part of supply-chain risk control.
- `docs/developers-guide.md` is the primary location for developer-practice
  updates, including command expectations and local validation flow.

Current command wiring:

- `Makefile` defines `build`, `check-fmt`, `lint`, and `test` as canonical
  project gates.
- `package.json` includes `scripts.audit` (`bun scripts/run-audit.mjs`), but
  roadmap `1.4.2` is anchored on `bun audit` output.
- `bun audit` supports `--json`, `--audit-level=<level>`, and `--ignore=<id>`.

## Constraints

- Use Bun and Makefile workflows as repository-standard entry points.
- Keep gate command names stable; do not rename or remove required Make targets
  during this task.
- Treat roadmap language as authoritative: completion requires no
  `critical`/`high`/`moderate` vulnerabilities.
- Do not mark roadmap task `1.4.2` done before all required gates pass.
- Update `docs/developers-guide.md` only for real, persistent practice changes
  discovered during implementation.
- Keep documentation wrapped at 80 columns and code blocks wrapped at
  120 columns.

## Tolerances (exception triggers)

- Scope: if remediation requires changes in more than 20 files or more than
  1000 net lines, stop and escalate.
- Dependency churn: if more than 10 direct dependency version bumps are needed,
  stop and escalate with a phased proposal.
- Unpatched findings: if any `critical`/`high`/`moderate` finding has no
  available patched version or safe mitigation, stop and escalate with options.
- Behaviour drift: if dependency updates change runtime behaviour in ways that
  require product-level decisions, stop and escalate.
- Validation: if a required gate fails after two focused remediation passes,
  stop and escalate with log evidence.

## Risks

- Risk: transitive vulnerabilities may require direct dependency upgrades with
  cascading API changes.
  Severity: high
  Likelihood: medium
  Mitigation: remediate in small batches, run gates after each batch, and keep
  version changes minimal.

- Risk: a vulnerable package may be unmaintained, forcing replacement.
  Severity: high
  Likelihood: medium
  Mitigation: prioritize drop-in replacements, preserve interfaces, and record
  rationale in `Decision Log`.

- Risk: audit output may differ between lockfile states and CI/local platforms.
  Severity: medium
  Likelihood: medium
  Mitigation: pin to branch lockfile state, run `bun install` first, and log
  exact commands and output files.

- Risk: new developer obligations may be undocumented, causing regression.
  Severity: medium
  Likelihood: high
  Mitigation: update `docs/developers-guide.md` in the same change set as the
  remediation.

## Agent team model

Implementation will use a small agent team with explicit ownership:

1. Audit and triage agent:
   owns vulnerability inventory generation, grouping by severity and package,
   and proposing minimal remediation order.
2. Remediation agent:
   owns dependency updates, lockfile refreshes, and any required code updates
   caused by version bumps.
3. Docs and roadmap agent:
   owns `docs/developers-guide.md` practice updates and roadmap status update
   for item `1.4.2` after successful validation.
4. Coordinator agent (this session):
   sequences work, enforces tolerances, runs required gates, and records
   evidence and decisions in this ExecPlan.

## Progress

- [x] (2026-02-22) Confirmed branch
  `1-4-2-address-bun-audit-reported-vulnerabilities` and gathered command
  wiring context (`Makefile`, `package.json`, `bun audit` options).
- [x] (2026-02-22) Collected roadmap, design, hyper-codebase, and
  developers-guide context with an agent team.
- [x] (2026-02-22) Drafted this ExecPlan at the user-requested path.
- [x] (2026-02-22) Received explicit approval and began implementation.
- [x] (2026-02-22) Ran `bun install` and captured baseline logs.
- [x] (2026-02-22) Captured baseline `bun audit` output and triaged
  `critical`/`high`/`moderate` findings.
- [x] (2026-02-22) Remediated vulnerabilities via direct dependency updates,
  stable-script fixes, and transitive override pins.
- [x] (2026-02-22) Updated `docs/developers-guide.md` with explicit
  vulnerability-auditing practice.
- [x] (2026-02-22) Ran required validation gates successfully:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.
- [x] (2026-02-22) Marked roadmap item `1.4.2` as done and finalized this
  ExecPlan.

## Surprises & Discoveries

- Observation: there is no task-specific template in the execplans skill
  subtree for this task path; only the general `execplans` guidance exists.
  Impact: this plan is built from repository context and the task request.

- Observation: `package.json` already includes `scripts.audit`, but roadmap
  completion wording is tied to direct `bun audit` results.
  Impact: implementation will treat `bun audit` as the source-of-truth command
  and may keep `scripts.audit` as supplementary automation.

- Observation: moving directly to `electron-builder` `26.8.1` introduced a
  build regression in the Linux packaging step (`fpm` spawn `ENOENT`) and a
  schema shift for Windows timestamp configuration.
  Impact: kept the repository on the known-stable `electron-builder` major
  line and applied targeted security overrides instead of forcing a toolchain
  migration inside this roadmap task.

## Decision Log

- Decision: treat this as plan drafting only until explicit user approval.
  Rationale: ExecPlan approval gate requires user confirmation before code or
  dependency changes.
  Date/Author: 2026-02-22 / Codex.

- Decision: define an explicit multi-agent implementation model in the plan.
  Rationale: user requested an agent team for planning and implementation.
  Date/Author: 2026-02-22 / Codex.

- Decision: switch script invocations from
  `node_modules/cross-env/src/bin/cross-env.js` to `bunx cross-env`.
  Rationale: dependency updates surfaced path fragility in `cross-env`; `bunx`
  keeps invocation stable across package layout changes.
  Date/Author: 2026-02-22 / Codex.

- Decision: satisfy vulnerability goals using direct version bumps plus
  explicit transitive overrides.
  Rationale: this cleared all audit findings while preserving the existing
  build and packaging behaviour expected by current release automation.
  Date/Author: 2026-02-22 / Codex.

- Decision: revert `electron-builder` and rebuild tooling to stable majors
  after validating that the newer major line broke `make build`.
  Rationale: roadmap task `1.4.2` targets vulnerability remediation, not a
  packaging stack migration; stability took precedence once security goals were
  met.
  Date/Author: 2026-02-22 / Codex.

## Plan of work

Stage A: Baseline and audit inventory.
Run `bun install` first to establish a consistent lockfile/install state, then
run `bun audit` in both human-readable and machine-friendly form to capture
exact affected packages and advisory identifiers.

Stage B: Remediation strategy and execution.
Resolve vulnerabilities from highest severity to lowest within the required
threshold (`critical`, `high`, `moderate`). Prefer smallest viable version
updates. Where no patch exists, attempt package replacement or safe removal.
If neither is possible, trigger escalation under tolerances.

Stage C: Developer-practice documentation.
Update `docs/developers-guide.md` with any new lasting practice introduced by
this work (for example, when to run audit commands, accepted invocation path,
and any new pre-merge expectation).

Stage D: Full gate validation and roadmap completion.
Run requested gates in required order, ensure all pass, then update
`docs/roadmap.md` item `1.4.2` from `[ ]` to `[x]` and mark this ExecPlan
`COMPLETE`.

## Concrete implementation steps

1. Capture baseline state and logs.

    set -o pipefail
    bun install |& tee /tmp/install-velocetty-$(git branch --show).out

2. Generate audit reports.

    bun audit |& tee /tmp/audit-velocetty-$(git branch --show).out
    bun audit --json --audit-level=moderate \
      |& tee /tmp/audit-json-velocetty-$(git branch --show).out

3. Build a remediation queue from audit findings.
   Group by package and fixed-version availability, then apply minimal updates
   needed to clear `critical`/`high`/`moderate` findings.

4. Re-run audit after each remediation batch.

    bun audit --audit-level=moderate \
      |& tee /tmp/audit-recheck-velocetty-$(git branch --show).out

5. Update docs and roadmap only after successful remediation and validation.
   - `docs/developers-guide.md`: record any new persistent audit/dependency
     hygiene practice.
   - `docs/roadmap.md`: mark task `1.4.2` done (`[x]`) only after all gates
     below pass.

6. Run required gates in user-requested order and capture logs.

    bun install |& tee /tmp/install-final-velocetty-$(git branch --show).out
    make build |& tee /tmp/build-velocetty-$(git branch --show).out
    make check-fmt |& tee /tmp/check-fmt-velocetty-$(git branch --show).out
    make lint |& tee /tmp/lint-velocetty-$(git branch --show).out
    make test |& tee /tmp/test-velocetty-$(git branch --show).out

7. Final verification summary in this ExecPlan.
   Record gate outcomes, residual risks (if any), and completion timestamp.

## Validation and acceptance

Acceptance criteria for roadmap task `1.4.2`:

- `bun audit --audit-level=moderate` reports no vulnerabilities.
- Required command sequence succeeds:
  `bun install`, `make build`, `make check-fmt`, `make lint`, `make test`.
- `docs/developers-guide.md` reflects any development-practice deltas introduced
  by vulnerability remediation.
- `docs/roadmap.md` marks item `1.4.2` as done (`[x]`).
- This ExecPlan is updated to `Status: COMPLETE` with recorded evidence.

## Idempotence and recovery

The steps above are safe to re-run. If a gate fails:

1. Fix only the reported issue set for that gate.
2. Re-run the failing command and refresh its `/tmp` log.
3. If failure repeats twice for the same root cause, stop and escalate per
   `Tolerances`.

If `bun audit` output changes unexpectedly between runs, re-run `bun install`,
then regenerate the audit baseline before applying further updates.

## Outcomes & Retrospective

Roadmap task `1.4.2` is complete. `bun audit` now reports zero vulnerabilities
at all severities in this branch, and the required gates succeed.

Validated commands:

- `bun install`
- `bun audit`
- `bun audit --audit-level=moderate`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Key implementation outcomes:

- Updated direct dependency ranges for vulnerable packages, including
  `playwright`, `ajv`, `lodash`, `react-use`, `typescript-json-schema`,
  `cpy-cli`, `cross-env`, `electronmon`, and `inquirer`.
- Added targeted `overrides` entries in `package.json` for vulnerable
  transitive packages (`cross-spawn`, `tar`, `minimatch`, `micromatch`,
  `braces`, `ejs`, `js-yaml`, `diff`, `tmp`, and related risk packages).
- Hardened script execution by switching to `bunx cross-env` across build/test
  script entries.
- Updated `docs/developers-guide.md` with vulnerability-audit practice and
  command expectations.
- Updated `docs/roadmap.md` item `1.4.2` from `[ ]` to `[x]`.

## Revision note

Initial draft created on 2026-02-22.
Implementation completed on 2026-02-22.
