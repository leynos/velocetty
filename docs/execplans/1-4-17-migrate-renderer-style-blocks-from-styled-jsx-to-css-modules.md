# Migrate renderer style blocks from styled-jsx to CSS Modules

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

The Velocetty renderer currently uses `styled-jsx` for component styling,
supported by a Babel bridge plugin in the esbuild pipeline. This plan migrates
all renderer style blocks to CSS Modules so that:

1. The renderer build no longer depends on the `styled-jsx` Babel bridge.
2. Component styles remain locally scoped and behaviourally equivalent.
3. The codebase aligns with the CSS Modules conventions already documented in
   `docs/developers-guide.md`.

After this change, a developer can add co-located `*.module.css` files for
renderer components and esbuild will bundle them natively. No renderer source
files will contain `<style jsx>` tags.

## Constraints

- Do not modify backend (`app/`) logic except where required to update build
  pipeline or type declarations.
- Do not remove the styled-jsx Babel bridge plugin or its dependencies in this
  plan; that is the scope of roadmap item `1.4.18`.
- Preserve all existing CSS class names that may be targeted by plugins or user
  custom CSS. Where legacy names are kept for compatibility, they must remain
  attached to the same elements.
- Maintain visual parity: no layout, colour, or animation regressions in
  renderer surfaces.
- All existing unit and end-to-end tests must continue to pass.

## Tolerances (exception triggers)

- Scope: if migration requires changes to more than 30 files (net), stop and
  escalate.
- Interface: if a public component prop type or exported module signature must
  change, stop and escalate.
- Dependencies: if a new external dependency is required beyond what is already
  in `package.json`, stop and escalate.
- Iterations: if tests still fail after 3 fix attempts, stop and escalate.
- Time: if any milestone takes more than 4 hours, stop and escalate.
- Ambiguity: if multiple valid CSS Module patterns exist for a dynamic value
  and the choice materially affects plugin compatibility, stop and present
  options.

## Risks

- Risk: esbuild `local-css` loader behaviour differs from styled-jsx lexical
  scoping for descendant selectors.
  Severity: medium
  Likelihood: medium
  Mitigation: prefer direct class selectors on intended elements; avoid broad
  descendants. Add snapshot tests for generated class names where scoping is
  non-trivial.

- Risk: plugin or user custom CSS relies on legacy global class names.
  Severity: medium
  Likelihood: medium
  Mitigation: preserve compatibility classes during migration (for example,
  `term_fit`, `term_wrapper`). Document any classes that are intentionally
  retired.

- Risk: global scrollbar pseudo-element styles behave differently when moved
  from `<style jsx global>` to a CSS Module with `:global()`.
  Severity: low
  Likelihood: medium
  Mitigation: scope `:global()` selectors to a container class so they apply
  within the component subtree. Validate with existing end-to-end (E2E) fast-lane
  checks.

- Risk: dynamic theme values interpolated into styled-jsx blocks lose
  pseudo-class access when moved to inline `style=`.
  Severity: medium
  Likelihood: high
  Mitigation: map all dynamic values to CSS custom properties passed via the
  `style` attribute, preserving `:hover` and `:focus` access in the module.

## Progress

- [x] (2026-03-29) Draft ExecPlan and seek approval before implementation.
- [x] (2026-03-29) Add esbuild CSS Modules support and TypeScript declarations.
- [x] (2026-03-29) Migrate Pattern A files (local static styles).
- [x] (2026-03-29) Migrate Pattern C files (global selectors).
- [x] (2026-03-29) Migrate Pattern B files (local dynamic styles).
- [x] (2026-03-29) Add parity-focused tests and update migration contract tests.
- [x] (2026-03-29) Update `docs/developers-guide.md` and mark roadmap item
  `1.4.17` as done.
- [x] (2026-03-29) Run full quality gates: all passed.

## Surprises & discoveries

- Observation: Biome CSS parser requires `css.parser.cssModules: true` to handle
  `:global()` pseudo-class syntax in CSS Modules.
  Evidence: Lint failed with "`:local` and `:global` pseudo-classes are not
  standard CSS features" until biome.json was updated.
  Impact: biome.json configuration must be updated when using `:global()` in
  CSS Modules.

- Observation: The notification test relied on a specific class name
  (`.notification_dismissLink`) that changed when using CSS Modules.
  Evidence: Test failed with `querySelector('.notification_dismissLink')`
  returning null after migration.
  Impact: Updated test to use element selector (`button[type="button"]`) which
  is more resilient to class name changes.

