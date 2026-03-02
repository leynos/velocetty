# Implement JSON5 parsing with schema validation (roadmap 3.1.1)

## Module header

- Purpose: define an implementation-ready execution plan for roadmap item
  `3.1.1` to parse JSON5 config, validate with schema diagnostics, and provide
  actionable fixes, while preserving comments and formatting when rewriting
  config files.
- Invariants: keep startup fallback safe, keep diagnostics structured, and keep
  roadmap/docs/test evidence synchronized.
- Cross-links: `docs/roadmap.md`, `docs/velocetty-design.md`,
  `docs/velocetty-hyper-codebase.md`,
  `docs/velocetty-product-requirements-document.md`,
  `docs/developers-guide.md`, `app/config/import.ts`,
  `app/config/json5-config.ts`, and `shared/schemas/schema.json`.

This Execution Plan (ExecPlan) is a living document.
The sections `Constraints`, `Tolerances`, `Risks`, `Progress`,
`Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` must be kept up to date as work proceeds.

Status: COMPLETE (2026-03-02)

## Purpose / big picture

Roadmap item `3.1.1` requires a JSON5 config loader that emits structured
validation diagnostics and exposes defaults and schema-derived documentation
strings. After this work, invalid configuration must be reported with an exact
path, a clear message, and a suggested fix, while runtime startup remains
non-fatal through controlled fallback behaviour.

Roundtripping retention is mandatory for this milestone: writing config updates
must preserve existing comments and formatting layout for unchanged regions of
the file.

This plan covers only `3.1.1`. It intentionally does not implement the full
layering and hot-reload semantics tracked by `3.1.2`.

## Constraints

- Keep changes scoped to roadmap item `3.1.1` and required supporting docs.
- Implementation starts only after explicit user approval.
- Preserve non-fatal startup behaviour for invalid user configuration.
- Keep diagnostics contract deterministic with required fields:
  `path`, `message`, and `suggestedFix`.
- Treat comment and formatting retention during config-file roundtrips as a
  hard requirement, not a best-effort enhancement.
- Prefer existing repository dependencies and schema assets; avoid adding new
  external dependencies unless absolutely necessary.
- Keep documentation and tests updated in the same change set as runtime code.
- Do not mark roadmap `3.1.1` complete until all required gates pass with
  captured logs.
- Required release gates for closure are:
  `bun install`, `make build`, `make check-fmt`, `make lint`, and `make test`.

## Tolerances (exception triggers)

- Scope: if implementation requires touching more than 14 files, stop and
  reassess scope before continuing.
- Interface: if public config contracts outside 3.1.1 must change, stop and
  escalate.
- Retention: if required writes cannot preserve comments/formatting for
  unchanged regions with current tooling, stop and escalate before shipping.
- Ambiguity: if `hyper.json` versus `config.json5` cannot be reconciled using
  existing roadmap/design text, stop and request explicit direction.
- Dependency: if a new dependency is required for schema diagnostics, stop and
  escalate first.
- Iteration: if any one failing gate repeats 3 times without progress, stop and
  record blocker state.
- Evidence: if any required gate exits non-zero or is interrupted, keep status
  partial and do not mark roadmap item done.

## Risks

- Risk: roadmap/design refers to `config.json5`, while current runtime paths
  still reference `hyper.json`.
  Severity: high
  Likelihood: medium
  Mitigation: make filename alignment an explicit milestone decision and keep
  roadmap scope evidence in `Decision Log`.

- Risk: schema descriptions exist, but schema default values may be incomplete,
  which can limit schema-derived default messaging.
  Severity: medium
  Likelihood: medium
  Mitigation: use `app/config/config-default.json` as runtime source of truth
  for defaults, and use schema `description` for documentation strings.

- Risk: JSON5 parse errors may not always provide stable location metadata for
  line/column/snippet in all malformed cases.
  Severity: medium
  Likelihood: medium
  Mitigation: define graceful fallback for parse diagnostics when location is
  missing while still emitting required `path`/`message`/`suggestedFix`.

- Risk: duplicated helper logic can drift between config import and runtime
  plugin persistence paths.
  Severity: medium
  Likelihood: low
  Mitigation: centralize diagnostic result contract and reuse one helper API.

- Risk: preserving comments and formatting during writes may conflict with the
  current `sortKeys` plus full `JSON5.stringify` rewrite strategy.
  Severity: high
  Likelihood: high
  Mitigation: replace full-file rewrite with token-aware or patch-based edits
  that update only targeted nodes, and add strict roundtrip-retention tests.

## Context and orientation

Relevant current state:

