# Promote `--concurrent` to the default unit-test gate

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

This change promotes explicit Bun `--concurrent` execution from an opt-in
stress-test flag to the default for all unit-test gates (local and CI). After
completion, running `make test` or `bun run test:unit` will execute the full
unit-test suite with maximum concurrency enabled, reducing local feedback loop
times and ensuring the hardening work from roadmap items 9.3.3 through 9.3.7
remains effective.

Observable success: the three seeded concurrent stress runs pass, and the
standard quality gates (`bun install`, `make build`, `make check-fmt`,
`make lint`, `make test`) all succeed with `--concurrent` in the default
unit-test path.

## Constraints

Hard invariants that must hold throughout implementation:

1. **Preserve diagnostic commands**: `test:unit:serialized`,
   `test:unit:serialized:shuffled`, and `test:unit:shuffled` must remain
   available for triage after the default-gate flip.
2. **Do not break CI**: The `.github/workflows/nodejs.yml` workflow must
   continue to pass without modification (it calls `make test`).
3. **Do not break existing seeded commands**: The exact commands documented in
   `docs/developers-guide.md` for seeded stress testing must remain valid.
4. **No new dependencies**: This change must not introduce new npm packages or
   Bun version requirements.
5. **Documentation parity**: Changes to script behaviour must be reflected in
   both `docs/developers-guide.md` and `docs/roadmap.md`.

If satisfying the objective requires violating a constraint, do not proceed.
Document the conflict in `Decision Log` and escalate.

## Tolerances (exception triggers)

Thresholds that trigger escalation when breached:

- **Scope**: If implementation requires changes to more than 3 files or
  50 lines of code (net), stop and escalate.
- **Interface**: If the `make test` target behaviour changes in a way that
  breaks existing muscle memory, stop and escalate.
- **Dependencies**: If a new external dependency is required, stop and
  escalate.
- **Iterations**: If any of the three seeded concurrent runs fail after
  3 retry attempts, stop and escalate.
- **Time**: If any single seeded stress run takes longer than 10 minutes,
  stop and escalate.
- **Ambiguity**: If multiple valid interpretations exist for what
  "default gate" means and the choice materially affects CI behaviour,
  stop and present options with trade-offs.

## Risks

Known uncertainties that might affect the plan:

- **Risk**: One of the three seeded concurrent runs fails intermittently due
  to a previously undiscovered race condition.
  Severity: high
  Likelihood: low
  Mitigation: Run each seeded test 3 times before proceeding. If flakiness
  is detected, revert the change and create a tracking issue for the
  specific race.

- **Risk**: CI environment has different timing characteristics than local
  runs, exposing concurrency issues not seen locally.
  Severity: medium
  Likelihood: medium
  Mitigation: Run full CI matrix on a draft PR before merging. The CI
  workflow runs `make test`, so validate that path explicitly.

- **Risk**: A test that passes under default Bun concurrency fails under
  explicit `--concurrent` due to subtle timing differences.
  Severity: medium
  Likelihood: low
  Mitigation: The prerequisite items (9.3.3-9.3.7) were specifically designed
  to address this. Validate with the three seeded runs before flipping the
  default.

## Progress

Use a list with checkboxes to summarize granular steps:

- [x] Stage A: Verify all prerequisite fixes (9.3.3-9.3.7) are marked done
  in `docs/roadmap.md`.
- [x] Stage B: Update `package.json` scripts to add `--concurrent` to default
  path (`test:unit:run`).
- [x] Stage B: Add new `test:unit:concurrent:shuffled` script for explicit
  concurrent stress testing.
- [x] Stage C: Run validation - `bun test --concurrent --randomize
  --seed 2444615283 test/unit` must pass.
- [x] Stage C: Run validation - `bun test --concurrent --randomize
  --seed 1337 test/unit` must pass.
- [x] Stage C: Run validation - `bun test --concurrent --randomize
  --seed 20260306 test/unit` must pass.
- [x] Stage D: Update `docs/developers-guide.md` to reflect new default
  behaviour.
- [x] Stage D: Mark roadmap item 9.3.8 as done in `docs/roadmap.md`.
- [x] Stage E: Run final validation - `bun install`, `make build`,
  `make check-fmt`, `make lint`, and `make test` all pass.

## Surprises & discoveries

Unexpected findings during implementation:

- No surprises. All three seeded concurrent stress runs passed on the first
  attempt, confirming the hardening work from roadmap items 9.3.3-9.3.7 was
  effective.

## Decision log

Record every significant decision:

- Decision: Keep the existing `--seed=12345` value for the new
  `test:unit:concurrent:shuffled` script for consistency with other shuffled
  scripts. This follows the pattern established by `test:unit:shuffled` and
  `test:unit:serialized:shuffled`.

## Outcomes & retrospective

Summarize outcomes, gaps, and lessons learned:

