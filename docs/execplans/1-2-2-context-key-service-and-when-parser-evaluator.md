# Implement context key service and `when` parser/evaluator (roadmap 1.2.2)

## Module header

- Purpose: deliver roadmap item `1.2.2` by implementing a typed context key
  service plus deterministic `when` expression parsing and evaluation.
- Invariants: keep grammar intentionally small (`&&`, `||`, `!`,
  `==`, `!=`, `<`, `<=`, `>`, `>=`, grouping), avoid new dependencies,
  and keep behaviour deterministic across runs.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`, and
  `docs/developers-guide.md`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & discoveries`, `Decision log`, and
`Outcomes & retrospective` must be kept up to date as work proceeds.

Status: COMPLETE (2026-02-19)

No `PLANS.md` exists at repository root as of 2026-02-19, so this plan is
self-contained.

## Purpose / big picture

Roadmap item `1.2.2` is the foundation for context-aware keybinding resolution
and command enablement. The design requires explicit context keys,
`when` expressions parsed into an AST, and deterministic evaluation against a
key/value map. Without this milestone, downstream roadmap items that depend on
`when` semantics remain blocked.

After this work:

- `when` expressions are parsed once into a typed AST with logical operators,
  comparisons, literals, and grouping.
- Evaluations run against a typed context-key map (`boolean | string | number |
  null`) with deterministic outcomes.
- Unit tests prove operator handling, precedence/grouping, comparison semantics,
  parse failures, and repeated-run determinism.

## Constraints

- Implement context key and `when` parser/evaluator contracts in `shared/` and
  runtime service behaviour in `lib/` so frontend/backend milestones can reuse
  the same shared types.
- Preserve existing command registry behaviour from `lib/command-registry.ts`;
  this milestone adds context-key primitives but does not rewire dispatcher
  execution paths.
- Keep grammar and evaluator scope limited to design requirements in
  `docs/velocetty-design.md` §Context keys and “when” expressions.
- Do not add third-party parser/evaluator dependencies.
- Add or update development-practice guidance in `docs/developers-guide.md`.
- Mark roadmap item `1.2.2` done only after required gates pass:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Tolerances (exception triggers)

- Scope: if implementation exceeds 12 files or 700 net changed lines, stop and
  escalate.
- Interface: if implementing this milestone requires changing existing
  plugin-facing command contracts, stop and escalate.
- Grammar: if design requirements require operators beyond the documented set,
  stop and escalate.
- Dependencies: if parser/evaluator implementation appears to require new
  dependencies, stop and escalate.
- Validation: if required gates fail after two focused remediation passes, stop
  and escalate with logs.

## Risks

- Risk: ambiguous truthiness rules for typed context values could create
  surprises in downstream keybinding resolution.
  Severity: high
  Likelihood: medium
  Mitigation: encode explicit evaluation rules in code and assert them via
  unit tests.

- Risk: parser precedence bugs could produce non-obvious mismatches from design
  examples.
  Severity: high
  Likelihood: medium
  Mitigation: include precedence/grouping tests and deterministic parse-shape
  assertions.

- Risk: parse errors could be too opaque for future keybinding diagnostics.
  Severity: medium
  Likelihood: medium
  Mitigation: return parse errors with stable index details and assert their
  shape in tests.

## Progress

- [x] (2026-02-19 18:55Z) Confirmed roadmap `1.2.2` scope and success criteria
  in `docs/roadmap.md`.
- [x] (2026-02-19 18:55Z) Collected design and PRD constraints for context keys
  and `when` expressions.
- [x] (2026-02-19 18:55Z) Audited current command registry and test patterns in
  `lib/command-registry.ts` and `test/unit/command-registry.test.ts`.
- [x] (2026-02-19 18:55Z) Created this living ExecPlan file.
- [x] (2026-02-19 19:01Z) Implemented shared context-key and `when` AST types
  in `shared/src/types/context-keys.ts` and exported them in
  `shared/src/index.ts`.
- [x] (2026-02-19 19:04Z) Implemented parser/evaluator/context-key service
  runtime modules in `lib/context-key-parser.ts`,
  `lib/context-key-evaluator.ts`, and `lib/context-key-service.ts`.
