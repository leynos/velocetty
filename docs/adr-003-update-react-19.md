# Architectural decision record (ADR) 003: Update to React 19

## Status

Proposed.

## Date

2026-01-28.

## Context and Problem Statement

The project currently uses React 18.2 and relies on React DOM rendering in the
renderer process. React 19 introduces new features and removes legacy APIs.
Upgrading reduces technical debt and keeps the project aligned with current
React support, but it also requires adopting the new JSX transform and removing
UMD bundle usage.[^react-19-upgrade][^react-19-jsx]

## Decision Drivers

- Keep the UI stack on a supported React version.
- Reduce exposure to deprecated APIs and legacy build modes.
- Ensure the test and rendering stack is compatible with React 19 changes.

## Options Considered

### Option A: Stay on React 18.2

This avoids migration work but leaves the codebase behind current React
features and deprecations, and it defers required JSX and build changes.

### Option B: Incremental upgrade (React 18.3, then 19)

React 19 introduces breaking changes such as the removal of UMD builds and
legacy string refs, along with test renderer deprecations. React recommends
using the new JSX transform and provides an upgrade guide with change
summaries.[^react-19-upgrade][^react-19-jsx] An incremental path lowers risk by
addressing warnings early.

### Option C: Jump directly to React 19

This is faster in calendar time, but it increases the chance of conflicts in
build tooling, tests, and runtime behaviour during the migration.

| Topic | React 18.2 | React 19 |
| --- | --- | --- |
| JSX transform | Legacy allowed | New JSX transform required[^react-19-jsx] |
| UMD builds | Available | Removed[^react-19-upgrade] |
| String refs | Supported | Removed[^react-19-upgrade] |
| Test renderer | Available | Deprecated[^react-19-upgrade] |

_Table 1: High-level upgrade impacts from React 18.2 to React 19._

## Decision Outcome / Proposed Direction

Adopt an incremental upgrade: move to React 18.3 first, address warnings and
JSX transform changes, then upgrade to React 19. This reduces migration risk
and aligns with React's documented upgrade guidance.[^react-19-upgrade]

## Goals and Non-Goals

### Goals

- Update the renderer to React 19 with the new JSX transform.
- Remove reliance on deprecated or removed APIs.
- Keep the UI test suite working after the upgrade.

### Non-Goals

- Re-architect the UI component structure.
- Replace React with another UI framework.

## Migration Plan

### Phase 1: React 18.3 alignment

- Upgrade React and React DOM to 18.3.
- Enable the new JSX transform in build and TypeScript settings.
- Address warnings surfaced by the upgrade guide.

### Phase 2: React 19 upgrade

- Upgrade React and React DOM to 19.
- Remove any string refs and update test utilities.
- Validate build and runtime behaviour in the Electron renderer.

## Known Risks and Limitations

- The new JSX transform may require changes to existing build tooling and test
  configuration.[^react-19-jsx]
- Removal of UMD builds affects any legacy global React references.

## Outstanding Decisions

- Whether to add a codemod pass to remove string refs and legacy patterns.
- Whether to introduce new React 19 features or stay conservative.

## Architectural Rationale

Keeping React up to date supports maintainability and reduces the cost of
future upgrades, while an incremental path minimises migration risk for the
Electron renderer stack.[^react-19-upgrade]

[^react-19-upgrade]: <https://react.dev/blog/2024/04/25/react-19-upgrade-guide>
[^react-19-jsx]: <https://az.react.dev/blog/2024/04/25/react-19-upgrade-guide>