- **Outcome**: `--concurrent` is now the default for all unit-test gates.
  The standard quality gates (`bun install`, `make build`, `make check-fmt`,
  `make lint`, `make test`) all pass with `--concurrent` in the default path.
- **Validation**: All three seeded concurrent stress runs pass:
  - Seed 2444615283: 271 pass, 0 fail
  - Seed 1337: 271 pass, 0 fail
  - Seed 20260306: 271 pass, 0 fail
- **Documentation**: Updated `docs/developers-guide.md` and `docs/roadmap.md`
  to reflect the new default behaviour and mark 9.3.8 as complete.
- **Preservation**: Diagnostic commands (`test:unit:serialized`,
  `test:unit:serialized:shuffled`, `test:unit:shuffled`) remain available
  for triage as required by constraints.

## Context and orientation

### Current state

After roadmap item 9.3.2, the default unit-test gate runs with Bun's default
concurrency (`bun test test/unit`), NOT explicit `--concurrent`. The explicit
`--concurrent` flag still exposes failures in some suites when run without the
prerequisite fixes from 9.3.3-9.3.7.

Roadmap items 9.3.3 through 9.3.7 have isolated specific test suites to make
them safe for explicit concurrent execution:

- **9.3.3**: Isolated renderer event and renderer-metric tests
- **9.3.4**: Isolated filesystem bootstrap helper tests
- **9.3.5**: Isolated snapshot and CLI configuration tests
- **9.3.6**: Eliminated remaining long-lived file-scope module mocks
- **9.3.7**: Replaced process-global timer and logger overrides with injected
  seams

### Key files

- `package.json`: Contains the npm scripts that define the test commands.
  Current relevant scripts:
  - `test:unit:run`: `bun test test/unit` (target for modification)
  - `test:unit:serialized`: `bun test --max-concurrency=1 test/unit`
  - `test:unit:shuffled`: `bun test --randomize --seed=12345 test/unit`
  - `test:unit:serialized:shuffled`: `bun test --max-concurrency=1
    --randomize --seed=12345 test/unit`

- `Makefile`: Contains the `test` target that calls `bun run test:unit:run`.
  This file does not need modification - the change flows through
  `package.json`.

- `.github/workflows/nodejs.yml`: CI workflow that runs `make lint` and
  `make test`. No modification needed.

- `docs/developers-guide.md`: Contains testing guidance that must be updated
  to reflect the new default behaviour.

- `docs/roadmap.md`: Contains roadmap item 9.3.8 that must be marked done.

### Terminology

- **Default concurrency**: Bun's implicit concurrency when running
  `bun test` without flags. This varies based on CPU count.
- **Explicit `--concurrent`**: The Bun `--concurrent` flag that enables
  maximum concurrency regardless of CPU count.
- **Serialized**: Running with `--max-concurrency=1`, which forces sequential
  test execution.
- **Shuffled**: Running with `--randomize`, which randomizes test order
  within files.

## Plan of work

### Stage A: Verify prerequisites

Before making any changes, confirm that roadmap items 9.3.3 through 9.3.7 are
all marked as done in `docs/roadmap.md`. If any are incomplete, escalate
before proceeding.

Go/no-go: All prerequisite items show `[x]` in roadmap.md.

### Stage B: Update package.json scripts

Modify `package.json` to add `--concurrent` to the default unit-test path:

1. Change `test:unit:run` from:

   ```json
   "test:unit:run": "bun test test/unit",
   ```

   To:

   ```json
   "test:unit:run": "bun test --concurrent test/unit",
   ```

2. Add a new explicit stress-test script `test:unit:concurrent:shuffled`:

   ```json
   "test:unit:concurrent:shuffled": "bun test --concurrent --randomize --seed=12345 test/unit",
   ```

This preserves the existing `test:unit:serialized` and
`test:unit:serialized:shuffled` commands for triage while making concurrent
the default.

Go/no-go: `package.json` validates with `bun install` without errors.

### Stage C: Seeded concurrent validation

Run the three seeded concurrent stress tests specified in the roadmap:

1. `bun test --concurrent --randomize --seed 2444615283 test/unit`
2. `bun test --concurrent --randomize --seed 1337 test/unit`
3. `bun test --concurrent --randomize --seed 20260306 test/unit`

Each must pass completely (all tests green, no timeout failures). If any fail,
escalate before proceeding.

Go/no-go: All three seeded runs pass.

### Stage D: Documentation updates

Update `docs/developers-guide.md` in the "Unit tests (Bun)" section:

1. Update the paragraph describing the default test gate to mention that
   `--concurrent` is now the default.

2. Update or add the explicit concurrent stress test command examples.

3. Update the seeded randomisation examples to show the `--concurrent` flag
   (since that is now the default path).

Update `docs/roadmap.md`:

1. Mark roadmap item 9.3.8 as done by changing `- [ ] 9.3.8` to `- [x] 9.3.8`.

Go/no-go: Documentation renders correctly with `bunx markdownlint-cli2`.

### Stage E: Final validation

Run the complete quality gate sequence:

