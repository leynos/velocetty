# Migrate styled-jsx to CSS Modules with esbuild and remove Babel

## Module header

- Purpose: Define a repository-specific approach for replacing `styled-jsx`
  usage with CSS Modules (and explicit global CSS where needed) so the
  renderer pipeline no longer depends on Babel transforms.
- Invariants: Preserve renderer behaviour, style scoping, and packaging
  outputs while migration is in flight.
- Cross-links: `docs/roadmap.md`,
  `docs/adr-002-replace-webpack-babel-with-esbuild.md`,
  `docs/developers-guide.md`, `build/esbuild/run-esbuild.ts`,
  `build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts`, and
  `typings/styled-jsx.d.ts`.

Status: PROPOSED

## Purpose and outcome

The current renderer build path still uses a targeted Babel bridge for
`styled-jsx`:

- `build/esbuild/run-esbuild.ts` registers
  `createStyledJsxBabelBridgePlugin()`.
- `build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts` invokes
  `@babel/core` with `@babel/preset-react`, `@babel/preset-typescript`, and
  `styled-jsx/babel`.
- Renderer components still include `<style jsx>` and
  `<style jsx global>` blocks.

This approach removes that dependency chain by migrating component styles to
CSS Modules (`.module.css`) under esbuild-native processing. The migration is
complete when:

1. No renderer components use `styled-jsx` tags.
2. The Babel bridge plugin is removed from the esbuild pipeline.
3. `styled-jsx` and bridge-only Babel dependencies are removed from manifests.
4. Required quality gates pass: `bun install`, `make build`,
   `make check-fmt`, `make lint`, and `make test`.

## Current-state inventory

Repository inventory at proposal time:

- 13 `<style jsx...>` blocks across 12 files in `lib/components` and
  `lib/containers`.
- 2 global style blocks (`<style jsx global>`):
  - `lib/components/style-sheet.tsx`
  - `lib/components/term.tsx`
- `typings/styled-jsx.d.ts` augments JSX types for `jsx` and `global`
  attributes.
- `test/unit/esbuild-migration-contracts.test.ts` contains bridge-specific
  assertions (for example, transformed output references `styled-jsx/style`).

## Target-state architecture

### Renderer styling model

- Component-local styles: `*.module.css` imported into the owning component.
- Truly global styles: one explicit global stylesheet path and/or controlled
  `:global(...)` selectors inside module files.
- Runtime-dynamic style values: CSS custom properties passed via `style`.

### esbuild pipeline changes

- Enable CSS Modules in renderer build options by mapping
  `'.module.css': 'local-css'`.
- Keep `'.css': 'css'` for global or non-module styles.
- Remove `createStyledJsxBabelBridgePlugin()` after component migration.

### TypeScript wiring

Add typings for module imports:

```ts
// typings/css-modules.d.ts
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
```

Remove `typings/styled-jsx.d.ts` after the last `<style jsx>` callsite is
migrated.

## Migration phases

### Phase 1: Prepare pipeline and guardrails

1. Add CSS Modules loader support in
   `build/esbuild/run-esbuild.ts` (`.module.css` -> `local-css`).
2. Add `typings/css-modules.d.ts`.
3. Add migration contract tests that validate CSS Module bundling and class-map
   imports in renderer code.
4. Keep Babel bridge enabled during this phase to avoid mixed-state regressions.

### Phase 2: Component migration by pattern

Migrate callsites in small batches grouped by style pattern.

- Pattern A: local static blocks.
- Pattern B: local dynamic values (`${...}` interpolation).
- Pattern C: global blocks and pseudo-element selectors.

For each file:

1. Create adjacent `*.module.css`.
2. Move rules and replace implicit lexical scoping with explicit class usage.
3. Convert interpolated values to CSS variables or class modifiers.
4. Replace string class names with module tokens.
5. Remove `<style jsx>` block.
6. Add or update targeted tests if style behaviour is non-trivial.

### Phase 3: Remove bridge and dependencies

1. Delete bridge plugin registration from `build/esbuild/run-esbuild.ts`.
2. Remove `build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts`.
3. Remove bridge constants that are no longer used
   (`styledJsxBabelPluginOptions` in `build/esbuild/constants.ts`).
4. Remove `styled-jsx` and bridge-only Babel dependencies from `package.json`
   and refresh lockfile.
5. Remove `typings/styled-jsx.d.ts`.
6. Rewrite bridge-specific contract tests to assert CSS Module outputs and
   runtime behaviour.

### Phase 4: Verify and harden

1. Run full local gates and confirm Continuous Integration (CI) parity.
2. Validate no compiled output references `styled-jsx/style`.
3. Validate no source files contain `<style jsx` usage.
4. Update architecture docs after removal lands.

## Worked examples from this repository

The examples below are based on real files in this repository and show the
recommended migration shape.

### Example 1: `searchBox.tsx` dynamic values and duplicated local blocks

Source file:
`lib/components/searchBox.tsx`

Current pattern (excerpt):

```tsx
<div
  onClick={onClick}
  className={clsx('search-button', {'search-button-active': active})}
>
  {children}
  <style jsx={true}>{`
    .search-button { color: ${foregroundColor}; }
    .search-button:focus { outline: ${selectionColor} solid 2px; }
    .search-button:hover { background-color: ${backgroundColor}; }
  `}</style>
</div>
```

```tsx
<style jsx={true}>{`
  .search-container {
    background-color: ${backgroundColor};
    border: 1px solid ${borderColor};
    font-family: ${font};
  }
`}</style>
```

Proposed `lib/components/searchBox.module.css` (excerpt):

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

