# Add integration and regression coverage for styled-jsx removal

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be
kept up to date as work proceeds.

Status: DRAFT

## Purpose / big picture

Roadmap item `9.2.4` closes the remaining verification gap in the
renderer styling migration. The repository has already migrated renderer
components from `styled-jsx` to CSS Modules (`1.4.17`), removed the
bridge-only tooling (`1.4.18`), and established layered end-to-end
(E2E) coverage (`9.2.3`). What is still missing is a single,
repository-level proof that packaged builds and real renderer startup
paths contain no unresolved `styled-jsx` runtime residue, and that the
replacement CSS Modules behaviour still covers the three migration
patterns documented in the earlier plans:

1. local scoped styles,
2. legacy global selector compatibility, and
3. dynamic theme values via CSS custom properties.

Success is observable when:

1. The unit/build contract suite proves both fixture bundles and
   packaged outputs contain no `styled-jsx`, `styled-jsx/style`, or raw
   `<style jsx>` residue.
2. The fast E2E lane proves packaged startup is clean and fails early if
   forbidden `styled-jsx` runtime imports appear in built artefacts.
3. The deep E2E lane exercises representative renderer surfaces and
   proves CSS Modules parity for local styles, preserved global
   selectors, and dynamic theme variables without introducing flaky,
   screenshot-heavy assertions.
4. `docs/developers-guide.md` documents the final regression contract so
   future renderer styling work replays the correct checks.
5. `docs/roadmap.md` marks item `9.2.4` done only after the full
   validation sequence passes.

This document is planning-only. Implementation must not begin until the
user explicitly approves this ExecPlan.

## Documentation and skills

Read these documents before editing code:

- `docs/roadmap.md` for the governing definition of `9.2.4`, `1.4.17`,
  and `9.2.3`.
- `docs/velocetty-design.md` section `Renderer styling migration model`
  for the target renderer styling contract.
- `docs/execplans/1-4-16-styled-jsx-to-css-modules-migration-approach-and-inventory.md`
  for the migration patterns and parity expectations.
- `docs/execplans/1-4-17-migrate-renderer-style-blocks-from-styled-jsx-to-css-modules.md`
  for concrete CSS Modules migration rules and parity examples.
- `docs/execplans/1-4-18-remove-styled-jsx-bridge-tooling-and-bridge-only-babel-dependencies.md`
  for the bridge-removal follow-up context that points directly at this
  roadmap item.
- `docs/execplans/enhance-e2e-testing-strategy.md` for fast-lane and
  deep-lane intent, command names, and CI policy.
- `docs/developers-guide.md` for the current CSS Modules conventions and
  E2E lane descriptions.

Use these skills during implementation:

- `execplans` to keep this file current as work proceeds.
- `grepai` for intent-based repository search.
- `leta` for symbol-aware code navigation in the touched test/build
  modules.

## Repository orientation

The current branch already contains several pieces of the final
regression story, but they are not yet tied together in the way
`9.2.4` requires.

`test/unit/esbuild-migration-contracts.test.ts` already checks that
`createRendererBuildOptions(...)` uses `'.module.css': 'local-css'` and
that a synthetic renderer bundle no longer emits `styled-jsx` runtime
markers. That suite is the right home for stronger build-contract
assertions because it already exercises esbuild directly.

`test/e2e/electron.e2e.test.ts` already validates packaged startup,
renderer-readiness markers, critical renderer console errors, and
unresolved `@shared` runtime imports in selected packaged files. It does
not yet inspect packaged artefacts for `styled-jsx` residue.

`test/e2e-deep/terminal-input-path.e2e.ts` already provides a real
packaged-app deep-lane interaction test, but it only proves terminal
input/output flow. It does not yet validate styling migration parity.

Representative renderer styling surfaces already exist and should be
reused instead of inventing new migration examples:

- Dynamic theme values:
  `lib/components/searchBox.tsx` plus
  `test/unit/search-box-css-modules.test.tsx`,
  and `lib/components/new-tab.tsx` plus
  `test/unit/new-tab.test.tsx`.
- Legacy global selector compatibility:
  `lib/components/tabs.module.css` preserves `.tabs_list`,
  and `lib/components/term.tsx` /
  `lib/components/term.module.css` preserve `term_fit` and
  `term_wrapper`.