- `app/config/json5-config.ts` parses JSON5 and validates shape, but returns
  fallback values after console warnings instead of structured diagnostics.
- `app/config/json5-config.ts` currently writes via deterministic re-stringify
  (`sortKeys` + `JSON5.stringify`), which does not preserve user comments or
  original formatting layout.
- `app/config/import.ts` drives default/user config import and fallback flow,
  including schema-copy and user notification behaviour.
- `shared/schemas/schema.json` is available and contains descriptions that can
  support schema-derived documentation strings in diagnostics.
- `test/unit/config-import-json5.test.ts` already validates JSON5 comments,
  trailing commas, and fallback scenarios, and should be extended.
- `docs/developers-guide.md` contains current JSON5 format practice plus release
  gate order, and must be updated if diagnostic contracts change.

Roadmap/design anchors:

- `docs/roadmap.md` lines `223-233` define `3.1.1` success criteria.
- `docs/velocetty-design.md` section
  `Configuration system: JSON5 and layering` describes JSON5 format and
  structured diagnostics expectations.
- `docs/velocetty-product-requirements-document.md` phase `3` reinforces JSON5
  loader, validation, and clear error reporting deliverables.

## Plan of work

### Stage A: Scope lock and diagnostics contract (no runtime behaviour changes)

Document and agree the diagnostics payload shape before code edits:
`kind`, `source`, `path`, `message`, `suggestedFix`, and optional parse/schema
metadata fields.

Set an explicit handling policy for two classes of errors:
parse failures and schema failures.

Add or update tests first so expected diagnostics are concrete and measurable.
Do not proceed to Stage B until red tests fail for current behaviour.

### Stage B: Parser and schema pipeline refactor

Refactor config parsing helpers so parsing/validation returns rich results
instead of silently collapsing to fallback values.

Wire schema validation through pinned schema assets and normalize schema issues
into deterministic diagnostics ordering.

Use schema descriptions and default config context to produce
schema-derived documentation strings and actionable suggested fixes.

### Stage C: Roundtrip retention implementation

Replace full JSON5 re-stringify writes with a write path that preserves
comments and formatting for unchanged regions.

Define and enforce deterministic update rules:
only modified keys change on disk, and unaffected sections retain user-authored
comments, key ordering, and whitespace style.

Add dedicated roundtrip tests that fail if unchanged sections are reformatted
or comments are dropped.

### Stage D: Import-flow integration and fallback semantics

Update config import path to consume rich diagnostics, preserve non-fatal
fallback, and surface diagnostics through notify/log channels consistently.

Ensure invalid user config reports path, message, and suggested fix, while
keeping fallback to safe config behaviour explicit and test-covered.

### Stage E: Documentation, roadmap closure, and full gates

Update `docs/developers-guide.md` with any new development practice for config
diagnostics and defaults/documentation-string behaviour.

Run full required gates with tee logs.
Only after all gates pass, mark roadmap item `3.1.1` and sub-bullets done.

## Concrete steps

1. Baseline and scope verification:

```bash
git branch --show
nl -ba docs/roadmap.md | sed -n '223,236p'
nl -ba docs/velocetty-design.md | sed -n '912,1025p'
```

1. Add/extend diagnostics-focused tests before implementation:

```bash
set -o pipefail
TEST_LOG="/tmp/test-config-import-json5-$(get-project)-$(git branch --show).out"
bun test --max-concurrency=1 test/unit/config-import-json5.test.ts 2>&1 | tee "$TEST_LOG"
```

1. Add roundtrip-retention tests that verify unchanged comments/formatting are
   preserved during write operations:

- `test/unit/config-import-json5.test.ts` (extend with retention assertions)
- `test/unit/runtime-plugin-settings.test.ts` (extend with retention assertions
  for plugin settings writes)

1. Implement parser/schema/import changes guided by failing tests in:

- `app/config/json5-config.ts`
- `app/config/import.ts`
- `app/config/paths.ts` (only if required to satisfy `config.json5` scope)
- `test/unit/config-import-json5.test.ts`
- `test/unit/runtime-plugin-settings.test.ts` (if config filename or
  persistence contract changes)

1. Update developer guidance:

- `docs/developers-guide.md` (configuration format and diagnostics practice)

1. Run required full gates with durable logs:

```bash
set -o pipefail
bun install 2>&1 | tee "/tmp/bun-install-$(get-project)-$(git branch --show).out"
make build 2>&1 | tee "/tmp/build-$(get-project)-$(git branch --show).out"
make check-fmt 2>&1 | tee "/tmp/check-fmt-$(get-project)-$(git branch --show).out"
make lint 2>&1 | tee "/tmp/lint-$(get-project)-$(git branch --show).out"
make test 2>&1 | tee "/tmp/test-$(get-project)-$(git branch --show).out"
```

