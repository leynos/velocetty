# styled-jsx Inventory

This document provides an exhaustive inventory of all `styled-jsx` usage in the
Velocetty repository. It serves as a reference for the migration to CSS Modules
(roadmap items 1.4.17 and 1.4.18).

## Overview

The repository contains **13 styled-jsx blocks** across **12 files**:

| File | Pattern | Block Count | Dynamic Values |
| ---- | ------- | ----------- | -------------- |
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

## Pattern Classification

### Pattern A: Local Static (7 blocks)

CSS rules with no dynamic interpolation. These are the simplest to migrate.

**Files:**

- `lib/components/terms.tsx`
- `lib/components/header.tsx`
- `lib/components/notifications.tsx`
- `lib/components/split-pane.tsx`
- `lib/components/notification.tsx`
- `lib/components/tab.tsx`
- `lib/containers/hyper.tsx`

### Pattern B: Local Dynamic (4 blocks)

CSS rules with `${...}` interpolation for theme values or platform conditionals.
These require mapping dynamic values to CSS custom properties.

**Files:**

- `lib/components/searchBox.tsx` (2 blocks)
- `lib/components/tabs.tsx`
- `lib/components/new-tab.tsx`

### Pattern C: Global Selectors (2 blocks)

Uses `<style jsx global>` for global selectors (pseudo-elements like
`::-webkit-scrollbar`).

**Files:**

- `lib/components/style-sheet.tsx` - Global scrollbar styles with dynamic
  `borderColor`
- `lib/components/term.tsx` - `.term_fit` and `.term_wrapper` classes marked
  global but only used locally

## Detailed File Analysis

### `lib/components/terms.tsx`

**Pattern:** A (local static)
**Classes:** `.terms_terms`, `.terms_termsShifted`
**Features:** Keyframe animation `@keyframes shift-down`
**Migration Notes:** Straightforward CSS Module migration; animations work
identically.

### `lib/components/searchBox.tsx`

**Pattern:** B (local dynamic)
**Blocks:** 2 (SearchButton component + search container)
**Dynamic Values:**

- `foregroundColor` - text colour
- `selectionColor` - focus outline, active state background
- `backgroundColor` - hover state, container background
- `borderColor` - container border, input outline
- `font` - font-family for container

**Migration Notes:** Create CSS custom properties for each dynamic value. The
SearchButton component has internal styled-jsx that receives theme colours via
props.

### `lib/components/header.tsx`

**Pattern:** A (local static)
**Classes:** `.header_header`, `.header_windowHeader`
**Migration Notes:** Uses inline `style={{borderColor}}` for dynamic border;
static styles migrate directly to CSS Module.

### `lib/components/notifications.tsx`

**Pattern:** A (local static)
**Classes:** `.notifications`
**Migration Notes:** Single class, no dynamic values.

### `lib/components/term.tsx`

**Pattern:** C (global)
**Classes:** `.term_fit`, `.term_wrapper`
**Migration Notes:** Despite `global` attribute, these classes are only used
within the `Term` component render output and can migrate to regular CSS Module
classes without `:global()`.

### `lib/components/split-pane.tsx`

**Pattern:** A (local static)
**Classes:** `.splitpane`, `.splitpane_divider`
**Migration Notes:** Uses inline `style={{borderColor}}` for divider colour.

### `lib/components/notification.tsx`

**Pattern:** A (local static)
**Classes:** `.notification`, `.notification_active`
**Migration Notes:** Uses inline `style=` for background and text colours.

### `lib/components/tabs.tsx`

**Pattern:** B (local dynamic)
**Classes:** `.tabs_nav`, `.tabs_list`
**Dynamic Values:** `isMac` conditional for:

- `-webkit-app-region: drag` (Mac only)
- `top: 0px` (Mac) vs `top: 34px` (non-Mac)
- `margin-left: 76px` (Mac only)

**Migration Notes:** Use modifier classes (`tabsNavMac`, `tabsNavNonMac`) with
`clsx` for conditional application.

### `lib/components/tab.tsx`

**Pattern:** A (local static)
**Classes:** `.tab_tab`, `.tab_text`, `.tab_icon`
**Migration Notes:** Uses inline `style={{borderColor}}` for active indicator.

### `lib/components/new-tab.tsx`

**Pattern:** B (local dynamic)
**Classes:** `.new-tab`
**Dynamic Values:** `borderColor`, `isMac` (for different positioning)
**Migration Notes:** Combine CSS custom property for colour with modifier class
for platform conditional.

### `lib/components/style-sheet.tsx`

**Pattern:** C (global)
**Selectors:** `::-webkit-scrollbar`, `::-webkit-scrollbar-thumb`,
`::-webkit-scrollbar-thumb:window-inactive`
**Dynamic Values:** `borderColor` (scrollbar thumb background)
**Migration Notes:** Only file requiring `:global()` wrapper. Use CSS custom
property for dynamic thumb colour scoped to a container element.

### `lib/containers/hyper.tsx`

**Pattern:** A (local static)
**Classes:** `.hyper_main`, `.hyper_mainRounded`
**Migration Notes:** Uses inline `style=` for theme values. Static border and
border-radius styles migrate directly.

## Migration Priority

### Phase 1: Pattern A (Parallel-safe)

Files with no dynamic values can be migrated in any order:

1. `lib/components/terms.tsx`
2. `lib/components/header.tsx`
3. `lib/components/notifications.tsx`
4. `lib/components/split-pane.tsx`
5. `lib/components/notification.tsx`
6. `lib/components/tab.tsx`
7. `lib/containers/hyper.tsx`

### Phase 2: Pattern C (Foundational)

Migrate before dependent components:

1. `lib/components/style-sheet.tsx` - Global scrollbar styles

### Phase 3: Pattern B (Complex)

Migrate after establishing patterns for dynamic values:

1. `lib/components/searchBox.tsx` - Most complex (2 blocks, multiple dynamic
   values)
2. `lib/components/tabs.tsx` - Platform conditionals
3. `lib/components/new-tab.tsx` - Combined colour + platform conditional
4. `lib/components/term.tsx` - "Global" classes that are actually local

## Post-Migration Cleanup

After all components are migrated, remove:

- `build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin.ts`
- `typings/styled-jsx.d.ts`
- `styled-jsx` from `dependencies` in `package.json`
- Bridge-only Babel dependencies (`@babel/core`, `@babel/preset-react`,
  `@babel/preset-typescript`)
- Bridge plugin registration from `build/esbuild/run-esbuild.ts`

See the decommission checklist in
`docs/execplans/1-4-16-styled-jsx-to-css-modules-migration-approach-and-inventory.md`
for complete details.

## Cross-References

- ExecPlan:
  `docs/execplans/1-4-16-styled-jsx-to-css-modules-migration-approach-and-inventory.md`
- ADR-002: `docs/adr-002-replace-webpack-babel-with-esbuild.md`
- Developers' Guide: `docs/developers-guide.md` §CSS Modules conventions
