# Architectural decision record (ADR) 001: Replace AVA with Bun test runner

## Status

Accepted (Option B: Migrate to Bun test runner).

## Date

2026-01-28.

## Context and Problem Statement

The repository currently uses AVA for unit tests and a Bun bridge test to
invoke the AVA suite. This layering adds runtime and tooling dependencies,
slows the feedback loop, and complicates test configuration. The project goal
is to reduce dev dependencies and speed up builds. Bun already ships with a
built-in test runner, so a decision is required on whether to replace AVA with Bun
`test`.[^bun-test]

## Decision Drivers

- Reduce the number of dev dependencies and the amount of setup glue.
- Improve test execution speed and developer feedback cycles.
- Keep TypeScript and JSX test authoring straightforward.[^bun-test]
- Preserve essential test features such as snapshots, DOM helpers, and
  lifecycle hooks.[^bun-test]

## Requirements

### Functional requirements

- Run unit and UI test suites under a single primary runner.
- Keep snapshots, DOM helpers, and lifecycle hooks available.
- Preserve TypeScript and JSX test authoring.

### Technical requirements

- Reduce dev dependency count and test setup overhead.
- Support reliable execution in Continuous Integration (CI).
- Align with the Bun-first tooling strategy.

## Options Considered

### Option A: Keep AVA as the primary test runner

AVA provides process isolation and concurrent execution, which can be valuable
for atomic tests and CPU-bound workloads.[^ava-docs] However, it adds extra
dependencies and duplicates capabilities already present in Bun's built-in
runner.[^bun-test]

### Option B: Migrate to Bun's built-in test runner

Bun's test runner supports TypeScript and JSX, lifecycle hooks, snapshot
support, DOM testing, watch mode, and script preloading.[^bun-test] Bun also
includes built-in coverage reporting.[^bun-coverage] Bun aims for Jest
compatibility, but not everything is implemented.[^bun-test]

### Option C: Hybrid model (AVA for legacy tests, Bun for new tests)

This reduces immediate migration risk but preserves duplicate tooling. It also
creates ambiguity about preferred test APIs and increases maintenance
overhead.

| Topic | AVA | Bun test |
| --- | --- | --- |
| Concurrency and isolation | Runs files in separate processes[^ava-docs] | Single-process runner[^bun-test] |
| TypeScript and JSX | Supported (via tooling) | Supported out of the box[^bun-test] |
| Snapshots | Supported | Supported[^bun-test] |
| Coverage | External tooling | Built-in coverage reporting[^bun-coverage] |
| Dependency footprint | AVA + tooling | Bun runtime only |

_Table 1: Comparison of AVA and Bun test runner capabilities._

## Decision Outcome / Proposed Direction

Adopt Bun's built-in test runner as the primary test harness and remove AVA
once the suite is migrated. The rationale is to align with the project's goal
of fewer dependencies and faster builds while using features already bundled
with Bun.[^bun-test]

## Goals and Non-Goals

### Goals

- Consolidate on a single test runtime and reduce dev dependencies.
- Maintain or improve test feedback latency.
- Keep TypeScript and JSX test authoring intact.

### Non-Goals

- Rewriting test logic that is already compatible with Bun.
- Introducing a new test framework beyond Bun.

## Migration Plan

### Phase 1: Readiness audit

- Inventory AVA-specific features (serial tests, macros, hooks, snapshots).
- Map AVA idioms to Bun equivalents and document gaps.

### Phase 2: Dual-run validation

- Convert representative suites to Bun and run both runners in CI.
- Establish parity for snapshots and DOM tests.

### Phase 3: Full migration

- Convert remaining tests and remove AVA and related glue scripts.
- Update documentation and CI scripts to call `bun test` only.

## Known Risks and Limitations

- Bun's Jest compatibility is not complete, which may require small refactors
  or test harness adjustments.[^bun-test]
- Migration may surface reliance on AVA's process isolation semantics.

## Outstanding Decisions

- Whether any AVA-specific patterns should be rewritten or retained as
  compatibility shims.
- Whether to add Bun coverage thresholds in `bunfig.toml`.

## Architectural Rationale

This direction reduces toolchain duplication, aligns with the project's
Bun-first approach, and supports faster iteration while retaining core test
capabilities.[^bun-test]

[^bun-test]: <https://bun.com/docs/test>
[^bun-coverage]: <https://bun.com/docs/test/coverage>
[^ava-docs]: <https://www.npmjs.com/package/ava/v/1.0.0-rc.1>