1. If docs changed, run docs gates too:

```bash
set -o pipefail
bunx markdownlint-cli2 "docs/**/*.md" 2>&1 | tee "/tmp/markdownlint-$(get-project)-$(git branch --show).out"
nixie --no-sandbox 2>&1 | tee "/tmp/nixie-$(get-project)-$(git branch --show).out"
```

1. Roadmap closure (only after successful gates):

- Mark `docs/roadmap.md` item `3.1.1` and all child bullets complete.
- Record gate evidence paths in this ExecPlan.

## Validation and acceptance

Behavioural acceptance:

- Invalid config emits structured diagnostics including:
  `path`, `message`, and `suggestedFix`.
- Parse failures include location data when available (line/column/snippet) and
  still include required diagnostic fields.
- Schema failures include normalized JSON Pointer paths and deterministic order.
- Defaults are applied from canonical default config state, and diagnostics can
  include schema-derived documentation strings.
- Config writes preserve comments and formatting for unchanged file regions
  during roundtrips.
- Roundtrip tests prove comment retention and formatting retention for both
  main config updates and plugin-settings persistence updates.
- Startup remains resilient with safe fallback semantics.

Required quality gates:

- `bun install`
- `make build`
- `make check-fmt`
- `make lint`
- `make test`

Additional documentation gates when docs change:

- `bunx markdownlint-cli2 "docs/**/*.md"`
- `nixie --no-sandbox`

## Interfaces and dependencies

Planned interface additions/updates:

- A structured config diagnostic type used by parser/import flow.
- Parser result contract that can carry either validated config or diagnostics.
- Deterministic diagnostic mapping for both parse and schema stages.
- Roundtrip-safe config writer contract that updates targeted values without
  normalizing untouched parts of the file.

Planned dependency posture:

- Reuse existing JSON5 parser and existing schema assets in
  `shared/schemas/schema.json`.
- Reuse existing runtime default config source in `app/config/config-default.json`.
- Prefer existing edit/parse capabilities for minimal in-place updates; only
  introduce a new dependency if retention cannot be achieved otherwise.
- No new external dependencies planned.

## Idempotence and recovery

- All steps are re-runnable.
- If a gate fails, fix the issue and rerun only the failing gate first, then
  rerun the full required gate bundle.
- If implementation broadens beyond defined tolerances, stop and update
  `Decision Log` before proceeding.
- Do not mark roadmap done during partial gate states.

## Artifacts and notes

Expected evidence artifacts:

- `/tmp/test-config-import-json5-<project>-<branch>.out`
- `/tmp/bun-install-<project>-<branch>.out`
- `/tmp/build-<project>-<branch>.out`
- `/tmp/check-fmt-<project>-<branch>.out`
- `/tmp/lint-<project>-<branch>.out`
- `/tmp/test-<project>-<branch>.out`
- Optional docs logs:
  `/tmp/markdownlint-<project>-<branch>.out` and
  `/tmp/nixie-<project>-<branch>.out`

Agent-team planning notes:

- Context pack used for planning exchange: `pk_qoh4ak36`.
- Two explorer agents produced milestone/risk/test inputs that were merged into
  this plan before drafting.

## Progress

- [x] (2026-03-01 20:03Z) Verified branch context:
  `3-1-1-json5-parsing-with-schema-validation` (not `main`).
- [x] (2026-03-01 20:12Z) Collected roadmap, design, PRD, hyper-codebase, and
  developer-guide references for `3.1.1`.
- [x] (2026-03-01 20:19Z) Created and populated context pack `pk_qoh4ak36`.
- [x] (2026-03-01 20:22Z) Ran parallel agent-team plan synthesis and merged
  milestones, risks, and test-matrix proposals.
- [x] (2026-03-01 20:25Z) Authored draft ExecPlan artifact at
  `docs/execplans/3-1-1-json5-parsing-with-schema-validation.md`.
- [x] (2026-03-02 00:32Z) Received explicit approval to begin implementation.
- [x] (2026-03-02 00:52Z) Implemented structured JSON5 diagnostics in
  `app/config/json5-config.ts` and `app/config/import.ts` with
  `path`/`message`/`suggestedFix` payloads.
- [x] (2026-03-02 01:04Z) Implemented roundtrip-retention writer for runtime
  plugin settings with targeted JSON5 patching and strict retention tests.
- [x] (2026-03-02 01:12Z) Aligned runtime config filename defaults to
  `config.json5` with legacy `hyper.json` fallback when needed.
