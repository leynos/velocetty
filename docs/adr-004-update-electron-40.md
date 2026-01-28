# Architectural decision record (ADR) 004: Update to Electron 40

## Status

Accepted (Option B: Incremental upgrades).

## Date

2026-01-28.

## Context and Problem Statement

The application currently targets Electron 22, which is several major releases
behind current Electron. Electron 40 ships with updated Chromium, V8, and Node
versions and deprecates some renderer APIs. Staying on an older version
increases security and compatibility risk, but upgrading may require native
module rebuilds and API changes.[^electron-40-release][^electron-40-blog]

## Decision Drivers

- Keep the Electron runtime aligned with current supported releases.
- Maintain compatibility with modern operating systems and security updates.
- Reduce long-term maintenance by avoiding a large version gap.

## Options Considered

### Option A: Stay on Electron 22

This avoids immediate upgrade work but keeps the application on an older
runtime stack.

### Option B: Incremental major upgrades (e.g. 22 → 28 → 34 → 40)

Stepping through major versions reduces the size of each change set. It also
limits the number of simultaneous API and dependency updates.

### Option C: Jump directly to Electron 40

This accelerates access to the newest runtime, but it increases the risk of
breaking changes landing at once, especially for native modules and build
pipelines.

| Topic | Electron 22 | Electron 28 | Electron 34 | Electron 40 |
| --- | --- | --- | --- | --- |
| Chromium | Older release | Chromium 120.0.6099.56[^electron-28-release] | Chromium 132.0.6834.83[^electron-34-release] | Chromium 144.0.7559.60[^electron-40-blog] |
| Node.js | Older release | Node 18.18.2[^electron-28-release] | Node 20.18.1[^electron-34-release] | Node 24.11.1[^electron-40-blog] |
| V8 | Older release | V8 12.0.267.8[^electron-28-release] | V8 13.2.152.27[^electron-34-release] | V8 14.4[^electron-40-blog] |
| API changes | Stable legacy APIs | See release notes[^electron-28-release] | See release notes[^electron-34-release] | Renderer clipboard API deprecated[^electron-40-blog] |

_Table 1: High-level runtime changes between Electron 22, 28, 34, and 40._

## Decision Outcome / Proposed Direction

Pursue an incremental upgrade path, stepping through major Electron releases
until Electron 40 is reached. This balances stability with the need to close
the version gap, while giving time to rebuild native modules and validate
packaging changes.[^electron-40-blog]

## Goals and Non-Goals

### Goals

- Upgrade the runtime stack to Electron 40.
- Keep native modules (for example, node-pty) working across upgrades.
- Preserve application behaviour and packaging outputs.

### Non-Goals

- Introducing new Electron features unrelated to compatibility upgrades.
- Refactoring the renderer architecture beyond what the upgrade requires.

## Migration Plan

### Phase 1: Preparation

- Audit native dependencies for Node 24 compatibility.[^electron-40-release]
- Record current Electron APIs used in renderer and main processes.

### Phase 2: Stepwise upgrades

- Upgrade to the next major Electron release, rebuild native modules, and run
  the test suite.
- Repeat for each major step until Electron 40 is reached.

### Phase 3: Electron 40 validation

- Address Electron 40 breaking changes such as the renderer clipboard API
  deprecations.[^electron-40-blog]
- Validate macOS packaging outputs after the dSYM archive format change.
  [^electron-40-blog]

## Known Risks and Limitations

- Native module compatibility with Node 24 requires rebuilds and may need
  upstream updates.[^electron-40-release]
- API deprecations in the renderer process may require refactors.

## Outstanding Decisions

- Which intermediate Electron versions to use for staged upgrades.
- Whether to enforce stricter CI checks on Electron API deprecations.

## Architectural Rationale

Electron 40 brings a modern runtime stack and security baseline. A staged
upgrade reduces operational risk while aligning the application with the latest
supported Electron release.[^electron-40-release]

[^electron-40-release]: <https://www.electronjs.org/releases/stable?version=40>
[^electron-40-blog]: <https://www.electronjs.org/blog/electron-40-0>
[^electron-28-release]: <https://releases.electronjs.org/release/v28.0.0>
[^electron-34-release]: <https://releases.electronjs.org/release/v34.0.0>