## Decision log

- Decision: Use CSS custom properties for all dynamic theme values in Pattern B
  migration (searchBox, tabs, new-tab).
  Rationale: Preserves pseudo-class access (`:hover`, `:focus`) and keeps
  styles in CSS rather than inline styles.
  Date/Author: 2026-03-29

- Decision: Preserve legacy class names (e.g., `term_fit`, `term_wrapper`) in
  Pattern C migration for plugin compatibility.
  Rationale: Plugin CSS and custom user CSS may target these class names;
  breaking them would cause visual regressions for users.
  Date/Author: 2026-03-29

- Decision: Enable Biome CSS Modules parser in biome.json to support
  `:global()` pseudo-class for WebKit scrollbar styles.
  Rationale: Required for lint to pass with the style-sheet.module.css
  pattern.
  Date/Author: 2026-03-29

## Outcomes & retrospective

### Outcomes

1. Successfully migrated 13 styled-jsx blocks across 12 files to CSS Modules.
2. Added esbuild CSS Modules support (`local-css` loader) and TypeScript
   declarations (`typings/css-modules.d.ts`).
3. Updated Biome configuration to support `:global()` pseudo-class.
4. Fixed notification test to be resilient to class name changes.
5. All 272 tests pass; no regressions in lint, type-check, or build.
6. Roadmap item 1.4.17 marked as complete.

### Retrospective

- The migration pattern worked well: static styles to modules, dynamic values
  to CSS custom properties, platform conditionals to modifier classes.
- Preserving legacy class names added some verbosity but ensured compatibility.
- The CSS Modules approach is more maintainable and follows modern practices.

## Context and orientation

### What is being migrated

The renderer (`lib/`) contains 13 styled-jsx blocks across 12 files:

| File | Pattern | Notes |
| ---- | ------- | ----- |
| `lib/components/terms.tsx` | A (local static) | Includes keyframe animations |
| `lib/components/header.tsx` | A (local static) | Uses inline `style=` for dynamic border |
| `lib/components/notifications.tsx` | A (local static) | Simple positioning |
| `lib/components/notification.tsx` | A (local static) | Uses inline `style=` for colours |
| `lib/components/split-pane.tsx` | A (local static) | Uses inline `style=` for divider colour |
| `lib/components/tab.tsx` | A (local static) | Uses inline `style=` for active indicator |
| `lib/containers/hyper.tsx` | A (local static) | Uses inline `style=` for theme; has custom CSS injection comment |
| `lib/components/searchBox.tsx` | B (local dynamic) | Two blocks, multiple theme interpolations |
| `lib/components/tabs.tsx` | B (local dynamic) | Platform conditionals (`isMac`) |
| `lib/components/new-tab.tsx` | B (local dynamic) | Colour + platform conditional |
| `lib/components/style-sheet.tsx` | C (global) | WebKit scrollbar pseudo-elements |
| `lib/components/term.tsx` | C (global) | `.term_fit` and `.term_wrapper` marked global but used locally |

### Build pipeline

The renderer is bundled by `build/esbuild/run-esbuild.ts`:

- `createRendererBuildOptions` configures esbuild with `'.css': 'css'`.
- The `createStyledJsxBabelBridgePlugin()` is registered in the plugin array.
- TypeScript path aliases and `typings/styled-jsx.d.ts` support the current
  JSX style blocks.

### Existing tests

- `test/unit/esbuild-migration-contracts.test.ts` validates the styled-jsx
  bridge, packaging, and plugin behaviour. It must be updated to assert CSS
  Module bundling once components are migrated.
- Component-level unit tests exist for `notification`, `hyper-transport`,
  `hyper-effects`, `tabs-decoration-updates`, and `term-report-renderer`.
  These must remain green.

## Plan of work

### Stage 1: Pipeline preparation (no component changes)

1. In `build/esbuild/run-esbuild.ts`, update the `loader` inside
   `createRendererBuildOptions` to map `'.module.css': 'local-css'` alongside
   the existing `'.css': 'css'`.
2. Create `typings/css-modules.d.ts` with a default export declaration for
   `*.module.css`.
3. Add a migration contract test in
   `test/unit/esbuild-migration-contracts.test.ts` that builds a fixture
   importing `*.module.css` and asserts the output contains filename-prefixed
   scoped class names produced by esbuild local-css (e.g., `fixture_searchBox`).