- Global CSS behaviour with custom properties:
  `lib/components/terms.module.css` uses `:global(::-webkit-scrollbar*)`
  with `--scrollbar-thumb`.

The implementation should extend these existing surfaces first. Only add
new test files when the existing suites cannot express the required
behaviour cleanly.

## Constraints

- This plan remains in draft status until user approval. Do not
  implement any milestone before approval is explicit.
- Do not add new external dependencies. Use the existing Bun, Playwright,
  and test helper stack.
- Preserve the current fast/deep lane command names and CI intent:
  `bun run test:e2e:fast` and `bun run test:e2e:deep` must remain the
  operator-facing entry points.
- Keep assertions deterministic. Prefer artefact scans, stable selectors,
  DOM attributes, CSS custom-property presence, and narrow computed-style
  checks over screenshot goldens.
- Keep legacy compatibility classes attached where the migration already
  preserves them. In particular, do not break `.tabs_list`,
  `term_fit`, or `term_wrapper`.
- Any change to developer workflow, required commands, or regression
  expectations must be documented in `docs/developers-guide.md` during
  implementation.
- Do not mark roadmap item `9.2.4` done until all required gates,
  including both E2E lanes, pass.
- Follow the repository test-discipline instructions: do not run format,
  lint, or test commands in parallel, and capture command output with
  `tee` logs under `/tmp/`.

## Tolerances (exception triggers)

- Scope: if implementation needs more than 14 non-generated file edits,
  pause and re-evaluate the plan before continuing.
- Dependencies: if proving parity would require a new snapshot,
  screenshot-diff, or CSS-inspection dependency, stop and escalate.
- Test shape: if the fast lane cannot support the new artefact checks
  without removing `playwright|spawn` driver compatibility, stop and
  redesign instead of degrading the lane.
- Deep lane: if parity checks remain flaky after two focused
  stabilization passes, stop and present narrower alternatives.
- Coverage gap: if the existing representative components are not enough
  to prove one of the three migration patterns, document the missing
  pattern and agree the next best surface before widening scope.
- Iterations: if required gates still fail after three
  fix-and-rerun cycles, stop and escalate with the failure set and log
  paths.

## Risks

- Risk: minified or transformed artefacts may hide or reshape forbidden
  strings, producing brittle string-only assertions.
  Severity: medium
  Likelihood: medium
  Mitigation: combine forbidden-string scans with positive checks for the
  expected CSS Modules output path and scan both synthetic bundles and
  packaged artefacts.

- Risk: global-selector parity is easy to overstate because some of the
  compatibility contract is about class retention rather than pure visual
  output.
  Severity: medium
  Likelihood: high
  Mitigation: explicitly assert preserved legacy classes on the affected
  DOM nodes and keep those checks separate from computed-style checks.

- Risk: dynamic theme checks may become flaky if they depend on full
  visual rendering rather than stable CSS variable plumbing.
  Severity: medium
  Likelihood: medium
  Mitigation: assert CSS custom properties on representative wrapper
  elements and then verify one narrow descendant computed style that
  consumes the variable.

- Risk: deep-lane coverage could grow into a broad visual-regression
  framework.
  Severity: medium
  Likelihood: medium
  Mitigation: keep the first pass limited to one deterministic style
  parity scenario plus the existing terminal interaction path.

## Progress

- [x] (2026-04-23) Reviewed roadmap item `9.2.4`, its dependencies, the
  renderer styling design notes, and the prior styled-jsx/CSS Modules
  ExecPlans.
- [x] (2026-04-23) Used two `wyvern` agents to survey documentation,
  current coverage surfaces, and likely gaps without editing files or
  running tests.
- [x] (2026-04-23) Drafted this ExecPlan at
  `docs/execplans/9-2-4-integration-and-regression-coverage-for-styled-jsx-removal.md`.
- [ ] Await user approval.
- [ ] Establish the failing regression checks that demonstrate the gap in
  current coverage.
- [ ] Extend unit/build contract coverage for packaged artefacts and CSS
  Modules parity anchors.
- [ ] Extend the fast E2E lane with packaged-output styled-jsx residue
  checks.
- [ ] Extend the deep E2E lane with one deterministic style-parity
  scenario covering the three migration patterns.
- [ ] Update `docs/developers-guide.md` and mark roadmap item `9.2.4`
  done after the full validation sequence passes.
