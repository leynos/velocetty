# Publish the styled-jsx-to-CSS-Modules migration approach and inventory

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Velocetty currently depends on `styled-jsx` for component styling in the
renderer process. This creates a hard dependency on Babel transforms, which
blocks the full removal of Babel from the build pipeline (see Architectural
Decision Record ADR-002).

This ExecPlan documents the migration approach for roadmap item 1.4.16. It is
a **planning and documentation task only** - no source files are modified. The
deliverable is a self-contained reference document that will guide subsequent
implementation work in roadmap items 1.4.17 (component migration) and 1.4.18
(Babel bridge removal).

This document provides:

1. An exhaustive inventory of all `styled-jsx` callsites in the repository.
2. Classification of each callsite by migration pattern (local static, local
   dynamic, global selectors).
3. Definition of the target renderer styling model (CSS Modules for local scope,
   CSS custom properties for dynamic values, `:global()` for app-wide selectors).
4. Worked examples tied to actual repository files.
5. An explicit decommission checklist for removing Babel bridge and styled-jsx
   dependencies after component migration is complete.

Success is measured by the completeness and clarity of this documentation,
not by code changes. Implementation is explicitly out of scope for this task.

## Constraints

Hard invariants that must hold throughout implementation:

- Do not change component behaviour or visual appearance during migration.
- Preserve existing class names that may be targeted by plugins or user CSS.
- Maintain TypeScript type safety for all CSS Module imports.
- Keep all quality gates passing: `bun install`, `make build`, `make check-fmt`,
  `make lint`, and `make test`.
- Do not introduce new runtime dependencies for styling.
- The migration approach document must be complete before implementation
  (roadmap item 1.4.16) begins.

## Tolerances (exception triggers)

Thresholds that trigger escalation when breached:

- **Scope:** If the inventory reveals more than 20 `styled-jsx` blocks (current
  count: 13), stop and escalate.
- **Interface:** If a public component API must change to accommodate the
  migration, stop and escalate.