- [x] (2026-02-19 19:05Z) Added unit coverage in
  `test/unit/context-key-service.test.ts` for operators, precedence/grouping,
  parse failure indices, and deterministic repeated evaluation.
- [x] (2026-02-19 19:06Z) Updated `docs/developers-guide.md` with context-key
  and `when` development practice.
- [x] (2026-02-19 19:06Z) Marked roadmap item `1.2.2` done in
  `docs/roadmap.md`.
- [x] (2026-02-19 19:08Z) Ran required gates successfully:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Surprises & discoveries

- `shared/src/types/commands.ts` already includes `defaultWhen?: string`, so
  `when` support should align with existing command metadata contracts rather
  than introducing a parallel `when` model.
- Existing deterministic behaviour patterns already exist in
  `lib/command-registry.ts` (`list()` lexical ordering and cache maps), which
  provide a baseline for evaluator determinism expectations.
- `bun install` and `make build` generated untracked `shared/src/*.js`,
  `shared/src/*.js.map`, and `shared/src/*.d.ts` artefacts; these needed to be
  removed before format checks to keep gate scope clean.
- Initial parser/service implementation exceeded the repository file-size guard
  (>400 lines in one file), so parser and evaluator logic were split into
  separate modules before final gating.

## Decision log

- Decision: implement a small recursive-descent parser in-repo instead of adding
  an external parsing dependency.
  Rationale: grammar is intentionally minimal and dependency-free parsing keeps
  behaviour explicit and testable.
  Date/Author: 2026-02-19 / Codex

- Decision: expose shared AST/value types under `shared/src/types/` and keep
  runtime service logic in `lib/`.
  Rationale: this preserves package-boundary direction and future reuse by both
  frontend and backend command/keybinding engines.
  Date/Author: 2026-02-19 / Codex

- Decision: split parser and evaluator into `lib/context-key-parser.ts` and
  `lib/context-key-evaluator.ts`, keeping `lib/context-key-service.ts` as the
  runtime service wrapper and public export surface.
  Rationale: satisfies the repository guard that no single code file exceeds
  400 lines while preserving readability and testability.
  Date/Author: 2026-02-19 / Codex

## Outcomes & retrospective

Implementation is complete. Outcomes:

- Added shared context-key and `when` expression contracts in
  `shared/src/types/context-keys.ts`.
- Added deterministic parser and compiler support in
  `lib/context-key-parser.ts`.
- Added deterministic typed evaluator support in
  `lib/context-key-evaluator.ts`.
- Added context-key service runtime API and public exports in
  `lib/context-key-service.ts` and `lib/context-key-expression.ts`.
- Added unit coverage for grammar, precedence, comparisons, parse diagnostics,
  and determinism in `test/unit/context-key-service.test.ts`.
- Updated `docs/developers-guide.md` with a dedicated
  `Context key and when practice` section.
- Marked roadmap item `1.2.2` and all sub-items complete in `docs/roadmap.md`.

Retrospective:

- Deterministic behaviour is easiest to guarantee when parser output is frozen
  and service snapshots are sorted lexically.
- Build/install flows can emit untracked shared-package artefacts; clean-up
  before format gates is required to avoid unrelated churn.

## Plan of work

Stage A: shared contracts.

Introduce shared context-key and `when` AST contracts in `shared/`, then export
those contracts from `shared/src/index.ts`.

Stage B: parser, evaluator, and service.

Implement a deterministic runtime module in `lib/` that parses `when`
expressions to AST, evaluates AST nodes against typed context values, and
provides a context key service API for setting/clearing values plus evaluating
compiled expressions.

Stage C: test coverage.

Add a new unit test suite proving:

- every supported operator evaluates correctly,
- precedence and grouping match grammar expectations,
- type-aware comparisons behave deterministically,
- invalid expressions produce stable parse errors,
- repeated evaluation across runs and key-order permutations returns identical
  results.

Stage D: docs and roadmap closure.

Update `docs/developers-guide.md` with context-key/`when` development practice,
mark roadmap item `1.2.2` done, and run all required gates before completion.

## Verification

Run and review logs for:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Success criteria:

- required commands complete successfully,
- unit tests include deterministic `when` parser/evaluator coverage,
- roadmap `1.2.2` and its sub-items are marked done,
- developers guide reflects the new context-key service practice.