- [ ] Record final outcomes, surprises, and retrospective notes here.

## Surprises & Discoveries

- Observation: the repository already has a useful styled-jsx removal
  contract test in `test/unit/esbuild-migration-contracts.test.ts`, but
  it only proves the synthetic fixture path, not packaged build output.
  Impact: implementation should extend an existing contract rather than
  create a parallel one.

- Observation: the fast E2E lane already scans packaged files for
  unresolved `@shared` runtime imports.
  Impact: `test/e2e/electron.e2e.test.ts` and
  `test/e2e/electron-e2e-helpers.ts` are the natural place to add
  packaged `styled-jsx` residue checks.

- Observation: the deep E2E lane currently proves only terminal input and
  rendered output.
  Impact: the new style-parity coverage should either extend that file in
  a bounded way or split into a second deep-lane test file if size or
  readability would suffer.

## Decision Log

- Decision: keep this task planning-only until explicit approval.
  Rationale: the user requested an ExecPlan first, and the repository
  guidance requires plan approval before implementation.
  Date/Author: 2026-04-23 / Codex

- Decision: reuse existing build-contract, fast-lane, and deep-lane
  suites before introducing new top-level test infrastructure.
  Rationale: the repository already has the right command structure and
  helper stack; `9.2.4` is a coverage-hardening task, not a test-platform
  rewrite.
  Date/Author: 2026-04-23 / Codex

- Decision: split responsibilities between lanes.
  Rationale: fast-lane additions should focus on packaged artefact
  cleanliness and cheap startup checks, while deep-lane additions should
  carry the richer style-parity assertions.
  Date/Author: 2026-04-23 / Codex

## Plan of work

## Milestone 1: Reproduce the missing coverage with focused failing checks

Start by proving that the current repository still lacks the exact
assertions required by `9.2.4`.

1. Re-read the existing assertions in
   `test/unit/esbuild-migration-contracts.test.ts`,
   `test/e2e/electron.e2e.test.ts`, and
   `test/e2e-deep/terminal-input-path.e2e.ts`.
2. Add the smallest failing assertions that express the missing contract:
   packaged-output `styled-jsx` residue scanning in the fast lane, and a
   deep-lane style-parity scenario for the representative renderer
   surfaces.
3. Keep the initial failures narrow and diagnostic so the red phase tells
   you exactly which contract is missing.

Observable result: the new assertions fail before implementation changes
and explain the missing `9.2.4` coverage in plain language.

## Milestone 2: Strengthen unit and build-contract coverage

Update `test/unit/esbuild-migration-contracts.test.ts` so it proves the
build contract at two levels:

1. Synthetic fixture bundling still strips `styled-jsx` runtime residue.
2. Packaged output scanning can detect forbidden `styled-jsx` strings in
   emitted renderer artefacts.

If the current contract helper structure becomes hard to follow, extract a
small test helper under `test/testUtils/` for scanning emitted JS/CSS
files, but do not create a second contract suite.

Extend the representative CSS Modules parity unit tests:

1. `test/unit/search-box-css-modules.test.tsx` should assert the
   `--search-*` CSS custom properties are present on the expected wrapper
   and that one consumer element reflects the variable-driven styling
   contract.
2. `test/unit/new-tab.test.tsx` should assert the `--new-tab-border` and
   `--new-tab-bg` variables are present and that the button/dropdown
   remains wired to the CSS Modules classes without duplicate/empty class
   segments.
3. Global-selector compatibility should be asserted in the most natural
   existing suite. Prefer extending a related unit suite; if none fits
   cleanly, add a focused compatibility test under `test/unit/` that
   proves `tabs_list`, `term_fit`, and `term_wrapper` still attach to the
   expected DOM nodes.

Observable result: the unit suite proves all three migration patterns in a
fast, deterministic way and documents the exact DOM or artefact contract.

## Milestone 3: Extend the fast E2E lane for packaged-output cleanliness

Update `test/e2e/electron.e2e.test.ts` and, if needed,
`test/e2e/electron-e2e-helpers.ts` so the fast lane fails when packaged
artefacts contain forbidden `styled-jsx` runtime residue.

Implementation rules:

1. Reuse the existing packaged-file inspection pattern used for unresolved
   `@shared` runtime imports.