- **Dependencies:** If CSS Modules support requires a new esbuild plugin
  (beyond esbuild's built-in `local-css` loader), stop and escalate.
- **Ambiguity:** If a styled-jsx block cannot be clearly classified into one of
  the three patterns (local static, local dynamic, global), stop and present
  options.
- **Time:** If creating the inventory and migration approach exceeds 4 hours,
  stop and escalate.

## Risks

Known uncertainties that might affect the plan:

- **Risk:** Global scrollbar styles in `style-sheet.tsx` may not behave
  identically when moved to CSS Modules with `:global()` selectors.
  - Severity: medium
  - Likelihood: medium
  - Mitigation: Include explicit visual parity tests in the deep end-to-end
  (E2E) lane that
    verify scrollbar appearance.

- **Risk:** Dynamic theme values interpolated into styled-jsx may not translate
  cleanly to CSS custom properties.
  - Severity: low
  - Likelihood: low
  - Mitigation: The worked examples demonstrate CSS custom property mapping;
    validate with the `searchBox.tsx` migration as a proof of concept.

- **Risk:** Platform-dependent values (`isMac` conditionals) may require
  significant refactoring.
  - Severity: low
  - Likelihood: low
  - Mitigation: Use modifier class pattern demonstrated in worked examples;
  existing `clsx` usage makes this straightforward.

- **Risk:** Plugin compatibility may be affected if plugins rely on styled-jsx
  class name conventions.
  - Severity: medium
  - Likelihood: low
  - Mitigation: Preserve legacy class names during migration; document any
    intentional breaking changes in the decommission checklist.

## Progress

This section tracks completion of the planning task (1.4.16). Implementation
is deferred to roadmap items 1.4.17 and 1.4.18.

- [x] (2026-03-27 19:50Z) Inventory all `styled-jsx` callsites in repository.
- [x] (2026-03-27 20:00Z) Classify callsites by migration pattern
  (local static, local dynamic, global).
- [x] (2026-03-27 20:10Z) Define target renderer styling model.
- [x] (2026-03-27 20:15Z) Create worked examples for each pattern type.
- [x] (2026-03-27 20:20Z) Draft decommission checklist for 1.4.18.
- [x] Await user approval of this plan.
- [x] Upon approval: Update `docs/developers-guide.md` with CSS Modules conventions.
- [x] Upon approval: Mark roadmap item 1.4.16 as "done".

## Surprises & Discoveries

- Observation: The inventory revealed that most styled-jsx blocks (7 of 13) are
  already static with no dynamic interpolation, making migration straightforward.
  Evidence: Agent team analysis of all 12 files with styled-jsx usage.
  Impact: Pattern A migrations can proceed in parallel with minimal risk.

- Observation: Two files (`searchBox.tsx` and `new-tab.tsx`) have multiple
  styled-jsx blocks, but they follow the same pattern within each file.
  Evidence: searchBox.tsx has 2 Pattern B blocks; new-tab.tsx has 1 Pattern B.
  Impact: These should be migrated together as single units of work.

- Observation: The "global" blocks in `term.tsx` are actually component-local
  in practice and can migrate to regular CSS Modules without `:global()`.
  Evidence: The `.term_fit` and `.term_wrapper` classes are only used within
  `Term` component render output.
  Impact: Only `style-sheet.tsx` truly needs the `:global()` wrapper.

## Decision Log

- **Decision:** Document migration approach in ExecPlan format per skill
  requirements.
  - Rationale: Provides living document that can be updated during
    implementation; meets quality gates for planning tasks.
  - Date/Author: 2026-03-27

- **Decision:** Use CSS Modules `local-css` loader (esbuild native) rather than
  third-party plugins.
  - Rationale: Minimises dependencies; esbuild has first-class support; aligns
    with project's esbuild-first direction (ADR-002).
  - Date/Author: 2026-03-27

- **Decision:** Map dynamic styled-jsx values to CSS custom properties rather
  than inline styles.
  - Rationale: Preserves cascade and theming behaviour; allows pseudo-class
  states (`:hover`, `:focus`) to access dynamic values.
  - Date/Author: 2026-03-27

## Outcomes & Retrospective

(To be completed after plan approval.)

## Relationship to other roadmap items

This plan (1.4.16) is **documentation only** and does not modify any source
files. The subsequent implementation tasks are:

- **1.4.17:** Migrate renderer style blocks from styled-jsx to CSS Modules.
  This will implement the patterns documented here, creating the `*.module.css`
  files and updating component imports.

- **1.4.18:** Remove styled-jsx bridge tooling and bridge-only Babel
  dependencies. This will use the decommission checklist documented here.

## Context and orientation

### Current state

The Velocetty renderer uses `styled-jsx` for component-scoped CSS. The build
pipeline includes a Babel bridge plugin
(`build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts`) that
invokes `@babel/core` with `styled-jsx/babel` to transform `<style jsx>` blocks
at build time. This adds complexity and prevents full Babel removal.

Key files involved:

- `build/esbuild/run-esbuild.ts` - esbuild entrypoint that registers the Babel
  bridge plugin.
- `build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts` - Babel
  bridge implementation.
- `typings/styled-jsx.d.ts` - TypeScript declarations for JSX attributes.
- `lib/components/*.tsx` - Renderer components with `<style jsx>` blocks.
- `lib/containers/hyper.tsx` - Root container with styled-jsx.

### Styled-jsx inventory (current state)

The repository contains **13 styled-jsx blocks** across **12 files**:

| File | Pattern | Block Count | Dynamic Values |
| ---- | ------- | ----------- | ---------------- |
| `lib/components/terms.tsx` | A (local static) | 1 | None |
| `lib/components/searchBox.tsx` | B (local dynamic) | 2 | `foregroundColor`, `selectionColor`, `backgroundColor`, `borderColor`, `font` |
| `lib/components/header.tsx` | A (local static) | 1 | None (uses inline `style=` for `borderColor`) |
| `lib/components/notifications.tsx` | A (local static) | 1 | None |
| `lib/components/term.tsx` | C (global) | 1 | None |
| `lib/components/split-pane.tsx` | A (local static) | 1 | None (uses inline `style=` for `borderColor`) |
| `lib/components/notification.tsx` | A (local static) | 1 | None (uses inline `style=` for colors) |
| `lib/components/tabs.tsx` | B (local dynamic) | 1 | `isMac` platform conditionals |
| `lib/components/tab.tsx` | A (local static) | 1 | None (uses inline `style=` for `borderColor`) |
| `lib/components/new-tab.tsx` | B (local dynamic) | 1 | `borderColor`, `isMac` |
| `lib/components/style-sheet.tsx` | C (global) | 1 | `borderColor` |
| `lib/containers/hyper.tsx` | A (local static) | 1 | None (uses inline `style=` for theme) |

**Pattern A (local static):** 7 blocks - CSS rules with no dynamic interpolation.

**Pattern B (local dynamic):** 4 blocks - CSS rules with `${...}` interpolation
for theme values or platform conditionals.

**Pattern C (global):** 2 blocks - Uses `<style jsx global>` for global
selectors (pseudo-elements like `::-webkit-scrollbar`).

## Plan validation

This section documents how to validate that this plan is complete and correct.

### Documentation completeness check

Verify the plan contains:

1. Inventory of all styled-jsx callsites with classification.
2. Target renderer styling model definition.
3. Worked examples for each pattern type tied to repository files.
4. Decommission checklist for Babel bridge and styled-jsx removal.

### Quality gates (no code changes)

As this is a documentation-only task, the quality gates verify no unintended
modifications:

```bash
# Verify inventory accuracy
rg '<style jsx' lib/components lib/containers | wc -l
# Should output 13

# Verify no source files were modified
git diff --stat lib/ app/
# Should show no changes

# Standard gates must still pass
bun install && make build && make check-fmt && make lint && make test
```

## Target renderer styling model

### CSS Modules for local scope

All component-local styles move to `*.module.css` files co-located with their
components:

```css
/* lib/components/header.module.css */
.headerHeader {
  position: fixed;
  top: 1px;
  left: 1px;
  right: 1px;
  z-index: 100;
}

.headerWindowHeader {
  height: 34px;
  width: 100%;
  /* ... */
}
```

Imported as:

```tsx
// lib/components/header.tsx
import styles from './header.module.css';

// Usage
<header className={styles.headerHeader}>
```

### CSS custom properties for dynamic values

Dynamic theme values that were interpolated into styled-jsx use CSS custom
properties (variables) passed via the `style` prop:

```tsx
// Before (styled-jsx)
<style jsx>{`
  .search-button {
    color: ${foregroundColor};
  }
  .search-button:focus {
    outline: ${selectionColor} solid 2px;
  }
`}</style>

// After (CSS Modules + CSS variables)
// In CSS module:
// .searchButton {
//   color: var(--search-fg);
// }
// .searchButton:focus {
//   outline: var(--search-selection) solid 2px;
// }

const searchVars: React.CSSProperties = {
  '--search-fg': foregroundColor,
  '--search-selection': selectionColor,
};

<div className={styles.searchButton} style={searchVars}>
```

Benefits:

- Pseudo-classes (`:hover`, `:focus`) can access dynamic values.
- Preserves cascade behaviour.
- No inline style proliferation.
- Type-safe via `React.CSSProperties` with CSS custom property augmentation.

### Explicit global path for app-wide selectors

Truly global selectors (like webkit scrollbar pseudo-elements) use CSS Modules
`:global()` wrapper:

```css
/* lib/components/style-sheet.module.css */
.host {
  --scrollbar-thumb: transparent;
}

.host :global(::-webkit-scrollbar) {
  width: 5px;
}

.host :global(::-webkit-scrollbar-thumb) {
  border-radius: 10px;
  background: var(--scrollbar-thumb);
}
```

Usage:

```tsx
import styles from './style-sheet.module.css';

<div className={styles.host} style={{'--scrollbar-thumb': borderColor}}>
```

This keeps global effects explicit and scoped to a container element.

### Platform conditional pattern

Platform-dependent values (`isMac` conditionals) become explicit modifier
classes:

```tsx
// Before (styled-jsx)
<style jsx>{`
  .tabs_nav {
    -webkit-app-region: ${isMac ? 'drag' : ''};
    top: ${isMac ? '0px' : '34px'};
  }
  .tabs_list {
    margin-left: ${isMac ? '76px' : '0'};
  }
`}</style>

// After (CSS Modules + clsx)
// In CSS:
// .tabsNavMac { -webkit-app-region: drag; top: 0; }
// .tabsNavNonMac { top: 34px; }
// .tabsListMacOffset { margin-left: 76px; }

<nav className={clsx(styles.tabsNav, isMac ? styles.tabsNavMac : styles.tabsNavNonMac)}>
<ul className={clsx(styles.tabsList, isMac && styles.tabsListMacOffset)}>
```

## Worked examples from this repository

### Example 1: Pattern A - Local static (terms.tsx)

**Source:** `lib/components/terms.tsx`

**Current styled-jsx:**

```tsx
<style jsx>{`
  .terms_terms {
    position: absolute;
    margin-top: 34px;
    top: 0;
    right: 0;
    left: 0;
    bottom: 0;
    color: #fff;
  }
  .terms_termsShifted {
    margin-top: 68px;
    animation: shift-down 0.2s ease-out;
  }
  @keyframes shift-down {
    0% { transform: translateY(-34px); }
    100% { transform: translateY(0px); }
  }
`}</style>
```

**Migration:**

Create `lib/components/terms.module.css`:

```css
.terms {
  position: absolute;
  margin-top: 34px;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  color: #fff;
}

.termsShifted {
  margin-top: 68px;
  animation: shift-down 0.2s ease-out;
}

@keyframes shift-down {
  0% { transform: translateY(-34px); }
  100% { transform: translateY(0px); }
}
```

Update `lib/components/terms.tsx`:

```tsx
import styles from './terms.module.css';

// Change className from 'terms_terms' to styles.terms
<div className={styles.terms}>
```

**Why this is safe:**

- CSS animations work identically in CSS Modules.
- Class names are scoped to the module (no collisions).
- No dynamic values to preserve.

### Example 2: Pattern B - Local dynamic (searchBox.tsx)

**Source:** `lib/components/searchBox.tsx`

**Current styled-jsx (first block):**

```tsx
<style jsx>{`
  .search-button {
    color: ${foregroundColor};
    padding: 2px;
    margin: 4px 0px;
  }
  .search-button:focus {
    outline: ${selectionColor} solid 2px;
  }
  .search-button:hover {
    background-color: ${backgroundColor};
  }
  .search-button-active {
    background-color: ${selectionColor};
  }
`}</style>
```

**Migration:**

Create `lib/components/searchBox.module.css`:

```css
.searchButton {
  cursor: pointer;
  color: var(--search-fg);
  padding: 2px;
  margin: 4px 0;
  height: 18px;
  width: 18px;
  border-radius: 2px;
}

.searchButton:focus {
  outline: var(--search-selection) solid 2px;
}

.searchButton:hover {
  background-color: var(--search-hover-bg);
}

.searchButtonActive,
.searchButtonActive:hover {
  background-color: var(--search-selection);
}
```

Update `lib/components/searchBox.tsx`:

```tsx
import styles from './searchBox.module.css';
import clsx from 'clsx';

// Define CSS custom properties for dynamic values
const searchVars: React.CSSProperties = {
  '--search-fg': foregroundColor,
  '--search-selection': selectionColor,
  '--search-hover-bg': backgroundColor,
};

// Usage
<div
  style={searchVars}
  className={clsx(styles.searchButton, active && styles.searchButtonActive)}
>
```

Add to `typings/css-modules.d.ts`:

```ts
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
```

**Why this is safe:**

- Dynamic values are preserved via CSS custom properties.
- `:focus` and `:hover` states can access the custom properties.
- Class modifiers (`.searchButtonActive`) handle state without inline styles.

### Example 3: Pattern B - Platform conditional (tabs.tsx)

**Source:** `lib/components/tabs.tsx`

**Current styled-jsx:**

```tsx
<style jsx>{`
  .tabs_nav {
    -webkit-app-region: ${isMac ? 'drag' : ''};
    top: ${isMac ? '0px' : '34px'};
  }
  .tabs_list {
    margin-left: ${isMac ? '76px' : '0'};
  }
`}</style>
```

**Migration:**

Create `lib/components/tabs.module.css`:

```css
.tabsNav {
  font-size: 12px;
  height: 34px;
  line-height: 34px;
  position: relative;
  display: flex;
  flex-flow: row;
}

.tabsNavMac {
  -webkit-app-region: drag;
  top: 0;
}

.tabsNavNonMac {
  top: 34px;
}

.tabsList {
  max-height: 34px;
  display: flex;
  flex-flow: row;
  flex-grow: 1;
}

.tabsListMacOffset {
  margin-left: 76px;
}
```

Update `lib/components/tabs.tsx`:

```tsx
import styles from './tabs.module.css';
import clsx from 'clsx';

<nav
  className={clsx(
    styles.tabsNav,
    isMac ? styles.tabsNavMac : styles.tabsNavNonMac
  )}
>
  <ul className={clsx(styles.tabsList, isMac && styles.tabsListMacOffset)}>
```

**Why this is safe:**

- Platform branches become explicit class choices.
- No runtime string interpolation needed.
- Deterministic class application via `clsx`.

### Example 4: Pattern C - Global scrollbar selectors (style-sheet.tsx)

**Source:** `lib/components/style-sheet.tsx`

**Current styled-jsx:**

```tsx
<style jsx global>{`
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb {
    -webkit-border-radius: 10px;
    border-radius: 10px;
    background: ${borderColor};
  }
`}</style>
```

**Migration:**

Create `lib/components/terms.module.css` (scrollbar rules applied to the
terms container):

```css
.terms {
  --scrollbar-thumb: transparent;
}

.terms :global(::-webkit-scrollbar) {
  width: 5px;
}

.terms :global(::-webkit-scrollbar-thumb),
.terms :global(::-webkit-scrollbar-thumb:window-inactive) {
  border-radius: 10px;
  background: var(--scrollbar-thumb);
}
```

Update `lib/components/terms.tsx` to apply the host class and CSS variable
to the actual content ancestor:

```tsx
import styles from './terms.module.css';

// In render(): the .terms class is on the ancestor that contains scrollbars
<div
  className={clsx(styles.terms, shift && styles.termsShifted)}
  style={{'--scrollbar-thumb': borderColor} as React.CSSProperties}
>
  {/* Terminal content renders here */}
</div>
```

Remove the `StyleSheet` component or have it render `null` after migration,
as its styling responsibility moves to the terms container.

**Why this is safe:**

- The scrollbar selector matches because `.terms` is an ancestor of the
  terminal content (unlike a self-closing sibling element).
- Global pseudo-element selectors remain explicit via `:global()`.
- Dynamic colour remains runtime-configurable through a CSS variable.

### Example 5: Pattern C - Local classes marked global (term.tsx)

**Source:** `lib/components/term.tsx`

**Current styled-jsx:**

```tsx
<style jsx global>{`
  .term_fit { display: block; width: 100%; height: 100%; }
  .term_wrapper { overflow: hidden; }
`}</style>
```

**Migration:**

Create `lib/components/term.module.css`:

```css
.termFit {
  display: block;
  width: 100%;
  height: 100%;
}

.termWrapper {
  overflow: hidden;
}
```

Update `lib/components/term.tsx`:

```tsx
import styles from './term.module.css';
import clsx from 'clsx';

// Preserve legacy class names for tooling compatibility
<div className={clsx(styles.termFit, 'term_fit', 'term_term')}>
  <div className={clsx(styles.termWrapper, 'term_wrapper')}>
```

**Why this is safe:**

- Legacy class names (`.term_fit`, `.term_wrapper`, `.term_term`) are preserved
  for repository tooling compatibility (e.g., E2E buffer reader queries,
  terminal wiring).
- CSS Module classes provide scoped styling while legacy classes maintain
  external selector contracts.
- The `clsx` pattern allows gradual migration without breaking integrations.

## Concrete steps

### Verification commands

Run these commands to validate the repository is in the expected state:

```bash
# Count styled-jsx blocks (should be 13)
rg '<style jsx' lib/components lib/containers --count-matches

# List all files with styled-jsx
rg '<style jsx' lib/components lib/containers -l

# Verify build pipeline works
bun install
make build
make check-fmt
make lint
make test
```

Expected outputs:

- `rg '<style jsx' ... --count-matches` should show 13 matches total.
- All `make` commands should exit with code 0.

## Validation and acceptance

### Quality criteria (what "done" means)

This plan is complete when:

1. **Inventory complete:** All 13 styled-jsx blocks are documented with file
   paths and classifications.
2. **Classification complete:** Each block is classified as Pattern A, B, or C
   with rationale.
3. **Target model defined:** CSS Modules approach is specified for local scope,
   CSS custom properties for dynamic values, and `:global()` for global
   selectors.
4. **Worked examples complete:** At least one worked example exists for each
   pattern type, tied to actual repository files.
5. **Decommission checklist complete:** Explicit steps to remove Babel bridge
   and styled-jsx dependencies are documented.
6. **Gates pass:** `bun install`, `make build`, `make check-fmt`, `make lint`,
   and `make test` all succeed.
7. **Documentation updated:** `docs/developers-guide.md` includes CSS Modules
   conventions.

### Quality method (validation approach)

```bash
# Verify inventory accuracy
rg '<style jsx' lib/components lib/containers | wc -l
# Should output 13

# Verify documentation exists
ls -la docs/execplans/1-4-16-styled-jsx-to-css-modules-migration-approach-and-inventory.md

# Run quality gates
bun install && make build && make check-fmt && make lint && make test
```

## Idempotence and recovery

This plan is read-only documentation. It can be revised and re-published without
side effects. If the plan needs changes:

1. Edit the plan document.
2. Update the `Decision Log` section with rationale.
3. Re-run validation commands to ensure no code changes were accidentally
   introduced.

## Decommission checklist

After roadmap item 1.4.17 (migrate components) is complete, use this checklist
to remove the Babel bridge and styled-jsx dependencies:

- [ ] Remove `createStyledJsxBabelBridgePlugin()` registration from
  `build/esbuild/run-esbuild.ts`.
- [ ] Delete `build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts`.
- [ ] Remove `styledJsxBabelPluginOptions` constant from
  `build/esbuild/constants.ts` if no longer used.
- [ ] Delete `typings/styled-jsx.d.ts`.
- [ ] Remove `styled-jsx` from `dependencies` in `package.json`.
- [ ] Remove bridge-only Babel dependencies:
  - `@babel/core`
  - `@babel/preset-react`
  - `@babel/preset-typescript`
  - Any babel plugin used only for styled-jsx
- [ ] Run `bun install` to update `bun.lock`.
- [ ] Update `test/unit/esbuild-migration-contracts.test.ts` to validate CSS
  Module outputs instead of styled-jsx transforms.
- [ ] Run full gates: `bun install`, `make build`, `make check-fmt`, `make lint`,
  `make test`.
- [ ] Update `docs/roadmap.md` to mark 1.4.18 as done.
- [ ] Update `docs/velocetty-hyper-codebase.md` dependency and build sections.

## Interfaces and dependencies

### esbuild configuration changes

In `build/esbuild/run-esbuild.ts`, add CSS Modules loader:

```ts
// Add to build options
loader: {
  '.module.css': 'local-css',
  '.css': 'css',
},
```

### TypeScript declarations

Create `typings/css-modules.d.ts`:

```ts
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
```

### Dependency changes

**Remove after migration:**

- `styled-jsx` (runtime)
- `@babel/core` (if only used for styled-jsx bridge)
- `@babel/preset-react` (if only used for styled-jsx bridge)
- `@babel/preset-typescript` (if only used for styled-jsx bridge)

**Keep:**

- `esbuild` (already primary bundler)
- `clsx` (already used for conditional classes)

## Revision note

- Initial draft created 2026-03-27.
- Status: DRAFT - awaiting user approval.