4. Run `make build`, `make lint`, and `make test` to confirm the pipeline
   changes do not break existing code.

### Stage 2: Pattern A migration (local static styles)

For each file in this group, create an adjacent `*.module.css`, move the
static rules, replace string class names with module tokens, and remove the
`<style jsx>` block.

Files:

- `lib/components/terms.tsx` → `lib/components/terms.module.css`
- `lib/components/header.tsx` → `lib/components/header.module.css`
- `lib/components/notifications.tsx` → `lib/components/notifications.module.css`
- `lib/components/notification.tsx` → `lib/components/notification.module.css`
- `lib/components/split-pane.tsx` → `lib/components/split-pane.module.css`
- `lib/components/tab.tsx` → `lib/components/tab.module.css`
- `lib/containers/hyper.tsx` → `lib/containers/hyper.module.css`

For `hyper.tsx`, preserve the `stylis('#hyper', customCSS)` custom CSS
injection path. Update the adjacent comment to remove the styled-jsx
specificity reference.

Validation after this stage: `rg "<style jsx" lib/containers lib/components`
should show only the Pattern B and C files.

### Stage 3: Pattern C migration (global selectors)

1. `lib/components/style-sheet.tsx` → `lib/components/style-sheet.module.css`
   - Use a `.host` class with `:global(...)` wrappers for
     `::-webkit-scrollbar`, `::-webkit-scrollbar-thumb`, and
     `::-webkit-scrollbar-thumb:window-inactive`.
   - Pass the dynamic `borderColor` as a CSS custom property via the `style`
     attribute on the host element.
   - Replace the `<style jsx global>` block with the imported module class.

2. `lib/components/term.tsx` → `lib/components/term.module.css`
   - Move `.term_fit` and `.term_wrapper` into the module.
   - These classes are only used inside `Term` render output, so they do not
     need `:global()`.
   - Preserve the legacy class names (`term_fit`, `term_wrapper`) on the
     elements for plugin compatibility, applying both the module token and the
     legacy string.
   - Remove the `<style jsx global>` block.

Validation after this stage: only Pattern B files remain with `<style jsx`.

### Stage 4: Pattern B migration (local dynamic styles)

1. `lib/components/searchBox.tsx` → `lib/components/searchBox.module.css`
   - Map dynamic colours (`foregroundColor`, `selectionColor`,
     `backgroundColor`, `borderColor`) and `font` to CSS custom properties.
   - The `SearchButton` inner component receives the same custom properties via
     an inline `style` object on its root div.
   - Remove both `<style jsx>` blocks.

2. `lib/components/tabs.tsx` → `lib/components/tabs.module.css`
   - Replace `isMac` interpolations with modifier classes:
     `tabsNavMac`, `tabsNavNonMac`, `tabsListMacOffset`.
   - Use `clsx` to conditionally apply modifiers.
   - Remove the `<style jsx>` block.

3. `lib/components/new-tab.tsx` → `lib/components/new-tab.module.css`
   - Map `borderColor` to a CSS custom property.
   - Replace the `isMac` conditional for `-webkit-app-region` with a modifier
     class.
   - Remove the `<style jsx>` block.

Validation after this stage: `rg "<style jsx" lib/containers lib/components`
must return no matches.

### Stage 5: Tests and contract updates

1. Update `test/unit/esbuild-migration-contracts.test.ts`:
   - Replace the styled-jsx bridge translation test with a CSS Module
     bundling test that asserts `.module.css` imports produce filename-prefixed
     scoped class names (e.g., `fixture_searchBox`) in the renderer bundle.
   - Keep the `usesStyledJsx` detection test if the bridge plugin still
     exists, or rewrite it to assert the detection helper is removed in
     `1.4.18`.

2. Add component-level parity tests where style behaviour is non-trivial:
   - `test/unit/search-box-css-modules.test.tsx`: assert that `SearchBox`
     renders with the expected CSS custom properties and module class names.
   - `test/unit/tabs-css-modules.test.tsx`: assert that `Tabs` applies the
     correct platform modifier classes.
   - `test/unit/style-sheet-css-modules.test.tsx`: assert that `StyleSheet`
     renders a host element with the scrollbar custom property.

3. Run the full test suite and confirm no regressions.

### Stage 6: Documentation and roadmap update

1. Review `docs/developers-guide.md` §CSS Modules conventions. If any new
   pattern emerged during migration (for example, a convention for preserving
   legacy plugin-targeted class names), add a short paragraph and example.