2. Scan the packaged renderer output set for:
   `styled-jsx/style`, `styled-jsx`, and raw `<style jsx` or equivalent
   uncompiled residue where that check is stable.
3. Keep the scan helper path-driven and deterministic. It must produce a
   clear error listing the offending files.
4. Preserve `playwright|spawn` driver compatibility. Fast-lane additions
   must not require a single driver mode.

Observable result: `bun run test:e2e:fast` proves packaged startup is
clean even before the app window is interacted with.

## Milestone 4: Add one deep-lane style-parity scenario

Extend the deep lane in `test/e2e-deep/`. If
`test/e2e-deep/terminal-input-path.e2e.ts` would become unwieldy, create
`test/e2e-deep/style-parity.e2e.ts` and keep the current interaction-path
test separate.

The deep-lane scenario must prove one representative example of each
migration pattern:

1. Local scoped styles:
   assert a representative renderer surface renders with the expected CSS
   Modules-owned class contract and non-empty computed styles.
2. Global selector compatibility:
   assert preserved legacy classes such as `.tabs_list`, `term_fit`, or
   `term_wrapper` are present on the live renderer DOM where plugins or
   custom CSS would expect them.
3. Dynamic theme values:
   assert representative wrapper elements expose the documented CSS custom
   properties (`--search-*`, `--new-tab-*`, or equivalent) and that a
   live descendant style consumes them.

Prefer DOM evaluation and narrow `getComputedStyle(...)` checks over image
comparison. Keep selectors stable and close to existing accessibility or
component contracts.

Observable result: `bun run test:e2e:deep` proves a real packaged
renderer still satisfies the CSS Modules migration contract after bridge
removal.

## Milestone 5: Documentation and roadmap closure

Once the code and tests are green, update the documentation surfaces that
encode developer expectations:

1. Update `docs/developers-guide.md` with a concise `9.2.4` regression
   checklist covering:
   - the representative CSS Modules parity surfaces,
   - the forbidden packaged-output `styled-jsx` scan,
   - the fact that both fast and deep lanes now participate in renderer
     styling safety.
2. Update `docs/roadmap.md` to mark `9.2.4` done only after all required
   validation succeeds.
3. If implementation clarifies a previously stale bridge-era statement in a
   touched design or hyper-codebase document, update it in the same
   change. Do not start a broad docs sweep.

Observable result: a future developer can find both the commands and the
reason for running them without opening historical ExecPlans.

## Validation and acceptance

During implementation, capture every required command with `tee` and keep
the logs. Use the branch-local naming pattern from `AGENTS.md`, for
example `/tmp/<action>-$(get-project)-$(git branch --show).out`.

Mandatory repository gates:

```bash
bun install 2>&1 | tee /tmp/bun-install-$(get-project)-$(git branch --show).out
make build 2>&1 | tee /tmp/build-$(get-project)-$(git branch --show).out
make check-fmt 2>&1 | tee /tmp/check-fmt-$(get-project)-$(git branch --show).out
make lint 2>&1 | tee /tmp/lint-$(get-project)-$(git branch --show).out
make test 2>&1 | tee /tmp/test-$(get-project)-$(git branch --show).out
```

Feature-specific regression checks:

```bash
bun run test:e2e:fast 2>&1 | tee /tmp/test-e2e-fast-$(get-project)-$(git branch --show).out
bun run test:e2e:deep 2>&1 | tee /tmp/test-e2e-deep-$(get-project)-$(git branch --show).out
```

Documentation gates because this work updates Markdown:

```bash
bunx markdownlint-cli2 "docs/**/*.md" 2>&1 | tee /tmp/markdownlint-$(get-project)-$(git branch --show).out
nixie --no-sandbox 2>&1 | tee /tmp/nixie-$(get-project)-$(git branch --show).out
```

Acceptance criteria:

1. The new or expanded unit tests explicitly cover local styles, global
   selectors, and dynamic theme values.
2. The fast lane fails if packaged output contains `styled-jsx` residue.
3. The deep lane proves live packaged-renderer style parity using stable
   DOM/computed-style assertions.
4. `docs/developers-guide.md` reflects the final workflow.
5. `docs/roadmap.md` marks `9.2.4` done only after all commands above
   pass.

## Outcomes & Retrospective

Pending implementation approval.