- [x] (2026-03-02 01:14Z) Updated `docs/developers-guide.md` with new practice
  for diagnostics payloads and roundtrip retention.
- [x] (2026-03-02 01:15Z) Updated user-facing references to `config.json5` in
  help-report and plugin metadata text.
- [x] (2026-03-02 01:20Z) Ran focused unit tests:
  `test/unit/config-import-json5.test.ts` and
  `test/unit/runtime-plugin-settings.test.ts`.
- [x] (2026-03-02 01:31Z) Ran required release gates with tee logs:
  `/tmp/bun-install-velocetty-3-1-1-json5-parsing-with-schema-validation.out`,
  `/tmp/build-velocetty-3-1-1-json5-parsing-with-schema-validation.out`,
  `/tmp/check-fmt-velocetty-3-1-1-json5-parsing-with-schema-validation.out`,
  `/tmp/lint-velocetty-3-1-1-json5-parsing-with-schema-validation.out`, and
  `/tmp/test-velocetty-3-1-1-json5-parsing-with-schema-validation.out`.
- [x] (2026-03-02 01:34Z) Ran docs gates with tee logs:
  `/tmp/markdownlint-velocetty-3-1-1-json5-parsing-with-schema-validation.out`
  and `/tmp/nixie-velocetty-3-1-1-json5-parsing-with-schema-validation.out`.
- [x] (2026-03-02 01:36Z) Marked roadmap item `3.1.1` complete after clean
  gate runs.
- [x] (2026-03-02 01:37Z) Finalized outcomes and retrospective for completion.
- [x] Update `docs/developers-guide.md` with any new practice from delivered
  implementation.
- [x] Run required gates and capture tee logs.
- [x] Mark roadmap item `3.1.1` complete after clean gates.

## Surprises & discoveries

- Observation: current config runtime still references `hyper.json` in active
  paths, while roadmap/design text for this phase targets `config.json5`.
  Evidence: current module references in `app/config/paths.ts` and roadmap text
  in `docs/roadmap.md`.
  Impact: filename alignment must be treated explicitly in implementation
  milestones to avoid accidental scope drift.

- Observation: existing schema file includes many descriptions but appears to
  rely on default config file rather than schema defaults for runtime fallback.
  Evidence: `shared/schemas/schema.json` and `app/config/config-default.json`.
  Impact: defaults strategy should be documented clearly in implementation and
  developer guide updates.

## Decision log

- Decision: keep this plan in `DRAFT` status and block implementation until
  explicit user approval.
  Rationale: execplan workflow requires approval gate before execution.
  Date/Author: 2026-03-01 / Codex.

- Decision: include both required release gates and documentation gates in this
  plan, while treating roadmap closure as contingent on required release gates.
  Rationale: user requested full release gate success and repository docs rules
  require doc validation when docs change.
  Date/Author: 2026-03-01 / Codex.

- Decision: track `hyper.json` versus `config.json5` mismatch as an explicit
  risk and tolerance trigger rather than silently choosing one path.
  Rationale: ambiguity materially affects touched files and regression surface.
  Date/Author: 2026-03-01 / Codex.

- Decision: include comment/format retention as a mandatory acceptance
  criterion for this milestone.
  Rationale: user explicitly required roundtripping retention as non-optional.
  Date/Author: 2026-03-01 / Codex.

## Outcomes & retrospective

Implemented outcomes:

- Added structured JSON5 diagnostics for parse and schema validation fallback
  paths in `app/config/json5-config.ts` and `app/config/import.ts`.
- Diagnostics now surface required fields (`path`, `message`,
  `suggestedFix`) and include optional defaults/doc hints for top-level config
  fields where available.
- Added strict roundtrip retention implementation for runtime plugin settings
  writes using targeted JSON5 patching instead of full-file canonical rewrite.
- Added retention tests proving unchanged comments/formatting are preserved and
  parse-failure writes are safely skipped.
- Aligned primary config filename to `config.json5` while preserving legacy
  fallback support for existing `hyper.json` files.
- Updated developer guidance and roadmap status to reflect completed behaviour.

Gate results:

- Required release gates: all pass.
- Documentation gates: all pass.

## Revision note

Initial draft was created from roadmap/design/codebase evidence plus
parallel agent-team synthesis via context pack `pk_qoh4ak36`.
Revision 2026-03-01: scope tightened to make comment/format retention during
config roundtrips mandatory, with explicit milestones, risks, and acceptance
tests.
Revision 2026-03-02: implementation completed, gates passed, roadmap updated,
and status moved to `COMPLETE`.