2. In `docs/roadmap.md`, change the status of item `1.4.17` from `[ ]` to
   `[x]`.

## Concrete steps

All commands are run from the repository root (`<repository-root>`).

### Step 1: Prepare the pipeline

```bash
# Edit build/esbuild/run-esbuild.ts to add '.module.css': 'local-css'
# Create typings/css-modules.d.ts
# Edit test/unit/esbuild-migration-contracts.test.ts to add CSS Module contract test
```

Validate:

```bash
make build
make lint
make test
```

Expected: all pass with no new warnings.

### Step 2: Migrate Pattern-A files

For each file, run a focused build and lint check:

```bash
# After editing a batch of Pattern A files:
make build
make lint
bun test test/unit/notification.test.ts test/unit/hyper-effects.test.ts test/unit/hyper-transport.test.ts
```

Expected: build succeeds, lint is clean, targeted tests pass.

### Step 3: Migrate Pattern C files

```bash
# After editing style-sheet.tsx and term.tsx:
make build
make lint
bun test test/unit/term-report-renderer.test.ts
```

Expected: build succeeds, lint is clean, term tests pass.

### Step 4: Migrate Pattern B files

```bash
# After editing searchBox.tsx, tabs.tsx, and new-tab.tsx:
make build
make lint
bun test test/unit/tabs-decoration-updates.test.ts
```

Expected: build succeeds, lint is clean, tab tests pass.

### Step 5: Add parity tests

```bash
# Create new test files and run them:
bun test test/unit/search-box-css-modules.test.tsx
bun test test/unit/tabs-css-modules.test.tsx
bun test test/unit/style-sheet-css-modules.test.tsx
```

Expected: each new test fails before the migration change and passes after.

### Step 6: Full gate sequence

```bash
bun install
make build
make check-fmt
make lint
make test
```

Expected transcript (abridged):

```plaintext
$ make build
  ... esbuild completes ...
$ make check-fmt
  All matched files use Biome code style.
$ make lint
  lint: ok
$ make test
  test: ok
```

### Step 7: Static migration verification

```bash
rg "<style jsx" lib/containers lib/components
rg "styled-jsx/style" dist/app dist/lib
```

Expected: both commands return no matches.

## Validation and acceptance

Quality criteria (what "done" means):

- Tests: `make test` passes, including all unit tests and the updated
  migration contract tests.
- Lint/typecheck: `make lint` and `make check-fmt` pass with no errors.
- Static verification: no `<style jsx` remains in `lib/components` or
  `lib/containers`.
- Build verification: `make build` produces a renderer bundle with no
  `styled-jsx/style` runtime imports.
- Documentation: `docs/developers-guide.md` is accurate, and `docs/roadmap.md`
  marks `1.4.17` as done.

Quality method (verification steps):

- Run the full gate sequence (`bun install`, `make build`, `make check-fmt`,
  `make lint`, `make test`) locally.
- Run the static verification commands (`rg`) to confirm zero styled-jsx
  callsites.
- Review the diff to ensure no unintended backend or shared module changes.

## Idempotence and recovery

- Pipeline changes (Stage 1) are safe to repeat; esbuild options are
  idempotently overwritten.
- Component migrations (Stages 2–4) can be reverted file-by-file by restoring
  the original TSX and deleting the new `.module.css` files.
- If a stage fails validation, revert the files in that stage and retry
  without affecting earlier stages.
- Do not commit until the full gate sequence passes.

## Artifacts and notes

No implementation artifacts yet. This section will hold concise transcripts
after each stage.

## Interfaces and dependencies

- **esbuild**: the renderer build uses esbuild's built-in `local-css` loader
  for `*.module.css`. No new dependency is required.
- **clsx**: already used throughout the renderer; continue using it for
  conditional class application.
- **CSS custom properties**: use the `style` attribute to pass dynamic values
  into module scopes.
- **TypeScript declarations**: `typings/css-modules.d.ts` must declare
  `*.module.css` default exports as `Readonly<Record<string, string>>`.

Example module declaration:

```ts
// typings/css-modules.d.ts
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
```

Example esbuild loader update:

```ts
// build/esbuild/run-esbuild.ts
loader: {
  ...(baseBuildOptions.loader ?? {}),
  '.css': 'css',
  '.module.css': 'local-css'
}
```

## Revision note

- 2026-03-29: Initial draft. Awaiting approval before implementation.
