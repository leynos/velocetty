# Architectural decision record (ADR) 002: Replace Webpack and Babel with esbuild

## Status

Accepted (2026-01-28: Option B - Replace with esbuild).

## Date

2026-01-28.

## Context and Problem Statement

The current build pipeline relies on Webpack, Babel, and a collection of
loaders and plugins. This toolchain is flexible, but it brings a large
dependency footprint and slower build times. The project goal is to reduce dev
dependencies and speed up the build process. esbuild is a fast bundler that
supports TypeScript, JSX, and CSS bundling with a smaller dependency surface
and a simpler configuration model.[^esbuild][^esbuild-content]

## Decision Drivers

- Reduce the number of dev dependencies and configuration files.
- Improve build performance and developer feedback loops.[^esbuild]
- Maintain support for TypeScript, JSX, and CSS assets.[^esbuild]
- Preserve required Electron renderer and main process build outputs.

## Requirements

### Functional requirements

- Bundle TypeScript and JSX for renderer and app entry points.
- Support CSS and static asset pipelines currently handled via loaders.
- Preserve source maps for debugging in development builds.

### Technical requirements

- Keep the build system maintainable and well documented.
- Avoid unnecessary runtime dependencies in production artefacts.

## Options Considered

### Option A: Keep Webpack + Babel

Webpack provides a mature loader ecosystem for complex build steps and custom
transforms.[^webpack-loaders] Babel offers fine-grained control over JavaScript
and JSX transforms.[^babel-react] However, the combined dependency and
configuration overhead is high.

### Option B: Replace with esbuild

esbuild includes built-in TypeScript and JSX support and can bundle CSS
alongside JavaScript.[^esbuild][^esbuild-content] It also provides a plugin API
through its JavaScript build interface for custom transforms.[^esbuild-plugins]
This may require re-implementing some Webpack loader behaviour as plugins.

### Option C: Hybrid (Webpack with esbuild-loader)

This approach can improve build speeds while keeping the Webpack ecosystem, but
it retains a large dependency footprint and complex configuration surface. It
also preserves Babel in some pipelines.

| Topic | Webpack + Babel | esbuild |
| --- | --- | --- |
| Performance | Slower builds for large graphs | Designed for speed[^esbuild] |
| Dependency footprint | High (loaders, plugins, Babel) | Lower (single tool) |
| Loader ecosystem | Extensive[^webpack-loaders] | Plugins via JS API[^esbuild-plugins] |
| CSS handling | Via loaders | Built-in CSS bundling[^esbuild-content] |
| TypeScript | Via loader + Babel | Built-in[^esbuild] |

_Table 1: Trade-offs between Webpack/Babel and esbuild._

## Decision Outcome / Proposed Direction

Adopt esbuild as the primary bundler, replacing Webpack and Babel where
feature parity can be achieved. The recommended direction is a phased
migration, starting with renderer builds and expanding to the full pipeline
once plugin and asset handling are validated.

## Goals and Non-Goals

### Goals

- Lower the dependency count by removing redundant build tooling.
- Achieve faster development builds and production bundles.[^esbuild]
- Simplify build configuration with fewer moving parts.

### Non-Goals

- Re-implement every Webpack plugin behaviour if it is not essential.
- Introduce another bundler as a stop-gap.

## Migration Plan

### Phase 1: Capability audit

- Catalogue current Webpack loaders and Babel plugins.
- Identify any transforms that rely on Webpack-specific behaviour.

### Phase 2: Renderer migration

- Build renderer entry points with esbuild.
- Validate CSS and static asset handling.

### Phase 3: Full pipeline

- Migrate remaining build steps and remove Webpack and Babel dependencies.
- Update Continuous Integration (CI) pipelines and documentation to reflect
  the new build flow.

## Known Risks and Limitations

### Loader and transform inventory for this repository

| Current behaviour | Current implementation | esbuild-native replacement | Plugin or bespoke work |
| --- | --- | --- | --- |
| TypeScript + JSX compilation | `babel-loader` + `@babel/preset-typescript` + `@babel/preset-react` in `webpack.config.ts` and `babel.config.json` | esbuild parses and transforms TS/JSX natively[^esbuild][^esbuild-content] | No plugin expected |
| `styled-jsx` scoping transform for `<style jsx>` and `<style jsx global>` | `styled-jsx/babel` plugin + JSX typings augmentation in `typings/styled-jsx.d.ts` | No first-party esbuild equivalent; `styled-jsx` documents Babel plugin integration[^styled-jsx-babel] | **Required**: targeted Babel bridge plugin or source rewrite |
| Numeric separators, class properties, object rest/spread, optional chaining | Babel proposal plugins in `babel.config.json` | esbuild already supports these syntax features and can lower them by target[^esbuild-content] | No plugin expected |
| CSS injection for renderer dependencies (xterm) | `style-loader` + `css-loader` in `webpack.config.ts` | esbuild CSS loader and bundling[^esbuild-content] | No plugin expected |
| JSON module loading | `json-loader` in `webpack.config.ts` | esbuild JSON loader[^esbuild-content] | No plugin expected |
| Copying app HTML/JSON/config/keymaps/static/patches/assets | `copy-webpack-plugin` in `webpack.config.ts` | esbuild only copies assets that are in the module graph; non-imported files need separate handling[^esbuild-content] | **Required**: dedicated copy step (script) or copy plugin |
| "Copy-only" `hyper-app` bundle that discards entry code | `null-loader` on app entry in `webpack.config.ts` | No direct equivalent | **Required**: replace with explicit copy pipeline |
| Shebang handling for CLI dependency edge case | `shebang-loader` for `node_modules/rc/index.js` | esbuild understands hashbang grammar[^esbuild-content] | **Likely bespoke**: verify output; add `banner` fallback if needed[^esbuild-api] |
| Build-time constants | `DefinePlugin` (`process.env.NODE_ENV`) | esbuild `define` option[^esbuild-api] | No plugin expected |
| Ignoring sourcemap and `spawn-sync` imports | `IgnorePlugin` | esbuild `external` patterns and/or resolve filtering[^esbuild-api] | Possible small bespoke resolver plugin |
| Renderer externals with explicit `require("./node_modules/...")` paths | Webpack `externals` object in `webpack.config.ts` | esbuild supports externals, but path mapping semantics must be reproduced carefully[^esbuild-api] | **Required**: bespoke import-path mapping (likely `onResolve`) |
| Production minification/no comments | `TerserPlugin` + post-bundle Babel CLI minify in `package.json` | esbuild `minify` and `legalComments` options[^esbuild-api] | No plugin expected |
| Webpack-specific runtime escape hatch | `__non_webpack_require__` in `lib/v8-snapshot-util.ts` | esbuild does not provide this identifier | **Required**: rewrite shim for bundler-agnostic runtime require |