.searchContainer {
  background-color: var(--search-bg);
  border: 1px solid var(--search-border);
  border-radius: 2px;
  position: absolute;
  right: 13px;
  top: 4px;
  z-index: 10;
  padding: 4px;
  font-family: var(--search-font);
  font-size: 12px;
}
```

Proposed TSX usage (excerpt):

```tsx
import styles from './searchBox.module.css';

const searchVars: React.CSSProperties = {
  '--search-fg': foregroundColor,
  '--search-selection': selectionColor,
  '--search-hover-bg': borderColor,
  '--search-bg': backgroundColor,
  '--search-border': borderColor,
  '--search-font': font
};

<div
  onClick={onClick}
  style={searchVars}
  className={clsx(styles.searchButton, active && styles.searchButtonActive)}
>
  {children}
</div>
```

Why this mapping is safe:

- Dynamic interpolation is preserved via custom properties.
- Local scoping is explicit and does not rely on transform-time class injection.

### Example 2: `tabs.tsx` platform-dependent values in styled-jsx template

Source file:
`lib/components/tabs.tsx`

Current pattern (excerpt):

```tsx
<style jsx={true}>{`
  .tabs_nav {
    -webkit-app-region: ${isMac ? 'drag' : ''};
    top: ${isMac ? '0px' : '34px'};
  }

  .tabs_list {
    margin-left: ${isMac ? '76px' : '0'};
  }
`}</style>
```

Proposed module strategy:

- Move static structure to `tabs.module.css`.
- Replace interpolated branches with modifier classes.

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

```tsx
<nav
  className={clsx(
    styles.tabsNav,
    isMac ? styles.tabsNavMac : styles.tabsNavNonMac,
    hide && styles.tabsHiddenNav
  )}
>
  <ul className={clsx(styles.tabsList, isMac && styles.tabsListMacOffset)}>
```

Why this mapping is safe:

- Platform branches become explicit class choices.
- No runtime string interpolation is needed for layout-critical values.

### Example 3: `style-sheet.tsx` global scrollbar selectors

Source file:
`lib/components/style-sheet.tsx`

Current pattern:

```tsx
<style jsx={true} global={true}>{`
  ::-webkit-scrollbar-thumb {
    background: ${borderColor};
  }
`}</style>
```

Proposed `style-sheet.module.css`:

```css
.host {
  --scrollbar-thumb: transparent;
}

.host :global(::-webkit-scrollbar) {
  width: 5px;
}

.host :global(::-webkit-scrollbar-thumb),
.host :global(::-webkit-scrollbar-thumb:window-inactive) {
  border-radius: 10px;
  background: var(--scrollbar-thumb);
}
```

Proposed TSX usage:

```tsx
import styles from './style-sheet.module.css';

<div className={styles.host} style={{'--scrollbar-thumb': borderColor} as React.CSSProperties} />
```

Why this mapping is safe:

- Global pseudo-element selectors remain explicit via `:global(...)`.
- Dynamic colour remains runtime-configurable through a CSS variable.
- JSX style attribute augmentation for `jsx/global` is no longer needed.

### Example 4: `term.tsx` global block that is actually local

Source file:
`lib/components/term.tsx`

Current pattern:

```tsx
<style jsx={true} global={true}>{`
  .term_fit { display: block; width: 100%; height: 100%; }
  .term_wrapper { overflow: hidden; }
`}</style>
```

Proposed strategy:

- Move classes into `term.module.css` and import as local module classes.
- Keep legacy class names that may be externally targeted only where required
  for plugin compatibility, with a tracked follow-up to retire them.

Why this mapping is safe:

- The selectors are used inside `Term` render output and do not need global
  reach.

### Example 5: `hyper.tsx` local block plus scoped custom CSS injection

Source file:
`lib/containers/hyper.tsx`

Current pattern:

```tsx
<style jsx={true}>{`
  .hyper_main { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
  .hyper_mainRounded { border-radius: 10.5px; overflow: hidden; }
`}</style>
```

And accompanying comment:

```tsx
{/*
  Add custom CSS to Hyper.
  We add a scope to the customCSS so that it can get around the weighting
  applied by styled-jsx
*/}
<style dangerouslySetInnerHTML={{__html: stylis('#hyper', customCSS)}} />
```

Proposed strategy:

- Move `.hyper_main` and `.hyper_mainRounded` into `hyper.module.css`.
- Update the comment because specificity is no longer dictated by styled-jsx.
- Keep `stylis('#hyper', customCSS)` for user CSS scoping unless a separate
  plugin-CSS design replaces it.

## Risk register and mitigations

- Risk: lexical scoping assumptions from styled-jsx leak when converting to
  descendant selectors.
  - Mitigation: prefer direct class selectors on intended elements; avoid
    broad descendants like `.root p` unless explicitly required.
- Risk: plugin or custom CSS may rely on legacy class names.
  - Mitigation: preserve compatibility classes during migration and remove only
    with explicit plugin compatibility notes.
- Risk: global scrollbar and pseudo-element behaviour changes.
  - Mitigation: keep targeted integration coverage for visual parity in fast and
    deep end-to-end lanes.

## Validation checklist

- Static checks:
  - `rg "<style jsx" lib/containers lib/components` returns no matches.
  - `rg "styled-jsx/style" dist/app dist/lib` returns no matches.
- Gates:
  - `bun install`
  - `make build`
  - `make check-fmt`
  - `make lint`
  - `make test`
- Docs sync:
  - Update `docs/roadmap.md` task status as phases complete.
  - Update `docs/velocetty-hyper-codebase.md` dependency and build sections
    after bridge removal lands.

## Deliverables summary

1. CSS Modules-capable renderer pipeline (`local-css` loader).
2. Migrated renderer callsites with equivalent behaviour.
3. Removal of styled-jsx bridge implementation and type augmentation.
4. Babel dependency removal tied to passing full gates.
5. Updated roadmap and architecture documentation.