1. `bun install` - must complete without errors
2. `make build` - must complete without errors
3. `make check-fmt` - must pass
4. `make lint` - must pass
5. `make test` - must pass with the new `--concurrent` default

Go/no-go: All five gates pass.

## Concrete steps

### Step A1: Verify prerequisites

```bash
# Working directory: repository root
grep -A 5 "9.3.3" docs/roadmap.md | head -2
grep -A 5 "9.3.4" docs/roadmap.md | head -2
grep -A 5 "9.3.5" docs/roadmap.md | head -2
grep -A 5 "9.3.6" docs/roadmap.md | head -2
grep -A 5 "9.3.7" docs/roadmap.md | head -2
```

Expected output: All show `- [x]` (done status).

### Step B1: Modify package.json

```bash
# Working directory: repository root
# Edit package.json to change test:unit:run
```

Expected `package.json` diff:

```diff
-    "test:unit:run": "bun test test/unit",
+    "test:unit:run": "bun test --concurrent test/unit",
```

Add the new concurrent shuffled script:

```diff
     "test:unit:serialized:shuffled": "bun test --max-concurrency=1 --randomize --seed=12345 test/unit",
+    "test:unit:concurrent:shuffled": "bun test --concurrent --randomize --seed=12345 test/unit",
```

Validate the JSON is well-formed:

```bash
bun install --dry-run
```

Expected output: No JSON parsing errors.

### Step C1-C3: Run seeded validation

```bash
# Working directory: repository root

# Seeded run 1
bun test --concurrent --randomize --seed 2444615283 test/unit

# Expected output:
# <test summary showing all pass>
# X tests passed

# Seeded run 2
bun test --concurrent --randomize --seed 1337 test/unit

# Expected output:
# <test summary showing all pass>
# X tests passed

# Seeded run 3
bun test --concurrent --randomize --seed 20260306 test/unit

# Expected output:
# <test summary showing all pass>
# X tests passed
```

### Step D1: Update documentation

```bash
# Working directory: repository root

# Update developers-guide.md - update the section describing default test gate
# Update roadmap.md - mark 9.3.8 as done

# Validate Markdown
bunx markdownlint-cli2 "docs/developers-guide.md" "docs/roadmap.md"

# Expected output: No errors (or only pre-existing ones)
```

### Step E1-E5: Final validation

```bash
# Working directory: repository root

# Gate 1: Install
bun install

# Expected output:
# <installation progress>
# Success

# Gate 2: Build
make build

# Expected output:
# <build progress>
# Build completes without error

# Gate 3: Format check
make check-fmt

# Expected output:
# Checked X files
# No errors

# Gate 4: Lint
make lint

# Expected output:
# No errors

# Gate 5: Test
make test

# Expected output:
# Unit tests run with --concurrent
# All tests pass
```

## Validation and acceptance

Quality criteria (what "done" means):

- **Tests**: The three seeded concurrent runs pass:
  - `bun test --concurrent --randomize --seed 2444615283 test/unit`
  - `bun test --concurrent --randomize --seed 1337 test/unit`
  - `bun test --concurrent --randomize --seed 20260306 test/unit`
- **Lint/typecheck**: `make check-fmt`, `make lint` pass with no errors.
- **Build**: `bun install` and `make build` complete without errors.
- **Integration**: `make test` passes with `--concurrent` in the default path.

Quality method (how we check):

Run the complete validation sequence from Stage E. Capture the terminal
output showing all five gates passing.

## Idempotence and recovery

If Stage C fails (seeded runs do not pass):

1. Revert the `package.json` change:

   ```bash
   git checkout package.json
   ```

2. Document the failure mode in `Surprises & Discoveries`.
3. Escalate with the captured failure output.

If Stage E fails (quality gates):

1. Check if the failure is related to the `--concurrent` change:
   - Run `bun test test/unit` (without --concurrent) to verify baseline.
   - If baseline passes but `--concurrent` fails, escalate.
2. If the failure is unrelated (infrastructure, network, etc.), retry up to
   the iteration tolerance (3 attempts) before escalating.

All steps are safe to retry. The only persistent change is to `package.json`
and documentation files, which are version-controlled and can be reverted with
`git checkout`.

## Interfaces and dependencies

### Required interfaces

- `bun test` with `--concurrent` flag support (Bun 1.3.8+, already required
  by `package.json`).
- `make` with standard targets (`test`, `build`, `check-fmt`, `lint`).

### Required files

- `package.json` - must exist and contain npm scripts section.
- `Makefile` - must exist and contain the `test` target.
- `docs/developers-guide.md` - must exist for Stage D updates.
- `docs/roadmap.md` - must exist for Stage D updates.

### Dependencies

- Roadmap items 9.3.3, 9.3.4, 9.3.5, 9.3.6, and 9.3.7 must be complete.
- All unit test files under `test/unit/` must be present and functional.

---

## Revision note

Initial draft created. No revisions yet.