### Required plugin and bespoke-transform analysis

#### 1. `styled-jsx` transform path (highest migration risk)

- Evidence:
  - `lib/components/**` and `lib/containers/hyper.tsx` use `<style jsx>`.
  - `babel.config.json` applies `styled-jsx/babel`.
  - `typings/styled-jsx.d.ts` augments JSX attributes for `jsx` and `global`.
- Why this is risky:
  - `styled-jsx` documents the transform as a Babel plugin flow, not an esbuild
    native transform.[^styled-jsx-babel]
  - esbuild plugin hooks are intentionally scoped and cannot directly mutate
    esbuild AST internals.[^esbuild-plugins]
- Recommended migration path:
  - Phase 1: keep this transform via a focused Babel bridge plugin in the
    esbuild JavaScript API (for example `@chialab/esbuild-plugin-babel`), only
    for files using `<style jsx>`.[^chialab-esbuild-plugin-babel]
  - Phase 2: reduce/remove Babel dependency by rewriting `styled-jsx` blocks to
    an alternative style strategy (for example CSS modules or explicit runtime
    injection patterns already used for `customCSS`).

#### 2. Static file and copy-only bundle behaviour (required bespoke pipeline)

- Evidence:
  - `hyper-app` build relies on `null-loader` and copy patterns (HTML, JSON,
    config, keymaps, static, optional patches).
  - Renderer build also copies `assets/`.
- Why this is risky:
  - This behaviour is not "bundle code" and is currently encoded as Webpack
    plugin orchestration.
- Recommended migration path:
  - Prefer a deterministic Bun/Node copy step in build scripts (already aligned
    with existing script-first tooling).
  - Use a copy plugin only if watch-mode ergonomics require it (for example
    `esbuild-plugin-copy`).[^esbuild-plugin-copy]
  - Keep copy rules in one manifest-like source to avoid drift.

#### 3. Webpack-specific runtime shim rewrite (required bespoke transform)

- Evidence:
  - `lib/v8-snapshot-util.ts` imports Node's module loader using
    `__non_webpack_require__`.
- Why this is risky:
  - That identifier is Webpack-specific and will not exist in esbuild output.
- Recommended migration path:
  - Rewrite the shim to use a bundler-agnostic runtime require escape hatch
    (for example `eval('require')`) and isolate it behind one utility module.
  - Add an integration test that validates snapshot bootstrap in production
    renderer builds.

#### 4. Externals and ignore semantics (likely bespoke resolver work)

- Evidence:
  - Renderer build has an explicit externals map to concrete file paths under
    `./node_modules/**`.
  - CLI build ignores `spawn-sync`.
- Why this is risky:
  - esbuild `external` is available, but this migration depends on preserving
    require path shape and runtime resolution.
- Recommended migration path:
  - Implement one small `onResolve` plugin to normalize these cases:
    - map selected imports to the exact runtime `require` path shape used today;
    - mark `spawn-sync` and sourcemap artefacts external/ignored.
  - Validate with smoke tests that runtime dependency loading is unchanged.

#### 5. Build API adoption risk

- Evidence:
  - The current build scripts call `webpack-cli`.
- Why this is risky:
  - Any plugin-based migration (Babel bridge, bespoke resolver hooks) requires
    esbuild's JavaScript build API.[^esbuild-plugins]
- Recommended migration path:
  - Replace direct CLI bundling with a checked-in `build/esbuild.mjs` entry
    point so plugin logic is versioned and testable.

## Outstanding Decisions

- Whether to keep a minimal Babel step for any legacy transforms.
- How to model any remaining loader-specific behaviour in esbuild.

## Architectural Rationale

A single, high-performance bundler reduces tooling complexity, aligns with the
project's dependency reduction goals, and supports faster iteration without
sacrificing TypeScript or JSX support.[^esbuild]

[^esbuild]: <https://esbuild.github.io/>
[^esbuild-content]: <https://esbuild.github.io/content-types/>
[^esbuild-plugins]: <https://esbuild.github.io/plugins/>
[^webpack-loaders]: <https://webpack.js.org/concepts/loaders/>
[^babel-react]: <https://babeljs.io/docs/babel-preset-react>
[^esbuild-api]: <https://esbuild.github.io/api/>
[^styled-jsx-babel]: <https://github.com/vercel/styled-jsx>
[^chialab-esbuild-plugin-babel]: <https://www.npmjs.com/package/@chialab/esbuild-plugin-babel>
[^esbuild-plugin-copy]: <https://www.npmjs.com/package/esbuild-plugin-copy>
